"""Schemas of the reference-versus-variant comparison: construct, difference payload, job result
and the two /compare responses. Residue positions are UniProt canonical everywhere."""

import warnings
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from orphafold.schemas.common import (
    Aggregated,
    Citation,
    ConfidenceSummary,
    EntityRef,
    ResidueRange,
    Schema,
    StructureDescriptor,
)

# "construct" is the domain term; it only hides pydantic's deprecated BaseModel.construct alias
warnings.filterwarnings("ignore", message='Field name "construct" in ".*" shadows an attribute')

DIFFERENCE_SCHEMA_VERSION = "1.0"
COMPARISON_TITLE = "Reference and variant models (predicted)"
GEOMETRY_LABEL = "computed from predicted model"


class ComparisonVariant(Schema):
    variant_id: str | None = Field(description="GENE-p.Ref3PosAlt3; null without a gene symbol")
    gene_symbol: str | None = None
    uniprot_accession: str | None = None
    position: int = Field(description="UniProt canonical position")
    reference: str = Field(description="One-letter reference residue")
    alternate: str = Field(description="One-letter variant residue")
    hgvs_p: str
    short: str


class ConstructDomain(Schema):
    name: str
    start: int
    end: int
    source: str = "UniProt feature of type Domain"


class ComparisonConstruct(Schema):
    """The residue range that was, or would be, submitted to the model. Both models of a
    comparison use the same construct."""

    uniprot_accession: str | None = None
    start: int
    end: int
    length: int
    protein_length: int
    full_length: bool
    rule: Literal["full_length", "uniprot_domain", "centred_window", "user_window"]
    rationale: str
    domain: ConstructDomain | None = None
    flank: int | None = Field(default=None, description="Residues added on each side of the domain")
    max_residues: int | None = Field(default=None, description="Provider limit the construct was fitted to")


class CachedOrigin(Schema):
    """Where a cached example came from: the real run that produced it."""

    provider_id: str
    provider_name: str | None = None
    model_name: str | None = None
    model_version: str | None = None
    job_id: str
    generated_at: datetime
    label: str


class ComparisonProvider(Schema):
    id: str
    name: str
    model_name: str | None = None
    model_version: str | None = None
    execution_mode: str
    performs_inference: bool
    deterministic: bool | None = Field(
        default=None, description="True when the model has no seed; null when not stated by the provider"
    )
    cached_from: CachedOrigin | None = None


class ComparisonCaveat(Schema):
    id: str
    text: str
    quoted_from: str | None = Field(default=None, description="Set when the text is a verbatim quotation")
    citations: list[Citation] = Field(default_factory=list)


class ComparisonModel(Schema):
    role: Literal["reference", "variant"]
    structure_id: str
    file: str = Field(description="Artifact name of the mmCIF file")
    sequence_sha256: str
    residues: int
    plddt_mean: float


class RigidTransform(Schema):
    """x' = rotation . x + translation, applied to the variant model to place it on the reference."""

    rotation: list[list[float]]
    translation: list[float]
    applies_to: Literal["variant"] = "variant"


class Superposition(Schema):
    method: str
    atoms: Literal["C-alpha"] = "C-alpha"
    scope_rule: Literal["confident_in_both", "all_residues"]
    scope: str = Field(description="Which residues the fit used, in words")
    residues_used: int
    rmsd: float = Field(description="Angstroms, over the residues the fit used")
    transform: RigidTransform


class GlobalDifference(Schema):
    rmsd_ca_all: float = Field(description="Angstroms, every residue of the construct")
    residues_all: int
    rmsd_ca_confident: float | None = Field(
        default=None, description="Angstroms, residues with pLDDT of at least the threshold in both models"
    )
    residues_confident: int


class LocalDifference(Schema):
    radius: float
    centre_position: int
    scope: str
    residues: int
    rmsd_ca_global_fit: float | None = Field(default=None, description="After the construct-wide fit")
    rmsd_ca_local_fit: float | None = Field(default=None, description="After a fit on these residues only")


class SiteConfidence(Schema):
    """pLDDT of each model at the substituted residue. The two values are shown side by side as
    model output; no difference between them is reported."""

    position: int
    plddt_reference: float
    plddt_variant: float
    band_reference: Literal["very_low", "low", "confident", "very_high"]
    band_variant: Literal["very_low", "low", "confident", "very_high"]
    confident_in_both: bool
    ca_displacement: float | None = Field(default=None, description="Angstroms; null when the site is masked")


class SiteContact(Schema):
    position: int
    residue: str = Field(description="One-letter residue at the partner position")
    min_distance: float = Field(description="Angstroms, closest pair of heavy atoms")
    site_atom: str
    partner_atom: str
    plddt: float = Field(description="pLDDT of the partner residue in this model")


class ContactChanges(Schema):
    cutoff: float
    atoms: Literal["heavy"] = "heavy"
    exclusion: str
    label: str
    reference: list[SiteContact] = Field(description="Contacts of the site in the reference model")
    variant: list[SiteContact] = Field(description="Contacts of the site in the variant model")
    gained: list[int] = Field(description="Positions in contact in the variant model only")
    lost: list[int] = Field(description="Positions in contact in the reference model only")
    kept: list[int]
    low_confidence_positions: list[int] = Field(
        description="Listed positions where either model is below the pLDDT threshold"
    )


class NeighbourResidue(Schema):
    position: int
    residue: str
    ca_distance_reference: float
    ca_distance_variant: float
    within_reference: bool
    within_variant: bool
    plddt_reference: float
    plddt_variant: float
    masked: bool


