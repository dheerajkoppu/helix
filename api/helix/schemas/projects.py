"""Research projects: items, the research trail, hypotheses, snapshots and fork lineage."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from helix.schemas.common import ActorRef, Evidence, EvidenceClass, Schema


class ProjectVisibility(StrEnum):
    PRIVATE = "private"
    UNLISTED = "unlisted"
    PUBLIC = "public"


class ItemKind(StrEnum):
    DISEASE = "disease"
    GENE = "gene"
    VARIANT = "variant"
    PROTEIN = "protein"
    STRUCTURE = "structure"
    RESIDUE = "residue"
    COMPOUND = "compound"
    PAPER = "paper"
    JOB = "job"
    NOTE = "note"
    HYPOTHESIS = "hypothesis"
    SCREENSHOT = "screenshot"


class HypothesisStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    RETIRED = "retired"


class ProjectScope(StrEnum):
    MINE = "mine"
    PUBLIC = "public"


class ItemOrigin(Schema):
    """Where an item came from: the view it was saved from and the trail node it followed."""

    route: str | None = Field(default=None, description="App path the item was saved from, with its query")
    url_state: dict[str, str] = Field(default_factory=dict, description="URL parameters of that view")
    note: str | None = None
    parent_item_id: str | None = None
    created_at: datetime | None = None
    forked_from_item_id: str | None = None


class ItemOriginInput(Schema):
    route: str | None = Field(default=None, max_length=2000)
    url_state: dict[str, str] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=2000)


class HypothesisInput(Schema):
    statement: str = Field(min_length=1, max_length=4000)
    supporting_item_ids: list[str] = Field(
        min_length=1, description="Project items the statement rests on; at least one"
    )
    status: HypothesisStatus = HypothesisStatus.DRAFT


class HypothesisUpdate(Schema):
    statement: str | None = Field(default=None, min_length=1, max_length=4000)
    supporting_item_ids: list[str] | None = Field(default=None, min_length=1)
    status: HypothesisStatus | None = None


class HypothesisOut(Schema):
    statement: str
    status: HypothesisStatus
    supporting_item_ids: list[str]
    derived_from: list[str] = Field(description="Item, evidence and job IDs the statement rests on")
    record: Evidence = Field(description="The hypothesis as an evidence record, class helix_hypothesis")


class ProjectItemCreate(Schema):
    kind: ItemKind
    ref: str | None = Field(default=None, max_length=300, description="Entity ID in the binding ID scheme")
    label: str = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=20000)
    origin: ItemOriginInput | None = None
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    parent_item_id: str | None = Field(
        default=None, description="Trail node this item follows; defaults to the active node"
    )
    attach_to_active: bool = Field(
        default=True, description="Without parent_item_id, follow the project's active trail node"
    )
    hypothesis: HypothesisInput | None = Field(default=None, description="Required when kind is hypothesis")


class ProjectItemUpdate(Schema):
    label: str | None = Field(default=None, min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=20000)
    data: dict[str, Any] | None = None
    parent_item_id: str | None = None
    detach: bool = Field(default=False, description="Make the item a trail root")
    hypothesis: HypothesisUpdate | None = None


class ProjectItemOut(Schema):
    id: str
    project_id: str
    kind: ItemKind
    ref: str | None
    label: str
    note: str | None
    origin: ItemOrigin
    parent_item_id: str | None
    position: int
    href: str | None = Field(description="App path that reopens the view the item was saved from")
    evidence: list[dict[str, Any]]
    evidence_class: EvidenceClass | None = Field(
        description="helix_hypothesis for hypotheses; null for saved entities, which carry their own evidence"
    )
    data: dict[str, Any]
    hypothesis: HypothesisOut | None
    created_at: datetime
    updated_at: datetime


class TrailNode(Schema):
    item_id: str
    kind: ItemKind
    label: str
    ref: str | None
    parent_item_id: str | None
    depth: int
    order: int = Field(description="Depth-first order of the trail")
    href: str | None
    created_at: datetime


class TrailEdge(Schema):
    source: str
    target: str
    relation: str = Field(description="led_to (trail step) or supports (item cited by a hypothesis)")


class TrailOut(Schema):
    nodes: list[TrailNode]
    edges: list[TrailEdge]
    roots: list[str]
    active_item_id: str | None


class Lineage(Schema):
    forked_from_project_id: str | None
    forked_from_snapshot_id: str | None
    forked_from_title: str | None
    root_project_id: str
    fork_depth: int
    fork_count: int = Field(description="Projects in this lineage other than the root")


class SnapshotSummary(Schema):
    id: str
    project_id: str
    sequence_number: int
    parent_snapshot_id: str | None
    message: str | None
    content_sha256: str
    withdrawn: bool
    share_path: str = Field(description="Stable app path of the frozen view: /s/<snapshot_id>")
    created_by: ActorRef | None
    created_at: datetime


class ProjectCreate(Schema):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    visibility: ProjectVisibility = ProjectVisibility.PRIVATE
    license: str = Field(default="CC-BY-4.0", pattern=r"^(CC-BY-4\.0|CC0-1\.0)$")


class ProjectUpdate(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    visibility: ProjectVisibility | None = None
    license: str | None = Field(default=None, pattern=r"^(CC-BY-4\.0|CC0-1\.0)$")
    active_item_id: str | None = None


class ProjectOut(Schema):
    id: str
    title: str
    description: str | None
    visibility: ProjectVisibility
    license: str
    is_owner: bool
    owner: ActorRef
    head_snapshot_id: str | None
    share_path: str | None
    lineage: Lineage
    active_item_id: str | None
    item_count: int
    item_counts: dict[str, int]
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectOut):
    items: list[ProjectItemOut]
    trail: TrailOut
    snapshots: list[SnapshotSummary]
    unpublished_changes: bool = Field(description="The project differs from its head snapshot")


class PublishRequest(Schema):
    message: str | None = Field(default=None, max_length=1000)


class ForkRequest(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=300)


class SnapshotOut(SnapshotSummary):
    title: str
    description: str | None
    license: str
    lineage: Lineage
    items: list[ProjectItemOut]
    trail: TrailOut
    document: dict[str, Any] = Field(description="project.json of this snapshot")
    project_visibility: ProjectVisibility
    project_available: bool = Field(description="The live project can be opened by the caller")
    is_owner: bool
    is_head: bool
