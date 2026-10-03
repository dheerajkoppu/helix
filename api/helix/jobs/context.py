"""JobContext: what a job handler uses to report real stages, log, store artifacts and stop.

Nothing here invents progress. A stage is 'running' only between entering and leaving its
`async with ctx.stage(...)` block, and a progress figure exists only when the handler reports
counts it measured.
"""

import asyncio
import shutil
import tempfile
import time
from collections.abc import AsyncIterator, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote

from sqlalchemy import delete, select, update

from helix.artifacts.store import ArtifactStore, normalise_key
from helix.config import API_PREFIX, Settings
from helix.db.models import Artifact, GeneratedStructure, Job
from helix.db.session import session_scope
from helix.hashing import sha256_hex
from helix.ids import ARTIFACT_PREFIX, new_id, utcnow
from helix.jobs.events import append_event, cancel_signals
from helix.jobs.manifest import ManifestBuilder
from helix.jobs.registry import StageInput, to_stage_specs
from helix.log import get_logger
from helix.schemas.common import StructureDescriptor, StructureOrigin
from helix.schemas.jobs import ArtifactOut, ArtifactRole, JobStage, StageProgress, StageStatus

logger = get_logger(__name__)

CANCEL_POLL_SECONDS = 0.5
PROGRESS_WRITE_SECONDS = 0.5


class JobCancelled(Exception):
    """Raised inside a handler when the user asked to cancel. Do not catch it."""


