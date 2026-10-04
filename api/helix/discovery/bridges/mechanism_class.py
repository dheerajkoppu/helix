"""mechanism_class: another disease with the same mechanism and direction, where a drug class exists.

THE RULE

A disease D is mechanism-matched to the subject when the Helix catalog records, for D, the same
mechanism class and the same direction as for the subject, and D sits in the same IUIS subcategory
(or, failing that, the same IUIS category). The subcategory keeps the comparison inside one curated
group of immune diseases rather than across the whole catalog.

The molecule then comes from D's own protein: ChEMBL records an action on it, and because D shares
the subject's mechanism and direction, that action class is the one the subject needs too. The
direction check still runs on the action, so a molecule that corrects D the wrong way for the subject
is still ruled out.

What this bridge does NOT claim: the molecule is not recorded against the subject's protein. Every
row says so, and the caveat is printed.
"""

import asyncio

from helix.discovery.build import build_rows
from helix.discovery.context import BridgeContext, BridgeOutput, CandidateRow, RuledOutRow
from helix.discovery.evidence import hypothesis, seed_provenance
from helix.discovery.rules import SAME_ACTION_CLASS, action_class_matches, molecule_effect
from helix.evidence import try_build_evidence
from helix.knowledge.catalog import SeedDisease
from helix.log import get_logger
from helix.schemas.common import EntityRef, EntityType, EvidenceObject
from helix.schemas.discovery import BridgeDisease, BridgeStep

logger = get_logger(__name__)

MAX_DISEASES = 3
MAX_ROWS_PER_DISEASE = 3
DISEASE_TIMEOUT = 25.0


def _matched_diseases(context: BridgeContext) -> list[SeedDisease]:
    """Catalog diseases with the subject's mechanism class, inside the same IUIS group."""
    mechanism = context.subject.mechanism
    if mechanism.mechanism_class == "unknown":
        return []
    own = {disease.id for disease in context.diseases_in_scope}
    subject_disease = context.diseases_in_scope[0] if context.diseases_in_scope else None
    if subject_disease is None:
        return []
    found: list[SeedDisease] = []
    for scope in ("subcategory_id", "category_id"):
        key = getattr(subject_disease, scope)
        if not key:
            continue
        for disease in context.catalog.diseases:
            if (
                disease.id in own
                or getattr(disease, scope) != key
                or disease.gene_symbol is None
                or disease.is_phenocopy
                or mechanism.mechanism_class not in [value.strip().lower() for value in disease.mechanism]
            ):
                continue
            gene = context.catalog.gene(disease.gene_symbol)
            if gene is None or not gene.uniprot_accession or gene.uniprot_accession == context.accession:
                continue
            if all(row.id != disease.id for row in found):
                found.append(disease)
        if found:
            break
    return sorted(found, key=lambda disease: disease.name)[:MAX_DISEASES]


