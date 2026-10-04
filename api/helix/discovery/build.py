"""Turning ChEMBL mechanism records into candidate rows, with the direction filter applied.

Four of the five bridges end the same way: a molecule has a recorded action on a protein, and the
bridge has already said how that protein relates to the subject. This module does that last step
once, so the filter and the wording cannot drift between bridges.
"""

from typing import Any

from helix.discovery.caveats import caveats_for
from helix.discovery.context import BRIDGE_LABELS, BridgeContext, CandidateRow, RuledOutRow
from helix.discovery.rules import DirectionEvidence, Relation, direction_check
from helix.discovery.targets import ProteinActions
from helix.evidence import try_build_evidence
from helix.knowledge.catalog import SeedDisease, normalise_alias
from helix.schemas.common import EntityRef, EntityType, Evidence, EvidenceClass, EvidenceObject
from helix.schemas.discovery import (
    Bridge,
    BridgeDisease,
    BridgeKind,
    BridgeStep,
    CandidateStructure,
    CandidateTarget,
    MeasuredAffinity,
)


def _disease_keys(disease: SeedDisease) -> set[str]:
    keys = {normalise_alias(disease.name), *(normalise_alias(alias) for alias in disease.aliases)}
    keys |= {str(value).upper().replace("_", ":") for value in disease.xrefs.mondo}
    keys |= {str(value).upper().replace("ORPHA:", "ORPHANET:") for value in disease.xrefs.orphanet}
    return keys


def indication_is_subject(row: dict[str, Any], diseases: list[SeedDisease]) -> bool:
    """True when a ChEMBL drug_indication row names one of the subject's own diseases."""
    efo = (row.get("efo_id") or "").upper().replace("_", ":")
    terms = {normalise_alias(text) for text in (row.get("efo_term"), row.get("mesh_heading")) if text}
    for disease in diseases:
        keys = _disease_keys(disease)
        if efo and efo in keys:
            return True
        if terms & keys:
            return True
    return False


def _from_disease(
    rows: list[dict[str, Any]], context: BridgeContext
) -> tuple[BridgeDisease | None, bool, dict[str, Any] | None]:
    """The best other disease this molecule is recorded for. Returns (disease, is_the_subject, row).

    Held-out mode uses none of these rows, whichever disease they name: a molecule's indication list
    is how a person would look the answer up, and a ChEMBL term can be a parent of the subject's own
    disease ("inborn error of immunity"), which a name match would not catch. Dropping all of them
    keeps the held-out mode strict rather than nearly strict.
    """
    if context.exclude_direct:
        return None, False, None
    others = [row for row in rows if not indication_is_subject(row, context.diseases_in_scope)]
    own = [row for row in rows if indication_is_subject(row, context.diseases_in_scope)]
    if others:
        best = max(others, key=lambda row: float(row.get("max_phase_for_ind") or 0))
        return (
            BridgeDisease(
                id=best.get("efo_id"),
                name=best.get("efo_term") or best.get("mesh_heading"),
                source="ChEMBL drug_indication",
            ),
            False,
            best,
        )
    if own and not context.exclude_direct:
        best = own[0]
        disease = context.subject.disease
        return (
            BridgeDisease(
                id=best.get("efo_id"),
                name=best.get("efo_term") or best.get("mesh_heading"),
                source="ChEMBL drug_indication",
                disease=disease,
            ),
            True,
            best,
        )
    return None, False, None


def _indication_evidence(
    provenance: Any,
    row: dict[str, Any] | None,
    molecule: Any,
    disease_name: str | None,
    subject: EntityRef,
) -> Evidence | None:
    if provenance is None or row is None:
        return None
    from helix.sources.chembl import chembl

    return try_build_evidence(
        provenance,
        record_type="indication",
        record_id=f"drug_indication:{row.get('drugind_id')}",
        url=chembl.record_url(molecule.chembl_id),
        subject=subject,
        predicate="has_indication",
        object=EvidenceObject(type="disease", id=row.get("efo_id"), label=disease_name),
        statement=f"{molecule.name} is recorded for {disease_name}.",
        strength_value=row.get("max_phase_for_ind"),
        strength_scheme="chembl_max_phase_for_indication",
    )


