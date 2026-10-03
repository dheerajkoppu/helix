"""Schemas of GET /search: typed, grouped results of entity resolution."""

from enum import StrEnum

from pydantic import Field

from orphafold.schemas.common import Aggregated, EvidenceClass, Schema, StructureOrigin


class SearchResultType(StrEnum):
    GENE = "gene"
    PROTEIN = "protein"
    DISEASE = "disease"
    VARIANT = "variant"
    STRUCTURE = "structure"
    COMPOUND = "compound"
    PAPER = "paper"
    PROJECT = "project"


SEARCH_GROUP_LABELS: dict[SearchResultType, str] = {
    SearchResultType.GENE: "Genes",
    SearchResultType.PROTEIN: "Proteins",
    SearchResultType.DISEASE: "Diseases",
    SearchResultType.VARIANT: "Variants",
    SearchResultType.STRUCTURE: "Structures",
    SearchResultType.COMPOUND: "Compounds",
    SearchResultType.PAPER: "Papers",
    SearchResultType.PROJECT: "Projects",
}


class MatchKind(StrEnum):
    """How the query reached the result, from strongest to weakest."""

    IDENTIFIER = "identifier"
    EXACT = "exact"
    ALIAS = "alias"
    PREFIX = "prefix"
    TOKEN = "token"
    FUZZY = "fuzzy"
    RELATED = "related"
    LIVE = "live"


class SearchIdentifier(Schema):
    source: str = Field(description="Database that owns the identifier, e.g. HGNC, UniProt, MONDO")
    id: str
    url: str | None = None


class StructureAvailability(Schema):
    """Source-native structure counts from the seed. Null means the lookup had no answer."""

    experimental_count: int | None = Field(default=None, description="Distinct PDB entries in PDBe SIFTS")
    has_alphafold_model: bool | None = None


class SearchResult(Schema):
    type: SearchResultType
    id: str = Field(description="URL-facing ID of the entity")
    label: str
    description: str | None = None
    match: MatchKind
    match_reason: str = Field(description="Why this row answers the query, in words")
    matched_text: str | None = Field(default=None, description="The name, alias or ID that matched")
    href: str | None = Field(default=None, description="Web route to open; null when there is no page")
    external_url: str | None = Field(default=None, description="Record at the owning database")
    ids: list[SearchIdentifier] = Field(default_factory=list)
    in_catalog: bool = Field(description="False for an entity outside the seeded IEI catalog")
    source: str = Field(description="Source ID the row was read from, e.g. orphafold_seed, uniprot")
    evidence_class: EvidenceClass | None = None
    gene_symbol: str | None = None
    accession: str | None = None
    structures: StructureAvailability | None = None
    origin: StructureOrigin | None = Field(default=None, description="Structure rows only")
    count: int | None = Field(default=None, description="Structure rows that stand for a set of entries")


class SearchGroup(Schema):
    type: SearchResultType
    label: str
    total: int = Field(description="Matches before the per-group limit")
    results: list[SearchResult]


class ParsedIdentifier(Schema):
    """What the local parser recognised in the query before any lookup."""

    kind: str = Field(description="e.g. uniprot_accession, hgnc_id, clinvar_vcv, rsid, protein_change")
    value: str
    description: str


class SearchResponse(Aggregated):
    query: str
    parsed: list[ParsedIdentifier]
    groups: list[SearchGroup]
    top: SearchResult | None = Field(default=None, description="The row Enter opens")
    total: int
    outside_catalog: bool = Field(description="True when the answer came only from outside the IEI catalog")
    took_ms: float
