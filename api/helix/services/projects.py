"""Research projects: a mutable pointer over trail items, immutable content-addressed snapshots and
fork lineage (docs/research/provenance-reproducibility.md section 6)."""

from collections import Counter
from collections.abc import Sequence
from typing import Any
from urllib.parse import quote, urlencode

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from helix import __version__
from helix.db.models import Actor, Project, ProjectItem, ProjectSnapshot
from helix.errors import BadRequest, Conflict, Forbidden, NotFound, ValidationFailed
from helix.evidence import build_hypothesis
from helix.hashing import canonical_sha256, snapshot_id, to_jsonable
from helix.ids import HYPOTHESIS_PREFIX, PROJECT_ITEM_PREFIX, PROJECT_PREFIX, new_id, utcnow
from helix.schemas.common import ActorRef, Authoring, EvidenceClass, Page
from helix.schemas.projects import (
    ForkRequest,
    HypothesisInput,
    HypothesisOut,
    HypothesisStatus,
    ItemKind,
    ItemOrigin,
    Lineage,
    ProjectCreate,
    ProjectDetail,
    ProjectItemCreate,
    ProjectItemOut,
    ProjectItemUpdate,
    ProjectOut,
    ProjectScope,
    ProjectUpdate,
    ProjectVisibility,
    SnapshotOut,
    SnapshotSummary,
    TrailEdge,
    TrailNode,
    TrailOut,
)

EXPORT_VERSION = "1.0.0"
MAX_ITEMS_PER_PROJECT = 2000
MAX_LINEAGE_DEPTH = 64
# Annotations attach to the active trail node without becoming the next step
ANNOTATION_KINDS = frozenset({ItemKind.NOTE, ItemKind.SCREENSHOT})
SHARED_VISIBILITIES = frozenset({ProjectVisibility.PUBLIC.value, ProjectVisibility.UNLISTED.value})


def share_path(snapshot_identifier: str) -> str:
    return f"/s/{snapshot_identifier}"


def _safe_route(route: str | None) -> str | None:
    """Only an in-app path is reopened; anything else is kept as text and never linked."""
    if route and route.startswith("/") and not route.startswith("//") and "\\" not in route:
        return route
    return None


def default_href(kind: str, ref: str | None, data: dict[str, Any]) -> str | None:
    if not ref:
        return None
    encoded = quote(ref, safe="")
    match kind:
        case "disease":
            return f"/disease/{encoded}"
        case "gene":
            return f"/gene/{encoded}"
        case "variant":
            return f"/variant/{encoded}"
        case "protein":
            return f"/protein/{encoded}"
        case "compound":
            return f"/compound/{encoded}"
        case "job":
            return f"/jobs/{encoded}"
        case "structure":
            accession = data.get("accession") or data.get("uniprot_accession")
            if isinstance(accession, str) and accession:
                return f"/protein/{quote(accession, safe='')}?{urlencode({'s': ref})}"
        case "residue":
            accession, _, position = ref.partition(":")
            if accession and position:
                return f"/protein/{quote(accession, safe='')}?{urlencode({'sel': position})}"
    return None


def _item_href(item: ProjectItem) -> str | None:
    route = _safe_route((item.origin or {}).get("route"))
    return route or default_href(item.kind, item.entity_id, (item.payload or {}).get("data") or {})


def _job_ids(item: ProjectItem) -> list[str]:
    if item.kind == ItemKind.JOB.value and item.entity_id:
        return [item.entity_id]
    if item.kind == ItemKind.STRUCTURE.value and (item.entity_id or "").startswith("of:"):
        return [item.entity_id[3:]]  # type: ignore[index]
    return []


def _derived_from(supporting: Sequence[ProjectItem], extra: Sequence[str] = ()) -> list[str]:
    identifiers: list[str] = []
    for item in supporting:
        identifiers.append(item.id)
        for record in (item.payload or {}).get("evidence") or []:
            if isinstance(record, dict) and isinstance(record.get("id"), str):
                identifiers.append(record["id"])
        identifiers.extend(_job_ids(item))
    identifiers.extend(extra)
    return list(dict.fromkeys(identifiers))


