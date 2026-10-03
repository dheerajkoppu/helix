"""UniProtKB entries for the catalog genes: protein name, length, family and canonical sequence."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .fetch import Cached, Fetcher, LookupFailed

BATCH_URL = "https://rest.uniprot.org/uniprotkb/accessions"
ENTRY_URL = "https://rest.uniprot.org/uniprotkb/{accession}"
FIELDS = "accession,id,reviewed,protein_name,length,protein_families,sequence"
BATCH_SIZE = 100
FAMILY_PREFIX = "Belongs to the "


@dataclass(frozen=True)
class Protein:
    accession: str
    entry_name: str
    reviewed: bool
    name: str | None
    length: int | None
    family: str | None
    sequence: str


def protein_name(entry: dict) -> str | None:
    description = entry.get("proteinDescription", {})
    recommended = description.get("recommendedName", {}).get("fullName", {}).get("value")
    if recommended:
        return recommended
    submitted = description.get("submissionNames", [])
    return submitted[0]["fullName"]["value"] if submitted else None


def protein_family(entry: dict) -> str | None:
    """Top level of the UniProt "Belongs to the ..." statement, for example "protein kinase superfamily"."""
    statements = [
        text["value"]
        for comment in entry.get("comments", [])
        if comment.get("commentType") == "SIMILARITY"
        for text in comment.get("texts", [])
    ]
    whole_protein = [value for value in statements if value.startswith(FAMILY_PREFIX)]
    if not whole_protein:
        return None
    return whole_protein[0][len(FAMILY_PREFIX) :].split(". ")[0].rstrip(".").strip() or None


def parse_entry(entry: dict) -> Protein:
    sequence = entry.get("sequence", {})
    return Protein(
        accession=entry["primaryAccession"],
        entry_name=entry.get("uniProtkbId", ""),
        reviewed="reviewed (Swiss-Prot)" in entry.get("entryType", ""),
        name=protein_name(entry),
        length=sequence.get("length"),
        family=protein_family(entry),
        sequence=sequence.get("value", ""),
    )


def fetch_proteins(
    fetcher: Fetcher, accessions: list[str]
) -> tuple[dict[str, Protein], list[Cached], list[str]]:
    """Proteins keyed by the requested accession, the cached responses used, and lookup failures."""
    proteins: dict[str, Protein] = {}
    responses: list[Cached] = []
    failures: list[str] = []
    ordered = sorted(set(accessions))
    for start in range(0, len(ordered), BATCH_SIZE):
        batch = ordered[start : start + BATCH_SIZE]
        digest = hashlib.sha256(",".join(batch).encode()).hexdigest()[:16]
        try:
            cached = fetcher.get(
                "uniprot",
                f"accessions-{digest}.json",
                BATCH_URL,
                params={"accessions": ",".join(batch), "fields": FIELDS, "format": "json"},
            )
        except LookupFailed as error:
            failures.append(str(error))
            continue
        responses.append(cached)
        for entry in cached.json().get("results", []):
            if "primaryAccession" in entry:
                proteins[entry["primaryAccession"]] = parse_entry(entry)

    for accession in ordered:
        if accession in proteins:
            continue
        try:
            cached = fetcher.get(
                "uniprot",
                f"entry-{accession}.json",
                ENTRY_URL.format(accession=accession),
                params={"fields": FIELDS, "format": "json"},
            )
        except LookupFailed as error:
            failures.append(str(error))
            continue
        responses.append(cached)
        proteins[accession] = parse_entry(cached.json())
    return proteins, responses, failures
