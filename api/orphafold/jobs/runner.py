"""Runs one job: claim it, call the handler, record the outcome, write the manifest.

State machine: queued -> running -> succeeded | failed | cancelled. An interrupted job of a
restartable handler goes back to queued; any other interrupted job fails with code 'interrupted'.
"""

import asyncio
import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, select, update

from orphafold.artifacts.store import get_artifact_store
from orphafold.config import get_settings
from orphafold.db.models import Actor, Artifact, Job
from orphafold.db.session import session_scope
from orphafold.hashing import to_jsonable
from orphafold.ids import ARTIFACT_PREFIX, new_id, utcnow
from orphafold.jobs.context import JobCancelled, JobContext, JobFailed
from orphafold.jobs.events import append_event, cancel_signals
from orphafold.jobs.manifest import MANIFEST_ARTIFACT_NAME, ManifestArtifact, ManifestBuilder
from orphafold.jobs.registry import JobHandler, get_handler
from orphafold.log import get_logger
from orphafold.providers.base import ProviderError
from orphafold.schemas.common import SYSTEM_ACTOR, ActorRef, StructureOrigin
from orphafold.schemas.jobs import JOB_TRANSITIONS, ArtifactRole, JobStage, JobStatus, StageStatus

logger = get_logger(__name__)

INTERRUPTED_ERROR = {"code": "interrupted", "message": "The worker stopped before this job finished."}


class InvalidTransition(Exception):
    pass


def check_transition(current: str, target: JobStatus) -> None:
    if target not in JOB_TRANSITIONS[JobStatus(current)]:
        raise InvalidTransition(f"job cannot go from {current} to {target.value}")


async def _claim(job_id: str, worker_id: str) -> Job | None:
    """queued -> running, atomically. None when the job is gone, taken or cancelled."""
    now = utcnow()
    async with session_scope() as session:
        claimed = await session.execute(
            update(Job)
            .where(Job.id == job_id, Job.status == JobStatus.QUEUED.value, Job.cancel_requested.is_(False))
            .values(
                status=JobStatus.RUNNING.value,
                started_at=now,
                heartbeat_at=now,
                completed_at=None,
                worker_id=worker_id,
                attempts=Job.attempts + 1,
            )
        )
        if claimed.rowcount != 1:
            return None
        return await session.get(Job, job_id, populate_existing=True)


async def _heartbeat(job_id: str, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            async with session_scope() as session:
                await session.execute(update(Job).where(Job.id == job_id).values(heartbeat_at=utcnow()))
        except Exception:
            logger.warning("Heartbeat for %s failed", job_id, exc_info=True)


async def _actor_ref(actor_id: str | None) -> ActorRef:
    if actor_id is None:
        return SYSTEM_ACTOR
    async with session_scope() as session:
        actor = await session.get(Actor, actor_id)
    return ActorRef(actor_id=actor_id, kind=actor.kind if actor else "anonymous")  # type: ignore[arg-type]


async def write_manifest(
    job: Job,
    *,
    status: JobStatus,
    completed_at: datetime,
    stages: list[JobStage],
    builder: ManifestBuilder,
    error: dict[str, Any] | None,
) -> str:
    """Build the manifest, store it as the job's manifest.json artifact and return its hash."""
    store = get_artifact_store()
    async with session_scope() as session:
        rows = await session.scalars(
            select(Artifact)
            .where(Artifact.job_id == job.id, Artifact.role != ArtifactRole.MANIFEST.value)
            .order_by(Artifact.created_at, Artifact.name)
        )
        artifacts = [
            ManifestArtifact(
                artifact_id=row.id,
                role=ArtifactRole(row.role),
                path=row.name,
                media_type=row.media_type,
                size_bytes=row.size_bytes,
                sha256=row.sha256,
                structure_origin=StructureOrigin(row.structure_origin) if row.structure_origin else None,
                sample_index=row.sample_index,
            )
            for row in rows
        ]
    document = builder.build(
        job_id=job.id,
        kind=job.kind,
        status=status,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=completed_at,
        actor=await _actor_ref(job.actor_id),
        project_id=job.project_id,
        parent_job_id=job.parent_job_id,
        request=job.params,
        stages=stages,
        artifacts=artifacts,
        worker_id=job.worker_id,
        attempts=job.attempts,
        error=error,
    )
    body = json.dumps(document, indent=2, ensure_ascii=False).encode("utf-8")
    stored = await store.put_bytes(f"jobs/{job.id}/{MANIFEST_ARTIFACT_NAME}", body, "application/json")
    async with session_scope() as session:
        await session.execute(
            delete(Artifact).where(Artifact.job_id == job.id, Artifact.name == MANIFEST_ARTIFACT_NAME)
        )
        session.add(
            Artifact(
                id=new_id(ARTIFACT_PREFIX),
                job_id=job.id,
                actor_id=job.actor_id,
                name=MANIFEST_ARTIFACT_NAME,
                role=ArtifactRole.MANIFEST.value,
                media_type="application/json",
                size_bytes=stored.size_bytes,
                sha256=stored.sha256,
                storage_key=stored.key,
            )
        )
    return document["integrity"]["manifest_sha256"]


async def finish_job(
    job: Job,
    *,
    status: JobStatus,
    stages: list[JobStage],
    builder: ManifestBuilder,
    result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    """Move a job to a terminal status and write its manifest. Used by the runner and by recovery."""
    check_transition(job.status, status)
    completed_at = utcnow()
    manifest_hash: str | None = None
    try:
        manifest_hash = await write_manifest(
            job, status=status, completed_at=completed_at, stages=stages, builder=builder, error=error
        )
    except Exception:
        logger.exception("Manifest for %s could not be written", job.id)
        if status is JobStatus.SUCCEEDED:
            status = JobStatus.FAILED
            result = None
            error = {"code": "manifest_failed", "message": "The run manifest could not be written."}
    async with session_scope() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(
                status=status.value,
                result=result,
                error=error,
                completed_at=completed_at,
                stages=[stage.model_dump(mode="json") for stage in stages],
                manifest_sha256=manifest_hash,
            )
        )
    cancel_signals.discard(job.id)
    await append_event(
        job.id,
        "status",
        level="error" if status is JobStatus.FAILED else "info",
        message=error["message"] if error else None,
        data={"status": status.value, "error": error, "manifest_sha256": manifest_hash},
    )
    logger.info("Job %s %s", job.id, status.value)


async def _requeue(job: Job, context: JobContext, reason: str) -> None:
    async with session_scope() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(
                status=JobStatus.QUEUED.value,
                stages=context.reset_stages(),
                worker_id=None,
                heartbeat_at=None,
            )
        )
    await append_event(
        job.id, "status", level="warning", message=reason, data={"status": JobStatus.QUEUED.value}
    )


