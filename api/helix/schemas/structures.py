"""Response schemas of the structure ledger and the per-structure endpoints."""

from datetime import date
from typing import Literal

from pydantic import Field

from helix.schemas.common import (
    Aggregated,
    Citation,
    EntityRef,
    Evidence,
    PlddtFractions,
    ResidueRange,
    Schema,
    StructureDescriptor,
    StructureOrigin,
)

StructureFileFormat = Literal["bcif", "cif", "pdb"]


class LedgerChain(Schema):
    """One chain of a PDB entry mapped to the protein by SIFTS, in UniProt numbering."""

    chain_id: str = Field(description="Author chain ID")
    entity_id: int | None = None
    unp_start: int
    unp_end: int
    observed_regions: list[ResidueRange] = Field(
        default_factory=list, description="Residues with coordinates; empty when PDBe lists none"
    )
    coverage: float | None = Field(
        default=None, description="Fraction of the UniProt sequence, as PDBe reports it"
    )
    sifts_rank: int = Field(description="Position in the PDBe best_structures list, from 1")


class LigandSummary(Schema):
    comp_id: str = Field(description="PDB chemical component ID")
    name: str | None = None
    formula: str | None = None
    formula_weight: float | None = None
    inchikey: str | None = None
    smiles: str | None = None
    chains: list[str] = Field(default_factory=list, description="Author chain IDs the ligand is assigned to")
    common_additive: bool = Field(
        default=False,
        description="Component ID is on Helix's fixed list of common crystallisation and buffer "
        "additives. The entry itself does not say whether the molecule is functionally relevant.",
    )
    url: str | None = None


class EngineeredMutations(Schema):
    """Mutations of a polymer entity as the depositors described them (pdbx_mutation), verbatim."""

    entity_id: str
    description: str | None = None
    mutations: list[str] = Field(default_factory=list)
    mutation_count: int | None = None


class ExperimentalStructure(Schema):
    structure: StructureDescriptor
    chains: list[LedgerChain] = Field(default_factory=list)
    ligands: list[LigandSummary] = Field(default_factory=list)
    engineered_mutations: list[EngineeredMutations] = Field(default_factory=list)
    citation: Citation | None = None
    deposit_date: date | None = None
    release_date: date | None = None
    r_free: float | None = None
    sifts_rank: int | None = Field(
        default=None, description="Best rank of any chain of the entry in PDBe SIFTS"
    )
    evidence: Evidence | None = None


class ExternalModel(Schema):
    """A model listed by 3D-Beacons from another provider. A link-out, not an Helix structure ID."""

    model_identifier: str
    provider: str | None = None
    model_category: str | None = Field(default=None, description="3D-Beacons wording, verbatim")
    model_url: str | None = None
    model_page_url: str | None = None
    created: str | None = None
    uniprot_start: int | None = None
    uniprot_end: int | None = None
    coverage: float | None = None
    sequence_identity: float | None = None
    confidence_type: str | None = None
    confidence_version: str | None = None
    confidence_avg_local_score: float | None = Field(
        default=None, description="On the provider's own scale; see confidence_type"
    )
    oligomeric_state: str | None = None


class RecommendedStructure(Schema):
    structure_id: str
    origin: StructureOrigin
    reason: str
    rule: str = Field(description="The fixed selection rule that produced this default")


class StructureLedger(Aggregated):
    """Every structure known for a protein, grouped by origin. The groups are never merged."""

    protein: EntityRef
    sequence_length: int | None = None
    experimental: list[ExperimentalStructure] = Field(default_factory=list)
    predicted_external: list[StructureDescriptor] = Field(
        default_factory=list, description="The AlphaFold DB model of the canonical sequence"
    )
    isoform_models: list[StructureDescriptor] = Field(
        default_factory=list, description="AlphaFold DB models of other isoforms; not canonical numbering"
    )
    other_external_models: list[ExternalModel] = Field(default_factory=list)
    predicted_internal: list[StructureDescriptor] = Field(default_factory=list)
    recommended: RecommendedStructure | None = None


class PlddtTrack(Schema):
    chain: str | None = None
    residue_numbers: list[int]
    scores: list[float] = Field(description="pLDDT on 0-100")
    categories: list[Literal["very_low", "low", "confident", "very_high"]] = Field(default_factory=list)
    native_scale: Literal["0-1", "0-100"] | None = None
    mean: float | None = None
    fractions: PlddtFractions | None = None


class PaeMatrix(Schema):
    matrix: list[list[float]] = Field(description="Predicted aligned error, row = aligned residue")
    size: int
    residue_start: int = Field(description="Residue number of row and column 0")
    max: float | None = Field(default=None, description="Cap of the matrix")
    unit: str = "angstrom"


class StructureConfidence(Aggregated):
    structure_id: str
    origin: StructureOrigin
    available: bool
    message: str | None = None
    plddt: PlddtTrack | None = None
    pae: PaeMatrix | None = None
    pae_available: bool = False
    limitations: list[str] = Field(default_factory=list)


class ResidueMapSegment(Schema):
    """UniProt position p maps to entity position entity_start + (p - unp_start) in struct_asym_id.
    Author numbering is given at the segment ends as the entry states it."""

    uniprot_accession: str
    chain_id: str = Field(description="Author chain ID (auth_asym_id)")
    struct_asym_id: str | None = Field(default=None, description="label_asym_id")
    entity_id: int | None = None
    unp_start: int
    unp_end: int
    entity_start: int | None = Field(default=None, description="label_seq_id of unp_start")
    entity_end: int | None = None
    author_start: int | None = Field(default=None, description="Null when the first residue is not observed")
    author_end: int | None = None
    author_start_insertion_code: str | None = None
    author_end_insertion_code: str | None = None
    author_offset: int | None = Field(
        default=None,
        description="author number minus UniProt number when it is the same at both segment ends, else null",
    )
    identity: float | None = None


class ResidueMap(Aggregated):
    structure_id: str
    origin: StructureOrigin
    numbering: str
    segments: list[ResidueMapSegment] = Field(default_factory=list)


class BindingResidue(Schema):
    uniprot_accession: str | None = None
    uniprot_position: int | None = Field(
        default=None, description="Null when the residue has no UniProt mapping"
    )
    residue_name: str | None = None
    struct_asym_id: str | None = None
    entity_seq_id: int | None = None
    author_seq_id: int | None = None
    distance: float | None = Field(default=None, description="Shortest distance to the ligand in angstroms")


class LigandInstance(Schema):
    chain_id: str | None = Field(default=None, description="Author chain ID")
    struct_asym_id: str | None = None
    author_seq_id: str | None = None
    residues: list[BindingResidue] = Field(default_factory=list)


class BoundLigand(LigandSummary):
    instances: list[LigandInstance] = Field(default_factory=list)
    binding_site: list[ResidueRange] = Field(
        default_factory=list,
        description="Neighbouring residues of all instances merged into UniProt ranges, per accession",
    )
    binding_site_positions: list[int] = Field(default_factory=list)


class StructureLigands(Aggregated):
    structure_id: str
    origin: StructureOrigin
    uniprot_accession: str | None = Field(
        default=None, description="Accession the merged binding sites refer to"
    )
    ligands: list[BoundLigand] = Field(default_factory=list)
    neighbour_definition: str | None = None
    message: str | None = None
