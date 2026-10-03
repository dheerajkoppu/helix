"""Run real variant comparisons for the flagship set and store their outputs under data/examples.

Each comparison is a variant_comparison job submitted to a running OrphaFold API, so the stored
files are exactly what the job produced, beside the run manifest of that job. Nothing is written
for a job that did not succeed.

    cd api && .venv/bin/python scripts/cache_examples.py --api http://127.0.0.1:8137
    cd api && .venv/bin/python scripts/cache_examples.py --api http://127.0.0.1:8137 --only BTK-p.Arg28His
"""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

REPO_DIR = Path(__file__).resolve().parents[2]
CATALOG = REPO_DIR / "data" / "seed" / "catalog.json"
EXAMPLES_DIR = REPO_DIR / "data" / "examples"
INDEX_FILE = "index.json"
WORKSPACE = "orphafold-cache-examples-script"
JOB_KIND = "variant_comparison"

# gene, protein change or position of the variant in the flagship list of the seed catalog.
# ADA and IL2RG are within the provider limit and are predicted full length.
TARGETS: list[tuple[str, str | int]] = [
    ("BTK", "p.Arg28His"),
    ("BTK", "p.Arg525Gln"),
    ("WAS", 0),
    ("ADA", 0),
    ("IL2RG", 0),
    ("RAG1", 0),
]


def flagship_variants() -> list[str]:
    flagship = {row["gene_symbol"]: row for row in json.loads(CATALOG.read_text())["flagship"]}
    variant_ids: list[str] = []
    for gene, pick in TARGETS:
        variants = flagship[gene]["variants"]
        if isinstance(pick, int):
            variant = variants[pick]
        else:
            variant = next(item for item in variants if item["protein_change"] == pick)
        variant_ids.append(variant["id"])
    return variant_ids


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_job(client: httpx.Client, variant_id: str, provider: str, poll_seconds: float) -> dict[str, Any]:
    body = {"kind": JOB_KIND, "params": {"provider": provider, "variant_id": variant_id}}
    response = client.post("/api/v1/jobs", json=body)
    response.raise_for_status()
    job = response.json()
    print(f"{variant_id}: {job['id']} submitted", flush=True)
    seen: dict[str, str] = {}
    while job["status"] in ("queued", "running"):
        time.sleep(poll_seconds)
        job = client.get(f"/api/v1/jobs/{job['id']}").json()
        for stage in job["stages"]:
            if seen.get(stage["id"]) != stage["status"] and stage["status"] != "pending":
                seen[stage["id"]] = stage["status"]
                print(f"  {stage['label']}: {stage['status']}", flush=True)
    return job


def store_example(client: httpx.Client, job: dict[str, Any], provider: str) -> dict[str, Any]:
    """Download every artifact of a succeeded job, check each hash and write the index row."""
    result = job["result"]
    variant_id = result["variant_id"]
    directory = EXAMPLES_DIR / f"{variant_id}__{provider}"
    directory.mkdir(parents=True, exist_ok=True)
    files: list[str] = []
    for artifact in job["artifacts"]:
        body = client.get(artifact["url"]).content
        if sha256(body) != artifact["sha256"]:
            raise RuntimeError(f"{artifact['name']} of {job['id']} does not match its recorded SHA-256")
        (directory / artifact["name"]).write_bytes(body)
        files.append(artifact["name"])
    if "manifest.json" not in files:
        manifest = client.get(job["manifest_url"])
        manifest.raise_for_status()
        if json.loads(manifest.content)["integrity"]["manifest_sha256"] != job["manifest_sha256"]:
            raise RuntimeError(f"The run manifest of {job['id']} does not match its recorded hash")
        (directory / "manifest.json").write_bytes(manifest.content)
        files.append("manifest.json")
    (directory / "result.json").write_text(json.dumps(job, indent=2, ensure_ascii=False) + "\n")
    files.append("result.json")

    difference = json.loads((directory / "difference.json").read_text())
    sequences = {model["role"]: model["sequence_sha256"] for model in difference["models"]}
    return {
        "job_id": job["id"],
        "directory": directory.name,
        "variant_id": variant_id,
        "gene_symbol": result["gene_symbol"],
        "uniprot_accession": result["variant"]["uniprot_accession"],
        "provider_id": result["provider"]["id"],
        "provider_name": result["provider"]["name"],
        "model_name": result["provider"]["model_name"],
        "model_version": result["provider"]["model_version"],
        "generated_at": job["completed_at"],
        "construct": result["construct"],
        "sequence_sha256": sequences,
        "manifest_sha256": job["manifest_sha256"],
        "files": sorted(files),
    }


def write_index(rows: dict[str, dict[str, Any]]) -> None:
    document = {
        "schema_version": "1.0",
        "description": (
            "Stored outputs of real variant_comparison jobs. Every directory holds the unmodified "
            "artifacts of one job beside its run manifest. Written by api/scripts/cache_examples.py."
        ),
        "examples": [rows[key] for key in sorted(rows)],
    }
    (EXAMPLES_DIR / INDEX_FILE).write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="Origin of a running OrphaFold API")
    parser.add_argument("--provider", default="esm_atlas", help="Model provider that runs the comparisons")
    parser.add_argument("--only", action="append", help="Variant ID to run; repeat for several")
    parser.add_argument("--skip-existing", action="store_true", help="Keep examples already in the index")
    parser.add_argument("--poll-seconds", type=float, default=3.0)
    arguments = parser.parse_args()

    index_path = EXAMPLES_DIR / INDEX_FILE
    rows: dict[str, dict[str, Any]] = {}
    if index_path.is_file():
        for row in json.loads(index_path.read_text()).get("examples", []):
            rows[f"{row['variant_id']}__{row['provider_id']}"] = row

    failed: list[str] = []
    headers = {"X-OrphaFold-Workspace": WORKSPACE}
    with httpx.Client(base_url=arguments.api, headers=headers, timeout=60) as client:
        for variant_id in arguments.only or flagship_variants():
            key = f"{variant_id}__{arguments.provider}"
            if arguments.skip_existing and key in rows:
                print(f"{variant_id}: already stored", flush=True)
                continue
            job = run_job(client, variant_id, arguments.provider, arguments.poll_seconds)
            if job["status"] != "succeeded":
                error = job.get("error") or {}
                reason = f"{error.get('code')}: {error.get('message')}"
                print(f"{variant_id}: {job['status']} ({reason})", flush=True)
                failed.append(variant_id)
                continue
            rows[key] = store_example(client, job, arguments.provider)
            write_index(rows)
            summary = job["result"]["summary"]
            print(
                f"{variant_id}: stored. C-alpha RMSD {summary['rmsd_ca_all']} A over "
                f"{summary['total_residues']} residues, {summary['masked_residues']} masked.",
                flush=True,
            )
    if failed:
        print(f"Not stored: {', '.join(failed)}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
