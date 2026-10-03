"""Input checks shared by the structure_prediction and variant_comparison job kinds."""

from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

from helix.providers.base import (
    Availability,
    ProviderKind,
    RunContext,
    StructurePredictor,
    get_provider,
    providers_of_kind,
)

STANDARD_RESIDUES = frozenset("ACDEFGHIKLMNPQRSTVWY")


def clean_sequence(text: str) -> str:
    """Raw sequence input: FASTA header and whitespace removed, upper case."""
    lines = [line.strip() for line in text.strip().splitlines() if not line.startswith(">")]
    return "".join("".join(line.split()) for line in lines).upper()


def nonstandard_residues(sequence: str) -> list[str]:
    return sorted(set(sequence) - STANDARD_RESIDUES)


def predictors_for(job_kind: str) -> list[StructurePredictor]:
    """Registered structure predictors that declare this job kind."""
    return [
        provider
        for provider in providers_of_kind(ProviderKind.STRUCTURE_PREDICTOR)
        if isinstance(provider, StructurePredictor) and job_kind in provider.job_kinds
    ]


def predictor_for(provider_id: str, job_kind: str) -> StructurePredictor | None:
    provider = get_provider(provider_id)
    if isinstance(provider, StructurePredictor) and job_kind in provider.job_kinds:
        return provider
    return None


def unknown_provider_message(provider_id: str, job_kind: str) -> str:
    known = ", ".join(provider.id for provider in predictors_for(job_kind)) or "none"
    return f"'{provider_id}' is not a structure predictor for {job_kind}. Registered: {known}."


def length_blocker(provider: StructurePredictor, length: int) -> str | None:
    if provider.max_residues is not None and length > provider.max_residues:
        return (
            f"The construct has {length} residues; {provider.name} accepts at most {provider.max_residues}."
        )
    return None


def availability_blocker(provider: StructurePredictor, availability: Availability) -> str | None:
    return None if availability.available else f"{provider.name} cannot run here: {availability.reason}"


class RoleContext:
    """RunContext of one of the two predictions of a comparison. A provider enters its own stage
    IDs; here they map to the stages the job declared for that role."""

    def __init__(self, context: RunContext, role: str) -> None:
        self._context = context
        self._role = role
        self.job_id = context.job_id

    @staticmethod
    def stage_id(role: str, stage_id: str) -> str:
        return f"{role}_{stage_id}"

    @property
    def workdir(self) -> Path:
        path = self._context.workdir / self._role
        path.mkdir(parents=True, exist_ok=True)
        return path

    def stage(self, stage_id: str) -> AbstractAsyncContextManager[None]:
        return self._context.stage(self.stage_id(self._role, stage_id))

    async def log(self, message: str, *, level: str = "info", **data: Any) -> None:
        await self._context.log(f"{self._role.capitalize()} model: {message}", level=level, **data)

    async def progress(
        self,
        completed: float,
        total: float | None = None,
        *,
        unit: str | None = None,
        detail: str | None = None,
    ) -> None:
        await self._context.progress(completed, total, unit=unit, detail=detail)

    async def check_cancelled(self) -> None:
        await self._context.check_cancelled()
