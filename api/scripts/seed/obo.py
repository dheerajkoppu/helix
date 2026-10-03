"""Minimal OBO 1.2 reader for the Mondo and HPO ontologies."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

GERMLINE_GENE = re.compile(r"^has_material_basis_in_germline_mutation_in http://identifiers\.org/hgnc/(\d+)")
SYNONYM = re.compile(
    r'^"((?:[^"\\]|\\.)*)"\s+(EXACT|RELATED|BROAD|NARROW)(?:\s+([A-Za-z_][\w:.-]*))?\s*\[(.*?)\]'
)
DEFINITION = re.compile(r'^"((?:[^"\\]|\\.)*)"\s*\[(.*?)\]')


@dataclass
class Synonym:
    text: str
    scope: str
    kind: str
    sources: list[str]


@dataclass
class Term:
    id: str
    name: str = ""
    definition: str = ""
    definition_sources: list[str] = field(default_factory=list)
    synonyms: list[Synonym] = field(default_factory=list)
    alternative_ids: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)
    germline_genes: list[str] = field(default_factory=list)
    obsolete: bool = False


@dataclass
class Ontology:
    version: str
    terms: dict[str, Term]
    alternative_ids: dict[str, str]

    def get(self, term_id: str) -> Term | None:
        term = self.terms.get(term_id)
        if term is None and term_id in self.alternative_ids:
            term = self.terms.get(self.alternative_ids[term_id])
        return term

    def label(self, term_id: str) -> str | None:
        term = self.get(term_id)
        return term.name if term and term.name else None


def unescape(text: str) -> str:
    return text.replace('\\"', '"').replace("\\n", " ").replace("\\\\", "\\").strip()


def split_sources(text: str) -> list[str]:
    return [item.strip() for item in text.split(",") if item.strip()]


def load_obo(path: Path) -> Ontology:
    version = ""
    terms: dict[str, Term] = {}
    alternative_ids: dict[str, str] = {}
    term: Term | None = None
    in_term = False
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if line.startswith("["):
                in_term = line == "[Term]"
                term = None
                continue
            if not line:
                continue
            tag, _, value = line.partition(": ")
            if not in_term:
                if tag == "data-version" and not version:
                    version = value.strip()
                continue
            if tag == "id":
                term = Term(id=value.strip())
                terms[term.id] = term
            elif term is None:
                continue
            elif tag == "name":
                term.name = value.strip()
            elif tag == "def":
                match = DEFINITION.match(value)
                if match:
                    term.definition = unescape(match.group(1))
                    term.definition_sources = split_sources(match.group(2))
            elif tag == "synonym":
                match = SYNONYM.match(value)
                if match:
                    term.synonyms.append(
                        Synonym(
                            text=unescape(match.group(1)),
                            scope=match.group(2),
                            kind=match.group(3) or "",
                            sources=split_sources(match.group(4)),
                        )
                    )
            elif tag == "alt_id":
                term.alternative_ids.append(value.strip())
                alternative_ids[value.strip()] = term.id
            elif tag == "is_a":
                term.parents.append(value.split(" ", 1)[0])
            elif tag == "relationship":
                match = GERMLINE_GENE.match(value)
                if match:
                    term.germline_genes.append("HGNC:" + match.group(1))
            elif tag == "is_obsolete":
                term.obsolete = value.strip() == "true"
    return Ontology(version=version, terms=terms, alternative_ids=alternative_ids)
