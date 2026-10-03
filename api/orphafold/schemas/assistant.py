"""Request, stream and answer shapes of the research assistant ("Orpha")."""

from typing import Any, Literal

from pydantic import ConfigDict, Field

from orphafold.schemas.common import Aggregated, Evidence, Schema

AudienceLevel = Literal["high_school", "undergraduate", "researcher", "structural_biologist"]
SegmentKind = Literal["database_fact", "paper_finding", "computational_result", "reasoning_hypothesis"]

SEGMENT_KINDS: tuple[SegmentKind, ...] = (
    "database_fact",
    "paper_finding",
    "computational_result",
    "reasoning_hypothesis",
)


class AssistantContext(Schema):
    """What the reader was looking at when they asked. Every field is optional."""

    model_config = ConfigDict(extra="ignore")

    route: str | None = Field(default=None, max_length=600)
    disease: str | None = Field(default=None, max_length=200, description="Catalog disease slug")
    gene: str | None = Field(default=None, max_length=40, description="HGNC symbol")
    accession: str | None = Field(default=None, max_length=20, description="UniProt accession")
    variant: str | None = Field(default=None, max_length=80, description="GENE-p.Ref3PosAlt3 or ClinVar VCV")
    residue: int | None = Field(default=None, ge=1, le=40000, description="UniProt canonical position")
    structure: str | None = Field(default=None, max_length=120, description="pdb:, afdb: or of: structure ID")
    compound: str | None = Field(default=None, max_length=60, description="InChIKey or ChEMBL ID")
    project: str | None = Field(default=None, max_length=80, description="Project ID")
    comparison: str | None = Field(default=None, max_length=80, description="Comparison result (job) ID")


class ChatTurn(Schema):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(Schema):
    messages: list[ChatTurn] = Field(min_length=1, max_length=40)
    context: AssistantContext = Field(default_factory=AssistantContext)
    audience: AudienceLevel = "researcher"


class AnswerSegment(Schema):
    kind: SegmentKind
    text: str
    citations: list[str] = Field(
        default_factory=list, description="Keys into the answer's evidence list; only keys that resolved"
    )
    claimed_kind: SegmentKind | None = Field(
        default=None, description="The label the model gave when the server changed it"
    )
    note: str | None = Field(default=None, description="Why the server changed the label or dropped citations")
    heading: str | None = Field(default=None, description="Section of a source digest")


class CitedEvidence(Schema):
    key: str = Field(description="Citation key used by the segments, e.g. e3")
    tool: str | None = Field(default=None, description="The lookup that returned the record")
    evidence: Evidence


class Lookup(Schema):
    """One call the assistant made to an OrphaFold service."""

    id: str
    tool: str
    label: str
    ok: bool
    message: str | None = None
    evidence_count: int = 0


class AssistantAnswer(Aggregated):
    segments: list[AnswerSegment]
    evidence: list[CitedEvidence]
    lookups: list[Lookup] = Field(default_factory=list)
    generated_by: Literal["model", "source_digest"]
    model: str | None = Field(default=None, description="Model that served the answer; null for a digest")
    audience: AudienceLevel | None = None
    downgraded: int = Field(default=0, description="Segments the server relabelled as reasoning")
    relabelled: int = Field(default=0, description="Segments moved to the label their citations support")
    usage: dict[str, Any] = Field(default_factory=dict)


class AudienceOption(Schema):
    id: AudienceLevel
    label: str
    description: str


class SegmentKindOption(Schema):
    id: SegmentKind
    label: str
    description: str


class AssistantStatus(Schema):
    configured: bool
    setting: str = "ANTHROPIC_API_KEY"
    model: str
    message: str
    audiences: list[AudienceOption]
    segment_kinds: list[SegmentKindOption]
    tools: list[str]
