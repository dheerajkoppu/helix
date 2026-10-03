"""Scripted retrieval for every benchmark variant, without any agent.

    lab/.venv/bin/python lab/experiments/preflight.py

Calls the lab's own retrieval tools and its three retrieval-only tests once per variant in a fixed order, twice
in a row, and times every call. The first pass fills the caches of the Helix API, so that neither arm of
the benchmark pays for a cold upstream database; the second pass measures how long the tools themselves take
when nothing has to decide which one to call. Writes lab/experiments/results/preflight.json.
"""

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXPERIMENTS = Path(__file__).resolve().parent
LAB = EXPERIMENTS.parent
sys.path.insert(0, str(LAB / "tools"))
sys.path.insert(0, str(EXPERIMENTS))

from reference_labels import variant_set  # noqa: E402

OUTPUT = EXPERIMENTS / "results" / "preflight.json"
SCRATCH = EXPERIMENTS / "results" / "preflight"
RETRIEVAL_TESTS = ("ligand_contact", "stability_effect", "structural_context")


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def timed(name: str, call: Any) -> tuple[dict[str, Any], Any]:
    started = time.monotonic()
    error: str | None = None
    result: Any = None
    try:
        result = call()
        if isinstance(result, str):
            result = json.loads(result)
        if isinstance(result, dict) and result.get("error"):
            error = str(result["error"])[:300]
    except Exception as failure:
        error = f"{type(failure).__name__}: {failure}"[:300]
    return {
        "tool": name,
        "seconds": round(time.monotonic() - started, 2),
        "ok": error is None,
        "error": error,
    }, result


def one_pass(subject: dict[str, Any]) -> dict[str, Any]:
    from helix_lab_tools import api, experiments, openalex

    gene, accession, position = subject["gene"], subject["accession"], subject["position"]
    calls = [
        ("get_gene", lambda: api.get_gene(gene)),
        ("get_protein", lambda: api.get_protein(accession)),
        ("get_variant", lambda: api.get_variant(subject["variant_id"])),
        ("list_variants_near", lambda: api.list_variants_near(gene, position, 5)),
        ("get_residue_annotations", lambda: api.get_residue_annotations(accession, position)),
        (
            "get_variant_effect_values",
            lambda: api.get_variant_effect_values(accession, position, subject["alternate_residue"]),
        ),
        ("get_structure_ledger", lambda: api.get_structure_ledger(accession, position)),
        ("get_interactions", lambda: api.get_interactions(accession)),
        ("search_literature", lambda: api.search_literature(gene, subject["variant_id"], None, 6)),
        (
            "search_openalex",
            lambda: openalex.search_openalex(f"{gene} {subject['protein_change']} mechanism", 6),
        ),
        ("list_available_tests", experiments.list_available_tests),
    ]
    steps = []
    availability: dict[str, Any] = {}
    for name, call in calls:
        step, result = timed(name, call)
        steps.append(step)
        if name == "list_available_tests" and isinstance(result, dict):
            availability = {
                row["test_kind"]: {
                    "can_run": (row.get("availability_now") or {}).get("can_run"),
                    "detail": (row.get("availability_now") or {}).get("detail"),
                }
                for row in result.get("tests", [])
            }
    tests = {}
    for kind in RETRIEVAL_TESTS:
        step, result = timed(kind, lambda kind=kind: experiments.FUNCTIONS[kind](dict(subject)))
        values = (result or {}).get("values") or {} if isinstance(result, dict) else {}
        tests[kind] = {**step, "verdict": values.get("verdict"), "headline": values.get("headline")}
    return {
        "retrieval_seconds": round(sum(step["seconds"] for step in steps), 2),
        "test_seconds": round(sum(row["seconds"] for row in tests.values()), 2),
        "failed_calls": [step["tool"] for step in steps if not step["ok"]]
        + [kind for kind, row in tests.items() if not row["ok"]],
        "steps": steps,
        "tests": tests,
        "availability": availability,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.environ.get("HELIX_API_URL", "http://localhost:8000"))
    arguments = parser.parse_args()
    os.environ["HELIX_API_URL"] = arguments.api_url
    rows = []
    for subject in variant_set():
        subject = {
            **subject,
            "protein_change": subject["variant_id"].split("-", 1)[1],
        }
        directory = SCRATCH / subject["variant_id"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "run.json").write_text(
            json.dumps({"run_id": f"preflight-{subject['variant_id']}", "subject": subject}, indent=2) + "\n",
            encoding="utf-8",
        )
        os.environ["HELIX_LAB_RUN_DIR"] = str(directory)
        first = one_pass(subject)
        second = one_pass(subject)
        ledger = directory / "sources_seen.jsonl"
        databases = sorted(
            {json.loads(line)["database"] for line in ledger.read_text(encoding="utf-8").splitlines() if line}
            if ledger.exists()
            else set()
        )
        rows.append(
            {
                "variant_id": subject["variant_id"],
                "first_pass": first,
                "second_pass": second,
                "databases_returned": databases,
            }
        )
        print(
            f"{subject['variant_id']:<22} first {first['retrieval_seconds'] + first['test_seconds']:>7.1f}s  "
            f"second {second['retrieval_seconds'] + second['test_seconds']:>6.1f}s  "
            f"failed {first['failed_calls'] or '-'} / {second['failed_calls'] or '-'}  "
            f"{len(databases)} databases",
            flush=True,
        )
    second_totals = sorted(
        row["second_pass"]["retrieval_seconds"] + row["second_pass"]["test_seconds"] for row in rows
    )
    first_totals = sorted(
        row["first_pass"]["retrieval_seconds"] + row["first_pass"]["test_seconds"] for row in rows
    )
    middle = len(rows) // 2
    body = {
        "generated_at": now(),
        "api_url": arguments.api_url,
        "what": (
            "Per variant: 11 retrieval tool calls and 3 retrieval-only tests in a fixed order, no agent, twice. "
            "The first pass also fills the API caches before the benchmark."
        ),
        "n_variants": len(rows),
        "median_first_pass_seconds": round(first_totals[middle], 2) if rows else None,
        "median_second_pass_seconds": round(second_totals[middle], 2) if rows else None,
        "variants": rows,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
