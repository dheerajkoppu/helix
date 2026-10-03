"""Schemas of the residue effect panel and the per-protein effect map.

Values stay in their source's own scale and class vocabulary. Nothing here combines values from
different sources.
"""

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import Field

from helix.schemas.common import (
    Aggregated,
    EntityRef,
    Evidence,
    EvidenceClass,
    Provenance,
    Schema,
    StructureOrigin,
)

EffectState = Literal["ok", "not_covered", "unavailable", "disabled_by_license"]
EffectFlagCode = Literal["plddt_below_70", "gap_frequency_above_0.5", "reference_residue_mismatch"]
EffectDirection = Literal["higher_more_damaging", "lower_more_damaging", "positive_destabilising", "none"]
EffectKind = Literal[
    "pathogenicity",
    "language_model_llr",
    "conservation",
    "stability_ddg",
    "structural_feature",
    "functional_assay",
    "curated_feature",
]


@dataclass(frozen=True, slots=True)
class EffectQuery:
    """What the providers are asked about. reference is the residue of the UniProt canonical
    sequence at the position; None when the sequence could not be read."""

    accession: str
    position: int
    reference: str | None
    alternate: str | None
    subject: EntityRef

    @property
    def record(self) -> str:
        return f"{self.accession}:{self.position}:{self.alternate}" if self.alternate else self.residue_record

    @property
    def residue_record(self) -> str:
        return f"{self.accession}:{self.position}"


class EffectFlag(Schema):
    code: EffectFlagCode
    message: str


class EffectThreshold(Schema):
    """A bin published by the source, in the source's own words."""

    label: str
    lower: float | None = None
    upper: float | None = None
    defined_by: str


class EffectStructureBasis(Schema):
    """The structure a structure-based value was computed on."""

    id: str = Field(description="pdb:<ID>, afdb:<entryId> or of:<job_id>")
    origin: StructureOrigin
    fragment: str | None = None
    residue_plddt: float | None = None


class EffectValue(Schema):
    key: str = Field(description="Stable key, e.g. alphamissense.pathogenicity, foldx.ddg")
    label: str
    kind: EffectKind
    state: EffectState
    value: float | str | None = None
    unit: str | None = None
    scale: str | None = Field(default=None, description="The source's native scale, in words")
    direction: EffectDirection = "none"
    source_class: str | None = Field(default=None, description="Class string exactly as the source gives it")
    normalized_class: str | None = Field(default=None, description="Vocabulary only; never recomputed")
    class_label: str | None = Field(default=None, description="Display wording that names the source")
    thresholds: list[EffectThreshold] = Field(default_factory=list)
    flags: list[EffectFlag] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict, description="Further source fields, verbatim")
    message: str | None = Field(default=None, description="Why there is no value, or a caveat")
    tool: str | None = None
    tool_version: str | None = None
    input_basis: str | None = Field(default=None, description="sequence, alignment or structure")
    structure: EffectStructureBasis | None = None
    license: str | None = None
    commercial_use: Literal["allowed", "restricted", "unknown"] | None = None
    citation_doi: str | None = None
    evidence: Evidence | None = None
    provenance: Provenance | None = None


class EffectGroup(Schema):
    id: Literal[
        "computational_predictions", "experimental_functional", "curated_annotation", "structural_context"
    ]
    label: str
    evidence_class: EvidenceClass
    values: list[EffectValue] = Field(default_factory=list)
    empty_message: str | None = Field(default=None, description="Shown when no value is in the group")
    note: str | None = None


class MaveScoreSet(Schema):
    urn: str
    title: str | None = None
    assay: str | None = Field(default=None, description="The score set's short description")
    url: str
    license: str | None = None
    num_variants: int | None = None
    published_date: str | None = None
    publications: list[dict[str, Any]] = Field(default_factory=list)
    target_name: str | None = None
    mapping: Literal["located_in_uniprot_sequence", "not_located"]
    uniprot_start: int | None = None
    uniprot_end: int | None = None
    declared_offset: int | None = Field(default=None, description="Offset as the record states it")
    covers_residue: bool
    has_calibration: bool | None = None


class ResidueContext(Schema):
    reference: str | None = Field(
        default=None, description="Residue in the sequence of the AlphaFold DB model"
    )
    plddt: float | None = None
    plddt_structure_id: str | None = None
    sequence_length: int | None = None


class ResidueEffectsResponse(Aggregated):
    protein: EntityRef
    position: int
    reference: str | None
    alternate: str | None
    variant_id: str | None
    hgvs_p: str | None
    residue: ResidueContext
    flags: list[EffectFlag]
    groups: list[EffectGroup]
    mave_score_sets: list[MaveScoreSet]
    disabled_by_license: list[EffectValue] = Field(
        description="Values withheld because their source is restricted to non-commercial use"
    )
    limitations: list[str]


class EffectMapResidue(Schema):
    position: int
    reference: str
    mean_pathogenicity: float = Field(description="Arithmetic mean over the substitutions in the file")
    min_pathogenicity: float
    max_pathogenicity: float
    substitutions: int
    likely_benign: int
    ambiguous: int
    likely_pathogenic: int


class EffectMatrix(Schema):
    alternates: str = Field(description="Column order, one-letter codes")
    scores: list[list[float | None]] = Field(description="One row per residue; null at the reference residue")
    classes: list[list[str | None]] = Field(description="Source class strings, same layout")


class EffectMapResponse(Aggregated):
    protein: EntityRef
    structure_id: str | None
    tool: str
    scale: str
    direction: EffectDirection
    class_vocabulary: dict[str, str]
    thresholds: list[EffectThreshold]
    summary_method: str
    sequence_length: int | None
    sequence_matches_model: bool | None
    flags: list[EffectFlag]
    residues: list[EffectMapResidue]
    matrix: EffectMatrix | None
    license: str | None
    limitations: list[str]
    evidence: Evidence | None
    provenance: Provenance | None
