"""Run the matched comparison of the specialist lab against the single-agent control.

    lab/.venv/bin/python lab/experiments/run_benchmark.py                  # run what is missing, then aggregate
    lab/.venv/bin/python lab/experiments/run_benchmark.py --aggregate-only # rebuild latest.json from lab/runs/

Protocol: lab/experiments/protocol.md. Every run goes through lab/run_lab.py with the same budget, and its
record stays in lab/runs/<run_id>/. A run that already succeeded is never repeated, so an interrupted batch
continues where it stopped. The aggregate is written to lab/experiments/results/latest.json after every
finished run.
"""

import argparse
import fcntl
import getpass
import hashlib
import json
import math
import os
import re
import signal
import statistics
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXPERIMENTS = Path(__file__).resolve().parent
LAB = EXPERIMENTS.parent
sys.path.insert(0, str(LAB / "tools"))

from helix_lab_tools.registry import EXPERIMENT_TOOLS, RETRIEVAL_TOOLS  # noqa: E402

RUNS = LAB / "runs"
RESULTS = EXPERIMENTS / "results"
LOGS = RESULTS / "logs"
LABELS = EXPERIMENTS / "reference" / "labels.json"
PREFLIGHT = RESULTS / "preflight.json"
INTERPRETATION = EXPERIMENTS / "interpretation.json"
LATEST = RESULTS / "latest.json"

QUESTION = (
    "For a pathogenic missense variant in an immune-deficiency gene, which molecular mechanism best explains "
    "the loss of function, and does a targeted computational test change the conclusion that the starting "
    "evidence suggested? Measured here: what a supervised team of specialist agents changes, against one "
    "generalist agent with the same tools, model, policies and budget."
)
ARMS: dict[str, dict[str, str]] = {
    "specialist_lab": {
        "suffix": "lab",
        "label": "Specialist lab: Omnigent supervisor and seven specialist agents",
    },
    "single_agent_baseline": {
        "suffix": "baseline",
        "label": "Control: one generalist agent with every tool",
    },
}
ACTIVE_STATES = ("running", "awaiting_approval")
PRIMARY_METRIC = "Median wall seconds from launch to a complete cited record (launcher clock)"
CONTROLS = [
    "Same tools: the control agent holds every tool of the lab, generated from the same registry.",
    "Same model in every agent of both arms; the model names are read from each run.json.",
    "Same policies in both arms: role boundary, approval gate, claims guard, run budget.",
    "Same budget per run: tool calls and compute seconds, enforced by policy.",
    "Same objective text and subject line for a variant in both arms, built by lab/run_lab.py.",
    "Same approval rule in both arms: pre-approved by the documented rule of protocol.md section 5.",
    "Variant set fixed before any run: the first-listed flagship variant of every gene in data/seed/catalog.json.",
    "Reference labels derived from UniProtKB by a fixed script before any benchmark run, never shown to an agent.",
    "API caches filled for every variant by a scripted preflight before the first run, so neither arm pays for a cold upstream database.",
    "Arms interleaved in one worker pool with the starting arm alternating by variant, so both arms see the same concurrency.",
    "Citations can only name a database record a tool returned in that run (source ledger), in both arms.",
    "spec_hash of the agent bundle, policies and tool package recorded per run; a change during the batch is reported.",
    "Failed attempts are kept in lab/runs/ and counted; a failed run is retried at most once.",
]
# What a tool call is for, so that coordination can be told apart from science
TOOL_CATEGORIES: dict[str, frozenset[str]] = {
    "retrieval": frozenset(RETRIEVAL_TOOLS),
    "evidence_record": frozenset({"record_evidence", "record_gap"}),
    "reasoning_record": frozenset(
        {
            "record_hypothesis",
            "record_test_candidate",
            "record_plan",
            "record_interpretation",
            "record_decision",
            "record_next_experiment",
            "record_reopening",
            "record_final_report",
        }
    ),
    "safety": frozenset({"review_claims", "record_safety_review", "request_approval"}),
    "test": frozenset({*EXPERIMENT_TOOLS, "record_result", "get_test_result"}),
    "coordination": frozenset(
        {"record_handoff", "read_record", "get_budget_status", "check_record_consistency"}
    ),
    "omnigent_dispatch": frozenset(
        {"sys_session_send", "sys_read_inbox", "sys_session_get_history", "load_skill"}
    ),
}
GAIN_OF_FUNCTION = re.compile(r"gain[- ]of[- ]function|hyperactiv|constitutive(ly)? activ", re.IGNORECASE)
CITATION = re.compile(r"\[((?:[EGHTA]\d+)(?:\s*,\s*[EGHTA]\d+)*)\]")

write_lock = threading.Lock()
launch_lock = threading.Lock()
active_runs: set[str] = set()


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_labels() -> dict[str, Any]:
    if not LABELS.exists():
        raise SystemExit(
            "lab/experiments/reference/labels.json is missing. Derive the reference labels first: "
            "lab/.venv/bin/python lab/experiments/reference_labels.py"
        )
    return read_json(LABELS)


def run_id_of(batch: str, variant_id: str, arm: str, attempt: int) -> str:
    base = f"{batch}-{variant_id}-{ARMS[arm]['suffix']}"
    return base if attempt == 1 else f"{base}-r{attempt}"


