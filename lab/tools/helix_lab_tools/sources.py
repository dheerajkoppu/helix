"""Facts with their database record, and the ledger of every source a tool returned in this run."""

import fcntl
import json
from datetime import UTC, datetime
from typing import Any

from helix_lab_tools.context import current_role, run_dir

LEDGER_FILE = "sources_seen.jsonl"

DATABASE_NAMES = {
    "clinvar": "ClinVar",
    "uniprot": "UniProtKB",
    "gnomad": "gnomAD",
    "ensembl": "Ensembl VEP",
    "europepmc": "Europe PMC",
    "interpro": "InterPro",
    "alphamissense": "AlphaMissense",
    "protvar": "EBI ProtVar",
    "rcsb": "RCSB PDB",
    "rcsb_pdb": "RCSB PDB",
    "pdbe": "PDBe SIFTS",
    "intact": "IntAct",
    "string": "STRING",
    "afdb": "AlphaFold DB",
    "prankweb": "PrankWeb",
    "openalex": "OpenAlex",
    "helix": "Helix",
    "mavedb": "MaveDB",
    "chembl": "ChEMBL",
    "reactome": "Reactome",
    "unichem": "UniChem",
    "pubchem": "PubChem",
    "open_targets": "Open Targets",
    "helix_seed": "Helix seeded catalog",
}


def database_name(identifier: str | None) -> str:
    if not identifier:
        return "Unknown"
    return DATABASE_NAMES.get(identifier.lower(), identifier)


def source(database: str, record_id: str, url: str | None) -> dict[str, str]:
    return {"database": database_name(database), "record_id": str(record_id), "url": url or ""}


def fact(
    statement: str, evidence_class: str, strength: str | None, database: str, record_id: str, url: str | None
) -> dict[str, Any]:
    return {
        "statement": " ".join(statement.split()),
        "evidence_class": evidence_class,
        "strength": strength or "not graded by the source",
        "source": source(database, record_id, url),
    }


def strength_label(strength: dict[str, Any] | None) -> str | None:
    if not strength:
        return None
    value = strength.get("value")
    if strength.get("rank") is not None and strength.get("max_rank"):
        return f"{value} (rank {strength['rank']} of {strength['max_rank']}, {strength.get('scheme')})"
    return str(value) if value is not None else None


def fact_from_evidence(
    statement: str, evidence: dict[str, Any] | None, *, url: str | None = None
) -> dict[str, Any] | None:
    """Build a fact from an Helix Evidence object, keeping its class, strength and source record."""
    if not evidence or not evidence.get("source"):
        return None
    origin = evidence["source"]
    record_id = origin.get("record_id")
    if not record_id:
        return None
    if origin.get("record_version") and origin.get("database") == "clinvar":
        record_id = f"{record_id}.{origin['record_version']}"
    return fact(
        statement,
        evidence.get("evidence_class") or "curated_database",
        strength_label(evidence.get("strength")),
        origin.get("database") or "unknown",
        record_id,
        origin.get("url") or url,
    )


def normalise_record_id(record_id: str) -> str:
    cleaned = record_id.strip().lower()
    for prefix in ("pmid:", "pdb:", "doi:", "https://doi.org/", "https://openalex.org/"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
    return cleaned


def _key(row: dict[str, str]) -> tuple[str, str]:
    return _plain(row.get("database", "")), normalise_record_id(row["record_id"])


def _plain(name: str) -> str:
    return "".join(character for character in name.lower() if character.isalnum())


def remember(sources: list[dict[str, str]], tool: str) -> None:
    """Add the sources a retrieval or test tool returned to the run's ledger."""
    directory = run_dir()
    known = {_key(row) for row in seen()}
    fresh = [row for row in sources if row.get("record_id") and _key(row) not in known]
    if not fresh:
        return
    stamp = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    with (directory / LEDGER_FILE).open("a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        added: set[tuple[str, str]] = set()
        for row in fresh:
            if _key(row) in added:
                continue
            added.add(_key(row))
            entry = {**row, "tool": tool, "agent": current_role(), "at": stamp}
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def remember_facts(payload: dict[str, Any], tool: str) -> dict[str, Any]:
    collected = [item["source"] for item in payload.get("facts", []) if item.get("source")]
    collected.extend(payload.get("sources", []))
    remember(collected, tool)
    return payload


def seen() -> list[dict[str, str]]:
    path = run_dir() / LEDGER_FILE
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def lookup(record_id: str, database: str | None = None) -> dict[str, str] | None:
    """The ledger entry for a record ID; when several databases share the ID, the one the caller names."""
    wanted = normalise_record_id(record_id)
    matches = [row for row in seen() if normalise_record_id(row["record_id"]) == wanted]
    if not matches:
        return None
    named = _plain(database_name(database)) if database else ""
    for row in matches:
        held = _plain(row["database"])
        if named and (named == held or named in held or held in named):
            return row
    return matches[0]
