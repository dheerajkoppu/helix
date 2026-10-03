"""Schemas of the mechanism workspace: candidate mechanisms of a variant and the records behind them.

A candidate is a question to test, never a finding. Its confidence label is the kind of the
strongest record that raised it; no number is derived from several sources.
"""

from typing import Literal

from pydantic import Field

from helix.schemas.common import (
    Aggregated,
    EntityRef,
    Evidence,
    EvidenceClass,
    EvidenceDirection,
    ResidueRange,
    Schema,
    StructureOrigin,
)

MechanismCategory = Literal[
    "stability",
    "folding",
    "catalytic_site",
    "ligand_binding",
    "protein_interaction",
    "localisation",
    "signalling",
    "domain_interface",
]
SupportKind = Literal["experimental_annotation", "curated_annotation", "computational_prediction"]
Proximity = Literal["at_residue", "structure_contact", "covering_region", "sequence_neighbour", "protein_level"]


class MechanismLigandRef(Schema):
    structure_id: str
    comp_id: str
    name: str | None = None
    chain_id: str | None = Field(default=None, description="Author chain ID of the ligand instance")
    author_seq_id: int | None = None
    distance: float | None = Field(default=None, description="Shortest distance to the residue in angstroms")
    url: str | None = None


class MechanismObservation(Schema):
    """One retrieved record read against the variant's residue."""

    id: str
    rule: str = Field(description="ID of the rule that produced the observation, see rules")
    summary: str = Field(description="What the record says about this residue, built from its fields")
    source_statement: str | None = Field(default=None, description="The record's own text, verbatim")
    proximity: Proximity
    sequence_distance: int | None = Field(
        default=None, description="Residues between the variant and the annotated position; 0 at the residue"
    )
    positions: list[int] = Field(default_factory=list, description="UniProt positions the record names")
    range: ResidueRange | None = None
    support: SupportKind
    evidence_class: EvidenceClass
    direction: EvidenceDirection = EvidenceDirection.SUPPORTS
    raises_candidate: bool = Field(
        default=True, description="False for context rows: they never raise a candidate on their own"
    )
    metric: str | None = Field(default=None, description="Effect key of a numeric value, e.g. foldx.ddg")
    value: float | str | None = None
    unit: str | None = None
    structure_id: str | None = None
    structure_origin: StructureOrigin | None = None
    ligand: MechanismLigandRef | None = None
    partner: EntityRef | None = None
    same_substitution: bool | None = Field(
        default=None, description="For statements about a substitution: whether it is this variant's"
    )
    evidence: Evidence


class MechanismHighlight(Schema):
    """What the 3D view marks for a candidate. Positions are UniProt canonical."""

    positions: list[int] = Field(default_factory=list)
    structure_id: str | None = Field(default=None, description="Structure the supporting record refers to")
    structure_origin: StructureOrigin | None = None
    ligands: list[MechanismLigandRef] = Field(default_factory=list)
    partners: list[EntityRef] = Field(default_factory=list)


class MechanismCandidate(Schema):
    id: str
    category: MechanismCategory
    label: str
    rank: int = Field(description="Order in the ledger: support kind, then proximity, then record count")
    claim: str = Field(description="The candidate as a question to test, worded as a possibility")
    support: SupportKind
    support_label: str
    confidence_basis: str = Field(description="Why the candidate carries this label")
    observations: list[MechanismObservation]
    supporting_count: int
    disputing_count: int
    evidence_ids: list[str] = Field(description="Evidence IDs a saved hypothesis derives from")
    tests: list[str] = Field(description="What would be needed to test the candidate")
    highlight: MechanismHighlight
    limitations: list[str] = Field(default_factory=list)


class UnsupportedCategory(Schema):
    category: MechanismCategory
    label: str
    message: str = "No supporting data found"
    checked: list[str] = Field(description="What the rules looked for")
    not_checked: list[str] = Field(
        default_factory=list, description="Data the rules need that no source answered with"
    )
    observations: list[MechanismObservation] = Field(
        default_factory=list, description="Records that were read but do not raise the candidate"
    )


class MechanismRule(Schema):
    id: str
    category: MechanismCategory
    description: str
    data: str = Field(description="The source record the rule reads")


class SupportKindInfo(Schema):
    key: SupportKind
    label: str
    description: str


class MechanismsResponse(Aggregated):
    variant_id: str
    gene: EntityRef
    protein: EntityRef | None = None
    position: int | None = None
    reference: str | None = None
    alternate: str | None = None
    protein_change: str | None = None
    applicable: bool = Field(description="False when the variant is not a single-residue substitution")
    message: str | None = None
    candidates: list[MechanismCandidate] = Field(default_factory=list)
    unsupported: list[UnsupportedCategory] = Field(default_factory=list)
    support_order: list[SupportKindInfo] = Field(default_factory=list)
    rules: list[MechanismRule] = Field(default_factory=list)
    method: str
    neighbour_window: int
    domain_boundary_window: int
    limitations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
