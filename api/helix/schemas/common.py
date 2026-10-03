"""Shared API schemas. Every router and service builds its responses from these types."""

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator


class Schema(BaseModel):
    # Responses always carry every field, so the OpenAPI output schema marks defaults as required
    model_config = ConfigDict(
        from_attributes=True, use_enum_values=False, json_schema_serialization_defaults_required=True
    )


class EvidenceClass(StrEnum):
    EXPERIMENTAL = "experimental"
    CLINICAL_DATABASE = "clinical_database"
    LITERATURE = "literature"
    CURATED_DATABASE = "curated_database"
    COMPUTATIONAL_PREDICTION = "computational_prediction"
    HELIX_HYPOTHESIS = "helix_hypothesis"


EVIDENCE_CODES: dict[EvidenceClass, str] = {
    EvidenceClass.EXPERIMENTAL: "EXP",
    EvidenceClass.CLINICAL_DATABASE: "CLIN",
    EvidenceClass.LITERATURE: "LIT",
    EvidenceClass.CURATED_DATABASE: "CUR",
    EvidenceClass.COMPUTATIONAL_PREDICTION: "PRED",
    EvidenceClass.HELIX_HYPOTHESIS: "HYP",
}

EVIDENCE_LABELS: dict[EvidenceClass, str] = {
    EvidenceClass.EXPERIMENTAL: "Experimental evidence",
    EvidenceClass.CLINICAL_DATABASE: "Clinical database",
    EvidenceClass.LITERATURE: "Published literature",
    EvidenceClass.CURATED_DATABASE: "Curated database",
    EvidenceClass.COMPUTATIONAL_PREDICTION: "Computational prediction",
    EvidenceClass.HELIX_HYPOTHESIS: "Helix hypothesis",
}

# Reading order in the Inspector. A convention only: it implies no numeric weight.
EVIDENCE_DISPLAY_ORDER: list[EvidenceClass] = [
    EvidenceClass.EXPERIMENTAL,
    EvidenceClass.CLINICAL_DATABASE,
    EvidenceClass.CURATED_DATABASE,
    EvidenceClass.LITERATURE,
    EvidenceClass.COMPUTATIONAL_PREDICTION,
    EvidenceClass.HELIX_HYPOTHESIS,
]


class ClaimLabel(StrEnum):
    """Four-label view used by comparison and mechanism stages."""

    KNOWN_EXPERIMENTALLY = "known_experimentally"
    DATABASE_ANNOTATION = "database_annotation"
    COMPUTATIONAL_PREDICTION = "computational_prediction"
    HELIX_HYPOTHESIS = "helix_hypothesis"


CLAIM_LABELS: dict[EvidenceClass, ClaimLabel] = {
    EvidenceClass.EXPERIMENTAL: ClaimLabel.KNOWN_EXPERIMENTALLY,
    EvidenceClass.CLINICAL_DATABASE: ClaimLabel.DATABASE_ANNOTATION,
    EvidenceClass.CURATED_DATABASE: ClaimLabel.DATABASE_ANNOTATION,
    EvidenceClass.LITERATURE: ClaimLabel.DATABASE_ANNOTATION,
    EvidenceClass.COMPUTATIONAL_PREDICTION: ClaimLabel.COMPUTATIONAL_PREDICTION,
    EvidenceClass.HELIX_HYPOTHESIS: ClaimLabel.HELIX_HYPOTHESIS,
}


class EvidenceDirection(StrEnum):
    SUPPORTS = "supports"
    DISPUTES = "disputes"
    NEUTRAL = "neutral"


class StructureOrigin(StrEnum):
    """Three structure classes that are never presented as equivalent."""

    EXPERIMENTAL = "experimental"
    PREDICTED_EXTERNAL = "predicted_external"
    PREDICTED_INTERNAL = "predicted_internal"


STRUCTURE_ORIGIN_TAGS: dict[StructureOrigin, str] = {
    StructureOrigin.EXPERIMENTAL: "EXP",
    StructureOrigin.PREDICTED_EXTERNAL: "PRD",
    StructureOrigin.PREDICTED_INTERNAL: "OF",
}

STRUCTURE_ORIGIN_LABELS: dict[StructureOrigin, str] = {
    StructureOrigin.EXPERIMENTAL: "Experimental structure",
    StructureOrigin.PREDICTED_EXTERNAL: "Existing predicted structure",
    StructureOrigin.PREDICTED_INTERNAL: "Helix-generated prediction",
}

STRUCTURE_ID_PREFIXES: dict[StructureOrigin, tuple[str, ...]] = {
    StructureOrigin.EXPERIMENTAL: ("pdb:",),
    StructureOrigin.PREDICTED_EXTERNAL: ("afdb:",),
    StructureOrigin.PREDICTED_INTERNAL: ("of:",),
}


class SourceState(StrEnum):
    OK = "ok"
    EMPTY = "empty"
    UNAVAILABLE = "unavailable"
    DISABLED_BY_LICENSE = "disabled_by_license"
    NOT_CONFIGURED = "not_configured"


