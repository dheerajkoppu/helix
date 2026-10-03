"""HPO annotations (phenotype.hpoa): phenotypes and inheritance per OMIM or Orphanet disease."""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .obo import Ontology

IMMUNE_SYSTEM_ABNORMALITY = "HP:0002715"


@dataclass(frozen=True)
class Annotation:
    hpo_id: str
    frequency: str
    reference: str


@dataclass
class Hpoa:
    version: str
    phenotypes: dict[str, list[Annotation]]
    inheritance: dict[str, set[str]]


def load_hpoa(path: Path) -> Hpoa:
    version = ""
    phenotypes: dict[str, list[Annotation]] = defaultdict(list)
    inheritance: dict[str, set[str]] = defaultdict(set)
    with open(path, encoding="utf-8", newline="") as handle:
        header: list[str] = []
        for line in handle:
            if line.startswith("#version:"):
                version = line.split(":", 1)[1].strip()
            if not line.startswith("#"):
                header = line.rstrip("\n").split("\t")
                break
        for row in csv.DictReader(handle, fieldnames=header, delimiter="\t", quoting=csv.QUOTE_NONE):
            if row["qualifier"] == "NOT":
                continue
            if row["aspect"] == "P":
                phenotypes[row["database_id"]].append(
                    Annotation(hpo_id=row["hpo_id"], frequency=row["frequency"], reference=row["reference"])
                )
            elif row["aspect"] == "I":
                inheritance[row["database_id"]].add(row["hpo_id"])
    return Hpoa(version, dict(phenotypes), dict(inheritance))


def descendants(ontology: Ontology, root: str) -> frozenset[str]:
    children: dict[str, list[str]] = defaultdict(list)
    for term in ontology.terms.values():
        for parent in term.parents:
            children[parent].append(term.id)
    found = {root}
    stack = [root]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in found:
                found.add(child)
                stack.append(child)
    return frozenset(found)