def _hypothesis_out(
    item: ProjectItem, by_id: dict[str, ProjectItem], actors: dict[str, Actor]
) -> HypothesisOut | None:
    stored = (item.payload or {}).get("hypothesis")
    if item.kind != ItemKind.HYPOTHESIS.value or not stored:
        return None
    supporting_ids = [identifier for identifier in stored.get("supporting_item_ids", []) if identifier in by_id]
    forked_from = stored.get("forked_from_hypothesis_id")
    derived_from = _derived_from(
        [by_id[identifier] for identifier in supporting_ids], [forked_from] if forked_from else []
    )
    author = actors.get(item.created_by_actor_id or "")
    record = build_hypothesis(
        stored["statement"],
        # An item whose support was removed elsewhere still names itself, so the record stays valid
        derived_from=derived_from or [item.id],
        created_by=ActorRef(
            actor_id=item.created_by_actor_id or "system",
            kind=author.kind if author and author.kind in ("anonymous", "account") else "anonymous",  # type: ignore[arg-type]
        ),
        authoring=Authoring(
            method=stored.get("authoring", {}).get("method", "human"),
            model=stored.get("authoring", {}).get("model"),
        ),
        hypothesis_id=stored.get("hypothesis_id") or item.id.replace(PROJECT_ITEM_PREFIX, HYPOTHESIS_PREFIX, 1),
    )
    return HypothesisOut(
        statement=stored["statement"],
        status=HypothesisStatus(stored.get("status", HypothesisStatus.DRAFT.value)),
        supporting_item_ids=supporting_ids,
        derived_from=record.derived_from,
        record=record,
    )


