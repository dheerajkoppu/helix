"""Jobs: create, list, read, follow (SSE), cancel, manifest and artifacts."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sse_starlette import EventSourceResponse, ServerSentEvent

from orphafold.config import API_PREFIX
from orphafold.db.models import Job
from orphafold.db.session import session_scope
from orphafold.deps import ArtifactStoreDep, CurrentActor, OptionalActor, Pagination, QueueDep, SessionDep
from orphafold.errors import PROBLEM_RESPONSES, NotFound
from orphafold.jobs import service
from orphafold.jobs.events import event_bus, events_after
from orphafold.schemas.common import Page
from orphafold.schemas.jobs import TERMINAL_STATUSES, JobCreate, JobEventOut, JobKindOut, JobOut, JobStatus

router = APIRouter(tags=["jobs"], responses=PROBLEM_RESPONSES)

EVENT_POLL_SECONDS = 1.0
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


@router.get("/job-kinds", response_model=list[JobKindOut], summary="Job kinds this deployment can run")
async def list_job_kinds() -> list[JobKindOut]:
    return service.job_kinds()


@router.post(
    "/jobs",
    response_model=JobOut,
    status_code=202,
    summary="Start a computational job",
    responses={200: {"model": JobOut, "description": "An identical job is already queued or running"}},
)
async def create_job(
    body: JobCreate, response: Response, session: SessionDep, actor: CurrentActor, queue: QueueDep
) -> JobOut:
    job, created = await service.create_job(session, actor, body, queue)
    response.status_code = 202 if created else 200
    response.headers["Location"] = f"{API_PREFIX}/jobs/{job.id}"
    job, artifacts = await service.get_job(session, job.id)
    return service.job_out(job, artifacts)


@router.get("/jobs", response_model=Page[JobOut], summary="Jobs of the calling workspace, newest first")
async def list_jobs(
    session: SessionDep,
    actor: OptionalActor,
    page: Pagination,
    status: Annotated[list[JobStatus] | None, Query(description="Repeatable")] = None,
    kind: Annotated[str | None, Query()] = None,
    subject_type: Annotated[
        str | None, Query(description="Entity type the job is about, e.g. protein")
    ] = None,
    subject_id: Annotated[str | None, Query(description="Entity ID the job is about, e.g. Q06187")] = None,
    project_id: Annotated[str | None, Query()] = None,
) -> Page[JobOut]:
    return await service.list_jobs(
        session,
        actor,
        status=status,
        kind=kind,
        subject_type=subject_type,
        subject_id=subject_id,
        project_id=project_id,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/jobs/{job_id}", response_model=JobOut, summary="One job with stages, result and artifacts")
async def get_job(job_id: str, session: SessionDep) -> JobOut:
    job, artifacts = await service.get_job(session, job_id)
    return service.job_out(job, artifacts)


@router.get("/jobs/{job_id}/log", response_model=list[JobEventOut], summary="Job events as JSON")
async def get_job_log(
    job_id: str,
    session: SessionDep,
    after: Annotated[int, Query(ge=0, description="Return events with an ID greater than this")] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> list[JobEventOut]:
    await service.get_job(session, job_id)
    return [JobEventOut.model_validate(event) for event in await events_after(job_id, after, limit)]


async def _job_status(job_id: str) -> JobStatus | None:
    async with session_scope() as session:
        status = await session.scalar(select(Job.status).where(Job.id == job_id))
    return JobStatus(status) if status else None


async def _event_stream(job_id: str, after: int) -> AsyncIterator[ServerSentEvent]:
    """Replay stored events after the given ID, then follow new ones until the job ends."""
    last_id = after
    signal = event_bus.subscribe(job_id)
    try:
        while True:
            signal.clear()
            events = await events_after(job_id, last_id)
            finished: JobStatus | None = None
            for event in events:
                last_id = event.id
                payload = JobEventOut.model_validate(event).model_dump(mode="json")
                yield ServerSentEvent(data=json.dumps(payload), event=event.type, id=str(event.id))
                reported = (event.data or {}).get("status") if event.type == "status" else None
                if reported in {status.value for status in TERMINAL_STATUSES}:
                    finished = JobStatus(reported)
            if finished is None and not events:
                # The terminal status event is the normal end marker; this covers a stream that
                # starts after it
                status = await _job_status(job_id)
                if status in TERMINAL_STATUSES and not await events_after(job_id, last_id, limit=1):
                    finished = status
            if finished is not None:
                yield ServerSentEvent(
                    data=json.dumps({"job_id": job_id, "status": finished.value}), event="end"
                )
                return
            if not events:
                try:
                    await asyncio.wait_for(signal.wait(), EVENT_POLL_SECONDS)
                except TimeoutError:
                    pass
    finally:
        event_bus.unsubscribe(job_id, signal)


@router.get(
    "/jobs/{job_id}/events",
    summary="Follow a job (Server-Sent Events)",
    response_class=EventSourceResponse,
    responses={
        200: {
            "content": {"text/event-stream": {}},
            "description": "status, stage, log and artifact events, then end",
        }
    },
)
async def follow_job(
    job_id: str,
    session: SessionDep,
    after: Annotated[int | None, Query(ge=0, description="Resume after this event ID")] = None,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    await service.get_job(session, job_id)
    start = (
        after if after is not None else int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    )
    return EventSourceResponse(_event_stream(job_id, start), ping=15, headers={"Cache-Control": "no-store"})


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, summary="Request cancellation")
async def cancel_job(job_id: str, session: SessionDep, actor: OptionalActor) -> JobOut:
    await service.cancel_job(session, actor, job_id)
    job, artifacts = await service.get_job(session, job_id)
    return service.job_out(job, artifacts)


@router.get(
    "/jobs/{job_id}/manifest",
    summary="Immutable run manifest",
    responses={
        200: {"content": {"application/json": {}}, "description": "Run manifest (see docs/ARCHITECTURE.md)"}
    },
)
async def get_manifest(job_id: str, session: SessionDep, store: ArtifactStoreDep) -> Response:
    job, manifest = await service.read_manifest(session, job_id)
    body = await store.get_bytes(manifest.storage_key)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "ETag": f'"{job.manifest_sha256}"',
            "Cache-Control": IMMUTABLE_CACHE,
            "Content-Disposition": f'inline; filename="{job_id}.manifest.json"',
        },
    )


@router.get(
    "/jobs/{job_id}/artifacts/{name:path}",
    summary="Download a job artifact",
    responses={200: {"content": {"application/octet-stream": {}}, "description": "The stored file"}},
)
async def get_artifact(job_id: str, name: str, session: SessionDep, store: ArtifactStoreDep) -> Response:
    job, artifacts = await service.get_job(session, job_id)
    artifact = next((item for item in artifacts if item.name == name), None)
    if artifact is None:
        raise NotFound(f"Job {job_id} has no artifact named '{name}'.", code="artifact_not_found")
    finished = JobStatus(job.status) in TERMINAL_STATUSES
    headers = {
        "ETag": f'"{artifact.sha256}"',
        "Cache-Control": IMMUTABLE_CACHE if finished else "no-store",
    }
    filename = name.rsplit("/", 1)[-1]
    path = store.local_path(artifact.storage_key)
    if path is not None:
        if not path.is_file():
            raise NotFound(
                f"The file for artifact '{name}' is missing from storage.", code="artifact_file_missing"
            )
        return FileResponse(path, media_type=artifact.media_type, filename=filename, headers=headers)
    headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    headers["Content-Length"] = str(artifact.size_bytes)
    return StreamingResponse(
        store.iter_bytes(artifact.storage_key), media_type=artifact.media_type, headers=headers
    )
