"""Schemas of the discovery engine: candidate targets and molecules for a subject.

A candidate is a hypothesis Helix generated from retrieved records. It is never a recommendation,
never a treatment, and carries no probability of success. Every step of every chain is a separate
claim with its own Evidence row, and the reasons it might be wrong are printed next to it.

Direction of effect is a hard filter, not a ranking factor: a molecule whose recorded action would
push the subject's activity the wrong way never reaches `candidates`. It goes to `ruled_out` with
the reason in plain words.
"""

from typing import Literal

from pydantic import ConfigDict, Field

from helix.schemas.common import (
    Aggregated,
    EntityRef,
    Evidence,
    Schema,
    SourceStatus,
)

BridgeKind = Literal[
    "same_target",
    "pathway_node",
    "interaction_partner",
    "structural_analogue",
    "mechanism_class",
]

MechanismClass = Literal[
    "gain_of_function",
    "loss_of_function",
    "dominant_negative",
    "haploinsufficiency",
    "neomorph",
    "unknown",
]

Direction = Literal["increased_activity", "decreased_activity", "unknown"]

RequiredAction = Literal[
    "inhibit",
    "antagonise",
    "block_upstream",
    "restore",
    "activate",
    "stabilise",
    "chaperone",
    "replace",
    "bypass",
    "release_a_brake",
    "remove_the_mutant_protein",
]

Verdict = Literal["matches", "opposes", "unknown"]

MechanismConfidence = Literal[
    "stated_in_the_catalog",
    "named_in_the_disease_label",
    "unknown",
]

RuledOutReason = Literal["opposes_required_action"]


class SubjectMechanism(Schema):
    """Mechanism class and direction of effect of the subject, with where they came from."""

    model_config = ConfigDict(populate_by_name=True)

    mechanism_class: MechanismClass = Field(
        alias="class", description="Catalog mechanism class, or unknown when no record states one"
    )
    direction: Direction = Field(description="Which way the subject's activity moves")
    confidence: MechanismConfidence = Field(description="Which record the class and direction came from")
    basis: str = Field(description="The rule or record that set the class and direction, in plain words")
    disagreements: list[str] = Field(
        default_factory=list, description="Records that state a different class or direction"
    )
    evidence: list[Evidence] = Field(default_factory=list)


class Subject(Schema):
    """What the candidates are for: a gene, its protein, and the disease or variant that framed it."""

    gene_symbol: str
    accession: str | None = Field(default=None, description="UniProt accession of the gene's protein")
    gene: EntityRef
    protein: EntityRef | None = None
    disease: EntityRef | None = None
    variant: EntityRef | None = None
    mechanism: SubjectMechanism


class ActionRule(Schema):
    """The required-action rule as a pure function of (mechanism class, direction)."""

    actions: list[RequiredAction]
    action_labels: list[str] = Field(description="The same actions in everyday words")
    rule: str = Field(description="The row of the rule table that fired")
    why: str = Field(description="Why this mechanism needs this action, in plain words")
    direction_needed: Literal["less_activity", "more_activity", "none"] = Field(
        description="Which way the subject's activity has to move for a molecule to help"
    )


class ActionRuleRow(Schema):
    """One row of the published rule table, so a page can print the whole table."""

    mechanism_class: MechanismClass
    direction: Direction
    actions: list[RequiredAction]
    why: str


class Druggability(Schema):
    """What is recorded about acting on this protein. Counts of records, never a score."""

    molecules_with_a_recorded_action: int
    highest_clinical_phase: float | None = None
    has_approved_molecule: bool = False
    pocket_count: int | None = Field(default=None, description="Predicted pockets, when they were read")
    note: str | None = None


class CandidateTarget(Schema):
    accession: str
    gene_symbol: str | None = None
    name: str | None = None
    relation: BridgeKind
    protein: EntityRef | None = None
    druggability: Druggability | None = None


class MeasuredAffinity(Schema):
    """A measured activity of this molecule against this protein, as ChEMBL records it."""

    median_pchembl: float
    activity_count: int
    assay_count: int
    standard_types: list[str] = Field(default_factory=list)
    organism: str | None = None
    url: str | None = None


class CandidateMolecule(Schema):
    inchikey: str | None = None
    chembl_id: str
    name: str | None = None
    modality: str | None = Field(default=None, description="ChEMBL molecule_type, the source's own word")
    max_phase: float | None = Field(default=None, description="ChEMBL maximum clinical phase")
    max_phase_label: str | None = None
    action_type: str | None = Field(default=None, description="ChEMBL mechanism action_type on the target")
    mechanism_of_action: str | None = None
    withdrawn: bool | None = None
    measured_affinity: MeasuredAffinity | None = None
    compound: EntityRef | None = None


