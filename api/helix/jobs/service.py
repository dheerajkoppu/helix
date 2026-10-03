"""Job operations used by the API: create, list, read, cancel, recover."""

import secrets
from datetime import timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from helix.config import API_PREFIX, get_settings
from helix.db.models import Actor, Artifact, Job
from helix.db.session import session_scope
from helix.errors import BadRequest, Conflict, FieldProblem, Forbidden, NotFound, ValidationFailed
from helix.hashing import canonical_sha256
from helix.ids import JOB_PREFIX, new_id, utcnow
from helix.jobs.context import artifact_out
from helix.jobs.events import append_event, cancel_signals
from helix.jobs.manifest import MANIFEST_ARTIFACT_NAME, ManifestBuilder
from helix.jobs.queue import JobQueue
from helix.jobs.registry import all_handlers, get_handler
from helix.jobs.runner import INTERRUPTED_ERROR, finish_job
from helix.log import get_logger
from helix.providers.base import all_providers
from helix.schemas.common import EntityRef, EntityType, Page
from helix.schemas.jobs import (
    TERMINAL_STATUSES,
    ArtifactRole,
    JobCreate,
    JobError,
    JobKindOut,
    JobOut,
    JobStage,
    JobStatus,
    StageStatus,
)

logger = get_logger(__name__)


_WORKER_ID = f"worker-{secrets.token_hex(4)}"


def worker_identity() -> str:
    """Random per-process ID. Host names stay out of manifests, which are meant to be shared."""
    return _WORKER_ID


def _subject(job: Job) -> EntityRef | None:
    if not job.subject_type or not job.subject_id:
        return None
    try:
        return EntityRef.of(EntityType(job.subject_type), job.subject_id, job.subject_label)
    except ValueError:
        return None


