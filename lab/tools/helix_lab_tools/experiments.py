"""The tests the runner can execute. Each is a reproducible computation over Helix API data or jobs.

Reproduce any test outside a run:
    python -m helix_lab_tools.experiments ligand_contact --accession Q06187 --position 28
"""

import argparse
import json
import re
import statistics
import sys
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from helix_lab_tools import budget, record, sources
from helix_lab_tools.api import comparison_summary, covering_structures, site_mutation
from helix_lab_tools.catalogue import CONTACT_THRESHOLD_ANGSTROM, TESTS
from helix_lab_tools.context import (
    LabToolError,
    api_url,
    current_role,
    respond,
    run_dir,
    subject,
    workspace_id,
)
from helix_lab_tools.http import get_json, request_json

MAX_STRUCTURES = 40
JOB_POLL_SECONDS = 3
JOB_WAIT_LIMIT_SECONDS = 420
SINGLE_ELEMENT = re.compile(r"^[A-Z][a-z]?\s?\d*$")
TERMINAL_JOB_STATES = ("succeeded", "failed", "cancelled")

Parameters = dict[str, Any]
Outcome = dict[str, Any]


def _short(name: str | None, limit: int = 70) -> str:
    name = " ".join((name or "").split())
    return name if len(name) <= limit else name[: limit - 1] + "…"


def _ligand_kind(ligand: dict[str, Any]) -> str:
    return "ion" if SINGLE_ELEMENT.match((ligand.get("formula") or "").strip()) else "organic"


