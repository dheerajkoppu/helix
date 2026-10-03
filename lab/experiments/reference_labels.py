"""Derive the reference mechanism labels of the benchmark, independently of the lab.

    lab/.venv/bin/python lab/experiments/reference_labels.py

Reads the variant set (the first-listed flagship variant of every gene in data/seed/catalog.json), fetches
each UniProtKB entry from rest.uniprot.org and the PDBe-KB residue annotations from www.ebi.ac.uk (the raw
responses are kept under lab/experiments/reference/snapshots/ and reused unless --refresh is given), applies
the fixed rules below, and writes lab/experiments/reference/labels.json. When that file exists the script
only checks that the derivation still gives the same labels; --overwrite replaces it. Nothing here calls the
Helix API, a lab tool or an agent, and no run record is read. The labels are never passed to an agent.
"""

import argparse
import hashlib
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

EXPERIMENTS = Path(__file__).resolve().parent
REPOSITORY = EXPERIMENTS.parent.parent
CATALOGUE = REPOSITORY / "data" / "seed" / "catalog.json"
OUTPUT = EXPERIMENTS / "reference" / "labels.json"
SNAPSHOTS = EXPERIMENTS / "reference" / "snapshots"

UNIPROT_URL = "https://rest.uniprot.org/uniprotkb/{accession}.json"
PDBE_KB_URL = "https://www.ebi.ac.uk/pdbe/graph-api/uniprot/{kind}/{accession}"

THREE_TO_ONE = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
    "His": "H", "Ile": "I", "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
    "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V",
}  # fmt: skip
PROTEIN_CHANGE = re.compile(r"^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$")

# A feature this short names the residue's own role; a longer one only says which region it lies in
RESIDUE_SPECIFIC_SPAN = 10

NEGATION = re.compile(r"\b(no effect|no loss|does not|normal|not affect|no change)\b", re.IGNORECASE)
GAIN_OF_FUNCTION = re.compile(
    r"gain[- ]of[- ]function|gain of function|constitutively activ|increased? transcriptional activation",
    re.IGNORECASE,
)
# Checked in this order; the first pattern that matches a clause of a variant description decides its class
DESCRIPTION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("nucleic_acid_binding", re.compile(r"\b(DNA|RNA)[- ]binding|binding to (DNA|RNA)", re.IGNORECASE)),
    (
        "ligand_binding",
        re.compile(
            r"(ATP|GTP|NAD|FAD|heme|haem|nucleotide|inositol|phosphoinositide|lipid|cofactor|metal|zinc|calcium|"
            r"substrate)[- ]binding|binding (of|to) (ATP|GTP|NAD|FAD|heme|haem|inositol|phosphoinositide|lipid|zinc|calcium)",
            re.IGNORECASE,
        ),
    ),
    (
        "protein_interaction",
        re.compile(
            r"interaction with|dimeri[sz]ation|oligomeri[sz]ation|complex formation|binding to [A-Z][A-Z0-9]{2,}",
            re.IGNORECASE,
        ),
    ),
    (
        "stability_folding",
        re.compile(
            r"(stability|unstable|misfold|degrad|protein (expression|level|levels|abundance))", re.IGNORECASE
        ),
    ),
]
NON_PARTNER_NAMES = re.compile(
    r"heavy chain|light chain|^IG-|nanobody|antibody|^fab\b|^other$", re.IGNORECASE
)
ADDITIVE_LIGANDS = frozenset(
    {
        "GOL",
        "EDO",
        "SO4",
        "PO4",
        "ACT",
        "CL",
        "NA",
        "K",
        "PEG",
        "PGE",
        "DMS",
        "FMT",
        "MPD",
        "NAG",
        "BMA",
        "MAN",
    }
)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch_json(url: str, snapshot: Path, refresh: bool) -> dict[str, Any] | None:
    """The response as stored in the snapshot directory, fetched first when absent or when refreshing.

    A 404 means the service holds nothing for the accession and is stored as null; server errors are retried.
    """
    if snapshot.exists() and not refresh:
        return json.loads(snapshot.read_text(encoding="utf-8"))
    attempts = 5
    body: dict[str, Any] | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = httpx.get(url, timeout=90, follow_redirects=True)
        except httpx.HTTPError:
            if attempt < attempts:
                time.sleep(4 * attempt)
                continue
            raise
        if response.status_code == 404:
            break
        if response.status_code >= 500 and attempt < attempts:
            time.sleep(4 * attempt)
            continue
        response.raise_for_status()
        body = response.json()
        break
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    return body