def _error(code: str, message: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"code": code, "message": message, "detail": to_jsonable(detail) if detail else None}


async def _interrupted(job: Job, context: JobContext, handler: JobHandler | None) -> None:
    """The worker is shutting down while the job runs."""
    settings = get_settings()
    if handler is not None and handler.restartable and job.attempts < settings.job_max_attempts:
        await context.close_stages(StageStatus.CANCELLED, "Interrupted by worker shutdown.")
        await _requeue(job, context, "Interrupted by worker shutdown; the job will restart.")
        return
    await context.close_stages(StageStatus.FAILED, "Interrupted by worker shutdown.")
    await finish_job(
        job,
        status=JobStatus.FAILED,
        stages=context.stages,
        builder=context.manifest,
        error=dict(INTERRUPTED_ERROR),
    )


async def run_job(job_id: str, *, worker_id: str) -> None:
    job = await _claim(job_id, worker_id)
    if job is None:
        return
    settings = get_settings()
    handler = get_handler(job.kind)
    context = JobContext(
        job_id=job.id,
        kind=job.kind,
        params=job.params,
        actor_id=job.actor_id,
        project_id=job.project_id,
        stages=[JobStage(id=stage["id"], label=stage["label"]) for stage in job.stages or []],
        store=get_artifact_store(),
        settings=settings,
    )
    logger.info("Job %s (%s) started, attempt %d", job.id, job.kind, job.attempts)
    await append_event(
        job.id, "status", message="Started", data={"status": JobStatus.RUNNING.value, "attempt": job.attempts}
    )
    heartbeat = asyncio.create_task(_heartbeat(job.id, settings.job_heartbeat_seconds))

    status = JobStatus.FAILED
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    closing = StageStatus.FAILED
    try:
        if handler is None:
            raise JobFailed("handler_missing", f"No handler is installed for job kind '{job.kind}'.")
        try:
            params = handler.params_model.model_validate(job.params)
        except ValidationError as invalid:
            raise JobFailed("invalid_params", "The stored job parameters are no longer valid.") from invalid
        context.params = params
        output = await handler.run(context, params)
        if handler.requires_seed and "seed" not in context.manifest.parameters:
            raise JobFailed(
                "manifest_incomplete",
                "The run did not record its random seed, so it cannot be reproduced.",
            )
        if isinstance(output, BaseModel):
            output = output.model_dump(mode="json")
        result = to_jsonable(output) if output is not None else None
        status, closing = JobStatus.SUCCEEDED, StageStatus.DONE
    except JobCancelled:
        status, closing = JobStatus.CANCELLED, StageStatus.CANCELLED
    except (JobFailed, ProviderError) as failure:
        error = _error(failure.code, failure.message, failure.detail)
    except asyncio.CancelledError:
        heartbeat.cancel()
        await asyncio.shield(_interrupted(job, context, handler))
        context.cleanup()
        raise
    except Exception as unexpected:
        logger.exception("Job %s failed unexpectedly", job.id)
        error = _error(
            "internal_error", f"The job failed unexpectedly: {type(unexpected).__name__}: {unexpected}"[:500]
        )
    finally:
        heartbeat.cancel()

    try:
        await context.close_stages(closing, error["message"] if error else None)
        await finish_job(
            job, status=status, stages=context.stages, builder=context.manifest, result=result, error=error
        )
    finally:
        context.cleanup()
