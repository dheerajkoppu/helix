"""The discovery engine: subject, required action, five bridges, the direction filter, the order.

RANKING, IN FULL. There is no composite score and no probability of success anywhere.

Candidates are sorted on these keys in this order, and nothing else:

 1. the direction verdict: `matches` before `unknown` (`opposes` is not here at all, it is ruled out);
 2. bridge directness: same_target, then pathway_node, then interaction_partner, then
    structural_analogue, then mechanism_class;
 3. evidence strength: the strongest evidence class in the chain, in the order experimental,
    clinical database, curated database, literature, computational prediction, Helix hypothesis;
 4. whether the recorded action is on this protein alone rather than on a group of related proteins;
 5. the highest clinical phase ChEMBL records for the molecule, highest first, because a molecule
    that reached people has clinical records behind it;
 6. the measured activity against the protein, highest first, as the strength of that record;
 7. the number of distinct sources in the chain, most first;
 8. the molecule's name, so that two equal rows always come back in the same order.

Keys 5 and 6 are strengths of records, not predictions of effect. No key is combined with another.
"""

import asyncio
import time
from typing import Any

from helix.discovery import cache
from helix.discovery.bridges import BRIDGES
from helix.discovery.build import indication_is_subject, strongest_class
from helix.discovery.context import (
    BRIDGE_DIRECTNESS,
    BRIDGE_LABELS,
    BridgeContext,
    BridgeOutput,
    CandidateRow,
    RuledOutRow,
)
from helix.discovery.direct import LITERATURE_EDGE, direct_step_evidence, disease_drug_edges
from helix.discovery.rules import RULE_TABLE, required_action
from helix.discovery.subject import resolve_subject
from helix.knowledge.catalog import Catalog
from helix.log import get_logger
from helix.schemas.common import SourceState, SourceStatus
from helix.schemas.discovery import (
    BridgeDisease,
    BridgeStatus,
    BridgeStep,
    Candidate,
    DiscoveryResponse,
    RuledOut,
    WithheldEdge,
)

logger = get_logger(__name__)

RANKING_RULE = [
    "The direction check first: a molecule whose action matches the mechanism comes before one whose "
    "direction could not be checked.",
    "Then how directly the bridge connects: this very protein, then a protein up or down the pathway, "
    "then a protein this one binds, then a protein with a similar pocket, then another disease with the "
    "same mechanism.",
    "Then the strongest kind of record in the chain: experimental, then clinical database, then curated "
    "database, then published literature, then computational prediction.",
    "Then whether the record is on this protein alone rather than on a group of related proteins.",
    "Then the highest clinical phase recorded for the molecule, because a molecule given to people has "
    "clinical records behind it.",
    "Then the measured activity against the protein, as the strength of that record.",
    "Then the number of different sources in the chain.",
    "There is no combined score, no probability of success and no claim that a molecule would work.",
]

LIMITS = [
    "Every row is a hypothesis Helix built from records. None of it is a treatment, a dose or advice.",
    "A candidate says a molecule acts in the direction this mechanism needs. It does not say the molecule "
    "would work.",
    "Tissue and cell type were not checked, so a protein may not be present where it matters.",
    "Only molecules that ChEMBL records a mechanism for are considered. A molecule without such a record "
    "is missing from both lists.",
    "A molecule in the ruled-out list is ruled out for this mechanism. It may be right for another disease "
    "of the same gene.",
]

MAX_CANDIDATES = 40
MAX_RULED_OUT = 40


def _bridge_status(
    kind: Any, output: BridgeOutput | None, error: BaseException | None, elapsed_ms: float
) -> BridgeStatus:
    if error is not None:
        return BridgeStatus(
            kind=kind,
            label=BRIDGE_LABELS[kind],
            state="failed",
            message=(
                "This bridge ran out of time and was left out."
                if isinstance(error, TimeoutError)
                else "This bridge could not be read and was left out."
            ),
            elapsed_ms=round(elapsed_ms, 1),
        )
    assert output is not None
    state = "ok"
    if not output.candidates and not output.ruled_out:
        state = "empty"
    elif output.partial:
        state = "partial"
    return BridgeStatus(
        kind=kind,
        label=BRIDGE_LABELS[kind],
        state=state,  # type: ignore[arg-type]
        candidate_count=len(output.candidates),
        ruled_out_count=len(output.ruled_out),
        message=output.partial_reason or output.message,
        elapsed_ms=round(elapsed_ms, 1),
    )


def _merge_sources(rows: list[SourceStatus]) -> list[SourceStatus]:
    """One row per source, keeping the most informative state when a source answered several calls."""
    order = [
        SourceState.OK,
        SourceState.EMPTY,
        SourceState.NOT_CONFIGURED,
        SourceState.DISABLED_BY_LICENSE,
        SourceState.UNAVAILABLE,
    ]
    merged: dict[str, SourceStatus] = {}
    for row in rows:
        current = merged.get(row.source)
        if current is None:
            merged[row.source] = row
        elif current.state is not SourceState.OK and (
            row.state is SourceState.OK or order.index(row.state) > order.index(current.state)
        ):
            # A source that answered at least one call reads 'ok'; otherwise the worst state shows
            merged[row.source] = row
    return sorted(merged.values(), key=lambda row: row.source)


