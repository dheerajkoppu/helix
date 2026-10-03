"""Literature search responses."""

from typing import Literal

from pydantic import Field

from orphafold.schemas.common import Aggregated, Evidence, Schema

LiteratureKind = Literal["all", "review", "primary"]
LiteratureSort = Literal["relevance", "cited", "date"]

RelevanceCode = Literal[
    "variant_in_title",
    "variant_in_abstract",
    "residue_in_title",
    "residue_in_abstract",
    "matched_outside_abstract",
    "uniprot_linked",
    "gene_in_title",
    "disease_in_title",
    "review",
    "highly_cited",
]


class RelevanceReason(Schema):
    """One rule that fired for a publication. Rules are fixed string and count checks; no model."""

    code: RelevanceCode
    label: str
    detail: str | None = Field(default=None, description="The matched text or the count behind the rule")


class LiteraturePublication(Schema):
    pmid: str | None = None
    pmcid: str | None = None
    doi: str | None = None
    title: str
    journal: str | None = None
    journal_abbreviation: str | None = None
    year: int | None = None
    published: str | None = Field(default=None, description="First publication date, ISO")
    authors: list[str] = Field(default_factory=list)
    author_string: str | None = None
    abstract: str | None = Field(default=None, description="Null when Europe PMC holds no abstract")
    is_open_access: bool | None = None
    license: str | None = Field(default=None, description="Article licence as Europe PMC reports it")
    cited_by_count: int | None = Field(default=None, description="Europe PMC citation count")
    publication_types: list[str] = Field(default_factory=list)
    is_review: bool = False
    url: str | None = Field(default=None, description="Europe PMC record page")
    pubmed_url: str | None = None
    doi_url: str | None = None
    full_text_url: str | None = None
    relevance: list[RelevanceReason] = Field(default_factory=list)
    evidence: Evidence | None = None


class LiteratureContext(Schema):
    """What the request resolved to, so the interface can state what was searched."""

    gene: str | None = None
    disease: str | None = None
    disease_name: str | None = None
    variant: str | None = None
    variant_terms: list[str] = Field(default_factory=list)
    accession: str | None = None
    residue: str | None = None
    residue_terms: list[str] = Field(default_factory=list)
    q: str | None = None
    kind: LiteratureKind = "all"
    sort: LiteratureSort = "relevance"


class LiteratureResponse(Aggregated):
    items: list[LiteraturePublication] = Field(default_factory=list)
    total: int | None = Field(default=None, description="Hits upstream; null when the source did not answer")
    page: int = 1
    page_size: int = 25
    has_more: bool = False
    query: str | None = Field(default=None, description="The Europe PMC query that was run, verbatim")
    query_url: str | None = Field(default=None, description="The same search on europepmc.org")
    context: LiteratureContext
    notes: list[str] = Field(default_factory=list)
    highly_cited_threshold: int


class LiteratureRecordResponse(Aggregated):
    publication: LiteraturePublication | None = None
