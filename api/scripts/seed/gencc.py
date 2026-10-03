"""GenCC submissions (CC0): gene to MONDO disease with validity classification and mode of inheritance."""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ACCEPTED = {"Definitive": 4, "Strong": 3, "Moderate": 2, "Supportive": 1}


@dataclass
class GeneDisease:
    mondo_id: str
    title: str
    best_rank: int = 0
    inheritance: set[str] = field(default_factory=set)
    submitters: dict[str, int] = field(default_factory=dict)
    original_ids: set[str] = field(default_factory=set)
    records: list[str] = field(default_factory=list)


@dataclass
class Gencc:
    release: str
    by_gene: dict[str, dict[str, GeneDisease]]
    any_classification: dict[str, set[str]]


def load_gencc(path: Path) -> Gencc:
    """Gene-disease pairs at Supportive or better, plus every asserted pair for corroboration checks."""
    csv.field_size_limit(1 << 30)
    by_gene: dict[str, dict[str, GeneDisease]] = defaultdict(dict)
    any_classification: dict[str, set[str]] = defaultdict(set)
    release = ""
    with open(path, encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            release = max(release, row["submitted_run_date"])
            title = row["classification_title"]
            if title not in {"Disputed Evidence", "Refuted Evidence", "No Known Disease Relationship"}:
                any_classification[row["gene_curie"]].add(row["disease_curie"])
            rank = ACCEPTED.get(title)
            if rank is None:
                continue
            pair = by_gene[row["gene_curie"]].setdefault(
                row["disease_curie"], GeneDisease(mondo_id=row["disease_curie"], title=row["disease_title"])
            )
            pair.best_rank = max(pair.best_rank, rank)
            pair.inheritance.add(row["moi_curie"])
            pair.submitters[row["submitter_title"]] = max(
                pair.submitters.get(row["submitter_title"], 0), rank
            )
            pair.original_ids.add(row["disease_original_curie"])
            pair.records.append(row["uuid"])
    return Gencc(release, dict(by_gene), dict(any_classification))
