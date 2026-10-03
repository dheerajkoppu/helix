"""Flagship genes with research-verified ClinVar variants, re-checked at build time."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .fetch import Cached, Fetcher, LookupFailed
from .proteins import Protein

FIXTURE_PATH = Path(__file__).with_name("flagship.json")
ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
THREE_TO_ONE = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
    "His": "H", "Ile": "I", "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
    "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V",
}  # fmt: skip
SUBSTITUTION = re.compile(r"^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$")


class FlagshipMismatch(ValueError):
    pass


def variation_id(vcv: str) -> str:
    return str(int(vcv.removeprefix("VCV")))


def build_flagship(
    fetcher: Fetcher, accession_by_symbol: dict[str, str | None], proteins: dict[str, Protein]
) -> tuple[list[dict], list[Cached], list[str]]:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["genes"]
    identifiers = sorted(
        {variation_id(v["clinvar_vcv"]) for gene in fixture for v in gene["variants"]}, key=int
    )
    notes: list[str] = []
    responses: list[Cached] = []
    summaries: dict[str, dict] = {}
    try:
        cached = fetcher.get(
            "clinvar",
            "flagship.esummary.json",
            ESUMMARY_URL,
            params={
                "db": "clinvar",
                "id": ",".join(identifiers),
                "retmode": "json",
                "tool": "helix-seed-builder",
            },
        )
        summaries = cached.json().get("result", {})
        responses.append(cached)
    except (LookupFailed, ValueError) as error:
        notes.append(
            f"ClinVar esummary unavailable ({error}); review status and rsID taken from the committed fixture"
        )

    flagship: list[dict] = []
    problems: list[str] = []
    unchecked: list[str] = []
    for gene in fixture:
        symbol = gene["gene_symbol"]
        accession = accession_by_symbol.get(symbol)
        if accession != gene["uniprot_accession"]:
            problems.append(
                f"{symbol}: HGNC maps to {accession}, fixture expects {gene['uniprot_accession']}"
            )
            continue
        protein = proteins.get(accession)
        variants = []
        for variant in gene["variants"]:
            change = variant["protein_change"]
            match = SUBSTITUTION.match(change)
            if not match:
                problems.append(f"{symbol} {change}: not a protein substitution")
                continue
            reference, position = THREE_TO_ONE[match.group(1)], int(match.group(2))
            if protein is None or not protein.sequence:
                unchecked.append(f"{symbol} {change}")
            elif position > len(protein.sequence) or protein.sequence[position - 1] != reference:
                problems.append(
                    f"{symbol} {change}: UniProt {accession} does not have {reference} at {position}"
                )
                continue
            review_status, rsid = variant["review_status"], variant["rsid"]
            summary = summaries.get(variation_id(variant["clinvar_vcv"]))
            if summary:
                if summary.get("accession") != variant["clinvar_vcv"]:
                    problems.append(f"{symbol} {change}: ClinVar returned {summary.get('accession')}")
                    continue
                if f"({change})" not in summary.get("title", ""):
                    problems.append(f"{symbol} {change}: ClinVar title is {summary.get('title')!r}")
                    continue
                if symbol not in {item.get("symbol") for item in summary.get("genes", [])}:
                    problems.append(f"{symbol} {change}: ClinVar record is not annotated to {symbol}")
                    continue
                live_status = summary.get("germline_classification", {}).get("review_status")
                if live_status:
                    if live_status != review_status:
                        notes.append(
                            f"{symbol} {change}: review status is now {live_status!r} "
                            f"(fixture: {review_status!r})"
                        )
                    review_status = live_status
                live_rsids = sorted(
                    {
                        "rs" + reference_item["db_id"]
                        for variation in summary.get("variation_set", [])
                        for reference_item in variation.get("variation_xrefs", [])
                        if reference_item.get("db_source") == "dbSNP"
                    }
                )
                if live_rsids:
                    if rsid not in live_rsids:
                        notes.append(
                            f"{symbol} {change}: dbSNP cross-reference is now {live_rsids} (fixture: {rsid})"
                        )
                    rsid = rsid if rsid in live_rsids else live_rsids[0]
            variants.append(
                {
                    "id": f"{symbol}-{change}",
                    "protein_change": change,
                    "clinvar_vcv": variant["clinvar_vcv"],
                    "rsid": rsid,
                    "review_status": review_status,
                }
            )
        flagship.append({"gene_symbol": symbol, "uniprot_accession": accession, "variants": variants})
    if unchecked:
        notes.append(
            f"UniProt sequence unavailable for {len(unchecked)} flagship variants; "
            "reference residues not re-checked"
        )
    if problems:
        raise FlagshipMismatch("flagship fixture no longer matches its sources:\n  " + "\n  ".join(problems))
    return flagship, responses, notes
