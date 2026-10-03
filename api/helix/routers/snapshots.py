"""Immutable project snapshots: the frozen view behind /s/<snapshot_id>, fork and exports."""

from typing import Any

from fastapi import APIRouter, Response

from helix.deps import ArtifactStoreDep, CurrentActor, OptionalActor, SessionDep
from helix.errors import PROBLEM_RESPONSES
from helix.schemas.projects import ForkRequest, ProjectDetail, SnapshotOut, SnapshotSummary
from helix.services import project_export
from helix.services import projects as service

router = APIRouter(prefix="/snapshots", tags=["snapshots"], responses=PROBLEM_RESPONSES)

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def attachment(filename: str, etag: str) -> dict[str, str]:
    return {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "ETag": f'"{etag}"',
        "Cache-Control": IMMUTABLE_CACHE,
    }


@router.get("/{snapshot_id}", response_model=SnapshotOut, summary="A frozen project state")
async def get_snapshot(snapshot_id: str, session: SessionDep, actor: OptionalActor) -> SnapshotOut:
    snapshot = await service.get_snapshot(session, snapshot_id, actor)
    return await service.snapshot_out(session, snapshot, actor)


@router.post(
    "/{snapshot_id}/fork",
    response_model=ProjectDetail,
    status_code=201,
    summary="Fork a snapshot into a new project of the calling workspace",
)
async def fork_snapshot(
    snapshot_id: str, session: SessionDep, actor: CurrentActor, body: ForkRequest | None = None
) -> ProjectDetail:
    project = await service.fork_snapshot(session, actor, snapshot_id, body or ForkRequest())
    return await service.project_detail(session, project, actor)


@router.post("/{snapshot_id}/withdraw", response_model=SnapshotSummary, summary="Unlist a snapshot (owner)")
async def withdraw_snapshot(snapshot_id: str, session: SessionDep, actor: CurrentActor) -> SnapshotSummary:
    snapshot = await service.set_withdrawn(session, actor, snapshot_id, True)
    return service.snapshot_summary(snapshot, await service._actors(session, {snapshot.created_by_actor_id}))


@router.post("/{snapshot_id}/restore", response_model=SnapshotSummary, summary="List a withdrawn snapshot again")
async def restore_snapshot(snapshot_id: str, session: SessionDep, actor: CurrentActor) -> SnapshotSummary:
    snapshot = await service.set_withdrawn(session, actor, snapshot_id, False)
    return service.snapshot_summary(snapshot, await service._actors(session, {snapshot.created_by_actor_id}))


@router.get("/{snapshot_id}/export.json", response_model=dict[str, Any], summary="project.json of the snapshot")
async def export_json(snapshot_id: str, session: SessionDep, actor: OptionalActor) -> Response:
    snapshot = await service.get_snapshot(session, snapshot_id, actor)
    return Response(
        content=project_export._json(snapshot.document),
        media_type="application/json",
        headers=attachment(f"{project_export.export_slug(snapshot.document)}.project.json", snapshot.content_sha256),
    )


@router.get(
    "/{snapshot_id}/export.md",
    summary="Markdown research report of the snapshot",
    responses={200: {"content": {"text/markdown": {}}, "description": "Research report"}},
)
async def export_markdown(
    snapshot_id: str, session: SessionDep, actor: OptionalActor, store: ArtifactStoreDep
) -> Response:
    snapshot = await service.get_snapshot(session, snapshot_id, actor)
    runs = await project_export.collect_run_manifests(session, store, snapshot.document)
    return Response(
        content=project_export.render_markdown(snapshot.document, runs),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{project_export.export_slug(snapshot.document)}.report.md"',
            "Cache-Control": "no-store",
        },
    )


@router.get(
    "/{snapshot_id}/export.zip",
    summary="Zip with manifest, items, hypotheses, citations and run manifests",
    responses={200: {"content": {"application/zip": {}}, "description": "Export archive"}},
)
async def export_zip(
    snapshot_id: str, session: SessionDep, actor: OptionalActor, store: ArtifactStoreDep
) -> Response:
    snapshot = await service.get_snapshot(session, snapshot_id, actor)
    return Response(
        content=await project_export.build_zip(session, store, snapshot.document),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{project_export.export_slug(snapshot.document)}.helix.zip"',
            "Cache-Control": "no-store",
        },
    )