def _rank_key(row: CandidateRow) -> tuple[Any, ...]:
    return (
        0 if row.direction_check.verdict == "matches" else 1,
        BRIDGE_DIRECTNESS[row.bridge.kind],
        strongest_class(row.evidence),
        0 if row.target_is_exact_protein else 1,
        -(row.max_phase or 0.0),
        -(row.affinity or 0.0),
        -row.source_count,
        (row.molecule.name if row.molecule else "") or row.key,
    )


def _apply_direct_edges(
    context: BridgeContext, rows: list[CandidateRow], by_molecule: dict[str, dict[str, Any]]
) -> None:
    """Add the 'studied for this disease' claim to chains a bridge already built."""
    disease_ref = context.subject.disease
    disease_name = disease_ref.label if disease_ref else None
    for row in rows:
        if row.molecule is None:
            continue
        record = by_molecule.get(row.molecule.chembl_id)
        if record is None:
            continue
        name = record.get("name") or row.molecule.name
        stage = record.get("stage")
        evidence = direct_step_evidence(
            record.get("provenance"), row.molecule.chembl_id, name, disease_ref, disease_name
        )
        row.bridge.steps.append(
            BridgeStep(
                statement=(
                    f"Open Targets lists {name.title() if name else row.molecule.chembl_id} for "
                    f"{disease_name}"
                    f"{f' at {stage.replace("_", " ").lower()}' if stage else ''}. "
                    "This is a direct disease-to-molecule record, not part of the bridge."
                ),
                evidence=[evidence] if evidence else [],
            )
        )
        if row.bridge.from_disease is None and disease_ref is not None:
            row.bridge.from_disease = BridgeDisease(
                id=disease_ref.id,
                name=disease_name,
                source="Open Targets Platform",
                disease=disease_ref,
            )
        if evidence is not None:
            row.evidence.append(evidence)
            row.source_count += 1


def _chembl_indication_edges(context: BridgeContext, rows: list[CandidateRow]) -> list[WithheldEdge]:
    """One withheld row per candidate molecule whose ChEMBL indications were dropped."""
    indication_rows: dict[str, list[dict[str, Any]]] = context.shared.get("indication_rows") or {}
    names = {row.molecule.chembl_id: row.molecule.name for row in rows if row.molecule}
    edges: list[WithheldEdge] = []
    for chembl_id, records in indication_rows.items():
        if chembl_id not in names or not records:
            continue
        own = [record for record in records if indication_is_subject(record, context.diseases_in_scope)]
        best = (own or records)[0]
        name = names[chembl_id] or chembl_id
        terms = sorted(
            {
                str(record.get("efo_term") or record.get("mesh_heading"))
                for record in records
                if record.get("efo_term") or record.get("mesh_heading")
            }
        )
        edges.append(
            WithheldEdge(
                kind="chembl_indication",
                source="ChEMBL",
                disease_id=best.get("efo_id"),
                disease_name=best.get("efo_term") or best.get("mesh_heading"),
                molecule_chembl_id=chembl_id,
                molecule_name=name,
                detail=(
                    f"ChEMBL records {len(records)} disease"
                    f"{'s' if len(records) != 1 else ''} for {name}"
                    f"{f' ({", ".join(terms[:4])})' if terms else ''}"
                    f"{' - one of them is this very disease' if own else ''}. "
                    "No disease-to-molecule row was used to reach this molecule."
                ),
            )
        )
    return edges


