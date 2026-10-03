"""Schemas of the disease bundle, the disease browse list and target treatments."""

from typing import Literal

from pydantic import Field

from orphafold.schemas.common import Aggregated, AggregatedPage, EntityRef, Evidence, Schema
from orphafold.schemas.genes import RecordSource


class TreatmentMechanism(Schema):
    mechanism: str | None = None
    action_type: str | None = None
    target_name: str | None = None
    reference_urls: list[str] = Field(default_factory=list)


class TreatmentIndication(Schema):
    id: str | None = None
    name: str | None = None
    from_source: str | None = Field(default=None, description="Indication as the source report words it")


class ClinicalReport(Schema):
    id: str | None = None
    source: str | None = None
    url: str | None = None
    clinical_stage: str | None = None
    title: str | None = None
    type: str | None = None
    year: int | None = None


class Treatment(Schema):
    """A drug or clinical candidate as Open Targets records it. No ranking is implied."""

    drug_id: str = Field(description="ChEMBL ID")
    name: str | None = None
    drug: EntityRef
    modality: str | None = Field(default=None, description="Open Targets drugType, verbatim")
    is_small_molecule: bool = False
    clinical_stage: str | None = Field(
        default=None, description="Open Targets maxClinicalStage for this pairing, verbatim"
    )
    clinical_stage_label: str | None = None
    drug_max_clinical_stage: str | None = Field(default=None, description="Highest stage for any indication")
    mechanisms: list[TreatmentMechanism] = Field(default_factory=list)
    indications: list[TreatmentIndication] = Field(
        default_factory=list, description="Indications of the target-level record; empty on a disease record"
    )
    reports: list[ClinicalReport] = Field(default_factory=list)
    report_total: int = 0
    source_url: str = Field(description="Open Targets page of the drug")
    scope: Literal["disease_indication", "target"]
    evidence: Evidence | None = None


class StageCount(Schema):
    stage: str
    label: str
    count: int


class TreatmentsResponse(Aggregated):
    gene: EntityRef
    target_id: str | None = Field(default=None, description="Ensembl gene ID used as the Open Targets target")
    total: int | None = Field(default=None, description="Null when Open Targets did not answer")
    stage_counts: list[StageCount] = Field(default_factory=list)
    treatments: list[Treatment] = Field(default_factory=list)
    scope_note: str = (
        "Drugs and clinical candidates whose recorded mechanism acts on this gene product. Their "
        "indications are those in the source record and are usually not the inborn error of immunity."
    )


class DiseaseCategory(Schema):
    id: str
    name: str | None = None
    table: int | None = None
    subcategory_id: str | None = None
    subcategory_name: str | None = None


class DiseaseTerm(Schema):
    id: str
    label: str | None = None
    url: str | None = None


class DiseaseInheritance(Schema):
    raw: str | None = None
    codes: list[str] = Field(default_factory=list)
    terms: list[DiseaseTerm] = Field(default_factory=list)
    source: RecordSource | None = None


class CrossReference(Schema):
    database: str
    id: str
    url: str | None = None


class DiseaseDefinition(Schema):
    text: str
    one_line: str = Field(description="First sentence of the sourced definition")
    source: RecordSource | None = None


class DiseasePhenotype(Schema):
    hpo_id: str
    label: str | None = None
    frequency: str | None = Field(default=None, description="The source's own wording")
    url: str
    source: RecordSource | None = None


class DiseaseGeneSummary(Schema):
    symbol: str
    name: str | None = None
    hgnc_id: str | None = None
    chromosome: str | None = None
    ensembl_gene_id: str | None = None
    ncbi_gene_id: str | None = None
    href: str
    in_catalog: bool = True
    other_disease_count: int = 0
    source: RecordSource | None = None


class DiseaseProteinSummary(Schema):
    accession: str
    name: str | None = None
    length: int | None = None
    family: str | None = None
    href: str
    source: RecordSource | None = None


class ResearchStatusItem(Schema):
    """One count or classification from a single source. Null means the source had no value."""

    key: str
    label: str
    value: int | bool | str | None = None
    definition: str
    retrieved_at: str | None = None
    source: RecordSource | None = None
    evidence: Evidence | None = None


class GraphNode(Schema):
    id: str
    type: Literal["disease", "gene", "protein", "pathway", "interactor"]
    label: str
    ref: EntityRef | None = None
    url: str | None = None
    in_catalog: bool = False


class GraphEdge(Schema):
    id: str
    source: str
    target: str
    type: Literal["caused_by", "encodes", "participates_in", "interacts_with", "physically_associated_with"]
    label: str
    layer: str = Field(description="Source of the relationship: iuis, uniprot, reactome, intact or string")
    evidence: list[Evidence] = Field(default_factory=list)


class RelationshipGraph(Schema):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    pathway_total: int | None = None
    curated_partner_total: int | None = None
    string_partner_total: int | None = None


class DiseaseResponse(Aggregated):
    id: str
    name: str
    ref: EntityRef
    aliases: list[str] = Field(default_factory=list)
    category: DiseaseCategory | None = None
    inheritance: DiseaseInheritance
    mechanism: list[str] = Field(
        default_factory=list, description="As stated by IUIS; empty when it states none"
    )
    is_phenocopy: bool = False
    xrefs: list[CrossReference] = Field(default_factory=list)
    definition: DiseaseDefinition | None = None
    explanation: str | None = Field(default=None, description="One line: first sentence of the definition")
    phenotypes: list[DiseasePhenotype] = Field(default_factory=list)
    gene: DiseaseGeneSummary | None = None
    protein: DiseaseProteinSummary | None = None
    treatments: list[Treatment] = Field(
        default_factory=list, description="Drugs with this disease as a recorded indication in Open Targets"
    )
    treatment_total: int | None = Field(default=None, description="Null when Open Targets did not answer")
    target_drugs: list[Treatment] = Field(
        default_factory=list, description="Drugs acting on the gene product, for any indication"
    )
    target_drug_total: int | None = None
    research_status: list[ResearchStatusItem] = Field(default_factory=list)
    graph: RelationshipGraph
    record_sources: list[RecordSource] = Field(default_factory=list)


class DiseaseListItem(Schema):
    id: str
    name: str
    href: str
    aliases: list[str] = Field(default_factory=list)
    gene_symbol: str | None = None
    category_id: str | None = None
    category_name: str | None = None
    subcategory_id: str | None = None
    subcategory_name: str | None = None
    inheritance_codes: list[str] = Field(default_factory=list)
    mechanism: list[str] = Field(default_factory=list)
    is_phenocopy: bool = False
    explanation: str | None = None
    phenotype_count: int = 0
    clinvar_pathogenic_count: int | None = None
    experimental_structure_count: int | None = None


class DiseaseCategoryFacet(Schema):
    id: str
    name: str
    table: int | None = None
    count: int = Field(description="Diseases in the category that match the text query")


class DiseaseListResponse(AggregatedPage[DiseaseListItem]):
    page: int
    page_size: int
    categories: list[DiseaseCategoryFacet] = Field(default_factory=list)
