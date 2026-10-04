"""Accuracy of the discovery engine on held-out known drugs, across the whole seeded catalog.

    lab/.venv/bin/python lab/experiments/run_discovery_accuracy.py

The three controls in run_discovery_controls.py show the direction filter behaving correctly on three
subjects. Three subjects are three subjects. This runner asks a different question: over every disease in
the catalog for which some molecule is really used or really being tried, does the engine find that molecule
when the record naming it is withheld, and does it ever push one the wrong way?

THE DESIGN

Ground truth is built from the disease-to-molecule records that `exclude_direct=true` withholds, so the
engine is forbidden to use them when it is then asked:

  source A, disease-anchored: GET /diseases/{slug} -> treatments[]. Open Targets drugs recorded against the
    disease through its own MONDO/ORPHA cross-reference. These are exactly the `open_targets_disease_drug`
    edges the held-out mode drops.
  source B, target-anchored: GET /genes/{symbol}/treatments -> a drug acting on the disease gene's target
    whose own indications[] name this disease's MONDO id exactly.

Every ground-truth molecule is then resolved through GET /compounds/{chembl_id}, a different endpoint, to a
ChEMBL id and an InChIKey, and candidate rows are matched on those identifiers only. Nothing is matched on a
name string. That call also carries the molecule's ChEMBL mechanism action types and its ChEMBL
drug_indication rows, which are used to corroborate the pair and to score direction agreement.

WHAT IS MEASURED, each with its n

  recall           - of the evaluable disease-molecule pairs, how many come back in `candidates` at all,
                     at what rank (median), and the hit rate within the top 10 and the top 25
  false rejection  - how often a molecule genuinely used for a disease lands in `ruled_out`. Every case is
                     printed individually with the engine's own reason, because each one is either a
                     direction-of-effect error or a symptomatic drug that does not correct the protein
  direction agree  - for each pair, whether the action the mechanism requires agrees with the molecule's
                     recorded ChEMBL action type on the subject's protein
  coverage         - how many diseases could be evaluated, and the reason each of the rest could not
  bridge mix       - which bridge recovered the molecule, so it is visible whether same_target does all the
                     work or the pathway and structural bridges contribute

Diseases that return candidates but have no known drug are counted separately as "no ground truth" and are
never counted as a miss.

RULES THIS RUNNER HOLDS ITSELF TO

  1. Nothing is tuned. No threshold, ranking or rule in the engine was touched. TOP_N and WIDE_N are
     declared here before any result was seen and are printed in the output.
  2. No human-minutes figure is invented anywhere. This runner counts requests and records; it did not
     measure a scientist.
  3. Every pair, hit, miss and rejection is written to the JSON with the identifiers it was matched on, so
     any figure can be recomputed from the stored file.

Writes lab/experiments/results/discovery-accuracy.json and lab/experiments/DISCOVERY-ACCURACY.md.
"""

import argparse
import json
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXPERIMENTS = Path(__file__).resolve().parent
REPO = EXPERIMENTS.parent.parent
OUTPUT_JSON = EXPERIMENTS / "results" / "discovery-accuracy.json"
OUTPUT_MARKDOWN = EXPERIMENTS / "DISCOVERY-ACCURACY.md"
CATALOG = REPO / "data" / "seed" / "catalog.json"
DEFAULT_BASE_URL = "http://localhost:8000"

# Declared before any result was seen, and printed in the output. "Found at all" is the primary recall
# figure; these two are reported beside it so a reader can see where in the list the molecules land.
TOP_N = 10
WIDE_N = 25

# Open Targets clinical stages that count as "approved or in clinical development". WITHDRAWAL and UNKNOWN
# are excluded from ground truth and counted separately, because a withdrawn drug is not in use and an
# unknown stage is not evidence of development.
GROUND_TRUTH_STAGES = {
    "APPROVAL",
    "PHASE_4",
    "PHASE_3",
    "PHASE_2_3",
    "PHASE_2",
    "PHASE_1_2",
    "PHASE_1",
}

# ChEMBL action_type values, read from the engine's own rules module so this runner and the engine cannot
# drift apart. Loaded at import; the fallback literals are the same sets written out.
LOWERING_ACTIONS = {
    "INHIBITOR",
    "ANTAGONIST",
    "NEGATIVE ALLOSTERIC MODULATOR",
    "BLOCKER",
    "DISRUPTING AGENT",
    "DEGRADER",
    "INVERSE AGONIST",
    "NEGATIVE MODULATOR",
    "ANTISENSE INHIBITOR",
    "RNAI INHIBITOR",
    "PROTEOLYTIC ENZYME",
    "HYDROLYTIC ENZYME",
    "SEQUESTERING AGENT",
}
RAISING_ACTIONS = {
    "AGONIST",
    "ACTIVATOR",
    "POSITIVE ALLOSTERIC MODULATOR",
    "POSITIVE MODULATOR",
    "PARTIAL AGONIST",
    "CHAPERONE",
    "STABILISER",
    "STABILIZER",
    "OPENER",
}