async def discovery_candidates(
    catalog: Catalog,
    *,
    gene: str | None = None,
    disease: str | None = None,
    variant: str | None = None,
    exclude_direct: bool = False,
) -> DiscoveryResponse:
    """Candidate targets and molecules for a subject, with every chain and every rejection."""
    key = cache.key_for(gene=gene, disease=disease, variant=variant, exclude_direct=exclude_direct)
    cached = cache.get(key)
    if cached is not None:
        return cached.model_copy(update={"from_cache": True})

    started = time.perf_counter()
    resolved = await resolve_subject(catalog, gene=gene, disease=disease, variant=variant)
    rule = required_action(resolved.subject.mechanism.mechanism_class, resolved.subject.mechanism.direction)
    context = BridgeContext(
        subject=resolved.subject,
        rule=rule,
        catalog=catalog,
        diseases_in_scope=resolved.diseases_in_scope,
        exclude_direct=exclude_direct,
    )

    edges, direct_results, by_molecule, missing_edges = await disease_drug_edges(
        resolved.disease, resolved.gene
    )
    context.direct_edges = edges

    outputs: list[tuple[Any, BridgeOutput | None, BaseException | None, float]] = []
    if context.accession is None:
        statuses = [
            BridgeStatus(
                kind=kind,
                label=BRIDGE_LABELS[kind],
                state="skipped",
                message="The catalog gives no protein for this gene, so no target can be aimed at.",
            )
            for kind, _, _ in BRIDGES
        ]
    else:

        async def run_one(kind: Any, runner: Any, timeout: float) -> tuple[Any, Any, Any, float]:
            at = time.perf_counter()
            try:
                output = await asyncio.wait_for(runner(context), timeout)
                return kind, output, None, (time.perf_counter() - at) * 1000
            except BaseException as error:  # noqa: BLE001 - one bridge never fails the request
                logger.warning("Bridge %s failed: %s", kind, error)
                return kind, None, error, (time.perf_counter() - at) * 1000

        # same_target runs first so the other bridges can reuse the subject's own ChEMBL records
        head = next(entry for entry in BRIDGES if entry[0] == "same_target")
        outputs.append(await run_one(*head))
        outputs.extend(
            await asyncio.gather(*(run_one(*entry) for entry in BRIDGES if entry[0] != "same_target"))
        )
        statuses = [_bridge_status(kind, output, error, elapsed) for kind, output, error, elapsed in outputs]

    candidate_rows: list[CandidateRow] = []
    ruled_out_rows: list[RuledOutRow] = []
    sources: list[SourceStatus] = [catalog.source_status(), *resolved.sources]
    from helix.sources.base import Gathered

    sources.extend(Gathered(direct_results).sources)
    for _, output, _, _ in outputs:
        if output is None:
            continue
        candidate_rows.extend(output.candidates)
        ruled_out_rows.extend(output.ruled_out)
        sources.extend(output.sources)

    seen: set[str] = set()
    unique: list[CandidateRow] = []
    for row in sorted(candidate_rows, key=_rank_key):
        molecule_key = f"{row.molecule.chembl_id if row.molecule else row.key}:{row.target.accession}"
        if molecule_key in seen:
            continue
        seen.add(molecule_key)
        unique.append(row)

    if not exclude_direct:
        _apply_direct_edges(context, unique, by_molecule)
    withheld: list[WithheldEdge] = []
    if exclude_direct:
        withheld = [edge.edge for edge in edges]
        withheld.extend(missing_edges)
        withheld.extend(_chembl_indication_edges(context, unique))
    withheld.append(LITERATURE_EDGE)

    candidates = [
        Candidate(
            id=f"cand_{index:02d}",
            rank=index,
            target=row.target,
            molecule=row.molecule,
            bridge=row.bridge,
            direction_check=row.direction_check,
            structure=row.structure,
            caveats=row.caveats,
            evidence=row.evidence,
        )
        for index, row in enumerate(unique[:MAX_CANDIDATES], start=1)
    ]
    ruled_out_seen: set[str] = set()
    ruled_out: list[RuledOut] = []
    for row in sorted(ruled_out_rows, key=lambda item: item.molecule.name or item.key):
        molecule_key = f"{row.molecule.chembl_id}:{row.target.accession}"
        if molecule_key in ruled_out_seen or len(ruled_out) >= MAX_RULED_OUT:
            continue
        ruled_out_seen.add(molecule_key)
        ruled_out.append(
            RuledOut(
                id=f"out_{len(ruled_out) + 1:02d}",
                molecule=row.molecule,
                target=row.target,
                bridge_kind=row.bridge_kind,
                reason_code="opposes_required_action",
                reason=row.reason,
                direction_check=row.direction_check,
                evidence=row.evidence,
            )
        )

    limits = [*LIMITS, *resolved.notes]
    if rule.direction_needed == "none":
        limits.insert(
            0,
            "No record states which way this protein's activity moves, so nothing was ruled out on "
            "direction and every candidate is labelled unknown.",
        )
    if exclude_direct:
        limits.insert(
            0,
            "Held-out mode: every record linking this disease straight to a molecule was dropped, so a "
            "molecule is here only because a bridge found it.",
        )
    if any(status.state == "failed" for status in statuses):
        limits.append(
            "At least one bridge did not finish, so this list is shorter than it would otherwise be."
        )
    partial = [status for status in statuses if status.state == "partial"]
    if partial:
        limits.append(
            "A source one bridge wanted was not available, so that bridge ran on less data: "
            + "; ".join(f"{row.label.lower()} - {row.message}" for row in partial if row.message)
        )

    response = DiscoveryResponse(
        subject=resolved.subject,
        required_action=rule,
        candidates=candidates,
        ruled_out=ruled_out,
        withheld_edges=withheld,
        exclude_direct=exclude_direct,
        bridges=statuses,
        action_rule_table=RULE_TABLE,
        ranking_rule=RANKING_RULE,
        limits=limits,
        counts={
            "candidates": len(candidates),
            "ruled_out": len(ruled_out),
            "withheld_edges": len(withheld),
            "matches": sum(1 for row in candidates if row.direction_check.verdict == "matches"),
            "direction_unknown": sum(1 for row in candidates if row.direction_check.verdict == "unknown"),
            "bridges_ok": sum(1 for row in statuses if row.state == "ok"),
        },
        elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
        sources=_merge_sources(sources),
    )
    cache.put(key, response)
    return response