def ligand_contact(parameters: Parameters) -> Outcome:
    accession = parameters["accession"]
    position = int(parameters["position"])
    ledger, covering = covering_structures(accession, position)
    with_ligand = [
        entry for entry in covering if any(not row.get("common_additive") for row in entry.get("ligands", []))
    ]
    with_ligand.sort(key=lambda entry: entry["structure"].get("resolution") or 99)
    examined = with_ligand[:MAX_STRUCTURES]

    def fetch(entry: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
        try:
            return entry, get_json(
                f"/structures/{entry['structure']['id']}/ligands", {"accession": accession}, timeout=120
            )
        except LabToolError:
            return entry, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        fetched = list(pool.map(fetch, examined))

    contacts: list[dict[str, Any]] = []
    ligands: dict[str, dict[str, Any]] = {}
    unavailable: list[str] = []
    mutated_site: list[dict[str, Any]] = []
    cited: list[dict[str, str]] = []
    for entry, payload in fetched:
        structure = entry["structure"]
        identifier = structure["id"].split(":")[-1]
        if payload is None:
            unavailable.append(identifier)
            continue
        cited.append(sources.source("rcsb", identifier, f"https://www.rcsb.org/structure/{identifier}"))
        mutation = site_mutation(entry, position)
        contacts_here = 0
        for ligand in payload.get("ligands", []):
            if ligand.get("common_additive"):
                continue
            kind = _ligand_kind(ligand)
            row = ligands.setdefault(
                ligand["comp_id"],
                {
                    "ligand": ligand["comp_id"],
                    "name": _short(ligand.get("name")),
                    "kind": kind,
                    "structures": set(),
                    "instances": 0,
                    "instances_contacting_residue": 0,
                    "min_distance_angstrom": None,
                    "neighbour_counts": [],
                },
            )
            row["structures"].add(identifier)
            for instance in ligand.get("instances", []):
                row["instances"] += 1
                neighbours = [
                    item
                    for item in instance.get("residues", [])
                    if item.get("uniprot_accession") == accession
                ]
                row["neighbour_counts"].append(len({item["uniprot_position"] for item in neighbours}))
                at_site = [item for item in neighbours if item.get("uniprot_position") == position]
                if not at_site:
                    continue
                distance = min(item["distance"] for item in at_site)
                if distance > CONTACT_THRESHOLD_ANGSTROM:
                    continue
                contacts_here += 1
                row["instances_contacting_residue"] += 1
                if row["min_distance_angstrom"] is None or distance < row["min_distance_angstrom"]:
                    row["min_distance_angstrom"] = round(distance, 2)
                contacts.append(
                    {
                        "structure": identifier,
                        "resolution": structure.get("resolution"),
                        "ligand": ligand["comp_id"],
                        "ligand_name": _short(ligand.get("name")),
                        "ligand_kind": kind,
                        "chain": instance.get("chain_id"),
                        "distance_angstrom": round(distance, 2),
                        "residue_in_structure": at_site[0].get("residue_name"),
                        "residue_mutated_in_structure": mutation,
                    }
                )
        if mutation:
            mutated_site.append(
                {
                    "structure": identifier,
                    "mutation": mutation,
                    "ligands": [
                        row["comp_id"] for row in payload.get("ligands", []) if not row.get("common_additive")
                    ],
                    "ligand_instances_contacting_residue": contacts_here,
                }
            )

    contacts.sort(key=lambda row: row["distance_angstrom"])
    summary = []
    for row in ligands.values():
        counts = row.pop("neighbour_counts")
        row["structures"] = sorted(row["structures"])
        row["median_residues_neighbouring_ligand"] = statistics.median(counts) if counts else None
        summary.append(row)
    summary.sort(key=lambda row: (-(row["instances_contacting_residue"]), row["ligand"]))
    organic = [
        row for row in contacts if row["ligand_kind"] == "organic" and not row["residue_mutated_in_structure"]
    ]
    ions = [
        row for row in contacts if row["ligand_kind"] == "ion" and not row["residue_mutated_in_structure"]
    ]
    never = [row["ligand"] for row in summary if row["instances_contacting_residue"] == 0]
    if not examined:
        verdict = "no_ligand_bound_structure"
        headline = f"No experimental structure observing residue {position} holds a non-solvent ligand."
    elif organic:
        verdict = "contact_with_organic_ligand"
        closest = organic[0]
        partners = sorted({row["ligand"] for row in organic})
        headline = (
            f"Residue {position} is within {CONTACT_THRESHOLD_ANGSTROM} Å of an organic ligand in "
            f"{len({row['structure'] for row in organic})} of {len(examined) - len(unavailable)} ligand-bound structures "
            f"({', '.join(partners[:6])}); closest {closest['distance_angstrom']} Å to {closest['ligand']} "
            f"({closest['ligand_name']}) in PDB {closest['structure']}."
        )
    elif ions:
        verdict = "contact_with_ion_only"
        headline = (
            f"Residue {position} neighbours only ions ({', '.join(sorted({row['ligand'] for row in ions}))}) "
            f"in the {len(examined) - len(unavailable)} ligand-bound structures examined."
        )
    else:
        verdict = "no_ligand_contact"
        headline = (
            f"Residue {position} is not within {CONTACT_THRESHOLD_ANGSTROM} Å of any non-solvent ligand in the "
            f"{len(examined) - len(unavailable)} ligand-bound structures examined."
        )
    return {
        "values": {
            "headline": headline,
            "verdict": verdict,
            "contact_threshold_angstrom": CONTACT_THRESHOLD_ANGSTROM,
            "experimental_structures_total": len(ledger.get("experimental", [])),
            "structures_observing_residue": len(covering),
            "ligand_bound_structures_examined": len(examined) - len(unavailable),
            "structures_with_contact": sorted({row["structure"] for row in contacts}),
            "closest_contacts": contacts[:12],
            "ligands": summary[:25],
            "negative_control_ligands_never_contacting_residue": never[:25],
            "structures_with_residue_mutated": mutated_site,
            "structures_unavailable": unavailable,
        },
        "sources": cited,
    }


def _effect_values(
    accession: str, position: int, alternate: str
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    payload = get_json(f"/proteins/{accession}/residues/{position}/effects", {"alt": alternate}, timeout=150)
    by_key = {value["key"]: value for group in payload.get("groups", []) for value in group.get("values", [])}
    return payload, by_key


def _source_of(value: dict[str, Any]) -> dict[str, str] | None:
    origin = (value.get("evidence") or {}).get("source") or {}
    if not origin.get("record_id"):
        return None
    return sources.source(origin.get("database", "protvar"), origin["record_id"], origin.get("url"))


def stability_effect(parameters: Parameters) -> Outcome:
    accession = parameters["accession"]
    position = int(parameters["position"])
    alternate = parameters["alternate_residue"]
    payload, by_key = _effect_values(accession, position, alternate)
    foldx = by_key.get("foldx.ddg") or {}
    threshold = next(
        (
            row["lower"]
            for row in foldx.get("thresholds", [])
            if row.get("lower") is not None and "destabilising" in row.get("label", "")
        ),
        2.0,
    )
    value = foldx.get("value") if foldx.get("state") == "ok" else None
    cited = [origin for origin in (_source_of(foldx),) if origin]
    comparison = []
    if parameters.get("gene"):
        listing = get_json(
            f"/genes/{parameters['gene']}/variants",
            {"residue_start": position, "residue_end": position, "limit": 20},
            timeout=120,
        )
        others = sorted(
            {
                item["alternate_residue"]
                for item in listing.get("items", [])
                if item.get("change_kind") == "substitution"
                and item.get("alternate_residue")
                and len(item["alternate_residue"]) == 1
                and item["alternate_residue"] not in (alternate, "*")
            }
        )
        for other in others[:4]:
            try:
                _, other_values = _effect_values(accession, position, other)
            except LabToolError:
                continue
            other_foldx = other_values.get("foldx.ddg") or {}
            comparison.append(
                {
                    "substitution": f"{parameters.get('reference_residue', '')}{position}{other}",
                    "foldx_ddg_kcal_mol": other_foldx.get("value")
                    if other_foldx.get("state") == "ok"
                    else None,
                }
            )
            origin = _source_of(other_foldx)
            if origin:
                cited.append(origin)
    missense3d = by_key.get("missense3d.prediction") or {}
    plddt = (payload.get("residue") or {}).get("plddt")
    label = f"{parameters.get('reference_residue', '')}{position}{alternate}"
    if value is None:
        verdict = "not_covered"
        headline = f"ProtVar holds no FoldX prediction for {label}."
    elif value >= threshold:
        verdict = "predicted_destabilising"
        headline = f"FoldX predicts ΔΔG {value:+.2f} kcal/mol for {label}, at or above the destabilising threshold of {threshold} kcal/mol."
    else:
        verdict = "not_predicted_destabilising"
        headline = (
            f"FoldX predicts ΔΔG {value:+.2f} kcal/mol for {label}, below the destabilising threshold of "
            f"{threshold} kcal/mol (residue pLDDT {plddt})."
        )
    return {
        "values": {
            "headline": headline,
            "verdict": verdict,
            "substitution": label,
            "foldx_ddg_kcal_mol": value,
            "destabilising_threshold_kcal_mol": threshold,
            "threshold_defined_by": next(
                (row.get("defined_by") for row in foldx.get("thresholds", [])), None
            ),
            "model": (foldx.get("structure") or {}).get("id"),
            "residue_plddt": plddt,
            "plddt_supports_interpretation": bool(plddt is not None and plddt >= 70),
            "missense3d": {"state": missense3d.get("state"), "value": missense3d.get("value")},
            "other_substitutions_at_residue": comparison,
        },
        "sources": cited,
    }


def structural_context(parameters: Parameters) -> Outcome:
    accession = parameters["accession"]
    position = int(parameters["position"])
    alternate = parameters["alternate_residue"]
    cited: list[dict[str, str]] = []
    pockets = get_json(f"/proteins/{accession}/pockets", {"residue": position}, timeout=180)
    predicted = pockets.get("pockets", [])
    containing = [
        {
            "pocket": pocket.get("name"),
            "rank": pocket.get("rank"),
            "of": len(predicted),
            "probability": pocket.get("probability"),
            "residues": len(pocket.get("positions", [])),
            "mean_plddt": pocket.get("mean_plddt"),
        }
        for pocket in predicted
        if pocket.get("contains_residue")
    ]
    if pockets.get("status") == "ready" and pockets.get("structure_id"):
        model = pockets["structure_id"].split(":")[-1]
        cited.append(sources.source("prankweb", model, "https://prankweb.cz"))
    _, by_key = _effect_values(accession, position, alternate)
    protvar_pockets = []
    for key, value in by_key.items():
        if not key.startswith("pocket.") or value.get("state") != "ok":
            continue
        details = value.get("details") or {}
        protvar_pockets.append(
            {
                "pocket": details.get("pocket_id"),
                "score": value.get("value"),
                "buriedness": round(details.get("buriedness", 0), 2),
                "mean_plddt": round(details.get("mean_plddt", 0), 1),
                "residues": details.get("residues"),
            }
        )
        origin = _source_of(value)
        if origin:
            cited.append(origin)
    interface = by_key.get("interface.membership") or {}
    in_interface = None if not interface else interface.get("state") == "ok"
    in_pocket = bool(containing) or bool(protvar_pockets)
    parts = []
    if containing:
        best = min(containing, key=lambda row: row["rank"])
        parts.append(
            f"lines P2Rank pocket rank {best['rank']} of {best['of']} (probability {best['probability']})"
        )
    elif pockets.get("status") == "ready":
        parts.append(f"lines none of the {len(predicted)} P2Rank pockets")
    else:
        parts.append(f"P2Rank prediction not ready ({pockets.get('status')})")
    parts.append(f"lies in {len(protvar_pockets)} ProtVar predicted pocket(s)")
    parts.append(
        "lies in a predicted protein-protein interface"
        if in_interface
        else "lies in no predicted protein-protein interface (ProtVar)"
    )
    return {
        "values": {
            "headline": f"Residue {position}: " + "; ".join(parts) + ".",
            "verdict": "in_predicted_pocket" if in_pocket else "not_in_predicted_pocket",
            "in_predicted_interface": in_interface,
            "p2rank_status": pockets.get("status"),
            "p2rank_model": pockets.get("structure_id"),
            "p2rank_pockets_total": len(predicted),
            "p2rank_pockets_containing_residue": containing,
            "protvar_pockets_containing_residue": protvar_pockets,
            "protvar_interface": {"state": interface.get("state"), "message": interface.get("message")},
        },
        "sources": cited,
    }


def structure_comparison(
    parameters: Parameters, *, workspace: str | None = None, wait_limit: float = JOB_WAIT_LIMIT_SECONDS
) -> Outcome:
    gene = parameters["gene"]
    change = parameters.get("protein_change") or parameters["variant_id"].split("-", 1)[-1]
    planned = get_json(f"/compare/{gene}/{change}", timeout=150)
    runnable = [row for row in planned.get("providers", []) if row.get("can_run")]
    wanted = parameters.get("provider")
    if wanted:
        runnable = [row for row in runnable if row["id"] == wanted]
    if not runnable:
        reasons = "; ".join(
            reason for row in planned.get("providers", []) for reason in row.get("reasons", [])
        )
        raise LabToolError(f"No provider can run the comparison now. {reasons}")
    provider = sorted(runnable, key=lambda row: 0 if row.get("performs_inference") else 1)[0]
    started = time.monotonic()
    job = request_json(
        "POST",
        "/jobs",
        body={"kind": planned.get("job_kind", "variant_comparison"), "params": provider["job_params"]},
        headers={"X-Helix-Workspace": workspace or "helix-lab-reproduction"},
        timeout=60,
    )
    job_id = job["id"]
    deadline = started + wait_limit
    while job.get("status") not in TERMINAL_JOB_STATES and time.monotonic() < deadline:
        time.sleep(JOB_POLL_SECONDS)
        job = get_json(f"/jobs/{job_id}")
    elapsed = time.monotonic() - started
    manifest_url = job.get("manifest_url") or f"/api/v1/jobs/{job_id}/manifest"
    base = {
        "job_id": job_id,
        "manifest_url": manifest_url,
        "compute_seconds": round(elapsed, 1),
        "sources": [sources.source("helix", job_id, f"{api_url()}{manifest_url}")],
    }
    if job.get("status") != "succeeded":
        error = job.get("error") or {}
        return {
            **base,
            "values": {
                "headline": f"The comparison job {job_id} ended as {job.get('status')}: {error.get('message') or 'no result'}.",
                "verdict": "not_completed",
                "job_status": job.get("status"),
                "provider": provider["id"],
                "error": error,
            },
        }
    compared = comparison_summary(job_id)
    summary = compared["summary"]
    local = summary.get("local_rmsd_ca")
    delta = round(summary.get("plddt_site_variant", 0) - summary.get("plddt_site_reference", 0), 1)
    changed = (local is not None and local >= 1.0) or abs(delta) >= 5 or summary.get("contacts_lost", 0) >= 3
    inference = (
        "No model was run for this request; a stored output was served. "
        if not compared["provider"].get("performs_inference") or compared.get("origin") == "cached_example"
        else ""
    )
    return {
        **base,
        "result_url": f"/api/v1/compare/results/{job_id}",
        "values": {
            "headline": (
                f"{inference}{compared['provider'].get('model_name')} models of residues {compared['construct'].get('start')}-"
                f"{compared['construct'].get('end')}: local C-alpha RMSD {local} Å, confident-residue RMSD "
                f"{summary.get('rmsd_ca_confident')} Å, site pLDDT {summary.get('plddt_site_reference')} to "
                f"{summary.get('plddt_site_variant')}, contacts lost {summary.get('contacts_lost')}, gained {summary.get('contacts_gained')}."
            ),
            "verdict": "local_change_predicted" if changed else "no_confident_local_change",
            "job_status": job.get("status"),
            "site_plddt_change": delta,
            **compared,
        },
    }


FUNCTIONS: dict[str, Callable[[Parameters], Outcome]] = {
    "ligand_contact": ligand_contact,
    "stability_effect": stability_effect,
    "structural_context": structural_context,
    "structure_comparison": structure_comparison,
}


def reproducible_command(test_kind: str, parameters: Parameters) -> str:
    options = [f"--accession {parameters.get('accession')}", f"--position {parameters.get('position')}"]
    for name in ("alternate_residue", "reference_residue", "gene", "variant_id"):
        if parameters.get(name):
            options.append(f"--{name.replace('_', '-')} {parameters[name]}")
    return (
        f"HELIX_API_URL={api_url()} PYTHONPATH=lab/tools lab/.venv/bin/python -m helix_lab_tools.experiments "
        f"{test_kind} {' '.join(options)}"
    )


def _execute(test_id: str, test_kind: str) -> dict[str, Any]:
    definition = TESTS[test_kind]
    directory = run_dir()
    parameters = subject()
    command = reproducible_command(test_kind, parameters)

    def started(events: list[record.Event]) -> record.Payload:
        candidate = record.by_id(events, test_id)
        if candidate is None or candidate["type"] != "test_candidate":
            raise LabToolError(f"{test_id} is not a test candidate in the record.")
        if candidate["payload"]["test_kind"] != test_kind:
            raise LabToolError(
                f"{test_id} is a {candidate['payload']['test_kind']} test; use {candidate['payload']['tool']} for it."
            )
        plan = record.latest_plan(events)
        if plan is None or plan["payload"]["chosen_test_id"] != test_id:
            raise LabToolError(f"{test_id} is not the chosen test of the latest plan, so it is not executed.")
        if test_id in record.executed_test_ids(events) or any(
            event["payload"].get("test_id") == test_id
            for event in record.of_type(events, "experiment_started")
        ):
            raise LabToolError(f"{test_id} was already started in this run.")
        return {
            "test_id": test_id,
            "test_kind": test_kind,
            "tool": definition["tool"],
            "parameters": parameters,
            "reproducible_command": command,
            "controls": definition["controls"],
        }

    record.append_event(current_role(), "experiment_started", started, refs=[test_id])
    begun = time.monotonic()
    try:
        if test_kind == "structure_comparison":
            remaining = budget.status(directory)["compute_seconds_remaining"]
            outcome = structure_comparison(
                parameters, workspace=workspace_id(), wait_limit=min(JOB_WAIT_LIMIT_SECONDS, remaining)
            )
        else:
            outcome = FUNCTIONS[test_kind](parameters)
    except LabToolError as error:
        outcome = {
            "values": {
                "headline": f"The test did not complete: {error}",
                "verdict": "not_completed",
                "error": str(error),
            },
            "sources": [],
        }
    elapsed = round(time.monotonic() - begun, 1)
    if outcome.get("compute_seconds"):
        budget.add_compute_seconds(outcome["compute_seconds"], directory)
    stored = {
        "test_id": test_id,
        "test_kind": test_kind,
        "values": outcome["values"],
        "sources": outcome.get("sources", []),
        "controls": definition["controls"],
        "limitations": definition["limitations"],
        "reproducible_command": command,
        "elapsed_seconds": elapsed,
    }
    for key in ("job_id", "manifest_url", "result_url", "compute_seconds"):
        if outcome.get(key):
            stored[key] = outcome[key]
    results = directory / record.RESULTS_DIRECTORY
    results.mkdir(exist_ok=True)
    (results / f"{test_id}.json").write_text(
        json.dumps(stored, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    sources.remember(stored["sources"], definition["tool"])
    values = outcome["values"]
    brief = {
        key: value
        for key, value in values.items()
        if not isinstance(value, list | dict) or key in ("summary", "construct")
    }
    for key in (
        "closest_contacts",
        "ligands",
        "negative_control_ligands_never_contacting_residue",
        "structures_with_residue_mutated",
        "other_substitutions_at_residue",
        "p2rank_pockets_containing_residue",
        "protvar_pockets_containing_residue",
    ):
        if key in values:
            brief[key] = values[key][:8]
    brief["controls"] = definition["controls"]
    return {
        "test_id": test_id,
        "test_kind": test_kind,
        "stored": f"{record.RESULTS_DIRECTORY}/{test_id}.json",
        "elapsed_seconds": elapsed,
        "job_id": outcome.get("job_id"),
        "manifest_url": outcome.get("manifest_url"),
        "values": brief,
        "next": "Call record_result with this test_id and a summary of the measured values.",
    }


def run_ligand_contact_test(test_id: str) -> str:
    """Execute the ligand contact test of the chosen plan: is the variant residue next to a ligand in experimental structures.

    Args:
        test_id: ID (T...) of the chosen test candidate of kind ligand_contact.
    """
    return respond(_execute, test_id, "ligand_contact")


def run_stability_test(test_id: str) -> str:
    """Execute the stability test of the chosen plan: predicted folding free-energy change of the substitution.

    Args:
        test_id: ID (T...) of the chosen test candidate of kind stability_effect.
    """
    return respond(_execute, test_id, "stability_effect")


def run_structural_context_test(test_id: str) -> str:
    """Execute the structural context test of the chosen plan: predicted pocket and interface membership of the residue.

    Args:
        test_id: ID (T...) of the chosen test candidate of kind structural_context.
    """
    return respond(_execute, test_id, "structural_context")


def run_structure_comparison(test_id: str) -> str:
    """Start the reference versus variant structure prediction job of the chosen plan and wait for its result. Needs an approved human decision.

    Args:
        test_id: ID (T...) of the chosen test candidate of kind structure_comparison.
    """
    return respond(_execute, test_id, "structure_comparison")


def _availability() -> dict[str, Any]:
    parameters = subject()
    accession = parameters["accession"]
    position = int(parameters["position"])
    alternate = parameters["alternate_residue"]
    available: dict[str, dict[str, Any]] = {}
    try:
        _, covering = covering_structures(accession, position)
        bound = [
            entry
            for entry in covering
            if any(not row.get("common_additive") for row in entry.get("ligands", []))
        ]
        available["ligand_contact"] = {
            "can_run": bool(bound),
            "detail": f"{len(bound)} experimental structures observe residue {position} and hold a non-solvent ligand ({len(covering)} observe the residue).",
        }
    except LabToolError as error:
        available["ligand_contact"] = {"can_run": False, "detail": str(error)}
    try:
        _, by_key = _effect_values(accession, position, alternate)
        foldx_state = (by_key.get("foldx.ddg") or {}).get("state")
        available["stability_effect"] = {
            "can_run": foldx_state == "ok",
            "detail": f"FoldX prediction state at this substitution: {foldx_state or 'not offered'}. The value is not shown before the test runs.",
        }
        interface_state = (by_key.get("interface.membership") or {}).get("state")
        available["structural_context"] = {
            "can_run": True,
            "detail": f"ProtVar pocket and interface data answer for this residue (interface state: {interface_state}); P2Rank runs on the AlphaFold model.",
        }
    except LabToolError as error:
        available["stability_effect"] = {"can_run": False, "detail": str(error)}
        available["structural_context"] = {"can_run": False, "detail": str(error)}
    try:
        change = parameters.get("protein_change") or parameters["variant_id"].split("-", 1)[-1]
        planned = get_json(f"/compare/{parameters['gene']}/{change}", timeout=150)
        providers = [
            {
                "provider": row["id"],
                "can_run": row.get("can_run"),
                "performs_inference": row.get("performs_inference"),
                "reason": "; ".join(row.get("reasons", []))[:220] or None,
            }
            for row in planned.get("providers", [])
        ]
        construct = planned.get("proposed_construct") or {}
        available["structure_comparison"] = {
            "can_run": any(row["can_run"] for row in providers),
            "detail": f"Construct residues {construct.get('start')}-{construct.get('end')} ({construct.get('length')} residues).",
            "providers": providers,
            "existing_results": len(planned.get("results", [])),
        }
    except LabToolError as error:
        available["structure_comparison"] = {"can_run": False, "detail": str(error)}
    tests = []
    for kind, definition in TESTS.items():
        tests.append(
            {
                "test_kind": kind,
                "tool": definition["tool"],
                "title": definition["title"],
                "measures": definition["measures"],
                "bears_on": definition["bears_on"],
                "cost": definition["cost"],
                "requires_approval": definition["requires_approval"],
                "controls": definition["controls"],
                "limitations": definition["limitations"],
                "availability_now": available.get(kind),
            }
        )
    return {"subject": parameters, "budget": budget.status(), "tests": tests}


def list_available_tests() -> str:
    """List the tests the runner can execute for this run's variant, with what each measures, its cost, whether it needs human approval, and whether it can run right now."""
    return respond(_availability)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproduce one lab test outside a run and print its values.")
    parser.add_argument("test_kind", choices=sorted(FUNCTIONS))
    parser.add_argument("--accession", required=True)
    parser.add_argument("--position", required=True, type=int)
    parser.add_argument("--alternate-residue", default=None)
    parser.add_argument("--reference-residue", default=None)
    parser.add_argument("--gene", default=None)
    parser.add_argument("--variant-id", default=None)
    parser.add_argument("--provider", default=None)
    arguments = parser.parse_args()
    parameters = {
        key: value for key, value in vars(arguments).items() if key != "test_kind" and value is not None
    }
    try:
        outcome = FUNCTIONS[arguments.test_kind](parameters)
    except (LabToolError, KeyError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
    print(json.dumps(outcome, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
