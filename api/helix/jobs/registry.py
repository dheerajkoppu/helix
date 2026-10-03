"""Job handler registry. A handler is an async function decorated with @job_handler in a module
under helix/jobs/handlers/; every module there is imported at startup."""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from helix.schemas.common import EntityRef
from helix.schemas.jobs import StageSpec

if TYPE_CHECKING:
    from helix.jobs.context import JobContext

StageInput = StageSpec | tuple[str, str]
StagePlan = Sequence[StageInput] | Callable[[Any], Sequence[StageInput]]


def to_stage_specs(stages: Sequence[StageInput]) -> list[StageSpec]:
    return [
        stage if isinstance(stage, StageSpec) else StageSpec(id=stage[0], label=stage[1]) for stage in stages
    ]


@dataclass(frozen=True, slots=True)
class JobHandler:
    kind: str
    title: str
    params_model: type[BaseModel]
    run: Callable[[JobContext, Any], Awaitable[Any]]
    description: str | None = None
    result_model: type[BaseModel] | None = None
    stages: StagePlan = ()
    provider: str | Callable[[Any], str | None] | None = None
    restartable: bool = False
    requires_seed: bool = False
    describe: Callable[[Any], str] | None = None
    subject: Callable[[Any], EntityRef | None] | None = None

    def plan(self, params: Any) -> list[StageSpec]:
        stages = self.stages(params) if callable(self.stages) else self.stages
        return to_stage_specs(stages)

    def provider_id(self, params: Any) -> str | None:
        return self.provider(params) if callable(self.provider) else self.provider

    def job_title(self, params: Any) -> str:
        return self.describe(params) if self.describe else self.title

    def job_subject(self, params: Any) -> EntityRef | None:
        return self.subject(params) if self.subject else None


_handlers: dict[str, JobHandler] = {}


def job_handler(
    kind: str,
    *,
    title: str,
    params: type[BaseModel],
    result: type[BaseModel] | None = None,
    description: str | None = None,
    stages: StagePlan = (),
    provider: str | Callable[[Any], str | None] | None = None,
    restartable: bool = False,
    requires_seed: bool = False,
    describe: Callable[[Any], str] | None = None,
    subject: Callable[[Any], EntityRef | None] | None = None,
) -> Callable[[Callable[[JobContext, Any], Awaitable[Any]]], Callable[[JobContext, Any], Awaitable[Any]]]:
    """Register an async function as the handler of a job kind.

    kind: the value clients send as JobCreate.kind and that the run manifest records.
    params: pydantic model the submitted params are validated against (422 on mismatch).
    result: pydantic model of what the handler returns; published as result_schema in /job-kinds.
    stages: the stages the job will go through, or a function of the validated params returning
        them. They are stored on the job at creation, so a queued job already shows its plan.
    provider: provider ID, or a function of the params returning it.
    restartable: safe to run again from the start after a worker interruption.
    requires_seed: the run is stochastic; the job fails unless the handler records parameters.seed.
    describe: job title from the params. subject: the entity the job is about, for job listings.
    """

    def decorator(
        function: Callable[[JobContext, Any], Awaitable[Any]],
    ) -> Callable[[JobContext, Any], Awaitable[Any]]:
        existing = _handlers.get(kind)
        if existing is not None and existing.run.__module__ != function.__module__:
            raise ValueError(f"job kind {kind!r} is already handled by {existing.run.__module__}")
        _handlers[kind] = JobHandler(
            kind=kind,
            title=title,
            params_model=params,
            run=function,
            description=description,
            result_model=result,
            stages=stages,
            provider=provider,
            restartable=restartable,
            requires_seed=requires_seed,
            describe=describe,
            subject=subject,
        )
        return function

    return decorator


def get_handler(kind: str) -> JobHandler | None:
    return _handlers.get(kind)


def all_handlers() -> list[JobHandler]:
    return sorted(_handlers.values(), key=lambda handler: handler.kind)


def load_handlers() -> None:
    """Import every module in helix.jobs.handlers so that each registers its handlers."""
    from helix.plugins import import_submodules

    import_submodules("helix.jobs.handlers")
