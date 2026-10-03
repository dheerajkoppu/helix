"""Schemas of the interaction and pathway endpoints of a protein."""

from pydantic import Field

from helix.schemas.common import Aggregated, EntityRef, Evidence, Schema


class OntologyTerm(Schema):
    id: str | None = None
    label: str | None = None


class CuratedInteraction(Schema):
    """One partner with the IntAct evidence rows behind it."""

    partner_id: str = Field(description="UniProt accession of the partner")
    partner_symbol: str | None = None
    partner: EntityRef
    in_catalog: bool = Field(description="The partner's gene is an IUIS inborn-errors-of-immunity gene")
    mi_score: float | None = Field(default=None, description="IntAct MI score, 0 to 1, as IntAct reports it")
    evidence_count: int = Field(description="IntAct evidence rows for this pair")
    methods: list[OntologyTerm] = Field(default_factory=list, description="PSI-MI detection methods")
    interaction_types: list[OntologyTerm] = Field(default_factory=list)
    pmids: list[str] = Field(default_factory=list)
    interaction_acs: list[str] = Field(default_factory=list, description="IntAct interaction accessions")
    measured_with_mutant: bool = Field(
        default=False, description="At least one row was measured with a mutated form of the query protein"
    )
    url: str | None = None
    evidence: Evidence | None = None


class CuratedLayer(Schema):
    source: str = "intact"
    label: str = "Curated interactions (IntAct)"
    description: str = (
        "Binary interactions curated by IntAct from published experiments. Each has a detection "
        "method and a publication."
    )
    total_rows: int = Field(default=0, description="Evidence rows IntAct returned for the protein")
    rows_truncated: bool = False
    self_interaction_rows: int = 0
    non_human_or_non_protein_rows: int = 0
    negative_rows: int = Field(default=0, description="Rows IntAct marks as negative; left out of partners")
    partners: list[CuratedInteraction] = Field(default_factory=list)


class StringAssociation(Schema):
    string_id: str
    partner_symbol: str | None = None
    partner: EntityRef | None = Field(
        default=None, description="Set when the partner is a catalog gene with a UniProt accession"
    )
    in_catalog: bool = False
    also_in_intact: bool = Field(
        default=False, description="The same partner has a curated IntAct record in this response"
    )
    score: float | None = Field(default=None, description="STRING combined score of the physical subnetwork")
    channels: dict[str, float | None] = Field(
        default_factory=dict, description="STRING channel scores, verbatim: escore, dscore, tscore and others"
    )
    dominant_channel: str | None = None
    url: str | None = None
    evidence: Evidence | None = None


class StringLayer(Schema):
    source: str = "string"
    label: str = "Physical associations (STRING)"
    description: str = (
        "STRING physical subnetwork. The score is a combined confidence over experiments, curated "
        "databases and text mining; it is not a curated interaction record and is kept apart from IntAct."
    )
    string_id: str | None = None
    required_score: float | None = Field(default=None, description="Score threshold of the request, 0 to 1")
    note: str | None = "STRING numbers residues on its own isoform; positions do not transfer to UniProt."
    partners: list[StringAssociation] = Field(default_factory=list)


class InteractionsResponse(Aggregated):
    protein: EntityRef
    gene: EntityRef | None = None
    curated: CuratedLayer
    string_physical: StringLayer


class Pathway(Schema):
    id: str = Field(description="Reactome stable ID")
    version: str | None = None
    name: str
    in_disease: bool = Field(description="Reactome's isInDisease flag")
    inferred: bool = False
    has_diagram: bool = False
    doi: str | None = None
    url: str
    diagram_url: str | None = None
    evidence: Evidence | None = None


class PathwaysResponse(Aggregated):
    protein: EntityRef
    gene: EntityRef | None = None
    total: int = 0
    disease_pathway_count: int = 0
    pathways: list[Pathway] = Field(default_factory=list)