def item_out(item: ProjectItem, by_id: dict[str, ProjectItem], actors: dict[str, Actor]) -> ProjectItemOut:
    payload = item.payload or {}
    origin = item.origin or {}
    return ProjectItemOut(
        id=item.id,
        project_id=item.project_id,
        kind=ItemKind(item.kind),
        ref=item.entity_id,
        label=item.label or item.entity_id or item.kind,
        note=payload.get("note"),
        origin=ItemOrigin(
            route=origin.get("route"),
            url_state=origin.get("url_state") or {},
            note=origin.get("note"),
            parent_item_id=item.parent_item_id,
            created_at=origin.get("created_at") or item.created_at,
            forked_from_item_id=origin.get("forked_from_item_id"),
        ),
        parent_item_id=item.parent_item_id,
        position=item.position,
        href=_item_href(item),
        evidence=payload.get("evidence") or [],
        evidence_class=EvidenceClass.HELIX_HYPOTHESIS if item.kind == ItemKind.HYPOTHESIS.value else None,
        data=payload.get("data") or {},
        hypothesis=_hypothesis_out(item, by_id, actors),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def build_trail(items: Sequence[ProjectItemOut], active_item_id: str | None) -> TrailOut:
    """Depth-first order over parent pointers. An item whose parent is gone becomes a root."""
    by_id = {item.id: item for item in items}
    children: dict[str | None, list[ProjectItemOut]] = {}
    for item in sorted(items, key=lambda entry: (entry.position, entry.created_at)):
        parent = item.parent_item_id if item.parent_item_id in by_id else None
        children.setdefault(parent, []).append(item)

    nodes: list[TrailNode] = []
    edges: list[TrailEdge] = []
    visited: set[str] = set()

    def visit(item: ProjectItemOut, depth: int, parent_id: str | None) -> None:
        if item.id in visited:
            return
        visited.add(item.id)
        nodes.append(
            TrailNode(
                item_id=item.id,
                kind=item.kind,
                label=item.label,
                ref=item.ref,
                parent_item_id=parent_id,
                depth=depth,
                order=len(nodes),
                href=item.href,
                created_at=item.created_at,
            )
        )
        if parent_id:
            edges.append(TrailEdge(source=parent_id, target=item.id, relation="led_to"))
        for child in children.get(item.id, []):
            visit(child, depth + 1, item.id)

    roots = children.get(None, [])
    for root in roots:
        visit(root, 0, None)
    # Items left in a parent cycle still appear, as roots
    for item in items:
        if item.id not in visited:
            roots.append(item)
            visit(item, 0, None)
    for item in items:
        if item.hypothesis:
            for supporting_id in item.hypothesis.supporting_item_ids:
                edges.append(TrailEdge(source=supporting_id, target=item.id, relation="supports"))
    return TrailOut(
        nodes=nodes,
        edges=edges,
        roots=[root.id for root in roots],
        active_item_id=active_item_id if active_item_id in by_id else None,
    )


async def _actors(session: AsyncSession, actor_ids: set[str | None]) -> dict[str, Actor]:
    wanted = {actor_id for actor_id in actor_ids if actor_id}
    if not wanted:
        return {}
    rows = await session.scalars(select(Actor).where(Actor.id.in_(wanted)))
    return {actor.id: actor for actor in rows}


def _actor_ref(actor_id: str | None, actors: dict[str, Actor]) -> ActorRef | None:
    if not actor_id:
        return None
    actor = actors.get(actor_id)
    kind = actor.kind if actor and actor.kind in ("anonymous", "account") else "anonymous"
    return ActorRef(actor_id=actor_id, kind=kind)  # type: ignore[arg-type]


async def _load(session: AsyncSession, project_id: str, *, include_deleted: bool = False) -> Project:
    project = await session.get(Project, project_id, populate_existing=True)
    if project is None or (project.deleted_at is not None and not include_deleted):
        raise NotFound(f"Project {project_id} does not exist.", code="project_not_found")
    return project


def _is_owner(project: Project, actor: Actor | None) -> bool:
    return actor is not None and project.owner_actor_id == actor.id


async def readable_project(session: AsyncSession, project_id: str, actor: Actor | None) -> Project:
    project = await _load(session, project_id)
    if not _is_owner(project, actor) and project.visibility not in SHARED_VISIBILITIES:
        # A private project is indistinguishable from a missing one
        raise NotFound(f"Project {project_id} does not exist.", code="project_not_found")
    return project


async def writable_project(session: AsyncSession, project_id: str, actor: Actor) -> Project:
    project = await readable_project(session, project_id, actor)
    if not _is_owner(project, actor):
        raise Forbidden(
            "Only the workspace that owns this project can change it. Fork it to continue the work.",
            code="not_project_owner",
        )
    return project


async def _items(session: AsyncSession, project_id: str) -> list[ProjectItem]:
    rows = await session.scalars(
        select(ProjectItem)
        .where(ProjectItem.project_id == project_id)
        .order_by(ProjectItem.position, ProjectItem.created_at)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def items_out(session: AsyncSession, items: Sequence[ProjectItem]) -> list[ProjectItemOut]:
    by_id = {item.id: item for item in items}
    actors = await _actors(session, {item.created_by_actor_id for item in items})
    return [item_out(item, by_id, actors) for item in items]


def _active_item_id(project: Project) -> str | None:
    return (project.focus or {}).get("active_item_id")


def _set_active(project: Project, item_id: str | None) -> None:
    project.focus = {**(project.focus or {}), "active_item_id": item_id}


async def _lineage(session: AsyncSession, project: Project) -> Lineage:
    depth = 0
    parent_title: str | None = None
    parent_id = project.forked_from_project_id
    seen = {project.id}
    while parent_id and parent_id not in seen and depth < MAX_LINEAGE_DEPTH:
        seen.add(parent_id)
        depth += 1
        parent = await session.get(Project, parent_id)
        if parent is None:
            break
        if depth == 1:
            parent_title = parent.title
        parent_id = parent.forked_from_project_id
    fork_count = await session.scalar(
        select(func.count())
        .select_from(Project)
        .where(
            Project.root_project_id == project.root_project_id,
            Project.id != project.root_project_id,
            Project.deleted_at.is_(None),
        )
    )
    return Lineage(
        forked_from_project_id=project.forked_from_project_id,
        forked_from_snapshot_id=project.forked_from_snapshot_id,
        forked_from_title=parent_title,
        root_project_id=project.root_project_id,
        fork_depth=depth,
        fork_count=fork_count or 0,
    )


def state_hash(project: Project, items: Sequence[ProjectItemOut]) -> str:
    """Digest of everything a snapshot freezes. Equal digests mean nothing changed since publishing."""
    return canonical_sha256(
        {
            "title": project.title,
            "description": project.description,
            "license": project.license,
            "items": [item.model_dump(mode="json") for item in items],
        }
    )


def snapshot_summary(snapshot: ProjectSnapshot, actors: dict[str, Actor]) -> SnapshotSummary:
    return SnapshotSummary(
        id=snapshot.id,
        project_id=snapshot.project_id,
        sequence_number=snapshot.sequence_number,
        parent_snapshot_id=snapshot.parent_snapshot_id,
        message=snapshot.message,
        content_sha256=snapshot.content_sha256,
        withdrawn=snapshot.withdrawn,
        share_path=share_path(snapshot.id),
        created_by=_actor_ref(snapshot.created_by_actor_id, actors),
        created_at=snapshot.created_at,
    )


async def _snapshots(session: AsyncSession, project_id: str) -> list[ProjectSnapshot]:
    rows = await session.scalars(
        select(ProjectSnapshot)
        .where(ProjectSnapshot.project_id == project_id)
        .order_by(ProjectSnapshot.sequence_number.desc())
    )
    return list(rows)


async def _project_out(
    session: AsyncSession,
    project: Project,
    actor: Actor | None,
    counts: dict[str, int],
    actors: dict[str, Actor],
) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        title=project.title,
        description=project.description,
        visibility=ProjectVisibility(project.visibility),
        license=project.license,
        is_owner=_is_owner(project, actor),
        owner=_actor_ref(project.owner_actor_id, actors),  # type: ignore[arg-type]
        head_snapshot_id=project.head_snapshot_id,
        share_path=share_path(project.head_snapshot_id) if project.head_snapshot_id else None,
        lineage=await _lineage(session, project),
        active_item_id=_active_item_id(project),
        item_count=sum(counts.values()),
        item_counts=counts,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


async def project_detail(session: AsyncSession, project: Project, actor: Actor | None) -> ProjectDetail:
    items = await _items(session, project.id)
    outs = await items_out(session, items)
    snapshots = await _snapshots(session, project.id)
    actors = await _actors(
        session, {project.owner_actor_id, *(snapshot.created_by_actor_id for snapshot in snapshots)}
    )
    summary = await _project_out(
        session, project, actor, dict(Counter(item.kind for item in items)), actors
    )
    head = next((snapshot for snapshot in snapshots if snapshot.id == project.head_snapshot_id), None)
    unpublished = head is None or head.document.get("state_sha256") != state_hash(project, outs)
    return ProjectDetail(
        **summary.model_dump(),
        items=outs,
        trail=build_trail(outs, _active_item_id(project)),
        snapshots=[snapshot_summary(snapshot, actors) for snapshot in snapshots],
        unpublished_changes=unpublished,
    )


async def list_projects(
    session: AsyncSession,
    actor: Actor | None,
    *,
    scope: ProjectScope,
    q: str | None,
    limit: int,
    offset: int,
) -> Page[ProjectOut]:
    conditions = [Project.deleted_at.is_(None)]
    if scope is ProjectScope.MINE:
        if actor is None:
            return Page[ProjectOut](items=[], total=0, limit=limit, offset=offset)
        conditions.append(Project.owner_actor_id == actor.id)
    else:
        conditions.append(Project.visibility == ProjectVisibility.PUBLIC.value)
    if q:
        pattern = f"%{q.strip()}%"
        conditions.append(or_(Project.title.ilike(pattern), Project.description.ilike(pattern)))
    total = await session.scalar(select(func.count()).select_from(Project).where(*conditions)) or 0
    projects = list(
        await session.scalars(
            select(Project).where(*conditions).order_by(Project.updated_at.desc()).limit(limit).offset(offset)
        )
    )
    counts: dict[str, dict[str, int]] = {}
    if projects:
        rows = await session.execute(
            select(ProjectItem.project_id, ProjectItem.kind, func.count())
            .where(ProjectItem.project_id.in_([project.id for project in projects]))
            .group_by(ProjectItem.project_id, ProjectItem.kind)
        )
        for project_id, kind, count in rows:
            counts.setdefault(project_id, {})[kind] = count
    actors = await _actors(session, {project.owner_actor_id for project in projects})
    return Page[ProjectOut](
        items=[
            await _project_out(session, project, actor, counts.get(project.id, {}), actors)
            for project in projects
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


async def create_project(session: AsyncSession, actor: Actor, body: ProjectCreate) -> Project:
    project_id = new_id(PROJECT_PREFIX)
    project = Project(
        id=project_id,
        owner_actor_id=actor.id,
        title=body.title.strip(),
        description=body.description,
        visibility=body.visibility.value,
        license=body.license,
        root_project_id=project_id,
    )
    session.add(project)
    await session.commit()
    return project


async def update_project(session: AsyncSession, actor: Actor, project_id: str, body: ProjectUpdate) -> Project:
    project = await writable_project(session, project_id, actor)
    fields = body.model_fields_set
    if body.title is not None:
        project.title = body.title.strip()
    if "description" in fields:
        project.description = body.description
    if body.visibility is not None:
        project.visibility = body.visibility.value
    if body.license is not None:
        project.license = body.license
    if "active_item_id" in fields:
        if body.active_item_id is not None:
            await _item(session, project.id, body.active_item_id)
        _set_active(project, body.active_item_id)
    project.updated_at = utcnow()
    await session.commit()
    return project


async def delete_project(session: AsyncSession, actor: Actor, project_id: str) -> None:
    project = await writable_project(session, project_id, actor)
    # Soft delete: published snapshots and forks keep resolving their lineage
    project.deleted_at = utcnow()
    await session.commit()


async def _item(session: AsyncSession, project_id: str, item_id: str) -> ProjectItem:
    item = await session.get(ProjectItem, item_id, populate_existing=True)
    if item is None or item.project_id != project_id:
        raise NotFound(f"Project {project_id} has no item {item_id}.", code="project_item_not_found")
    return item


def _supporting(by_id: dict[str, ProjectItem], identifiers: Sequence[str], own_id: str | None) -> list[str]:
    unique = list(dict.fromkeys(identifiers))
    missing = [identifier for identifier in unique if identifier not in by_id or identifier == own_id]
    if missing:
        raise ValidationFailed(
            f"A hypothesis can only rest on other items of the same project. Not found: {', '.join(missing)}.",
            code="hypothesis_support_not_found",
        )
    if not unique:
        raise ValidationFailed(
            "A hypothesis must rest on at least one project item.", code="hypothesis_requires_support"
        )
    return unique


def _would_cycle(by_id: dict[str, ProjectItem], item_id: str, parent_id: str | None) -> bool:
    steps = 0
    while parent_id and steps <= len(by_id):
        if parent_id == item_id:
            return True
        parent = by_id.get(parent_id)
        parent_id = parent.parent_item_id if parent else None
        steps += 1
    return False


async def add_item(
    session: AsyncSession, actor: Actor, project_id: str, body: ProjectItemCreate
) -> tuple[ProjectItem, bool]:
    """Returns (item, created). Saving the entity that already is the active node returns that node."""
    project = await writable_project(session, project_id, actor)
    existing = await _items(session, project.id)
    by_id = {item.id: item for item in existing}
    if len(existing) >= MAX_ITEMS_PER_PROJECT:
        raise Conflict(
            f"A project holds at most {MAX_ITEMS_PER_PROJECT} items.", code="project_item_limit"
        )

    parent_id = body.parent_item_id
    if parent_id is not None and parent_id not in by_id:
        raise NotFound(f"Project {project_id} has no item {parent_id}.", code="project_item_not_found")
    active_id = _active_item_id(project)
    if parent_id is None and body.attach_to_active and active_id in by_id:
        parent_id = active_id

    is_hypothesis = body.kind is ItemKind.HYPOTHESIS
    if is_hypothesis != (body.hypothesis is not None):
        raise ValidationFailed(
            "An item of kind hypothesis carries a hypothesis, and no other kind does.",
            code="hypothesis_fields_mismatch",
        )
    if not is_hypothesis and body.kind not in ANNOTATION_KINDS and not body.ref:
        raise ValidationFailed(f"An item of kind {body.kind.value} needs a ref.", code="item_ref_required")

    if body.ref and not is_hypothesis and parent_id:
        parent = by_id[parent_id]
        if parent.kind == body.kind.value and parent.entity_id == body.ref:
            return parent, False

    now = utcnow()
    payload: dict[str, Any] = {
        "note": body.note,
        "evidence": to_jsonable(body.evidence),
        "data": to_jsonable(body.data),
    }
    item_id = new_id(PROJECT_ITEM_PREFIX)
    if body.hypothesis is not None:
        payload["hypothesis"] = _hypothesis_payload(by_id, body.hypothesis, item_id)
    origin = body.origin.model_dump() if body.origin else {}
    origin["created_at"] = now.isoformat()
    item = ProjectItem(
        id=item_id,
        project_id=project.id,
        parent_item_id=parent_id,
        kind=body.kind.value,
        entity_type=body.kind.value,
        entity_id=body.ref,
        label=body.label.strip(),
        payload=payload,
        origin=origin,
        position=max((entry.position for entry in existing), default=-1) + 1,
        created_by_actor_id=actor.id,
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    if body.kind not in ANNOTATION_KINDS:
        _set_active(project, item.id)
    project.updated_at = now
    await session.commit()
    return item, True


def _hypothesis_payload(
    by_id: dict[str, ProjectItem], body: HypothesisInput, item_id: str
) -> dict[str, Any]:
    return {
        "hypothesis_id": new_id(HYPOTHESIS_PREFIX),
        "statement": body.statement.strip(),
        "status": body.status.value,
        "supporting_item_ids": _supporting(by_id, body.supporting_item_ids, item_id),
        "authoring": {"method": "human", "model": None},
    }


async def update_item(
    session: AsyncSession, actor: Actor, project_id: str, item_id: str, body: ProjectItemUpdate
) -> ProjectItem:
    project = await writable_project(session, project_id, actor)
    item = await _item(session, project.id, item_id)
    by_id = {entry.id: entry for entry in await _items(session, project.id)}
    fields = body.model_fields_set
    payload = dict(item.payload or {})
    if body.label is not None:
        item.label = body.label.strip()
    if "note" in fields:
        payload["note"] = body.note
    if body.data is not None:
        payload["data"] = to_jsonable(body.data)
    if body.detach:
        item.parent_item_id = None
    elif body.parent_item_id is not None:
        if body.parent_item_id not in by_id:
            raise NotFound(
                f"Project {project_id} has no item {body.parent_item_id}.", code="project_item_not_found"
            )
        if _would_cycle(by_id, item.id, body.parent_item_id):
            raise BadRequest("An item cannot follow itself or one of its own steps.", code="trail_cycle")
        item.parent_item_id = body.parent_item_id
    if body.hypothesis is not None:
        if item.kind != ItemKind.HYPOTHESIS.value:
            raise ValidationFailed("Only a hypothesis item has hypothesis fields.", code="not_a_hypothesis")
        stored = dict(payload.get("hypothesis") or {})
        if body.hypothesis.statement is not None:
            stored["statement"] = body.hypothesis.statement.strip()
        if body.hypothesis.status is not None:
            stored["status"] = body.hypothesis.status.value
        if body.hypothesis.supporting_item_ids is not None:
            stored["supporting_item_ids"] = _supporting(by_id, body.hypothesis.supporting_item_ids, item.id)
        payload["hypothesis"] = stored
    item.payload = payload
    item.updated_at = utcnow()
    project.updated_at = item.updated_at
    await session.commit()
    return item


async def delete_item(session: AsyncSession, actor: Actor, project_id: str, item_id: str) -> None:
    project = await writable_project(session, project_id, actor)
    item = await _item(session, project.id, item_id)
    others = [entry for entry in await _items(session, project.id) if entry.id != item.id]
    for other in others:
        stored = (other.payload or {}).get("hypothesis")
        if not stored or item.id not in stored.get("supporting_item_ids", []):
            continue
        remaining = [identifier for identifier in stored["supporting_item_ids"] if identifier != item.id]
        if not remaining:
            raise Conflict(
                f"'{item.label}' is the only item the hypothesis '{other.label}' rests on. "
                "Change or remove the hypothesis first.",
                code="hypothesis_requires_support",
            )
        other.payload = {**other.payload, "hypothesis": {**stored, "supporting_item_ids": remaining}}  # type: ignore[dict-item]
    for other in others:
        if other.parent_item_id == item.id:
            other.parent_item_id = item.parent_item_id
    if _active_item_id(project) == item.id:
        _set_active(project, item.parent_item_id)
    await session.delete(item)
    project.updated_at = utcnow()
    await session.commit()


def _document(
    project: Project,
    items: Sequence[ProjectItemOut],
    lineage: Lineage,
    snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    """project.json (research section 6.5). `snapshot` is null for an export of the live project."""
    job_ids = sorted(
        {
            *(item.ref for item in items if item.kind is ItemKind.JOB and item.ref),
            *(
                item.ref[3:]
                for item in items
                if item.kind is ItemKind.STRUCTURE and item.ref and item.ref.startswith("of:")
            ),
        }
    )
    return to_jsonable(
        {
            "export_version": EXPORT_VERSION,
            "generator": {"name": "Helix", "version": __version__},
            "project_id": project.id,
            "title": project.title,
            "description": project.description,
            "license": project.license,
            "research_use_only": True,
            "snapshot": snapshot,
            "lineage": {
                "forked_from": (
                    {
                        "project_id": lineage.forked_from_project_id,
                        "snapshot_id": lineage.forked_from_snapshot_id,
                    }
                    if lineage.forked_from_project_id
                    else None
                ),
                "root_project_id": lineage.root_project_id,
                "fork_depth": lineage.fork_depth,
            },
            "state_sha256": state_hash(project, items),
            "items": [item.model_dump(mode="json") for item in items],
            "trail": build_trail(items, _active_item_id(project)).model_dump(mode="json"),
            "contents": {
                "items": len(items),
                "hypotheses": sum(1 for item in items if item.kind is ItemKind.HYPOTHESIS),
                "runs": job_ids,
            },
        }
    )


async def live_document(session: AsyncSession, project: Project) -> dict[str, Any]:
    items = await items_out(session, await _items(session, project.id))
    return _document(project, items, await _lineage(session, project), None)


async def publish(
    session: AsyncSession, actor: Actor, project_id: str, message: str | None
) -> tuple[ProjectSnapshot, bool]:
    """Freeze the project. Returns (snapshot, created); an unchanged project returns its head."""
    project = await writable_project(session, project_id, actor)
    items = await items_out(session, await _items(session, project.id))
    snapshots = await _snapshots(session, project.id)
    head = next((snapshot for snapshot in snapshots if snapshot.id == project.head_snapshot_id), None)
    if head is not None and not head.withdrawn and head.document.get("state_sha256") == state_hash(project, items):
        return head, False

    now = utcnow()
    sequence_number = max((snapshot.sequence_number for snapshot in snapshots), default=0) + 1
    document = _document(
        project,
        items,
        await _lineage(session, project),
        {
            "sequence_number": sequence_number,
            "created_at": now.isoformat(),
            "created_by": actor.id,
            "message": message,
            # The first snapshot of a fork points into the project it was forked from
            "parent_snapshot_id": head.id if head else project.forked_from_snapshot_id,
        },
    )
    identifier = snapshot_id(document)
    content_sha256 = canonical_sha256(document)
    document["snapshot"]["snapshot_id"] = identifier
    existing = await session.get(ProjectSnapshot, identifier)
    if existing is not None:
        return existing, False
    snapshot = ProjectSnapshot(
        id=identifier,
        project_id=project.id,
        parent_snapshot_id=document["snapshot"]["parent_snapshot_id"],
        sequence_number=sequence_number,
        document=document,
        content_sha256=content_sha256,
        message=message,
        created_by_actor_id=actor.id,
        created_at=now,
    )
    session.add(snapshot)
    project.head_snapshot_id = identifier
    await session.commit()
    return snapshot, True


async def get_snapshot(session: AsyncSession, identifier: str, actor: Actor | None) -> ProjectSnapshot:
    snapshot = await session.get(ProjectSnapshot, identifier)
    if snapshot is None:
        raise NotFound(f"Snapshot {identifier} does not exist.", code="snapshot_not_found")
    if snapshot.withdrawn:
        project = await session.get(Project, snapshot.project_id)
        if project is None or not _is_owner(project, actor):
            raise NotFound(
                f"Snapshot {identifier} was withdrawn by its owner.", code="snapshot_withdrawn"
            )
    return snapshot


async def set_withdrawn(
    session: AsyncSession, actor: Actor, identifier: str, withdrawn: bool
) -> ProjectSnapshot:
    snapshot = await get_snapshot(session, identifier, actor)
    await writable_project(session, snapshot.project_id, actor)
    snapshot.withdrawn = withdrawn
    await session.commit()
    return snapshot


async def snapshot_out(session: AsyncSession, snapshot: ProjectSnapshot, actor: Actor | None) -> SnapshotOut:
    document = snapshot.document
    project = await session.get(Project, snapshot.project_id)
    actors = await _actors(session, {snapshot.created_by_actor_id})
    summary = snapshot_summary(snapshot, actors)
    recorded = document.get("lineage") or {}
    forked_from = recorded.get("forked_from") or {}
    live = await _lineage(session, project) if project else None
    lineage = Lineage(
        forked_from_project_id=forked_from.get("project_id"),
        forked_from_snapshot_id=forked_from.get("snapshot_id"),
        forked_from_title=live.forked_from_title if live else None,
        root_project_id=recorded.get("root_project_id") or snapshot.project_id,
        fork_depth=recorded.get("fork_depth") or 0,
        fork_count=live.fork_count if live else 0,
    )
    is_owner = project is not None and _is_owner(project, actor)
    available = project is not None and project.deleted_at is None and (
        is_owner or project.visibility in SHARED_VISIBILITIES
    )
    return SnapshotOut(
        **summary.model_dump(),
        title=document.get("title") or "Untitled project",
        description=document.get("description"),
        license=document.get("license") or "CC-BY-4.0",
        lineage=lineage,
        items=[ProjectItemOut.model_validate(item) for item in document.get("items", [])],
        trail=TrailOut.model_validate(document.get("trail") or {"nodes": [], "edges": [], "roots": [], "active_item_id": None}),
        document=document,
        project_visibility=ProjectVisibility(project.visibility) if project else ProjectVisibility.PRIVATE,
        project_available=available,
        is_owner=is_owner,
        is_head=project is not None and project.head_snapshot_id == snapshot.id,
    )


async def _fork(
    session: AsyncSession,
    actor: Actor,
    *,
    title: str,
    description: str | None,
    license: str,
    items: Sequence[ProjectItemOut],
    active_item_id: str | None,
    source_project_id: str,
    source_snapshot_id: str | None,
    root_project_id: str,
) -> Project:
    """A fork copies references, never runs: job items keep the original job ID."""
    now = utcnow()
    project_id = new_id(PROJECT_PREFIX)
    mapping = {item.id: new_id(PROJECT_ITEM_PREFIX) for item in items}
    project = Project(
        id=project_id,
        owner_actor_id=actor.id,
        title=title,
        description=description,
        visibility=ProjectVisibility.PRIVATE.value,
        license=license,
        focus={"active_item_id": mapping.get(active_item_id or "")},
        forked_from_project_id=source_project_id,
        forked_from_snapshot_id=source_snapshot_id,
        root_project_id=root_project_id,
        created_at=now,
        updated_at=now,
    )
    session.add(project)
    await session.flush()
    for item in items:
        payload: dict[str, Any] = {"note": item.note, "evidence": item.evidence, "data": item.data}
        if item.hypothesis:
            payload["hypothesis"] = {
                "hypothesis_id": new_id(HYPOTHESIS_PREFIX),
                "forked_from_hypothesis_id": item.hypothesis.record.id,
                "statement": item.hypothesis.statement,
                "status": item.hypothesis.status.value,
                "supporting_item_ids": [
                    mapping[identifier]
                    for identifier in item.hypothesis.supporting_item_ids
                    if identifier in mapping
                ],
                "authoring": (
                    item.hypothesis.record.authoring.model_dump()
                    if item.hypothesis.record.authoring
                    else {"method": "human", "model": None}
                ),
            }
        session.add(
            ProjectItem(
                id=mapping[item.id],
                project_id=project_id,
                parent_item_id=mapping.get(item.parent_item_id or ""),
                kind=item.kind.value,
                entity_type=item.kind.value,
                entity_id=item.ref,
                label=item.label,
                payload=to_jsonable(payload),
                origin=to_jsonable(
                    {
                        "route": item.origin.route,
                        "url_state": item.origin.url_state,
                        "note": item.origin.note,
                        "created_at": item.origin.created_at or item.created_at,
                        "forked_from_item_id": item.id,
                    }
                ),
                position=item.position,
                created_by_actor_id=actor.id,
                created_at=now,
                updated_at=now,
            )
        )
    await session.commit()
    return project


async def fork_project(session: AsyncSession, actor: Actor, project_id: str, body: ForkRequest) -> Project:
    source = await readable_project(session, project_id, actor)
    items = await items_out(session, await _items(session, source.id))
    head = await session.get(ProjectSnapshot, source.head_snapshot_id) if source.head_snapshot_id else None
    # The fork names the snapshot only when the copied state is exactly that snapshot
    unchanged = head is not None and head.document.get("state_sha256") == state_hash(source, items)
    return await _fork(
        session,
        actor,
        title=(body.title or source.title).strip(),
        description=source.description,
        license=source.license,
        items=items,
        active_item_id=_active_item_id(source),
        source_project_id=source.id,
        source_snapshot_id=head.id if head and unchanged else None,
        root_project_id=source.root_project_id,
    )


async def fork_snapshot(session: AsyncSession, actor: Actor, identifier: str, body: ForkRequest) -> Project:
    snapshot = await get_snapshot(session, identifier, actor)
    document = snapshot.document
    source = await session.get(Project, snapshot.project_id)
    recorded_root = (document.get("lineage") or {}).get("root_project_id")
    return await _fork(
        session,
        actor,
        title=(body.title or document.get("title") or "Untitled project").strip(),
        description=document.get("description"),
        license=document.get("license") or "CC-BY-4.0",
        items=[ProjectItemOut.model_validate(item) for item in document.get("items", [])],
        active_item_id=(document.get("trail") or {}).get("active_item_id"),
        source_project_id=snapshot.project_id,
        source_snapshot_id=snapshot.id,
        root_project_id=source.root_project_id if source else recorded_root or snapshot.project_id,
    )


async def list_forks(session: AsyncSession, actor: Actor | None, project_id: str) -> list[ProjectOut]:
    project = await readable_project(session, project_id, actor)
    visible = [Project.visibility == ProjectVisibility.PUBLIC.value]
    if actor is not None:
        visible.append(Project.owner_actor_id == actor.id)
    forks = list(
        await session.scalars(
            select(Project)
            .where(
                Project.forked_from_project_id == project.id,
                Project.deleted_at.is_(None),
                or_(*visible),
            )
            .order_by(Project.created_at.desc())
        )
    )
    actors = await _actors(session, {fork.owner_actor_id for fork in forks})
    return [await _project_out(session, fork, actor, {}, actors) for fork in forks]