class EntityType(StrEnum):
    DISEASE = "disease"
    DISEASE_CATEGORY = "disease_category"
    GENE = "gene"
    TRANSCRIPT = "transcript"
    PROTEIN = "protein"
    VARIANT = "variant"
    RESIDUE = "residue"
    DOMAIN = "domain"
    INTERACTION = "interaction"
    PHENOTYPE = "phenotype"
    PATHWAY = "pathway"
    STRUCTURE = "structure"
    COMPOUND = "compound"
    DRUG = "drug"
    BINDING_SITE = "binding_site"
    TARGET = "target"
    PUBLICATION = "publication"
    JOB = "job"
    HYPOTHESIS = "hypothesis"
    PROJECT = "project"


_ENTITY_ROUTES: dict[EntityType, str] = {
    EntityType.DISEASE: "/disease/{id}",
    EntityType.GENE: "/gene/{id}",
    EntityType.PROTEIN: "/protein/{id}",
    EntityType.VARIANT: "/variant/{id}",
    EntityType.COMPOUND: "/compound/{id}",
    EntityType.PROJECT: "/project/{id}",
}


def entity_href(entity_type: EntityType, entity_id: str) -> str | None:
    """Web route of an entity, for the entity types that have a page."""
    route = _ENTITY_ROUTES.get(entity_type)
    return route.format(id=entity_id) if route else None


class EntityRef(Schema):
    """Pointer to an entity: URL-facing ID plus the canonical database CURIE where one exists."""

    type: EntityType
    id: str = Field(description="URL-facing ID: HGNC symbol, UniProt accession, disease slug, variant ID")
    label: str | None = None
    curie: str | None = Field(default=None, description="Canonical database ID, e.g. hgnc:1133")
    href: str | None = Field(default=None, description="Web route, when the entity has a page")

    @classmethod
    def of(
        cls, entity_type: EntityType, entity_id: str, label: str | None = None, curie: str | None = None
    ) -> Self:
        return cls(
            type=entity_type,
            id=entity_id,
            label=label,
            curie=curie,
            href=entity_href(entity_type, entity_id),
        )


class Citation(Schema):
    text: str | None = None
    title: str | None = None
    year: int | None = None
    pmid: str | None = None
    pmcid: str | None = None
    doi: str | None = None
    url: str | None = None


class Provenance(Schema):
    """Envelope recorded on every upstream fetch."""

    source: str = Field(description="Source adapter ID, e.g. uniprot")
    source_name: str
    release: str | None = Field(default=None, description="Source release; null when the source reports none")
    method: str = "GET"
    request_url: str = Field(description="Request URL with secrets removed")
    retrieved_at: datetime
    record_id: str | None = None
    record_url: str | None = Field(default=None, description="Human-facing page of the record")
    license: str | None = None
    license_url: str | None = None
    attribution: str | None = None
    response_sha256: str | None = None
    from_cache: bool = False
    stale: bool = Field(default=False, description="Served past its TTL because the source did not answer")


class SourceStatus(Schema):
    """One row per upstream source consulted for a response."""

    source: str
    name: str
    state: SourceState
    message: str | None = None
    release: str | None = None
    retrieved_at: datetime | None = None
    license: str | None = None
    url: str | None = None
    from_cache: bool = False
    stale: bool = False
    elapsed_ms: float | None = None


class EcoRef(Schema):
    id: str = Field(pattern=r"^ECO:\d{7}$")
    label: str | None = None
    assigned_by: Literal["source", "helix_mapping"]


class EvidenceStrength(Schema):
    """Source-native strength. Never merged across schemes."""

    scheme: str = Field(description="e.g. clinvar_review_status, uniprot_eco, plddt, pdb_resolution")
    value: str | float | int | None = None
    unit: str | None = None
    rank: int | None = Field(default=None, description="Order inside this scheme only")
    max_rank: int | None = None
    criteria: list[str] = Field(default_factory=list)


class SourceRecord(Schema):
    database: str
    record_id: str
    record_version: str | None = None
    release: str | None = None
    license: str | None = None
    url: str | None = None
    retrieved_at: datetime
    request: str | None = None
    response_sha256: str | None = None


class EvidenceObject(Schema):
    type: str
    value: str | float | int | bool | None = None
    id: str | None = None
    label: str | None = None
    unit: str | None = None
    context: list[dict[str, Any]] = Field(default_factory=list)


class ActorRef(Schema):
    actor_id: str
    kind: Literal["anonymous", "account", "system"]


SYSTEM_ACTOR = ActorRef(actor_id="system", kind="system")


class Authoring(Schema):
    method: Literal["human", "llm_assisted"]
    model: str | None = None


