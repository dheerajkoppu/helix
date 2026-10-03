"""Job schemas shared by the API, the job runner and model providers."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from helix.schemas.common import EntityRef, Schema, StructureDescriptor, StructureFiles, StructureOrigin


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset({JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED})

JOB_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    JobStatus.QUEUED: frozenset({JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.FAILED}),
    # running -> queued happens only when an interrupted, restartable job is recovered
    JobStatus.RUNNING: frozenset(
        {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.QUEUED}
    ),
    JobStatus.SUCCEEDED: frozenset(),
    JobStatus.FAILED: frozenset(),
    JobStatus.CANCELLED: frozenset(),
}


class StageStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class StageSpec(Schema):
    """A stage a job will really go through, declared before work starts."""

    id: str
    label: str


class StageProgress(Schema):
    """Measured progress inside a stage. Present only when the work reports real counts."""

    completed: float
    total: float | None = None
    unit: str | None = None


class JobStage(StageSpec):
    status: StageStatus = StageStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    detail: str | None = None
    progress: StageProgress | None = None


class JobError(Schema):
    code: str
    message: str
    detail: dict[str, Any] | None = None


class ArtifactRole(StrEnum):
    STRUCTURE = "structure"
    CONFIDENCE_SUMMARY = "confidence_summary"
    PAE = "pae"
    PDE = "pde"
    PLDDT = "plddt"
    AFFINITY = "affinity"
    MSA = "msa"
    MODEL_INPUT = "model_input"
    SOURCE_RESPONSE = "source_response"
    LOG = "log"
    MANIFEST = "manifest"
    OTHER = "other"


class ArtifactOut(Schema):
    id: str
    name: str
    role: ArtifactRole
    media_type: str
    size_bytes: int
    sha256: str
    url: str = Field(description="API path of the file; prefix with the API origin")
    structure_origin: StructureOrigin | None = None
    sample_index: int | None = None
    created_at: datetime


class JobCreate(Schema):
    kind: str = Field(description="A registered job kind; see GET /api/v1/job-kinds")
    params: dict[str, Any] = Field(default_factory=dict)
    title: str | None = Field(default=None, max_length=300)
    project_id: str | None = None
    parent_job_id: str | None = Field(default=None, description="Job this run repeats or corrects")


class JobOut(Schema):
    id: str
    kind: str
    title: str | None = None
    status: JobStatus
    provider_id: str | None = None
    subject: EntityRef | None = None
    params: dict[str, Any]
    stages: list[JobStage]
    current_stage: str | None = None
    result: dict[str, Any] | None = None
    error: JobError | None = None
    artifacts: list[ArtifactOut] = Field(default_factory=list)
    cancel_requested: bool = False
    attempts: int = 0
    actor_id: str | None = None
    project_id: str | None = None
    parent_job_id: str | None = None
    manifest_sha256: str | None = None
    manifest_url: str | None = None
    events_url: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class JobEventOut(Schema):
    id: int
    job_id: str
    type: str
    stage_id: str | None = None
    level: str | None = None
    message: str | None = None
    data: dict[str, Any] | None = None
    at: datetime


class StructureJobResult(Schema):
    """Result of every job kind that ends with a structure (JobOut.result)."""

    performs_inference: bool = Field(description="False when the structure was retrieved, not predicted")
    structure: StructureDescriptor = Field(description="File URLs point at this job's stored artifacts")
    upstream_files: StructureFiles | None = Field(
        default=None, description="Where a retrieved model's files live at the source"
    )
    gene_symbol: str | None = None
    variant_id: str | None = None


class JobKindOut(Schema):
    kind: str
    title: str
    description: str | None = None
    params_schema: dict[str, Any]
    result_schema: dict[str, Any] | None = Field(default=None, description="JSON Schema of JobOut.result")
    restartable: bool
    providers: list[str] = Field(default_factory=list)
