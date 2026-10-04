"""Policy handlers wired into every agent spec of the lab.

Each factory takes the role of the agent whose spec declares it. Omnigent also evaluates a parent's
policies on the tool calls of its sub-agents; the supervisor's instances abstain there, because the
sub-agent's own instances, which know its role, decide.
"""

import fcntl
import json
import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from helix_lab_tools import budget, claims, record
from helix_lab_tools.catalogue import CONSEQUENTIAL_TOOLS, EXPERIMENT_TOOLS, TESTS
from helix_lab_tools.registry import CLOSING_TOOLS, HARNESS_TOOLS, LAB_TOOLS, allowed_tools

POLICY_LOG = "policy_log.jsonl"
SUBAGENT_LABEL = "omnigent.subagent.dispatch_id"
RECORD_ROLE = {"generalist": "orchestrator"}

Event = dict[str, Any]
Verdict = dict[str, Any] | None
Evaluator = Callable[[Event], Verdict]


def _run_directory() -> Path | None:
    value = os.environ.get("HELIX_LAB_RUN_DIR")
    if not value:
        return None
    directory = Path(value)
    return directory if directory.is_dir() else None


def _is_subagent_event(event: Event) -> bool:
    labels = (event.get("context") or {}).get("labels") or {}
    return bool(labels.get(SUBAGENT_LABEL))


def _abstains(role: str, event: Event) -> bool:
    return role == "orchestrator" and _is_subagent_event(event)


def _tool_call(event: Event) -> tuple[str, dict[str, Any]] | None:
    if event.get("type") != "tool_call":
        return None
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    name = str(event.get("target") or data.get("name") or "")
    arguments = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    return name.removeprefix("mcp__omnigent__"), arguments


def _log(policy: str, role: str, tool: str, verdict: str, reason: str = "") -> None:
    directory = _run_directory()
    if directory is None:
        return
    row = {
        "at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "policy": policy,
        "agent": role,
        "tool": tool,
        "verdict": verdict,
        "reason": reason,
    }
    with (directory / POLICY_LOG).open("a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _deny(policy: str, role: str, tool: str, reason: str) -> Verdict:
    """Deny, and leave the denial in the policy log and in the research record."""
    _log(policy, role, tool, "DENY", reason)
    directory = _run_directory()
    if directory is not None:
        record.append_event(
            "orchestrator",
            "note",
            {
                "kind": "policy_denial",
                "policy": policy,
                "calling_agent": RECORD_ROLE.get(role, role),
                "tool": tool,
                "text": reason,
            },
            directory=directory,
        )
    return {"result": "DENY", "reason": reason}


def role_boundary(role: str) -> Evaluator:
    """Deny every tool that is not in the calling agent's role, including tools Omnigent registers by default."""
    permitted = allowed_tools(role)

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, _ = call
        if tool in permitted:
            if tool not in HARNESS_TOOLS:
                _log("role_boundary", role, tool, "ALLOW")
            return {"result": "ALLOW"}
        return _deny(
            "role_boundary",
            role,
            tool,
            f"{tool} is outside the {role} role. Tools of this role: {', '.join(sorted(permitted - HARNESS_TOOLS))}.",
        )

    return evaluate


def approval_gate(role: str) -> Evaluator:
    """Let a test run only when it is the planned test, safety cleared it and, for a compute job, a human approved it."""

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, arguments = call
        if tool not in EXPERIMENT_TOOLS:
            return None
        directory = _run_directory()
        if directory is None:
            return _deny("approval_gate", role, tool, "No run directory, so no approval can be on record.")
        events = record.load_events(directory)
        test_id = str(arguments.get("test_id") or "")
        plan = record.latest_plan(events)
        if plan is None:
            return _deny(
                "approval_gate", role, tool, "No plan is on record. The planner must record a plan first."
            )
        chosen = plan["payload"]["chosen_test_id"]
        if test_id != chosen:
            return _deny(
                "approval_gate",
                role,
                tool,
                f"{test_id or 'This call'} is not the chosen test of the latest plan ({chosen}).",
            )
        candidate = record.by_id(events, test_id)
        if candidate is None or candidate["payload"]["tool"] != tool:
            expected = candidate["payload"]["tool"] if candidate else "none"
            return _deny("approval_gate", role, tool, f"{test_id} is executed by {expected}, not by {tool}.")
        reviews = [
            note
            for note in record.notes_of_kind(events, "safety_review")
            if note["payload"]["test_id"] == test_id and note["payload"].get("plan_seq") == plan["seq"]
        ]
        if not reviews or reviews[-1]["payload"]["verdict"] != "cleared":
            return _deny(
                "approval_gate", role, tool, f"The safety agent has not cleared {test_id} of the latest plan."
            )
        if tool in CONSEQUENTIAL_TOOLS:
            request, decision = record.approval_for(events, test_id)
            if request is None:
                return _deny(
                    "approval_gate",
                    role,
                    tool,
                    f"{tool} starts a compute job and needs human approval. No approval request for {test_id} is on record.",
                )
            if decision is None or decision["payload"].get("decision") != "approved":
                state = decision["payload"].get("decision") if decision else "pending"
                return _deny(
                    "approval_gate",
                    role,
                    tool,
                    f"{tool} needs an approved human decision; approval {request['payload']['id']} is {state}.",
                )
            _log("approval_gate", role, tool, "ALLOW", f"approved by {decision['payload'].get('by')}")
        else:
            _log("approval_gate", role, tool, "ALLOW", "retrieval-only test, cleared by safety")
        return {"result": "ALLOW"}

    return evaluate


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in _strings(item)]
    return []


