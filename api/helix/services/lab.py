"""The agentic lab as files: agent specifications, runs and the research record under lab/.

The API never imports Omnigent. It reads what the launcher writes, starts a run by spawning the
launcher with the lab's own interpreter, and appends a human approval decision to the record.
"""

import fcntl
import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from helix.config import API_PREFIX
from helix.errors import BadRequest, Conflict, NotConfigured, NotFound
from helix.identifiers import parse_variant_id
from helix.schemas.lab import (
    LabAgentsResponse,
    LabApprovalInput,
    LabApprovalResult,
    LabBenchmark,
    LabEvent,
    LabEventsPage,
    LabRun,
    LabRunCreate,
    LabRunDetail,
    LabRunList,
    LabRunStarted,
)

RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
APPROVAL_ID = re.compile(r"^A\d{1,3}$")
ACTIVE_STATUSES = ("running", "awaiting_approval")
MAX_ACTIVE_RUNS = 3
DEFAULT_MAX_TOOL_CALLS = 200
DEFAULT_MAX_COMPUTE_SECONDS = 300


def lab_directory() -> Path:
    configured = os.environ.get("HELIX_LAB_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parents[3] / "lab"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _run_directory(run_id: str) -> Path:
    if not RUN_ID.match(run_id):
        raise NotFound(f"No lab run {run_id}.", code="lab_run_not_found")
    directory = lab_directory() / "runs" / run_id
    if not (directory / "run.json").is_file():
        raise NotFound(f"No lab run {run_id}.", code="lab_run_not_found")
    return directory


def _events(directory: Path) -> list[dict[str, Any]]:
    path = directory / "record.jsonl"
    if not path.is_file():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except ValueError:
            # A line still being written by an agent; it is read on the next request
            continue
    return events


def _pending(events: list[dict[str, Any]]) -> list[str]:
    decided = {event["payload"].get("id") for event in events if event["type"] == "approval_decision"}
    return [
        event["payload"]["id"]
        for event in events
        if event["type"] == "approval_request" and event["payload"].get("id") not in decided
    ]


def _run(directory: Path, events: list[dict[str, Any]] | None = None) -> LabRun | None:
    manifest = _read_json(directory / "run.json")
    if manifest is None:
        return None
    if events is None:
        events = _events(directory) if manifest.get("status") in ACTIVE_STATUSES else []
    manifest["pending_approvals"] = _pending(events) if manifest.get("status") in ACTIVE_STATUSES else []
    try:
        return LabRun.model_validate(manifest)
    except ValueError:
        return None


def agents() -> LabAgentsResponse:
    manifest = _read_json(lab_directory() / "agents" / "agents.json")
    if manifest is None:
        raise NotConfigured(
            "The lab",
            "lab/agents/agents.json is missing. Generate it with lab/tools/generate_agent_tools.py.",
        )
    return LabAgentsResponse.model_validate(manifest)


def list_runs() -> LabRunList:
    root = lab_directory() / "runs"
    # a run is addressed by its directory name, so when two directories claim the same run_id only
    # the one named after it can be opened; listing both would offer a row that leads elsewhere
    by_id: dict[str, LabRun] = {}
    if root.is_dir():
        for directory in sorted(root.iterdir()):
            if not directory.is_dir():
                continue
            run = _run(directory)
            if run is None:
                continue
            if run.run_id not in by_id or directory.name == run.run_id:
                by_id[run.run_id] = run
    runs = sorted(by_id.values(), key=lambda run: run.started_at or "", reverse=True)
    return LabRunList(items=runs, total=len(runs))


def get_run(run_id: str) -> LabRunDetail:
    directory = _run_directory(run_id)
    events = _events(directory)
    run = _run(directory, events)
    if run is None:
        raise NotFound(f"No lab run {run_id}.", code="lab_run_not_found")
    report = directory / "report.md"
    return LabRunDetail(
        **run.model_dump(),
        events=[LabEvent.model_validate(event) for event in events],
        report=report.read_text(encoding="utf-8") if report.is_file() else None,
    )


def get_events(run_id: str, after: int) -> LabEventsPage:
    directory = _run_directory(run_id)
    events = _events(directory)
    manifest = _read_json(directory / "run.json") or {}
    status = manifest.get("status", "running")
    return LabEventsPage(
        run_id=run_id,
        status=status,
        events=[LabEvent.model_validate(event) for event in events if event["seq"] > after],
        last_seq=events[-1]["seq"] if events else 0,
        pending_approvals=_pending(events) if status in ACTIVE_STATUSES else [],
    )


def start_run(body: LabRunCreate) -> LabRunStarted:
    substitution = parse_variant_id(body.variant_id)
    if substitution is None:
        raise BadRequest(
            "variant_id must name a protein substitution as GENE-p.Ref3PosAlt3, for example BTK-p.Arg28His.",
            code="lab_variant_invalid",
        )
    lab = lab_directory()
    interpreter = lab / ".venv" / "bin" / "python"
    launcher = lab / "run_lab.py"
    if not interpreter.is_file() or not launcher.is_file():
        raise NotConfigured(
            "The lab",
            "Omnigent is not installed for this deployment: lab/.venv is missing. See lab/README.md.",
        )
    active = [run for run in list_runs().items if run.status in ACTIVE_STATUSES]
    if len(active) >= MAX_ACTIVE_RUNS:
        raise Conflict(
            f"{len(active)} lab runs are in progress. Wait for one to finish before starting another.",
            code="lab_busy",
        )
    limits = body.budget
    max_tool_calls = (limits.max_tool_calls if limits else None) or DEFAULT_MAX_TOOL_CALLS
    max_compute_seconds = (
        limits.max_compute_seconds
        if limits and limits.max_compute_seconds is not None
        else DEFAULT_MAX_COMPUTE_SECONDS
    )
    suffix = "lab" if body.mode == "specialist_lab" else "baseline"
    run_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{substitution.variant_id}-{suffix}"
    directory = lab / "runs" / run_id
    if directory.exists():
        raise Conflict(f"Run {run_id} already exists. Try again in a second.", code="lab_run_exists")
    directory.mkdir(parents=True)
    objective = (body.objective or "").strip()
    # The launcher replaces this file within a second; it exists so the run can be read at once
    placeholder = {
        "run_id": run_id,
        "objective": objective
        or f"Find the mechanism that best explains the loss of function of {substitution.variant_id}.",
        "subject": {
            "gene": substitution.variant_id.split("-", 1)[0],
            "variant_id": substitution.variant_id,
            "accession": None,
        },
        "mode": body.mode,
        "status": "running",
        "budget": {"max_tool_calls": max_tool_calls, "max_compute_seconds": max_compute_seconds},
        "started_at": _now(),
        "finished_at": None,
        "omnigent": {"version": None, "harness": None, "model": None, "session_id": None},
        "spec_hash": None,
        "metrics": {
            "wall_seconds": None,
            "tool_calls": 0,
            "distinct_sources": 0,
            "evidence_items": 0,
            "hypotheses": 0,
            "tests_considered": 0,
            "approvals": 0,
        },
        "outcome": {
            "favoured_before": None,
            "favoured_after": None,
            "decision_changed": False,
            "next_experiment": None,
        },
    }
    (directory / "run.json").write_text(json.dumps(placeholder, indent=2) + "\n", encoding="utf-8")
    command = [
        str(interpreter),
        str(launcher),
        "--variant",
        substitution.variant_id,
        "--mode",
        body.mode,
        "--run-id",
        run_id,
        "--max-tool-calls",
        str(max_tool_calls),
        "--max-compute-seconds",
        str(int(max_compute_seconds)),
        "--quiet",
    ]
    if objective:
        command += ["--objective", objective]
    with (directory / "launcher.log").open("w", encoding="utf-8") as log:
        # Its own session, so a reload of the API does not end the run
        subprocess.Popen(
            command,
            cwd=str(lab.parent),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    return LabRunStarted(
        run_id=run_id,
        status="running",
        mode=body.mode,
        run_url=f"{API_PREFIX}/lab/runs/{run_id}",
        events_url=f"{API_PREFIX}/lab/runs/{run_id}/events",
    )


def decide_approval(
    run_id: str, approval_id: str, body: LabApprovalInput, decided_by: str
) -> LabApprovalResult:
    directory = _run_directory(run_id)
    if not APPROVAL_ID.match(approval_id):
        raise NotFound(f"No approval {approval_id} in run {run_id}.", code="lab_approval_not_found")
    # Same lock file as the lab's record tools, so seq numbers stay unique
    with (directory / "record.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        events = _events(directory)
        request = next(
            (
                event
                for event in events
                if event["type"] == "approval_request" and event["payload"].get("id") == approval_id
            ),
            None,
        )
        if request is None:
            raise NotFound(f"No approval {approval_id} in run {run_id}.", code="lab_approval_not_found")
        if any(
            event["type"] == "approval_decision" and event["payload"].get("id") == approval_id
            for event in events
        ):
            raise Conflict(f"Approval {approval_id} was already decided.", code="lab_approval_decided")
        event = {
            "seq": (events[-1]["seq"] + 1) if events else 1,
            "at": _now(),
            "run_id": run_id,
            "agent": "human",
            "type": "approval_decision",
            "payload": {
                "id": approval_id,
                "decision": body.decision,
                "by": decided_by,
                "note": (body.note or "").strip() or None,
            },
            "refs": [reference for reference in [request["payload"].get("test_id")] if reference],
            "sources": [],
        }
        with (directory / "record.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    return LabApprovalResult(
        run_id=run_id, approval_id=approval_id, decision=body.decision, event=LabEvent.model_validate(event)
    )


def benchmark() -> LabBenchmark:
    payload = _read_json(lab_directory() / "experiments" / "results" / "latest.json")
    if payload is None:
        raise NotFound(
            "No benchmark result yet: lab/experiments/results/latest.json does not exist.",
            code="lab_benchmark_not_found",
        )
    return LabBenchmark.model_validate(payload)
