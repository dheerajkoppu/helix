"""Launch one recorded discovery run of the Helix lab.

    lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His
    lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --mode single_agent_baseline --approve

Creates lab/runs/<run_id>/, writes run.json, runs the Omnigent agent bundle headlessly with the
objective and the budget, streams the research record as it grows, answers approval requests when
--approve is given, and finalises run.json with measured wall time, counts and the outcome.
"""

import argparse
import getpass
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path
from typing import Any

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB / "tools"))

import httpx  # noqa: E402

from helix_lab_tools import budget, candidates, record, registry  # noqa: E402

RUNS = LAB / "runs"
BUNDLES = {
    "specialist_lab": LAB / "agents" / "helix_lab",
    "single_agent_baseline": LAB / "agents" / "helix_baseline",
}
HARNESS = "claude-sdk"
QUESTION = (
    "For a pathogenic missense variant in an immune-deficiency gene, which molecular mechanism best explains "
    "its effect on the protein, does a targeted computational test change the conclusion that the starting "
    "evidence suggested, and what could a drug act on if that mechanism is right?"
)
# Markers of the terminal session that started the launcher; the agents must not inherit them
SESSION_MARKERS = (
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_NO_FLICKER",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def resolve_subject(api_url: str, variant_id: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for _ in range(2):
        try:
            response = httpx.get(f"{api_url}/api/v1/variants/{variant_id}", timeout=90)
            if response.status_code == 404:
                raise SystemExit(f"Variant {variant_id} is not known to the Helix API at {api_url}.")
            response.raise_for_status()
            payload = response.json()
            if payload.get("change_kind") != "substitution" or not payload.get("position"):
                raise SystemExit(
                    f"{variant_id} is not a single amino-acid substitution; the lab studies missense variants."
                )
            return {
                "gene": (payload.get("gene") or {}).get("id"),
                "variant_id": payload["id"],
                "accession": (payload.get("protein") or {}).get("id"),
                "position": payload["position"],
                "reference_residue": payload.get("reference_residue"),
                "alternate_residue": payload.get("alternate_residue"),
                "protein_change": payload.get("protein_change"),
            }
        except httpx.HTTPError as error:
            last_error = error
            time.sleep(3)
    raise SystemExit(f"The Helix API at {api_url} did not answer: {last_error}")


def spec_hash(bundle: Path) -> str:
    """SHA-256 over the agent bundle, the policies and the tool package that define a run."""
    digest = hashlib.sha256()
    roots = [bundle, LAB / "policies" / "helix_lab_policies", LAB / "tools" / "helix_lab_tools"]
    for root in roots:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            digest.update(str(path.relative_to(LAB)).encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def models_of(mode: str) -> dict[str, str]:
    if mode == "single_agent_baseline":
        return {"generalist": registry.BASELINE["model"]}
    models = {"orchestrator": registry.SUPERVISOR["model"]}
    models.update({role: definition["model"] for role, definition in registry.SPECIALISTS.items()})
    return models


def build_prompt(objective: str, subject: dict[str, Any], limits: dict[str, Any]) -> str:
    return (
        f"Objective: {objective}\n"
        f"Subject line: variant_id={subject['variant_id']} gene={subject['gene']} accession={subject['accession']} "
        f"position={subject['position']} reference={subject['reference_residue']} alternate={subject['alternate_residue']}\n"
        f"Budget for the whole run: {limits['max_tool_calls']} lab tool calls and {limits['max_compute_seconds']} compute seconds.\n"
        "Run the discovery loop to the final report. The loop ends on candidates, not on the decision."
    )


def child_environment(run_directory: Path, api_url: str, approval_timeout: int) -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if key not in SESSION_MARKERS}
    paths = [str(LAB / "tools"), str(LAB / "policies")]
    if environment.get("PYTHONPATH"):
        paths.append(environment["PYTHONPATH"])
    environment.update(
        {
            "HELIX_LAB_RUN_DIR": str(run_directory),
            "HELIX_API_URL": api_url,
            "HELIX_LAB_APPROVAL_TIMEOUT": str(approval_timeout),
            "PYTHONPATH": os.pathsep.join(paths),
            # Connectors of the signed-in account are not tools of the lab
            "ENABLE_CLAUDEAI_MCP_SERVERS": "false",
        }
    )
    return environment


def describe(event: dict[str, Any]) -> str:
    payload = event["payload"]
    kind = event["type"]
    if kind == "handoff":
        text = f"{payload['from']} -> {payload['to']}: {payload['summary']}"
    elif kind in ("evidence", "gap", "hypothesis"):
        text = f"{payload['id']} {payload.get('mechanism_class', payload.get('evidence_class', ''))} {payload['statement']}"
    elif kind == "test_candidate":
        text = f"{payload['id']} {payload['test_kind']} learning={payload['expected_learning']} feasibility={payload['feasibility']} cost={payload['cost']}"
    elif kind == "plan":
        text = f"chose {payload['chosen_test_id']}: {payload['rationale']}"
    elif kind == "approval_request":
        text = f"{payload['id']} {payload['action']}"
    elif kind == "approval_decision":
        text = f"{payload['id']} {payload['decision']} by {payload['by']}"
    elif kind == "experiment_started":
        text = f"{payload['test_id']} {payload['tool']}"
    elif kind == "experiment_result":
        text = f"{payload['test_id']} {payload['values'].get('headline', payload['summary'])}"
    elif kind == "interpretation":
        text = "; ".join(f"{row['id']} {row['verdict']}" for row in payload["per_hypothesis"])
    elif kind == "decision":
        text = f"{payload['favoured_before']} -> {payload['favoured_after']} (changed: {payload['changed']})"
    elif kind == "next_experiment":
        text = f"{payload['kind']}: {payload['description']}"
    elif kind == "target_rationale":
        text = (
            f"{payload['id']} direction {payload.get('direction')} -> "
            f"{', '.join(payload.get('required_actions') or [])}: {payload.get('what_to_act_on', '')}"
        )
    elif kind == "candidate":
        molecule = (payload.get("molecule") or {}).get("name") or "no molecule"
        target = (payload.get("target") or {}).get("gene_symbol") or ""
        bridge = (payload.get("bridge") or {}).get("kind") or ""
        text = f"{payload['id']} {molecule} on {target} via {bridge} ({payload.get('label')})"
    elif kind == "note":
        text = f"{payload.get('kind')}: {str(payload.get('text') or payload.get('reason') or payload.get('findings') or '')}"
    else:
        text = str(payload.get("objective", ""))
    text = " ".join(text.split())
    return f"[{event['seq']:>3}] {event['agent']:<15} {kind:<19} {text[:150]}"


def pending_approvals(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    decided = {event["payload"]["id"] for event in record.of_type(events, "approval_decision")}
    return [
        event for event in record.of_type(events, "approval_request") if event["payload"]["id"] not in decided
    ]


def measure(run_directory: Path, events: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    spent = budget.status(run_directory)
    cited = [*record.of_type(events, "evidence"), *record.of_type(events, "experiment_result")]
    decisions = record.of_type(events, "decision")
    first = record.starting_favourite(events)
    following = record.of_type(events, "next_experiment")
    metrics = {
        "tool_calls": spent["tool_calls_used"],
        "distinct_sources": len({row["database"] for event in cited for row in event["sources"]}),
        "evidence_items": len(record.of_type(events, "evidence")),
        "hypotheses": len(record.of_type(events, "hypothesis")),
        "tests_considered": len(record.of_type(events, "test_candidate")),
        "approvals": len(record.of_type(events, "approval_decision")),
        "tests_executed": len(record.of_type(events, "experiment_result")),
        "compute_seconds": spent["compute_seconds_used"],
        "tool_calls_by_agent": spent.get("tool_calls_by_agent", {}),
        "policy_denials": len(record.notes_of_kind(events, "policy_denial")),
        "reopenings": len(record.notes_of_kind(events, "reopened_assumption")),
        **candidates.candidate_metrics(events, run_directory),
    }
    last = decisions[-1]["payload"] if decisions else None
    outcome = {
        "favoured_before": first["payload"]["mechanism_class"] if first else None,
        "favoured_after": last["favoured_after"] if last else None,
        "decision_changed": bool(
            last and first and last["favoured_after_hypothesis"] != first["payload"]["id"]
        ),
        "next_experiment": following[-1]["payload"]["description"] if following else None,
        "favoured_before_hypothesis": first["payload"]["id"] if first else None,
        "favoured_after_hypothesis": last["favoured_after_hypothesis"] if last else None,
        "decisions": len(decisions),
        "candidates": [event["payload"]["id"] for event in record.of_type(events, "candidate")],
        "candidate_molecules": [
            (event["payload"].get("molecule") or {}).get("name")
            for event in record.of_type(events, "candidate")
        ],
    }
    return metrics, outcome


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch one recorded discovery run of the Helix lab.")
    parser.add_argument("--variant", required=True, help="Helix variant ID, for example BTK-p.Arg28His")
    parser.add_argument("--mode", choices=sorted(BUNDLES), default="specialist_lab")
    parser.add_argument(
        "--objective",
        default=None,
        help="Objective set by the scientist; defaults to the lab question for the variant",
    )
    parser.add_argument(
        "--approve",
        action="store_true",
        help="Approve consequential actions for this unattended run; recorded with the operator's name",
    )
    parser.add_argument(
        "--operator",
        default=None,
        help="Who passes --approve, as written to the record; defaults to the login name",
    )
    parser.add_argument("--max-tool-calls", type=int, default=budget.DEFAULT_MAX_TOOL_CALLS)
    parser.add_argument("--max-compute-seconds", type=int, default=budget.DEFAULT_MAX_COMPUTE_SECONDS)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--api-url", default=os.environ.get("HELIX_API_URL", "http://localhost:8000"))
    parser.add_argument("--timeout", type=int, default=2700, help="Wall-clock limit of the run in seconds")
    parser.add_argument(
        "--approval-timeout", type=int, default=900, help="Seconds an approval request waits for a human"
    )
    parser.add_argument("--quiet", action="store_true")
    arguments = parser.parse_args()

    api_url = arguments.api_url.rstrip("/")
    try:
        subject = resolve_subject(api_url, arguments.variant)
    except SystemExit as failure:
        # A run the API already announced must not stay "running" when it cannot start
        announced = RUNS / arguments.run_id / "run.json" if arguments.run_id else None
        if announced is not None and announced.exists():
            manifest = json.loads(announced.read_text(encoding="utf-8"))
            manifest.update({"status": "failed", "finished_at": now(), "error": str(failure)})
            write_json(announced, manifest)
        raise
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    suffix = "lab" if arguments.mode == "specialist_lab" else "baseline"
    run_id = arguments.run_id or f"{stamp}-{subject['variant_id']}-{suffix}"
    run_directory = RUNS / run_id
    run_directory.mkdir(parents=True, exist_ok=True)
    bundle = BUNDLES[arguments.mode]
    objective = arguments.objective or (
        f"Find the molecular mechanism that best explains the effect of {subject['variant_id']} "
        f"({subject['gene']}, UniProt {subject['accession']}), test it with one targeted computational test, "
        "and end on the candidate targets and molecules that mechanism and its direction point to."
    )
    limits = {
        "max_tool_calls": arguments.max_tool_calls,
        "max_compute_seconds": arguments.max_compute_seconds,
    }
    manifest: dict[str, Any] = {
        "run_id": run_id,
        "objective": objective,
        "subject": subject,
        "mode": arguments.mode,
        "status": "running",
        "budget": limits,
        "started_at": now(),
        "finished_at": None,
        "omnigent": {
            "version": metadata.version("omnigent"),
            "harness": HARNESS,
            "model": models_of(arguments.mode).get("orchestrator") or registry.BASELINE["model"],
            "session_id": None,
            "models": models_of(arguments.mode),
            "bundle": str(bundle.relative_to(LAB.parent)),
        },
        "spec_hash": spec_hash(bundle),
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
        "question": QUESTION,
        "approval_mode": "pre-approved by --approve"
        if arguments.approve
        else "waits for a human decision through the API",
        "error": None,
    }
    manifest_path = run_directory / "run.json"
    write_json(manifest_path, manifest)
    if not record.load_events(run_directory):
        record.append_event(
            "human",
            "objective",
            {
                "objective": objective,
                "subject": subject,
                "mode": arguments.mode,
                "budget": limits,
                "question": QUESTION,
            },
            directory=run_directory,
        )
    prompt_path = run_directory / "prompt.txt"
    prompt_path.write_text(build_prompt(objective, subject, limits), encoding="utf-8")

    log = (run_directory / "omnigent.log").open("w", encoding="utf-8")
    driver = subprocess.Popen(
        [
            sys.executable,
            str(LAB / "omnigent_driver.py"),
            "--bundle",
            str(bundle),
            "--prompt-file",
            str(prompt_path),
            "--out",
            str(run_directory),
            "--wait-for-report",
        ],
        cwd=str(run_directory),
        env=child_environment(run_directory, api_url, arguments.approval_timeout),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    started = time.monotonic()
    cancelled = False

    def stop(_signal: int, _frame: Any) -> None:
        nonlocal cancelled
        cancelled = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if not arguments.quiet:
        print(
            f"run {run_id} ({arguments.mode}) started; record: {run_directory / record.RECORD_FILE}",
            flush=True,
        )

    printed = 0
    status = "running"
    timed_out = False
    operator = arguments.operator or getpass.getuser()
    while True:
        finished = driver.poll() is not None
        events = record.load_events(run_directory)
        for event in events[printed:]:
            if not arguments.quiet:
                print(describe(event), flush=True)
        printed = len(events)
        waiting = pending_approvals(events)
        if waiting and arguments.approve:
            for request in waiting:
                record.append_event(
                    "human",
                    "approval_decision",
                    {
                        "id": request["payload"]["id"],
                        "decision": "approved",
                        "by": f"{operator} (run_lab.py --approve)",
                        "note": "Approved in advance for this unattended, documented run.",
                    },
                    refs=[request["payload"].get("test_id", "")],
                    directory=run_directory,
                )
            waiting = []
        wanted = "awaiting_approval" if waiting else "running"
        if wanted != status and not finished:
            status = wanted
            manifest["status"] = status
            write_json(manifest_path, manifest)
        if finished:
            break
        if cancelled or time.monotonic() - started > arguments.timeout:
            timed_out = not cancelled
            try:
                os.killpg(driver.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                driver.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(driver.pid, signal.SIGKILL)
            continue
        time.sleep(1.5)
    log.close()

    wall_seconds = round(time.monotonic() - started, 1)
    events = record.load_events(run_directory)
    metrics, outcome = measure(run_directory, events)
    session_path = run_directory / "omnigent_session.json"
    session = json.loads(session_path.read_text(encoding="utf-8")) if session_path.exists() else {}
    manifest["omnigent"]["session_id"] = session.get("session_id")
    manifest["omnigent"]["sub_agent_sessions"] = len(session.get("sub_agent_sessions", []))
    manifest["omnigent"]["loop_ended"] = session.get("ended")
    manifest["metrics"] = {"wall_seconds": wall_seconds, **metrics}
    manifest["outcome"] = outcome
    manifest["finished_at"] = now()
    if cancelled:
        manifest["status"] = "cancelled"
    elif outcome["decisions"] and driver.returncode == 0:
        manifest["status"] = "succeeded"
    else:
        manifest["status"] = "failed"
        if timed_out:
            manifest["error"] = f"The run exceeded the wall-clock limit of {arguments.timeout} seconds."
        elif not outcome["decisions"]:
            manifest["error"] = (
                "The run ended without a recorded decision. See omnigent.log and final_reply.txt."
            )
        else:
            manifest["error"] = f"The Omnigent driver exited with code {driver.returncode}. See omnigent.log."
    write_json(manifest_path, manifest)
    if not arguments.quiet:
        print(
            f"run {run_id} {manifest['status']} in {wall_seconds}s: {metrics['tool_calls']} tool calls, "
            f"{metrics['evidence_items']} evidence items from {metrics['distinct_sources']} databases, "
            f"{metrics['tests_considered']} tests considered, favoured {outcome['favoured_before']} -> "
            f"{outcome['favoured_after']} (changed: {outcome['decision_changed']}), "
            f"{metrics['candidates']} candidates, {metrics['ruled_out_by_direction']} ruled out on direction",
            flush=True,
        )
    raise SystemExit(0 if manifest["status"] == "succeeded" else 1)


if __name__ == "__main__":
    main()
