"""Schemas for /genes."""

from pydantic import Field

from orphafold.schemas.common import Aggregated, EntityRef, Evidence, Provenance, Schema
from orphafold.schemas.proteins import TextAnnotation


class RecordSource(Schema):
    """Where a seeded value came from: the seed source and the record inside it."""

    source_id: str
    name: str | None = None
    record_id: str | None = None
    url: str | None = None
    release: str | None = None
    license: str | None = None
    retrieved_at: str | None = None


class GeneStatistic(Schema):
    """One single-source count with its definition. A null value means the source had none."""

    key: str
    label: str
    value: int | bool | None = None
    definition: str
    retrieved_at: str | None = None
    source: RecordSource | None = None


class GeneDiseaseTerm(Schema):
    id: str
    label: str | None = None


class GeneDisease(Schema):
    """One IUIS entry naming the gene."""

    id: str
    name: str
    href: str
    category_id: str | None = None
    category_name: str | None = None
    category_table: int | None = None
    subcategory_id: str | None = None
    subcategory_name: str | None = None
    inheritance_raw: str | None = Field(default=None, description="The IUIS inheritance string")
    inheritance_codes: list[str] = Field(default_factory=list)
    inheritance_terms: list[GeneDiseaseTerm] = Field(default_factory=list)
    mechanism: list[str] = Field(default_factory=list, description="As stated by IUIS; empty when IUIS states none")
    is_phenocopy: bool = False
    mondo: list[str] = Field(default_factory=list)
    orphanet: list[str] = Field(default_factory=list)
    omim: list[str] = Field(default_factory=list)
    sources: list[RecordSource] = Field(default_factory=list)


class Transcript(Schema):
    id: str = Field(description="Unversioned Ensembl transcript ID")
    version: int | None = None
    display_name: str | None = None
    biotype: str | None = None
    is_canonical: bool = False
    is_mane_select: bool = False
    is_mane_plus_clinical: bool = False
    refseq_transcript: str | None = Field(default=None, description="RefSeq match of the MANE annotation")
    refseq_protein: str | None = None
    length: int | None = Field(default=None, description="Spliced transcript length in bases")
    exon_count: int | None = None
    start: int | None = None
    end: int | None = None
    protein_id: str | None = Field(default=None, description="Unversioned Ensembl protein ID")
    protein_version: int | None = None
    protein_length: int | None = None
    url: str | None = None
    evidence: Evidence | None = None


class GeneTranscripts(Schema):
    mane_select: Transcript | None = None
    mane_plus_clinical: list[Transcript] = Field(default_factory=list)
    others: list[Transcript] = Field(default_factory=list)
    total: int | None = Field(default=None, description="Transcripts Ensembl lists; null when Ensembl did not answer")


class GenomicLocation(Schema):
    assembly: str | None = None
    chromosome: str | None = None
    start: int | None = None
    end: int | None = None
    strand: int | None = None


class GeneProteinSummary(Schema):
    protein: EntityRef
    accession: str
    entry_name: str | None = None
    name: str | None = None
    reviewed: bool | None = None
    length: int | None = None
    mass_da: int | None = None
    family: str | None = Field(default=None, description="UniProt 'Belongs to the ...' statement")
    function: list[TextAnnotation] = Field(default_factory=list)
    isoform_count: int | None = None
    provenance: Provenance | None = None


class GeneResponse(Aggregated):
    gene: EntityRef
    symbol: str
    in_catalog: bool = Field(description="False for a gene outside the IEI catalog, resolved live")
    is_flagship: bool = False
    hgnc_id: str | None = None
    name: str | None = None
    locus_type: str | None = None
    biotype: str | None = None
    chromosome: str | None = None
    location: GenomicLocation | None = None
    ensembl_gene_id: str | None = None
    ensembl_gene_version: int | None = None
    ncbi_gene_id: str | None = None
    uniprot_accession: str | None = None
    statistics: list[GeneStatistic] = Field(default_factory=list)
    diseases: list[GeneDisease] = Field(default_factory=list)
    transcripts: GeneTranscripts
    protein: GeneProteinSummary | None = None
    record_sources: list[RecordSource] = Field(
        default_factory=list, description="Seed records behind the catalog fields"
    )
    ensembl_provenance: Provenance | None = None