def variant_set() -> list[dict[str, Any]]:
    """The first-listed flagship variant of every gene, in catalogue order."""
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    chosen = []
    for group in catalogue["flagship"]:
        variant = group["variants"][0]
        match = PROTEIN_CHANGE.match(variant["protein_change"])
        if not match:
            continue
        chosen.append(
            {
                "variant_id": variant["id"],
                "gene": group["gene_symbol"],
                "accession": group["uniprot_accession"],
                "position": int(match.group(2)),
                "reference_residue": THREE_TO_ONE[match.group(1)],
                "alternate_residue": THREE_TO_ONE[match.group(3)],
                "clinvar_vcv": variant.get("clinvar_vcv"),
                "clinvar_review_status": variant.get("review_status"),
            }
        )
    return chosen


def span(feature: dict[str, Any]) -> tuple[int, int] | None:
    start = feature["location"]["start"].get("value")
    end = feature["location"]["end"].get("value")
    if start is None or end is None:
        return None
    return int(start), int(end)


def describe(feature: dict[str, Any]) -> dict[str, Any]:
    start, end = span(feature) or (None, None)
    ligand = (feature.get("ligand") or {}).get("name")
    alternative = feature.get("alternativeSequence") or {}
    return {
        "type": feature["type"],
        "residues": f"{start}-{end}" if start != end else str(start),
        "description": feature.get("description") or "",
        "ligand": ligand,
        "substitution": (
            f"{alternative.get('originalSequence')}>{','.join(alternative.get('alternativeSequences') or [])}"
            if alternative
            else None
        ),
        "feature_id": feature.get("featureId"),
    }


def classify_description(text: str) -> tuple[str | None, str | None]:
    """The class named by the first clause of a variant description that states a molecular effect."""
    for clause in (part.strip() for part in text.split(";")):
        if not clause or NEGATION.search(clause):
            continue
        for mechanism, pattern in DESCRIPTION_RULES:
            if pattern.search(clause):
                return mechanism, clause
    return None, None


def uniprot_candidates(entry: dict[str, Any], subject: dict[str, Any]) -> dict[str, Any]:
    position = subject["position"]
    residue_specific: list[dict[str, Any]] = []
    region_level: list[dict[str, Any]] = []
    gain_of_function: list[str] = []
    considered: list[dict[str, Any]] = []
    for feature in entry.get("features", []):
        bounds = span(feature)
        if bounds is None or not bounds[0] <= position <= bounds[1]:
            continue
        kind = feature["type"]
        length = bounds[1] - bounds[0] + 1
        description = feature.get("description") or ""
        row = describe(feature)
        mechanism: str | None = None
        rule: str | None = None
        tier: str | None = None
        if kind == "Active site" and length <= RESIDUE_SPECIFIC_SPAN:
            mechanism, rule, tier = (
                "catalytic_site",
                "R1 active-site feature at the residue",
                "residue_specific",
            )
        elif kind == "Binding site" and length <= RESIDUE_SPECIFIC_SPAN:
            ligand = (feature.get("ligand") or {}).get("name") or ""
            nucleic = bool(re.search(r"\b(DNA|RNA)\b", ligand))
            mechanism = "nucleic_acid_binding" if nucleic else "ligand_binding"
            rule, tier = f"R2 binding-site feature at the residue (ligand: {ligand})", "residue_specific"
        elif kind == "Site" and length <= RESIDUE_SPECIFIC_SPAN:
            if re.search(r"interaction with", description, re.IGNORECASE):
                mechanism, rule, tier = (
                    "protein_interaction",
                    "R3 site feature: interaction",
                    "residue_specific",
                )
        elif kind in ("Natural variant", "Mutagenesis") and length == 1:
            alternatives = (feature.get("alternativeSequence") or {}).get("alternativeSequences") or []
            if subject["alternate_residue"] not in alternatives:
                continue
            if GAIN_OF_FUNCTION.search(description):
                gain_of_function.append(description)
            else:
                mechanism, clause = classify_description(description)
                if mechanism:
                    rule, tier = f"R4 description of this substitution: '{clause}'", "residue_specific"
        elif kind == "DNA binding":
            mechanism, rule, tier = "nucleic_acid_binding", "R5 inside a DNA-binding region", "region_level"
        elif kind == "Region" and re.search(r"^interaction with|dimeri[sz]ation", description, re.IGNORECASE):
            mechanism, rule, tier = "protein_interaction", "R6 inside an interaction region", "region_level"
        if kind not in ("Chain", "Helix", "Beta strand", "Turn"):
            considered.append({**row, "rule": rule, "mechanism": mechanism})
        if mechanism and tier == "residue_specific":
            residue_specific.append({**row, "rule": rule, "mechanism": mechanism})
        elif mechanism:
            region_level.append({**row, "rule": rule, "mechanism": mechanism})
    return {
        "residue_specific": residue_specific,
        "region_level": region_level,
        "gain_of_function": gain_of_function,
        "considered": considered,
    }


