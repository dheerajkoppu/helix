"""Compounds with experimental ligand evidence for a protein, and compound detail."""

from enum import StrEnum
from typing import Literal

from pydantic import Field

from orphafold.schemas.common import Aggregated, EntityRef, Evidence, Schema


class Modality(StrEnum):
    SMALL_MOLECULE = "small_molecule"
    BIOLOGIC = "biologic"
    CELL_OR_GENE_THERAPY = "cell_or_gene_therapy"
    UNKNOWN = "unknown"


EvidenceTier = Literal["A_experimental"]
EvidenceKind = Literal["mechanism", "bioactivity", "co_crystal"]


class BindingPredictionEligibility(Schema):
    """Whether the compound may be sent to a binding prediction. Decided by modality alone."""

    eligible: bool
    reason: str


class MechanismRecord(Schema):
    source: Literal["chembl"] = "chembl"
    mechanism_id: str
    mechanism_of_action: str | None = None
    action_type: str | None = None
    molecule_chembl_id: str = Field(description="The form the mechanism is recorded on; may be a salt")
    target_chembl_id: str | None = None
    target_name: str | None = None
    target_type: str | None = None
    target_accessions: list[str] = Field(default_factory=list)
    direct_interaction: bool | None = None
    max_phase: float | None = None
    binding_site_comment: str | None = None
    mechanism_comment: str | None = None
    selectivity_comment: str | None = None
    references: list[dict[str, str | None]] = Field(default_factory=list)


class MeasuredAffinity(Schema):
    """One ChEMBL activity row, verbatim."""

    source: Literal["chembl"] = "chembl"
    activity_id: str
    standard_type: str
    relation: str
    value: float
    units: str
    pchembl: float | None = None
    assay_chembl_id: str | None = None
    assay_description: str | None = None
    assay_format: str | None = None
    document_chembl_id: str | None = None
    year: int | None = None
    url: str | None = None


class MeasuredAffinitySummary(Schema):
    """Summary of the qualifying ChEMBL activity rows of one compound against the target."""

    source: Literal["chembl"] = "chembl"
    median_pchembl: float
    min_pchembl: float
    max_pchembl: float
    activity_count: int = Field(description="Qualifying rows summarised")
    assay_count: int = Field(description="Distinct assays among those rows")
    assay_format: Literal["single protein format", "any assay format"]
    standard_types: dict[str, int] = Field(description="Rows per standard type, e.g. IC50, Ki, Kd")
    representative: MeasuredAffinity = Field(description="The qualifying row closest to the median pChEMBL")
    incomplete: bool = Field(
        default=False,
        description="True when ChEMBL held more rows than were read; the median covers the rows read",
    )


class CoCrystalRecord(Schema):
    source: Literal["pdbe"] = "pdbe"
    ccd_id: str
    name: str | None = None
    pdb_ids: list[str]
    pdb_entry_count: int
    binding_positions: list[int] = Field(description="UniProt positions PDBe lists as interacting")


class CompoundCore(Schema):
    id: str = Field(description="InChIKey; the ChEMBL ID when the source gives no structure")
    inchikey: str | None = None
    chembl_id: str | None = None
    name: str | None = None
    molecule_type: str | None = Field(default=None, description="ChEMBL molecule_type, verbatim")
    modality: Modality
    modality_basis: str = Field(description="The source field the modality was read from")
    max_phase: float | None = Field(default=None, description="ChEMBL max_phase; null when ChEMBL gives none")
    first_approval: int | None = None
    smiles: str | None = None
    molecular_weight: float | None = None
    molecular_formula: str | None = None
    depiction_url: str | None = Field(default=None, description="API path; add ?theme=dark|light")
    binding_prediction: BindingPredictionEligibility
    field_sources: dict[str, str] = Field(description="Source adapter ID of each populated field")


class TargetCompound(CompoundCore):
    evidence_tier: EvidenceTier = "A_experimental"
    evidence_kinds: list[EvidenceKind]
    mechanisms: list[MechanismRecord]
    measured_affinity: MeasuredAffinitySummary | None = None
    co_crystal: CoCrystalRecord | None = None
    evidence: list[Evidence]


class ChemblTargetRef(Schema):
    source: Literal["chembl"] = "chembl"
    chembl_id: str
    name: str | None = None
    target_type: str | None = None
    organism: str | None = None
    accessions: list[str] = Field(default_factory=list)
    url: str


class CompoundCounts(Schema):
    with_mechanism: int
    with_measured_affinity: int
    co_crystallised: int
    qualifying_activities_in_chembl: int | None = Field(
        default=None, description="Rows passing the filter for this target, across all compounds"
    )
    pdb_ligands_total: int | None = Field(
        default=None, description="Ligands PDBe lists that pass the solvent and size filter"
    )


class ProteinCompoundsResponse(Aggregated):
    protein: EntityRef
    target: ChemblTargetRef | None = Field(description="The single-protein ChEMBL target, when one exists")
    related_targets: list[ChemblTargetRef] = Field(
        description="Complexes, families and interactions that include this protein"
    )
    compounds: list[TargetCompound]
    counts: CompoundCounts
    affinity_rule: str
    selection_rule: str
    order_rule: str


class CrossReference(Schema):
    source: Literal["unichem"] = "unichem"
    database: str
    database_name: str | None = None
    id: str
    url: str | None = None


class IndicationRecord(Schema):
    source: Literal["chembl"] = "chembl"
    indication_id: str
    mesh_heading: str | None = None
    mesh_id: str | None = None
    efo_term: str | None = None
    efo_id: str | None = None
    max_phase_for_indication: float | None = None
    references: list[dict[str, str | None]] = Field(default_factory=list)


class CompoundTarget(ChemblTargetRef):
    action_types: list[str] = Field(default_factory=list)
    protein_refs: list[EntityRef] = Field(default_factory=list)


class CompoundDetailResponse(Aggregated):
    compound: CompoundCore
    inchi: str | None = None
    parent_chembl_id: str | None = None
    cross_references: list[CrossReference]
    mechanisms: list[MechanismRecord]
    indications: list[IndicationRecord]
    indications_note: str
    targets: list[CompoundTarget]
    evidence: list[Evidence]


class CompoundAnalog(CompoundCore):
    similarity: float = Field(description="ChEMBL similarity search value, percent")


class CompoundAnalogsResponse(Aggregated):
    query: CompoundCore
    threshold: int
    similarity_source: Literal["chembl"] = "chembl"
    similarity_unit: str = "percent"
    analogs: list[CompoundAnalog]
    message: str | None = None
