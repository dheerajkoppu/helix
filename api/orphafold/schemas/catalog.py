"""Schemas for the catalog-backed endpoints: /meta, /health, /explore."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from orphafold.knowledge.catalog import CatalogCounts, CatalogState, CatalogStatus, SeedCounts, SeedSource
from orphafold.schemas.common import AggregatedPage, Schema, SourceStatus


class ExploreSort(StrEnum):
    RELEVANCE = "relevance"
    SYMBOL = "symbol"
    NAME = "name"
    PATHOGENIC_VARIANTS = "pathogenic_variants"
    TOTAL_VARIANTS = "total_variants"
    PUBLICATIONS = "publications"
    EXPERIMENTAL_STRUCTURES = "experimental_structures"
    PROTEIN_LENGTH = "protein_length"


class SortOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


class VariantMetric(StrEnum):
    PATHOGENIC = "pathogenic"
    TOTAL = "total"


class StructureAvailability(StrEnum):
    EXPERIMENTAL = "experimental"
    PREDICTED = "predicted"
    NONE = "none"
    UNKNOWN = "unknown"


class ExploreDisease(Schema):
    id: str
    name: str
    category_id: str | None = None
    subcategory_id: str | None = None
    inheritance_codes: list[str] = Field(default_factory=list)
    is_phenocopy: bool = False


class ExploreGeneStats(Schema):
    """Source-native counts. Null means the source had no value."""

    experimental_structure_count: int | None = None
    has_alphafold_model: bool | None = None
    clinvar_pathogenic_count: int | None = None
    clinvar_total_count: int | None = None
    publication_count: int | None = None
    retrieved_at: str | None = None


class ExploreGene(Schema):
    symbol: str
    hgnc_id: str | None = None
    name: str | None = None
    chromosome: str | None = None
    uniprot_accession: str | None = None
    protein_name: str | None = None
    protein_length: int | None = None
    protein_family: str | None = None
    category_ids: list[str] = Field(default_factory=list)
    subcategory_ids: list[str] = Field(default_factory=list)
    inheritance_codes: list[str] = Field(default_factory=list)
    diseases: list[ExploreDisease] = Field(default_factory=list)
    stats: ExploreGeneStats
    is_flagship: bool = False
    href: str


class FacetValue(Schema):
    value: str
    label: str
    count: int
    parent: str | None = None
    table: int | None = None


class NumericRange(Schema):
    """Bounds over the whole catalog, for range controls. Null when no gene has a value."""

    min: int | None = None
    max: int | None = None
    known: int = Field(description="Genes for which the source reported a value")


class ExploreFacets(Schema):
    """Counts per facet value, each computed with every other active filter applied."""

    category: list[FacetValue] = Field(default_factory=list)
    subcategory: list[FacetValue] = Field(default_factory=list)
    inheritance: list[FacetValue] = Field(default_factory=list)
    protein_family: list[FacetValue] = Field(default_factory=list)
    structure: list[FacetValue] = Field(default_factory=list)


class ExploreRanges(Schema):
    pathogenic_variants: NumericRange
    total_variants: NumericRange
    publications: NumericRange


class ExploreFacetsResponse(Schema):
    facets: ExploreFacets
    ranges: ExploreRanges
    total: int = Field(description="Genes matching the active filters")
    catalog_state: CatalogState
    sources: list[SourceStatus] = Field(default_factory=list)


class ExploreGenesResponse(AggregatedPage[ExploreGene]):
    sort: ExploreSort
    order: SortOrder
    facets: ExploreFacets
    ranges: ExploreRanges
    catalog_state: CatalogState


class DatasetInfo(Schema):
    id: str | None = None
    citation: str | None = None
    doi: str | None = None
    generated_at: str | None = None
    declared_counts: SeedCounts = Field(description="Counts stated in the seed manifest")
    loaded_counts: CatalogCounts = Field(description="Counts of records actually loaded")


class EnumEntry(Schema):
    value: str
    code: str
    label: str
    extra: dict[str, Any] = Field(default_factory=dict)


class Features(Schema):
    noncommercial_sources_enabled: bool
    assistant_configured: bool
    ncbi_api_key_configured: bool
    boltz_configured: bool
    msa_server_configured: bool
    job_queue: str
    artifact_store: str
    database: str


class MetaResponse(Schema):
    name: str
    version: str
    api_prefix: str
    license: str
    research_use_notice: str
    dataset: DatasetInfo
    catalog: CatalogStatus
    seed_sources: list[SeedSource] = Field(description="Release, license and checksum of each seeded source")
    live_sources: list[SourceStatus] = Field(description="Source adapters and whether each is enabled")
    features: Features
    evidence_classes: list[EnumEntry]
    structure_origins: list[EnumEntry]
    job_kinds: list[str]
    providers: list[str]


class HealthResponse(Schema):
    status: str = Field(description="ok, or degraded when the database is unreachable")
    version: str
    time: datetime
    database: str
    catalog: CatalogState
    data_release: str | None = Field(
        default=None, description="Seeded dataset ID and build date, e.g. iuis_2024 2026-10-03"
    )
    job_queue: str
    worker: str
    load_errors: dict[str, str] = Field(
        default_factory=dict, description="Plugin modules that failed to import"
    )
