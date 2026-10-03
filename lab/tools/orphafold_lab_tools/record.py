"""The shared research record: an append-only JSON Lines file every agent writes through these tools."""

import fcntl
import json
import os
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from orphafold_lab_tools import budget, claims, sources
from orphafold_lab_tools.catalogue import EVIDENCE_CLASSES, MECHANISM_CLASSES, TESTS
from orphafold_lab_tools.context import LabToolError, current_role, respond, run_dir, subject

RECORD_FILE = "record.jsonl"
RESULTS_DIRECTORY = "results"
HYPOTHESIS_LABEL = "agent-generated hypothesis"

AGENTS = (
    "orchestrator",
    "literature",
    "knowledge_graph",
    "insight",
    "planner",
    "safety",
    "runner",
    "analysis",
    "human",
)
VERDICTS = ("supported", "weakened", "refuted", "unchanged")
EXPERIMENT_KINDS = ("computational", "laboratory")
ID_PREFIXES = {"evidence": "E", "gap": "G", "hypothesis": "H", "test_candidate": "T", "approval_request": "A"}

Payload = dict[str, Any]
Event = dict[str, Any]


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@contextmanager
def _locked(directory: Path) -> Iterator[None]:
    with (directory / "record.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def load_events(directory: Path | None = None) -> list[Event]:
    path = (directory or run_dir()) / RECORD_FILE
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            events.append(json.loads(line))
    return events


def append_event(
    agent: str,
    event_type: str,
    build: Payload | Callable[[list[Event]], Payload],
    *,
    refs: list[str] | None = None,
    event_sources: list[dict[str, str]] | None = None,
    directory: Path | None = None,
) -> Event:
    """Append one event; a callable payload is built under the lock so IDs and checks see a consistent record."""
    directory = directory or run_dir()
    with _locked(directory):
        events = load_events(directory)
        payload = build(events) if callable(build) else build
        event = {
            "seq": (events[-1]["seq"] + 1) if events else 1,
            "at": now(),
            "run_id": directory.name,
            "agent": agent,
            "type": event_type,
            "payload": payload,
            "refs": [str(reference) for reference in (refs or [])],
            "sources": event_sources or [],
        }
        with (directory / RECORD_FILE).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        return event


def of_type(events: list[Event], event_type: str) -> list[Event]:
    return [event for event in events if event["type"] == event_type]


def notes_of_kind(events: list[Event], kind: str) -> list[Event]:
    return [event for event in of_type(events, "note") if event["payload"].get("kind") == kind]


def next_id(events: list[Event], event_type: str) -> str:
    return f"{ID_PREFIXES[event_type]}{len(of_type(events, event_type)) + 1}"


def known_ids(events: list[Event]) -> set[str]:
    return {
        event["payload"]["id"]
        for event in events
        if event["type"] in ID_PREFIXES and isinstance(event["payload"].get("id"), str)
    }


def by_id(events: list[Event], identifier: str) -> Event | None:
    for event in events:
        if event["type"] in ID_PREFIXES and event["payload"].get("id") == identifier:
            return event
    return None


def executed_test_ids(events: list[Event]) -> set[str]:
    return {event["payload"]["test_id"] for event in of_type(events, "experiment_result")}


def open_candidates(events: list[Event]) -> list[Event]:
    done = executed_test_ids(events)
    return [event for event in of_type(events, "test_candidate") if event["payload"]["id"] not in done]


def latest_plan(events: list[Event]) -> Event | None:
    plans = of_type(events, "plan")
    return plans[-1] if plans else None


def latest_verdicts(events: list[Event]) -> dict[str, str]:
    verdicts: dict[str, str] = {}
    for event in of_type(events, "interpretation"):
        for row in event["payload"].get("per_hypothesis", []):
            if row.get("verdict") != "unchanged" or row["id"] not in verdicts:
                verdicts[row["id"]] = row["verdict"]
    return verdicts


def starting_favourite(events: list[Event]) -> Event | None:
    hypotheses = of_type(events, "hypothesis")
    if not hypotheses:
        return None
    return min(hypotheses, key=lambda event: event["payload"].get("starting_rank") or 99)


def current_favourite_id(events: list[Event]) -> str | None:
    decisions = of_type(events, "decision")
    if decisions:
        return decisions[-1]["payload"].get("favoured_after_hypothesis")
    first = starting_favourite(events)
    return first["payload"]["id"] if first else None


def _require_text(value: str | None, name: str, *, minimum: int = 8, maximum: int = 1500) -> str:
    text = " ".join((value or "").split())
    if len(text) < minimum:
        raise LabToolError(f"{name} is required (at least {minimum} characters).")
    if len(text) > maximum:
        raise LabToolError(f"{name} is too long ({len(text)} characters, limit {maximum}). Shorten it.")
    return text


def _require_clean(text: str, name: str) -> None:
    phrases = claims.clinical_violations(text)
    if phrases:
        quoted = ", ".join(f'"{phrase}"' for phrase in phrases[:4])
        raise LabToolError(
            f"{name} contains clinical or treatment wording ({quoted}). This lab generates research "
            "hypotheses only. Rewrite the text as a molecular statement."
        )


def _require_known(identifiers: list[str], events: list[Event], prefix: str, name: str) -> list[str]:
    cleaned = [str(identifier).strip() for identifier in identifiers or [] if str(identifier).strip()]
    if not cleaned:
        raise LabToolError(f"{name} must list at least one ID starting with {prefix}.")
    existing = known_ids(events)
    unknown = [
        identifier
        for identifier in cleaned
        if identifier not in existing or not identifier.startswith(prefix)
    ]
    if unknown:
        raise LabToolError(
            f"{name} names IDs that are not in the record: {', '.join(unknown)}. Call read_record."
        )
    return cleaned


def _clip(text: str | None, limit: int = 360) -> str:
    text = text or ""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _digest(events: list[Event], sections: list[str] | None) -> Payload:
    wanted = set(sections or [])
    objective = next((event["payload"] for event in of_type(events, "objective")), {})
    done = executed_test_ids(events)
    verdicts = latest_verdicts(events)
    digest: Payload = {
        "objective": objective.get("objective"),
        "subject": objective.get("subject"),
        "events": len(events),
        "current_favourite": current_favourite_id(events),
    }
    builders: dict[str, Callable[[], list[Payload]]] = {
        "evidence": lambda: [
            {
                "id": event["payload"]["id"],
                "by": event["agent"],
                "class": event["payload"]["evidence_class"],
                "strength": event["payload"].get("strength"),
                "statement": _clip(event["payload"]["statement"]),
                "source": "; ".join(f"{row['database']} {row['record_id']}" for row in event["sources"]),
                "refs": event["refs"],
            }
            for event in of_type(events, "evidence")
        ],
        "gaps": lambda: [
            {
                "id": event["payload"]["id"],
                "by": event["agent"],
                "statement": _clip(event["payload"]["statement"]),
            }
            for event in of_type(events, "gap")
        ],
        "hypotheses": lambda: [
            {
                "id": event["payload"]["id"],
                "mechanism_class": event["payload"]["mechanism_class"],
                "starting_rank": event["payload"].get("starting_rank"),
                "statement": _clip(event["payload"]["statement"]),
                "supports": event["payload"]["supports"],
                "would_refute": _clip(event["payload"]["would_refute"]),
                "latest_verdict": verdicts.get(event["payload"]["id"], "untested"),
                "label": event["payload"]["label"],
            }
            for event in of_type(events, "hypothesis")
        ],
        "tests": lambda: [
            {
                "id": event["payload"]["id"],
                "test_kind": event["payload"]["test_kind"],
                "tool": event["payload"]["tool"],
                "tests_hypotheses": event["payload"]["tests_hypotheses"],
                "expected_learning": event["payload"]["expected_learning"],
                "feasibility": event["payload"]["feasibility"],
                "cost": event["payload"]["cost"],
                "requires_approval": event["payload"]["requires_approval"],
                "executed": event["payload"]["id"] in done,
                "description": _clip(event["payload"]["description"], 240),
            }
            for event in of_type(events, "test_candidate")
        ],
        "plans": lambda: [
            {
                "seq": event["seq"],
                "chosen_test_id": event["payload"]["chosen_test_id"],
                "rationale": _clip(event["payload"]["rationale"]),
                "rejected": event["payload"]["rejected"],
                "budget_remaining": event["payload"]["budget_remaining"],
            }
            for event in of_type(events, "plan")
        ],
        "safety": lambda: (
            [
                {
                    "seq": event["seq"],
                    **{key: value for key, value in event["payload"].items() if key != "kind"},
                }
                for event in notes_of_kind(events, "safety_review")
            ]
            + [
                {"seq": event["seq"], "type": event["type"], **event["payload"]}
                for event in events
                if event["type"] in ("approval_request", "approval_decision")
            ]
        ),
        "results": lambda: [
            {
                "test_id": event["payload"]["test_id"],
                "test_kind": event["payload"].get("test_kind"),
                "summary": _clip(event["payload"]["summary"], 600),
                "headline": event["payload"]["values"].get("headline"),
                "verdict": event["payload"]["values"].get("verdict"),
                "job_id": event["payload"].get("job_id"),
            }
            for event in of_type(events, "experiment_result")
        ],
        "interpretations": lambda: [
            {"seq": event["seq"], **event["payload"]} for event in of_type(events, "interpretation")
        ],
        "decisions": lambda: [
            {"seq": event["seq"], **event["payload"]} for event in of_type(events, "decision")
        ],
        "next_experiments": lambda: [
            {"seq": event["seq"], **event["payload"]} for event in of_type(events, "next_experiment")
        ],
        "notes": lambda: [
            {
                "seq": event["seq"],
                "by": event["agent"],
                "kind": event["payload"].get("kind"),
                "text": _clip(str(event["payload"].get("text") or event["payload"].get("reason") or ""), 240),
            }
            for event in of_type(events, "note")
            if event["payload"].get("kind") not in ("safety_review", "final_report")
        ],
    }
    for name, builder in builders.items():
        if not wanted or name in wanted:
            digest[name] = builder()
    return digest


def read_record(sections: list[str] | None = None) -> str:
    """Read the shared research record of this run as a compact digest.

    Args:
        sections: Parts to return. Any of evidence, gaps, hypotheses, tests, plans, safety, results,
            interpretations, decisions, next_experiments, notes. Omit to get all of them.
    """
    return respond(lambda: _digest(load_events(), sections))


def _record_evidence(
    statement: str,
    evidence_class: str,
    strength: str,
    database: str,
    record_id: str,
    url: str,
    refs: list[str] | None,
) -> Payload:
    text = _require_text(statement, "statement", maximum=900)
    _require_clean(text, "statement")
    if evidence_class not in EVIDENCE_CLASSES:
        raise LabToolError(f"evidence_class must be one of: {', '.join(EVIDENCE_CLASSES)}.")
    if not (record_id or "").strip() or not (database or "").strip():
        raise LabToolError(
            "Evidence needs the database and the record ID it came from. Nothing was recorded."
        )
    known = sources.lookup(record_id, database)
    if known is None:
        raise LabToolError(
            f"No tool returned a source with record ID '{record_id}' in this run, so it cannot be cited. "
            "Record evidence only from a fact or source a retrieval tool returned, copying its record_id exactly."
        )
    cited = {
        "database": known["database"],
        "record_id": known["record_id"],
        "url": known.get("url") or url or "",
    }
    if not cited["url"].startswith("http"):
        raise LabToolError("The source has no URL. Evidence must carry the URL of its database record.")
    agent = current_role()

    def build(events: list[Event]) -> Payload:
        for event in of_type(events, "evidence"):
            same_source = any(row["record_id"] == cited["record_id"] for row in event["sources"])
            if same_source and event["payload"]["statement"].lower() == text.lower():
                raise LabToolError(f"Already recorded as {event['payload']['id']}.")
        return {
            "id": next_id(events, "evidence"),
            "statement": text,
            "evidence_class": evidence_class,
            "strength": " ".join((strength or "").split()) or "not graded by the source",
        }

    event = append_event(agent, "evidence", build, refs=refs, event_sources=[cited])
    return {
        "recorded": event["payload"]["id"],
        "seq": event["seq"],
        "source": f"{cited['database']} {cited['record_id']}",
    }


def record_evidence(
    statement: str,
    evidence_class: str,
    strength: str,
    database: str,
    record_id: str,
    url: str,
    refs: list[str] | None = None,
) -> str:
    """Record one piece of evidence with the database record it came from. Refused without a retrieved source.

    Args:
        statement: One factual sentence, as the source states it.
        evidence_class: experimental, clinical_database, literature, curated_database or computational_prediction.
        strength: The source's own strength or review level, as the tool returned it.
        database: Database name, copied from the tool output.
        record_id: Record ID in that database, copied exactly from the tool output.
        url: URL of the record, copied from the tool output.
        refs: IDs of related record items, for example the hypothesis or test this evidence bears on.
    """
    return respond(_record_evidence, statement, evidence_class, strength, database, record_id, url, refs)


def _record_gap(statement: str, why_it_matters: str, refs: list[str] | None) -> Payload:
    text = _require_text(statement, "statement", maximum=800)
    reason = _require_text(why_it_matters, "why_it_matters", maximum=800)
    _require_clean(f"{text} {reason}", "The gap")
    event = append_event(
        current_role(),
        "gap",
        lambda events: {"id": next_id(events, "gap"), "statement": text, "why_it_matters": reason},
        refs=refs,
    )
    return {"recorded": event["payload"]["id"], "seq": event["seq"]}


def record_gap(statement: str, why_it_matters: str, refs: list[str] | None = None) -> str:
    """Record something the evidence does not answer.

    Args:
        statement: What is unknown or was not found, in one sentence.
        why_it_matters: Why this gap matters for choosing between mechanisms.
        refs: IDs of related record items.
    """
    return respond(_record_gap, statement, why_it_matters, refs)


def _record_hypothesis(
    statement: str,
    mechanism_class: str,
    supports: list[str],
    would_refute: str,
    starting_rank: int,
    rank_rationale: str,
) -> Payload:
    text = _require_text(statement, "statement", maximum=900)
    refutation = _require_text(would_refute, "would_refute", maximum=900)
    rationale = _require_text(rank_rationale, "rank_rationale", maximum=900)
    _require_clean(f"{text} {refutation} {rationale}", "The hypothesis")
    if mechanism_class not in MECHANISM_CLASSES:
        raise LabToolError(f"mechanism_class must be one of: {', '.join(MECHANISM_CLASSES)}.")
    if not isinstance(starting_rank, int) or starting_rank < 1:
        raise LabToolError(
            "starting_rank must be a whole number, 1 for the hypothesis the starting evidence favours most."
        )

    def build(events: list[Event]) -> Payload:
        supporting = _require_known(supports, events, "E", "supports")
        for event in of_type(events, "hypothesis"):
            if event["payload"]["mechanism_class"] == mechanism_class:
                raise LabToolError(
                    f"{event['payload']['id']} already covers mechanism class {mechanism_class}. "
                    "Competing hypotheses must name different mechanism classes."
                )
            if event["payload"].get("starting_rank") == starting_rank:
                raise LabToolError(
                    f"starting_rank {starting_rank} is already used by {event['payload']['id']}."
                )
        return {
            "id": next_id(events, "hypothesis"),
            "statement": text,
            "mechanism_class": mechanism_class,
            "supports": supporting,
            "would_refute": refutation,
            "label": HYPOTHESIS_LABEL,
            "starting_rank": starting_rank,
            "rank_rationale": rationale,
        }

    event = append_event(current_role(), "hypothesis", build, refs=list(supports or []))
    return {"recorded": event["payload"]["id"], "seq": event["seq"], "label": HYPOTHESIS_LABEL}


def record_hypothesis(
    statement: str,
    mechanism_class: str,
    supports: list[str],
    would_refute: str,
    starting_rank: int,
    rank_rationale: str,
) -> str:
    """Record one testable mechanism hypothesis. It is stored with the label "agent-generated hypothesis".

    Args:
        statement: The hypothesis in one or two sentences, phrased as a molecular mechanism.
        mechanism_class: One of stability_folding (the fold is destabilised), ligand_binding (contact with a
            small molecule, lipid head group, nucleotide, cofactor or metal is lost), catalytic_site,
            protein_interaction (contact with another protein chain is lost, a homodimer included),
            nucleic_acid_binding, domain_interface (contact between domains of the same chain is lost),
            other. Each hypothesis needs a different class.
        supports: Evidence IDs only (E...) from the record that motivate the hypothesis. Gap IDs do not belong here.
        would_refute: The observable result that would refute it.
        starting_rank: 1 for the hypothesis the starting evidence favours most, 2 for the next, and so on.
        rank_rationale: Why the starting evidence places it at that rank.
    """
    return respond(
        _record_hypothesis, statement, mechanism_class, supports, would_refute, starting_rank, rank_rationale
    )


def _score(value: float, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise LabToolError(f"{name} must be a number between 0 and 1.") from error
    if not 0.0 <= number <= 1.0:
        raise LabToolError(f"{name} must be between 0 and 1.")
    return round(number, 2)


def _record_test_candidate(
    test_kind: str,
    description: str,
    tests_hypotheses: list[str],
    expected_learning: float,
    expected_learning_reasoning: str,
    feasibility: float,
    feasibility_reasoning: str,
) -> Payload:
    if test_kind not in TESTS:
        raise LabToolError(f"test_kind must be one of: {', '.join(TESTS)}. Call list_available_tests.")
    definition = TESTS[test_kind]
    text = _require_text(description, "description", maximum=900)
    learning_reason = _require_text(expected_learning_reasoning, "expected_learning_reasoning", maximum=1000)
    feasibility_reason = _require_text(feasibility_reasoning, "feasibility_reasoning", maximum=1000)
    _require_clean(f"{text} {learning_reason} {feasibility_reason}", "The test candidate")
    learning = _score(expected_learning, "expected_learning")
    feasible = _score(feasibility, "feasibility")

    def build(events: list[Event]) -> Payload:
        hypotheses = _require_known(tests_hypotheses, events, "H", "tests_hypotheses")
        for event in open_candidates(events):
            if event["payload"]["test_kind"] == test_kind:
                raise LabToolError(f"{event['payload']['id']} already proposes test kind {test_kind}.")
        return {
            "id": next_id(events, "test_candidate"),
            "test_kind": test_kind,
            "tool": definition["tool"],
            "description": text,
            "tests_hypotheses": hypotheses,
            "expected_learning": learning,
            "expected_learning_reasoning": learning_reason,
            "feasibility": feasible,
            "feasibility_reasoning": feasibility_reason,
            "cost": dict(definition["cost"]),
            "requires_approval": definition["requires_approval"],
            "controls": definition["controls"],
            "parameters": subject(),
            "round": len(of_type(events, "plan")) + 1,
        }

    event = append_event(current_role(), "test_candidate", build, refs=list(tests_hypotheses or []))
    payload = event["payload"]
    return {
        "recorded": payload["id"],
        "seq": event["seq"],
        "cost": payload["cost"],
        "requires_approval": payload["requires_approval"],
    }


def record_test_candidate(
    test_kind: str,
    description: str,
    tests_hypotheses: list[str],
    expected_learning: float,
    expected_learning_reasoning: str,
    feasibility: float,
    feasibility_reasoning: str,
) -> str:
    """Record one candidate test. Cost and the approval requirement are filled in from the test catalogue.

    Args:
        test_kind: A test kind returned by list_available_tests.
        description: What the test would measure for this variant and which outcome supports or refutes which hypothesis.
        tests_hypotheses: Hypothesis IDs (H...) the test discriminates between.
        expected_learning: 0 to 1. How much the outcome is expected to change the ranking of the hypotheses.
        expected_learning_reasoning: Why, naming the outcomes that would move each hypothesis.
        feasibility: 0 to 1. How likely the test runs to completion with the data and providers available now.
        feasibility_reasoning: Why, using the availability that list_available_tests reported.
    """
    return respond(
        _record_test_candidate,
        test_kind,
        description,
        tests_hypotheses,
        expected_learning,
        expected_learning_reasoning,
        feasibility,
        feasibility_reasoning,
    )


def _record_plan(chosen_test_id: str, rationale: str, rejected: list[dict[str, str]]) -> Payload:
    reason = _require_text(rationale, "rationale", minimum=40, maximum=1600)
    _require_clean(reason, "The plan rationale")
    remaining = budget.status()

    def build(events: list[Event]) -> Payload:
        candidates = {event["payload"]["id"]: event["payload"] for event in open_candidates(events)}
        if len(candidates) < 2:
            raise LabToolError(
                f"A plan must choose between at least two candidate tests; {len(candidates)} not yet executed "
                "candidate is on record. Record another with record_test_candidate."
            )
        if chosen_test_id not in candidates:
            raise LabToolError(f"chosen_test_id must be one of the open candidates: {', '.join(candidates)}.")
        reasons = {
            str(row.get("test_id", "")).strip(): " ".join(str(row.get("reason", "")).split())
            for row in rejected or []
            if isinstance(row, dict)
        }
        missing = [
            identifier
            for identifier in candidates
            if identifier != chosen_test_id and len(reasons.get(identifier, "")) < 15
        ]
        if missing:
            raise LabToolError(
                f"Every candidate that was not chosen needs a reason in rejected: missing for {', '.join(missing)}."
            )
        for text in reasons.values():
            _require_clean(text, "A rejection reason")
        cost = candidates[chosen_test_id]["cost"]
        if cost["compute_seconds"] > remaining["compute_seconds_remaining"]:
            raise LabToolError(
                f"{chosen_test_id} needs {cost['compute_seconds']} compute seconds; "
                f"{remaining['compute_seconds_remaining']} remain. Choose a test that fits the budget."
            )
        if cost["tool_calls"] > remaining["tool_calls_remaining"]:
            raise LabToolError(
                f"{chosen_test_id} needs {cost['tool_calls']} tool calls; {remaining['tool_calls_remaining']} remain."
            )
        return {
            "chosen_test_id": chosen_test_id,
            "rationale": reason,
            "rejected": [
                {"test_id": identifier, "reason": reasons[identifier]}
                for identifier in candidates
                if identifier != chosen_test_id
            ],
            "budget_remaining": {
                "tool_calls": remaining["tool_calls_remaining"],
                "compute_seconds": remaining["compute_seconds_remaining"],
            },
            "scores": [
                {
                    "test_id": identifier,
                    "test_kind": candidate["test_kind"],
                    "expected_learning": candidate["expected_learning"],
                    "feasibility": candidate["feasibility"],
                    "cost": candidate["cost"],
                    "requires_approval": candidate["requires_approval"],
                }
                for identifier, candidate in candidates.items()
            ],
            "round": len(of_type(events, "plan")) + 1,
        }

    event = append_event(current_role(), "plan", build, refs=[chosen_test_id])
    payload = event["payload"]
    return {
        "recorded_plan_seq": event["seq"],
        "chosen_test_id": payload["chosen_test_id"],
        "requires_approval": next(
            row["requires_approval"] for row in payload["scores"] if row["test_id"] == chosen_test_id
        ),
        "budget_remaining": payload["budget_remaining"],
    }


def record_plan(chosen_test_id: str, rationale: str, rejected: list[dict[str, str]]) -> str:
    """Record the plan: the one test chosen among the open candidates and why every other one was rejected.

    Args:
        chosen_test_id: ID (T...) of the chosen test.
        rationale: Why this test, comparing expected learning, feasibility and cost against the remaining budget.
        rejected: One object per candidate that was not chosen, each with test_id and reason.
    """
    return respond(_record_plan, chosen_test_id, rationale, rejected)


def _statements(events: list[Event]) -> list[tuple[Event, str]]:
    rows: list[tuple[Event, str]] = []
    text_fields = (
        "statement",
        "why_it_matters",
        "would_refute",
        "rank_rationale",
        "description",
        "rationale",
        "summary",
        "uncertainty",
        "why",
        "why_now",
        "text",
        "reason",
        "findings",
    )
    for event in events:
        parts = [str(event["payload"][field]) for field in text_fields if event["payload"].get(field)]
        for row in event["payload"].get("per_hypothesis", []) or []:
            parts.append(str(row.get("why", "")))
        for row in event["payload"].get("rejected", []) or []:
            parts.append(str(row.get("reason", "")))
        if parts:
            rows.append((event, " ".join(parts)))
    return rows


def _review_claims() -> Payload:
    events = load_events()
    flagged = []
    for event, text in _statements(events):
        problems = claims.check_text(text)
        if problems:
            flagged.append(
                {"seq": event["seq"], "type": event["type"], "by": event["agent"], "problems": problems}
            )
    unsourced = [event["payload"]["id"] for event in of_type(events, "evidence") if not event["sources"]]
    unlabelled = [
        event["payload"]["id"]
        for event in of_type(events, "hypothesis")
        if event["payload"].get("label") != HYPOTHESIS_LABEL
    ]
    plan = latest_plan(events)
    chosen = by_id(events, plan["payload"]["chosen_test_id"]) if plan else None
    return {
        "statements_checked": len(_statements(events)),
        "clinical_or_treatment_wording": flagged,
        "evidence_without_source": unsourced,
        "hypotheses_without_label": unlabelled,
        "evidence_items": len(of_type(events, "evidence")),
        "hypotheses": len(of_type(events, "hypothesis")),
        "chosen_test": (
            {
                "test_id": chosen["payload"]["id"],
                "test_kind": chosen["payload"]["test_kind"],
                "tool": chosen["payload"]["tool"],
                "requires_approval": chosen["payload"]["requires_approval"],
                "cost": chosen["payload"]["cost"],
                "why_approval": (
                    "The tool starts a compute job on an external inference service."
                    if chosen["payload"]["requires_approval"]
                    else "Retrieval only: it reads public database records and starts no job."
                ),
            }
            if chosen
            else None
        ),
    }


def review_claims() -> str:
    """Check every statement in the record for clinical or treatment wording, uncited evidence and unlabelled hypotheses, and report the chosen test's approval requirement."""
    return respond(_review_claims)


def _record_safety_review(test_id: str, verdict: str, findings: str) -> Payload:
    if verdict not in ("cleared", "blocked"):
        raise LabToolError("verdict must be cleared or blocked.")
    text = _require_text(findings, "findings", maximum=1400)

    def build(events: list[Event]) -> Payload:
        plan = latest_plan(events)
        if plan is None or plan["payload"]["chosen_test_id"] != test_id:
            raise LabToolError(
                "test_id must be the chosen test of the latest plan. Call read_record with sections ['plans']."
            )
        candidate = by_id(events, test_id)
        return {
            "kind": "safety_review",
            "test_id": test_id,
            "plan_seq": plan["seq"],
            "verdict": verdict,
            "findings": text,
            "requires_approval": bool(candidate and candidate["payload"]["requires_approval"]),
        }

    event = append_event(current_role(), "note", build, refs=[test_id])
    payload = event["payload"]
    following = (
        "Call request_approval now; the test cannot run without an approved decision."
        if payload["requires_approval"] and verdict == "cleared"
        else "No human approval is needed for this test."
    )
    return {
        "recorded_review_seq": event["seq"],
        "verdict": verdict,
        "requires_approval": payload["requires_approval"],
        "next": following,
    }


def record_safety_review(test_id: str, verdict: str, findings: str) -> str:
    """Record the safety review of the chosen test and of the claims in the record.

    Args:
        test_id: ID (T...) of the chosen test of the latest plan.
        verdict: cleared when the plan and the recorded claims pass, blocked otherwise.
        findings: What was checked and what was found, including any flagged statement by its seq number.
    """
    return respond(_record_safety_review, test_id, verdict, findings)


def approval_for(events: list[Event], test_id: str) -> tuple[Event | None, Event | None]:
    """The latest approval request for a test and its decision, if any."""
    requests = [
        event for event in of_type(events, "approval_request") if event["payload"].get("test_id") == test_id
    ]
    if not requests:
        return None, None
    request = requests[-1]
    decisions = [
        event
        for event in of_type(events, "approval_decision")
        if event["payload"].get("id") == request["payload"]["id"]
    ]
    return request, (decisions[-1] if decisions else None)


def _request_approval(test_id: str, reason: str, risk: str) -> Payload:
    why = _require_text(reason, "reason", maximum=900)
    hazard = _require_text(risk, "risk", maximum=900)
    directory = run_dir()

    def build(events: list[Event]) -> Payload:
        plan = latest_plan(events)
        if plan is None or plan["payload"]["chosen_test_id"] != test_id:
            raise LabToolError("Approval can only be requested for the chosen test of the latest plan.")
        candidate = by_id(events, test_id)
        if candidate is None:
            raise LabToolError(f"{test_id} is not in the record.")
        request, decision = approval_for(events, test_id)
        if request is not None and decision is None:
            raise LabToolError(f"Approval {request['payload']['id']} for {test_id} is already pending.")
        definition = TESTS[candidate["payload"]["test_kind"]]
        return {
            "id": next_id(events, "approval_request"),
            "action": f"Run {definition['tool']} ({definition['title']}) for {subject().get('variant_id')}",
            "reason": why,
            "risk": hazard,
            "test_id": test_id,
            "tool": definition["tool"],
            "cost": candidate["payload"]["cost"],
        }

    request = append_event(current_role(), "approval_request", build, refs=[test_id])
    approval_id = request["payload"]["id"]
    deadline = time.monotonic() + float(os.environ.get("ORPHAFOLD_LAB_APPROVAL_TIMEOUT", "900"))
    while time.monotonic() < deadline:
        for event in of_type(load_events(directory), "approval_decision"):
            if event["payload"].get("id") == approval_id:
                return {"approval_id": approval_id, **event["payload"]}
        time.sleep(2)
    timed_out = append_event(
        current_role(),
        "approval_decision",
        {
            "id": approval_id,
            "decision": "rejected",
            "by": "approval timeout (no human decision)",
            "note": "No human answered in time. Treated as rejected; the test was not run.",
        },
        refs=[test_id],
        directory=directory,
    )
    return {"approval_id": approval_id, **timed_out["payload"]}


def request_approval(test_id: str, reason: str, risk: str) -> str:
    """Ask a human to approve a consequential test and wait for the decision. Returns approved or rejected.

    Args:
        test_id: ID (T...) of the chosen test that needs approval.
        reason: Why the lab wants to run it, in one or two sentences a scientist can judge.
        risk: What the action costs or touches: compute, external services, data leaving the lab.
    """
    return respond(_request_approval, test_id, reason, risk)


def stored_result(test_id: str, directory: Path | None = None) -> Payload:
    path = (directory or run_dir()) / RESULTS_DIRECTORY / f"{test_id}.json"
    if not path.exists():
        raise LabToolError(f"No stored result for {test_id}. Run the test first.")
    return json.loads(path.read_text(encoding="utf-8"))


def _record_result(test_id: str, summary: str) -> Payload:
    text = _require_text(summary, "summary", minimum=30, maximum=1400)
    _require_clean(text, "The result summary")
    raw = stored_result(test_id)

    def build(events: list[Event]) -> Payload:
        if test_id in executed_test_ids(events):
            raise LabToolError(f"A result for {test_id} is already on record.")
        payload = {
            "test_id": test_id,
            "test_kind": raw["test_kind"],
            "summary": text,
            "values": raw["values"],
            "reproducible_command": raw["reproducible_command"],
            "controls": raw.get("controls", []),
            "limitations": raw.get("limitations", []),
            "elapsed_seconds": raw.get("elapsed_seconds"),
        }
        for key in ("job_id", "manifest_url", "result_url"):
            if raw.get(key):
                payload[key] = raw[key]
        return payload

    event = append_event(
        current_role(), "experiment_result", build, refs=[test_id], event_sources=raw.get("sources", [])[:40]
    )
    return {
        "recorded_result_seq": event["seq"],
        "test_id": test_id,
        "sources_attached": len(event["sources"]),
    }


def record_result(test_id: str, summary: str) -> str:
    """Record the result of an executed test. Values, command, sources and job manifest are attached from the stored tool output.

    Args:
        test_id: ID (T...) of the test that was run.
        summary: Two or three sentences stating what was measured and the numbers observed, without interpretation.
    """
    return respond(_record_result, test_id, summary)


def _get_test_result(test_id: str) -> Payload:
    raw = stored_result(test_id)
    result = {
        key: raw[key]
        for key in ("test_kind", "values", "controls", "limitations", "reproducible_command", "job_id")
        if key in raw
    }
    # Sources named in the closest measurements come first, so result evidence cites the record it rests on
    leading = json.dumps(raw["values"].get("closest_contacts") or raw["values"])
    ranked = sorted(
        raw.get("sources", []),
        key=lambda row: leading.find(row["record_id"]) if row["record_id"] in leading else len(leading),
    )
    result["citable_sources"] = ranked[:12]
    result["how_to_cite"] = (
        "Record result evidence with the database, record_id and url of one of citable_sources."
    )
    return result


def get_test_result(test_id: str) -> str:
    """Return the full stored values of an executed test.

    Args:
        test_id: ID (T...) of the executed test.
    """
    return respond(_get_test_result, test_id)


def _record_interpretation(test_id: str, per_hypothesis: list[dict[str, str]], uncertainty: str) -> Payload:
    caveat = _require_text(uncertainty, "uncertainty", minimum=30, maximum=1600)

    def build(events: list[Event]) -> Payload:
        if test_id not in executed_test_ids(events):
            raise LabToolError(f"{test_id} has no recorded result to interpret.")
        hypotheses = {event["payload"]["id"] for event in of_type(events, "hypothesis")}
        rows = []
        for row in per_hypothesis or []:
            identifier = str(row.get("id", "")).strip()
            verdict = str(row.get("verdict", "")).strip()
            why = " ".join(str(row.get("why", "")).split())
            if identifier not in hypotheses:
                raise LabToolError(f"{identifier or 'An entry'} is not a hypothesis in the record.")
            if verdict not in VERDICTS:
                raise LabToolError(f"verdict for {identifier} must be one of: {', '.join(VERDICTS)}.")
            if len(why) < 20:
                raise LabToolError(f"why for {identifier} must say which measured value led to the verdict.")
            _require_clean(why, f"The interpretation of {identifier}")
            rows.append({"id": identifier, "verdict": verdict, "why": why})
        missing = sorted(hypotheses - {row["id"] for row in rows})
        if missing:
            raise LabToolError(f"Every hypothesis needs a verdict; missing: {', '.join(missing)}.")
        return {"test_id": test_id, "per_hypothesis": rows, "uncertainty": caveat}

    _require_clean(caveat, "The uncertainty statement")
    event = append_event(current_role(), "interpretation", build, refs=[test_id])
    return {
        "recorded_interpretation_seq": event["seq"],
        "verdicts": {row["id"]: row["verdict"] for row in event["payload"]["per_hypothesis"]},
    }


def record_interpretation(test_id: str, per_hypothesis: list[dict[str, str]], uncertainty: str) -> str:
    """Record what the test result means for every hypothesis.

    Args:
        test_id: ID (T...) of the interpreted test.
        per_hypothesis: One object per hypothesis with id, verdict (supported, weakened, refuted or unchanged)
            and why, naming the measured value behind the verdict.
        uncertainty: What the result cannot show and how far the verdicts can be trusted.
    """
    return respond(_record_interpretation, test_id, per_hypothesis, uncertainty)


def _record_decision(favoured_after: str, why: str) -> Payload:
    reason = _require_text(why, "why", minimum=40, maximum=1600)
    _require_clean(reason, "The decision")

    def build(events: list[Event]) -> Payload:
        interpretations = of_type(events, "interpretation")
        if not interpretations:
            raise LabToolError("Record the interpretation of the result before the decision.")
        chosen = by_id(events, favoured_after)
        if chosen is None or chosen["type"] != "hypothesis":
            raise LabToolError("favoured_after must be a hypothesis ID (H...) from the record.")
        verdicts = latest_verdicts(events)
        if verdicts.get(favoured_after) == "refuted":
            raise LabToolError(
                f"{favoured_after} was interpreted as refuted, so it cannot be the favoured hypothesis."
            )
        before_id = current_favourite_id(events)
        before = by_id(events, before_id) if before_id else None
        return {
            "favoured_before": before["payload"]["mechanism_class"] if before else None,
            "favoured_after": chosen["payload"]["mechanism_class"],
            "changed": before_id != favoured_after,
            "why": reason,
            "favoured_before_hypothesis": before_id,
            "favoured_after_hypothesis": favoured_after,
            "verdicts": verdicts,
            "after_test_id": interpretations[-1]["payload"]["test_id"],
            "round": len(of_type(events, "decision")) + 1,
        }

    event = append_event(current_role(), "decision", build, refs=[favoured_after])
    payload = event["payload"]
    contradicted = payload["verdicts"].get(payload["favoured_before_hypothesis"]) in ("refuted", "weakened")
    return {
        "recorded_decision_seq": event["seq"],
        "favoured_before": payload["favoured_before_hypothesis"],
        "favoured_after": payload["favoured_after_hypothesis"],
        "changed": payload["changed"],
        "favoured_before_was_contradicted": contradicted,
    }


def record_decision(favoured_after: str, why: str) -> str:
    """Record the updated decision: which hypothesis is favoured now. The previously favoured one is filled in from the record.

    Args:
        favoured_after: ID (H...) of the hypothesis favoured after the result.
        why: How the measured result leads to this choice, citing the test ID and evidence IDs.
    """
    return respond(_record_decision, favoured_after, why)


def _record_next_experiment(description: str, kind: str, why_now: str) -> Payload:
    text = _require_text(description, "description", minimum=30, maximum=1200)
    reason = _require_text(why_now, "why_now", minimum=20, maximum=900)
    _require_clean(f"{text} {reason}", "The next experiment")
    if kind not in EXPERIMENT_KINDS:
        raise LabToolError("kind must be computational or laboratory.")
    event = append_event(
        current_role(), "next_experiment", {"description": text, "kind": kind, "why_now": reason}
    )
    return {"recorded_next_experiment_seq": event["seq"]}


def record_next_experiment(description: str, kind: str, why_now: str) -> str:
    """Record the experiment that should follow, given the updated decision.

    Args:
        description: The experiment and the outcome that would confirm or overturn the favoured hypothesis.
        kind: computational or laboratory.
        why_now: Why this is the most informative next step after the result.
    """
    return respond(_record_next_experiment, description, kind, why_now)


def _record_handoff(to: str, summary: str, refs: list[str] | None) -> Payload:
    if to not in AGENTS:
        raise LabToolError(f"to must be one of: {', '.join(AGENTS)}.")
    text = _require_text(summary, "summary", maximum=1200)
    _require_clean(text, "The handoff summary")
    sender = current_role()
    event = append_event(sender, "handoff", {"from": sender, "to": to, "summary": text}, refs=refs)
    return {"recorded_handoff_seq": event["seq"]}


def record_handoff(to: str, summary: str, refs: list[str] | None = None) -> str:
    """Record a handoff of work to another agent.

    Args:
        to: orchestrator, literature, knowledge_graph, insight, planner, safety, runner, analysis or human.
        summary: What is handed over and what the receiver must do or now knows. Two to four sentences.
        refs: IDs of the record items handed over (E..., G..., H..., T...).
    """
    return respond(_record_handoff, to, summary, refs)


def _record_reopening(hypothesis_id: str, reason: str) -> Payload:
    text = _require_text(reason, "reason", minimum=30, maximum=900)
    _require_clean(text, "The reason")

    def build(events: list[Event]) -> Payload:
        target = by_id(events, hypothesis_id)
        if target is None or target["type"] != "hypothesis":
            raise LabToolError("hypothesis_id must be a hypothesis ID (H...) from the record.")
        return {
            "kind": "reopened_assumption",
            "hypothesis_id": hypothesis_id,
            "reason": text,
            "budget_remaining": budget.status(),
        }

    event = append_event(current_role(), "note", build, refs=[hypothesis_id])
    return {"recorded_reopening_seq": event["seq"]}


def record_reopening(hypothesis_id: str, reason: str) -> str:
    """Record that a result reopened the earlier choice and the planning step is opened again.

    Args:
        hypothesis_id: ID (H...) of the hypothesis that was favoured before the test.
        reason: Which result reopened it (contradicted, displaced or test not completed) and what is reconsidered.
    """
    return respond(_record_reopening, hypothesis_id, reason)


def _record_final_report(markdown: str) -> Payload:
    if len((markdown or "").strip()) < 200:
        raise LabToolError("The report is too short to reconstruct the decision.")
    events = load_events()
    problems = claims.check_text(markdown, known_ids(events), require_citations=True)
    if problems:
        raise LabToolError(
            "Report refused: " + "; ".join(problems) + ". Fix the text and call the tool again."
        )
    if not of_type(events, "decision"):
        raise LabToolError("No decision is on record yet; the report closes the loop after the decision.")
    (run_dir() / "report.md").write_text(markdown.strip() + "\n", encoding="utf-8")
    event = append_event(
        current_role(),
        "note",
        {"kind": "final_report", "text": markdown.strip(), "file": "report.md"},
        refs=sorted(claims.cited_ids(markdown)),
    )
    return {"recorded_report_seq": event["seq"], "file": "report.md"}


def record_final_report(markdown: str) -> str:
    """Record the final research report of the run. Refused when it holds clinical wording or an uncited fact.

    Args:
        markdown: The report. Every sentence that names a database, a structure or a measured value must
            cite a record ID such as [E3] or [T1]. Hypotheses are called agent-generated hypotheses.
    """
    return respond(_record_final_report, markdown)


def _check_record_consistency() -> Payload:
    events = load_events()
    evidence = of_type(events, "evidence")
    hypotheses = of_type(events, "hypothesis")
    used: dict[str, list[str]] = {}
    for event in hypotheses:
        for identifier in event["payload"]["supports"]:
            used.setdefault(identifier, []).append(event["payload"]["id"])
    for event in evidence:
        for reference in event["refs"]:
            if reference.startswith("H"):
                used.setdefault(event["payload"]["id"], []).append(reference)
    by_record: dict[str, list[str]] = {}
    for event in evidence:
        for row in event["sources"]:
            by_record.setdefault(f"{row['database']} {row['record_id']}", []).append(event["payload"]["id"])
    results = of_type(events, "experiment_result")
    result_linked = {
        reference for event in evidence for reference in event["refs"] if reference.startswith("T")
    }
    return {
        "evidence_items": len(evidence),
        "distinct_databases": sorted({row["database"] for event in evidence for row in event["sources"]}),
        "evidence_without_source": [event["payload"]["id"] for event in evidence if not event["sources"]],
        "records_cited_more_than_once": {key: value for key, value in by_record.items() if len(value) > 1},
        "evidence_linked_to_hypotheses": {key: sorted(set(value)) for key, value in used.items()},
        "evidence_not_linked_to_any_hypothesis": [
            event["payload"]["id"] for event in evidence if event["payload"]["id"] not in used
        ],
        "results_without_evidence_link": [
            event["payload"]["test_id"]
            for event in results
            if event["payload"]["test_id"] not in result_linked
        ],
    }


def check_record_consistency() -> str:
    """Report how evidence, hypotheses and test results are linked, and what is uncited, duplicated or unlinked."""
    return respond(_check_record_consistency)
