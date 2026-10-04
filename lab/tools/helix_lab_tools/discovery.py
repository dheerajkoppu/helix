"""Candidate retrieval: what a drug could act on for the favoured mechanism, and whether a molecule exists.

Wraps GET /api/v1/discovery/candidates and the structure endpoints a structural bridge rests on. The
full response is stored in the run directory; the agent only ever names a candidate by the reference
this module returns, so no molecule name can enter the record that a tool did not return.
"""

import json
from pathlib import Path
from typing import Any

from helix_lab_tools.context import LabToolError, respond, run_dir, subject
from helix_lab_tools.http import get_json
from helix_lab_tools.sources import fact, fact_from_evidence, remember, remember_facts

CANDIDATES_DIRECTORY = "candidates"
MATCHING_VERDICT = "matches"


def _clip(text: str | None, limit: int = 300) -> str | None:
    if not text:
        return None
    cleaned = " ".join(str(text).split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


def _store() -> Path:
    directory = run_dir() / CANDIDATES_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _write_lookup(payload: dict[str, Any], query: dict[str, Any]) -> Path:
    directory = _store()
    index = len(list(directory.glob("lookup-*.json"))) + 1
    path = directory / f"lookup-{index}.json"
    path.write_text(
        json.dumps({"query": query, "response": payload}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def stored_lookups(directory: Path | None = None) -> list[dict[str, Any]]:
    """Every candidate response this run retrieved, oldest first."""
    directory = (directory or run_dir()) / CANDIDATES_DIRECTORY
    if not directory.is_dir():
        return []
    rows = []
    for path in sorted(directory.glob("lookup-*.json")):
        try:
            rows.append(json.loads(path.read_text(encoding="utf-8")))
        except ValueError:
            continue
    return rows


def candidate_by_ref(reference: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The stored candidate with this reference and the response it came from, latest response first."""
    wanted = str(reference or "").strip()
    if not wanted:
        return None
    for row in reversed(stored_lookups()):
        response = row.get("response") or {}
        for candidate in response.get("candidates") or []:
            if str(candidate.get("id") or "") == wanted:
                return candidate, response
    return None


def _evidence_sources(evidence: list[Any] | None) -> list[dict[str, str]]:
    collected: list[dict[str, str]] = []
    for item in evidence or []:
        if not isinstance(item, dict):
            continue
        built = fact_from_evidence(_clip(item.get("statement")) or "evidence", item)
        if built:
            collected.append(built["source"])
    return collected


def _molecule_line(molecule: dict[str, Any] | None) -> str | None:
    if not molecule:
        return None
    name = molecule.get("name") or molecule.get("chembl_id") or molecule.get("inchikey")
    phase = molecule.get("max_phase")
    action = molecule.get("action_type")
    parts = [str(name)]
    if action:
        parts.append(str(action).lower())
    if molecule.get("modality"):
        parts.append(str(molecule["modality"]))
    if phase is not None:
        parts.append(f"highest phase reached {phase}")
    return ", ".join(parts)


def _candidate_digest(candidate: dict[str, Any]) -> dict[str, Any]:
    target = candidate.get("target") or {}
    molecule = candidate.get("molecule") or {}
    bridge = candidate.get("bridge") or {}
    check = candidate.get("direction_check") or {}
    structure = candidate.get("structure") or {}
    return {
        "candidate_ref": candidate.get("id"),
        "rank": candidate.get("rank"),
        "target": {
            "gene_symbol": target.get("gene_symbol"),
            "accession": target.get("accession"),
            "name": _clip(target.get("name"), 120),
            "relation": target.get("relation"),
        },
        "molecule": _molecule_line(molecule),
        "molecule_ids": {
            "chembl_id": molecule.get("chembl_id"),
            "inchikey": molecule.get("inchikey"),
        }
        if molecule
        else None,
        "bridge_kind": bridge.get("kind"),
        "bridge_from_disease": (bridge.get("from_disease") or {}).get("name"),
        "bridge_steps": len(bridge.get("steps") or []),
        "direction_check": {
            "required": check.get("required"),
            "molecule_action": check.get("molecule_action"),
            "verdict": check.get("verdict"),
            "why": _clip(check.get("why")),
        },
        "structure": {
            "structure_id": structure.get("structure_id"),
            "pocket_id": structure.get("pocket_id"),
            "similar_to": (structure.get("similar_to") or {}).get("accession")
            or (structure.get("similar_to") or {}).get("structure_id"),
        }
        if structure
        else None,
        "caveats": [_clip(item, 200) for item in (candidate.get("caveats") or [])][:4],
        "cited_records": [
            f"{row['database']} {row['record_id']}" for row in _evidence_sources(candidate.get("evidence"))
        ][:6],
        "label": candidate.get("label"),
    }


def _list_candidate_targets(
    gene: str | None,
    disease: str | None,
    variant: str | None,
    exclude_direct: bool,
) -> dict[str, Any]:
    known = subject()
    query = {
        "gene": (gene or "").strip() or known.get("gene"),
        "disease": (disease or "").strip() or None,
        "variant": (variant or "").strip() or None,
        "exclude_direct": "true" if exclude_direct else "false",
    }
    if not query["gene"] and not query["disease"] and not query["variant"]:
        raise LabToolError("Name at least a gene, a disease or a variant of this run's subject.")
    try:
        payload = get_json("/discovery/candidates", query, timeout=180)
    except LabToolError as error:
        raise LabToolError(
            f"{error} The candidate endpoint GET /api/v1/discovery/candidates did not answer for "
            f"gene={query['gene']}. Record a gap saying candidate retrieval was unavailable and hand back."
        ) from error
    if not isinstance(payload, dict):
        raise LabToolError("GET /api/v1/discovery/candidates did not return an object.")
    path = _write_lookup(payload, query)

    subject_block = payload.get("subject") or {}
    mechanism = subject_block.get("mechanism") or {}
    action = payload.get("required_action") or {}
    candidates = [row for row in payload.get("candidates") or [] if isinstance(row, dict)]
    ruled_out = [row for row in payload.get("ruled_out") or [] if isinstance(row, dict)]

    sources: list[dict[str, str]] = []
    sources.extend(_evidence_sources(mechanism.get("evidence")))
    for candidate in candidates:
        sources.extend(_evidence_sources(candidate.get("evidence")))
        for step in (candidate.get("bridge") or {}).get("steps") or []:
            if isinstance(step, dict):
                sources.extend(_evidence_sources(step.get("evidence")))
    for row in ruled_out:
        sources.extend(_evidence_sources(row.get("evidence")))
    remember(sources, "list_candidate_targets")

    matching = [row for row in candidates if (row.get("direction_check") or {}).get("verdict") == MATCHING_VERDICT]
    return {
        "stored_at": str(path.relative_to(run_dir())),
        "query": query,
        "subject": {
            "gene_symbol": subject_block.get("gene_symbol"),
            "accession": subject_block.get("accession"),
            "disease": (subject_block.get("disease") or {}).get("name"),
            "variant": (subject_block.get("variant") or {}).get("label"),
            "mechanism_class": mechanism.get("class"),
            "direction": mechanism.get("direction"),
            "confidence": mechanism.get("confidence"),
            # Where the direction comes from. It is the catalogue's own statement, not the run's objective
            "direction_basis": _clip(mechanism.get("basis"), 400),
            "direction_records": [
                f"{row['database']} {row['record_id']}"
                for row in _evidence_sources(mechanism.get("evidence"))
            ],
            "direction_disagreements": [
                _clip(item, 300) for item in (mechanism.get("disagreements") or [])
            ],
        },
        "required_action": {
            "actions": action.get("actions") or [],
            "rule": _clip(action.get("rule"), 400),
            "why": _clip(action.get("why"), 400),
        },
        "candidates": [_candidate_digest(row) for row in candidates],
        "candidates_with_matching_direction": [
            row.get("id") for row in matching
        ],
        "ruled_out": [
            {
                "molecule": _molecule_line(row.get("molecule"))
                if isinstance(row.get("molecule"), dict)
                else _clip(str(row.get("molecule") or ""), 120),
                "target": (row.get("target") or {}).get("gene_symbol")
                if isinstance(row.get("target"), dict)
                else _clip(str(row.get("target") or ""), 60),
                "reason_code": row.get("reason_code"),
                "reason": _clip(row.get("reason")),
            }
            for row in ruled_out
        ],
        "ruled_out_count": len(ruled_out),
        "withheld_edges": payload.get("withheld_edges") or [],
        "sources_answered": [
            {
                "source": row.get("name") or row.get("source") or row.get("id"),
                "state": row.get("state") or row.get("status"),
                "release": row.get("release"),
            }
            for row in payload.get("sources") or []
            if isinstance(row, dict)
        ],
        "counts": payload.get("counts") or {},
        "limits": [_clip(item, 240) for item in (payload.get("limits") or [])],
        "next": (
            "Call get_candidate_detail for the references you want to put forward, then "
            "record_target_rationale and propose_candidates. Only a reference from this list may be named."
        ),
    }


def list_candidate_targets(
    gene: str | None = None,
    disease: str | None = None,
    variant: str | None = None,
    exclude_direct: bool = False,
) -> str:
    """What a drug could act on for this subject, and which known molecules act on it, with the direction check.

    Returns one row per candidate with its bridge kind, its direction check and the records it cites, plus the
    ruled-out rows and the sources that answered. The full response is stored in the run directory; name a
    candidate by its candidate_ref in every later tool call.

    Args:
        gene: HGNC symbol; defaults to the gene of this run's subject.
        disease: Catalogue slug of the disease, when the subject is a disease.
        variant: Helix variant ID, when the subject is a variant.
        exclude_direct: True drops every edge that links the subject disease straight to a molecule, so a
            candidate has to be recovered through a bridge. The response lists what was withheld.
    """
    return respond(_list_candidate_targets, gene, disease, variant, exclude_direct)


def _get_candidate_detail(candidate_ref: str) -> dict[str, Any]:
    found = candidate_by_ref(candidate_ref)
    if found is None:
        references = [
            candidate.get("id")
            for row in stored_lookups()
            for candidate in (row.get("response") or {}).get("candidates") or []
        ]
        raise LabToolError(
            f"No candidate {candidate_ref} was returned in this run. "
            f"References retrieved so far: {', '.join(str(item) for item in references[:12]) or 'none'}."
        )
    candidate, response = found
    bridge = candidate.get("bridge") or {}
    steps = []
    for step in bridge.get("steps") or []:
        if not isinstance(step, dict):
            continue
        steps.append(
            {
                "statement": _clip(step.get("statement"), 400),
                "records": [
                    f"{row['database']} {row['record_id']}" for row in _evidence_sources(step.get("evidence"))
                ],
            }
        )
    structure = candidate.get("structure") or {}
    return {
        "candidate_ref": candidate.get("id"),
        "rank": candidate.get("rank"),
        "target": candidate.get("target") or {},
        "molecule": candidate.get("molecule"),
        "bridge": {
            "kind": bridge.get("kind"),
            "from_disease": bridge.get("from_disease"),
            "steps": steps,
        },
        "direction_check": candidate.get("direction_check") or {},
        "structure": structure or None,
        "caveats": [_clip(item, 240) for item in (candidate.get("caveats") or [])],
        "evidence": [
            {"statement": _clip(item.get("statement"), 300), "source": row}
            for item, row in zip(
                [row for row in candidate.get("evidence") or [] if isinstance(row, dict)],
                _evidence_sources(candidate.get("evidence")),
                strict=False,
            )
        ],
        "label": candidate.get("label"),
        "required_action": (response.get("required_action") or {}).get("actions") or [],
        "limits": [_clip(item, 240) for item in (response.get("limits") or [])],
    }


def get_candidate_detail(candidate_ref: str) -> str:
    """The full chain of one candidate: every bridge step with the records it cites, the direction check and the caveats.

    Args:
        candidate_ref: The candidate_ref of a candidate list_candidate_targets returned.
    """
    return respond(_get_candidate_detail, candidate_ref)


def _get_target_structure(accession: str) -> dict[str, Any]:
    """Pockets and structures of a candidate target, for a structural or pocket claim about it."""
    identifier = (accession or "").strip().upper()
    if not identifier:
        raise LabToolError("accession is required (the UniProt accession of the candidate target).")
    pockets_payload: dict[str, Any] = {}
    structures_payload: dict[str, Any] = {}
    unavailable: list[str] = []
    try:
        pockets_payload = get_json(f"/proteins/{identifier}/pockets", timeout=150) or {}
    except LabToolError as error:
        unavailable.append(f"pockets: {error}")
    try:
        structures_payload = get_json(f"/proteins/{identifier}/structures", timeout=150) or {}
    except LabToolError as error:
        unavailable.append(f"structures: {error}")

    pockets = [row for row in (pockets_payload.get("pockets") or []) if isinstance(row, dict)]
    structures = [row for row in (structures_payload.get("items") or []) if isinstance(row, dict)]
    facts = []
    for pocket in pockets[:2]:
        source = pocket.get("source") or pockets_payload.get("source") or {}
        record_id = source.get("record_id") or pockets_payload.get("structure_id") or pocket.get("structure_id")
        if not record_id:
            continue
        facts.append(
            fact(
                f"{pocket.get('provider') or 'PrankWeb'} predicts a pocket on {identifier} "
                f"(pocket {pocket.get('id') or pocket.get('rank')}, score {pocket.get('score')}, "
                f"{len(pocket.get('residues') or [])} residues). A predicted pocket is a prediction, "
                "not an observed binding site.",
                "computational_prediction",
                f"pocket score {pocket.get('score')}",
                source.get("database") or "prankweb",
                record_id,
                source.get("url") or pockets_payload.get("url"),
            )
        )
    for entry in structures[:2]:
        source = entry.get("source") or {}
        record_id = source.get("record_id") or entry.get("id")
        if not record_id:
            continue
        facts.append(
            fact(
                f"{identifier} has a {entry.get('origin') or 'structure'} structure {entry.get('id')} "
                f"({entry.get('method') or 'method not stated'}), covering residues "
                f"{entry.get('coverage_start')} to {entry.get('coverage_end')}.",
                "experimental" if entry.get("origin") == "experimental" else "computational_prediction",
                str(entry.get("resolution") or entry.get("mean_plddt") or "not graded by the source"),
                source.get("database") or "rcsb",
                record_id,
                source.get("url"),
            )
        )
    return remember_facts(
        {
            "accession": identifier,
            "pockets": [
                {
                    "id": pocket.get("id") or pocket.get("rank"),
                    "score": pocket.get("score"),
                    "residues": len(pocket.get("residues") or []),
                    "provider": pocket.get("provider"),
                }
                for pocket in pockets[:6]
            ],
            "structures": [
                {
                    "id": entry.get("id"),
                    "origin": entry.get("origin"),
                    "method": entry.get("method"),
                    "resolution": entry.get("resolution"),
                }
                for entry in structures[:6]
            ],
            "unavailable": unavailable,
            "note": (
                "Pocket geometry is predicted. A resemblance between two pockets is a hypothesis about where a "
                "molecule could bind, never a measurement that it does."
            ),
            "facts": [item for item in facts if item],
        },
        "get_target_structure",
    )


def get_target_structure(accession: str) -> str:
    """Predicted pockets and available structures of a candidate target, so a structural bridge can cite records.

    Args:
        accession: UniProt accession of the candidate target, copied from a candidate's target block.
    """
    return respond(_get_target_structure, accession)