def manifest_of(run_id: str) -> dict[str, Any] | None:
    path = RUNS / run_id / "run.json"
    if not path.exists():
        return None
    try:
        return read_json(path)
    except ValueError:
        return None


def attempts_of(batch: str, variant_id: str, arm: str) -> list[dict[str, Any]]:
    """Every attempt of one cell of the design that left a run directory, in order."""
    found = []
    attempt = 1
    while True:
        run_id = run_id_of(batch, variant_id, arm, attempt)
        manifest = manifest_of(run_id)
        if manifest is None:
            break
        status = manifest.get("status")
        if status in ACTIVE_STATES and run_id not in active_runs:
            status = "interrupted"
        found.append({"run_id": run_id, "attempt": attempt, "status": status, "manifest": manifest})
        attempt += 1
    return found


def load_events(run_id: str) -> list[dict[str, Any]]:
    path = RUNS / run_id / "record.jsonl"
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            events.append(json.loads(line))
    return events


def seconds_between(first: str | None, second: str | None) -> float | None:
    if not first or not second:
        return None
    return (
        datetime.fromisoformat(second.replace("Z", "+00:00"))
        - datetime.fromisoformat(first.replace("Z", "+00:00"))
    ).total_seconds()


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event for event in events if event["type"] == kind]


def notes(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event for event in of_type(events, "note") if event["payload"].get("kind") == kind]


def completeness(events: list[dict[str, Any]]) -> list[str]:
    """What a complete cited record must hold and this one does not."""
    missing = []
    evidence = of_type(events, "evidence")
    hypotheses = of_type(events, "hypothesis")
    if not of_type(events, "objective"):
        missing.append("objective")
    if not evidence:
        missing.append("evidence")
    if any(
        not event["sources"]
        or any(not row.get("database") or not row.get("record_id") for row in event["sources"])
        for event in evidence
    ):
        missing.append("a database record for every evidence item")
    if len({event["payload"].get("mechanism_class") for event in hypotheses}) < 2:
        missing.append("two hypotheses of different mechanism classes")
    if any(event["payload"].get("label") != "agent-generated hypothesis" for event in hypotheses):
        missing.append("the agent-generated label on every hypothesis")
    if len(of_type(events, "test_candidate")) < 2:
        missing.append("two test candidates")
    if not any(event["payload"].get("chosen_test_id") for event in of_type(events, "plan")):
        missing.append("plan")
    if not any(
        event["payload"].get("reproducible_command") for event in of_type(events, "experiment_result")
    ):
        missing.append("experiment result with a reproducible command")
    if not any(event["payload"].get("uncertainty") for event in of_type(events, "interpretation")):
        missing.append("interpretation with uncertainty")
    if not of_type(events, "decision"):
        missing.append("decision")
    if not of_type(events, "next_experiment"):
        missing.append("next experiment")
    if not notes(events, "final_report"):
        missing.append("final report")
    return missing


