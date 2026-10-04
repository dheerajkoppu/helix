"""structural_analogue: a protein whose pocket resembles this one and has a known binder.

PREFERRED SOURCE

`helix.sources.foldseek` is a fold-similarity source another builder is writing. When it is
importable and exposes an awaitable `similar_structures(accession)` (or `similar`) returning rows
with an `accession` and a similarity figure, this bridge uses it and says so.

FALLBACK, USED WHEN FOLDSEEK IS NOT THERE

Shared chemistry inside the records Helix already holds. If ChEMBL records one molecule as acting on
both this protein and another protein, the two binding sites accommodate the same chemistry. Other
molecules recorded against that other protein are then a structural hypothesis for this one. The
bridge is marked partial, because shared chemistry is weaker than a measured fold alignment, and
PrankWeb pockets are attached so the user can look at both sites in 3D.

The molecule is proposed as a binder of the SUBJECT's protein, so the target of the candidate is the
subject's own protein and `structure.similar_to` names the protein the chemistry was borrowed from.
Nothing measures the molecule against the subject's protein, which is printed as a caveat on every
row of this bridge.
"""

import asyncio
import importlib
from typing import Any

from helix.discovery.build import build_rows
from helix.discovery.context import BridgeContext, BridgeOutput
from helix.discovery.evidence import hypothesis
from helix.discovery.rules import SAME_PROTEIN
from helix.discovery.targets import ProteinActions
from helix.log import get_logger
from helix.schemas.common import EntityRef, EntityType, EvidenceObject
from helix.schemas.discovery import BridgeStep, CandidateStructure, CandidateTarget

logger = get_logger(__name__)

MAX_ANALOGUES = 3
MAX_ROWS_PER_ANALOGUE = 3
ANALOGUE_TIMEOUT = 25.0
POCKET_TIMEOUT = 12.0
FALLBACK_REASON = (
    "No fold-similarity source is available in this deployment, so the chain uses shared chemistry "
    "instead of a measured fold alignment."
)


async def _foldseek_rows(accession: str) -> list[dict[str, Any]] | None:
    """Rows from the structural similarity source, or None when it is not there yet."""
    try:
        module = importlib.import_module("helix.sources.foldseek")
    except ModuleNotFoundError:
        return None
    for name in ("similar_structures", "similar", "search"):
        call = getattr(module, name, None) or getattr(getattr(module, "foldseek", None), name, None)
        if call is None:
            continue
        try:
            result = await asyncio.wait_for(call(accession), ANALOGUE_TIMEOUT)
        except Exception as error:  # noqa: BLE001 - an unfinished module never fails the request
            logger.info("Foldseek source did not answer for %s: %s", accession, error)
            return None
        rows = getattr(result, "data", result)
        if isinstance(rows, dict):
            rows = rows.get("rows") or rows.get("hits") or []
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict) and row.get("accession")]
    return None


async def _pocket(accession: str) -> tuple[str | None, str | None, list[int]]:
    from helix.services.pockets import protein_pockets

    try:
        response = await asyncio.wait_for(protein_pockets(accession, None, None), POCKET_TIMEOUT)
    except Exception as error:  # noqa: BLE001
        logger.info("Pockets for %s were not read: %s", accession, error)
        return None, None, []
    best = response.pockets[0] if response.pockets else None
    return response.structure_id, (best.id if best else None), (best.positions if best else [])


def _shared_chemistry(subject: ProteinActions) -> list[tuple[str, str | None, list[str]]]:
    """Other proteins that a molecule of this protein also acts on, from the same mechanism records."""
    shared: dict[str, tuple[set[str], set[str]]] = {}
    for action in subject.actions:
        for accession in action.target.accessions:
            if accession == subject.accession:
                continue
            molecules, names = shared.setdefault(accession, (set(), set()))
            molecules.add(action.label)
            names.add(action.target.name or "")
    return sorted(
        ((accession, None, sorted(molecules)) for accession, (molecules, _) in shared.items()),
        key=lambda row: (-len(row[2]), row[0]),
    )