def job_out(job: Job, artifacts: list[Artifact] | None = None) -> JobOut:
    stages = [JobStage.model_validate(stage) for stage in job.stages or []]
    current = next((stage.id for stage in stages if stage.status is StageStatus.RUNNING), None)
    listed = [artifact for artifact in artifacts or [] if artifact.role != ArtifactRole.MANIFEST.value]
    return JobOut(
        id=job.id,
        kind=job.kind,
        title=job.title,
        status=JobStatus(job.status),
        provider_id=job.provider_id,
        subject=_subject(job),
        params=job.params or {},
        stages=stages,
        current_stage=current,
        result=job.result,
        error=JobError.model_validate(job.error) if job.error else None,
        artifacts=[artifact_out(artifact) for artifact in listed],
        cancel_requested=job.cancel_requested,
        attempts=job.attempts,
        actor_id=job.actor_id,
        project_id=job.project_id,
        parent_job_id=job.parent_job_id,
        manifest_sha256=job.manifest_sha256,
        manifest_url=f"{API_PREFIX}/jobs/{job.id}/manifest" if job.manifest_sha256 else None,
        events_url=f"{API_PREFIX}/jobs/{job.id}/events",
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def job_kinds() -> list[JobKindOut]:
    providers_by_kind: dict[str, list[str]] = {}
    for provider in all_providers():
        for kind in provider.job_kinds:
            providers_by_kind.setdefault(kind, []).append(provider.id)
    return [
        JobKindOut(
            kind=handler.kind,
            title=handler.title,
            description=handler.description,
            params_schema=handler.params_model.model_json_schema(),
            result_schema=handler.result_model.model_json_schema(mode="serialization")
            if handler.result_model
            else None,
            restartable=handler.restartable,
            providers=providers_by_kind.get(handler.kind, []),
        )
        for handler in all_handlers()
    ]


async def create_job(
    session: AsyncSession, actor: Actor, request: JobCreate, queue: JobQueue
) -> tuple[Job, bool]:
    """Validate and enqueue a job. Returns (job, created); created is False when an identical job
    of the same workspace is already queued or running and is returned instead of a duplicate."""
    handler = get_handler(request.kind)
    if handler is None:
        known = ", ".join(item.kind for item in all_handlers()) or "none"
        raise BadRequest(f"Unknown job kind '{request.kind}'. Available: {known}.", code="unknown_job_kind")
    try:
        params = handler.params_model.model_validate(request.params)
    except ValidationError as invalid:
        raise ValidationFailed(
            "The job parameters did not match the expected shape.",
            errors=[
                FieldProblem(
                    location=["body", "params", *problem["loc"]], message=problem["msg"], type=problem["type"]
                ).model_dump()
                for problem in invalid.errors()
            ],
        ) from invalid

    stored_params: dict[str, Any] = params.model_dump(mode="json")
    params_hash = canonical_sha256({"kind": handler.kind, "params": stored_params})
    duplicate = await session.scalar(
        select(Job).where(
            Job.actor_id == actor.id,
            Job.params_hash == params_hash,
            Job.status.in_([JobStatus.QUEUED.value, JobStatus.RUNNING.value]),
            Job.cancel_requested.is_(False),
        )
    )
    if duplicate is not None:
        return duplicate, False

    if request.parent_job_id and await session.get(Job, request.parent_job_id) is None:
        raise BadRequest(f"Parent job {request.parent_job_id} does not exist.", code="unknown_parent_job")

    subject = handler.job_subject(params)
    job = Job(
        id=new_id(JOB_PREFIX),
        kind=handler.kind,
        title=request.title or handler.job_title(params),
        status=JobStatus.QUEUED.value,
        provider_id=handler.provider_id(params),
        actor_id=actor.id,
        project_id=request.project_id,
        parent_job_id=request.parent_job_id,
        params=stored_params,
        params_hash=params_hash,
        subject_type=subject.type.value if subject else None,
        subject_id=subject.id if subject else None,
        subject_label=subject.label if subject else None,
        stages=[
            JobStage(id=spec.id, label=spec.label).model_dump(mode="json") for spec in handler.plan(params)
        ],
        created_at=utcnow(),
    )
    session.add(job)
    await session.commit()
    await append_event(job.id, "status", message="Queued", data={"status": JobStatus.QUEUED.value})
    await queue.enqueue(job.id)
    return job, True


async def get_job(session: AsyncSession, job_id: str) -> tuple[Job, list[Artifact]]:
    job = await session.get(Job, job_id, populate_existing=True)
    if job is None:
        raise NotFound(f"Job {job_id} does not exist.", code="job_not_found")
    artifacts = await session.scalars(
        select(Artifact).where(Artifact.job_id == job_id).order_by(Artifact.created_at, Artifact.name)
    )
    return job, list(artifacts)


async def list_jobs(
    session: AsyncSession,
    actor: Actor | None,
    *,
    status: list[JobStatus] | None = None,
    kind: str | None = None,
    subject_type: str | None = None,
    subject_id: str | None = None,
    project_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page[JobOut]:
    """Jobs of the calling workspace, newest first. Empty without a workspace identity."""
    if actor is None:
        return Page[JobOut](items=[], total=0, limit=limit, offset=offset)
    conditions = [Job.actor_id == actor.id]
    if status:
        conditions.append(Job.status.in_([item.value for item in status]))
    if kind:
        conditions.append(Job.kind == kind)
    if subject_type:
        conditions.append(Job.subject_type == subject_type)
    if subject_id:
        conditions.append(Job.subject_id == subject_id)
    if project_id:
        conditions.append(Job.project_id == project_id)
    total = await session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0
    jobs = list(
        await session.scalars(
            select(Job)
            .where(*conditions)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    artifacts_by_job: dict[str, list[Artifact]] = {job.id: [] for job in jobs}
    if jobs:
        rows = await session.scalars(
            select(Artifact).where(Artifact.job_id.in_(list(artifacts_by_job))).order_by(Artifact.created_at)
        )
        for artifact in rows:
            artifacts_by_job[artifact.job_id or ""].append(artifact)
    return Page[JobOut](
        items=[job_out(job, artifacts_by_job[job.id]) for job in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )


async def cancel_job(session: AsyncSession, actor: Actor | None, job_id: str) -> Job:
    """Request cancellation. A queued job is cancelled at once; a running job stops at its next
    cancellation check."""
    job, _ = await get_job(session, job_id)
    if job.actor_id is not None and (actor is None or actor.id != job.actor_id):
        raise Forbidden("Only the workspace that started a job can cancel it.", code="not_job_owner")
    status = JobStatus(job.status)
    if status in TERMINAL_STATUSES:
        raise Conflict(f"Job {job_id} already finished ({status.value}).", code="job_already_finished")

    claimed_while_queued = await session.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == JobStatus.QUEUED.value)
        .values(cancel_requested=True)
    )
    await session.commit()
    if claimed_while_queued.rowcount == 1:
        stages = [JobStage.model_validate(stage) for stage in job.stages or []]
        for stage in stages:
            stage.status = StageStatus.SKIPPED
            stage.detail = "Not run."
        await append_event(job_id, "log", level="info", message="Cancelled before it started.")
        await finish_job(job, status=JobStatus.CANCELLED, stages=stages, builder=ManifestBuilder())
    else:
        await session.execute(update(Job).where(Job.id == job_id).values(cancel_requested=True))
        await session.commit()
        cancel_signals.add(job_id)
        await append_event(job_id, "log", level="info", message="Cancellation requested.")
    job, _ = await get_job(session, job_id)
    return job


async def read_manifest(session: AsyncSession, job_id: str) -> tuple[Job, Artifact]:
    job, artifacts = await get_job(session, job_id)
    manifest = next((artifact for artifact in artifacts if artifact.name == MANIFEST_ARTIFACT_NAME), None)
    if manifest is None or job.manifest_sha256 is None:
        raise Conflict(
            "The manifest is written once, when the job reaches a terminal status. "
            f"This job is {job.status}.",
            code="manifest_not_ready",
        )
    return job, manifest


async def recover_jobs(queue: JobQueue, *, all_running_are_orphaned: bool) -> dict[str, int]:
    """Repair job state after a restart.

    Running jobs with no live worker (every running job when the queue is in-process, otherwise
    those whose heartbeat went stale) restart when their handler is restartable and attempts
    remain; the rest fail with code 'interrupted'. Queued jobs missing from the queue are enqueued.
    """
    settings = get_settings()
    stale_before = utcnow() - timedelta(seconds=settings.job_stale_after_seconds)
    counts = {"requeued": 0, "failed": 0, "enqueued": 0}

    async with session_scope() as session:
        running = list(await session.scalars(select(Job).where(Job.status == JobStatus.RUNNING.value)))
    for job in running:
        orphaned = all_running_are_orphaned or job.heartbeat_at is None or job.heartbeat_at < stale_before
        if not orphaned:
            continue
        handler = get_handler(job.kind)
        stages = [JobStage.model_validate(stage) for stage in job.stages or []]
        if handler is not None and handler.restartable and job.attempts < settings.job_max_attempts:
            reset = [JobStage(id=stage.id, label=stage.label).model_dump(mode="json") for stage in stages]
            async with session_scope() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job.id, Job.status == JobStatus.RUNNING.value)
                    .values(status=JobStatus.QUEUED.value, stages=reset, worker_id=None, heartbeat_at=None)
                )
            await append_event(
                job.id,
                "status",
                level="warning",
                message="The worker stopped while this job was running; it will restart.",
                data={"status": JobStatus.QUEUED.value},
            )
            counts["requeued"] += 1
        else:
            for stage in stages:
                if stage.status is StageStatus.RUNNING:
                    stage.status = StageStatus.FAILED
                    stage.detail = INTERRUPTED_ERROR["message"]
                    stage.completed_at = utcnow()
                elif stage.status is StageStatus.PENDING:
                    stage.status = StageStatus.SKIPPED
                    stage.detail = "Not run."
            await finish_job(
                job,
                status=JobStatus.FAILED,
                stages=stages,
                builder=ManifestBuilder(),
                error=dict(INTERRUPTED_ERROR),
            )
            counts["failed"] += 1

    async with session_scope() as session:
        queued = list(
            await session.scalars(
                select(Job.id)
                .where(Job.status == JobStatus.QUEUED.value, Job.cancel_requested.is_(False))
                .order_by(Job.created_at)
            )
        )
    for job_id in queued:
        if not await queue.contains(job_id):
            await queue.enqueue(job_id)
            counts["enqueued"] += 1
    if any(counts.values()):
        logger.info("Job recovery: %s", counts)
    return counts