class JobFailed(Exception):
    """An expected failure with a message fit for the interface."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def artifact_url(job_id: str, name: str) -> str:
    return f"{API_PREFIX}/jobs/{job_id}/artifacts/{quote(name)}"


def artifact_out(artifact: Artifact) -> ArtifactOut:
    return ArtifactOut(
        id=artifact.id,
        name=artifact.name,
        role=ArtifactRole(artifact.role),
        media_type=artifact.media_type,
        size_bytes=artifact.size_bytes,
        sha256=artifact.sha256,
        url=artifact_url(artifact.job_id or "", artifact.name),
        structure_origin=StructureOrigin(artifact.structure_origin) if artifact.structure_origin else None,
        sample_index=artifact.sample_index,
        created_at=artifact.created_at,
    )


class JobContext:
    def __init__(
        self,
        *,
        job_id: str,
        kind: str,
        params: Any,
        actor_id: str | None,
        project_id: str | None,
        stages: list[JobStage],
        store: ArtifactStore,
        settings: Settings,
    ) -> None:
        self.job_id: str | None = job_id
        self.kind = kind
        self.params = params
        self.actor_id = actor_id
        self.project_id = project_id
        self.settings = settings
        self.manifest = ManifestBuilder()
        self._store = store
        self._stages = stages
        self._current: JobStage | None = None
        self._artifacts: dict[str, ArtifactOut] = {}
        self._workdir: Path | None = None
        self._cancel_checked_at = 0.0
        self._progress_written_at = 0.0

    # Workspace

    @property
    def workdir(self) -> Path:
        """Scratch directory for this run, removed when the job ends."""
        if self._workdir is None:
            self._workdir = Path(tempfile.mkdtemp(prefix=f"helix-{self.job_id}-"))
        return self._workdir

    def cleanup(self) -> None:
        if self._workdir is not None:
            shutil.rmtree(self._workdir, ignore_errors=True)
            self._workdir = None

    # Stages

    @property
    def stages(self) -> list[JobStage]:
        return self._stages

    @property
    def artifacts(self) -> list[ArtifactOut]:
        return list(self._artifacts.values())

    def _stage(self, stage_id: str) -> JobStage:
        for stage in self._stages:
            if stage.id == stage_id:
                return stage
        raise KeyError(
            f"stage {stage_id!r} was not declared; declared: {[stage.id for stage in self._stages]}"
        )

    async def _save_stages(self, changed: JobStage | None = None) -> None:
        payload = [stage.model_dump(mode="json") for stage in self._stages]
        async with session_scope() as session:
            await session.execute(update(Job).where(Job.id == self.job_id).values(stages=payload))
        await append_event(
            self.job_id or "",
            "stage",
            stage_id=changed.id if changed else None,
            message=changed.label if changed else None,
            data={"stage": changed.model_dump(mode="json") if changed else None, "stages": payload},
        )

    async def declare_stages(self, stages: Sequence[StageInput]) -> None:
        """Replace the planned stages. Allowed only before any stage has started."""
        if any(stage.status is not StageStatus.PENDING for stage in self._stages):
            raise RuntimeError("stages can only be declared before the first stage starts")
        self._stages = [JobStage(id=spec.id, label=spec.label) for spec in to_stage_specs(stages)]
        await self._save_stages()

    def stage(self, stage_id: str) -> AbstractAsyncContextManager[None]:
        """Enter a declared stage: `async with ctx.stage("download"): ...`."""
        return self._run_stage(stage_id)

    @asynccontextmanager
    async def _run_stage(self, stage_id: str) -> AsyncIterator[None]:
        stage = self._stage(stage_id)
        if self._current is not None:
            raise RuntimeError(f"stage {self._current.id!r} is still running; stages do not nest")
        await self.check_cancelled()
        stage.status = StageStatus.RUNNING
        stage.started_at = utcnow()
        stage.completed_at = None
        stage.detail = None
        stage.progress = None
        self._current = stage
        await self._save_stages(stage)
        try:
            yield
        except JobCancelled, asyncio.CancelledError:
            await asyncio.shield(self._leave(stage, StageStatus.CANCELLED))
            raise
        except Exception as error:
            await self._leave(stage, StageStatus.FAILED, str(error)[:500] or type(error).__name__)
            raise
        else:
            await self._leave(stage, StageStatus.DONE)

    async def _leave(self, stage: JobStage, status: StageStatus, detail: str | None = None) -> None:
        stage.status = status
        stage.completed_at = utcnow()
        if detail is not None:
            stage.detail = detail
        self._current = None
        await self._save_stages(stage)

    async def skip_stage(self, stage_id: str, reason: str) -> None:
        """Mark a declared stage as not needed for this run, with the reason."""
        stage = self._stage(stage_id)
        stage.status = StageStatus.SKIPPED
        stage.detail = reason
        stage.completed_at = utcnow()
        await self._save_stages(stage)

    async def close_stages(self, running_as: StageStatus, detail: str | None = None) -> None:
        """Called by the runner when the job ends: no stage is left running or pending."""
        changed = False
        for stage in self._stages:
            if stage.status is StageStatus.RUNNING:
                stage.status = running_as
                stage.completed_at = utcnow()
                stage.detail = stage.detail or detail
                changed = True
            elif stage.status is StageStatus.PENDING:
                stage.status = StageStatus.SKIPPED
                stage.detail = "Not run."
                changed = True
        self._current = None
        if changed:
            await self._save_stages()

    def reset_stages(self) -> list[dict[str, Any]]:
        """Stage plan with every stage pending again, for a job that will restart."""
        return [JobStage(id=stage.id, label=stage.label).model_dump(mode="json") for stage in self._stages]

    # Reporting

    async def log(self, message: str, *, level: str = "info", **data: Any) -> None:
        """Append a line to the job log."""
        await append_event(
            self.job_id or "",
            "log",
            stage_id=self._current.id if self._current else None,
            level=level,
            message=message,
            data=data or None,
        )

    async def progress(
        self,
        completed: float,
        total: float | None = None,
        *,
        unit: str | None = None,
        detail: str | None = None,
    ) -> None:
        """Report measured progress of the current stage (files downloaded, sampling steps done).
        Call it only with counts the work really produced."""
        stage = self._current
        if stage is None:
            raise RuntimeError("progress can only be reported inside a stage")
        stage.progress = StageProgress(completed=completed, total=total, unit=unit)
        if detail is not None:
            stage.detail = detail
        finished = total is not None and completed >= total
        now = time.monotonic()
        if finished or now - self._progress_written_at >= PROGRESS_WRITE_SECONDS:
            self._progress_written_at = now
            await self._save_stages(stage)

    # Cancellation

    async def cancel_requested(self) -> bool:
        if self.job_id in cancel_signals:
            return True
        now = time.monotonic()
        if now - self._cancel_checked_at < CANCEL_POLL_SECONDS:
            return False
        self._cancel_checked_at = now
        async with session_scope() as session:
            requested = await session.scalar(select(Job.cancel_requested).where(Job.id == self.job_id))
        return bool(requested)

    async def check_cancelled(self) -> None:
        """Raise JobCancelled when the user asked to cancel. Call it between units of work; it is
        also called on entering every stage."""
        if await self.cancel_requested():
            raise JobCancelled()

    # Artifacts

    async def save_artifact(
        self,
        name: str,
        data: bytes | str | Path,
        *,
        media_type: str,
        role: ArtifactRole = ArtifactRole.OTHER,
        structure_origin: StructureOrigin | None = None,
        sample_index: int | None = None,
        meta: dict[str, Any] | None = None,
    ) -> ArtifactOut:
        """Store a file under this job with its SHA-256. data: bytes, text, or a path to a file."""
        clean_name = normalise_key(name)
        key = f"jobs/{self.job_id}/{clean_name}"
        if isinstance(data, Path):
            stored = await self._store.put_file(key, data, media_type)
        else:
            payload = data.encode("utf-8") if isinstance(data, str) else data
            stored = await self._store.put_bytes(key, payload, media_type)
        async with session_scope() as session:
            # A restarted job writes the same names again
            await session.execute(
                delete(Artifact).where(Artifact.job_id == self.job_id, Artifact.name == clean_name)
            )
            artifact = Artifact(
                id=new_id(ARTIFACT_PREFIX),
                job_id=self.job_id,
                actor_id=self.actor_id,
                name=clean_name,
                role=role.value,
                media_type=media_type,
                size_bytes=stored.size_bytes,
                sha256=stored.sha256,
                storage_key=stored.key,
                structure_origin=structure_origin.value if structure_origin else None,
                sample_index=sample_index,
                meta=meta,
            )
            session.add(artifact)
            await session.flush()
            output = artifact_out(artifact)
        self._artifacts[clean_name] = output
        await append_event(
            self.job_id or "",
            "artifact",
            stage_id=self._current.id if self._current else None,
            message=clean_name,
            data={"artifact": output.model_dump(mode="json")},
        )
        return output

    def artifact_url(self, name: str) -> str:
        return artifact_url(self.job_id or "", name)

    # Generated structures

    async def record_structure(
        self,
        descriptor: StructureDescriptor,
        *,
        structure_artifact: ArtifactOut | None = None,
        uniprot_accession: str | None = None,
        gene_symbol: str | None = None,
        variant_id: str | None = None,
        sequence: str | None = None,
        residue_start: int | None = None,
        residue_end: int | None = None,
    ) -> None:
        """Register a structure this job predicted, so it is listed with the protein or variant.
        Only Helix-generated predictions are recorded: retrieved models stay with their source."""
        if descriptor.origin is not StructureOrigin.PREDICTED_INTERNAL:
            raise ValueError("only predicted_internal structures are recorded as generated structures")
        async with session_scope() as session:
            await session.merge(
                GeneratedStructure(
                    id=descriptor.id,
                    job_id=self.job_id,
                    actor_id=self.actor_id,
                    provider_id=descriptor.provider,
                    model_name=descriptor.model_name,
                    model_version=descriptor.model_version,
                    uniprot_accession=uniprot_accession,
                    gene_symbol=gene_symbol,
                    variant_id=variant_id,
                    sequence_sha256=sha256_hex(sequence) if sequence else None,
                    sequence_length=len(sequence) if sequence else None,
                    residue_start=residue_start,
                    residue_end=residue_end,
                    structure_artifact_id=structure_artifact.id if structure_artifact else None,
                    descriptor=descriptor.model_dump(mode="json"),
                )
            )
