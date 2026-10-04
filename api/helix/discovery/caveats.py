"""Caveats, generated from real conditions only. Short sentences, one condition each.

A caveat is added when the condition behind it is true of this candidate's own records. No caveat is
decorative: if the engine cannot check a condition, it says the condition was not checked.
"""

from helix.schemas.common import EvidenceClass
from helix.schemas.discovery import BridgeKind, CandidateMolecule, DirectionCheck

NOT_CHECKED_TISSUE = "Tissue expression was not checked, so the protein may not be present where it matters."
NOT_SMALL_MOLECULE = "This is not a small molecule, so pocket and binding predictions do not apply to it."
NO_MEASUREMENT = "No record measures this molecule against this protein."
OTHER_SPECIES = "The target record is not human, so the measurement was made on another species."
PREDICTION = "This step is a prediction and has not been tested in the laboratory."
WITHDRAWN = "ChEMBL marks this molecule as withdrawn."
NO_PHASE = (
    "ChEMBL records no clinical phase for this molecule, so it has only been studied in the laboratory."
)
SINGLE_SOURCE = "The chain rests on a single source, so nothing else confirms it."
NOT_THE_SUBJECT_PROTEIN = "The molecule is not recorded against the subject's own protein."
DIRECTION_UNKNOWN = "The direction of effect could not be checked, so this candidate may push the wrong way."
FAMILY_TARGET = "The record is on a group of related proteins, not on this protein alone."
NO_INDICATION = "No other disease is recorded for this molecule, so there is no second disease to learn from."

BIOLOGIC_WORDS = frozenset(
    {"antibody", "protein", "enzyme", "oligonucleotide", "oligosaccharide", "cell", "gene"}
)


def caveats_for(
    *,
    bridge_kind: BridgeKind,
    molecule: CandidateMolecule | None,
    direction_check: DirectionCheck,
    evidence_classes: set[EvidenceClass],
    source_names: set[str],
    target_is_exact_protein: bool,
    target_organism: str | None,
    target_type: str | None,
    has_measurement: bool,
    has_other_disease: bool,
) -> list[str]:
    rows: list[str] = []
    if direction_check.verdict == "unknown":
        rows.append(DIRECTION_UNKNOWN)
    if molecule is not None:
        kind = (molecule.modality or "").strip().lower()
        if kind in BIOLOGIC_WORDS or "antibody" in kind:
            rows.append(NOT_SMALL_MOLECULE)
        if molecule.withdrawn:
            rows.append(WITHDRAWN)
        if molecule.max_phase is None or molecule.max_phase <= 0:
            rows.append(NO_PHASE)
    if not target_is_exact_protein:
        rows.append(NOT_THE_SUBJECT_PROTEIN)
    if target_type and target_type != "SINGLE PROTEIN":
        rows.append(FAMILY_TARGET)
    if target_organism and target_organism != "Homo sapiens":
        rows.append(OTHER_SPECIES)
    if not has_measurement:
        rows.append(NO_MEASUREMENT)
    if bridge_kind in ("structural_analogue",) or EvidenceClass.COMPUTATIONAL_PREDICTION in evidence_classes:
        rows.append(PREDICTION)
    if bridge_kind == "mechanism_class" and not has_other_disease:
        rows.append(NO_INDICATION)
    if len(source_names) <= 1:
        rows.append(SINGLE_SOURCE)
    rows.append(NOT_CHECKED_TISSUE)
    return list(dict.fromkeys(rows))