def claims_guard(role: str) -> Evaluator:
    """Reject clinical or treatment wording, citations of records that do not exist, and uncited facts."""

    def evaluate(event: Event) -> Verdict:
        if _abstains(role, event):
            return None
        directory = _run_directory()
        known = record.known_ids(record.load_events(directory)) if directory else None
        call = _tool_call(event)
        if call is not None:
            tool, arguments = call
            if not tool.startswith(("record_", "request_approval", "propose_candidates")):
                return None
            text = "\n".join(_strings(arguments))
            problems = claims.check_text(
                text,
                known if tool == "record_final_report" else None,
                require_citations=tool == "record_final_report",
            )
            if problems:
                return _deny(
                    "claims_guard",
                    role,
                    tool,
                    "Refused: " + "; ".join(problems) + ". Rewrite and call again.",
                )
            return None
        if event.get("type") != "response":
            return None
        data = event.get("data")
        text = data if isinstance(data, str) else "\n".join(_strings(data))
        if not text.strip():
            return None
        problems = claims.check_text(text, known, require_citations=True)
        if problems:
            return _deny(
                "claims_guard",
                role,
                "response",
                "Reply refused: "
                + "; ".join(problems)
                + ". Reply with record IDs only, or cite the ID next to each fact.",
            )
        return {"result": "ALLOW"}

    return evaluate


def run_budget(role: str) -> Evaluator:
    """Cap the lab tool calls and the compute seconds of the whole run."""

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, _ = call
        if tool not in LAB_TOOLS:
            return None
        directory = _run_directory()
        if directory is None:
            return None
        if tool in EXPERIMENT_TOOLS:
            needed = TESTS[EXPERIMENT_TOOLS[tool]]["cost"]["compute_seconds"]
            remaining = budget.status(directory)["compute_seconds_remaining"]
            if needed > remaining:
                return _deny(
                    "run_budget",
                    role,
                    tool,
                    f"{tool} needs about {needed} compute seconds; {remaining} remain in the run budget.",
                )
        permitted, state = budget.charge_tool_call(
            RECORD_ROLE.get(role, role), directory, enforce=tool not in CLOSING_TOOLS
        )
        if not permitted:
            return _deny(
                "run_budget",
                role,
                tool,
                f"Run budget exhausted: {state['tool_calls_used']} of {state['max_tool_calls']} tool calls used. "
                f"Only these remain available: {', '.join(sorted(CLOSING_TOOLS))}.",
            )
        return {"result": "ALLOW"}

    return evaluate


POLICY_REGISTRY = [
    {
        "handler": f"helix_lab_policies.policies.{name}",
        "kind": "factory",
        "name": title,
        "description": description,
        "params_schema": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "description": "Role of the agent that declares the policy"}
            },
            "required": ["role"],
        },
    }
    for name, title, description in (
        ("role_boundary", "Role boundary", "Deny tools outside the agent's role."),
        (
            "approval_gate",
            "Approval gate",
            "Deny tests that are not planned, cleared and, for compute jobs, approved by a human.",
        ),
        (
            "claims_guard",
            "Claims guard",
            "Reject clinical or treatment wording and uncited factual statements.",
        ),
        ("run_budget", "Run budget", "Cap the tool calls and compute seconds of a run."),
    )
]