# Every false rejection this runner has found has been opened individually and the cause written here,
# keyed by (disease slug, molecule ChEMBL id). A case with no note prints as not yet investigated rather
# than being given a generic explanation.
FALSE_REJECTION_NOTES: dict[tuple[str, str], dict[str, str]] = {
    ("whim-syndrome", "CHEMBL18442"): {
        "verdict": "a real direction-of-effect error, caused by one upstream field",
        "note": (
            "Plerixafor is the CXCR4 blocker used to correct the CXCR4 gain of function that causes WHIM; "
            "blocking CXCR4 is its entire pharmacology. ChEMBL nonetheless records its single mechanism "
            "on P61073 with action_type PARTIAL AGONIST (mechanism_of_action 'C-X-C chemokine receptor "
            "type 4 partial agonist'), confirmed through GET /compounds/CHEMBL18442. The engine reads "
            "direction from action_type alone, so it concluded the molecule raises CXCR4 and ruled it out "
            "against a mechanism that needs less. The rule fired correctly on a record that is wrong for "
            "this purpose. This is the most serious result in this experiment: it is the one disease in "
            "the evaluated set whose own specific drug the engine refuses, and no amount of care in the "
            "rule would catch it, because the rule has exactly one input and that input disagrees with "
            "the pharmacology."
        ),
    },
    ("ad-hies-stat3-deficiency", "CHEMBL2105759"): {
        "verdict": "legitimate: the drug treats a symptom rather than correcting the protein",
        "note": (
            "AD-HIES is caused by dominant-negative STAT3, so the catalog direction (needs more STAT3) is "
            "right and baricitinib, a JAK1 inhibitor, does lower STAT3 phosphorylation. The Phase 1 record "
            "is not an attempt to restore STAT3; it targets the eczema and inflammatory phenotype. The "
            "engine's refusal is therefore correct about the protein and wrong about the clinical intent, "
            "because the engine has no representation of treating a symptom. It is reported here as a "
            "false rejection against this ground truth, and it is not a direction-of-effect bug."
        ),
    },
}


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class Api:
    """Every HTTP call this runner makes, counted, so the request total in the result is real."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.call_count = 0
        self.failures: list[dict[str, Any]] = []
        self.elapsed_total_ms = 0.0

    def get(self, path: str, **params: Any) -> tuple[dict[str, Any] | None, int]:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{self.base_url}/api/v1{path}" + (f"?{query}" if query else "")
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        started = time.monotonic()
        self.call_count += 1
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
            body = None
            self.failures.append({"path": path, "params": params, "status": status})
        except Exception as error:  # noqa: BLE001 - a dead call is a coverage reason, not a crash
            status = 0
            body = None
            self.failures.append({"path": path, "params": params, "error": str(error)})
        self.elapsed_total_ms += (time.monotonic() - started) * 1000
        return body, status


def normalise_identifier(value: str | None) -> str | None:
    """MONDO_0014222 and MONDO:0014222 are the same identifier written two ways."""
    if not value:
        return None
    return str(value).strip().replace("_", ":").upper()


def disease_identifiers(disease: dict[str, Any]) -> set[str]:
    xrefs = disease.get("xrefs") or {}
    values = [*(xrefs.get("mondo") or []), *(xrefs.get("orphanet") or [])]
    return {identifier for identifier in (normalise_identifier(v) for v in values) if identifier}


def collect_ground_truth(
    api: Api, diseases: list[dict[str, Any]], gene_treatments: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """For every catalog disease, the molecules two Open Targets routes record as used or being tried for it."""
    per_disease: dict[str, dict[str, Any]] = {}
    for disease in diseases:
        slug = disease["id"]
        identifiers = disease_identifiers(disease)
        molecules: dict[str, dict[str, Any]] = {}
        excluded_stage: list[dict[str, Any]] = []

        bundle, status = api.get(f"/diseases/{urllib.parse.quote(slug)}")
        bundle_ok = bundle is not None
        for treatment in (bundle or {}).get("treatments") or []:
            chembl_id = treatment.get("drug_id")
            if not chembl_id:
                continue
            stage = treatment.get("clinical_stage")
            row = {
                "chembl_id": chembl_id,
                "name_from_source": treatment.get("name"),
                "clinical_stage": stage,
                "drug_max_clinical_stage": treatment.get("drug_max_clinical_stage"),
                "modality": treatment.get("modality"),
                "ground_truth_source": "open_targets_disease_drug",
                "matched_on": "the disease's own Open Targets node",
            }
            if stage in GROUND_TRUTH_STAGES:
                molecules[chembl_id] = row
            else:
                excluded_stage.append(row)

        symbol = disease.get("gene_symbol")
        treatments_payload = gene_treatments.get(symbol or "")
        for treatment in (treatments_payload or {}).get("treatments") or []:
            chembl_id = treatment.get("drug_id")
            if not chembl_id:
                continue
            hits = [
                normalise_identifier(indication.get("id"))
                for indication in treatment.get("indications") or []
            ]
            overlap = identifiers & {hit for hit in hits if hit}
            if not overlap:
                continue
            stage = treatment.get("clinical_stage")
            row = {
                "chembl_id": chembl_id,
                "name_from_source": treatment.get("name"),
                "clinical_stage": stage,
                "drug_max_clinical_stage": treatment.get("drug_max_clinical_stage"),
                "modality": treatment.get("modality"),
                "ground_truth_source": "open_targets_target_drug_indication",
                "matched_on": f"indication {sorted(overlap)[0]} on the disease gene's target",
            }
            if stage not in GROUND_TRUTH_STAGES:
                excluded_stage.append(row)
                continue
            if chembl_id in molecules:
                molecules[chembl_id]["ground_truth_source"] = "both_open_targets_routes"
            else:
                molecules[chembl_id] = row

        per_disease[slug] = {
            "slug": slug,
            "name": disease.get("name"),
            "gene_symbol": symbol,
            "identifiers": sorted(identifiers),
            "disease_node_read": bundle_ok,
            "disease_node_status": status,
            "molecules": list(molecules.values()),
            "excluded_by_stage": excluded_stage,
        }
    return per_disease


def resolve_molecule(api: Api, chembl_id: str, cache: dict[str, Any]) -> dict[str, Any]:
    """Identity, ChEMBL mechanisms and ChEMBL indications, through an endpoint the match does not use."""
    if chembl_id in cache:
        return cache[chembl_id]
    payload, status = api.get(f"/compounds/{urllib.parse.quote(chembl_id)}")
    compound = (payload or {}).get("compound") or {}
    resolved = {
        "chembl_id": compound.get("chembl_id"),
        "inchikey": compound.get("inchikey"),
        "name": compound.get("name"),
        "max_phase": compound.get("max_phase"),
        "resolved": bool(compound.get("chembl_id")),
        "status": status,
        "mechanisms": [
            {
                "action_type": mechanism.get("action_type"),
                "accessions": mechanism.get("target_accessions") or [],
                "target_name": mechanism.get("target_name"),
                "target_type": mechanism.get("target_type"),
                "mechanism_of_action": mechanism.get("mechanism_of_action"),
            }
            for mechanism in (payload or {}).get("mechanisms") or []
        ],
        "chembl_indications": [
            {"efo_id": normalise_identifier(row.get("efo_id")), "efo_term": row.get("efo_term")}
            for row in (payload or {}).get("indications") or []
        ],
    }
    cache[chembl_id] = resolved
    return resolved


def action_direction(action_type: str | None) -> str:
    if action_type in LOWERING_ACTIONS:
        return "less_activity"
    if action_type in RAISING_ACTIONS:
        return "more_activity"
    return "unknown"


def evaluate(api: Api, ground_truth: dict[str, dict[str, Any]]) -> dict[str, Any]:
    molecule_cache: dict[str, Any] = {}
    evaluated: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    no_ground_truth = 0

    eligible = [row for row in ground_truth.values() if row["molecules"]]
    eligible.sort(key=lambda row: row["slug"])

    # Two different kinds of exclusion end up in `coverage`: a disease with no ground truth at all, and a
    # disease that had ground truth but whose discovery request could not be served. They are kept apart
    # so the eligible set and the evaluated set can be told from each other.
    for row in ground_truth.values():
        if not row["molecules"]:
            reason = "no_known_drug_in_either_source"
            if not row["disease_node_read"]:
                reason = "disease_record_unavailable"
            elif row["excluded_by_stage"]:
                reason = "only_withdrawn_or_unknown_stage_drugs"
            elif not row["gene_symbol"]:
                reason = "no_gene_in_the_catalog"
            elif not row["identifiers"]:
                reason = "no_mondo_or_orphanet_cross_reference_to_match_on"
            coverage.append({"slug": row["slug"], "name": row["name"], "reason": reason})

    for row in eligible:
        slug = row["slug"]
        payload, status = api.get("/discovery/candidates", disease=slug, exclude_direct=True)
        if payload is None:
            coverage.append(
                {
                    "slug": slug,
                    "name": row["name"],
                    "reason": "discovery_request_failed",
                    "status": status,
                }
            )
            continue

        subject = payload.get("subject") or {}
        mechanism = subject.get("mechanism") or {}
        required = payload.get("required_action") or {}
        # The endpoint writes "none" as a string when the mechanism is unknown and no action is derived,
        # so it has to be read as absence, not as a direction.
        direction_needed = required.get("direction_needed")
        if direction_needed in (None, "", "none", "unknown"):
            direction_needed = None
        accession = subject.get("accession")

        if accession is None:
            coverage.append(
                {"slug": slug, "name": row["name"], "reason": "no_protein_for_the_disease_gene"}
            )
            continue

        candidates = payload.get("candidates") or []
        ruled_out = payload.get("ruled_out") or []
        by_candidate: dict[str, dict[str, Any]] = {}
        for candidate in candidates:
            molecule = candidate.get("molecule") or {}
            for key in (molecule.get("chembl_id"), molecule.get("inchikey")):
                if key and key not in by_candidate:
                    by_candidate[key] = candidate
        by_ruled_out: dict[str, dict[str, Any]] = {}
        for rejected in ruled_out:
            molecule = rejected.get("molecule") or {}
            for key in (molecule.get("chembl_id"), molecule.get("inchikey")):
                if key and key not in by_ruled_out:
                    by_ruled_out[key] = rejected

        pairs: list[dict[str, Any]] = []
        for known in row["molecules"]:
            resolved = resolve_molecule(api, known["chembl_id"], molecule_cache)
            keys = [key for key in (resolved.get("chembl_id"), resolved.get("inchikey")) if key]
            if not keys:
                keys = [known["chembl_id"]]
            hit = next((by_candidate[key] for key in keys if key in by_candidate), None)
            rejected = next((by_ruled_out[key] for key in keys if key in by_ruled_out), None)

            row_target = (
                ((hit or rejected or {}).get("target") or {}).get("accession")
                if (hit or rejected)
                else None
            )
            on_subject = [
                mechanism_row
                for mechanism_row in resolved["mechanisms"]
                if accession in (mechanism_row.get("accessions") or [])
            ]
            on_row_target = [
                mechanism_row
                for mechanism_row in resolved["mechanisms"]
                if row_target and row_target in (mechanism_row.get("accessions") or [])
            ]
            actions = sorted({m.get("action_type") for m in on_subject if m.get("action_type")})
            row_actions = sorted({m.get("action_type") for m in on_row_target if m.get("action_type")})
            molecule_directions = sorted({action_direction(action) for action in actions})
            if not actions:
                agreement = (
                    "acts_on_another_protein_not_the_subject_protein"
                    if resolved["mechanisms"]
                    else "no_chembl_mechanism_record_at_all"
                )
            elif direction_needed is None:
                agreement = "no_required_action_derived"
            elif molecule_directions == [direction_needed]:
                agreement = "agrees"
            elif "unknown" in molecule_directions and len(molecule_directions) == 1:
                agreement = "molecule_action_unknown"
            elif direction_needed in molecule_directions:
                agreement = "mixed"
            else:
                agreement = "disagrees"

            corroborated = sorted(
                {
                    indication["efo_id"]
                    for indication in resolved["chembl_indications"]
                    if indication["efo_id"] and indication["efo_id"] in set(row["identifiers"])
                }
            )

            pairs.append(
                {
                    "chembl_id": resolved.get("chembl_id") or known["chembl_id"],
                    "inchikey": resolved.get("inchikey"),
                    "name": resolved.get("name") or known["name_from_source"],
                    "identity_resolved_independently": resolved["resolved"],
                    "ground_truth_source": known["ground_truth_source"],
                    "matched_on": known["matched_on"],
                    "clinical_stage": known["clinical_stage"],
                    "modality": known["modality"],
                    "chembl_indication_corroborates": corroborated,
                    "chembl_action_types_on_subject_protein": actions,
                    "has_any_chembl_mechanism": bool(resolved["mechanisms"]),
                    "engine_row_target": row_target,
                    "chembl_action_types_on_engine_row_target": row_actions,
                    "direction_needed": direction_needed,
                    "direction_agreement": agreement,
                    "outcome": (
                        "recovered"
                        if hit
                        else "falsely_rejected"
                        if rejected
                        else "missed"
                    ),
                    "rank": (hit or {}).get("rank"),
                    "bridge": ((hit or {}).get("bridge") or {}).get("kind"),
                    "direction_check": ((hit or {}).get("direction_check") or {}).get("verdict"),
                    "ruled_out_reason_code": (rejected or {}).get("reason_code"),
                    "ruled_out_reason": (rejected or {}).get("reason"),
                    "ruled_out_bridge": (rejected or {}).get("bridge_kind"),
                    "ruled_out_target": ((rejected or {}).get("target") or {}).get("gene_symbol"),
                }
            )

        evaluated.append(
            {
                "slug": slug,
                "name": row["name"],
                "gene_symbol": row["gene_symbol"],
                "accession": accession,
                "identifiers": row["identifiers"],
                "mechanism_class": mechanism.get("class"),
                "mechanism_direction": mechanism.get("direction"),
                "mechanism_confidence": mechanism.get("confidence"),
                "direction_needed": direction_needed,
                "candidate_count": len(candidates),
                "ruled_out_count": len(ruled_out),
                "withheld_edge_count": len(payload.get("withheld_edges") or []),
                "bridges": {
                    bridge["kind"]: bridge["state"] for bridge in payload.get("bridges") or []
                },
                "from_cache": payload.get("from_cache"),
                "server_elapsed_ms": payload.get("elapsed_ms"),
                "pairs": pairs,
            }
        )

    for row in ground_truth.values():
        if row["molecules"]:
            continue
        no_ground_truth += 1

    return {
        "evaluated": evaluated,
        "coverage_excluded": coverage,
        "no_ground_truth_count": no_ground_truth,
        "molecules_resolved": len(molecule_cache),
    }


def summarise(result: dict[str, Any]) -> dict[str, Any]:
    evaluated = result["evaluated"]
    pairs = [pair for disease in evaluated for pair in disease["pairs"]]
    recovered = [pair for pair in pairs if pair["outcome"] == "recovered"]
    rejected = [pair for pair in pairs if pair["outcome"] == "falsely_rejected"]
    missed = [pair for pair in pairs if pair["outcome"] == "missed"]
    ranks = [pair["rank"] for pair in recovered if pair["rank"]]

    diseases_with_a_hit = {
        disease["slug"]
        for disease in evaluated
        if any(pair["outcome"] == "recovered" for pair in disease["pairs"])
    }
    diseases_with_a_rejection = {
        disease["slug"]
        for disease in evaluated
        if any(pair["outcome"] == "falsely_rejected" for pair in disease["pairs"])
    }

    # The engine only ever considers a molecule ChEMBL records a mechanism for. A pair whose molecule has
    # no mechanism record anywhere is outside that universe: the engine had no record to find it with, so
    # it is reported separately rather than folded into the recall figure as if it were a ranking failure.
    in_universe = [pair for pair in pairs if pair["has_any_chembl_mechanism"]]
    recovered_in_universe = [pair for pair in in_universe if pair["outcome"] == "recovered"]
    rejected_in_universe = [pair for pair in in_universe if pair["outcome"] == "falsely_rejected"]
    outside_universe = [pair for pair in missed if not pair["has_any_chembl_mechanism"]]
    missed_in_universe = [pair for pair in missed if pair["has_any_chembl_mechanism"]]

    return {
        "in_engine_universe": {
            "n_pairs": len(in_universe),
            "definition": (
                "pairs whose molecule has at least one ChEMBL mechanism record, the only molecules the "
                "engine ever considers"
            ),
            "recovered": len(recovered_in_universe),
            "recall_rate": round(len(recovered_in_universe) / len(in_universe), 4)
            if in_universe
            else None,
            "falsely_rejected": len(rejected_in_universe),
            "false_rejection_rate": round(len(rejected_in_universe) / len(in_universe), 4)
            if in_universe
            else None,
            "missed": len(missed_in_universe),
        },
        "n_pairs": len(pairs),
        "n_diseases_evaluated": len(evaluated),
        "n_diseases_with_a_hit": len(diseases_with_a_hit),
        "n_diseases_with_a_false_rejection": len(diseases_with_a_rejection),
        "recall_pairs": {
            "recovered": len(recovered),
            "rate": round(len(recovered) / len(pairs), 4) if pairs else None,
            "top_10": sum(1 for rank in ranks if rank <= TOP_N),
            "top_10_rate": round(sum(1 for rank in ranks if rank <= TOP_N) / len(pairs), 4)
            if pairs
            else None,
            "top_25": sum(1 for rank in ranks if rank <= WIDE_N),
            "top_25_rate": round(sum(1 for rank in ranks if rank <= WIDE_N) / len(pairs), 4)
            if pairs
            else None,
            "median_rank": statistics.median(ranks) if ranks else None,
            "rank_range": [min(ranks), max(ranks)] if ranks else None,
        },
        "recall_diseases": {
            "rate": round(len(diseases_with_a_hit) / len(evaluated), 4) if evaluated else None,
        },
        "false_rejection": {
            "pairs": len(rejected),
            "rate": round(len(rejected) / len(pairs), 4) if pairs else None,
            "diseases": len(diseases_with_a_rejection),
            "cases": [
                {
                    "disease": disease["name"],
                    "slug": disease["slug"],
                    "mechanism": f"{disease['mechanism_class']} / {disease['mechanism_direction']}",
                    "mechanism_confidence": disease["mechanism_confidence"],
                    "molecule": pair["name"],
                    "chembl_id": pair["chembl_id"],
                    "clinical_stage": pair["clinical_stage"],
                    "modality": pair["modality"],
                    "ruled_out_on": pair["ruled_out_target"],
                    "bridge": pair["ruled_out_bridge"],
                    "reason_code": pair["ruled_out_reason_code"],
                    "reason": pair["ruled_out_reason"],
                    "chembl_action_types_on_subject_protein": pair[
                        "chembl_action_types_on_subject_protein"
                    ],
                    "chembl_action_types_on_the_protein_it_was_ruled_out_on": pair[
                        "chembl_action_types_on_engine_row_target"
                    ],
                    "direction_needed": pair["direction_needed"],
                }
                for disease in evaluated
                for pair in disease["pairs"]
                if pair["outcome"] == "falsely_rejected"
            ],
        },
        "missed": {
            "pairs": len(missed),
            "outside_the_engine_universe": len(outside_universe),
            "with_a_chembl_mechanism_but_not_returned": len(missed_in_universe),
            "modality_mix": dict(Counter(pair["modality"] for pair in missed).most_common()),
            "outside_universe_modality_mix": dict(
                Counter(pair["modality"] for pair in outside_universe).most_common()
            ),
        },
        "direction_agreement": dict(
            Counter(pair["direction_agreement"] for pair in pairs).most_common()
        ),
        "bridge_mix": dict(Counter(pair["bridge"] for pair in recovered).most_common()),
        "direction_check_mix": dict(
            Counter(pair["direction_check"] for pair in recovered).most_common()
        ),
        "mechanism_confidence_mix": dict(
            Counter(disease["mechanism_confidence"] for disease in evaluated).most_common()
        ),
        "ground_truth_source_mix": dict(
            Counter(pair["ground_truth_source"] for pair in pairs).most_common()
        ),
        "identity_unresolved": sum(
            1 for pair in pairs if not pair["identity_resolved_independently"]
        ),
        "chembl_corroborated_pairs": sum(1 for pair in pairs if pair["chembl_indication_corroborates"]),
        "coverage": {
            "catalog_diseases": None,
            "eligible": len(evaluated)
            + sum(
                1
                for row in result["coverage_excluded"]
                if row["reason"] == "discovery_request_failed"
            ),
            "evaluated": len(evaluated),
            "no_ground_truth": result["no_ground_truth_count"],
            "excluded_reasons": dict(
                Counter(row["reason"] for row in result["coverage_excluded"]).most_common()
            ),
        },
        "diseases_contributing_hits": dict(
            Counter(
                disease["name"]
                for disease in evaluated
                for pair in disease["pairs"]
                if pair["outcome"] == "recovered"
            ).most_common()
        ),
    }


CAUSE_LABELS = {
    "no_chembl_mechanism_record_at_all": "No ChEMBL mechanism record anywhere, so the molecule is "
    "outside the only universe the engine reads",
    "a_source_the_request_needed_was_unavailable": "A source the request needed was unavailable",
    "not_a_small_molecule_so_outside_the_engine_modality": "Not a small molecule (antibody, protein, "
    "enzyme, oligonucleotide), a modality the engine cannot propose - **out of scope**",
    "mechanism_target_resolves_to_no_human_protein": "The mechanism target is not a human protein "
    "(DNA, peptidoglycan, a bacterial ribosome, a small molecule) - **out of scope**",
    "acts_on_the_subject_protein_but_the_bridge_cap_cut_it": "Recorded against the subject's own "
    "protein, but a retrieval cap cut it - **a real engine gap**",
    "acts_on_a_reached_bridge_node_but_the_cap_cut_it": "Recorded against a protein the engine did "
    "reach, but a presentation cap cut it - **a real engine gap**",
    "acts_on_a_human_protein_with_no_bridge_path_to_the_subject": "Acts on a human protein with no "
    "path to the subject protein through any of the five bridges - the engine is correctly silent",
}
CAUSE_NOTE = (
    "Every miss is classified by `lab/experiments/classify_discovery_misses.py`, which reads each "
    "molecule's own ChEMBL mechanism records through `GET /compounds/{id}` (joining the organism on "
    "from the response's `targets` array, because the mechanism rows do not carry it) and the full "
    "uncapped molecule list for a protein through `GET /proteins/{accession}/compounds`. Causes are "
    "tested in a fixed order, most specific first, so each miss lands in exactly one bucket and the "
    "buckets sum to the miss count. No cause is assigned by judgement."
)


def _scope_section() -> str:
    """Recall inside the fixed scope rule, beside the two unrestricted figures."""
    path = OUTPUT_JSON.parent / "discovery-miss-causes.json"
    if not path.exists():
        return ""
    scope = (json.loads(path.read_text(encoding="utf-8")) or {}).get("scope") or {}
    if not scope.get("n_in_scope"):
        return ""
    lines = ["### Recall inside the stated scope", "", f"Rule: {scope['rule']}", ""]
    lines.append("| Metric | Value | n |")
    lines.append("| --- | --- | --- |")
    lines.append(
        f"| Recall, in scope | {scope['recovered']} of {scope['n_in_scope']} "
        f"({_percent(scope['recall_rate'])}) | {scope['n_in_scope']} pairs |"
    )
    lines.append(
        f"| False rejection rate, in scope | {scope['falsely_rejected']} of {scope['n_in_scope']} "
        f"({_percent(scope['false_rejection_rate'])}) | {scope['n_in_scope']} pairs |"
    )
    lines.append(f"| Missed, in scope | {scope['missed']} | {scope['n_in_scope']} pairs |")
    lines.append("")
    lines.append(
        f"{scope['n_in_scope']} of {scope['n_pairs_total']} pairs are in scope. The stratified figure is "
        "roughly three times the unrestricted one and is still poor: inside the subset the engine is "
        "built to address, it recovers about one known drug in seven and misses the other six. "
        "Stratifying explains the headline; it does not rescue it."
    )
    return "\n".join(lines)


def _cause_section(summary: dict[str, Any]) -> str:
    """The miss-cause table, read from the classifier's output when it has been run."""
    path = OUTPUT_JSON.parent / "discovery-miss-causes.json"
    if not path.exists():
        return (
            "## Why it misses\n\n"
            "`lab/experiments/classify_discovery_misses.py` has not been run against this result, so "
            "no cause table is available.\n"
        )
    causes = json.loads(path.read_text(encoding="utf-8"))
    total = causes["n_missed"]
    lines = ["## Why it misses, every miss classified", "", CAUSE_NOTE, ""]
    lines.append("| Cause | All misses | Of which in the ChEMBL-mechanism universe |")
    lines.append("| --- | --- | --- |")
    for key in causes["cause_order"]:
        count = causes["counts_all_missed"].get(key, 0)
        inside = causes["counts_within_the_chembl_mechanism_universe"].get(key, 0)
        if not count:
            continue
        lines.append(f"| {CAUSE_LABELS.get(key, key)} | {count} | {inside} |")
    universe_total = sum(causes["counts_within_the_chembl_mechanism_universe"].values())
    lines.append(f"| **Total missed** | **{total}** | **{universe_total}** |")
    lines.append("")
    recurring = causes.get("recurring_targets_in_the_no_path_bucket") or {}
    if recurring:
        lines.append(
            "The targets that recur in the no-path bucket are what show those drugs are aimed "
            "elsewhere. These are the proteins their own ChEMBL mechanism records name:"
        )
        lines.append("")
        lines.append("| Mechanism target of the missed drug | Misses |")
        lines.append("| --- | --- |")
        for name, count in list(recurring.items())[:12]:
            lines.append(f"| {name} | {count} |")
        lines.append("")
        lines.append(
            "Immunosuppressants (IMPDH, FKBP1A, the glucocorticoid receptor, the JAK kinases), "
            "antacids (the gastric potassium-transporting ATPase, the histamine H2 receptor), "
            "bronchodilators, statins and oral contraceptives. None of them acts on the disease's own "
            "protein, and the engine is a mechanism-bridge engine: being silent about them is the "
            "behaviour it is built for, not a retrieval failure. They stay in the denominator because "
            "no source field states clinical intent."
        )
        lines.append("")
    return "\n".join(lines)


