"""Response schemas of the variant endpoints."""

from typing import Literal

from pydantic import Field

from helix.schemas.common import Aggregated, AggregatedPage, EntityRef, Evidence, Schema

SignificanceKey = Literal[
    "pathogenic",
    "likely_pathogenic",
    "uncertain_significance",
    "likely_benign",
    "benign",
    "conflicting",
    "other",
    "not_classified",
]


class VariantHgvs(Schema):
    """HGVS expressions as the sources wrote them. Versioned references only."""

    c: str | None = Field(default=None, description="Transcript level, e.g. NM_000061.3:c.1574G>A")
    p: str | None = Field(default=None, description="Protein level, three-letter, e.g. p.Arg525Gln")
    g: str | None = Field(default=None, description="Genomic, GRCh38, when a source provides it")
    transcript: str | None = None
    spdi: str | None = Field(default=None, description="ClinVar canonical SPDI (0-based)")


class VariantCondition(Schema):
    name: str
    xrefs: list["CrossReference"] = Field(default_factory=list)


class CrossReference(Schema):
    db: str
    id: str
    url: str | None = None


class VariantSummary(Schema):
    """One row of a gene's variant table: a ClinVar record, a UniProt natural variant, or both."""

    id: str = Field(description="GENE-p.Ref3PosAlt3 for single-residue changes, ClinVar VCV otherwise")
    row_key: str = Field(description="Unique per row. Two ClinVar records can share one protein change")
    gene_symbol: str
    name: str | None = Field(default=None, description="ClinVar title, or the UniProt feature ID")
    protein_change: str | None = Field(default=None, description="Three-letter, e.g. p.Arg28His")
    protein_change_short: str | None = Field(default=None, description="One-letter, e.g. R28H")
    position: int | None = Field(default=None, description="UniProt canonical residue number")
    end_position: int | None = None
    reference_residue: str | None = Field(default=None, description="One-letter code")
    alternate_residue: str | None = Field(default=None, description="One-letter code, * for stop")
    change_kind: str | None = None
    reference_matches_uniprot: bool | None = Field(
        default=None,
        description=(
            "Reference residue confirmed on the UniProt canonical sequence. False: the residue differs "
            "or the record is numbered on another isoform, so no position is given. Null: not checked"
        ),
    )
    consequence: str | None = Field(default=None, description="Primary molecular consequence term")
    consequences: list[str] = Field(default_factory=list)
    variant_type: str | None = None
    hgvs: VariantHgvs = Field(default_factory=VariantHgvs)
    clinical_significance: str | None = Field(
        default=None, description="ClinVar germline classification, in ClinVar's words"
    )
    significance_keys: list[SignificanceKey] = Field(default_factory=list)
    review_status: str | None = None
    review_stars: int | None = Field(default=None, ge=0, le=4)
    last_evaluated: str | None = None
    conditions: list[VariantCondition] = Field(default_factory=list)
    vcv: str | None = None
    vcv_version: str | None = None
    variation_id: str | None = None
    rsid: str | None = None
    in_clinvar: bool = False
    in_uniprot: bool = False
    uniprot_feature_id: str | None = None
    href: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class CountRow(Schema):
    value: str = Field(description="The term as the source writes it")
    keys: list[str] = Field(default_factory=list, description="Filter keys this row answers to")
    count: int


class VariantCounts(Schema):
    """Counts over every loaded variant of the gene, before filters."""

    total: int
    clinvar_records: int
    clinvar_gene_total: int | None = Field(
        default=None, description="Records ClinVar lists for the gene, when more than were loaded"
    )
    uniprot_curated: int
    uniprot_only: int
    uniprot_not_listed: int = Field(
        default=0, description="UniProt variants that are not single-residue changes and are left out"
    )
    pathogenic_or_likely_pathogenic: int
    with_protein_position: int
    by_significance: list[CountRow]
    by_consequence: list[CountRow]
    by_review_stars: list[CountRow]


class VariantFilters(Schema):
    significance: list[str]
    consequence: list[str]
    min_stars: int | None
    residue_start: int | None
    residue_end: int | None
    q: str | None
    sort: str


class GeneVariantsResponse(AggregatedPage[VariantSummary]):
    gene: EntityRef
    protein: EntityRef | None = None
    summary: VariantCounts
    filters: VariantFilters
    clinvar_release: str | None = Field(default=None, description="Date of the ClinVar build queried")
    truncated: bool = Field(
        default=False,
        description="True when only pathogenic and likely pathogenic ClinVar records were loaded",
    )


class ClinVarSubmission(Schema):
    scv: str | None = None
    version: str | None = None
    submitter: str | None = None
    classification: str | None = None
    review_status: str | None = None
    last_evaluated: str | None = None
    date_updated: str | None = None
    method: str | None = None
    origins: list[str] = Field(default_factory=list)
    contributes_to_aggregate: bool = False
    pmids: list[str] = Field(default_factory=list)


class SubmissionSummary(Schema):
    scv_count: int
    rcv_count: int
    scv_accessions: list[str] = Field(default_factory=list)
    rcv_accessions: list[str] = Field(default_factory=list)
    submissions_loaded: bool = Field(
        default=False, description="False when the submitter-level record could not be read"
    )
    by_classification: list[CountRow] = Field(default_factory=list)
    submissions: list[ClinVarSubmission] = Field(default_factory=list)