def record_measures(run_id: str) -> dict[str, Any]:
    """Everything the benchmark reads from the research record beyond run.json."""
    events = load_events(run_id)
    if not events:
        return {"record_events": 0}
    started = events[0]["at"]

    def first_at(kind: str) -> str | None:
        rows = of_type(events, kind)
        return rows[0]["at"] if rows else None

    hypotheses = of_type(events, "hypothesis")
    first_hypothesis_seq = hypotheses[0]["seq"] if hypotheses else None
    starting_evidence = [
        event
        for event in of_type(events, "evidence")
        if first_hypothesis_seq is None or event["seq"] < first_hypothesis_seq
    ]
    candidates = {event["payload"]["id"]: event["payload"] for event in of_type(events, "test_candidate")}
    plans = of_type(events, "plan")
    results = of_type(events, "experiment_result")
    decisions = of_type(events, "decision")
    approvals = of_type(events, "approval_decision")
    reports = notes(events, "final_report")
    report_text = (
        str(reports[-1]["payload"].get("text") or reports[-1]["payload"].get("markdown") or "")
        if reports
        else ""
    )
    cited_in_report = sorted(
        {item.strip() for group in CITATION.findall(report_text) for item in group.split(",")}
    )
    reasoning = " ".join(
        [event["payload"].get("statement", "") for event in hypotheses]
        + [event["payload"].get("why", "") for event in decisions]
        + [report_text]
    )
    chosen = [
        {
            "test_id": event["payload"].get("chosen_test_id"),
            "test_kind": (candidates.get(event["payload"].get("chosen_test_id")) or {}).get("test_kind"),
        }
        for event in plans
    ]
    return {
        "record_events": len(events),
        "missing_from_record": completeness(events),
        "starting_evidence_items": len(starting_evidence),
        "starting_distinct_sources": len(
            {row["database"] for event in starting_evidence for row in event["sources"]}
        ),
        "gaps": len(of_type(events, "gap")),
        "hypothesis_classes": [event["payload"].get("mechanism_class") for event in hypotheses],
        "candidate_tests": [
            {
                "test_kind": payload.get("test_kind"),
                "expected_learning": payload.get("expected_learning"),
                "feasibility": payload.get("feasibility"),
                "compute_seconds": (payload.get("cost") or {}).get("compute_seconds"),
            }
            for payload in candidates.values()
        ],
        "chosen_tests": [row["test_kind"] for row in chosen],
        "executed_tests": [
            {
                "test_kind": event["payload"].get("test_kind"),
                "verdict": (event["payload"].get("values") or {}).get("verdict"),
                "headline": (event["payload"].get("values") or {}).get("headline"),
            }
            for event in results
        ],
        "decisions": [
            {
                "favoured_before": event["payload"].get("favoured_before"),
                "favoured_after": event["payload"].get("favoured_after"),
                "changed": event["payload"].get("changed"),
            }
            for event in decisions
        ],
        "reopenings": len(notes(events, "reopened_assumption")),
        "reopened": [
            {
                "hypothesis_id": event["payload"].get("hypothesis_id"),
                "mechanism_class": next(
                    (
                        row["payload"].get("mechanism_class")
                        for row in hypotheses
                        if row["payload"]["id"] == event["payload"].get("hypothesis_id")
                    ),
                    None,
                ),
                "reason": event["payload"].get("reason") or event["payload"].get("text"),
            }
            for event in notes(events, "reopened_assumption")
        ],
        "safety_reviews_blocked": sum(
            1 for event in notes(events, "safety_review") if event["payload"].get("verdict") == "blocked"
        ),
        "approval_requests": [
            {
                "id": event["payload"].get("id"),
                "action": event["payload"].get("action"),
                "tool": event["payload"].get("tool"),
                "decision": next(
                    (
                        row["payload"].get("decision")
                        for row in approvals
                        if row["payload"].get("id") == event["payload"].get("id")
                    ),
                    None,
                ),
            }
            for event in of_type(events, "approval_request")
        ],
        "approvals_approved": sum(1 for event in approvals if event["payload"].get("decision") == "approved"),
        "approvals_rejected": sum(1 for event in approvals if event["payload"].get("decision") == "rejected"),
        "policy_denials": len(notes(events, "policy_denial")),
        "report_words": len(report_text.split()),
        "report_cited_ids": len(cited_in_report),
        "mentions_gain_of_function": bool(GAIN_OF_FUNCTION.search(reasoning)),
        "seconds_to_first_evidence": seconds_between(started, first_at("evidence")),
        "seconds_to_first_hypothesis": seconds_between(started, first_at("hypothesis")),
        "seconds_to_first_plan": seconds_between(started, first_at("plan")),
        "seconds_to_first_result": seconds_between(started, first_at("experiment_result")),
        "seconds_to_first_decision": seconds_between(started, first_at("decision")),
        "seconds_to_final_report": seconds_between(started, reports[-1]["at"] if reports else None),
    }