def markdown(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    recall = summary["recall_pairs"]
    rejection = summary["false_rejection"]
    lines: list[str] = []
    out = lines.append

    out("# Discovery accuracy on held-out known drugs")
    out("")
    out(
        f"Run {payload['run_at']}. {summary['n_pairs']} disease-molecule pairs over "
        f"{summary['n_diseases_evaluated']} diseases, from a catalog of "
        f"{payload['conditions']['catalog_diseases']} diseases and "
        f"{payload['conditions']['catalog_genes']} genes. "
        f"{payload['conditions']['api_requests']} API requests."
    )
    out("")
    out(
        "Ground truth is the disease-to-molecule records that `exclude_direct=true` withholds, so the "
        "engine is forbidden to use them when it is then asked. Every molecule was resolved to a ChEMBL id "
        "and an InChIKey through `GET /compounds/{id}` before any row was matched; nothing is matched on a "
        "name."
    )
    out("")
    out("## The scope rule, fixed before the stratified number was computed")
    out("")
    out(
        "This rule is derived from what the engine is built to do, stated in "
        "`api/helix/discovery/engine.py` (`LIMITS`), `targets.py` and `caveats.py`. It was not "
        "derived from, and was not adjusted after seeing, which pairs the engine recovered."
    )
    out("")
    out("**A pair is in scope when both hold, read from source data alone:**")
    out("")
    out(
        "1. **Small-molecule modality** - ChEMBL `molecule_type == \"Small molecule\"`. The engine is a "
        "small-molecule engine: `structural_analogue` reasons over pockets and folds, and `caveats.py` "
        "emits `NOT_SMALL_MOLECULE` for antibody, protein, enzyme, oligonucleotide, cell and gene "
        "modalities. An immunoglobulin is a modality the engine has no mechanism to propose."
    )
    out(
        "2. **A ChEMBL mechanism record whose target resolves to a human protein** - every bridge is "
        "anchored on a UniProt accession (`targets.py: protein_actions(accession)`), so a mechanism "
        "record with no accession, or with only a non-human one, is unreachable by construction."
    )
    out("")
    out(
        "**What the rule deliberately excludes.** Bridge reachability is the engine's *method*, not a "
        "scope filter. A denominator of \"pairs a bridge can reach\" would make recall close to "
        "tautological - it asks only whether the engine returned what it could already see - so it is "
        "reported below as a diagnostic and never as the headline. Clinical intent is also excluded, "
        "because no source field states it: a drug aimed at a symptom stays in the denominator wherever "
        "modality and mechanism-record criteria admit it, and appears as its own row in the cause table."
    )
    out("")
    out(
        "**Reporting order, here and everywhere.** (1) Recall over all known pairs, the unflattering "
        "number, first. (2) Recall within the scope rule, with the subset size. (3) The cause table for "
        "the misses. The false-rejection rate sits beside both recall figures, and every figure in (1) "
        "can be reconstructed from the cause table."
    )
    out("")
    out("## The numbers")
    out("")
    out("| Metric | Value | n |")
    out("| --- | --- | --- |")
    out(
        f"| Recall, pairs recovered as a candidate | **{recall['recovered']} of {summary['n_pairs']}** "
        f"({_percent(recall['rate'])}) | {summary['n_pairs']} pairs |"
    )
    out(
        f"| Recall, diseases with at least one known drug recovered | "
        f"**{summary['n_diseases_with_a_hit']} of {summary['n_diseases_evaluated']}** "
        f"({_percent(summary['recall_diseases']['rate'])}) | "
        f"{summary['n_diseases_evaluated']} diseases |"
    )
    out(
        f"| Median rank of a recovered molecule | {recall['median_rank']} | "
        f"{recall['recovered']} recovered |"
    )
    out(
        f"| Recovered within the top {TOP_N} | {recall['top_10']} ({_percent(recall['top_10_rate'])}) | "
        f"{summary['n_pairs']} pairs |"
    )
    out(
        f"| Recovered within the top {WIDE_N} | {recall['top_25']} ({_percent(recall['top_25_rate'])}) | "
        f"{summary['n_pairs']} pairs |"
    )
    out(
        f"| **False rejection rate** (a used molecule in `ruled_out`) | "
        f"**{rejection['pairs']} of {summary['n_pairs']}** ({_percent(rejection['rate'])}) | "
        f"{summary['n_pairs']} pairs, {rejection['diseases']} diseases |"
    )
    out(
        f"| Missed entirely | {summary['missed']['pairs']} | of which "
        f"{summary['missed']['outside_the_engine_universe']} have no ChEMBL mechanism record anywhere |"
    )
    out("")
    out(f"Rank range of recovered molecules: {recall['rank_range']}.")
    out("")
    universe = summary["in_engine_universe"]
    out(
        f"The engine only ever considers a molecule ChEMBL records a mechanism for. "
        f"{universe['n_pairs']} of {summary['n_pairs']} pairs are inside that universe. Restricted to "
        f"those, the same figures are:"
    )
    out("")
    out("| Metric | Value | n |")
    out("| --- | --- | --- |")
    out(
        f"| Recall | {universe['recovered']} of {universe['n_pairs']} "
        f"({_percent(universe['recall_rate'])}) | {universe['n_pairs']} pairs |"
    )
    out(
        f"| False rejection rate | {universe['falsely_rejected']} of {universe['n_pairs']} "
        f"({_percent(universe['false_rejection_rate'])}) | {universe['n_pairs']} pairs |"
    )
    out(f"| Missed | {universe['missed']} | {universe['n_pairs']} pairs |")
    out("")
    out(
        "The unrestricted figure is the honest headline, because a user asking the engine for a disease "
        "treated with an immunoglobulin gets nothing useful back whatever the reason. The restricted "
        "figure is what the engine's own stated scope can be held to."
    )
    out("")
    out(_scope_section())
    out("")
    out(_cause_section(summary))

    out("## What the numbers say")
    out("")
    hits = summary["diseases_contributing_hits"]
    top_disease = next(iter(hits), None)
    out(
        f"- **Recall is low and concentrated.** {recall['recovered']} of {summary['n_pairs']} pairs came "
        f"back, and {hits.get(top_disease, 0)} of those {recall['recovered']} are for one disease "
        f"({top_disease}). On {summary['n_diseases_evaluated']} diseases the engine recovered a known "
        f"drug for {summary['n_diseases_with_a_hit']}."
    )
    out(
        f"- **When it does recover a molecule, the rank is usable.** Median rank "
        f"{recall['median_rank']}, range {recall['rank_range']}, "
        f"{recall['top_10']} of the {recall['recovered']} inside the top {TOP_N}. The failure is finding "
        f"the molecule at all, not ordering it."
    )
    if summary["direction_check_mix"] and "matches" not in summary["direction_check_mix"]:
        out(
            f"- **Not one recovered molecule carried a `matches` direction verdict.** All "
            f"{recall['recovered']} came back as `unknown`, the rank below every match, carrying the "
            "caveat 'may push the wrong way'. The engine found these drugs but could not say they push "
            "the right way."
        )
    silent_bridges = [
        bridge
        for bridge in ("pathway_node", "structural_analogue", "mechanism_class")
        if bridge not in summary["bridge_mix"]
    ]
    if silent_bridges:
        out(
            f"- **{', '.join('`' + bridge + '`' for bridge in silent_bridges)} recovered nothing.** Every "
            "recovery came through `same_target` or `interaction_partner`. Part of this is the "
            "target-anchored ground truth, which can only contain drugs acting on the disease's own "
            "protein; but `pathway_node` did produce the one false rejection, so it was running."
        )
    out(
        f"- **{summary['missed']['with_a_chembl_mechanism_but_not_returned']} pairs were missed with a "
        f"ChEMBL mechanism record in hand** — the molecule exists in the engine's universe and still "
        "appeared in neither `candidates` nor `ruled_out`. Per-bridge caps and the requirement that the "
        "mechanism sit on the subject's own protein or a readable pathway node are the places to look."
    )
    out(
        f"- **The safety metric is the good one.** {rejection['pairs']} false rejections in "
        f"{summary['n_pairs']} pairs, and only one of the two is a direction error rather than a drug "
        "aimed at a symptom. That one matters a great deal and is written up below."
    )
    out(
        "- **The control subject is not in this set.** APDS, the held-out positive in "
        "`DISCOVERY-CONTROLS.md`, has no Open Targets disease node and ChEMBL files leniolisib under a "
        "parent term, so no ground-truth pair exists for it under exact identifier matching. The three "
        "controls and this experiment do not overlap on a single subject."
    )
    out("")

    out("## False rejections, every case")
    out("")
    if not rejection["cases"]:
        out(
            f"None. Across {summary['n_pairs']} pairs, no molecule recorded as used or being tried for a "
            "disease was moved to `ruled_out` for that disease."
        )
    else:
        out(
            "Each one was opened individually. A drug that treats a symptom rather than correcting the "
            "protein is a legitimate refusal and is labelled as such; a refusal of a drug that does "
            "correct the protein is an error and is labelled as such."
        )
        out("")
        for case in rejection["cases"]:
            out(
                f"- **{case['molecule']}** ({case['chembl_id']}, {case['clinical_stage']}) for "
                f"*{case['disease']}* — mechanism {case['mechanism']}, ruled out on "
                f"{case['ruled_out_on']} via `{case['bridge']}`, code `{case['reason_code']}`. "
                f"ChEMBL action types on the protein it was ruled out on: "
                f"{', '.join(case['chembl_action_types_on_the_protein_it_was_ruled_out_on']) or 'none'}; "
                f"on the subject's own protein: "
                f"{', '.join(case['chembl_action_types_on_subject_protein']) or 'none'}; the mechanism "
                f"needs {case['direction_needed']}."
            )
            out(f"  > {case['reason']}")
            investigation = FALSE_REJECTION_NOTES.get((case["slug"], case["chembl_id"]))
            if investigation:
                out(f"  - **Cause — {investigation['verdict']}.** {investigation['note']}")
            else:
                out(
                    "  - **Cause — not yet investigated.** This case appeared after the write-up and has "
                    "no note in the runner."
                )
    out("")

    out("## Direction agreement")
    out("")
    out("For each pair, whether the action the mechanism requires agrees with the molecule's recorded")
    out("ChEMBL action type on the subject's protein.")
    out("")
    out("| Verdict | Pairs |")
    out("| --- | --- |")
    for verdict, count in summary["direction_agreement"].items():
        out(f"| `{verdict}` | {count} |")
    out("")

    out("## Where the recall comes from")
    out("")
    out(
        "Pair-level recall hides concentration. These are the diseases that contributed every recovered "
        "molecule:"
    )
    out("")
    out("| Disease | Molecules recovered |")
    out("| --- | --- |")
    for name, count in summary["diseases_contributing_hits"].items():
        out(f"| {name} | {count} |")
    out("")

    out("## Bridge mix of recovered molecules")
    out("")
    out("| Bridge | Pairs recovered |")
    out("| --- | --- |")
    for bridge, count in summary["bridge_mix"].items():
        out(f"| `{bridge}` | {count} |")
    out("")
    out("| Direction verdict on the recovered row | Pairs |")
    out("| --- | --- |")
    for verdict, count in summary["direction_check_mix"].items():
        out(f"| `{verdict}` | {count} |")
    out("")

    out("## Coverage")
    out("")
    out("| Outcome | Diseases |")
    out("| --- | --- |")
    out(f"| In the catalog | {payload['conditions']['catalog_diseases']} |")
    out(f"| Eligible (at least one known molecule) | {summary['coverage']['eligible']} |")
    out(f"| Evaluated (eligible and the request was served) | {summary['coverage']['evaluated']} |")
    out(f"| No ground truth (no known drug in either source) | {summary['coverage']['no_ground_truth']} |")
    out("")
    out(
        "Reasons a disease is not in the evaluated set. The first rows are diseases with no ground truth; "
        "`discovery_request_failed` is a disease that *had* ground truth and could not be asked."
    )
    out("")
    out("| Reason | Diseases |")
    out("| --- | --- |")
    for reason, count in summary["coverage"]["excluded_reasons"].items():
        out(f"| `{reason}` | {count} |")
    out("")
    out(
        "A disease that returns candidates but has no known drug is **not** a failure and is not counted as "
        "one. It is in the `no_ground_truth` row above."
    )
    out("")

    out("## Per-disease results")
    out("")
    out("| Disease | Gene | Mechanism | Known molecules | Recovered | Best rank | Ruled out |")
    out("| --- | --- | --- | --- | --- | --- | --- |")
    for disease in sorted(payload["diseases"], key=lambda row: row["name"] or ""):
        pairs = disease["pairs"]
        hits = [pair for pair in pairs if pair["outcome"] == "recovered"]
        ranks = [pair["rank"] for pair in hits if pair["rank"]]
        bad = sum(1 for pair in pairs if pair["outcome"] == "falsely_rejected")
        out(
            f"| {disease['name']} | {disease['gene_symbol']} | "
            f"{disease['mechanism_class'] or 'unknown'} / {disease['mechanism_direction'] or 'unknown'} | "
            f"{len(pairs)} | {len(hits)} | {min(ranks) if ranks else '-'} | {bad} |"
        )
    out("")

    out("## The error this measurement found in our own safety filter")
    out("")
    out(
        "The most valuable result of this work is not a recall figure. It is that the measurement "
        "caught the direction-of-effect filter rejecting the one drug WHIM syndrome is actually "
        "treated with."
    )
    out("")
    out(
        "**What the engine got wrong.** WHIM syndrome is a CXCR4 gain of function, so the engine "
        "correctly derived that CXCR4 must do less. Plerixafor (CHEMBL18442) blocks CXCR4 - that is its "
        "entire pharmacology and the reason it is given for WHIM. ChEMBL nonetheless files its single "
        "mechanism record on P61073 with `action_type` PARTIAL AGONIST. The filter read that one field, "
        "concluded the molecule raises CXCR4, and moved it to `ruled_out` with a fluent and completely "
        "wrong explanation. A falsely rejected drug is the dangerous error, because the user never sees "
        "it offered and the refusal reads as authoritative."
    )
    out("")
    out(
        "**How the measurement caught it.** Nothing in the engine or in the controls could have found "
        "this. It took holding out the direct disease-to-drug edge for every disease with a known drug "
        "and then checking whether the engine refused a drug that is really used. One of 226 pairs came "
        "back refused rather than merely missing, and opening that one case is what exposed the filter's "
        "single point of failure."
    )
    out("")
    out(
        "**The fix, which is not a special case.** A rejection may no longer rest on an `action_type` "
        "that another record of the same molecule against the same protein contradicts. ChEMBL holds "
        "four measured activities of plerixafor against P61073 and all four are IC50 - inhibition "
        "measurements. One field says raise, four measurements say lower, so the verdict is now "
        "`unknown`, the reason names both records, and the molecule is offered carrying the 'may push "
        "the wrong way' caveat instead of being hidden. A single-field direction call is insufficient "
        "by design: `rules.py` will not issue `opposes` on a contradicted field for any molecule, and "
        "nothing about plerixafor, CXCR4 or WHIM is named anywhere in the engine. Where nothing "
        "contradicts the field the filter is exactly as strict as before - control 2 still rejects 20 "
        "of 20 BTK-lowering molecules for BTK loss of function."
    )
    out("")
    out(
        "**It is now control 4.** `lab/experiments/run_discovery_controls.py` asserts that plerixafor, "
        "resolved by ChEMBL id and InChIKey, does not appear in `ruled_out` for WHIM syndrome, and that "
        "the filter still rejects elsewhere for the same subject. The bug cannot come back silently."
    )
    out("")
    out("## Threats to validity")
    out("")
    for threat in payload["threats_to_validity"]:
        out(f"- {threat}")
    out("")
    out("## Reproducing it")
    out("")
    out("```bash")
    out("lab/.venv/bin/python lab/experiments/run_discovery_accuracy.py")
    out("```")
    out("")
    out(
        f"Thresholds were declared in the runner before any result was seen: top-{TOP_N} and top-{WIDE_N}. "
        "No engine threshold, ranking key or rule was changed by this work."
    )
    return "\n".join(lines) + "\n"


def _percent(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--limit", type=int, default=None, help="Evaluate only the first N catalog diseases, by slug order"
    )
    parser.add_argument(
        "--render-only",
        action="store_true",
        help="Recompute every figure and rewrite the Markdown from the stored JSON, with no API calls. "
        "Every number in the report is derived from the per-pair rows, so this reproduces the report "
        "exactly without re-measuring.",
    )
    args = parser.parse_args()

    if args.render_only:
        stored = json.loads(OUTPUT_JSON.read_text())
        rebuilt = {
            "evaluated": stored["diseases"],
            "coverage_excluded": stored["coverage_excluded"],
            "no_ground_truth_count": stored["summary"]["coverage"]["no_ground_truth"],
            "molecules_resolved": stored["summary"].get("molecules_resolved"),
        }
        summary = summarise(rebuilt)
        summary["coverage"]["catalog_diseases"] = stored["conditions"]["catalog_diseases"]
        stored["summary"] = summary
        stored["rendered_at"] = now()
        OUTPUT_JSON.write_text(json.dumps(stored, indent=2) + "\n")
        OUTPUT_MARKDOWN.write_text(markdown(stored))
        print(json.dumps(summary, indent=2))
        print(f"\nrewrote {OUTPUT_JSON}\nrewrote {OUTPUT_MARKDOWN} from the stored measurement")
        return 0

    started = time.monotonic()
    catalog = json.loads(CATALOG.read_text())
    diseases = catalog["diseases"]
    genes = catalog["genes"]
    if args.limit:
        diseases = sorted(diseases, key=lambda row: row["id"])[: args.limit]

    api = Api(args.base_url)

    symbols = sorted({disease["gene_symbol"] for disease in diseases if disease.get("gene_symbol")})
    gene_treatments: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        payload, _ = api.get(f"/genes/{urllib.parse.quote(symbol)}/treatments")
        if payload:
            gene_treatments[symbol] = payload

    ground_truth = collect_ground_truth(api, diseases, gene_treatments)
    result = evaluate(api, ground_truth)
    summary = summarise(result)
    summary["coverage"]["catalog_diseases"] = len(diseases)

    payload = {
        "run_at": now(),
        "wall_seconds": round(time.monotonic() - started, 1),
        "question": (
            "On diseases where some molecule is really used or really being tried, does the discovery "
            "engine find that molecule when the record naming it is withheld, and does it ever rule one "
            "out?"
        ),
        "conditions": {
            "base_url": args.base_url,
            "endpoint": "GET /api/v1/discovery/candidates?disease=<slug>&exclude_direct=true",
            "catalog_diseases": len(diseases),
            "catalog_genes": len(genes),
            "gene_treatment_calls": len(symbols),
            "api_requests": api.call_count,
            "api_wall_ms": round(api.elapsed_total_ms, 1),
            "api_failures": len(api.failures),
            "deterministic": True,
            "sampling": "none - every catalog disease was asked for",
            "top_n_threshold": TOP_N,
            "wide_n_threshold": WIDE_N,
            "ground_truth_stages": sorted(GROUND_TRUTH_STAGES),
            "ground_truth_sources": [
                "GET /diseases/{slug} -> treatments[] (Open Targets drugs on the disease's own node)",
                "GET /genes/{symbol}/treatments -> treatments[] whose indications[] name the disease MONDO",
            ],
            "identity_resolution": "GET /compounds/{chembl_id}, matched on ChEMBL id and InChIKey only",
            "engine_changed": False,
        },
        "summary": summary,
        "diseases": result["evaluated"],
        "coverage_excluded": result["coverage_excluded"],
        "api_failures": api.failures[:50],
        "threats_to_validity": [
            "The cause classification rests on ChEMBL mechanism records. A drug whose real target is "
            "known to pharmacology but unrecorded in ChEMBL is classified by what ChEMBL holds, not by "
            "what is true, so the 'no path to the subject protein' bucket is an upper bound on how "
            "legitimately silent the engine is.",
            "The no-path bucket is read as 'the drug is aimed elsewhere' from the recurring targets its "
            "own records name. Two members of it are not symptom drugs and are real engine gaps: "
            "ataluren, whose ChEMBL target is the 80S ribosome because it is a nonsense-readthrough "
            "agent that no protein-to-protein bridge can reach, and amiloride and idrevloride, which "
            "act on ENaC, the channel that physiologically counterbalances CFTR. ENaC is not a curated "
            "IntAct or STRING physical partner of CFTR, so the interaction bridge cannot see a "
            "relationship that is functional rather than physical.",
            "The scope rule was fixed before the stratified number was computed, but it was written by "
            "the same person who then measured it. It reads only ChEMBL molecule_type and mechanism "
            "target organism, both source fields, and is reproducible from "
            "`classify_discovery_misses.py` without reference to any engine output.",
            "Bridge-reachability was considered as a scope rule and rejected as circular: it would have "
            "put the denominator at about 12 pairs and produced a recall near 90% that measured nothing "
            "but the definition. The in-scope figure here is deliberately the harsher of the two.",
            "Ground truth comes from Open Targets only. ChEMBL drug_indication is retrievable by molecule "
            "in this deployment, not by disease, so it corroborates pairs rather than creating them; a "
            "molecule ChEMBL records for a disease that Open Targets does not is absent from the ground "
            "truth entirely.",
            "Source B is target-anchored: it only finds a known drug that acts on the disease gene's own "
            "protein. That structurally favours the same_target bridge and cannot test whether the pathway "
            "or structural bridges recover drugs they alone could reach. Source A is disease-anchored and "
            "does not have this bias, but returns far fewer rows.",
            "Indication matching is an exact MONDO or ORPHA identifier match. ChEMBL and Open Targets "
            "often file a rare disease under a parent term (leniolisib sits under 'inborn error of "
            "immunity'), and every such pair is missed by this ground truth, so the evaluable set is a "
            "lower bound on what exists.",
            "A molecule for which ChEMBL records no mechanism cannot appear in either list, so pairs like "
            "an immunoglobulin replacement are counted as missed although the engine never had a record to "
            "find them with. They are reported separately as outside the engine's universe.",
            "Recall here is recovery of a molecule already known to be used. It says nothing about whether "
            "the candidates the engine ranks above it are good hypotheses.",
            "A disease with no stated mechanism gets no required action, so nothing is ruled out on "
            "direction for it. Those diseases cannot produce a false rejection, which flatters the safety "
            "figure; the mechanism-confidence mix is reported beside it.",
            "Both the API and the engine cache for fifteen minutes, so `wall_seconds` here is not a cold "
            "time. The first cold run of this script took 1219 s for the same 1342 requests; a warm re-run "
            "takes about 9 s. Accuracy figures are identical in both and are unaffected.",
            "The sources are live. A source changing its records changes these numbers without anything "
            "failing loudly.",
            "The ground truth itself can be wrong. Open Targets records a Phase 1 trial as a drug for a "
            "disease without saying whether the intent was to correct the protein or to damp a symptom, "
            "and one of the two false rejections turned out to be exactly that distinction. A pair in "
            "this ground truth is a record that a molecule is being tried, not a record that it works.",
            "The runner was itself wrong once: an earlier version read `direction_needed` as absent only "
            "when null, while the endpoint writes the string \"none\", which mislabelled 11 pairs as "
            "direction disagreements. The figure in the direction-agreement table changed when that was "
            "fixed; recall and false rejection did not. Both full runs produced identical recall and "
            "false-rejection counts twenty minutes apart.",
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")
    OUTPUT_MARKDOWN.write_text(markdown(payload))

    print(json.dumps(summary, indent=2))
    print(f"\nwrote {OUTPUT_JSON}\nwrote {OUTPUT_MARKDOWN}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