class Evidence(Schema):
    """One attributable scientific statement."""

    id: str
    evidence_class: EvidenceClass
    subject: EntityRef | None = None
    predicate: str | None = None
    object: EvidenceObject | None = None
    statement: str | None = Field(default=None, description="The claim in the source's own words")
    direction: EvidenceDirection = EvidenceDirection.SUPPORTS
    eco: EcoRef | None = None
    strength: EvidenceStrength | None = None
    source: SourceRecord | None = None
    modifiers: list[str] = Field(default_factory=list, description="e.g. manual, auto, text_mining")
    citations: list[Citation] = Field(default_factory=list)
    asserted_at: str | None = None
    structure_origin: StructureOrigin | None = None
    generated_by: str | None = Field(default=None, description="Job ID for Helix computations")
    derived_from: list[str] = Field(default_factory=list, description="Evidence or job IDs")
    created_by: ActorRef = SYSTEM_ACTOR
    authoring: Authoring | None = None
    supersedes: str | None = None

    @computed_field
    @property
    def code(self) -> str:
        return EVIDENCE_CODES[self.evidence_class]

    @computed_field
    @property
    def label(self) -> str:
        return EVIDENCE_LABELS[self.evidence_class]

    @computed_field
    @property
    def claim_label(self) -> ClaimLabel:
        return CLAIM_LABELS[self.evidence_class]

    @model_validator(mode="after")
    def _invariants(self) -> Self:
        if self.evidence_class is EvidenceClass.HELIX_HYPOTHESIS:
            if not self.derived_from:
                raise ValueError("a hypothesis must list the evidence or job IDs it rests on")
            if self.source is not None or self.eco is not None or self.strength is not None:
                raise ValueError("a hypothesis carries no source, ECO code or strength")
            if self.authoring is None:
                raise ValueError("a hypothesis must state how it was authored")
        else:
            if self.source is None or not self.source.record_id:
                raise ValueError("evidence other than a hypothesis requires a source record ID")
            if self.authoring is not None:
                raise ValueError("authoring applies to hypotheses only")
        return self


class ResidueRange(Schema):
    """Inclusive range in UniProt canonical numbering."""

    start: int
    end: int
    chain: str | None = None


class StructureCoverage(Schema):
    uniprot_accession: str | None = None
    ranges: list[ResidueRange] = Field(default_factory=list)
    covered_residues: int | None = None
    sequence_length: int | None = None
    fraction: float | None = None


class PlddtFractions(Schema):
    """Share of residues per pLDDT band (0 to 1)."""

    very_low: float
    low: float
    confident: float
    very_high: float


class ConfidenceSummary(Schema):
    plddt_mean: float | None = Field(default=None, description="Normalised to 0-100")
    plddt_native_scale: Literal["0-1", "0-100"] | None = None
    plddt_fractions: PlddtFractions | None = None
    pae_available: bool = False
    pae_max: float | None = Field(default=None, description="Cap of the PAE matrix in angstroms")
    ptm: float | None = None
    iptm: float | None = Field(default=None, description="Null for single-chain structures")
    ranking_score: float | None = None
    ranking_score_name: str | None = None
    provider_native: dict[str, Any] = Field(default_factory=dict, description="Raw provider values, verbatim")


class StructureFiles(Schema):
    cif_url: str | None = None
    bcif_url: str | None = None
    pdb_url: str | None = None
    plddt_url: str | None = None
    pae_url: str | None = None
    pae_image_url: str | None = None


class StructureDescriptor(Schema):
    """A structure of any origin. The origin is always present and always shown."""

    id: str = Field(description="pdb:<ID>, afdb:<entryId> or of:<job_id>")
    origin: StructureOrigin
    title: str | None = None
    provider: str = Field(description="Database or model provider ID, e.g. rcsb_pdb, afdb, boltz2")
    provider_name: str | None = None
    source_id: str | None = None
    source_url: str | None = None
    model_name: str | None = None
    model_version: str | None = None
    method: str | None = Field(default=None, description="Experimental method, or the tool that predicted it")
    resolution: float | None = Field(default=None, description="Angstroms; experimental structures only")
    coverage: StructureCoverage | None = None
    confidence: ConfidenceSummary | None = None
    license: str | None = None
    attribution: str | None = None
    files: StructureFiles = Field(default_factory=StructureFiles)
    created_date: date | None = Field(
        default=None, description="Deposition, model creation or inference date"
    )
    retrieved_at: datetime | None = None
    job_id: str | None = None
    limitations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provenance: Provenance | None = None

    @computed_field
    @property
    def tag(self) -> str:
        return STRUCTURE_ORIGIN_TAGS[self.origin]

    @computed_field
    @property
    def origin_label(self) -> str:
        return STRUCTURE_ORIGIN_LABELS[self.origin]

    @model_validator(mode="after")
    def _id_matches_origin(self) -> Self:
        prefixes = STRUCTURE_ID_PREFIXES[self.origin]
        if not self.id.startswith(prefixes):
            raise ValueError(f"a {self.origin.value} structure ID must start with {' or '.join(prefixes)}")
        return self


class Page[T](Schema):
    items: list[T]
    total: int
    limit: int
    offset: int

    @computed_field
    @property
    def has_more(self) -> bool:
        return self.offset + len(self.items) < self.total


class Aggregated(Schema):
    """Base for responses assembled from upstream sources: renders even when one source is down."""

    sources: list[SourceStatus] = Field(default_factory=list)


class AggregatedPage[T](Page[T]):
    sources: list[SourceStatus] = Field(default_factory=list)
