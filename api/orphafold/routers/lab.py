"""The agentic lab: agent specifications, discovery runs, the research record, approvals, benchmark."""

from typing import Annotated

from fastapi import APIRouter, Query, Response

from orphafold.config import API_PREFIX
from orphafold.deps import OptionalActor
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.lab import (
    LabAgentsResponse,
    LabApprovalInput,
    LabApprovalResult,
    LabBenchmark,
    LabEventsPage,
    LabRunCreate,
    LabRunDetail,
    LabRunList,
    LabRunStarted,
)
from orphafold.services import lab

router = APIRouter(prefix="/lab", tags=["lab"], responses=PROBLEM_RESPONSES)


@router.get(
    "/agents",
    response_model=LabAgentsResponse,
    summary="Agent specifications, tool permissions, policies and tests of the lab",
)
async def get_lab_agents() -> LabAgentsResponse:
    return lab.agents()


@router.get("/runs", response_model=LabRunList, summary="Lab runs, newest first")
async def list_lab_runs() -> LabRunList:
    return lab.list_runs()


@router.post(
    "/runs",
    response_model=LabRunStarted,
    status_code=202,
    summary="Start a discovery run in the background",
)
async def start_lab_run(body: LabRunCreate, response: Response) -> LabRunStarted:
    started = lab.start_run(body)
    response.headers["Location"] = f"{API_PREFIX}/lab/runs/{started.run_id}"
    return started


@router.get(
    "/benchmark",
    response_model=LabBenchmark,
    summary="Measured comparison of the lab with the single-agent control",
)
async def get_lab_benchmark() -> LabBenchmark:
    return lab.benchmark()


@router.get(
    "/runs/{run_id}",
    response_model=LabRunDetail,
    summary="One run: run.json, every record event and the report",
)
async def get_lab_run(run_id: str) -> LabRunDetail:
    return lab.get_run(run_id)


@router.get(
    "/runs/{run_id}/events",
    response_model=LabEventsPage,
    summary="Record events after a sequence number, for following a run",
)
async def get_lab_run_events(
    run_id: str,
    after: Annotated[int, Query(ge=0, description="Return events with a seq above this value")] = 0,
) -> LabEventsPage:
    return lab.get_events(run_id, after)


@router.post(
    "/runs/{run_id}/approvals/{approval_id}",
    response_model=LabApprovalResult,
    summary="Approve or reject a consequential action; the decision is written to the record",
)
async def decide_lab_approval(
    run_id: str, approval_id: str, body: LabApprovalInput, actor: OptionalActor
) -> LabApprovalResult:
    decided_by = f"workspace {actor.id} (API)" if actor is not None else "API caller without a workspace"
    return lab.decide_approval(run_id, approval_id, body, decided_by)
