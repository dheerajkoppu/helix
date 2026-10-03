"""Map IUIS entries to MONDO, Orphanet and OMIM identifiers.

Strategy (docs/research/iei-dataset.md section 6). An identifier is recorded only
when one of these routes yields a single answer; otherwise the lists stay empty.

  iuis_omim           The IUIS row prints a phenotype MIM number that Mondo maps exactly
                      (SSSOM). Rejected when open sources attribute that disease to other
                      genes only.
  gene_label          Among the gene's diseases whose mode of inheritance fits the row, exactly
                      one shares its name with the IUIS label (an equal name wins over a
                      partial one). Candidate diseases come from GenCC (Supportive or better)
                      and from Mondo's germline gene links.
  clingen_panel       A ClinGen immunology expert panel curated exactly one immune-relevant
                      disease for the gene with a fitting mode of inheritance (grouping terms
                      only when Mondo attributes them to this gene).
  gene_specific       Exactly one candidate is an immune-relevant disease that Mondo attributes
                      to germline variants in this gene and whose stated mode of inheritance
                      fits the row.
  orphanet_mechanism  The row is a gain-of-function entry and the gene has exactly one
                      immune-relevant Orphanet disorder caused by gain-of-function variants.
  orphanet_label      Exactly one germline disease-causing Orphanet disorder of the gene fits
                      the inheritance and shares its name with the IUIS label.
  label_exact         Entries without a germline gene (unknown cause, deletions, phenocopies):
                      the IUIS label, with or without its parenthetical part, equals the name
                      of exactly one Mondo disease that no differently labelled row holds.
  curated             A committed override (disease_overrides.json) for an entry the routes above
                      leave unmapped, verified against Mondo on every build.

When candidates are nested in the Mondo hierarchy the most specific one is kept. The gene
routes never assign a disease that a differently labelled row of the same gene already
holds, and never assign one disease to two differently labelled rows. No route works by
elimination, because IUIS occasionally prints one row's OMIM number in a sibling row.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .clingen import Clingen
from .gencc import Gencc
from .hgnc import Hgnc
from .hpo import Hpoa, descendants
from .obo import Ontology
from .orphadata import Orphadata

GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ζ": "zeta",
    "η": "eta", "θ": "theta", "κ": "kappa", "λ": "lambda", "μ": "mu", "ω": "omega", "µ": "mu",
}  # fmt: skip
ASCII_FOLDS = {"ø": "o", "Ø": "O", "ß": "ss", "æ": "ae", "Æ": "AE", "ł": "l", "Ł": "L", "đ": "d"}

IMMUNE_ROOTS = {"MONDO:0005046", "MONDO:0003778"}
# Immunodeficiency, unusual infection, humoral immunity, leukocyte count, lymphocyte physiology,
# systemic autoinflammation, hemophagocytosis, autoimmunity.
IMMUNE_PHENOTYPE_ROOTS = (
    "HP:0002721", "HP:0032101", "HP:0005368", "HP:0011893",
    "HP:0031409", "HP:0033428", "HP:0012156", "HP:0002960",
)  # fmt: skip
GAIN_OF_FUNCTION = "(gain of function)"
OVERRIDES_PATH = Path(__file__).with_name("disease_overrides.json")


class OverrideMismatch(ValueError):
    pass


X_LINKED = {"HP:0001417", "HP:0001419", "HP:0001423"}
ROW_INHERITANCE = {"AR": {"HP:0000007"}, "AD": {"HP:0000006"}, "XL": X_LINKED, "XLR": X_LINKED}
GENCC_INHERITANCE = {
    "HP:0000007": {"HP:0000007"},
    "HP:0000006": {"HP:0000006"},
    "HP:0001417": X_LINKED,
    "HP:0001419": X_LINKED,
    "HP:0001423": X_LINKED,
    "HP:0032113": {"HP:0000006", "HP:0000007"},
}
ORPHANET_INHERITANCE = {
    "Autosomal recessive": {"HP:0000007"},
    "Autosomal dominant": {"HP:0000006"},
    "X-linked recessive": X_LINKED,
    "X-linked dominant": X_LINKED,
    "Semi-dominant": {"HP:0000006", "HP:0000007"},
}
SINGLE_WORD_MINIMUM = 8


@dataclass
class Unit:
    """One catalog disease: an IUIS row, or one gene of a row that names several."""

    key: int
    label: str
    hgnc_id: str | None
    symbol: str | None
    inheritance_codes: list[str]
    mechanism: list[str]
    mim_numbers: list[str]
    is_phenocopy: bool


@dataclass
class Mapped:
    mondo: list[str] = field(default_factory=list)
    orphanet: list[str] = field(default_factory=list)
    omim: list[str] = field(default_factory=list)
    route: str = "unmapped"
    gencc_records: list[str] = field(default_factory=list)
    clingen_report: str = ""
    notes: list[str] = field(default_factory=list)


@dataclass
class Candidate:
    mondo_id: str
    title: str
    inheritance: set[str] | None
    gencc_records: list[str]


@dataclass
class CrossReferences:
    mondo_by_omim: dict[str, str]
    omim_by_mondo: dict[str, list[str]]
    mondo_by_orphanet: dict[str, str]
    orphanet_by_mondo: dict[str, list[str]]


def read_sssom(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8") as handle:
        lines = [line for line in handle.read().splitlines() if not line.startswith("#")]
    return [row for row in csv.DictReader(lines, delimiter="\t") if row["predicate_id"] == "skos:exactMatch"]


def sssom_version(path: Path) -> str:
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith("#"):
                break
            match = re.search(r"mapping_set_version: \S*?/releases/([\d-]+)/", line)
            if match:
                return match.group(1)
    return ""


def load_cross_references(omim_path: Path, orphanet_path: Path) -> CrossReferences:
    mondo_by_omim: dict[str, str] = {}
    omim_by_mondo: dict[str, list[str]] = defaultdict(list)
    for row in read_sssom(omim_path):
        mim_number = row["object_id"].split(":", 1)[1]
        mondo_by_omim[mim_number] = row["subject_id"]
        omim_by_mondo[row["subject_id"]].append(mim_number)
    mondo_by_orphanet: dict[str, str] = {}
    orphanet_by_mondo: dict[str, list[str]] = defaultdict(list)
    for row in read_sssom(orphanet_path):
        code = "ORPHA:" + row["object_id"].split(":", 1)[1]
        mondo_by_orphanet[code] = row["subject_id"]
        orphanet_by_mondo[row["subject_id"]].append(code)
    return CrossReferences(mondo_by_omim, dict(omim_by_mondo), mondo_by_orphanet, dict(orphanet_by_mondo))


def to_ascii(text: str) -> str:
    """ASCII text with Greek letters spelled out and accents removed; other symbols become spaces."""
    for letter, name in GREEK.items():
        text = text.replace(letter, f" {name} ")
    for letter, replacement in ASCII_FOLDS.items():
        text = text.replace(letter, replacement)
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(character for character in decomposed if not unicodedata.combining(character))
    return "".join(character if character.isascii() else " " for character in stripped)


def fold(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", to_ascii(text).lower()).split())


def label_variants(label: str) -> set[str]:
    """The IUIS label, its parenthetical parts and its comma or slash separated parts."""
    flat = re.sub(r"\[.*?\]", " ", label)
    pieces = [label, flat, re.sub(r"\(.*?\)", " ", flat)]
    pieces += re.findall(r"\((.*?)\)", flat) + re.findall(r"\[(.*?)\]", label)
    for piece in list(pieces):
        pieces += re.split(r",|/|;| or ", piece)
    return {folded for folded in (fold(piece) for piece in pieces) if len(folded) >= 3}


def names_match(variants: set[str], names: set[str]) -> bool:
    """Equal names, a label part inside a disease name, or a multi-word disease name inside a label part."""
    for variant in variants:
        padded_variant = f" {variant} "
        for name in names:
            if variant == name:
                return True
            if (" " in variant or len(variant) >= SINGLE_WORD_MINIMUM) and padded_variant in f" {name} ":
                return True
            if " " in name and f" {name} " in padded_variant:
                return True
    return False


def row_constraint(codes: list[str]) -> set[str]:
    constraint: set[str] = set()
    for code in codes:
        constraint |= ROW_INHERITANCE.get(code, set())
    return constraint


def fits(constraint: set[str], candidate) -> bool:
    """A candidate with no stated inheritance cannot contradict the row."""
    return not constraint or candidate is None or bool(constraint & candidate)


def hpo_inheritance(curies) -> set[str] | None:
    known: set[str] = set()
    for curie in curies:
        known |= GENCC_INHERITANCE.get(curie, set())
    return known or None


def orphanet_inheritance(names: list[str]) -> set[str] | None:
    known: set[str] = set()
    for name in names:
        known |= ORPHANET_INHERITANCE.get(name, set())
    return known or None


class Mapper:
    def __init__(
        self,
        hgnc: Hgnc,
        mondo: Ontology,
        cross: CrossReferences,
        gencc: Gencc,
        clingen: Clingen,
        orphadata: Orphadata,
        hpo: Ontology,
        hpoa: Hpoa,
    ):
        self.hgnc = hgnc
        self.mondo = mondo
        self.cross = cross
        self.gencc = gencc
        self.clingen = clingen
        self.orphadata = orphadata
        self.hpoa = hpoa
        self.immune_phenotypes = frozenset().union(
            *(descendants(hpo, root) for root in IMMUNE_PHENOTYPE_ROOTS)
        )
        self.grouping_terms = {parent for term in mondo.terms.values() for parent in term.parents}
        self.mondo_by_gene: dict[str, list[str]] = defaultdict(list)
        self.genes_by_mondo: dict[str, set[str]] = defaultdict(set)
        for term in mondo.terms.values():
            if term.obsolete:
                continue
            for hgnc_id in term.germline_genes:
                self.mondo_by_gene[hgnc_id].append(term.id)
                self.genes_by_mondo[term.id].add(hgnc_id)
        for hgnc_id, pairs in gencc.by_gene.items():
            for mondo_id in pairs:
                self.genes_by_mondo[mondo_id].add(hgnc_id)
        self.ancestors = lru_cache(maxsize=None)(self._ancestors)
        self.is_immune = lru_cache(maxsize=None)(self._is_immune)

    def _ancestors(self, mondo_id: str) -> frozenset[str]:
        term = self.mondo.get(mondo_id)
        found: set[str] = set()
        for parent in term.parents if term else []:
            found.add(parent)
            found |= self.ancestors(parent)
        return frozenset(found)

    def _is_immune(self, mondo_id: str) -> bool:
        """Classified under immune system disorders in Mondo, or annotated with an immune phenotype."""
        if (self.ancestors(mondo_id) | {mondo_id}) & IMMUNE_ROOTS:
            return True
        for mim_number in self.cross.omim_by_mondo.get(mondo_id, []):
            if any(
                item.hpo_id in self.immune_phenotypes
                for item in self.hpoa.phenotypes.get(f"OMIM:{mim_number}", [])
            ):
                return True
        return any(self.orphanet_is_immune(code) for code in self.orphanet_for_mondo(mondo_id))

    def orphanet_is_immune(self, code: str) -> bool:
        return any(
            item["hpo_id"] in self.immune_phenotypes and not (item["frequency"] or "").startswith("Excluded")
            for item in self.orphadata.disorders[code].phenotypes
        )

    def most_specific(self, mondo_ids: list[str]) -> list[str]:
        """Drop every disease that is an ancestor of another one in the list."""
        broader = {ancestor for mondo_id in mondo_ids for ancestor in self.ancestors(mondo_id)}
        return [mondo_id for mondo_id in dict.fromkeys(mondo_ids) if mondo_id not in broader]

    def active_orphanet(self, codes) -> list[str]:
        return sorted(
            {
                code
                for code in codes
                if code in self.orphadata.disorders and self.orphadata.disorders[code].active
            },
            key=lambda code: int(code.split(":")[1]),
        )

    def orphanet_for_mondo(self, mondo_id: str) -> list[str]:
        return self.active_orphanet(
            self.cross.orphanet_by_mondo.get(mondo_id, []) + self.orphadata.by_mondo.get(mondo_id, [])
        )

    def mondo_for_orphanet(self, code: str) -> list[str]:
        mondo_ids = {self.cross.mondo_by_orphanet.get(code), *self.orphadata.disorders[code].exact_mondo} - {
            None
        }
        return sorted(mondo_id for mondo_id in mondo_ids if self.usable_mondo(mondo_id))

    def linked_genes(self, mondo_id: str, mim_number: str | None = None) -> set[str]:
        """Genes that GenCC, Mondo or Orphanet name as the germline cause of this disease."""
        genes = set(self.genes_by_mondo.get(mondo_id, set()))
        codes = self.orphanet_for_mondo(mondo_id)
        if mim_number:
            codes += self.active_orphanet(self.orphadata.by_omim.get(mim_number, []))
        for code in codes:
            genes |= set(self.orphadata.disorders[code].causal_genes)
        return genes

    def mondo_names(self, mondo_id: str, extra: str = "") -> set[str]:
        names = {fold(extra)} if extra else set()
        term = self.mondo.get(mondo_id)
        if term is not None:
            names.add(fold(term.name))
            names |= {
                fold(synonym.text)
                for synonym in term.synonyms
                if synonym.scope == "EXACT" or synonym.kind == "ABBREVIATION"
            }
        for code in self.orphanet_for_mondo(mondo_id):
            names |= self.orphanet_names(code)
        return {name for name in names if len(name) >= 3}

    def orphanet_names(self, code: str) -> set[str]:
        disorder = self.orphadata.disorders[code]
        return {fold(name) for name in [disorder.name, *disorder.synonyms] if len(fold(name)) >= 3}

    def attributed_elsewhere(self, mondo_id: str, hgnc_id: str) -> bool:
        """Mondo names germline genes for this disease and this gene is not one of them."""
        genes = self.mondo.get(mondo_id).germline_genes
        return bool(genes) and hgnc_id not in genes

    def usable_mondo(self, mondo_id: str) -> bool:
        term = self.mondo.get(mondo_id)
        return term is not None and not term.obsolete

    def candidates(self, hgnc_id: str) -> dict[str, Candidate]:
        """Diseases of a gene from GenCC (Supportive or better) and from Mondo's germline gene links."""
        pool: dict[str, Candidate] = {}
        for mondo_id, pair in self.gencc.by_gene.get(hgnc_id, {}).items():
            if self.usable_mondo(mondo_id) and not self.attributed_elsewhere(mondo_id, hgnc_id):
                pool[mondo_id] = Candidate(
                    mondo_id, pair.title, hpo_inheritance(pair.inheritance), sorted(pair.records)
                )
        for mondo_id in self.mondo_by_gene.get(hgnc_id, []):
            annotated: set[str] = set()
            for mim_number in self.cross.omim_by_mondo.get(mondo_id, []):
                annotated |= self.hpoa.inheritance.get(f"OMIM:{mim_number}", set())
            if mondo_id in pool:
                pool[mondo_id].inheritance = pool[mondo_id].inheritance or hpo_inheritance(annotated)
            else:
                pool[mondo_id] = Candidate(mondo_id, "", hpo_inheritance(annotated), [])
        return pool

    def map_units(self, units: list[Unit]) -> dict[int, Mapped]:
        results = {unit.key: Mapped() for unit in units}
        for unit in units:
            self.route_iuis_omim(unit, results[unit.key])

        by_gene: dict[str, list[Unit]] = defaultdict(list)
        for unit in units:
            if unit.hgnc_id and not unit.is_phenocopy:
                by_gene[unit.hgnc_id].append(unit)
        for hgnc_id, siblings in by_gene.items():
            self.route_gene_disease(hgnc_id, siblings, results)
            self.route_orphanet(hgnc_id, siblings, results)

        self.route_label_exact(units, results)
        self.route_curated(units, results)
        for unit in units:
            self.complete(results[unit.key])
        return results

    def route_iuis_omim(self, unit: Unit, mapped: Mapped) -> None:
        for mim_number in unit.mim_numbers:
            if mim_number in self.hgnc.gene_mim_numbers:
                continue
            mondo_id = self.cross.mondo_by_omim.get(mim_number)
            if mondo_id is None or not self.usable_mondo(mondo_id):
                mapped.notes.append(f"IUIS OMIM number {mim_number} has no exact Mondo mapping; omitted")
                continue
            genes = self.linked_genes(mondo_id, mim_number)
            if unit.hgnc_id and genes and unit.hgnc_id not in genes:
                symbols = sorted(
                    row["symbol"] for row in self.hgnc.approved.values() if row["hgnc_id"] in genes
                )
                mapped.notes.append(
                    f"IUIS OMIM number {mim_number} ({mondo_id}) is attributed to {', '.join(symbols)} "
                    "by GenCC, Mondo or Orphanet and not to this gene; omitted"
                )
                continue
            mapped.omim.append(f"OMIM:{mim_number}")
            mapped.mondo.append(mondo_id)
            mapped.route = "iuis_omim"

    def route_gene_disease(self, hgnc_id: str, siblings: list[Unit], results: dict[int, Mapped]) -> None:
        pool = self.candidates(hgnc_id)
        curations = [
            item for item in self.clingen.by_gene.get(hgnc_id, []) if self.usable_mondo(item.mondo_id)
        ]
        labels = {unit.key: fold(unit.label) for unit in siblings}
        holders: dict[str, set[str]] = defaultdict(set)
        for unit in siblings:
            for mondo_id in results[unit.key].mondo:
                holders[mondo_id].add(labels[unit.key])

        proposals: dict[int, tuple[str, str]] = {}
        for unit in siblings:
            if results[unit.key].mondo:
                continue
            constraint = row_constraint(unit.inheritance_codes)
            variants = label_variants(unit.label)
            fitting = [
                mondo_id for mondo_id, candidate in pool.items() if fits(constraint, candidate.inheritance)
            ]
            names = {mondo_id: self.mondo_names(mondo_id, pool[mondo_id].title) for mondo_id in fitting}
            named = [mondo_id for mondo_id in fitting if variants & names[mondo_id]]
            if len(named) != 1:
                named = self.most_specific(
                    [mondo_id for mondo_id in fitting if names_match(variants, names[mondo_id])]
                )
            specific = self.most_specific(
                [
                    mondo_id
                    for mondo_id in fitting
                    if hgnc_id in self.mondo.get(mondo_id).germline_genes
                    and (not constraint or pool[mondo_id].inheritance is not None)
                    and self.is_immune(mondo_id)
                ]
            )
            curated = self.most_specific(
                sorted(
                    {
                        item.mondo_id
                        for item in curations
                        if fits(constraint, item.inheritance)
                        and (not constraint or item.inheritance is not None)
                        and not self.attributed_elsewhere(item.mondo_id, hgnc_id)
                        and self.is_immune(item.mondo_id)
                        and (
                            item.mondo_id not in self.grouping_terms
                            or hgnc_id in self.mondo.get(item.mondo_id).germline_genes
                        )
                    }
                )
            )
            if len(named) == 1:
                proposals[unit.key] = (named[0], "gene_label")
            elif len(curated) == 1:
                proposals[unit.key] = (curated[0], "clingen_panel")
            elif len(specific) == 1:
                proposals[unit.key] = (specific[0], "gene_specific")

        for key, (mondo_id, route) in proposals.items():
            if route != "gene_label":
                if holders[mondo_id] - {labels[key]}:
                    results[key].notes.append(
                        f"{route}: {mondo_id} already belongs to a differently labelled IUIS row "
                        "of this gene; left unmapped"
                    )
                    continue
                rivals = [
                    other
                    for other, (other_id, _) in proposals.items()
                    if other != key and other_id == mondo_id and labels[other] != labels[key]
                ]
                if rivals:
                    results[key].notes.append(
                        f"{route}: {mondo_id} fits more than one IUIS row of this gene; left unmapped"
                    )
                    continue
            results[key].mondo.append(mondo_id)
            results[key].route = route
            if mondo_id in pool:
                results[key].gencc_records = pool[mondo_id].gencc_records
            if route == "clingen_panel":
                results[key].clingen_report = next(
                    item.report_url for item in curations if item.mondo_id == mondo_id
                )

    def route_orphanet(self, hgnc_id: str, siblings: list[Unit], results: dict[int, Mapped]) -> None:
        codes = [
            code
            for code in self.active_orphanet(self.orphadata.by_gene.get(hgnc_id, []))
            if self.orphadata.disorders[code].group != "Group of disorders"
        ]
        labels = {unit.key: fold(unit.label) for unit in siblings}
        open_units = [unit for unit in siblings if not results[unit.key].mondo]
        gain_rows = [unit for unit in open_units if unit.mechanism == ["gain_of_function"]]
        for unit in open_units:
            constraint = row_constraint(unit.inheritance_codes)
            fitting = [
                code
                for code in codes
                if fits(constraint, orphanet_inheritance(self.orphadata.disorders[code].inheritance))
            ]
            gain = [
                code
                for code in fitting
                if GAIN_OF_FUNCTION in self.orphadata.disorders[code].causal_genes[hgnc_id]
                and (
                    self.orphanet_is_immune(code)
                    or any(self.is_immune(item) for item in self.mondo_for_orphanet(code))
                )
            ]
            variants = label_variants(unit.label)
            named = [code for code in fitting if names_match(variants, self.orphanet_names(code))]
            if len(named) == 1:
                chosen, route = named[0], "orphanet_label"
            elif unit in gain_rows and len(gain_rows) == 1 and len(gain) == 1:
                chosen, route = gain[0], "orphanet_mechanism"
                held_elsewhere = any(
                    mondo_id in results[other.key].mondo and labels[other.key] != labels[unit.key]
                    for other in siblings
                    for mondo_id in self.mondo_for_orphanet(chosen)
                )
                if held_elsewhere:
                    continue
            else:
                continue
            results[unit.key].orphanet.append(chosen)
            results[unit.key].route = route
            results[unit.key].mondo = self.mondo_for_orphanet(chosen)

    def route_label_exact(self, units: list[Unit], results: dict[int, Mapped]) -> None:
        """Entries without a germline gene: a multi-word part of the label equals one Mondo disease name."""
        by_name: dict[str, set[str]] = defaultdict(set)
        for term in self.mondo.terms.values():
            if term.obsolete or not term.id.startswith("MONDO:"):
                continue
            synonyms = [
                item.text for item in term.synonyms if item.scope == "EXACT" or item.kind == "ABBREVIATION"
            ]
            for name in [term.name, *synonyms]:
                by_name[fold(name)].add(term.id)
        holders: dict[str, set[str]] = defaultdict(set)
        for unit in units:
            for mondo_id in results[unit.key].mondo:
                holders[mondo_id].add(fold(unit.label))
        for unit in units:
            if results[unit.key].mondo or (unit.hgnc_id and not unit.is_phenocopy):
                continue
            whole = [unit.label, re.sub(r"\(.*?\)", " ", unit.label), *re.findall(r"\((.*?)\)", unit.label)]
            matches = {
                mondo_id
                for variant in {fold(piece) for piece in whole}
                if " " in variant or len(variant) >= 4
                for mondo_id in by_name.get(variant, set())
            }
            if len(matches) != 1:
                continue
            mondo_id = next(iter(matches))
            if holders[mondo_id] - {fold(unit.label)}:
                results[unit.key].notes.append(
                    f"label_exact: {mondo_id} already belongs to a differently labelled IUIS row; "
                    "left unmapped"
                )
                continue
            results[unit.key].mondo.append(mondo_id)
            results[unit.key].route = "label_exact"

    def route_curated(self, units: list[Unit], results: dict[int, Mapped]) -> None:
        """Committed overrides for entries still unmapped; each one is checked against Mondo before use."""
        problems: list[str] = []
        for override in json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))["overrides"]:
            mondo_id, label, symbol = override["mondo_id"], override["label"], override["gene_symbol"]
            targets = [unit for unit in units if unit.label == label and unit.symbol == symbol]
            term = self.mondo.get(mondo_id)
            if not targets:
                problems.append(f"{label!r} ({symbol}): no such IUIS entry")
            elif term is None or term.obsolete:
                problems.append(f"{label!r}: {mondo_id} is missing or obsolete in Mondo")
            elif fold(override["evidence_name"]) not in {
                fold(name) for name in [term.name, *(item.text for item in term.synonyms)]
            }:
                problems.append(f"{label!r}: {mondo_id} is not named {override['evidence_name']!r} in Mondo")
            elif symbol and self.attributed_elsewhere(mondo_id, targets[0].hgnc_id):
                problems.append(f"{label!r}: Mondo attributes {mondo_id} to other genes than {symbol}")
            else:
                for unit in targets:
                    if not results[unit.key].mondo and not results[unit.key].orphanet:
                        results[unit.key].mondo.append(mondo_id)
                        results[unit.key].route = "curated"
        if problems:
            raise OverrideMismatch(
                "disease_overrides.json no longer matches its sources:\n  " + "\n  ".join(problems)
            )

    def complete(self, mapped: Mapped) -> None:
        """Fill the remaining identifier lists through exact mappings only."""
        mapped.mondo = sorted(dict.fromkeys(mapped.mondo))
        orphanet = list(mapped.orphanet)
        for mondo_id in mapped.mondo:
            orphanet += self.orphanet_for_mondo(mondo_id)
        for curie in mapped.omim:
            orphanet += self.orphadata.by_omim.get(curie.split(":")[1], [])
        mapped.orphanet = self.active_orphanet(orphanet)
        if not mapped.omim:
            numbers = {
                number for mondo_id in mapped.mondo for number in self.cross.omim_by_mondo.get(mondo_id, [])
            }
            mapped.omim = [f"OMIM:{number}" for number in sorted(numbers)]
