"""Core database models.

To add tables, create a new module in helix/db/ that defines models on helix.db.base.Base.
Every module in this package is imported before create_all runs at startup.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from helix.db.base import Base, BigIntegerKey, JSONType, UTCDateTime
from helix.ids import utcnow


class HttpCacheEntry(Base):
    """Cached upstream HTTP response. Key = sha256 of method, URL (secrets removed) and body."""

    __tablename__ = "http_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(64), index=True)
    method: Mapped[str] = mapped_column(String(8))
    url: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16))
    status_code: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[bytes] = mapped_column(LargeBinary)
    body_encoding: Mapped[str] = mapped_column(String(16), default="zlib")
    body_sha256: Mapped[str] = mapped_column(String(64))
    release: Mapped[str | None] = mapped_column(String(255))
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)


class Actor(Base):
    """Anonymous-first identity. Owns projects and jobs; an account can claim it later."""

    __tablename__ = "actor"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="anonymous")
    workspace_key_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    orcid: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    upgraded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class ActorIdentity(Base):
    """Link from an actor to an external auth identity, written when an account claims the actor."""

    __tablename__ = "actor_identity"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)

    id: Mapped[int] = mapped_column(BigIntegerKey, primary_key=True, autoincrement=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("actor.id"), index=True)
    provider: Mapped[str] = mapped_column(String(64))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Job(Base):
    __tablename__ = "job"
    __table_args__ = (
        Index("ix_job_actor_created", "actor_id", "created_at"),
        Index("ix_job_status", "status"),
        Index("ix_job_subject", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    provider_id: Mapped[str | None] = mapped_column(String(64))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("actor.id"))
    project_id: Mapped[str | None] = mapped_column(String(40), index=True)
    parent_job_id: Mapped[str | None] = mapped_column(String(40))
    params: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    params_hash: Mapped[str] = mapped_column(String(64), index=True)
    subject_type: Mapped[str | None] = mapped_column(String(32))
    subject_id: Mapped[str | None] = mapped_column(String(300))
    subject_label: Mapped[str | None] = mapped_column(String(300))
    stages: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    worker_id: Mapped[str | None] = mapped_column(String(100))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class JobEvent(Base):
    """Append-only event log of a job. The integer ID is the SSE event ID."""

    __tablename__ = "job_event"
    __table_args__ = (Index("ix_job_event_job_id_id", "job_id", "id"),)

    id: Mapped[int] = mapped_column(BigIntegerKey, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("job.id"))
    type: Mapped[str] = mapped_column(String(16))
    stage_id: Mapped[str | None] = mapped_column(String(64))
    level: Mapped[str | None] = mapped_column(String(8))
    message: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Artifact(Base):
    """A stored file with its SHA-256. Bytes live in the ArtifactStore under storage_key."""

    __tablename__ = "artifact"
    __table_args__ = (UniqueConstraint("job_id", "name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("job.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("actor.id"))
    name: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(32))
    media_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigIntegerKey)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(500))
    structure_origin: Mapped[str | None] = mapped_column(String(32))
    sample_index: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Project(Base):
    """Mutable pointer to a head snapshot. Forks keep parent and root pointers."""

    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    owner_actor_id: Mapped[str] = mapped_column(ForeignKey("actor.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    license: Mapped[str] = mapped_column(String(32), default="CC-BY-4.0")
    focus: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    head_snapshot_id: Mapped[str | None] = mapped_column(String(40))
    forked_from_project_id: Mapped[str | None] = mapped_column(String(40))
    forked_from_snapshot_id: Mapped[str | None] = mapped_column(String(40))
    root_project_id: Mapped[str] = mapped_column(String(40), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class ProjectItem(Base):
    """A node of the research trail. parent_item_id and origin preserve where it came from."""

    __tablename__ = "project_item"
    __table_args__ = (Index("ix_project_item_project_position", "project_id", "position"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"))
    parent_item_id: Mapped[str | None] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(32))
    entity_type: Mapped[str | None] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(300))
    label: Mapped[str | None] = mapped_column(String(500))
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    origin: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_by_actor_id: Mapped[str | None] = mapped_column(ForeignKey("actor.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class ProjectSnapshot(Base):
    """Immutable, content-addressed project state: id = helix.hashing.snapshot_id(document)."""

    __tablename__ = "project_snapshot"
    __table_args__ = (UniqueConstraint("project_id", "sequence_number"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"), index=True)
    parent_snapshot_id: Mapped[str | None] = mapped_column(String(40), index=True)
    sequence_number: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict[str, Any]] = mapped_column(JSONType)
    content_sha256: Mapped[str] = mapped_column(String(64))
    export_sha256: Mapped[str | None] = mapped_column(String(64))
    message: Mapped[str | None] = mapped_column(Text)
    withdrawn: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_actor_id: Mapped[str | None] = mapped_column(ForeignKey("actor.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class GeneratedStructure(Base):
    """A structure predicted by an Helix job (origin predicted_internal, id of:<job_id>)."""

    __tablename__ = "generated_structure"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("job.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("actor.id"), index=True)
    provider_id: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str | None] = mapped_column(String(200))
    model_version: Mapped[str | None] = mapped_column(String(100))
    uniprot_accession: Mapped[str | None] = mapped_column(String(20), index=True)
    gene_symbol: Mapped[str | None] = mapped_column(String(40), index=True)
    variant_id: Mapped[str | None] = mapped_column(String(120), index=True)
    sequence_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    sequence_length: Mapped[int | None] = mapped_column(Integer)
    residue_start: Mapped[int | None] = mapped_column(Integer)
    residue_end: Mapped[int | None] = mapped_column(Integer)
    structure_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifact.id"))
    descriptor: Mapped[dict[str, Any]] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
