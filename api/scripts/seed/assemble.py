"""Turn mapped IUIS entries into catalog disease records with openly licensed annotations."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .hpo import Hpoa
from .iuis import INHERITANCE_HPO, Entry, Table
from .mapping import GREEK, CrossReferences, Mapped, to_ascii
from .obo import Ontology, Term
from .orphadata import Disorder, Orphadata

IUIS_TABLE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC12829761/table/{anchor}/"
MONDO_URL = "https://monarchinitiative.org/{mondo_id}"
ORPHANET_URL = "https://www.orpha.net/en/disease/detail/{number}"
GENCC_URL = "https://search.thegencc.org/genes/{hgnc_id}"
HPOA_URL = "https://ontology.jax.org/api/network/annotation/{disease_id}"
HPO_TERM_URL = "http://purl.obolibrary.org/obo/{}"
EXCLUDED_FREQUENCY = "HP:0040285"
FREQUENCY_BANDS = ("Obligate", "Very frequent", "Frequent", "Occasional", "Very rare")
UNKNOWN_FREQUENCY_RANK = len(FREQUENCY_BANDS)
MINIMUM_COHORT = 5
SOURCE_ORDER = {"orphadata_product4": 0, "hpo_annotations": 1}
ACRONYM = re.compile(r"^(?=.*[A-Z])[A-Za-z0-9][A-Za-z0-9+-]{1,15}$")
NAME_LIKE = re.compile(r"(syndrome|disease|deficiency)$", re.IGNORECASE)
PROTEIN_CHANGE = re.compile(r"^[A-Z]\d+[A-Z]$")
NOT_NAMES = {"LOF", "GOF", "DN", "AR", "AD", "XL", "XLR", "X-linked"}
FRACTION = re.compile(r"^(\d+)\s*/\s*(\d+)$")
PERCENT = re.compile(r"^(\d+(?:\.\d+)?)\s*%$")


@dataclass
class DiseaseUnit:
    """One catalog disease: an IUIS row, or one gene of a row that names several."""

    key: int
    entry: Entry
    symbol: str | None
    hgnc_id: str | None


def category_id(table: int) -> str:
    return f"iuis-t{table}"


def subcategory_id(table: int, index: int) -> str:
    return f"{category_id(table)}-{chr(ord('a') + index - 1)}"


def categories(tables: list[Table]) -> list[dict]:
    return [
        {
            "id": category_id(table.number),
            "table": table.number,
            "name": table.title,
            "subcategories": [
                {"id": subcategory_id(table.number, item.index), "name": item.name}
                for item in table.subtables
            ],
        }
        for table in sorted(tables, key=lambda table: table.number)
    ]


def omim_only(sources: list[str]) -> bool:
    return bool(sources) and all(source.startswith(("OMIM:", "OMIMPS:")) for source in sources)


def alias_order(text: str) -> tuple[str, str]:
    return text.casefold(), text


def mondo_aliases(term: Term) -> list[str]:
    """Mondo label plus exact and abbreviation synonyms that are not sourced from OMIM alone."""
    synonyms = sorted(
        {
            synonym.text
            for synonym in term.synonyms
            if (synonym.scope == "EXACT" or synonym.kind == "ABBREVIATION") and not omim_only(synonym.sources)
        },
        key=alias_order,
    )
    return [term.name, *synonyms]


def plain_text(text: str) -> str:
    """ASCII spelling with Greek letters written out, for people who cannot type the IUIS label."""

    def spell(match: re.Match) -> str:
        before = " " if match.start() and text[match.start() - 1].isalnum() else ""
        after = " " if match.end() < len(text) and text[match.end()].isalnum() else ""
        return f"{before}{GREEK[match.group()]}{after}"

    spelled = re.sub("|".join(GREEK), spell, text)
    return " ".join(to_ascii(spelled.replace("–", "-").replace("—", "-").replace("’", "'")).split())


def label_aliases(label: str) -> list[str]:
    """Names inside the IUIS label itself: the label without its parenthetical parts and the names in them."""
    flat = re.sub(r"\[.*?\]", " ", label)
    short = re.sub(r"\s+([,;])", r"\1", " ".join(re.sub(r"\(.*?\)", " ", flat).split())).strip(" ,;")
    aliases = [short, plain_text(short)]
    for part in re.findall(r"\((.*?)\)", flat) + re.findall(r"\[(.*?)\]", label):
        pieces = [piece.strip() for piece in re.split(r"[,;/]", part)]
        if not re.search(r"[,;]", part):
            aliases += [piece for piece in pieces if NAME_LIKE.search(piece) and 2 <= len(piece.split()) <= 6]
        aliases += [
            piece
            for piece in pieces
            if ACRONYM.match(piece) and piece not in NOT_NAMES and not PROTEIN_CHANGE.match(piece)
        ]
    return [alias for alias in aliases if len(alias) >= 3]


def collect_aliases(name: str, disorder: Disorder | None, term: Term | None) -> list[str]:
    candidates = label_aliases(name)
    if disorder is not None:
        candidates += [disorder.name, *sorted(disorder.synonyms, key=alias_order)]
    if term is not None:
        candidates += mondo_aliases(term)
    seen = {name.casefold()}
    aliases: list[str] = []
    for candidate in candidates:
        candidate = " ".join(candidate.split())
        if candidate and candidate.casefold() not in seen:
            seen.add(candidate.casefold())
            aliases.append(candidate)
    return aliases


def frequency_rank(frequency: str | None) -> int:
    """Sort position of a frequency; fractions observed in fewer than MINIMUM_COHORT people stay unranked."""
    if not frequency:
        return UNKNOWN_FREQUENCY_RANK
    for rank, band in enumerate(FREQUENCY_BANDS):
        if frequency.startswith(band):
            return rank
    fraction = FRACTION.match(frequency)
    if fraction and int(fraction.group(2)) < MINIMUM_COHORT:
        return UNKNOWN_FREQUENCY_RANK
    ratio = frequency_ratio(frequency)
    if ratio is None:
        return UNKNOWN_FREQUENCY_RANK
    if ratio >= 1:
        return 0
    if ratio >= 0.8:
        return 1
    if ratio >= 0.3:
        return 2
    if ratio >= 0.05:
        return 3
    return 4


def frequency_ratio(frequency: str) -> float | None:
    fraction = FRACTION.match(frequency)
    if fraction:
        return int(fraction.group(1)) / int(fraction.group(2)) if int(fraction.group(2)) else None
    percent = PERCENT.match(frequency)
    return float(percent.group(1)) / 100 if percent else None


class Annotator:
    def __init__(
        self, mondo: Ontology, hpo: Ontology, hpoa: Hpoa, orphadata: Orphadata, cross: CrossReferences
    ):
        self.mondo = mondo
        self.hpo = hpo
        self.hpoa = hpoa
        self.orphadata = orphadata
        self.cross = cross

    def inheritance(self, entry: Entry) -> dict:
        terms = []
        for code in entry.inheritance_codes:
            hpo_id = INHERITANCE_HPO[code]
            label = self.hpo.label(hpo_id)
            if label is None:
                raise ValueError(f"HPO has no label for inheritance term {hpo_id}")
            terms.append({"id": hpo_id, "label": label})
        return {"raw": entry.inheritance_raw, "codes": list(entry.inheritance_codes), "hpo": terms}

    def definition(self, disorder: Disorder | None, term: Term | None) -> dict | None:
        if disorder is not None and disorder.definition:
            return {
                "text": disorder.definition,
                "source_id": "orphadata_product1",
                "url": ORPHANET_URL.format(number=disorder.code.split(":")[1]),
            }
        if term is not None and term.definition and not omim_only(term.definition_sources):
            return {"text": term.definition, "source_id": "mondo", "url": MONDO_URL.format(mondo_id=term.id)}
        return None

    def hpo_primary(self, hpo_id: str) -> str:
        return self.hpo.alternative_ids.get(hpo_id, hpo_id)

    def phenotypes(self, disorder: Disorder | None, omim: list[str]) -> list[dict]:
        """Orphanet annotations of the mapped disorder, then HPO annotations of its OMIM diseases."""
        rows: dict[str, dict] = {}
        if disorder is not None:
            for item in disorder.phenotypes:
                frequency = item["frequency"]
                if not item["hpo_id"] or (frequency or "").startswith("Excluded"):
                    continue
                rows.setdefault(
                    self.hpo_primary(item["hpo_id"]),
                    {
                        "hpo_id": item["hpo_id"],
                        "label": item["label"],
                        "frequency": frequency or None,
                        "source_id": "orphadata_product4",
                    },
                )
        for curie in omim:
            best: dict[str, tuple[int, str | None]] = {}
            for annotation in self.hpoa.phenotypes.get(curie, []):
                frequency = self.hpoa_frequency(annotation.frequency)
                if frequency == "":
                    continue
                fraction = FRACTION.match(frequency or "")
                weight = int(fraction.group(2)) if fraction else (1 if frequency else 0)
                if annotation.hpo_id not in best or weight > best[annotation.hpo_id][0]:
                    best[annotation.hpo_id] = (weight, frequency)
            for hpo_id, (_, frequency) in best.items():
                label = self.hpo.label(hpo_id)
                if label is None or self.hpo_primary(hpo_id) in rows:
                    continue
                rows[self.hpo_primary(hpo_id)] = {
                    "hpo_id": hpo_id,
                    "label": label,
                    "frequency": frequency,
                    "source_id": "hpo_annotations",
                }
        return sorted(
            rows.values(),
            key=lambda row: (
                frequency_rank(row["frequency"]),
                SOURCE_ORDER[row["source_id"]],
                row["label"].casefold(),
                row["hpo_id"],
            ),
        )

    def hpoa_frequency(self, raw: str) -> str | None:
        """Frequency as HPO states it: a label, a fraction or a percentage. "" marks an absent phenotype."""
        if not raw:
            return None
        if raw == EXCLUDED_FREQUENCY:
            return ""
        if raw.startswith("HP:"):
            return self.hpo.label(raw)
        ratio = frequency_ratio(raw)
        return "" if ratio == 0 else raw

    def disease(self, unit: DiseaseUnit, slug: str, mapped: Mapped) -> dict:
        entry = unit.entry
        disorder = self.orphadata.disorders[mapped.orphanet[0]] if len(mapped.orphanet) == 1 else None
        term = self.mondo.get(mapped.mondo[0]) if len(mapped.mondo) == 1 else None
        phenotypes = self.phenotypes(disorder, mapped.omim)
        return {
            "id": slug,
            "name": entry.disease_label,
            "aliases": collect_aliases(entry.disease_label, disorder, term),
            "gene_symbol": unit.symbol,
            "hgnc_id": unit.hgnc_id,
            "category_id": category_id(entry.table),
            "subcategory_id": subcategory_id(entry.table, entry.subtable.index) if entry.subtable else None,
            "inheritance": self.inheritance(entry),
            "mechanism": list(entry.mechanism),
            "is_phenocopy": entry.table == 10,
            "xrefs": {
                "mondo": list(mapped.mondo),
                "orphanet": list(mapped.orphanet),
                "omim": list(mapped.omim),
            },
            "definition": self.definition(disorder, term),
            "phenotypes": phenotypes,
            "provenance": self.provenance(unit, mapped, phenotypes),
        }

    def provenance(self, unit: DiseaseUnit, mapped: Mapped, phenotypes: list[dict]) -> list[dict]:
        entry = unit.entry
        location = f"Table {entry.table}" + (f".{entry.subtable.index}" if entry.subtable else "")
        records = [
            {
                "source_id": "iuis_2024",
                "record_id": f"{location} row {entry.row}",
                "url": IUIS_TABLE_URL.format(anchor=f"tbl{entry.table}"),
            }
        ]
        for mondo_id in mapped.mondo:
            records.append(
                {"source_id": "mondo", "record_id": mondo_id, "url": MONDO_URL.format(mondo_id=mondo_id)}
            )
            for mim_number in self.cross.omim_by_mondo.get(mondo_id, []):
                if f"OMIM:{mim_number}" in mapped.omim:
                    records.append(
                        {
                            "source_id": "mondo_sssom_omim",
                            "record_id": f"{mondo_id} exactMatch OMIM:{mim_number}",
                            "url": MONDO_URL.format(mondo_id=mondo_id),
                        }
                    )
            for code in self.cross.orphanet_by_mondo.get(mondo_id, []):
                if code in mapped.orphanet:
                    records.append(
                        {
                            "source_id": "mondo_sssom_orphanet",
                            "record_id": f"{mondo_id} exactMatch {code}",
                            "url": MONDO_URL.format(mondo_id=mondo_id),
                        }
                    )
        if mapped.gencc_records and unit.hgnc_id:
            records.append(
                {
                    "source_id": "gencc",
                    "record_id": f"{unit.hgnc_id} {mapped.mondo[0]}",
                    "url": GENCC_URL.format(hgnc_id=unit.hgnc_id),
                }
            )
        if mapped.clingen_report:
            records.append(
                {
                    "source_id": "clingen",
                    "record_id": mapped.clingen_report.rsplit("/", 1)[-1],
                    "url": mapped.clingen_report,
                }
            )
        for code in mapped.orphanet:
            url = ORPHANET_URL.format(number=code.split(":")[1])
            records.append({"source_id": "orphadata_product1", "record_id": code, "url": url})
            if mapped.route.startswith("orphanet_"):
                records.append(
                    {"source_id": "orphadata_product6", "record_id": f"{code} {unit.hgnc_id}", "url": url}
                )
            if (
                any(row["source_id"] == "orphadata_product4" for row in phenotypes)
                and len(mapped.orphanet) == 1
            ):
                records.append({"source_id": "orphadata_product4", "record_id": code, "url": url})
        if any(row["source_id"] == "hpo_annotations" for row in phenotypes):
            for curie in mapped.omim:
                if curie in self.hpoa.phenotypes:
                    records.append(
                        {
                            "source_id": "hpo_annotations",
                            "record_id": curie,
                            "url": HPOA_URL.format(disease_id=curie),
                        }
                    )
        for code in entry.inheritance_codes:
            hpo_id = INHERITANCE_HPO[code]
            records.append(
                {
                    "source_id": "hpo_ontology",
                    "record_id": hpo_id,
                    "url": HPO_TERM_URL.format(hpo_id.replace(":", "_")),
                }
            )
        return records