async def run(context: BridgeContext) -> BridgeOutput:
    accession, symbol = context.accession, context.subject.gene_symbol
    output = BridgeOutput()
    if accession is None:
        output.message = "The catalog gives no protein for this gene."
        return output

    subject_actions = await context.protein_actions(accession)

    rows = await _foldseek_rows(accession)
    partial = rows is None
    analogues: list[tuple[str, str | None, str, list[str]]] = []
    if rows is not None:
        for row in rows[:MAX_ANALOGUES]:
            figure = (
                row.get("tm_score") or row.get("similarity") or row.get("probability") or row.get("evalue")
            )
            analogues.append(
                (
                    str(row["accession"]).upper(),
                    row.get("gene_symbol") or row.get("symbol"),
                    f"a fold alignment{f' (score {figure})' if figure is not None else ''}",
                    [],
                )
            )
    else:
        for analogue_accession, analogue_symbol, molecules in _shared_chemistry(subject_actions)[
            :MAX_ANALOGUES
        ]:
            analogues.append((analogue_accession, analogue_symbol, "shared chemistry", molecules))
    if not analogues:
        output.message = (
            "No record links this protein's binding site to another protein's, so no structural analogue "
            "was found."
        )
        output.partial = partial
        output.partial_reason = FALLBACK_REASON if partial else None
        return output

    structure_id, pocket_id, pocket_residues = await _pocket(accession)
    found = await asyncio.gather(
        *(asyncio.wait_for(context.protein_actions(row[0]), ANALOGUE_TIMEOUT) for row in analogues),
        return_exceptions=True,
    )
    subject_molecules = {action.chembl_id for action in subject_actions.actions}
    subject_protein = context.subject.protein or context.subject.gene
    gene = context.catalog.gene(symbol)
    for row, actions in zip(analogues, found, strict=True):
        analogue_accession, analogue_symbol, basis, molecules = row
        if isinstance(actions, BaseException):
            logger.info("Structural analogue %s was not read: %s", analogue_accession, actions)
            output.partial = True
            output.partial_reason = "ChEMBL did not answer for every analogous protein."
            continue
        for key, result in actions.results.items():
            output.results.setdefault(f"{key}:{analogue_accession}", result)
        fresh = [action for action in actions.actions if action.chembl_id not in subject_molecules]
        if not fresh:
            continue
        analogue_target = actions.single_target
        analogue_gene = context.catalog.gene_by_uniprot(analogue_accession)
        analogue_symbol = analogue_symbol or (analogue_gene.symbol if analogue_gene else None)
        analogue_name = analogue_target.name if analogue_target else None
        # The molecules are proposed as binders of the subject's own protein
        borrowed = ProteinActions(
            accession=accession,
            targets=subject_actions.targets,
            actions=fresh,
            results={},
            mechanism_provenance=actions.mechanism_provenance,
        )
        shared_text = (
            f" ChEMBL records {', '.join(molecules[:3])} as acting on both proteins." if molecules else ""
        )
        shared_evidence = [
            row
            for action in subject_actions.actions
            if analogue_accession in action.target.accessions
            and (row := subject_actions.evidence_for(action, subject_protein)) is not None
        ]
        statement = (
            f"{analogue_symbol or analogue_accession} and {symbol} are linked by {basis}, so their binding "
            f"sites take the same kind of molecule.{shared_text} A molecule recorded against "
            f"{analogue_symbol or analogue_accession} is therefore a structural hypothesis for {symbol}; no "
            "record measures it against this protein."
        )
        analogy = hypothesis(
            statement,
            rests_on=shared_evidence,
            subject=subject_protein,
            predicate="has_structural_analogue",
            object=EvidenceObject(type="protein", id=f"uniprot:{analogue_accession}", label=analogue_symbol),
        )
        structure = CandidateStructure(
            structure_id=structure_id,
            pocket_id=pocket_id,
            residues=pocket_residues,
            similar_to=CandidateTarget(
                accession=analogue_accession,
                gene_symbol=analogue_symbol,
                name=analogue_name,
                relation="structural_analogue",
                protein=EntityRef.of(
                    EntityType.PROTEIN,
                    analogue_accession,
                    label=analogue_symbol or analogue_name,
                    curie=f"uniprot:{analogue_accession}",
                ),
                druggability=actions.druggability(
                    f"The chemistry borrowed here comes from {analogue_symbol or analogue_accession}."
                ),
            ),
            note=(
                f"The pocket shown is a PrankWeb prediction on {structure_id}. It is a prediction, not a "
                "measured site."
                if pocket_id
                else "No predicted pocket was read for this protein."
            ),
        )
        candidates, ruled_out = build_rows(
            context,
            bridge_kind="structural_analogue",
            actions=borrowed,
            target_symbol=symbol,
            target_name=gene.protein_name if gene else None,
            relation=SAME_PROTEIN,
            steps_before=[
                BridgeStep(
                    statement=statement,
                    evidence=[row for row in [analogy] if row is not None],
                )
            ],
            max_rows=MAX_ROWS_PER_ANALOGUE,
            structure=structure,
            partial=partial,
            partial_reason=FALLBACK_REASON if partial else None,
            druggability_note=(
                f"The chemistry comes from {analogue_symbol or analogue_accession}, not from {symbol}."
            ),
        )
        output.candidates.extend(candidates)
        output.ruled_out.extend(ruled_out)
    output.partial = output.partial or partial
    output.partial_reason = output.partial_reason or (FALLBACK_REASON if partial else None)
    if not output.candidates and not output.ruled_out:
        output.message = (
            "No further molecule was recorded against the proteins that share this one's chemistry."
        )
    return output
