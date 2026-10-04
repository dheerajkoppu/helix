"""same_target: a molecule that acts on this very protein, approved or studied in another disease.

The chain is two claims. The catalog says which protein the subject's gene encodes; ChEMBL says a
molecule has a recorded action on a target that contains that protein. Nothing here comes from a
disease-to-drug edge, which is why this bridge still works when exclude_direct withholds them.

Measured activities are read through the existing compounds service, so the figure shown is the same
one the protein page shows and the cache is shared.
"""

import asyncio
from typing import Any

from helix.discovery.build import build_rows
from helix.discovery.context import BridgeContext, BridgeOutput
from helix.discovery.evidence import seed_provenance
from helix.discovery.rules import SAME_PROTEIN
from helix.discovery.targets import indications
from helix.evidence import try_build_evidence
from helix.log import get_logger
from helix.schemas.common import Evidence, EvidenceObject
from helix.schemas.discovery import BridgeStep, CandidateStructure, MeasuredAffinity

logger = get_logger(__name__)

MAX_ROWS = 12
AFFINITY_TIMEOUT = 25.0


def subject_protein_step(context: BridgeContext) -> BridgeStep:
    """The claim that links the subject's gene to a protein, with the catalog record behind it."""
    gene = context.catalog.gene(context.subject.gene_symbol)
    evidence = []
    if gene is not None:
        provenance = seed_provenance(context.catalog, gene.provenance, "uniprot")
        if provenance is not None:
            row = try_build_evidence(
                provenance,
                record_type="entry",
                subject=context.subject.gene,
                predicate="encodes",
                object=EvidenceObject(
                    type="protein", id=f"uniprot:{context.accession}", label=gene.protein_name
                ),
                statement=(
                    f"{context.subject.gene_symbol} encodes {gene.protein_name or context.accession} "
                    f"(UniProt {context.accession})."
                ),
            )
            if row is not None:
                evidence.append(row)
    return BridgeStep(
        statement=(
            f"{context.subject.gene_symbol} encodes UniProt {context.accession}"
            f"{f', {gene.protein_name}' if gene and gene.protein_name else ''}."
        ),
        evidence=evidence,
    )


async def measured_affinities(
    accession: str, output: BridgeOutput
) -> tuple[
    dict[str, MeasuredAffinity], dict[str, Evidence], dict[str, Any], list[int], dict[str, dict[str, int]]
]:
    """Measured activities and bound ligands of the subject protein, from the compounds service."""
    from helix.services.compounds import protein_compounds

    try:
        response = await asyncio.wait_for(protein_compounds(accession), AFFINITY_TIMEOUT)
    except Exception as error:  # noqa: BLE001 - a missing measurement is a caveat, not a failure
        logger.info("Measured activities for %s were not read: %s", accession, error)
        return {}, {}, {}, [], {}
    output.statuses.extend(response.sources)
    affinities: dict[str, MeasuredAffinity] = {}
    affinity_evidence: dict[str, Evidence] = {}
    # Assay types with their counts, kept as a dict because the direction filter reads which kinds
    # of measurement exist, not just how strong they are
    assay_types: dict[str, dict[str, int]] = {}
    target = response.target
    for compound in response.compounds:
        summary = compound.measured_affinity
        if summary is None or not compound.chembl_id:
            continue
        assay_types[compound.chembl_id] = dict(summary.standard_types)
        affinities[compound.chembl_id] = MeasuredAffinity(
            median_pchembl=summary.median_pchembl,
            activity_count=summary.activity_count,
            assay_count=summary.assay_count,
            standard_types=list(summary.standard_types),
            organism=target.organism if target else None,
            url=summary.representative.url,
        )
        measured = next((row for row in compound.evidence if row.predicate == "measured_activity"), None)
        if measured is not None:
            affinity_evidence[compound.chembl_id] = measured
    positions = sorted(
        {
            position
            for compound in response.compounds
            if compound.co_crystal
            for position in compound.co_crystal.binding_positions
        }
    )
    ligands = {
        compound.co_crystal.ccd_id: compound.co_crystal.pdb_ids[0]
        for compound in response.compounds
        if compound.co_crystal and compound.co_crystal.pdb_ids
    }
    return affinities, affinity_evidence, ligands, positions, assay_types


async def run(context: BridgeContext) -> BridgeOutput:
    accession = context.accession
    if accession is None:
        return BridgeOutput(message="The catalog gives no protein for this gene.")

    actions = await context.protein_actions(accession)
    output = BridgeOutput(results=dict(actions.results))
    if not actions.actions:
        output.message = "ChEMBL records no molecule with an action on this protein."
        return output

    affinities, affinity_evidence, ligands, positions, assay_types = await measured_affinities(
        accession, output
    )
    context.shared["subject_bound_ligands"] = ligands
    indication_rows: dict[str, list[dict[str, Any]]] = {}
    indication_provenance = None
    try:
        result = await indications([action.chembl_id for action in actions.actions[: MAX_ROWS * 2]])
        output.results["chembl_indications"] = result
        indication_provenance = result.provenance
        for row in result.data or [] if result.ok else []:
            key = row.get("parent_molecule_chembl_id") or row.get("molecule_chembl_id")
            if key:
                indication_rows.setdefault(key, []).append(row)
    except Exception as error:  # noqa: BLE001
        logger.info("Indications for %s were not read: %s", accession, error)
    context.shared["indication_rows"] = indication_rows

    gene = context.catalog.gene(context.subject.gene_symbol)
    structure = (
        CandidateStructure(
            structure_id=f"afdb:AF-{accession}-F1",
            residues=positions,
            note=(
                f"{len(positions)} residues of {accession} line a ligand in an experimental PDB entry, so a "
                "pocket is known to exist here."
            ),
        )
        if positions
        else None
    )
    candidates, ruled_out = build_rows(
        context,
        bridge_kind="same_target",
        actions=actions,
        target_symbol=context.subject.gene_symbol,
        target_name=gene.protein_name if gene else None,
        relation=SAME_PROTEIN,
        steps_before=[subject_protein_step(context)],
        max_rows=MAX_ROWS,
        structure=structure,
        affinities=affinities,
        affinity_evidence=affinity_evidence,
        assay_types=assay_types,
        indication_rows=indication_rows,
        indication_provenance=indication_provenance,
    )
    output.candidates = candidates
    output.ruled_out = ruled_out
    if not candidates and ruled_out:
        output.message = (
            f"Every one of the {len(ruled_out)} molecules recorded against this protein would push its "
            "activity the wrong way."
        )
    return output
