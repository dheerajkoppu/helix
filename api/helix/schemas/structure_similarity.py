"""Structure similarity: fold-level neighbours of a protein and pocket-level comparison.

Every number in these types is a measure one of the sources actually reported, carried with the name
of the measure and the field it came from. Helix invents no similarity score of its own.
"""

from typing import Literal

from pydantic import Field

from helix.schemas.common import (
    Aggregated,
    EntityRef,
    Evidence,
    EvidenceClass,
    Schema,
    StructureOrigin,
)

SimilarityStatus = Literal["ready", "pending", "unavailable", "not_applicable"]
MetricDirection = Literal["lower_is_stronger", "higher_is_stronger", "descriptive"]


class SimilarityMetric(Schema):
    """One named measure, reported as the source reported it."""

    name: str = Field(description="Machine name, e.g. foldseek_evalue")
    label: str = Field(description="What the measure is called, in words")
    value: float | None = None
    unit: str | None = None
    direction: MetricDirection = "descriptive"
    source: str = Field(description="Source adapter ID that reported it, e.g. foldseek")
    source_field: str = Field(description="Field name in the source's own response, e.g. eval")
    meaning: str = Field(description="One plain sentence saying what the number means")


class AlignedRange(Schema):
    start: int
    end: int


class SimilarProtein(Schema):
    """One fold-similarity hit, with the identifiers Foldseek's target name carried."""

    id: str = Field(description="Stable row ID: <database>:<target name>")
    database: str
    database_label: str
    target: str = Field(description="Target name exactly as Foldseek returned it")
    title: str | None = Field(default=None, description="Description Foldseek carried on the target name")
    protein: EntityRef | None = Field(
        default=None, description="The similar protein, when the target name resolves to a UniProt entry"
    )
    gene_symbol: str | None = None
    structure_id: str | None = Field(default=None, description="pdb:<ID> or afdb:<entryId> of the target")
    structure_origin: StructureOrigin | None = None
    pdb_chain: str | None = None
    organism: str | None = None
    is_same_protein: bool = Field(
        default=False, description="The query's own entry or another model of the same protein"
    )
    alignment_count: int = Field(
        default=1, description="How many alignments to this protein the search returned"
    )
    metrics: list[SimilarityMetric]
    query_aligned: AlignedRange | None = Field(
        default=None, description="Residues of the subject that took part in the alignment"
    )
    target_aligned: AlignedRange | None = None
    observed_ligands: list[str] = Field(
        default_factory=list,
        description="Component IDs of non-polymer ligands RCSB PDB lists as bound in this entry",
    )
    evidence: Evidence | None = None


class SharedResidue(Schema):
    """One residue of the subject's pocket and the residue it aligns to in the similar protein."""

    subject_position: int
    subject_residue: str | None = None
    analogue_position: int
    analogue_residue: str | None = None
    same_residue: bool
    in_analogue_pocket: bool = False
    contacts_analogue_ligand: list[str] = Field(
        default_factory=list, description="Component IDs of ligands observed in contact with this residue"
    )


class ObservedLigand(Schema):
    """A molecule seen bound to the similar protein in an experimental structure, not a prediction."""

    comp_id: str
    name: str | None = None
    inchikey: str | None = None
    smiles: str | None = None
    formula: str | None = None
    structure_id: str = Field(description="pdb:<ID> the ligand was observed in")
    common_additive: bool = Field(description="A crystallisation additive rather than a designed binder")
    binding_site_positions: list[int] = Field(
        default_factory=list, description="UniProt positions of the similar protein that contact it"
    )
    positions_shared_with_subject_pocket: list[int] = Field(
        default_factory=list,
        description="Subject positions whose aligned residue in the similar protein contacts this ligand",
    )
    url: str | None = None
    evidence: Evidence | None = None


class PocketPair(Schema):
    """One subject pocket set beside the pocket of the similar protein its residues align to."""

    subject_pocket_id: str
    subject_pocket_probability: float | None = Field(
        default=None, description="P2Rank calibrated probability for the subject pocket, 0 to 1"
    )
    subject_positions: list[int]
    analogue_pocket_id: str | None = None
    analogue_pocket_probability: float | None = None
    analogue_positions: list[int] = Field(default_factory=list)
    shared_residues: list[SharedResidue] = Field(
        description="Subject pocket residues that align to a residue of the similar protein"
    )
    aligned_count: int = Field(description="Subject pocket residues with an aligned partner")
    in_analogue_pocket_count: int = Field(
        description="Of those, how many land in a pocket predicted on the similar protein"
    )
    identical_residue_count: int = Field(description="Of those, how many are the same amino acid")
    ligand_contact_count: int = Field(
        description="Of those, how many contact a ligand observed bound to the similar protein"
    )
    shares: list[str] = Field(description="What the two pockets share, one plain sentence each")