class BridgeStep(Schema):
    """One claim in the chain. Each carries its own evidence; no step is a summary of another."""

    statement: str
    evidence: list[Evidence] = Field(default_factory=list)


class BridgeDisease(Schema):
    id: str | None = None
    name: str | None = None
    source: str | None = None
    disease: EntityRef | None = None


class Bridge(Schema):
    kind: BridgeKind
    label: str
    from_disease: BridgeDisease | None = Field(
        default=None, description="The other disease the molecule is recorded for, when there is one"
    )
    steps: list[BridgeStep]
    partial: bool = Field(default=False, description="True when a source this bridge wants was not available")
    partial_reason: str | None = None


class DirectionCheck(Schema):
    """The hard filter. A verdict of 'opposes' never appears in candidates."""

    required: list[RequiredAction]
    required_direction: Literal["less_activity", "more_activity", "none"]
    molecule_action: str | None = Field(default=None, description="ChEMBL action_type, verbatim")
    molecule_effect: Literal["lowers", "raises", "unknown"] = Field(
        description="What the recorded action does to the protein it acts on"
    )
    target_relation_effect: Literal["same_way", "opposite_way", "unknown"] = Field(
        description="How an effect on this target carries over to the subject's activity"
    )
    verdict: Verdict
    why: str = Field(description="Built from a fixed template, never free prose")
    corroboration: list[str] = Field(
        default_factory=list,
        description=(
            "Independent signals about what the molecule does to this target, each read from a "
            "different record than the action_type: the free-text mechanism_of_action, a second "
            "mechanism record, the measured assay types. A rejection needs at least one that agrees."
        ),
    )
    corroborated: bool | None = Field(
        default=None,
        description=(
            "Whether the action_type's direction was corroborated by an independent signal. False "
            "or null means no rejection was made on it."
        ),
    )


class CandidateStructure(Schema):
    structure_id: str | None = None
    pocket_id: str | None = None
    residues: list[int] = Field(default_factory=list)
    similar_to: CandidateTarget | None = Field(
        default=None, description="The protein whose pocket or fold the chain compared with"
    )
    note: str | None = None


class Candidate(Schema):
    id: str
    rank: int
    target: CandidateTarget
    molecule: CandidateMolecule | None = None
    bridge: Bridge
    direction_check: DirectionCheck
    structure: CandidateStructure | None = None
    caveats: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    label: Literal["Helix hypothesis"] = "Helix hypothesis"


class RuledOut(Schema):
    """A molecule the direction filter removed. The list is the evidence the filter works."""

    id: str
    molecule: CandidateMolecule
    target: CandidateTarget
    bridge_kind: BridgeKind
    reason_code: RuledOutReason
    reason: str
    direction_check: DirectionCheck
    evidence: list[Evidence] = Field(default_factory=list)


class WithheldEdge(Schema):
    """An edge linking the subject disease straight to a molecule, dropped by exclude_direct."""

    kind: Literal["open_targets_disease_drug", "chembl_indication", "literature_co_mention"]
    source: str
    disease_id: str | None = None
    disease_name: str | None = None
    molecule_chembl_id: str | None = None
    molecule_name: str | None = None
    detail: str


class BridgeStatus(Schema):
    kind: BridgeKind
    label: str
    state: Literal["ok", "empty", "partial", "failed", "skipped"]
    candidate_count: int = 0
    ruled_out_count: int = 0
    message: str | None = None
    elapsed_ms: float | None = None


class DiscoveryResponse(Aggregated):
    subject: Subject
    required_action: ActionRule
    candidates: list[Candidate] = Field(default_factory=list)
    ruled_out: list[RuledOut] = Field(default_factory=list)
    withheld_edges: list[WithheldEdge] = Field(default_factory=list)
    exclude_direct: bool
    bridges: list[BridgeStatus] = Field(default_factory=list)
    action_rule_table: list[ActionRuleRow] = Field(default_factory=list)
    ranking_rule: list[str] = Field(default_factory=list)
    limits: list[str] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    elapsed_ms: float | None = None
    from_cache: bool = False


class ControlChainStep(Schema):
    statement: str
    source: str | None = None
    record_id: str | None = None
    record_url: str | None = None


class ControlResult(Schema):
    id: str
    kind: Literal["positive", "negative"]
    title: str
    subject: str
    request: str
    expected: str
    passed: bool
    detail: str
    elapsed_ms: float | None = None
    sources_answered: int | None = None
    source_count: int | None = None
    candidate_count: int | None = None
    ruled_out_count: int | None = None
    expected_molecule: str | None = None
    expected_molecule_rank: int | None = None
    chain: list[ControlChainStep] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ControlsResponse(Schema):
    generated_at: str | None = None
    all_passed: bool
    passed: int
    total: int
    engine_version: str | None = None
    controls: list[ControlResult] = Field(default_factory=list)
    sources: list[SourceStatus] = Field(default_factory=list)