class ClinVarRecord(Schema):
    vcv: str | None = None
    vcv_version: str | None = None
    variation_id: str
    title: str | None = None
    variant_type: str | None = None
    classification: str | None = None
    significance_keys: list[SignificanceKey] = Field(default_factory=list)
    review_status: str | None = None
    review_stars: int | None = None
    last_evaluated: str | None = None
    conditions: list[VariantCondition] = Field(default_factory=list)
    consequences: list[str] = Field(default_factory=list)
    oncogenicity_classification: str | None = None
    clinical_impact_classification: str | None = None
    rsid: str | None = None
    hgvs_c: str | None = None
    protein_changes: list[str] = Field(
        default_factory=list, description="Protein changes on every isoform, as ClinVar lists them"
    )
    spdi: str | None = None
    url: str | None = None
    submission_summary: SubmissionSummary | None = None
    evidence: Evidence | None = None


class UniProtAssociation(Schema):
    name: str
    is_disease: bool = False
    xrefs: list[CrossReference] = Field(default_factory=list)
    pmids: list[str] = Field(default_factory=list)


class UniProtVariantAnnotation(Schema):
    feature_id: str | None = None
    accession: str
    position: int | None = None
    wild_type: str | None = None
    mutated_type: str | None = None
    consequence: str | None = None
    source_type: str | None = Field(default=None, description="uniprot (curated) or mixed")
    descriptions: list[str] = Field(default_factory=list)
    associations: list[UniProtAssociation] = Field(default_factory=list)
    eco_codes: list[str] = Field(default_factory=list)
    pmids: list[str] = Field(default_factory=list)
    hgvs_g: list[str] = Field(default_factory=list)
    url: str | None = None
    evidence: Evidence | None = None


class GnomadFrequency(Schema):
    allele_count: int | None = None
    allele_number: int | None = None
    allele_frequency: float | None = None
    homozygote_count: int | None = None
    hemizygote_count: int | None = None
    filters: list[str] = Field(default_factory=list)


class GnomadAllele(Schema):
    variant_id: str
    hgvsc: str | None = None
    hgvsp: str | None = None
    consequence: str | None = None
    transcript_id: str | None = None
    rsids: list[str] = Field(default_factory=list)
    flags: list[str] = Field(default_factory=list)
    exome: GnomadFrequency | None = Field(default=None, description="Null: not seen in exomes")
    genome: GnomadFrequency | None = Field(default=None, description="Null: not seen in genomes")
    url: str | None = None
    evidence: Evidence | None = None


class GnomadObservation(Schema):
    """Presence in gnomAD. Absence is 'not_observed', never an allele frequency of zero."""

    status: Literal["observed", "not_observed", "unknown"]
    label: str
    dataset: str
    matched_by: Literal["clinvar_variation_id", "genomic_position", "protein_change"] | None = None
    x_linked: bool | None = Field(default=None, description="True: read the hemizygote count")
    alleles: list[GnomadAllele] = Field(default_factory=list)


class ReferenceCheckResult(Schema):
    status: Literal["match", "mismatch", "out_of_range", "not_checked"]
    accession: str | None = None
    position: int | None = None
    expected: str | None = Field(default=None, description="Reference residue of the variant")
    found: str | None = Field(default=None, description="Residue in the UniProt canonical sequence")
    sequence_length: int | None = None
    message: str | None = None


class VrsIdentifier(Schema):
    id: str | None = Field(default=None, description="GA4GH VRS 2.x Allele ID, ga4gh:VA.*")
    level: Literal["protein"] = "protein"
    sequence_accession: str | None = Field(default=None, description="refget accession of the sequence")
    reference: str | None = Field(default=None, description="Sequence the digest was computed on")
    method: str | None = None
    message: str | None = None


class VepConsequence(Schema):
    """Ensembl VEP prediction for the transcript-level HGVS of the ClinVar record."""

    input: str | None = None
    most_severe_consequence: str | None = None
    variant_class: str | None = None
    transcript_id: str | None = None
    mane_select: str | None = None
    is_mane_select: bool = False
    consequence_terms: list[str] = Field(default_factory=list)
    impact: str | None = None
    hgvsc: str | None = None
    hgvsp: str | None = None
    exon: str | None = None
    intron: str | None = None
    protein_start: int | None = None
    amino_acids: str | None = None
    codons: str | None = None
    assembly: str | None = None
    chromosome: str | None = None
    start: int | None = None
    end: int | None = None
    evidence: Evidence | None = None


class VariantDetail(Aggregated):
    id: str
    query: str
    resolved_from: Literal["vcv", "rsid", "variation_id", "protein"]
    gene: EntityRef
    protein: EntityRef | None = None
    name: str | None = None
    protein_change: str | None = None
    protein_change_short: str | None = None
    position: int | None = None
    end_position: int | None = None
    reference_residue: str | None = None
    alternate_residue: str | None = None
    change_kind: str | None = None
    consequence: str | None = None
    hgvs: VariantHgvs = Field(default_factory=VariantHgvs)
    clinvar: ClinVarRecord | None = None
    clinvar_message: str | None = Field(
        default=None, description="Why clinvar is null: no record found, or the source did not answer"
    )
    other_clinvar_records: list[ClinVarRecord] = Field(
        default_factory=list,
        description="Other ClinVar records with the same protein change (different nucleotide change)",
    )
    clinvar_release: str | None = None
    uniprot: UniProtVariantAnnotation | None = None
    gnomad: GnomadObservation
    vep: VepConsequence | None = None
    reference_check: ReferenceCheckResult
    vrs: VrsIdentifier
    cross_references: list[CrossReference] = Field(default_factory=list)


VariantCondition.model_rebuild()