def pdbe_kb_membership(accession: str, position: int, refresh: bool) -> dict[str, Any]:
    """Experimental-structure membership of the residue: macromolecular interfaces and ligand sites."""
    membership: dict[str, Any] = {
        "nucleic_acid": [],
        "protein_partner": [],
        "same_protein": [],
        "ligands": [],
    }
    interfaces = fetch_json(
        PDBE_KB_URL.format(kind="interface_residues", accession=accession),
        SNAPSHOTS / f"pdbekb_interface_residues_{accession}.json",
        refresh,
    )
    for partner in ((interfaces or {}).get(accession) or {}).get("data", []):
        for residue in partner.get("residues", []):
            if not residue.get("startIndex", 0) <= position <= residue.get("endIndex", -1):
                continue
            entries = residue.get("interactingPDBEntries") or residue.get("allPDBEntries") or []
            identifiers = sorted(
                {(entry.get("pdbId") if isinstance(entry, dict) else str(entry)) for entry in entries}
            )
            name = partner.get("name") or ""
            row = {"partner": name, "partner_accession": partner.get("accession"), "pdb_entries": identifiers}
            if name in ("DNA", "RNA"):
                membership["nucleic_acid"].append(row)
            elif partner.get("accession") == accession:
                membership["same_protein"].append(row)
            elif not NON_PARTNER_NAMES.search(name):
                membership["protein_partner"].append(row)
    sites = fetch_json(
        PDBE_KB_URL.format(kind="ligand_sites", accession=accession),
        SNAPSHOTS / f"pdbekb_ligand_sites_{accession}.json",
        refresh,
    )
    for ligand in ((sites or {}).get(accession) or {}).get("data", []):
        if ligand.get("accession") in ADDITIVE_LIGANDS:
            continue
        for residue in ligand.get("residues", []):
            if not residue.get("startIndex", 0) <= position <= residue.get("endIndex", -1):
                continue
            entries = residue.get("interactingPDBEntries") or residue.get("allPDBEntries") or []
            identifiers = sorted(
                {(entry.get("pdbId") if isinstance(entry, dict) else str(entry)) for entry in entries}
            )
            membership["ligands"].append(
                {"ligand": ligand.get("accession"), "name": ligand.get("name"), "pdb_entries": identifiers}
            )
    membership["interface_data_available"] = interfaces is not None
    membership["ligand_data_available"] = sites is not None
    return membership


def corroboration(mechanism: str | None, membership: dict[str, Any]) -> str:
    if mechanism == "nucleic_acid_binding":
        return "corroborated" if membership["nucleic_acid"] else "not observed"
    if mechanism == "ligand_binding":
        return "corroborated" if membership["ligands"] else "not observed"
    if mechanism == "protein_interaction":
        return "corroborated" if membership["protein_partner"] else "not observed"
    return "not applicable"


