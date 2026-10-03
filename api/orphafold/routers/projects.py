"""Research projects: CRUD, items, the research trail, hypotheses, publish, fork and exports."""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Response

from orphafold.config import API_PREFIX
from orphafold.deps import ArtifactStoreDep, CurrentActor, OptionalActor, Pagination, SessionDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.common import Page
from orphafold.schemas.projects import (
    ForkRequest,
    HypothesisInput,
    ItemKind,
    ItemOriginInput,
    ProjectCreate,
    ProjectDetail,
    ProjectItemCreate,
    ProjectItemOut,
    ProjectItemUpdate,
    ProjectOut,
    ProjectScope,
    ProjectUpdate,
    PublishRequest,
    SnapshotSummary,
    TrailOut,
)
from orphafold.services import project_export
from orphafold.services import projects as service

router = APIRouter(prefix="/projects", tags=["projects"], responses=PROBLEM_RESPONSES)

NO_STORE = {"Cache-Control": "no-store"}


class HypothesisCreate(HypothesisInput):
    label: str | None = None
    note: str | None = None
    parent_item_id: str | None = None
    origin: ItemOriginInput | None = None


def attachment(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{filename}"', **NO_STORE}


@router.post("", response_model=ProjectDetail, status_code=201, summary="Create a project")
async def create_project(
    body: ProjectCreate, response: Response, session: SessionDep, actor: CurrentActor
) -> ProjectDetail:
    project = await service.create_project(session, actor, body)
    response.headers["Location"] = f"{API_PREFIX}/projects/{project.id}"
    return await service.project_detail(session, project, actor)


@router.get("", response_model=Page[ProjectOut], summary="Projects of the calling workspace, or public ones")
async def list_projects(
    session: SessionDep,
    actor: OptionalActor,
    page: Pagination,
    scope: Annotated[ProjectScope, Query(description="mine: owned by this workspace; public: listed publicly")] = (
        ProjectScope.MINE
    ),
    q: Annotated[str | None, Query(max_length=200, description="Text in the title or description")] = None,
) -> Page[ProjectOut]:
    return await service.list_projects(session, actor, scope=scope, q=q, limit=page.limit, offset=page.offset)


@router.get("/{project_id}", response_model=ProjectDetail, summary="One project with items, trail and snapshots")
async def get_project(project_id: str, session: SessionDep, actor: OptionalActor) -> ProjectDetail:
    project = await service.readable_project(session, project_id, actor)
    return await service.project_detail(session, project, actor)


@router.patch("/{project_id}", response_model=ProjectDetail, summary="Change title, description, visibility")
async def update_project(
    project_id: str, body: ProjectUpdate, session: SessionDep, actor: CurrentActor
) -> ProjectDetail:
    project = await service.update_project(session, actor, project_id, body)
    return await service.project_detail(session, project, actor)


@router.delete("/{project_id}", status_code=204, summary="Delete a project; published snapshots stay readable")
async def delete_project(project_id: str, session: SessionDep, actor: CurrentActor) -> Response:
    await service.delete_project(session, actor, project_id)
    return Response(status_code=204)


async def _item_out(session: SessionDep, project_id: str, item_id: str) -> ProjectItemOut:
    items = await service.items_out(session, await service._items(session, project_id))
    return next(item for item in items if item.id == item_id)


@router.get("/{project_id}/items", response_model=list[ProjectItemOut], summary="Items of a project")
async def list_items(
    project_id: str,
    session: SessionDep,
    actor: OptionalActor,
    kind: Annotated[list[ItemKind] | None, Query(description="Repeatable")] = None,
) -> list[ProjectItemOut]:
    project = await service.readable_project(session, project_id, actor)
    items = await service.items_out(session, await service._items(session, project.id))
    return [item for item in items if not kind or item.kind in kind]


@router.post(
    "/{project_id}/items",
    response_model=ProjectItemOut,
    status_code=201,
    summary="Save an item after the active trail node",
    responses={200: {"model": ProjectItemOut, "description": "The entity already is the active trail node"}},
)
async def add_item(
    project_id: str, body: ProjectItemCreate, response: Response, session: SessionDep, actor: CurrentActor
) -> ProjectItemOut:
    item, created = await service.add_item(session, actor, project_id, body)
    response.status_code = 201 if created else 200
    return await _item_out(session, project_id, item.id)


@router.get("/{project_id}/items/{item_id}", response_model=ProjectItemOut, summary="One item")
async def get_item(project_id: str, item_id: str, session: SessionDep, actor: OptionalActor) -> ProjectItemOut:
    project = await service.readable_project(session, project_id, actor)
    await service._item(session, project.id, item_id)
    return await _item_out(session, project.id, item_id)


@router.patch("/{project_id}/items/{item_id}", response_model=ProjectItemOut, summary="Change an item")
async def update_item(
    project_id: str, item_id: str, body: ProjectItemUpdate, session: SessionDep, actor: CurrentActor
) -> ProjectItemOut:
    await service.update_item(session, actor, project_id, item_id, body)
    return await _item_out(session, project_id, item_id)


@router.delete("/{project_id}/items/{item_id}", status_code=204, summary="Remove an item; its steps move up")
async def delete_item(project_id: str, item_id: str, session: SessionDep, actor: CurrentActor) -> Response:
    await service.delete_item(session, actor, project_id, item_id)
    return Response(status_code=204)


@router.get("/{project_id}/trail", response_model=TrailOut, summary="The research trail as an ordered graph")
async def get_trail(project_id: str, session: SessionDep, actor: OptionalActor) -> TrailOut:
    project = await service.readable_project(session, project_id, actor)
    return (await service.project_detail(session, project, actor)).trail


@router.get("/{project_id}/hypotheses", response_model=list[ProjectItemOut], summary="Hypotheses of a project")
async def list_hypotheses(project_id: str, session: SessionDep, actor: OptionalActor) -> list[ProjectItemOut]:
    project = await service.readable_project(session, project_id, actor)
    items = await service.items_out(session, await service._items(session, project.id))
    return [item for item in items if item.kind is ItemKind.HYPOTHESIS]


@router.post(
    "/{project_id}/hypotheses",
    response_model=ProjectItemOut,
    status_code=201,
    summary="Record a hypothesis that rests on project items",
)
async def add_hypothesis(
    project_id: str, body: HypothesisCreate, session: SessionDep, actor: CurrentActor
) -> ProjectItemOut:
    statement = body.statement.strip()
    label = (body.label or statement.split("\n", 1)[0]).strip()[:120]
    item, _ = await service.add_item(
        session,
        actor,
        project_id,
        ProjectItemCreate(
            kind=ItemKind.HYPOTHESIS,
            label=label or "Hypothesis",
            note=body.note,
            origin=body.origin,
            parent_item_id=body.parent_item_id,
            hypothesis=HypothesisInput(
                statement=statement, supporting_item_ids=body.supporting_item_ids, status=body.status
            ),
        ),
    )
    return await _item_out(session, project_id, item.id)


@router.get("/{project_id}/snapshots", response_model=list[SnapshotSummary], summary="Published snapshots")
async def list_snapshots(project_id: str, session: SessionDep, actor: OptionalActor) -> list[SnapshotSummary]:
    project = await service.readable_project(session, project_id, actor)
    return (await service.project_detail(session, project, actor)).snapshots


@router.post(
    "/{project_id}/publish",
    response_model=SnapshotSummary,
    status_code=201,
    summary="Freeze the project as an immutable snapshot with a stable share path",
    responses={200: {"model": SnapshotSummary, "description": "Nothing changed since the head snapshot"}},
)
async def publish_project(
    project_id: str,
    response: Response,
    session: SessionDep,
    actor: CurrentActor,
    body: PublishRequest | None = None,
) -> SnapshotSummary:
    snapshot, created = await service.publish(session, actor, project_id, body.message if body else None)
    response.status_code = 201 if created else 200
    response.headers["Location"] = f"{API_PREFIX}/snapshots/{snapshot.id}"
    actors = await service._actors(session, {snapshot.created_by_actor_id})
    return service.snapshot_summary(snapshot, actors)


@router.post(
    "/{project_id}/fork",
    response_model=ProjectDetail,
    status_code=201,
    summary="Fork a public, unlisted or own project into the calling workspace",
)
async def fork_project(
    project_id: str, session: SessionDep, actor: CurrentActor, body: ForkRequest | None = None
) -> ProjectDetail:
    project = await service.fork_project(session, actor, project_id, body or ForkRequest())
    return await service.project_detail(session, project, actor)


@router.get("/{project_id}/forks", response_model=list[ProjectOut], summary="Forks visible to the caller")
async def list_forks(project_id: str, session: SessionDep, actor: OptionalActor) -> list[ProjectOut]:
    return await service.list_forks(session, actor, project_id)


@router.get(
    "/{project_id}/export.json",
    response_model=dict[str, Any],
    summary="project.json of the working project",
)
async def export_json(project_id: str, session: SessionDep, actor: OptionalActor) -> Response:
    project = await service.readable_project(session, project_id, actor)
    document = await service.live_document(session, project)
    return Response(
        content=project_export._json(document),
        media_type="application/json",
        headers=attachment(f"{project_export.export_slug(document)}.project.json"),
    )


@router.get(
    "/{project_id}/export.md",
    summary="Markdown research report of the working project",
    responses={200: {"content": {"text/markdown": {}}, "description": "Research report"}},
)
async def export_markdown(
    project_id: str, session: SessionDep, actor: OptionalActor, store: ArtifactStoreDep
) -> Response:
    project = await service.readable_project(session, project_id, actor)
    document = await service.live_document(session, project)
    runs = await project_export.collect_run_manifests(session, store, document)
    return Response(
        content=project_export.render_markdown(document, runs),
        media_type="text/markdown; charset=utf-8",
        headers=attachment(f"{project_export.export_slug(document)}.report.md"),
    )


@router.get(
    "/{project_id}/export.zip",
    summary="Zip with manifest, items, hypotheses, citations and run manifests",
    responses={200: {"content": {"application/zip": {}}, "description": "Export archive"}},
)
async def export_zip(
    project_id: str, session: SessionDep, actor: OptionalActor, store: ArtifactStoreDep
) -> Response:
    project = await service.readable_project(session, project_id, actor)
    document = await service.live_document(session, project)
    return Response(
        content=await project_export.build_zip(session, store, document),
        media_type="application/zip",
        headers=attachment(f"{project_export.export_slug(document)}.orphafold.zip"),
    )