class Neighbourhood(Schema):
    radius: float
    atoms: Literal["C-alpha"] = "C-alpha"
    label: str
    residues: list[NeighbourResidue]


class Masking(Schema):
    plddt_threshold: float
    rule: str
    masked_residues: int
    total_residues: int
    masked_ranges: list[ResidueRange]


class ResidueDifference(Schema):
    position: int
    reference_residue: str
    variant_residue: str
    plddt_reference: float
    plddt_variant: float
    masked: bool
    ca_displacement: float | None = Field(default=None, description="Angstroms; null when masked")


class ResidueProperties(Schema):
    residue: str
    name: str
    volume_a3: float
    volume_class: str
    charge_class: str
    polarity_class: str
    hydropathy: float


class PropertyChange(Schema):
    """Side-chain properties of the two residues from published tables. A property of the amino
    acids, not a measurement on this protein."""

    reference: ResidueProperties
    variant: ResidueProperties
    volume_change_a3: float
    hydropathy_change: float
    charge_changed: bool
    polarity_changed: bool
    volume_class_changed: bool
    sources: list[Citation]


class DifferenceSummary(Schema):
    """The scalar measurements of a comparison, for listings."""

    rmsd_ca_all: float
    rmsd_ca_confident: float | None = None
    residues_confident: int
    local_rmsd_ca: float | None = None
    plddt_site_reference: float
    plddt_site_variant: float
    contacts_gained: int
    contacts_lost: int
    masked_residues: int
    total_residues: int


class DifferencePayload(Schema):
    """difference.json: geometry computed from two predicted models of the same construct."""

    schema_version: str = DIFFERENCE_SCHEMA_VERSION
    title: str = COMPARISON_TITLE
    geometry_label: str = GEOMETRY_LABEL
    numbering: Literal["uniprot_canonical"] = "uniprot_canonical"
    generated_at: datetime
    job_id: str | None = None
    variant: ComparisonVariant
    construct: ComparisonConstruct
    provider: ComparisonProvider
    models: list[ComparisonModel]
    superposition: Superposition
    global_difference: GlobalDifference
    local_difference: LocalDifference
    site: SiteConfidence
    contacts: ContactChanges
    neighbours: Neighbourhood
    masking: Masking
    per_residue: list[ResidueDifference]
    property_change: PropertyChange
    summary: DifferenceSummary
    caveats: list[ComparisonCaveat]
    software: dict[str, str] = Field(default_factory=dict)


class ComparisonJobResult(Schema):
    """JobOut.result of a variant_comparison job."""

    title: str = COMPARISON_TITLE
    performs_inference: bool
    variant_id: str | None = None
    gene_symbol: str | None = None
    variant: ComparisonVariant
    construct: ComparisonConstruct
    provider: ComparisonProvider
    reference_model: StructureDescriptor
    variant_model: StructureDescriptor
    difference_url: str
    summary: DifferenceSummary
    caveats: list[ComparisonCaveat]


class ReferenceCheck(Schema):
    state: Literal["match", "mismatch", "out_of_range", "unknown"]
    expected: str = Field(description="Reference residue the variant names")
    found: str | None = Field(default=None, description="Residue at that position in the UniProt sequence")
    message: str


class ProviderOption(Schema):
    """One registered structure predictor and whether it can run this comparison here."""

    id: str
    name: str
    model_name: str | None = None
    model_version: str | None = None
    execution_mode: str
    performs_inference: bool
    deterministic: bool | None = None
    max_residues: int | None = None
    available: bool
    can_run: bool
    reasons: list[str] = Field(description="Why it cannot run; empty when it can")
    construct: ComparisonConstruct | None = None
    job_params: dict[str, Any] | None = Field(
        default=None, description="Body params for POST /api/v1/jobs with kind variant_comparison"
    )


class ComparisonResultSummary(Schema):
    result_id: str = Field(description="Job ID; pass it to GET /api/v1/compare/results/{job_id}")
    origin: Literal["job", "cached_example"]
    label: str
    provider: ComparisonProvider
    construct: ComparisonConstruct
    summary: DifferenceSummary
    generated_at: datetime | None = None
    result_url: str
    manifest_url: str | None = None


class ComparePlanResponse(Aggregated):
    title: str = COMPARISON_TITLE
    variant: ComparisonVariant
    gene: EntityRef
    protein: EntityRef | None = None
    protein_length: int | None = None
    reference_check: ReferenceCheck
    property_change: PropertyChange | None = None
    proposed_construct: ComparisonConstruct | None = None
    domains: list[ConstructDomain] = Field(default_factory=list)
    providers: list[ProviderOption]
    results: list[ComparisonResultSummary]
    job_kind: str = "variant_comparison"
    caveats: list[ComparisonCaveat]


class ComparisonConfidence(Schema):
    reference: ConfidenceSummary | None = None
    variant: ConfidenceSummary | None = None
    site: SiteConfidence


class CompareResultResponse(Schema):
    job_id: str
    title: str = COMPARISON_TITLE
    origin: Literal["job", "cached_example"]
    label: str
    cached_from: CachedOrigin | None = None
    performs_inference: bool
    variant: ComparisonVariant
    construct: ComparisonConstruct
    provider: ComparisonProvider
    reference_model: StructureDescriptor
    variant_model: StructureDescriptor
    difference: DifferencePayload
    difference_url: str
    confidence: ComparisonConfidence
    manifest_url: str | None = None
    generated_at: datetime | None = None
    caveats: list[ComparisonCaveat]
