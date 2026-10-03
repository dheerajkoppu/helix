"""Schemas of the agentic lab: agent specifications, runs, the research record and the benchmark."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from orphafold.schemas.common import Schema

LabMode = Literal["specialist_lab", "single_agent_baseline"]
LabStatus = Literal["running", "awaiting_approval", "succeeded", "failed", "cancelled"]
LabAgentName = Literal[
    "orchestrator",
    "literature",
    "knowledge_graph",
    "insight",
    "planner",
    "safety",
    "runner",
    "analysis",
    "human",
]
LabEventType = Literal[
    "objective",
    "handoff",
    "evidence",
    "gap",
    "hypothesis",
    "test_candidate",
    "plan",
    "approval_request",
    "approval_decision",
    "experiment_started",
    "experiment_result",
    "interpretation",
    "decision",
    "next_experiment",
    "note",
]


class LabSchema(Schema):
    """Lab files carry fields beyond the contract; they pass through unchanged."""

    model_config = ConfigDict(
        from_attributes=True,
        use_enum_values=False,
        json_schema_serialization_defaults_required=True,
        extra="allow",
    )


class LabSubject(LabSchema):
    gene: str | None = None
    variant_id: str
    accession: str | None = None
    position: int | None = None
    reference_residue: str | None = None
    alternate_residue: str | None = None
    protein_change: str | None = None


class LabBudget(LabSchema):
    max_tool_calls: int
    max_compute_seconds: float


class LabOmnigent(LabSchema):
    version: str | None = None
    harness: str | None = None
    model: str | None = None
    session_id: str | None = None
    models: dict[str, str] = Field(default_factory=dict, description="Model of every agent, by agent ID")


class LabMetrics(LabSchema):
    wall_seconds: float | None = None
    tool_calls: int = 0
    distinct_sources: int = 0
    evidence_items: int = 0
    hypotheses: int = 0
    tests_considered: int = 0
    approvals: int = 0


class LabOutcome(LabSchema):
    favoured_before: str | None = Field(
        default=None, description="Mechanism class the starting evidence favoured"
    )
    favoured_after: str | None = Field(default=None, description="Mechanism class favoured after the test")
    decision_changed: bool = False
    next_experiment: str | None = None


class LabRun(LabSchema):
    """run.json of one lab run."""

    run_id: str
    objective: str
    subject: LabSubject
    mode: LabMode
    status: LabStatus
    budget: LabBudget
    started_at: str | None = None
    finished_at: str | None = None
    omnigent: LabOmnigent
    spec_hash: str | None = None
    metrics: LabMetrics
    outcome: LabOutcome
    error: str | None = None
    pending_approvals: list[str] = Field(
        default_factory=list, description="IDs of approval requests that wait for a human decision"
    )


class LabSource(LabSchema):
    database: str
    record_id: str
    url: str


class LabEvent(LabSchema):
    """One line of record.jsonl, the shared research record."""

    seq: int
    at: str
    run_id: str
    agent: LabAgentName
    type: LabEventType
    payload: dict[str, Any]
    refs: list[str] = Field(default_factory=list)
    sources: list[LabSource] = Field(default_factory=list)


class LabRunDetail(LabRun):
    events: list[LabEvent]
    report: str | None = Field(
        default=None, description="The final report in markdown, when one was recorded"
    )


class LabRunList(Schema):
    items: list[LabRun]
    total: int


class LabEventsPage(Schema):
    run_id: str
    status: LabStatus
    events: list[LabEvent]
    last_seq: int = Field(description="Highest seq in the record; pass it as after to get what follows")
    pending_approvals: list[str]


class LabBudgetInput(BaseModel):
    max_tool_calls: int | None = Field(default=None, ge=20, le=400)
    max_compute_seconds: float | None = Field(default=None, ge=0, le=1800)


class LabRunCreate(BaseModel):
    variant_id: str = Field(description="GENE-p.Ref3PosAlt3, for example BTK-p.Arg28His")
    objective: str | None = Field(default=None, max_length=600, description="The scientist's objective")
    mode: LabMode = "specialist_lab"
    budget: LabBudgetInput | None = None


class LabRunStarted(Schema):
    run_id: str
    status: LabStatus
    mode: LabMode
    run_url: str
    events_url: str


class LabApprovalInput(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=600)


class LabApprovalResult(Schema):
    run_id: str
    approval_id: str
    decision: Literal["approved", "rejected"]
    event: LabEvent


class LabAgentTool(LabSchema):
    name: str
    kind: Literal["retrieval", "record", "experiment"]
    requires_approval: bool
    description: str


class LabAgent(LabSchema):
    id: str
    title: str
    model: str
    harness: str
    decision: str = Field(description="The scientific decision the agent owns")
    inputs: str
    output: str
    tools: list[LabAgentTool]
    orchestration_tools: list[str] = Field(default_factory=list)
    policies: list[str]
    spec_path: str
    prompt_path: str
    prompt: str | None = None


class LabPolicy(LabSchema):
    id: str
    name: str
    handler: str
    description: str
    phases: list[str]


class LabTest(LabSchema):
    tool: str
    title: str
    measures: str
    bears_on: dict[str, str]
    cost: dict[str, float]
    requires_approval: bool
    controls: list[str]
    limitations: list[str]


class LabAgentsResponse(LabSchema):
    """Agent specifications and policies of the lab, as generated from the registry."""

    generated_from: str
    orchestration: dict[str, Any]
    agents: list[LabAgent]
    baseline: LabAgent
    policies: list[LabPolicy]
    approval: dict[str, Any]
    tests: dict[str, LabTest]
    mechanism_classes: dict[str, str]
    closing_tools: list[str] = Field(default_factory=list)


class LabBenchmarkAgreement(LabSchema):
    n_with_reference: int = 0
    n_agree: int = 0


class LabBenchmarkArm(LabSchema):
    id: LabMode
    label: str | None = None
    runs: int = 0
    median_wall_seconds: float | None = None
    mean_tool_calls: float | None = None
    mean_distinct_sources: float | None = None
    mean_evidence_items: float | None = None
    agreement: LabBenchmarkAgreement | None = None
    decision_changed: int | None = None


class LabBenchmarkComparison(LabSchema):
    metric: str | None = None
    baseline: float | None = None
    lab: float | None = None
    ratio: float | None = None
    note: str | None = None


class LabBenchmarkVariant(LabSchema):
    variant_id: str
    arm: LabMode
    run_id: str | None = None
    wall_seconds: float | None = None
    distinct_sources: int | None = None
    favoured_after: str | None = None
    reference_mechanism: str | None = None
    agrees: bool | None = None
    decision_changed: bool | None = None


class LabBenchmark(LabSchema):
    """lab/experiments/results/latest.json: the lab measured against the single-agent control."""

    generated_at: str | None = None
    question: str | None = None
    conditions: dict[str, Any] = Field(default_factory=dict)
    n_variants: int | None = None
    arms: list[LabBenchmarkArm] = Field(default_factory=list)
    comparison: LabBenchmarkComparison | None = None
    per_variant: list[LabBenchmarkVariant] = Field(default_factory=list)
    controls: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    next_experiment: str | None = None
