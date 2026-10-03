"""ClinGen gene-disease validity curations (CC0), limited to the immunology expert panels."""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

IMMUNOLOGY_PANELS = {
    "SCID-CID Gene Curation Expert Panel",
    "Antibody Deficiencies Gene Curation Expert Panel",
    "Primary Immune Regulatory Disorders Gene Curation Expert Panel",
    "Complement-Mediated Kidney Diseases Gene Curation Expert Panel",
    "Monogenic Systemic and Incomplete Lupus Erythematosus Gene Curation Expert Panel",
    "Monogenic Autoinflammatory Diseases Gene Curation Expert Panel",
}
ACCEPTED = {"Definitive", "Strong", "Moderate"}
INHERITANCE = {
    "AR": {"HP:0000007"},
    "AD": {"HP:0000006"},
    "XL": {"HP:0001417", "HP:0001419", "HP:0001423"},
    "SD": {"HP:0000006", "HP:0000007"},
}


@dataclass(frozen=True)
class Curation:
    mondo_id: str
    label: str
    inheritance: frozenset[str] | None
    classification: str
    panel: str
    report_url: str


@dataclass
class Clingen:
    release: str
    by_gene: dict[str, list[Curation]]


def load_clingen(path: Path) -> Clingen:
    lines = path.read_text(encoding="utf-8").splitlines()
    release = next(
        (
            line.split("FILE CREATED:")[1].split('"')[0].strip()
            for line in lines[:6]
            if "FILE CREATED:" in line
        ),
        "",
    )
    header_index = next(index for index, line in enumerate(lines) if line.startswith('"GENE SYMBOL"'))
    body = "\n".join([lines[header_index], *lines[header_index + 2 :]])
    by_gene: dict[str, list[Curation]] = defaultdict(list)
    for row in csv.DictReader(io.StringIO(body)):
        if row["GCEP"] not in IMMUNOLOGY_PANELS or row["CLASSIFICATION"] not in ACCEPTED:
            continue
        inheritance = INHERITANCE.get(row["MOI"])
        by_gene[row["GENE ID (HGNC)"]].append(
            Curation(
                mondo_id=row["DISEASE ID (MONDO)"],
                label=row["DISEASE LABEL"],
                inheritance=frozenset(inheritance) if inheritance else None,
                classification=row["CLASSIFICATION"],
                panel=row["GCEP"],
                report_url=row["ONLINE REPORT"],
            )
        )
    return Clingen(release, dict(by_gene))