def label(subject: dict[str, Any], refresh: bool) -> dict[str, Any]:
    entry = fetch_json(
        UNIPROT_URL.format(accession=subject["accession"]),
        SNAPSHOTS / f"uniprot_{subject['accession']}.json",
        refresh,
    )
    if entry is None:
        raise SystemExit(f"UniProtKB has no entry {subject['accession']}.")
    candidates = uniprot_candidates(entry, subject)
    membership = pdbe_kb_membership(subject["accession"], subject["position"], refresh)
    mechanism: str | None = None
    tier: str | None = None
    for name in ("residue_specific", "region_level"):
        classes = sorted({row["mechanism"] for row in candidates[name]})
        if len(classes) == 1:
            mechanism, tier = classes[0], name
            derivation = "; ".join(
                f"{row['rule']} [UniProtKB {subject['accession']} {row['type']} {row['residues']}"
                + (f" {row['feature_id']}" if row["feature_id"] else "")
                + "]"
                for row in candidates[name]
            )
            break
        if len(classes) > 1:
            derivation = f"No label: {name.replace('_', ' ')} annotations disagree ({', '.join(classes)})."
            break
    else:
        if candidates["gain_of_function"]:
            derivation = (
                "No label: UniProtKB describes this substitution as a gain of function "
                f"('{candidates['gain_of_function'][0]}'), which the lab's loss-of-function classes do not cover."
            )
        else:
            derivation = (
                "No label: UniProtKB holds no active-site, binding-site, site, DNA-binding or interaction-region "
                "feature at the residue and no description of a molecular effect of this substitution."
            )
    audit = entry.get("entryAudit") or {}
    return {
        **subject,
        "reference_mechanism": mechanism,
        "reference_tier": tier,
        "derivation": derivation,
        "premise_mismatch": "gain_of_function" if candidates["gain_of_function"] else None,
        "uniprot": {
            "entry_version": audit.get("entryVersion"),
            "last_annotation_update": audit.get("lastAnnotationUpdateDate"),
            "url": f"https://www.uniprot.org/uniprotkb/{subject['accession']}/entry",
            "features_at_residue": candidates["considered"],
        },
        "pdbe_kb": {
            "url": f"https://www.ebi.ac.uk/pdbe/pdbe-kb/proteins/{subject['accession']}",
            **membership,
        },
        "structural_corroboration": corroboration(mechanism, membership),
        "annotation_reachable_by_agents": (
            "The label is not given to any agent. The UniProtKB feature it rests on is returned by the lab "
            "tools get_residue_annotations and get_variant in both arms."
            if mechanism
            else None
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Fetch UniProtKB and PDBe-KB again instead of reading the snapshots",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing labels file; without it an existing file is only checked",
    )
    arguments = parser.parse_args()
    labels = [label(subject, arguments.refresh) for subject in variant_set()]
    for row in labels:
        print(
            f"{row['variant_id']:<22} {str(row['reference_mechanism']):<22} {str(row['reference_tier']):<17} "
            f"{row['structural_corroboration']:<14} {row['derivation'][:120]}"
        )
    if arguments.output.exists() and not arguments.overwrite:
        # The labels of a benchmark are fixed before its first run; a later call only checks them
        stored = json.loads(arguments.output.read_text(encoding="utf-8"))
        changed = [
            row["variant_id"] for row, kept in zip(labels, stored["labels"], strict=True) if row != kept
        ]
        if changed:
            raise SystemExit(
                f"The derivation now differs from {arguments.output} (derived {stored['derived_at']}) for: "
                f"{', '.join(changed)}. Pass --overwrite to replace the file."
            )
        print(f"matches {arguments.output} (derived {stored['derived_at']}); file left unchanged")
        return
    body = {
        "derived_at": now(),
        "rule_source": "lab/experiments/reference_labels.py",
        "rule_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "selection_rule": "First-listed flagship variant of every gene in data/seed/catalog.json.",
        "n_variants": len(labels),
        "n_with_reference": sum(1 for row in labels if row["reference_mechanism"]),
        "n_residue_specific": sum(1 for row in labels if row["reference_tier"] == "residue_specific"),
        "n_region_level": sum(1 for row in labels if row["reference_tier"] == "region_level"),
        "labels": labels,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {arguments.output}")


if __name__ == "__main__":
    main()
