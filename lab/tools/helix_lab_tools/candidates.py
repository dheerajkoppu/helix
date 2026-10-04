"""The candidates step of the loop: what a drug could act on, and whether a molecule already does it.

A candidate is written from the stored response of `list_candidate_targets`, never from an agent's own
words: the target, the molecule, the bridge, its steps, the direction check and the evidence are attached
from the retrieved record. The agent contributes one plain sentence saying what would have to be true.

The safety agent reviews a proposal before any candidate is recorded. A candidate whose direction check
is not "matches" is rejected there, with the reason the direction check itself gives.
"""

from pathlib import Path
from typing import Any

from helix_lab_tools import claims, record
from helix_lab_tools.context import LabToolError, current_role, respond
from helix_lab_tools.discovery import MATCHING_VERDICT, candidate_by_ref, stored_lookups
from helix_lab_tools.sources import fact_from_evidence

CANDIDATE_LABEL = "Helix hypothesis"
PROPOSAL_KIND = "candidates_proposed"
REVIEW_KIND = "candidate_review"
REJECTION_KIND = "candidate_rejected"

REASON_CODES = {
    "opposes": "direction_opposes",
    "unknown": "direction_unknown",
}


def _clip(text: Any, limit: int = 300) -> str | None:
    if text in (None, ""):
        return None
    cleaned = " ".join(str(text).split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


def _molecule_name(candidate: dict[str, Any]) -> str | None:
    molecule = candidate.get("molecule") or {}
    if not isinstance(molecule, dict):
        return None
    return molecule.get("name") or molecule.get("chembl_id") or molecule.get("inchikey")


def _verdict_of(candidate: dict[str, Any]) -> str:
    return str((candidate.get("direction_check") or {}).get("verdict") or "unknown")


def _actions(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or "unknown"
    return str(value or "unknown")


def _direction_reason(state: str, check: dict[str, Any]) -> str:
    return (
        f"The direction check reads {state}: the mechanism needs {_actions(check.get('required'))} "
        f"and the molecule's recorded action is {check.get('molecule_action') or 'unknown'}."
    )


def _row(candidate: dict[str, Any]) -> dict[str, Any]:
    target = candidate.get("target") or {}
    check = candidate.get("direction_check") or {}
    return {
        "candidate_ref": candidate.get("id"),
        "molecule": _molecule_name(candidate),
        "target": target.get("gene_symbol") or target.get("accession"),
        "bridge_kind": (candidate.get("bridge") or {}).get("kind"),
        "required_action": check.get("required"),
        "molecule_action": check.get("molecule_action"),
        "verdict": _verdict_of(candidate),
        "why": _clip(check.get("why")),
    }


def _candidate_sources(candidate: dict[str, Any]) -> list[dict[str, str]]:
    collected: list[dict[str, str]] = []
    groups = [candidate.get("evidence")]
    for step in (candidate.get("bridge") or {}).get("steps") or []:
        if isinstance(step, dict):
            groups.append(step.get("evidence"))
    for group in groups:
        for item in group or []:
            if not isinstance(item, dict):
                continue
            built = fact_from_evidence(_clip(item.get("statement")) or "evidence", item)
            if built and built["source"] not in collected:
                collected.append(built["source"])
    return collected


def _latest_lookup() -> dict[str, Any]:
    lookups = stored_lookups()
    if not lookups:
        raise LabToolError(
            "No candidate response is stored in this run. Call list_candidate_targets first; its response "
            "is the only source a candidate may be written from."
        )
    return lookups[-1]


def _record_target_rationale(what_to_act_on: str, why: str) -> dict[str, Any]:
    statement = record.require_text(what_to_act_on, "what_to_act_on", minimum=30, maximum=900)
    reason = record.require_text(why, "why", minimum=30, maximum=1200)
    record.require_clean(f"{statement} {reason}", "The target rationale")
    lookup = _latest_lookup()
    response = lookup.get("response") or {}
    mechanism = (response.get("subject") or {}).get("mechanism") or {}
    action = response.get("required_action") or {}
    if not action.get("actions"):
        raise LabToolError(
            "The stored candidate response states no required action, so no rationale can be written from it."
        )

    def build(events: list[dict[str, Any]]) -> dict[str, Any]:
        favoured = record.current_favourite_id(events)
        return {
            "id": record.next_id(events, "target_rationale"),
            "what_to_act_on": statement,
            "why": reason,
            "mechanism_class": mechanism.get("class"),
            "direction": mechanism.get("direction"),
            "direction_confidence": mechanism.get("confidence"),
            "required_actions": action.get("actions"),
            "rule": _clip(action.get("rule"), 500),
            "rule_why": _clip(action.get("why"), 500),
            "direction_basis": _clip(mechanism.get("basis"), 500),
            "direction_records": [
                f"{source['database']} {source['record_id']}"
                for source in _candidate_sources({"evidence": mechanism.get("evidence")})
            ],
            "direction_disagreements": [
                _clip(item, 300) for item in (mechanism.get("disagreements") or [])
            ],
            "favoured_hypothesis": favoured,
            "query": lookup.get("query"),
        }

    event = record.append_event(current_role(), "target_rationale", build)
    payload = event["payload"]
    return {
        "recorded": payload["id"],
        "seq": event["seq"],
        "direction": payload["direction"],
        "required_actions": payload["required_actions"],
    }


def record_target_rationale(what_to_act_on: str, why: str) -> str:
    """Record what a drug could act on for the favoured mechanism. The direction rule is attached from the retrieved response.

    Args:
        what_to_act_on: In molecular terms, which protein or node a molecule could act on and in which
            direction (reduce or restore activity). No treatment or dosing wording.
        why: Why the favoured mechanism and its direction lead to that action, naming the hypothesis ID.
    """
    return respond(_record_target_rationale, what_to_act_on, why)


def _propose_candidates(candidate_refs: list[str], why: str) -> dict[str, Any]:
    reason = record.require_text(why, "why", minimum=30, maximum=1200)
    record.require_clean(reason, "The proposal")
    references = [str(item).strip() for item in candidate_refs or [] if str(item).strip()]
    if not references:
        raise LabToolError("candidate_refs must list at least one candidate_ref from list_candidate_targets.")
    if len(references) > 8:
        raise LabToolError("Propose at most 8 candidates in one call.")
    rows = []
    for reference in references:
        found = candidate_by_ref(reference)
        if found is None:
            raise LabToolError(
                f"No candidate {reference} was returned by a tool in this run, so it cannot be proposed."
            )
        rows.append(_row(found[0]))
    event = record.append_event(
        current_role(),
        "note",
        {
            "kind": PROPOSAL_KIND,
            "text": reason,
            "candidate_refs": references,
            "rows": rows,
            "matching": [row["candidate_ref"] for row in rows if row["verdict"] == MATCHING_VERDICT],
            "not_matching": [row["candidate_ref"] for row in rows if row["verdict"] != MATCHING_VERDICT],
        },
    )
    return {
        "recorded_proposal_seq": event["seq"],
        "proposed": len(rows),
        "direction_verdicts": {row["candidate_ref"]: row["verdict"] for row in rows},
        "next": (
            "The safety agent reviews the proposal with review_candidates and record_candidate_review. "
            "record_candidate is refused until a cleared review covers the reference."
        ),
    }


def propose_candidates(candidate_refs: list[str], why: str) -> str:
    """Put candidates forward for the safety review. Nothing is recorded as a candidate until the review clears it.

    Args:
        candidate_refs: candidate_ref values from list_candidate_targets, strongest bridge first.
        why: Why these candidates and not the others, in molecular terms.
    """
    return respond(_propose_candidates, candidate_refs, why)


def _latest_proposal(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    proposals = record.notes_of_kind(events, PROPOSAL_KIND)
    return proposals[-1] if proposals else None


def _review_candidates() -> dict[str, Any]:
    events = record.load_events()
    proposal = _latest_proposal(events)
    if proposal is None:
        raise LabToolError("No candidate proposal is on record yet. The translator proposes before the review.")
    rows = []
    flagged = []
    for reference in proposal["payload"].get("candidate_refs") or []:
        found = candidate_by_ref(reference)
        if found is None:
            flagged.append(f"{reference} is not in any stored tool response")
            continue
        candidate, _ = found
        row = _row(candidate)
        row["caveats"] = [_clip(item, 200) for item in (candidate.get("caveats") or [])][:3]
        row["bridge_steps"] = [
            _clip((step or {}).get("statement"), 240)
            for step in (candidate.get("bridge") or {}).get("steps") or []
        ]
        row["records_cited"] = [
            f"{source['database']} {source['record_id']}" for source in _candidate_sources(candidate)
        ][:6]
        row["would_be_rejected"] = row["verdict"] != MATCHING_VERDICT
        rows.append(row)
    text = str(proposal["payload"].get("text") or "")
    problems = claims.check_text(text)
    response = _latest_lookup().get("response") or {}
    mechanism = (response.get("subject") or {}).get("mechanism") or {}
    action = response.get("required_action") or {}
    return {
        "proposal_seq": proposal["seq"],
        "proposed_by": proposal["agent"],
        "direction_of_the_mechanism": {
            "class": mechanism.get("class"),
            "direction": mechanism.get("direction"),
            "confidence": mechanism.get("confidence"),
            "basis": _clip(mechanism.get("basis"), 400),
            "records": [
                f"{source['database']} {source['record_id']}"
                for source in _candidate_sources({"evidence": mechanism.get("evidence")})
            ],
            "disagreements": [_clip(item, 300) for item in (mechanism.get("disagreements") or [])],
            "required_actions": action.get("actions"),
            "rule": _clip(action.get("rule"), 400),
            "note": (
                "The direction and its records come from the catalogue through the candidate endpoint, not "
                "from the run's objective. Judge each row against this direction."
            ),
        },
        "why": _clip(text, 600),
        "wording_problems": problems,
        "missing_from_tool_output": flagged,
        "candidates": rows,
        "must_reject": [row["candidate_ref"] for row in rows if row["would_be_rejected"]],
        "may_clear": [row["candidate_ref"] for row in rows if not row["would_be_rejected"]],
        "rule": (
            "A candidate is recordable only when its direction check reads matches: a molecule that pushes the "
            "protein the way the disease already pushes it would make the mechanism worse. Everything else is "
            "rejected with the reason the direction check gives."
        ),
    }


def review_candidates() -> str:
    """Read the candidate proposal with each candidate's direction check, bridge steps and cited records, and which of them must be rejected."""
    return respond(_review_candidates)


def _record_candidate_review(verdict: str, findings: str) -> dict[str, Any]:
    if verdict not in ("cleared", "blocked"):
        raise LabToolError("verdict must be cleared or blocked.")
    text = record.require_text(findings, "findings", minimum=30, maximum=1400)
    record.require_clean(text, "The findings")

    cleared: list[str] = []
    rejected: list[dict[str, Any]] = []

    def build(events: list[dict[str, Any]]) -> dict[str, Any]:
        proposal = _latest_proposal(events)
        if proposal is None:
            raise LabToolError("No candidate proposal is on record. Nothing to review.")
        for reference in proposal["payload"].get("candidate_refs") or []:
            found = candidate_by_ref(reference)
            if found is None:
                rejected.append(
                    {
                        "candidate_ref": reference,
                        "reason_code": "not_returned_by_a_tool",
                        "reason": "No tool in this run returned this candidate.",
                    }
                )
                continue
            candidate, _ = found
            check = candidate.get("direction_check") or {}
            state = _verdict_of(candidate)
            if verdict == "cleared" and state == MATCHING_VERDICT:
                cleared.append(reference)
                continue
            if verdict != "cleared":
                rejected.append(
                    {
                        "candidate_ref": reference,
                        "molecule": _molecule_name(candidate),
                        "target": (candidate.get("target") or {}).get("gene_symbol"),
                        "reason_code": "review_blocked",
                        "reason": "The safety review blocked the whole proposal.",
                        "direction_verdict": state,
                    }
                )
                continue
            rejected.append(
                {
                    "candidate_ref": reference,
                    "molecule": _molecule_name(candidate),
                    "target": (candidate.get("target") or {}).get("gene_symbol"),
                    "reason_code": REASON_CODES.get(state, "direction_not_matching"),
                    "reason": _clip(check.get("why")) or _direction_reason(state, check),
                    "direction_verdict": state,
                    "required_action": check.get("required"),
                    "molecule_action": check.get("molecule_action"),
                }
            )
        return {
            "kind": REVIEW_KIND,
            "proposal_seq": proposal["seq"],
            "verdict": verdict,
            "findings": text,
            "cleared": cleared,
            "rejected": rejected,
        }

    event = record.append_event(current_role(), "note", build)
    for rejection in rejected:
        record.append_event(
            current_role(),
            "note",
            {
                "kind": REJECTION_KIND,
                "review_seq": event["seq"],
                "text": f"{rejection.get('molecule') or rejection['candidate_ref']}: {rejection['reason']}",
                **rejection,
            },
        )
    return {
        "recorded_review_seq": event["seq"],
        "verdict": verdict,
        "cleared": cleared,
        "rejected": [row["candidate_ref"] for row in rejected],
        "rejections_recorded": len(rejected),
        "next": (
            f"{len(cleared)} candidate(s) may now be recorded with record_candidate."
            if cleared
            else "No candidate may be recorded. Hand back so the translator can look again."
        ),
    }


def record_candidate_review(verdict: str, findings: str) -> str:
    """Record the safety review of the candidate proposal. Every candidate whose direction check is not "matches" is rejected here, with its reason.

    Args:
        verdict: cleared when the proposal may proceed for the candidates whose direction matches,
            blocked when no candidate of the proposal may be recorded at all.
        findings: What was checked: the direction of the mechanism, each molecule's action, the wording of
            the proposal, and which candidates are rejected and why.
    """
    return respond(_record_candidate_review, verdict, findings)


def _cleared_refs(events: list[dict[str, Any]]) -> set[str]:
    reviews = record.notes_of_kind(events, REVIEW_KIND)
    allowed: set[str] = set()
    for review in reviews:
        if review["payload"].get("verdict") != "cleared":
            continue
        allowed.update(str(item) for item in review["payload"].get("cleared") or [])
    for review in reviews:
        for rejection in review["payload"].get("rejected") or []:
            allowed.discard(str(rejection.get("candidate_ref")))
    return allowed


def _record_candidate(candidate_ref: str, what_would_have_to_be_true: str) -> dict[str, Any]:
    sentence = record.require_text(
        what_would_have_to_be_true, "what_would_have_to_be_true", minimum=30, maximum=600
    )
    record.require_clean(sentence, "The candidate")
    found = candidate_by_ref(candidate_ref)
    if found is None:
        raise LabToolError(
            f"No candidate {candidate_ref} was returned by a tool in this run. A candidate can only be "
            "recorded from a candidate_ref of list_candidate_targets."
        )
    candidate, response = found
    state = _verdict_of(candidate)
    if state != MATCHING_VERDICT:
        why = (
            "The molecule pushes the protein the way the disease already pushes it, so it would make the "
            "mechanism worse."
            if state == "opposes"
            else "The direction of its effect is not established, and an unestablished direction is not a direction."
        )
        raise LabToolError(
            f"{candidate_ref} has a direction check of {state}, so it is not a candidate. {why} "
            "It belongs in the ruled-out list, which the safety review already recorded."
        )
    allowed_names = [name for name in [_molecule_name(candidate)] if name]
    invented = claims.unknown_molecule_names(sentence, allowed_names)
    if invented:
        raise LabToolError(
            "The sentence names molecules no tool returned for this candidate: "
            f"{', '.join(invented)}. Name only {', '.join(allowed_names) or 'the target protein'}."
        )
    bridge = candidate.get("bridge") or {}
    steps = [
        {
            "statement": _clip((step or {}).get("statement"), 400),
            "records": [
                f"{source['database']} {source['record_id']}"
                for source in _candidate_sources({"evidence": (step or {}).get("evidence")})
            ],
        }
        for step in bridge.get("steps") or []
        if isinstance(step, dict)
    ]
    event_sources = _candidate_sources(candidate)
    if not event_sources:
        raise LabToolError(
            f"{candidate_ref} carries no source record, so it cannot be recorded. Every step of the chain "
            "must cite a real record."
        )

    def build(events: list[dict[str, Any]]) -> dict[str, Any]:
        if candidate_ref not in _cleared_refs(events):
            raise LabToolError(
                f"{candidate_ref} is not cleared by a candidate review. The safety agent reviews the "
                "proposal before any candidate is recorded."
            )
        for existing in record.of_type(events, "candidate"):
            if existing["payload"].get("candidate_ref") == candidate_ref:
                raise LabToolError(f"Already recorded as {existing['payload']['id']}.")
        rationales = record.of_type(events, "target_rationale")
        return {
            "id": record.next_id(events, "candidate"),
            "candidate_ref": candidate_ref,
            "rank": candidate.get("rank"),
            "target": candidate.get("target"),
            "molecule": candidate.get("molecule"),
            "bridge": {
                "kind": bridge.get("kind"),
                "from_disease": bridge.get("from_disease"),
                "steps": steps,
            },
            "direction_check": candidate.get("direction_check"),
            "structure": candidate.get("structure"),
            "caveats": [_clip(item, 240) for item in (candidate.get("caveats") or [])],
            "what_would_have_to_be_true": sentence,
            "evidence": [
                {"statement": _clip(item.get("statement"), 300), "source": source}
                for item, source in zip(
                    [row for row in candidate.get("evidence") or [] if isinstance(row, dict)],
                    _candidate_sources({"evidence": candidate.get("evidence")}),
                    strict=False,
                )
            ],
            "label": CANDIDATE_LABEL,
            "limits": [_clip(item, 240) for item in (response.get("limits") or [])][:3],
            "target_rationale": rationales[-1]["payload"]["id"] if rationales else None,
        }

    favoured = record.current_favourite_id(record.load_events())
    event = record.append_event(
        current_role(),
        "candidate",
        build,
        refs=[favoured] if favoured else [],
        event_sources=event_sources,
    )
    payload = event["payload"]
    return {
        "recorded": payload["id"],
        "seq": event["seq"],
        "molecule": _molecule_name(candidate),
        "bridge_kind": (payload["bridge"] or {}).get("kind"),
        "direction": (payload["direction_check"] or {}).get("verdict"),
        "label": CANDIDATE_LABEL,
        "sources": len(event_sources),
    }


def record_candidate(candidate_ref: str, what_would_have_to_be_true: str) -> str:
    """Record one candidate the safety review cleared. Target, molecule, bridge, direction check and evidence are attached from the retrieved response.

    Args:
        candidate_ref: candidate_ref of a cleared candidate.
        what_would_have_to_be_true: One plain sentence naming the assumption the whole chain rests on, the
            thing that would have to hold for this candidate to be worth testing. No treatment wording, no
            molecule name other than the candidate's own.
    """
    return respond(_record_candidate, candidate_ref, what_would_have_to_be_true)


def candidate_metrics(events: list[dict[str, Any]], directory: Path | None = None) -> dict[str, Any]:
    """Counts of the candidates step, for run.json after a run."""
    recorded = record.of_type(events, "candidate")
    ruled_out = sum(
        len((lookup.get("response") or {}).get("ruled_out") or []) for lookup in stored_lookups(directory)
    )
    return {
        "candidates": len(recorded),
        "candidates_rejected_by_safety": len(record.notes_of_kind(events, REJECTION_KIND)),
        "ruled_out_by_direction": ruled_out,
        "bridge_kinds": sorted(
            {
                str((event["payload"].get("bridge") or {}).get("kind"))
                for event in recorded
                if (event["payload"].get("bridge") or {}).get("kind")
            }
        ),
    }
