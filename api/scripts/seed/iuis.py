"""IUIS 2024 classification (Poli et al. 2025) parsed from the article's JATS XML.

Only identifiers, codes and short labels are read: table and subtable, disease
label, gene cell, inheritance code and OMIM number. The clinical free-text
columns of the published tables are never extracted.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from pathlib import Path

from .hgnc import Hgnc

OVERRIDES_PATH = Path(__file__).with_name("symbol_overrides.json")

EXTRACTED_COLUMNS = {
    "Disease",
    "Genetic defect",
    "Genetic defect/presumed pathogenesis",
    "Inheritance",
    "OMIM",
    "Gene OMIM",
}

# Order matters: XLR is tested before XL so the more specific code wins.
INHERITANCE_CODES = [
    (re.compile(r"XLR"), "XLR", "HP:0001419"),
    (re.compile(r"XL(?!R)"), "XL", "HP:0001417"),
    (re.compile(r"AR"), "AR", "HP:0000007"),
    (re.compile(r"AD"), "AD", "HP:0000006"),
    (re.compile(r"digenic", re.IGNORECASE), "DIGENIC", "HP:0010984"),
    (re.compile(r"sporadic", re.IGNORECASE), "SPORADIC", "HP:0003745"),
    (re.compile(r"somatic", re.IGNORECASE), "SOMATIC", "HP:0001442"),
]
INHERITANCE_HPO = {code: hpo_id for _, code, hpo_id in INHERITANCE_CODES}

MECHANISMS = [
    (re.compile(r"GOF"), "gain_of_function"),
    (re.compile(r"\bDN\b|dominant negative", re.IGNORECASE), "dominant_negative"),
    (re.compile(r"haploinsufficiency", re.IGNORECASE), "haploinsufficiency"),
    (re.compile(r"neomorph", re.IGNORECASE), "neomorph"),
    (re.compile(r"LOF"), "loss_of_function"),
]


class UnresolvedGeneCell(ValueError):
    pass


@dataclass
class Subtable:
    index: int
    name: str


@dataclass
class Table:
    number: int
    anchor: str
    title: str
    subtables: list[Subtable] = field(default_factory=list)


@dataclass
class Entry:
    table: int
    subtable: Subtable | None
    row: int
    disease_label: str
    gene_cell: str
    symbols: list[str]
    inheritance_raw: str
    inheritance_codes: list[str]
    mechanism: list[str]
    mim_numbers: list[str]


@dataclass
class Article:
    title: str
    authors: list[tuple[str, str]]
    journal: str
    journal_abbreviation: str
    volume: str
    issue: str
    elocation_id: str
    year: str
    published: str
    doi: str
    pmid: str
    pmcid: str
    license_url: str


def cell_text(element) -> str:
    """Text of a JATS element without its table-footnote markers."""
    if element is None:
        return ""
    parts: list[str] = []

    def walk(node) -> None:
        if node.tag == "xref" and node.get("ref-type") == "table-fn":
            return
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(element)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def load_overrides() -> dict:
    return json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))


def genes_from_cell(cell: str, hgnc: Hgnc, overrides: dict) -> list[str]:
    """Approved HGNC symbols named in an IUIS "Genetic defect" cell; raises when a token is unresolved."""
    cell_overrides = overrides["cell_overrides"]
    embedded_symbol = re.compile("(" + "|".join(overrides["embedded_symbols"]) + ")")
    no_gene = re.compile(overrides["no_gene_cell_pattern"], re.IGNORECASE)

    cell = re.sub(r"\s+", " ", cell or "").strip()
    if cell in cell_overrides:
        return list(cell_overrides[cell])
    embedded = embedded_symbol.search(cell)
    if embedded and (" " in cell or "variants" in cell):
        return [embedded.group(1)]
    if no_gene.search(cell):
        bracketed = re.search(r"\(([A-Z0-9]+)\)", cell)
        return [bracketed.group(1)] if bracketed and bracketed.group(1) in hgnc.approved else []
    stripped = re.sub(r"\(.*?\)", "", cell)
    stripped = re.sub(r"\b(GOF|LOF|DN|AR|AD|XL)\b", "", stripped).replace("*", "")
    symbols: list[str] = []
    for token in filter(None, re.split(r"[\s,+./;]+", stripped)):
        token = cell_overrides.get(token, [token])[0]
        symbol = hgnc.resolve(token) or hgnc.resolve(re.sub(r"[a-c]$", "", token))
        if symbol is None:
            raise UnresolvedGeneCell(f"unresolved IUIS gene cell {cell!r} (token {token!r})")
        if symbol not in symbols:
            symbols.append(symbol)
    return symbols


def somatic_gene_from_cell(cell: str, hgnc: Hgnc) -> list[str]:
    """Gene named in a Table 10 "Somatic mutation in <symbol>" cell."""
    match = re.search(r"mutations? in ([A-Za-z0-9-]+)", cell)
    symbol = hgnc.resolve(match.group(1)) if match else None
    if symbol is None:
        raise UnresolvedGeneCell(f"unresolved IUIS somatic gene cell {cell!r}")
    return [symbol]


def expand_table(table, wanted: set[int]):
    """Yield (cells_by_column, column_spans) per body row, honouring rowspan and colspan.

    Text is taken only from the wanted columns; every other cell is tracked for layout and left unread.
    """
    carried: dict[int, list] = {}
    for table_row in table.find("tbody").findall("tr"):
        cells: dict[int, str] = {}
        column = 0
        spans: list[int] = []
        for cell in table_row:
            while column in carried:
                cells[column] = carried[column][0]
                carried[column][1] -= 1
                if carried[column][1] == 0:
                    del carried[column]
                column += 1
            row_span = int(cell.get("rowspan", "1"))
            column_span = int(cell.get("colspan", "1"))
            spans.append(column_span)
            for _ in range(column_span):
                cells[column] = cell_text(cell) if column in wanted else ""
                if row_span > 1:
                    carried[column] = [cells[column], row_span - 1]
                column += 1
        for column in [key for key in carried if key not in cells]:
            cells[column] = carried[column][0]
            carried[column][1] -= 1
            if carried[column][1] == 0:
                del carried[column]
        yield cells, spans


def clean_heading(heading: str) -> str:
    """Drop the leading subtable number ("1. T-B+ SCID" becomes "T-B+ SCID")."""
    return (
        re.sub(r"^\s*(?:sub)?(?:table)?\s*\d+\s*[.:)]?\s*", "", heading, flags=re.IGNORECASE).strip()
        or heading.strip()
    )


def parse_article(root) -> Article:
    front = root.find("front")
    meta = front.find("article-meta")
    identifiers = {item.get("pub-id-type"): item.text for item in meta.findall("article-id")}
    abbreviations = {
        item.get("journal-id-type"): item.text for item in front.findall("journal-meta/journal-id")
    }
    published = next(
        (item.get("iso-8601-date") for item in meta.findall("pub-date") if item.get("pub-type") == "epub"),
        "",
    )
    license_url = next((element.text for element in meta.iter() if element.tag.endswith("license_ref")), "")
    authors = [
        (cell_text(contributor.find("name/surname")), cell_text(contributor.find("name/given-names")))
        for contributor in meta.findall("contrib-group/contrib")
        if contributor.get("contrib-type") == "author"
    ]
    return Article(
        title=cell_text(meta.find("title-group/article-title")),
        authors=authors,
        journal=cell_text(front.find("journal-meta/journal-title-group/journal-title")),
        journal_abbreviation=abbreviations.get("iso-abbrev", ""),
        volume=cell_text(meta.find("volume")),
        issue=cell_text(meta.find("issue")),
        elocation_id=cell_text(meta.find("elocation-id")),
        year=published[:4],
        published=published,
        doi=identifiers.get("doi", ""),
        pmid=identifiers.get("pmid", ""),
        pmcid=identifiers.get("pmcid", ""),
        license_url=license_url or "",
    )


def parse_jats(path: Path, hgnc: Hgnc) -> tuple[Article, list[Table], list[Entry]]:
    root = ElementTree.fromstring(path.read_text(encoding="utf-8"))
    if root.tag != "article":
        root = root.find(".//article")
    overrides = load_overrides()
    article = parse_article(root)
    tables: list[Table] = []
    entries: list[Entry] = []
    unresolved: list[str] = []

    for table_wrap in root.findall(".//table-wrap"):
        number = int(re.search(r"\d+", cell_text(table_wrap.find("label"))).group())
        table = Table(
            number=number, anchor=table_wrap.get("id", ""), title=cell_text(table_wrap.find("caption"))
        )
        tables.append(table)
        row_number = 0
        for table_element in table_wrap.findall(".//table"):
            header = [cell_text(cell) for cell in table_element.find("thead").findall("tr")[-1]]
            wanted = [index for index, name in enumerate(header) if name in EXTRACTED_COLUMNS]
            current: Subtable | None = None
            for cells, spans in expand_table(table_element, set(wanted)):
                if len(spans) == 1 and spans[0] >= len(header) - 1:
                    heading = clean_heading(cells[0])
                    current = next((item for item in table.subtables if item.name == heading), None)
                    if current is None:
                        current = Subtable(index=len(table.subtables) + 1, name=heading)
                        table.subtables.append(current)
                    continue
                record = {header[index]: cells.get(index, "") for index in wanted}
                row_number += 1
                gene_cell = record.get("Genetic defect") or record.get(
                    "Genetic defect/presumed pathogenesis", ""
                )
                inheritance = record.get("Inheritance", "")
                symbols: list[str] = []
                codes = [code for pattern, code, _ in INHERITANCE_CODES if pattern.search(inheritance)]
                somatic_phenocopy = number == 10 and current is not None and "somatic" in current.name.lower()
                try:
                    if somatic_phenocopy:
                        symbols = somatic_gene_from_cell(gene_cell, hgnc)
                        codes = ["SOMATIC"]
                    elif number != 10:
                        symbols = genes_from_cell(gene_cell, hgnc, overrides)
                except UnresolvedGeneCell as error:
                    unresolved.append(f"Table {number} row {row_number}: {error}")
                context = f"{inheritance} {gene_cell} {record['Disease']}"
                mim_cell = record.get("OMIM") or record.get("Gene OMIM", "")
                entries.append(
                    Entry(
                        table=number,
                        subtable=current,
                        row=row_number,
                        disease_label=record["Disease"],
                        gene_cell=gene_cell,
                        symbols=symbols,
                        inheritance_raw=inheritance,
                        inheritance_codes=codes,
                        mechanism=[label for pattern, label in MECHANISMS if pattern.search(context)],
                        mim_numbers=list(dict.fromkeys(re.findall(r"(?<!\d)\d{6}(?!\d)", mim_cell))),
                    )
                )
        used = {
            id(entry.subtable) for entry in entries if entry.table == number and entry.subtable is not None
        }
        kept = [
            item
            for item in table.subtables
            if id(item) in used and item.name.casefold() != table.title.casefold()
        ]
        for entry in entries:
            if (
                entry.table == number
                and entry.subtable is not None
                and not any(entry.subtable is item for item in kept)
            ):
                entry.subtable = None
        for index, item in enumerate(kept, start=1):
            item.index = index
        table.subtables = kept
    if unresolved:
        raise UnresolvedGeneCell(
            "IUIS gene cells could not be resolved through HGNC or symbol_overrides.json:\n  "
            + "\n  ".join(unresolved)
        )
    return article, tables, entries