def tool_call_categories(run_id: str) -> dict[str, int]:
    """Allowed tool calls of a run by purpose, from the policy log (one role-boundary entry per call)."""
    path = RUNS / run_id / "policy_log.jsonl"
    counts: Counter[str] = Counter()
    if not path.exists():
        return {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry.get("policy") != "role_boundary" or entry.get("verdict") != "ALLOW":
            continue
        category = next(
            (name for name, tools in TOOL_CATEGORIES.items() if entry.get("tool") in tools), "other"
        )
        counts[category] += 1
    return dict(counts)


def session_usage(run_id: str) -> dict[str, Any]:
    """Omnigent's own accounting for the root session, which covers its sub-agent sessions."""
    path = RUNS / run_id / "transcript.jsonl"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        first = handle.readline()
    try:
        meta = json.loads(first)
    except ValueError:
        return {}
    totals: Counter[str] = Counter()
    for usage in (meta.get("usage_by_model") or {}).values():
        for key in (
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        ):
            totals[key] += int(usage.get(key) or 0)
    if not totals:
        return {}
    return {
        **dict(totals),
        "omnigent_reported_cost_usd": round(float(meta.get("total_cost_usd") or 0.0), 4),
    }


def median(values: list[float]) -> float | None:
    cleaned = [value for value in values if value is not None]
    return round(statistics.median(cleaned), 1) if cleaned else None


def mean(values: list[float]) -> float | None:
    cleaned = [value for value in values if value is not None]
    return round(statistics.fmean(cleaned), 2) if cleaned else None


def sign_test(differences: list[float]) -> float | None:
    """Exact two-sided sign test on paired differences; ties are dropped."""
    positive = sum(1 for value in differences if value > 0)
    negative = sum(1 for value in differences if value < 0)
    informative = positive + negative
    if informative == 0:
        return None
    tail = sum(math.comb(informative, count) for count in range(min(positive, negative) + 1))
    return round(min(1.0, 2 * tail / 2**informative), 4)


def paired(rows: dict[tuple[str, str], dict[str, Any]], variants: list[str], field: str) -> dict[str, Any]:
    differences = []
    ratios = []
    for variant_id in variants:
        lab_row = rows.get((variant_id, "specialist_lab"))
        baseline_row = rows.get((variant_id, "single_agent_baseline"))
        if not lab_row or not baseline_row:
            continue
        if lab_row.get("status") != "succeeded" or baseline_row.get("status") != "succeeded":
            continue
        if lab_row.get(field) is None or baseline_row.get(field) is None:
            continue
        differences.append(lab_row[field] - baseline_row[field])
        if baseline_row[field]:
            ratios.append(lab_row[field] / baseline_row[field])
    return {
        "metric": field,
        "n_pairs": len(differences),
        "lab_higher": sum(1 for value in differences if value > 0),
        "baseline_higher": sum(1 for value in differences if value < 0),
        "ties": sum(1 for value in differences if value == 0),
        "median_difference_lab_minus_baseline": median(differences),
        "median_ratio_lab_over_baseline": round(statistics.median(ratios), 2) if ratios else None,
        "sign_test_two_sided_p": sign_test(differences),
    }


def concordance(rows: dict[tuple[str, str], dict[str, Any]], variants: list[str]) -> dict[str, Any]:
    """How often the two arms name the same mechanism class for a variant, before and after the test."""
    pairs = [
        (rows[(variant_id, "specialist_lab")], rows[(variant_id, "single_agent_baseline")])
        for variant_id in variants
        if rows[(variant_id, "specialist_lab")]["status"] == "succeeded"
        and rows[(variant_id, "single_agent_baseline")]["status"] == "succeeded"
    ]
    return {
        "n_pairs": len(pairs),
        "same_favoured_before": sum(
            1 for lab_row, other in pairs if lab_row["favoured_before"] == other["favoured_before"]
        ),
        "same_favoured_after": sum(
            1 for lab_row, other in pairs if lab_row["favoured_after"] == other["favoured_after"]
        ),
        "same_first_test": sum(
            1
            for lab_row, other in pairs
            if (lab_row.get("chosen_tests") or [None])[0] == (other.get("chosen_tests") or [None])[0]
        ),
        "variants_differing_after": [
            lab_row["variant_id"]
            for lab_row, other in pairs
            if lab_row["favoured_after"] != other["favoured_after"]
        ],
    }


def preflight_databases(variant_id: str) -> list[str]:
    """Databases the scripted retrieval pass returned for a variant, without any agent."""
    if not PREFLIGHT.exists():
        return []
    for row in read_json(PREFLIGHT)["variants"]:
        if row["variant_id"] == variant_id:
            return row["databases_returned"]
    return []


def databases_cited(run_id: str) -> list[str]:
    cited = set()
    for event in load_events(run_id):
        if event["type"] in ("evidence", "experiment_result"):
            cited.update(row["database"] for row in event["sources"])
    return sorted(cited)


def cell(batch: str, label: dict[str, Any], arm: str) -> dict[str, Any]:
    """One row of per_variant: the succeeded attempt of a cell, or its last attempt when none succeeded."""
    variant_id = label["variant_id"]
    attempts = attempts_of(batch, variant_id, arm)
    reference = label["reference_mechanism"]
    row: dict[str, Any] = {
        "variant_id": variant_id,
        "arm": arm,
        "run_id": None,
        "wall_seconds": None,
        "distinct_sources": None,
        "favoured_after": None,
        "reference_mechanism": reference,
        "agrees": None,
        "decision_changed": None,
        "status": "not_run",
        "attempts": len(attempts),
        "failed_attempts": [
            {
                "run_id": attempt["run_id"],
                "status": attempt["status"],
                "error": attempt["manifest"].get("error"),
                "wall_seconds": (attempt["manifest"].get("metrics") or {}).get("wall_seconds"),
            }
            for attempt in attempts
            if attempt["status"] != "succeeded" and attempt["status"] not in ACTIVE_STATES
        ],
        "reference_tier": label["reference_tier"],
    }
    if not attempts:
        return row
    succeeded = [attempt for attempt in attempts if attempt["status"] == "succeeded"]
    chosen = succeeded[0] if succeeded else attempts[-1]
    manifest = chosen["manifest"]
    metrics = manifest.get("metrics") or {}
    outcome = manifest.get("outcome") or {}
    row.update(
        {
            "run_id": chosen["run_id"],
            "status": chosen["status"],
            "started_at": manifest.get("started_at"),
            "spec_hash": manifest.get("spec_hash"),
            "models": sorted(set(((manifest.get("omnigent") or {}).get("models") or {}).values())),
        }
    )
    if chosen["status"] != "succeeded":
        row["error"] = manifest.get("error")
        return row
    measures = record_measures(chosen["run_id"])
    measures["tool_calls_by_purpose"] = tool_call_categories(chosen["run_id"])
    measures["databases_cited"] = databases_cited(chosen["run_id"])
    offered = preflight_databases(variant_id)
    measures["databases_returned_by_scripted_pass"] = len(offered)
    measures["share_of_scripted_pass_databases_cited"] = (
        round(len(set(measures["databases_cited"]) & set(offered)) / len(offered), 2) if offered else None
    )
    usage = session_usage(chosen["run_id"])
    measures["usage"] = usage
    measures["output_tokens"] = usage.get("output_tokens")
    measures["omnigent_reported_cost_usd"] = usage.get("omnigent_reported_cost_usd")
    favoured_before = outcome.get("favoured_before")
    favoured_after = outcome.get("favoured_after")
    row.update(
        {
            "wall_seconds": metrics.get("wall_seconds"),
            "distinct_sources": metrics.get("distinct_sources"),
            "favoured_after": favoured_after,
            "agrees": (favoured_after == reference) if reference else None,
            "decision_changed": bool(outcome.get("decision_changed")),
            "favoured_before": favoured_before,
            "agrees_before": (favoured_before == reference) if reference else None,
            "tool_calls": metrics.get("tool_calls"),
            "evidence_items": metrics.get("evidence_items"),
            "hypotheses": metrics.get("hypotheses"),
            "tests_considered": metrics.get("tests_considered"),
            "tests_executed": metrics.get("tests_executed"),
            "approvals": metrics.get("approvals"),
            "compute_seconds": metrics.get("compute_seconds"),
            "sub_agent_sessions": (manifest.get("omnigent") or {}).get("sub_agent_sessions"),
            "complete_record": not measures.get("missing_from_record"),
            **measures,
        }
    )
    return row


def summarise(arm: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    done = [row for row in rows if row["status"] == "succeeded"]
    referenced = [row for row in done if row["reference_mechanism"]]
    residue_specific = [row for row in referenced if row["reference_tier"] == "residue_specific"]
    walls = [row["wall_seconds"] for row in done]
    return {
        "id": arm,
        "label": ARMS[arm]["label"],
        "runs": len(done),
        "median_wall_seconds": median(walls),
        "mean_tool_calls": mean([row["tool_calls"] for row in done]),
        "mean_distinct_sources": mean([row["distinct_sources"] for row in done]),
        "mean_evidence_items": mean([row["evidence_items"] for row in done]),
        "agreement": {
            "n_with_reference": len(referenced),
            "n_agree": sum(1 for row in referenced if row["agrees"]),
        },
        "decision_changed": sum(1 for row in done if row["decision_changed"]),
        "runs_planned": len(rows),
        "runs_not_succeeded": sum(
            1 for row in rows if row["status"] not in ("succeeded", "not_run", *ACTIVE_STATES)
        ),
        "runs_in_progress": sum(1 for row in rows if row["status"] in ACTIVE_STATES),
        "runs_not_started": sum(1 for row in rows if row["status"] == "not_run"),
        "failed_attempts": sum(len(row["failed_attempts"]) for row in rows),
        "complete_records": sum(1 for row in done if row.get("complete_record")),
        "min_wall_seconds": min(walls) if walls else None,
        "max_wall_seconds": max(walls) if walls else None,
        "mean_wall_seconds": mean(walls),
        "median_seconds_to_first_hypothesis": median(
            [row.get("seconds_to_first_hypothesis") for row in done]
        ),
        "median_seconds_to_first_plan": median([row.get("seconds_to_first_plan") for row in done]),
        "median_seconds_to_first_result": median([row.get("seconds_to_first_result") for row in done]),
        "median_seconds_to_first_decision": median([row.get("seconds_to_first_decision") for row in done]),
        "median_seconds_to_final_report": median([row.get("seconds_to_final_report") for row in done]),
        "median_tool_calls": median([row["tool_calls"] for row in done]),
        "median_distinct_sources": median([row["distinct_sources"] for row in done]),
        "median_evidence_items": median([row["evidence_items"] for row in done]),
        "mean_starting_evidence_items": mean([row.get("starting_evidence_items") for row in done]),
        "mean_starting_distinct_sources": mean([row.get("starting_distinct_sources") for row in done]),
        "mean_hypotheses": mean([row["hypotheses"] for row in done]),
        "mean_tests_considered": mean([row["tests_considered"] for row in done]),
        "mean_tests_executed": mean([row["tests_executed"] for row in done]),
        "runs_with_reopening": sum(1 for row in done if row.get("reopenings")),
        "approvals_approved": sum(row.get("approvals_approved") or 0 for row in done),
        "approvals_rejected": sum(row.get("approvals_rejected") or 0 for row in done),
        "policy_denials": sum(row.get("policy_denials") or 0 for row in done),
        "safety_reviews_blocked": sum(row.get("safety_reviews_blocked") or 0 for row in done),
        "plans_without_result": sum(
            max(0, len(row.get("chosen_tests") or []) - len(row.get("executed_tests") or [])) for row in done
        ),
        "mean_tool_calls_by_purpose": {
            category: mean([(row.get("tool_calls_by_purpose") or {}).get(category, 0) for row in done])
            for category in [*TOOL_CATEGORIES, "other"]
        },
        "median_wall_seconds_per_lab_tool_call": median(
            [
                round(row["wall_seconds"] / row["tool_calls"], 2)
                for row in done
                if row.get("tool_calls") and row.get("wall_seconds")
            ]
        ),
        "mean_output_tokens": mean([row.get("output_tokens") for row in done]),
        "mean_omnigent_reported_cost_usd": mean([row.get("omnigent_reported_cost_usd") for row in done]),
        "mean_databases_returned_by_scripted_pass": mean(
            [row.get("databases_returned_by_scripted_pass") for row in done]
        ),
        "mean_share_of_scripted_pass_databases_cited": mean(
            [row.get("share_of_scripted_pass_databases_cited") for row in done]
        ),
        "runs_citing_database": dict(
            sorted(Counter(name for row in done for name in row.get("databases_cited") or []).items())
        ),
        "first_chosen_test": dict(Counter((row.get("chosen_tests") or [None])[0] for row in done)),
        "favoured_after_classes": dict(Counter(row["favoured_after"] for row in done)),
        "agreement_before_test": {
            "n_with_reference": len(referenced),
            "n_agree": sum(1 for row in referenced if row.get("agrees_before")),
        },
        "agreement_residue_specific_reference": {
            "n_with_reference": len(residue_specific),
            "n_agree": sum(1 for row in residue_specific if row["agrees"]),
        },
    }


def aggregate(batch: str, conditions: dict[str, Any]) -> dict[str, Any]:
    labels = load_labels()
    variants = [label["variant_id"] for label in labels["labels"]]
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for label in labels["labels"]:
        for arm in ARMS:
            rows[(label["variant_id"], arm)] = cell(batch, label, arm)
    per_variant = [rows[(variant_id, arm)] for variant_id in variants for arm in ARMS]
    arms = [summarise(arm, [row for row in per_variant if row["arm"] == arm]) for arm in ARMS]
    by_arm = {arm["id"]: arm for arm in arms}
    lab_median = by_arm["specialist_lab"]["median_wall_seconds"]
    baseline_median = by_arm["single_agent_baseline"]["median_wall_seconds"]
    interpretation = read_json(INTERPRETATION) if INTERPRETATION.exists() else {}
    note = (
        "ratio = baseline ÷ lab on the median of all succeeded runs of each arm; above 1 the lab reaches a "
        "complete cited record faster than the single agent, below 1 slower."
    )
    if interpretation.get("comparison_note"):
        note = f"{note} {interpretation['comparison_note']}"
    spec_hashes = {
        arm: sorted({row["spec_hash"] for row in per_variant if row["arm"] == arm and row.get("spec_hash")})
        for arm in ARMS
    }
    models = sorted({model for row in per_variant for model in row.get("models", [])})
    finished = sum(1 for row in per_variant if row["status"] == "succeeded")
    caveats = [
        f"Small sample: {len(variants)} variants, one run per variant and arm in the main comparison; run-to-run variation of a language-model agent is not estimated beyond the repeat study on one variant.",
        "Both arms use the same model, so the comparison says nothing about a different model in either role.",
        f"The reference covers {labels['n_with_reference']} of {labels['n_variants']} variants ({labels['n_residue_specific']} from a residue-specific UniProtKB annotation, {labels['n_region_level']} only from membership of an annotated region). The label is never shown to an agent, but the UniProtKB annotation behind it is returned by tools both arms hold, so agreement is consistency with curated annotation, not blind rediscovery.",
        "Pathogenicity predictors in the starting evidence (AlphaMissense, EVE, popEVE) share training signal with clinical labels; they say a variant is damaging, not by which mechanism.",
        "Wall time includes the start of a per-run Omnigent server and the export of session transcripts, in both arms.",
        "No human was timed. The benchmark does not measure a speed-up over manual work.",
        "The lab can run a second test after a reopening; the control prompt has no reopening step. Counts of decisions that changed are therefore not like for like.",
    ]
    for arm, hashes in spec_hashes.items():
        if len(hashes) > 1:
            caveats.append(
                f"The agent specification of {arm} changed during the batch: {len(hashes)} distinct spec_hash values."
            )
    caveats.extend(interpretation.get("caveats", []))
    return {
        "generated_at": now(),
        "question": QUESTION,
        "conditions": {
            **conditions,
            "batch": batch,
            "models": models,
            "spec_hashes": spec_hashes,
            "reference_labels": {
                "file": "lab/experiments/reference/labels.json",
                "derived_at": labels["derived_at"],
                "sha256": hashlib.sha256(LABELS.read_bytes()).hexdigest(),
                "rule_sha256": labels["rule_sha256"],
            },
            "variant_selection": labels["selection_rule"],
            "runs_succeeded": finished,
            "runs_planned": len(per_variant),
            "complete": finished == len(per_variant),
        },
        "n_variants": len(variants),
        "arms": arms,
        "comparison": {
            "metric": PRIMARY_METRIC,
            "baseline": baseline_median,
            "lab": lab_median,
            "ratio": round(baseline_median / lab_median, 2) if lab_median and baseline_median else None,
            "note": note,
            "paired": [
                paired(rows, variants, field)
                for field in (
                    "wall_seconds",
                    "tool_calls",
                    "distinct_sources",
                    "evidence_items",
                    "starting_evidence_items",
                    "starting_distinct_sources",
                    "hypotheses",
                    "tests_considered",
                    "output_tokens",
                )
            ],
        },
        "arm_concordance": concordance(rows, variants),
        "per_variant": per_variant,
        "controls": CONTROLS,
        "caveats": caveats,
        "next_experiment": interpretation.get("next_experiment")
        or "Stated in lab/experiments/RESULTS.md once the batch is analysed.",
        "reference": [
            {
                "variant_id": label["variant_id"],
                "reference_mechanism": label["reference_mechanism"],
                "reference_tier": label["reference_tier"],
                "derivation": label["derivation"],
                "structural_corroboration": label["structural_corroboration"],
                "premise_mismatch": label["premise_mismatch"],
            }
            for label in labels["labels"]
        ],
        "preflight": (
            {
                key: read_json(PREFLIGHT).get(key)
                for key in ("generated_at", "what", "median_first_pass_seconds", "median_second_pass_seconds")
            }
            if PREFLIGHT.exists()
            else None
        ),
    }


def repeat_study(batch: str, first: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Runs of the same cell across the main batch and its repeat batches (results/<batch>-repeat*.json)."""
    fields = (
        "run_id",
        "status",
        "wall_seconds",
        "tool_calls",
        "distinct_sources",
        "evidence_items",
        "favoured_before",
        "favoured_after",
        "decision_changed",
        "agrees",
        "chosen_tests",
        "reopenings",
    )
    cells: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for path in sorted(RESULTS.glob(f"{batch}-repeat*.json")):
        for row in read_json(path)["per_variant"]:
            if row["status"] == "not_run":
                continue
            cells.setdefault((row["variant_id"], row["arm"]), []).append(row)
    study = []
    for (variant_id, arm), repeats in cells.items():
        original = next(row for row in first if row["variant_id"] == variant_id and row["arm"] == arm)
        runs = [original, *repeats]
        succeeded = [row for row in runs if row["status"] == "succeeded"]
        walls = [row["wall_seconds"] for row in succeeded]
        study.append(
            {
                "variant_id": variant_id,
                "arm": arm,
                "runs": len(runs),
                "succeeded": len(succeeded),
                "wall_seconds_min": min(walls) if walls else None,
                "wall_seconds_max": max(walls) if walls else None,
                "favoured_before": [row.get("favoured_before") for row in succeeded],
                "favoured_after": [row.get("favoured_after") for row in succeeded],
                "decision_changed": sum(1 for row in succeeded if row.get("decision_changed")),
                "per_run": [{field: row.get(field) for field in fields} for row in runs],
            }
        )
    return study


def publish(batch: str, conditions: dict[str, Any]) -> dict[str, Any]:
    with write_lock:
        body = aggregate(batch, conditions)
        if not conditions.get("secondary"):
            body["repeat_study"] = repeat_study(batch, body["per_variant"])
            write_json(LATEST, body)
        write_json(RESULTS / f"{batch}.json", body)
        return body


def launch_safely(job: dict[str, Any], arguments: argparse.Namespace, conditions: dict[str, Any]) -> None:
    try:
        launch(job, arguments, conditions)
    except Exception as error:
        print(f"{now()} {job['variant_id']} {job['arm']}: {type(error).__name__}: {error}", flush=True)


def launch(job: dict[str, Any], arguments: argparse.Namespace, conditions: dict[str, Any]) -> None:
    variant_id, arm, batch = job["variant_id"], job["arm"], arguments.batch
    attempts = attempts_of(batch, variant_id, arm)
    never_started = 0
    while True:
        if any(attempt["status"] == "succeeded" for attempt in attempts):
            return
        failed = [attempt for attempt in attempts if attempt["status"] == "failed"]
        if len(failed) > arguments.retries:
            return
        run_id = run_id_of(batch, variant_id, arm, len(attempts) + 1)
        with launch_lock:
            concurrent = len(active_runs)
            active_runs.add(run_id)
            time.sleep(arguments.stagger)
        command = [
            sys.executable,
            str(LAB / "run_lab.py"),
            "--variant",
            variant_id,
            "--mode",
            arm,
            "--approve",
            "--operator",
            arguments.operator,
            "--run-id",
            run_id,
            "--max-tool-calls",
            str(arguments.max_tool_calls),
            "--max-compute-seconds",
            str(arguments.max_compute_seconds),
            "--timeout",
            str(arguments.timeout),
            "--api-url",
            arguments.api_url,
        ]
        launched_at = now()
        started = time.monotonic()
        LOGS.mkdir(parents=True, exist_ok=True)
        with (LOGS / f"{run_id}.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                command,
                cwd=str(LAB.parent),
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                exit_code = process.wait(timeout=arguments.timeout + 180)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    exit_code = process.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    exit_code = process.wait()
        with launch_lock:
            active_runs.discard(run_id)
        manifest = manifest_of(run_id) or {}
        if not manifest:
            never_started += 1
        entry = {
            "run_id": run_id,
            "variant_id": variant_id,
            "arm": arm,
            "attempt": len(attempts) + 1,
            "launched_at": launched_at,
            "finished_at": now(),
            "exit_code": exit_code,
            "status": manifest.get("status"),
            "error": manifest.get("error"),
            "launcher_seconds": round(time.monotonic() - started, 1),
            "wall_seconds": (manifest.get("metrics") or {}).get("wall_seconds"),
            "benchmark_runs_active_at_launch": concurrent,
        }
        with write_lock:
            with (RESULTS / f"attempts-{batch}.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(
            f"{entry['finished_at']} {run_id:<52} {str(entry['status']):<10} {entry['wall_seconds']}s "
            f"(active at launch: {concurrent})",
            flush=True,
        )
        publish(batch, conditions)
        attempts = attempts_of(batch, variant_id, arm)
        if never_started > arguments.retries:
            return
        if manifest and manifest.get("status") not in ("succeeded", "failed"):
            return


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--batch", default="bench01", help="Prefix of the run IDs of this batch")
    parser.add_argument("--parallel", type=int, default=3, help="Runs in flight at once, both arms mixed")
    parser.add_argument("--variants", nargs="*", default=None, help="Restrict to these variant IDs")
    parser.add_argument("--arms", nargs="*", default=list(ARMS), choices=list(ARMS))
    parser.add_argument("--max-tool-calls", type=int, default=160)
    parser.add_argument("--max-compute-seconds", type=int, default=300)
    parser.add_argument("--timeout", type=int, default=1500, help="Wall-clock limit of one run in seconds")
    parser.add_argument("--retries", type=int, default=1, help="Extra attempts after a failed run")
    parser.add_argument("--stagger", type=float, default=5.0, help="Seconds between two launches")
    parser.add_argument(
        "--operator",
        default=None,
        help="Who pre-approves consequential actions for the batch, as written to every record",
    )
    parser.add_argument("--api-url", default=os.environ.get("HELIX_API_URL", "http://localhost:8000"))
    parser.add_argument("--aggregate-only", action="store_true")
    parser.add_argument(
        "--secondary",
        action="store_true",
        help="A repeat batch (<main batch>-repeat<n>): writes results/<batch>.json and leaves latest.json alone",
    )
    arguments = parser.parse_args()
    arguments.operator = arguments.operator or (
        f"benchmark pre-approval rule (lab/experiments/protocol.md section 5), batch started by {getpass.getuser()}"
    )
    conditions_path = RESULTS / f"conditions-{arguments.batch}.json"
    if arguments.aggregate_only:
        if not conditions_path.exists():
            raise SystemExit(f"No batch {arguments.batch} has been started.")
        body = publish(arguments.batch, read_json(conditions_path))
        print(
            f"aggregated {arguments.batch}: {body['conditions']['runs_succeeded']} of "
            f"{body['conditions']['runs_planned']} runs succeeded"
        )
        return

    RESULTS.mkdir(parents=True, exist_ok=True)
    lock = (RESULTS / "benchmark.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise SystemExit("Another run_benchmark.py holds lab/experiments/results/benchmark.lock.") from error

    labels = load_labels()
    if conditions_path.exists():
        # A resumed batch keeps the conditions it started with
        conditions = read_json(conditions_path)
        arguments.operator = conditions["operator"]
        arguments.max_tool_calls = conditions["budget"]["max_tool_calls"]
        arguments.max_compute_seconds = conditions["budget"]["max_compute_seconds"]
        arguments.timeout = conditions["run_timeout_seconds"]
        arguments.retries = conditions["retries_after_failure"]
        arguments.secondary = bool(conditions.get("secondary"))
    else:
        conditions = {
            "started_at": now(),
            "arms": "specialist_lab and single_agent_baseline through lab/run_lab.py",
            "budget": {
                "max_tool_calls": arguments.max_tool_calls,
                "max_compute_seconds": arguments.max_compute_seconds,
            },
            "parallel_runs": arguments.parallel,
            "order": "Catalogue order; the lab starts first on odd-numbered variants, the control on even-numbered ones; one worker pool for both arms.",
            "approvals": "Pre-approved with --approve under protocol.md section 5; every decision is written to the record with the operator below.",
            "operator": arguments.operator,
            "run_timeout_seconds": arguments.timeout,
            "retries_after_failure": arguments.retries,
            "api_url": arguments.api_url,
            "repeats_per_cell": 1,
            "resumed_at": [],
            "secondary": arguments.secondary,
        }
    jobs = []
    for index, label in enumerate(labels["labels"]):
        if arguments.variants and label["variant_id"] not in arguments.variants:
            continue
        order = list(ARMS) if index % 2 == 0 else list(reversed(ARMS))
        for arm in order:
            if arm in arguments.arms:
                jobs.append({"variant_id": label["variant_id"], "arm": arm})
    open_cells = [
        job
        for job in jobs
        if not any(
            attempt["status"] == "succeeded"
            for attempt in attempts_of(arguments.batch, job["variant_id"], job["arm"])
        )
    ]
    if conditions_path.exists() and open_cells:
        conditions["resumed_at"] = [*conditions.get("resumed_at", []), now()]
    write_json(conditions_path, conditions)
    print(
        f"batch {arguments.batch}: {len(jobs)} cells, {len(open_cells)} without a succeeded run, "
        f"{arguments.parallel} in parallel, operator: {arguments.operator}",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=arguments.parallel) as pool:
        futures = [pool.submit(launch_safely, job, arguments, conditions) for job in jobs]
        for future in futures:
            future.result()
    body = publish(arguments.batch, conditions)
    for arm in body["arms"]:
        print(
            f"{arm['id']:<22} runs {arm['runs']}/{arm['runs_planned']}  median wall {arm['median_wall_seconds']}s  "
            f"sources {arm['mean_distinct_sources']}  evidence {arm['mean_evidence_items']}  "
            f"agreement {arm['agreement']['n_agree']}/{arm['agreement']['n_with_reference']}  "
            f"changed {arm['decision_changed']}"
        )
    print(f"wrote {RESULTS / (arguments.batch + '.json')}")


if __name__ == "__main__":
    main()