class PocketSimilarity(Aggregated):
    """Pocket-level comparison of one subject structure against one similar protein."""

    subject: EntityRef
    subject_structure_id: str
    subject_structure_origin: StructureOrigin
    analogue: EntityRef
    analogue_structure_id: str | None = None
    analogue_experimental_structure_id: str | None = Field(
        default=None, description="Experimental entry the observed ligands were read from"
    )
    status: SimilarityStatus
    status_detail: str | None = None
    retry_after_seconds: int | None = None
    evidence_class: EvidenceClass = EvidenceClass.COMPUTATIONAL_PREDICTION
    fold_metrics: list[SimilarityMetric] = Field(
        default_factory=list, description="Fold-level measures for this pair, from Foldseek"
    )
    residue_correspondence: str = Field(
        description="How a subject position was mapped onto a position of the similar protein"
    )
    pocket_pairs: list[PocketPair] = Field(default_factory=list)
    observed_ligands: list[ObservedLigand] = Field(default_factory=list)
    shares: list[str] = Field(
        default_factory=list, description="What the two proteins share overall, one plain sentence each"
    )
    caveats: list[str] = Field(default_factory=list)
    limits: list[str] = Field(default_factory=list)


class SimilarStructures(Aggregated):
    """Fold neighbours of one protein. Pending while the external search is still running."""

    protein: EntityRef
    query_structure_id: str
    query_structure_origin: StructureOrigin
    query_length: int | None = None
    status: SimilarityStatus
    status_detail: str | None = None
    retry_after_seconds: int | None = None
    evidence_class: EvidenceClass = EvidenceClass.COMPUTATIONAL_PREDICTION
    service: str = "Foldseek Search Server"
    service_url: str | None = None
    mode: str | None = Field(default=None, description="Foldseek search mode that produced these rows")
    mode_note: str | None = Field(default=None, description="What this mode does and does not report")
    databases: list[str] = Field(default_factory=list)
    from_cached_example: bool = Field(
        default=False, description="Served from a stored copy under data/examples, not searched now"
    )
    cached_retrieved_at: str | None = None
    total_hits: dict[str, int] = Field(
        default_factory=dict, description="Hits the service found per database, before any cap"
    )
    ranking_rule: str | None = Field(default=None, description="How the rows below were ordered")
    similar: list[SimilarProtein] = Field(default_factory=list)
    metric_names: list[str] = Field(
        default_factory=list, description="The measures carried on every row, by name"
    )
    limits: list[str] = Field(default_factory=list)


class StructuralAnalogue(Schema):
    """One structural-analogue bridge for the discovery engine: a similar protein, what it shares
    with the subject, the molecules observed bound to it, and the reasons it might be wrong."""

    id: str
    protein: EntityRef = Field(description="The similar protein")
    gene_symbol: str | None = None
    name: str | None = None
    organism: str | None = None
    relation: Literal["structural_analogue"] = "structural_analogue"
    fold_metrics: list[SimilarityMetric]
    shares: list[str] = Field(description="What subject and analogue share, one plain sentence each")
    subject_structure_id: str
    subject_pocket_id: str | None = None
    subject_pocket_positions: list[int] = Field(default_factory=list)
    analogue_structure_id: str | None = None
    analogue_pocket_id: str | None = None
    analogue_positions: list[int] = Field(default_factory=list)
    observed_ligands: list[ObservedLigand] = Field(default_factory=list)
    pocket_compared: bool = Field(
        description="Whether residue-level pocket comparison ran, or only fold similarity"
    )
    evidence: list[Evidence] = Field(default_factory=list)
    caveats: list[str] = Field(description="Why this bridge might be wrong, one plain sentence each")


class StructuralAnalogueBridges(Aggregated):
    """What `structural_analogue_bridges()` returns. The discovery engine reads this and nothing else."""

    subject: EntityRef
    subject_structure_id: str | None = None
    status: SimilarityStatus
    status_detail: str | None = None
    retry_after_seconds: int | None = None
    analogues: list[StructuralAnalogue] = Field(default_factory=list)
    limits: list[str] = Field(default_factory=list)