def build_rows(
    context: BridgeContext,
    *,
    bridge_kind: BridgeKind,
    actions: ProteinActions,
    target_symbol: str | None,
    target_name: str | None,
    relation: Relation,
    steps_before: list[BridgeStep],
    max_rows: int,
    structure: CandidateStructure | None = None,
    affinities: dict[str, MeasuredAffinity] | None = None,
    affinity_evidence: dict[str, Evidence] | None = None,
    assay_types: dict[str, dict[str, int]] | None = None,
    indication_rows: dict[str, list[dict[str, Any]]] | None = None,
    indication_provenance: Any = None,
    extra_sources: set[str] | None = None,
    partial: bool = False,
    partial_reason: str | None = None,
    druggability_note: str | None = None,
) -> tuple[list[CandidateRow], list[RuledOutRow]]:
    """One candidate per (molecule, target) pair, with the direction filter applied to each."""
    accession = actions.accession
    protein_ref = EntityRef.of(EntityType.PROTEIN, accession, label=target_name, curie=f"uniprot:{accession}")
    druggability = actions.druggability(druggability_note)
    candidates: list[CandidateRow] = []
    ruled_out: list[RuledOutRow] = []
    subject_label = context.subject_label
    subject_protein = context.subject.protein or context.subject.gene

    # Every retrieved mechanism record is direction-checked. `max_rows` is a presentation limit and
    # is applied at the end, so a cap can never drop a molecule into neither list: an opposition
    # found past the cap still reaches ruled_out, where the user can see the refusal.
    for action in actions.actions:
        target = CandidateTarget(
            accession=accession,
            gene_symbol=target_symbol,
            name=action.target.name or target_name,
            relation=bridge_kind,
            protein=protein_ref,
            druggability=druggability,
        )
        label = action.target.name or target_symbol or accession
        if not action.target.is_single_protein and target_symbol and target_symbol not in label:
            # A ChEMBL family or complex target is named after one member, so name the protein too
            label = f"{label}, a ChEMBL target that includes {target_symbol}"
        check = direction_check(
            context.rule,
            action_type=action.action_type,
            relation=relation,
            target_label=label,
            subject_label=subject_label,
            activity_label=context.subject.gene_symbol,
            evidence=DirectionEvidence(
                other_action_types=action.other_action_types,
                assay_standard_types=(assay_types or {}).get(action.chembl_id),
            ),
        )
        molecule = action.molecule()
        rows = (indication_rows or {}).get(action.chembl_id, [])
        from_disease, is_own_disease, indication_row = _from_disease(rows, context)
        evidence: list[Evidence] = [item for step in steps_before for item in step.evidence]
        action_evidence = actions.evidence_for(action, subject_protein)
        statement = (
            f"ChEMBL records {molecule.name} as "
            f"{'an' if (action.action_type or 'x')[:1].upper() in 'AEIOU' else 'a'} "
            f"{(action.action_type or 'molecule with a recorded mechanism').lower()} of {label}"
            f"{f', described as "{action.mechanism_of_action}"' if action.mechanism_of_action else ''}."
        )
        final_step = BridgeStep(statement=statement, evidence=[action_evidence] if action_evidence else [])
        steps = [*steps_before, final_step]
        if action_evidence is not None:
            evidence = [*evidence, action_evidence]
        if from_disease is not None and from_disease.name:
            where = "this very disease" if is_own_disease else from_disease.name
            indication_evidence = _indication_evidence(
                indication_provenance, indication_row, molecule, from_disease.name, subject_protein
            )
            steps.append(
                BridgeStep(
                    statement=(
                        f"ChEMBL records {molecule.name} as studied or used for {where}, so it has "
                        "been given "
                        "to people before."
                    ),
                    evidence=[indication_evidence] if indication_evidence else [],
                )
            )
            if indication_evidence is not None:
                evidence = [*evidence, indication_evidence]
        affinity = (affinities or {}).get(action.chembl_id)
        if affinity is not None:
            molecule.measured_affinity = affinity
            measured = (affinity_evidence or {}).get(action.chembl_id)
            steps.append(
                BridgeStep(
                    statement=(
                        f"ChEMBL holds {affinity.activity_count} measured "
                        f"activit{'y' if affinity.activity_count == 1 else 'ies'} of {molecule.name} against "
                        f"{label}, median pChEMBL {affinity.median_pchembl:g}."
                    ),
                    evidence=[measured] if measured else [],
                )
            )
            if measured is not None:
                evidence = [*evidence, measured]
        bridge = Bridge(
            kind=bridge_kind,
            label=BRIDGE_LABELS[bridge_kind],
            from_disease=from_disease,
            steps=steps,
            partial=partial,
            partial_reason=partial_reason,
        )
        source_names = {item.source.database for item in evidence if item.source} | (extra_sources or set())
        exact = action.target.is_single_protein and accession == context.accession
        key = f"{bridge_kind}:{accession}:{action.chembl_id}:{action.target.chembl_id}"
        if check.verdict == "opposes":
            ruled_out.append(
                RuledOutRow(
                    key=key,
                    molecule=molecule,
                    target=target,
                    bridge_kind=bridge_kind,
                    reason=check.why,
                    direction_check=check,
                    evidence=evidence,
                )
            )
            continue
        candidates.append(
            CandidateRow(
                key=key,
                target=target,
                molecule=molecule,
                bridge=bridge,
                direction_check=check,
                structure=structure,
                caveats=caveats_for(
                    bridge_kind=bridge_kind,
                    molecule=molecule,
                    direction_check=check,
                    evidence_classes={item.evidence_class for item in evidence},
                    source_names=source_names,
                    target_is_exact_protein=exact,
                    target_organism=action.target.organism,
                    target_type=action.target.target_type,
                    has_measurement=affinity is not None,
                    has_other_disease=from_disease is not None and not is_own_disease,
                ),
                evidence=evidence,
                source_count=len(source_names),
                max_phase=action.max_phase,
                target_is_exact_protein=exact,
                affinity=affinity.median_pchembl if affinity else None,
            )
        )
    # The engine ranks across bridges before it cuts, so a bridge hands back its best `max_rows` in
    # the order its own retrieval produced them. Oppositions are never cut here.
    return candidates[:max_rows], ruled_out


def strongest_class(evidence: list[Evidence]) -> int:
    """Rank of the strongest evidence class in a chain. Lower is stronger. Reading order only."""
    order = [
        EvidenceClass.EXPERIMENTAL,
        EvidenceClass.CLINICAL_DATABASE,
        EvidenceClass.CURATED_DATABASE,
        EvidenceClass.LITERATURE,
        EvidenceClass.COMPUTATIONAL_PREDICTION,
        EvidenceClass.HELIX_HYPOTHESIS,
    ]
    ranks = [order.index(item.evidence_class) for item in evidence if item.evidence_class in order]
    return min(ranks) if ranks else len(order)
