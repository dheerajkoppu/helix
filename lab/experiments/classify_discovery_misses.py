"""Classify every miss in discovery-accuracy.json by cause, from source records only.

Reads the pairs the accuracy run recorded as missed and asks, for each one, why the engine never
produced a row for it. Every answer comes from a source call, not from a judgement written here:

- the molecule's own ChEMBL mechanism records, through GET /compounds/{chembl_id}, which give the
  target, the target type and the target's UniProt accessions;
- the full set of molecules ChEMBL records against a protein, through
  GET /proteins/{accession}/compounds, which is what tells a truncated list apart from an absent
  path: if a missed molecule is in that set for the subject's own protein, the engine could have
  reached it and a cap removed it;
- the accessions the engine actually produced rows on, read back from the discovery response, which
  are the bridge nodes that yielded anything.

The causes are assigned in a fixed order, most specific first, so each miss lands in exactly one
bucket and the buckets sum to the miss count.

    lab/.venv/bin/python lab/experiments/classify_discovery_misses.py
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

EXPERIMENTS = Path(__file__).resolve().parent
RESULTS = EXPERIMENTS / "results"
ACCURACY_JSON = RESULTS / "discovery-accuracy.json"
OUTPUT_JSON = RESULTS / "discovery-miss-causes.json"
BASE_URL = "http://localhost:8000/api/v1"

# Causes, in the order they are tested. The first one that is true is the cause recorded.
CAUSE_ORDER = [
    "no_chembl_mechanism_record_at_all",
    "a_source_the_request_needed_was_unavailable",
    "not_a_small_molecule_so_outside_the_engine_modality",
    "mechanism_target_resolves_to_no_human_protein",
    "acts_on_the_subject_protein_but_the_bridge_cap_cut_it",
    "acts_on_a_reached_bridge_node_but_the_cap_cut_it",
    "acts_on_a_human_protein_with_no_bridge_path_to_the_subject",
]


class Api:
    def __init__(self, base_url: str = BASE_URL) -> None:
        self.base_url = base_url
        self.calls = 0
        self.cache: dict[str, Any] = {}

    def get(self, path: str, **params: Any) -> tuple[Any, int]:
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        url = f"{self.base_url}{path}{query}"
        if url in self.cache:
            return self.cache[url]
        self.calls += 1
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode("utf-8"))
                result = (body, response.status)
        except urllib.error.HTTPError as error:
            result = (json.loads(error.read().decode("utf-8") or "{}"), error.code)
        except Exception as error:  # noqa: BLE001 - a dead call is data about the run
            result = ({"error": str(error)}, 0)
        self.cache[url] = result
        return result


def mechanism_records(api: Api, chembl_id: str) -> list[dict[str, Any]]:
    """Mechanism rows with the organism joined on from the response's own target records.

    The mechanism rows carry no organism, so a bacterial penicillin-binding protein and a human
    kinase look alike on them. The `targets` array of the same response carries it, keyed by the
    same target_chembl_id, so the organism is read from there rather than inferred from a name.
    """
    body, status = api.get(f"/compounds/{urllib.parse.quote(chembl_id)}")
    if status != 200:
        return []
    organisms = {
        str(target.get("chembl_id")): target.get("organism")
        for target in (body or {}).get("targets") or []
    }
    rows = []
    for row in (body or {}).get("mechanisms") or []:
        joined = dict(row)
        joined["target_organism"] = row.get("target_organism") or organisms.get(
            str(row.get("target_chembl_id"))
        )
        rows.append(joined)
    return rows


def molecules_on_protein(api: Api, accession: str) -> set[str]:
    """Every ChEMBL id with a recorded mechanism against one protein, uncapped by any bridge."""
    body, status = api.get(f"/proteins/{urllib.parse.quote(accession)}/compounds")
    if status != 200:
        return set()
    found: set[str] = set()
    for compound in (body or {}).get("compounds") or []:
        if compound.get("action_types") and compound.get("chembl_id"):
            found.add(str(compound["chembl_id"]))
    for target in (body or {}).get("targets") or []:
        for row in target.get("mechanisms") or []:
            if row.get("molecule_chembl_id"):
                found.add(str(row["molecule_chembl_id"]))
    return found


HUMAN_PREFIXES = ("P", "Q", "O", "A", "B")


def human_accessions(records: list[dict[str, Any]]) -> set[str]:
    """Accessions from mechanism records whose target ChEMBL calls human."""
    found: set[str] = set()
    for row in records:
        organism = (row.get("target_organism") or "").strip()
        # No stated organism is not evidence of a human target, so it does not count as one
        if organism != "Homo sapiens":
            continue
        for accession in row.get("target_accessions") or []:
            found.add(str(accession).upper())
    return found


def main() -> int:
    api = Api()
    started = time.monotonic()
    document = json.loads(ACCURACY_JSON.read_text(encoding="utf-8"))

    rows: list[dict[str, Any]] = []
    scope_rows: list[dict[str, Any]] = []
    for disease in document.get("diseases") or []:
        slug = disease["slug"]
        accession = str(disease.get("accession") or "").upper()
        bridges = disease.get("bridges") or {}
        failed_bridges = [kind for kind, state in bridges.items() if state in ("failed", "partial")]

        # The accessions the engine produced rows on for this disease: the bridge nodes that
        # yielded anything. Read back from the live response, not guessed.
        response, status = api.get("/discovery/candidates", disease=slug, exclude_direct="true")
        reached: dict[str, set[str]] = {}
        if status == 200:
            for key in ("candidates", "ruled_out"):
                for row in response.get(key) or []:
                    node = str((row.get("target") or {}).get("accession") or "").upper()
                    molecule = str((row.get("molecule") or {}).get("chembl_id") or "")
                    if node:
                        reached.setdefault(node, set()).add(molecule)

        # Every pair, not only the missed ones, is scored against the scope rule: small-molecule
        # modality and a mechanism record whose target resolves to a human protein. The rule is
        # fixed in DISCOVERY-ACCURACY.md and reads source fields only.
        for pair in disease.get("pairs") or []:
            records_all = (
                mechanism_records(api, str(pair["chembl_id"]))
                if pair.get("has_any_chembl_mechanism")
                else []
            )
            in_scope = bool(
                pair.get("modality") == "Small molecule" and human_accessions(records_all)
            )
            scope_rows.append(
                {
                    "chembl_id": str(pair["chembl_id"]),
                    "name": pair.get("name"),
                    "disease": disease["name"],
                    "modality": pair.get("modality"),
                    "in_scope": in_scope,
                    "outcome": pair.get("outcome"),
                    "rank": pair.get("rank"),
                }
            )
            if pair.get("outcome") != "missed":
                continue
            chembl_id = str(pair["chembl_id"])
            modality = pair.get("modality")
            records = mechanism_records(api, chembl_id) if pair.get("has_any_chembl_mechanism") else []
            targets = human_accessions(records)

            cause: str
            note = ""
            if not pair.get("has_any_chembl_mechanism"):
                cause = "no_chembl_mechanism_record_at_all"
            elif failed_bridges and not records:
                cause = "a_source_the_request_needed_was_unavailable"
                note = f"bridges not ok: {', '.join(failed_bridges)}"
            elif modality != "Small molecule":
                cause = "not_a_small_molecule_so_outside_the_engine_modality"
                note = f"ChEMBL molecule_type {modality!r}"
            elif not targets:
                cause = "mechanism_target_resolves_to_no_human_protein"
                note = "; ".join(
                    f"{row.get('target_name')} ({row.get('target_type')}, "
                    f"{row.get('target_organism') or 'organism not stated'})"
                    for row in records[:3]
                )
            elif accession in targets and chembl_id in molecules_on_protein(api, accession):
                cause = "acts_on_the_subject_protein_but_the_bridge_cap_cut_it"
                note = f"recorded against the subject protein {accession}"
            else:
                node = next(
                    (
                        candidate
                        for candidate in targets
                        if candidate in reached and chembl_id not in reached[candidate]
                    ),
                    None,
                )
                if node is not None:
                    cause = "acts_on_a_reached_bridge_node_but_the_cap_cut_it"
                    note = f"the engine produced rows on {node} but not this molecule"
                else:
                    cause = "acts_on_a_human_protein_with_no_bridge_path_to_the_subject"
                    note = "mechanism targets: " + ", ".join(sorted(targets)[:6])

            rows.append(
                {
                    "disease": disease["name"],
                    "slug": slug,
                    "subject_accession": accession,
                    "chembl_id": chembl_id,
                    "name": pair.get("name"),
                    "modality": modality,
                    "clinical_stage": pair.get("clinical_stage"),
                    "mechanism_target_accessions": sorted(targets),
                    "mechanism_target_names": [row.get("target_name") for row in records][:4],
                    "cause": cause,
                    "note": note,
                    "in_engine_universe": bool(pair.get("has_any_chembl_mechanism")),
                }
            )

    counts: dict[str, int] = {cause: 0 for cause in CAUSE_ORDER}
    counts_universe: dict[str, int] = {cause: 0 for cause in CAUSE_ORDER}
    for row in rows:
        counts[row["cause"]] += 1
        if row["in_engine_universe"]:
            counts_universe[row["cause"]] += 1

    # The targets that recur across the no-path bucket, which is what shows those drugs are aimed
    # at general immune and inflammatory proteins rather than at the subject's own.
    recurring: dict[str, int] = {}
    for row in rows:
        if row["cause"] != "acts_on_a_human_protein_with_no_bridge_path_to_the_subject":
            continue
        for name in row["mechanism_target_names"]:
            if name:
                recurring[str(name)] = recurring.get(str(name), 0) + 1

    in_scope = [row for row in scope_rows if row["in_scope"]]
    recovered_in_scope = [row for row in in_scope if row["outcome"] == "recovered"]
    rejected_in_scope = [row for row in in_scope if row["outcome"] == "falsely_rejected"]
    scope = {
        "rule": (
            "ChEMBL molecule_type == 'Small molecule' AND at least one ChEMBL mechanism record whose "
            "target resolves to a human (Homo sapiens) UniProt accession. Fixed before the number was "
            "computed; reads source fields only; independent of what the engine returned."
        ),
        "n_pairs_total": len(scope_rows),
        "n_in_scope": len(in_scope),
        "recovered": len(recovered_in_scope),
        "recall_rate": round(len(recovered_in_scope) / len(in_scope), 4) if in_scope else None,
        "falsely_rejected": len(rejected_in_scope),
        "false_rejection_rate": (
            round(len(rejected_in_scope) / len(in_scope), 4) if in_scope else None
        ),
        "missed": len(in_scope) - len(recovered_in_scope) - len(rejected_in_scope),
        "outcome_mix": {
            key: sum(1 for row in in_scope if row["outcome"] == key)
            for key in sorted({str(row["outcome"]) for row in in_scope})
        },
    }

    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": str(ACCURACY_JSON.name),
        "method": __doc__.strip().split("\n\n")[1],
        "cause_order": CAUSE_ORDER,
        "scope": scope,
        "n_missed": len(rows),
        "counts_all_missed": counts,
        "counts_within_the_chembl_mechanism_universe": counts_universe,
        "recurring_targets_in_the_no_path_bucket": dict(
            sorted(recurring.items(), key=lambda item: (-item[1], item[0]))[:20]
        ),
        "api_calls": api.calls,
        "run_seconds": round(time.monotonic() - started, 2),
        "misses": rows,
    }
    OUTPUT_JSON.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    print(f"{len(rows)} misses classified in {output['run_seconds']}s, {api.calls} API calls")
    for cause in CAUSE_ORDER:
        print(f"  {counts[cause]:>4}  (in universe {counts_universe[cause]:>4})  {cause}")
    print(
        f"  in scope {scope['n_in_scope']} of {scope['n_pairs_total']} pairs; recall "
        f"{scope['recovered']}/{scope['n_in_scope']} = {scope['recall_rate']}; false rejection "
        f"{scope['falsely_rejected']}/{scope['n_in_scope']} = {scope['false_rejection_rate']}"
    )
    print(f"-> {OUTPUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
