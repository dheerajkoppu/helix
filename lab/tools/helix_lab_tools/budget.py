"""Run budget: a cap on lab tool calls and on compute seconds, kept in budget.json of the run directory."""

import fcntl
import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from helix_lab_tools.context import run_dir

BUDGET_FILE = "budget.json"
DEFAULT_MAX_TOOL_CALLS = 160
DEFAULT_MAX_COMPUTE_SECONDS = 300


@contextmanager
def _locked(directory: Path) -> Iterator[None]:
    with (directory / "budget.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def _read(directory: Path) -> dict[str, Any]:
    path = directory / BUDGET_FILE
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    declared: dict[str, Any] = {}
    manifest = directory / "run.json"
    if manifest.exists():
        declared = json.loads(manifest.read_text(encoding="utf-8")).get("budget") or {}
    return {
        "max_tool_calls": int(declared.get("max_tool_calls") or DEFAULT_MAX_TOOL_CALLS),
        "max_compute_seconds": float(declared.get("max_compute_seconds") or DEFAULT_MAX_COMPUTE_SECONDS),
        "tool_calls_used": 0,
        "compute_seconds_used": 0.0,
        "tool_calls_by_agent": {},
    }


def _write(directory: Path, state: dict[str, Any]) -> None:
    (directory / BUDGET_FILE).write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _view(state: dict[str, Any]) -> dict[str, Any]:
    return {
        **state,
        "tool_calls_remaining": max(0, state["max_tool_calls"] - state["tool_calls_used"]),
        "compute_seconds_used": round(state["compute_seconds_used"], 1),
        "compute_seconds_remaining": round(
            max(0.0, state["max_compute_seconds"] - state["compute_seconds_used"]), 1
        ),
    }


def status(directory: Path | None = None) -> dict[str, Any]:
    directory = directory or run_dir()
    with _locked(directory):
        return _view(_read(directory))


def charge_tool_call(
    agent: str, directory: Path | None = None, *, enforce: bool = True
) -> tuple[bool, dict[str, Any]]:
    """Count one lab tool call; refuses once the cap is reached unless the call is exempt from enforcement."""
    directory = directory or run_dir()
    with _locked(directory):
        state = _read(directory)
        if enforce and state["tool_calls_used"] >= state["max_tool_calls"]:
            return False, _view(state)
        state["tool_calls_used"] += 1
        by_agent = state.setdefault("tool_calls_by_agent", {})
        by_agent[agent] = by_agent.get(agent, 0) + 1
        _write(directory, state)
        return True, _view(state)


def add_compute_seconds(seconds: float, directory: Path | None = None) -> dict[str, Any]:
    directory = directory or run_dir()
    with _locked(directory):
        state = _read(directory)
        state["compute_seconds_used"] = float(state["compute_seconds_used"]) + max(0.0, seconds)
        _write(directory, state)
        return _view(state)


def get_budget_status() -> str:
    """Return the run budget: tool calls and compute seconds allowed, used and remaining."""
    from helix_lab_tools.context import respond

    return respond(status)