async def run(context: BridgeContext) -> BridgeOutput:
    output = BridgeOutput()
    mechanism = context.subject.mechanism
    if mechanism.mechanism_class == "unknown":
        output.message = (
            "No mechanism class is recorded for this subject, so no other disease can be matched "
            "on mechanism."
        )
        return output
    matched = _matched_diseases(context)
    if not matched:
        output.message = (
            f"No other disease in the same IUIS group records the mechanism "
            f"{mechanism.mechanism_class.replace('_', ' ')}."
        )
        return output

    accessions = []
    for disease in matched:
        gene = context.catalog.gene(disease.gene_symbol or "")
        if gene and gene.uniprot_accession:
            accessions.append((disease, gene.symbol, gene.uniprot_accession, gene.protein_name))
    found = await asyncio.gather(
        *(asyncio.wait_for(context.protein_actions(row[2]), DISEASE_TIMEOUT) for row in accessions),
        return_exceptions=True,
    )
    for row, actions in zip(accessions, found, strict=True):
        disease, gene_symbol, accession, protein_name = row
        if isinstance(actions, BaseException):
            logger.info("Mechanism-matched disease %s was not read: %s", disease.id, actions)
            output.partial = True
            output.partial_reason = "ChEMBL did not answer for every mechanism-matched disease."
            continue
        for key, result in actions.results.items():
            output.results.setdefault(f"{key}:{accession}", result)
        if not actions.actions:
            continue
        disease_ref = EntityRef.of(EntityType.DISEASE, disease.id, label=disease.name)
        statement = (
            f"The catalog records {disease.name} with the same mechanism "
            f"({mechanism.mechanism_class.replace('_', ' ')}) and the same direction as "
            f"{context.subject_label}, in the same IUIS group. Its gene is {gene_symbol}."
        )
        evidence = []
        provenance = seed_provenance(context.catalog, disease.provenance, "iuis")
        if provenance is not None:
            built = try_build_evidence(
                provenance,
                record_type="classification",
                subject=disease_ref,
                predicate="has_mechanism_class",
                object=EvidenceObject(type="mechanism", label=mechanism.mechanism_class),
                statement=(
                    f"IUIS records the mechanism of {disease.name} as "
                    f"{mechanism.mechanism_class.replace('_', ' ')}."
                ),
            )
            if built is not None:
                evidence.append(built)
        candidates, ruled_out = build_rows(
            context,
            bridge_kind="mechanism_class",
            actions=actions,
            target_symbol=gene_symbol,
            target_name=protein_name,
            relation=SAME_ACTION_CLASS,
            steps_before=[BridgeStep(statement=statement, evidence=evidence)],
            max_rows=MAX_ROWS_PER_DISEASE,
            extra_sources={"iuis"},
            druggability_note=(
                f"{gene_symbol} is the protein of {disease.name}, not of {context.subject_label}."
            ),
        )
        from_disease = BridgeDisease(
            id=disease.id, name=disease.name, source="Helix catalog (IUIS)", disease=disease_ref
        )
        needed = ", ".join(context.rule.actions)
        kept: list[CandidateRow] = []
        for candidate in candidates:
            candidate.bridge.from_disease = candidate.bridge.from_disease or from_disease
            molecule = candidate.molecule
            if molecule is None:
                continue
            effect = molecule_effect(molecule.action_type)
            fits = action_class_matches(context.rule, molecule.action_type)
            action_text = (molecule.action_type or "not stated").lower()
            if effect != "unknown" and not fits:
                # The established action for the matched disease is the opposite of what this
                # subject needs, so the shared mechanism is no reason to carry the molecule over
                check = candidate.direction_check.model_copy(
                    update={
                        "verdict": "opposes",
                        "why": (
                            f"{context.subject_label} needs one of these actions: {needed}. {disease.name} "
                            f"shares its mechanism, but the action ChEMBL records for {molecule.name} is "
                            f"{action_text}, which is the opposite kind of action, so it is ruled out."
                        ),
                    }
                )
                output.ruled_out.append(
                    RuledOutRow(
                        key=candidate.key,
                        molecule=molecule,
                        target=candidate.target,
                        bridge_kind="mechanism_class",
                        reason=check.why,
                        direction_check=check,
                        evidence=candidate.evidence,
                    )
                )
                continue
            comparison = (
                f"{context.subject_label} needs one of these actions: {needed}. The action ChEMBL "
                f"records for {molecule.name} is {action_text}, which is "
                f"{'that kind of action' if fits else 'of an unstated kind'}. What carries over is the "
                f"kind of action, not the molecule: no record connects {gene_symbol} to "
                f"{context.subject.gene_symbol}."
            )
            carried = hypothesis(
                comparison,
                rests_on=candidate.evidence,
                subject=context.subject.protein or context.subject.gene,
                predicate="shares_required_action_with",
                object=EvidenceObject(type="disease", id=disease.id, label=disease.name),
            )
            candidate.bridge.steps.append(
                BridgeStep(statement=comparison, evidence=[row for row in [carried] if row is not None])
            )
            if carried is not None:
                candidate.evidence.append(carried)
            kept.append(candidate)
        output.candidates.extend(kept)
        output.ruled_out.extend(ruled_out)
    if not output.candidates and not output.ruled_out:
        output.message = "ChEMBL records no molecule with an action on the proteins of those diseases."
    return output
