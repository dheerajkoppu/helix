"""Federated search: entity resolution over the seeded catalog, then live sources.

Order of work: identifiers are parsed locally, the catalog index is matched (exact, alias, prefix,
token, fuzzy), and only what the catalog does not hold goes to a live source with a short timeout.
The rank orders rows of one query. It is a match rank, not a scientific score, and is not returned.
"""

import re
import time
import weakref
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any

from rapidfuzz import fuzz, process
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orphafold.db.models import Actor, Project
from orphafold.identifiers import (
    CHEMBL_ID_RE,
    CLINVAR_VCV_RE,
    INCHIKEY_RE,
    RSID_RE,
    UNIPROT_ACCESSION_PATTERN,
    ProteinSubstitution,
    parse_protein_change,
    parse_variant_id,
)
from orphafold.knowledge.catalog import (
    SEED_SOURCE_ID,
    Catalog,
    SeedDisease,
    SeedFlagship,
    SeedFlagshipVariant,
    SeedGene,
)
from orphafold.log import get_logger
from orphafold.schemas.common import (
    EntityType,
    EvidenceClass,
    SourceStatus,
    StructureOrigin,
    entity_href,
)
from orphafold.schemas.search import (
    SEARCH_GROUP_LABELS,
    MatchKind,
    ParsedIdentifier,
    SearchGroup,
    SearchIdentifier,
    SearchResponse,
    SearchResult,
    SearchResultType,
    StructureAvailability,
)
from orphafold.sources.base import SourceAdapter, SourceCall, SourceResult, gather_sources, get_source

logger = get_logger(__name__)

LIVE_TIMEOUT_SECONDS = 2.5
LIVE_TEXT_TIMEOUT_SECONDS = 4.0
# ChEMBL molecule search answers in 5 to 7 seconds when cold
CHEMBL_TIMEOUT_SECONDS = 9.0
DEFAULT_LIMIT = 8
MAX_ANCHORS = 3
FUZZY_CUTOFF = 82
# Identifier fields that are useful half-typed. Database accessions match whole or not at all.
PREFIX_IDENTIFIERS = frozenset({"Variant ID", "Catalog ID", "UniProt accession"})
SYMBOL_FUZZY_CUTOFF = 75

# Free-text search of these types needs a network call, so it runs only when asked for by name.
LIVE_TEXT_TYPES = frozenset({SearchResultType.COMPOUND, SearchResultType.PAPER})

TYPE_ORDER = list(SearchResultType)

_UNIPROT_RE = re.compile(rf"^({UNIPROT_ACCESSION_PATTERN})(-\d+)?$")
_HGNC_RE = re.compile(r"^HGNC[:\s]?\s*(\d+)$", re.IGNORECASE)
_ENSEMBL_GENE_RE = re.compile(r"^(ENSG\d{11})(?:\.\d+)?$", re.IGNORECASE)
_MONDO_RE = re.compile(r"^MONDO[:_\s]?\s*(\d{7})$", re.IGNORECASE)
_ORPHA_RE = re.compile(r"^(?:ORPHA|ORPHANET)[:_\s]?\s*(\d+)$", re.IGNORECASE)
_OMIM_RE = re.compile(r"^(?:OMIM|MIM)[:_\s]?\s*#?(\d{6})$", re.IGNORECASE)
_PDB_RE = re.compile(r"^(pdb[:_\s]?)?([1-9][A-Za-z0-9]{3})$", re.IGNORECASE)
_AFDB_RE = re.compile(rf"^(?:afdb:)?AF-({UNIPROT_ACCESSION_PATTERN})-F(\d+)$", re.IGNORECASE)
_PMID_RE = re.compile(r"^PMID[:\s]?\s*(\d{1,9})$", re.IGNORECASE)
_PMCID_RE = re.compile(r"^PMC\d+$", re.IGNORECASE)
_DOI_RE = re.compile(r"^(?:doi:\s*|https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/\S+)$", re.IGNORECASE)
_PROJECT_ID_RE = re.compile(r"^prj_[0-9A-Za-z]{20,32}$")
_GENE_SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,14}$")

_SEPARATORS = str.maketrans(dict.fromkeys("-_,;:/()[].", " ") | {"'": "", "’": ""})


def _normalise(text: str) -> str:
    return " ".join(text.casefold().translate(_SEPARATORS).split())


class _UniProtLookup(SourceAdapter):
    id = "uniprot"
    name = "UniProtKB"
    base_url = "https://rest.uniprot.org"
    homepage = "https://www.uniprot.org"
    license = "CC-BY-4.0"
    release_header = "x-uniprot-release"


class _PdbeLookup(SourceAdapter):
    id = "pdbe_sifts"
    name = "PDBe SIFTS"
    base_url = "https://www.ebi.ac.uk/pdbe/api"
    homepage = "https://www.ebi.ac.uk/pdbe"
    license = "CC0-1.0"
    empty_statuses = frozenset({204, 404})


class _EuropePmcLookup(SourceAdapter):
    id = "europe_pmc"
    name = "Europe PMC"
    base_url = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    homepage = "https://europepmc.org"


class _ChemblLookup(SourceAdapter):
    id = "chembl"
    name = "ChEMBL"
    base_url = "https://www.ebi.ac.uk/chembl/api/data"
    homepage = "https://www.ebi.ac.uk/chembl"
    license = "CC-BY-SA-3.0"


def _adapter(fallback: type[SourceAdapter], *other_ids: str) -> SourceAdapter:
    """The registered adapter of a source when a source module provides one, else a minimal one."""
    for source_id in (fallback.id, *other_ids):
        registered = get_source(source_id)
        if registered is not None:
            return registered
    return fallback()


@dataclass(slots=True)
class _Entry:
    text: str
    compact: str
    tokens: tuple[str, ...]
    display: str
    field: str
    field_label: str
    type: SearchResultType
    entity_id: str


@dataclass(slots=True)
class _Index:
    entries: list[_Entry]
    fuzzy_entries: list[_Entry]
    fuzzy_texts: list[str]
    symbol_entries: list[_Entry]
    symbol_texts: list[str]
    variants: dict[str, tuple[SeedFlagship, SeedFlagshipVariant]]
    variants_by_accession: dict[str, tuple[SeedFlagship, SeedFlagshipVariant]]


_index_cache: weakref.WeakKeyDictionary[Catalog, _Index] = weakref.WeakKeyDictionary()

_XREF_LABELS = {"MONDO": "MONDO ID", "ORPHA": "Orphanet ID", "OMIM": "OMIM number"}


def _build_index(catalog: Catalog) -> _Index:
    entries: list[_Entry] = []

    def add(
        display: str | None, field: str, field_label: str, result_type: SearchResultType, entity_id: str
    ) -> None:
        if not display:
            return
        text = _normalise(display)
        if text:
            entries.append(
                _Entry(
                    text,
                    text.replace(" ", ""),
                    tuple(text.split()),
                    display,
                    field,
                    field_label,
                    result_type,
                    entity_id,
                )
            )

    for gene in catalog.genes:
        add(gene.symbol, "symbol", "HGNC symbol", SearchResultType.GENE, gene.symbol)
        add(gene.name, "name", "Gene name", SearchResultType.GENE, gene.symbol)
        add(gene.hgnc_id, "identifier", "HGNC ID", SearchResultType.GENE, gene.symbol)
        add(gene.ensembl_gene_id, "identifier", "Ensembl gene ID", SearchResultType.GENE, gene.symbol)
        if gene.uniprot_accession:
            accession = gene.uniprot_accession
            add(accession, "identifier", "UniProt accession", SearchResultType.PROTEIN, accession)
            add(gene.protein_name, "name", "Protein name", SearchResultType.PROTEIN, accession)
    for disease in catalog.diseases:
        add(disease.name, "name", "Disease name", SearchResultType.DISEASE, disease.id)
        add(disease.id, "identifier", "Catalog ID", SearchResultType.DISEASE, disease.id)
        for alias in disease.aliases:
            add(alias, "alias", "Alias", SearchResultType.DISEASE, disease.id)
        for curie in (*disease.xrefs.mondo, *disease.xrefs.orphanet, *disease.xrefs.omim):
            label = _XREF_LABELS.get(curie.partition(":")[0].upper(), "Cross-reference")
            add(curie, "identifier", label, SearchResultType.DISEASE, disease.id)

    variants: dict[str, tuple[SeedFlagship, SeedFlagshipVariant]] = {}
    variants_by_accession: dict[str, tuple[SeedFlagship, SeedFlagshipVariant]] = {}
    for flagship in catalog.flagship:
        for variant in flagship.variants:
            variants[variant.id.upper()] = (flagship, variant)
            for accession in (variant.clinvar_vcv, variant.rsid):
                if accession:
                    variants_by_accession[accession.upper()] = (flagship, variant)
            add(variant.id, "identifier", "Variant ID", SearchResultType.VARIANT, variant.id)
            add(variant.clinvar_vcv, "identifier", "ClinVar accession", SearchResultType.VARIANT, variant.id)
            add(variant.rsid, "identifier", "dbSNP rsID", SearchResultType.VARIANT, variant.id)
            substitution = parse_variant_id(variant.id)
            if substitution is not None:
                add(
                    f"{flagship.gene_symbol} {substitution.short}",
                    "alias",
                    "Protein change",
                    SearchResultType.VARIANT,
                    variant.id,
                )

    fuzzy_entries = [entry for entry in entries if entry.field in ("name", "alias") and len(entry.text) >= 5]
    symbol_entries = [entry for entry in entries if entry.field == "symbol"]
    return _Index(
        entries=entries,
        fuzzy_entries=fuzzy_entries,
        fuzzy_texts=[entry.text for entry in fuzzy_entries],
        symbol_entries=symbol_entries,
        symbol_texts=[entry.text for entry in symbol_entries],
        variants=variants,
        variants_by_accession=variants_by_accession,
    )


def _index(catalog: Catalog) -> _Index:
    index = _index_cache.get(catalog)
    if index is None:
        index = _build_index(catalog)
        _index_cache[catalog] = index
    return index


def warm_search_index(catalog: Catalog) -> None:
    """Build the index ahead of the first query."""
    if catalog.ready:
        _index(catalog)


_STRONG_MATCHES = (MatchKind.IDENTIFIER, MatchKind.EXACT, MatchKind.ALIAS)


@dataclass(slots=True)
class _Hit:
    result: SearchResult
    rank: float


class _Results:
    """Best row per entity."""

    def __init__(self) -> None:
        self.hits: dict[tuple[SearchResultType, str], _Hit] = {}

    def add(self, result: SearchResult | None, rank: float, *, relation: bool = False) -> None:
        if result is None:
            return
        key = (result.type, result.id)
        current = self.hits.get(key)
        if current is None or rank > current.rank:
            self.hits[key] = _Hit(result, rank)
        elif relation and current.result.match not in _STRONG_MATCHES:
            # A stated relation reads better than a partial text match on the same entity
            self.hits[key] = _Hit(result, rank)

    def __len__(self) -> int:
        return len(self.hits)

    def best_rank(self) -> float:
        return max((hit.rank for hit in self.hits.values()), default=0.0)


def _identifier(source: str, value: str | None, url: str | None = None) -> list[SearchIdentifier]:
    return [SearchIdentifier(source=source, id=value, url=url)] if value else []


def _structures(gene: SeedGene) -> StructureAvailability | None:
    if not gene.uniprot_accession:
        return None
    return StructureAvailability(
        experimental_count=gene.stats.experimental_structure_count,
        has_alphafold_model=gene.stats.has_alphafold_model,
    )


def _gene_result(gene: SeedGene, match: MatchKind, reason: str, matched: str | None) -> SearchResult:
    hgnc_url = (
        f"https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/{gene.hgnc_id}"
        if gene.hgnc_id
        else None
    )
    return SearchResult(
        type=SearchResultType.GENE,
        id=gene.symbol,
        label=gene.symbol,
        description=gene.name,
        match=match,
        match_reason=reason,
        matched_text=matched,
        href=entity_href(EntityType.GENE, gene.symbol),
        external_url=hgnc_url,
        ids=[
            *_identifier("HGNC", gene.hgnc_id, hgnc_url),
            *_identifier(
                "Ensembl",
                gene.ensembl_gene_id,
                f"https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={gene.ensembl_gene_id}",
            ),
            *_identifier(
                "NCBI Gene", gene.ncbi_gene_id, f"https://www.ncbi.nlm.nih.gov/gene/{gene.ncbi_gene_id}"
            ),
        ],
        in_catalog=True,
        source=SEED_SOURCE_ID,
        evidence_class=EvidenceClass.CURATED_DATABASE,
        gene_symbol=gene.symbol,
        accession=gene.uniprot_accession,
        structures=_structures(gene),
    )


def _protein_result(
    gene: SeedGene, match: MatchKind, reason: str, matched: str | None
) -> SearchResult | None:
    accession = gene.uniprot_accession
    if not accession:
        return None
    length = f"{gene.protein_length} aa" if gene.protein_length else None
    uniprot_url = f"https://www.uniprot.org/uniprotkb/{accession}/entry"
    return SearchResult(
        type=SearchResultType.PROTEIN,
        id=accession,
        label=gene.protein_name or accession,
        description=" · ".join(part for part in (gene.symbol, length) if part),
        match=match,
        match_reason=reason,
        matched_text=matched,
        href=entity_href(EntityType.PROTEIN, accession),
        external_url=uniprot_url,
        ids=_identifier("UniProt", accession, uniprot_url),
        in_catalog=True,
        source=SEED_SOURCE_ID,
        evidence_class=EvidenceClass.CURATED_DATABASE,
        gene_symbol=gene.symbol,
        accession=accession,
        structures=_structures(gene),
    )


def _disease_xref_url(curie: str) -> str | None:
    prefix, _, number = curie.partition(":")
    match prefix.upper():
        case "MONDO":
            return f"https://monarchinitiative.org/{curie}"
        case "ORPHA":
            return f"https://www.orpha.net/en/disease/detail/{number}"
        case "OMIM":
            return f"https://omim.org/entry/{number}"
    return None


def _disease_result(disease: SeedDisease, match: MatchKind, reason: str, matched: str | None) -> SearchResult:
    xrefs = [*disease.xrefs.mondo, *disease.xrefs.orphanet, *disease.xrefs.omim]
    inheritance = ", ".join(disease.inheritance.codes) or None
    return SearchResult(
        type=SearchResultType.DISEASE,
        id=disease.id,
        label=disease.name,
        description=" · ".join(part for part in (disease.gene_symbol, inheritance) if part) or None,
        match=match,
        match_reason=reason,
        matched_text=matched,
        href=entity_href(EntityType.DISEASE, disease.id),
        external_url=_disease_xref_url(xrefs[0]) if xrefs else None,
        ids=[
            SearchIdentifier(source=curie.partition(":")[0], id=curie, url=_disease_xref_url(curie))
            for curie in xrefs
        ],
        in_catalog=True,
        source=SEED_SOURCE_ID,
        evidence_class=EvidenceClass.CURATED_DATABASE,
        gene_symbol=disease.gene_symbol,
    )


def _clinvar_url(accession: str) -> str:
    return f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{int(accession[3:12])}/"


def _flagship_variant_result(
    flagship: SeedFlagship, variant: SeedFlagshipVariant, match: MatchKind, reason: str, matched: str | None
) -> SearchResult:
    clinvar_url = _clinvar_url(variant.clinvar_vcv) if variant.clinvar_vcv else None
    review = f"ClinVar: {variant.review_status}" if variant.review_status else None
    return SearchResult(
        type=SearchResultType.VARIANT,
        id=variant.id,
        label=f"{flagship.gene_symbol} {variant.protein_change or variant.id}",
        description=review,
        match=match,
        match_reason=reason,
        matched_text=matched,
        href=entity_href(EntityType.VARIANT, variant.id),
        external_url=clinvar_url,
        ids=[
            *_identifier("ClinVar", variant.clinvar_vcv, clinvar_url),
            *_identifier("dbSNP", variant.rsid, f"https://www.ncbi.nlm.nih.gov/snp/{variant.rsid}"),
        ],
        in_catalog=True,
        source=SEED_SOURCE_ID,
        evidence_class=EvidenceClass.CLINICAL_DATABASE,
        gene_symbol=flagship.gene_symbol,
        accession=flagship.uniprot_accession,
    )


def _structure_results(gene: SeedGene, reason: str) -> list[SearchResult]:
    accession = gene.uniprot_accession
    if not accession:
        return []
    rows: list[SearchResult] = []
    protein_href = entity_href(EntityType.PROTEIN, accession)
    experimental = gene.stats.experimental_structure_count
    if experimental:
        sifts_url = f"https://www.ebi.ac.uk/pdbe/pdbe-kb/proteins/{accession}"
        rows.append(
            SearchResult(
                type=SearchResultType.STRUCTURE,
                id=f"pdbe:{accession}",
                label=f"{experimental} experimental {'structure' if experimental == 1 else 'structures'}",
                description=f"{gene.symbol} · PDB entries mapped by PDBe SIFTS",
                match=MatchKind.RELATED,
                match_reason=reason,
                href=protein_href,
                external_url=sifts_url,
                ids=_identifier("PDBe SIFTS", accession, sifts_url),
                in_catalog=True,
                source=SEED_SOURCE_ID,
                evidence_class=EvidenceClass.EXPERIMENTAL,
                gene_symbol=gene.symbol,
                accession=accession,
                origin=StructureOrigin.EXPERIMENTAL,
                count=experimental,
            )
        )
    if gene.stats.has_alphafold_model:
        entry_id = f"AF-{accession}-F1"
        afdb_url = f"https://alphafold.ebi.ac.uk/entry/{accession}"
        rows.append(
            SearchResult(
                type=SearchResultType.STRUCTURE,
                id=f"afdb:{entry_id}",
                label=f"AlphaFold DB model {entry_id}",
                description=f"{gene.symbol} · predicted, not experimental",
                match=MatchKind.RELATED,
                match_reason=reason,
                href=f"{protein_href}?s=afdb:{entry_id}",
                external_url=afdb_url,
                ids=_identifier("AlphaFold DB", entry_id, afdb_url),
                in_catalog=True,
                source=SEED_SOURCE_ID,
                evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
                gene_symbol=gene.symbol,
                accession=accession,
                origin=StructureOrigin.PREDICTED_EXTERNAL,
            )
        )
    return rows


def _entry_result(
    catalog: Catalog, index: _Index, entry: _Entry, match: MatchKind, reason: str
) -> SearchResult | None:
    match entry.type:
        case SearchResultType.GENE:
            gene = catalog.gene(entry.entity_id)
            return _gene_result(gene, match, reason, entry.display) if gene else None
        case SearchResultType.PROTEIN:
            gene = catalog.gene_by_uniprot(entry.entity_id)
            return _protein_result(gene, match, reason, entry.display) if gene else None
        case SearchResultType.DISEASE:
            disease = catalog.disease(entry.entity_id)
            return _disease_result(disease, match, reason, entry.display) if disease else None
        case SearchResultType.VARIANT:
            found = index.variants.get(entry.entity_id.upper())
            return _flagship_variant_result(*found, match, reason, entry.display) if found else None
    return None


def _match_catalog(catalog: Catalog, index: _Index, query: str, results: _Results) -> None:
    """Exact, alias, prefix and token matches, then fuzzy when those found little."""
    text = _normalise(query)
    if not text:
        return
    compact = text.replace(" ", "")
    tokens = text.split()
    token_characters = sum(len(token) for token in tokens)

    for entry in index.entries:
        if entry.text == text or entry.compact == compact:
            if entry.field == "identifier":
                kind, rank, reason = MatchKind.IDENTIFIER, 98.0, entry.field_label
            elif entry.field == "alias":
                kind, rank, reason = MatchKind.ALIAS, 94.0, f"Alias “{entry.display}”"
            else:
                kind, reason = MatchKind.EXACT, entry.field_label
                rank = 100.0 if entry.field == "symbol" else 96.0
        elif (
            len(text) >= 2
            and entry.text.startswith(text)
            and (entry.field != "identifier" or entry.field_label in PREFIX_IDENTIFIERS)
        ):
            kind = MatchKind.PREFIX
            rank = 80.0 + 10.0 * len(text) / len(entry.text) + (3.0 if entry.field == "symbol" else 0.0)
            reason = f"{entry.field_label} starts with the query"
        elif len(text) == 1 and entry.field == "symbol" and entry.text.startswith(text):
            kind, rank, reason = MatchKind.PREFIX, 80.0, "HGNC symbol starts with the query"
        elif (
            len(text) >= 3
            and entry.field != "identifier"
            and all(any(word.startswith(token) for word in entry.tokens) for token in tokens)
        ):
            kind = MatchKind.TOKEN
            rank = 60.0 + 10.0 * token_characters / len(entry.compact)
            reason = f"{entry.field_label} contains the query words"
        else:
            continue
        results.add(_entry_result(catalog, index, entry, kind, reason), rank)

    if len(tokens) > 1 and results.best_rank() < 80.0:
        # A gene symbol among other words outranks a fuzzy text match. A symbol without a digit
        # (WAS, REL) counts only when typed in capitals, so ordinary words do not name a gene.
        typed = set(query.translate(_SEPARATORS).split())
        for entry in index.symbol_entries:
            if entry.text not in tokens:
                continue
            if entry.display not in typed and not any(character.isdigit() for character in entry.text):
                continue
            symbol = entry.display
            reason = f"HGNC symbol {symbol} in the query"
            results.add(_entry_result(catalog, index, entry, MatchKind.TOKEN, reason), 75.0)
            for disease in catalog.diseases_for_gene(entry.entity_id):
                related = _disease_result(disease, MatchKind.RELATED, f"IUIS disease entry of {symbol}", None)
                results.add(related, 58.0, relation=True)

    if len(compact) < 4 or results.best_rank() >= 80.0 or len(results) >= 5:
        return
    for _, score, position in process.extract(
        text, index.fuzzy_texts, scorer=_fuzzy_score, limit=12, score_cutoff=FUZZY_CUTOFF
    ):
        entry = index.fuzzy_entries[position]
        reason = f"Similar to {entry.field_label.lower()} “{entry.display}”"
        results.add(_entry_result(catalog, index, entry, MatchKind.FUZZY, reason), 30.0 + score / 4.0)
    if len(tokens) == 1 and len(compact) <= 10:
        for _, score, position in process.extract(
            compact, index.symbol_texts, scorer=fuzz.ratio, limit=6, score_cutoff=SYMBOL_FUZZY_CUTOFF
        ):
            entry = index.symbol_entries[position]
            reason = f"Similar to HGNC symbol {entry.display}"
            results.add(_entry_result(catalog, index, entry, MatchKind.FUZZY, reason), 30.0 + score / 4.0)


def _fuzzy_score(query: str, choice: str, **options: Any) -> float:
    """WRatio, or the best partial alignment so one misspelt word of a long name still matches."""
    score = fuzz.WRatio(query, choice)
    if len(query) >= 6:
        score = max(score, 0.95 * fuzz.partial_ratio(query, choice))
    cutoff = options.get("score_cutoff") or 0.0
    return score if score >= cutoff else 0.0


def _expand(catalog: Catalog, results: _Results) -> None:
    """Add what hangs off the entities the query named exactly: protein, diseases, variants, structures."""
    anchors = sorted(
        (
            hit
            for hit in results.hits.values()
            if hit.result.in_catalog and hit.result.match in _STRONG_MATCHES
        ),
        key=lambda hit: -hit.rank,
    )[:MAX_ANCHORS]
    for anchor in anchors:
        subject = anchor.result
        related_rank = anchor.rank - 20.0
        gene = catalog.gene(subject.gene_symbol) if subject.gene_symbol else None
        if gene is None:
            continue
        symbol = gene.symbol
        if subject.type is not SearchResultType.GENE:
            reason = (
                f"Gene named by IUIS for {subject.label}"
                if subject.type is SearchResultType.DISEASE
                else f"Gene of {subject.label}"
            )
            results.add(_gene_result(gene, MatchKind.RELATED, reason, None), related_rank, relation=True)
        if subject.type is not SearchResultType.PROTEIN:
            results.add(
                _protein_result(gene, MatchKind.RELATED, f"Protein product of {symbol}", None),
                related_rank - 1.0,
                relation=True,
            )
        if subject.type in (SearchResultType.GENE, SearchResultType.PROTEIN):
            for disease in catalog.diseases_for_gene(symbol):
                results.add(
                    _disease_result(disease, MatchKind.RELATED, f"IUIS disease entry of {symbol}", None),
                    related_rank - 2.0,
                    relation=True,
                )
            flagship = catalog.flagship_for_gene(symbol)
            for variant in flagship.variants if flagship else []:
                results.add(
                    _flagship_variant_result(
                        flagship,
                        variant,
                        MatchKind.RELATED,
                        f"Flagship variant of {symbol}",
                        None,
                    ),
                    related_rank - 3.0,
                    relation=True,
                )
            for row in _structure_results(gene, f"Structure availability of {symbol}"):
                results.add(row, related_rank - 4.0, relation=True)


def _split_gene_and_change(query: str) -> ProteinSubstitution | None:
    substitution = parse_variant_id(query)
    if substitution is not None:
        return substitution
    parts = [part for part in re.split(r"[\s:]+", query.strip()) if part]
    if len(parts) != 2 or not _GENE_SYMBOL_RE.match(parts[0]):
        return None
    return parse_protein_change(parts[1], gene_symbol=parts[0].upper())


def _typed_variant_result(catalog: Catalog, index: _Index, substitution: ProteinSubstitution) -> SearchResult:
    variant_id = substitution.variant_id or substitution.hgvs_p
    known = index.variants.get(variant_id.upper())
    if known is not None:
        return _flagship_variant_result(
            *known, MatchKind.IDENTIFIER, "Gene symbol and protein change", variant_id
        )
    symbol = substitution.gene_symbol or ""
    gene = catalog.gene(symbol)
    href = entity_href(EntityType.VARIANT, variant_id)
    if gene is None:
        description = f"{symbol} is outside the IEI catalog. Not checked against a reference sequence."
    elif gene.protein_length and substitution.position > gene.protein_length:
        description = (
            f"Position {substitution.position} is beyond the {gene.protein_length}-residue "
            f"canonical sequence of {gene.uniprot_accession}."
        )
        href = None
    else:
        description = "Not a flagship variant. The reference residue is checked when the variant opens."
    return SearchResult(
        type=SearchResultType.VARIANT,
        id=variant_id,
        label=f"{symbol} {substitution.hgvs_p}",
        description=description,
        match=MatchKind.IDENTIFIER,
        match_reason="Gene symbol and protein change",
        matched_text=variant_id,
        href=href,
        in_catalog=False,
        source="query",
        gene_symbol=symbol or None,
        accession=gene.uniprot_accession if gene else None,
    )


def _external_result(
    result_type: SearchResultType,
    entity_id: str,
    label: str,
    reason: str,
    *,
    source_name: str,
    description: str | None = None,
    href: str | None = None,
    external_url: str | None = None,
    origin: StructureOrigin | None = None,
    accession: str | None = None,
    match: MatchKind = MatchKind.IDENTIFIER,
    source: str = "query",
    evidence_class: EvidenceClass | None = None,
    in_catalog: bool = False,
) -> SearchResult:
    return SearchResult(
        type=result_type,
        id=entity_id,
        label=label,
        description=description,
        match=match,
        match_reason=reason,
        matched_text=entity_id,
        href=href,
        external_url=external_url,
        ids=_identifier(source_name, entity_id.partition(":")[2] or entity_id, external_url),
        in_catalog=in_catalog,
        source=source,
        evidence_class=evidence_class,
        accession=accession,
        origin=origin,
    )


@dataclass(slots=True)
class _LivePlan:
    """Live lookups decided while parsing. Each key is one source call."""

    calls: dict[str, SourceCall]
    uniprot_accession: str | None = None
    uniprot_symbol: str | None = None
    pdb_id: str | None = None


def _uniprot_search(query: str) -> Awaitable[SourceResult[Any]]:
    return _adapter(_UniProtLookup).get_json(
        "https://rest.uniprot.org/uniprotkb/search",
        params={
            "query": query,
            "fields": "accession,id,gene_primary,protein_name,organism_name,length,reviewed",
            "format": "json",
            "size": 3,
        },
        empty_if=lambda payload: not payload.get("results"),
        timeout=LIVE_TIMEOUT_SECONDS,
    )


def _parse_identifiers(
    catalog: Catalog,
    index: _Index,
    query: str,
    results: _Results,
    parsed: list[ParsedIdentifier],
    plan: _LivePlan,
) -> None:
    """Recognise identifiers without a lookup. Catalog rows are added here; the rest is planned."""
    upper = query.upper()

    def note(kind: str, value: str, description: str) -> None:
        parsed.append(ParsedIdentifier(kind=kind, value=value, description=description))

    substitution = _split_gene_and_change(query)
    if substitution is not None:
        note("protein_change", substitution.variant_id or substitution.hgvs_p, "Gene and protein change")
        results.add(_typed_variant_result(catalog, index, substitution), 99.0)
        gene = catalog.gene(substitution.gene_symbol or "")
        if gene is not None:
            results.add(_gene_result(gene, MatchKind.RELATED, "Gene of the variant", gene.symbol), 79.0)
            results.add(
                _protein_result(gene, MatchKind.RELATED, f"Protein product of {gene.symbol}", None), 78.0
            )
        return

    if catalog.gene(query) is not None:
        note("hgnc_symbol", upper, "HGNC symbol in the IEI catalog")
        return

    uniprot = _UNIPROT_RE.match(upper)
    if uniprot:
        accession = uniprot.group(1)
        note("uniprot_accession", upper, "UniProt accession")
        gene = catalog.gene_by_uniprot(accession)
        if gene is not None:
            results.add(_protein_result(gene, MatchKind.IDENTIFIER, "UniProt accession", accession), 100.0)
        else:
            plan.uniprot_accession = accession
            plan.calls["uniprot"] = SourceCall(
                _adapter(_UniProtLookup), _uniprot_search(f"accession:{accession}"), LIVE_TIMEOUT_SECONDS
            )
        return

    hgnc = _HGNC_RE.match(query)
    if hgnc:
        hgnc_id = f"HGNC:{hgnc.group(1)}"
        note("hgnc_id", hgnc_id, "HGNC ID")
        gene = catalog.gene_by_hgnc_id(hgnc_id)
        if gene is not None:
            results.add(_gene_result(gene, MatchKind.IDENTIFIER, "HGNC ID", hgnc_id), 100.0)
        else:
            url = f"https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/{hgnc_id}"
            results.add(
                _external_result(
                    SearchResultType.GENE,
                    hgnc_id,
                    hgnc_id,
                    "HGNC ID",
                    source_name="HGNC",
                    description="Outside the IEI catalog. Open the record at HGNC.",
                    external_url=url,
                ),
                70.0,
            )
        return

    ensembl = _ENSEMBL_GENE_RE.match(query)
    if ensembl:
        note("ensembl_gene_id", ensembl.group(1).upper(), "Ensembl gene ID")
        return

    if CLINVAR_VCV_RE.match(query) or RSID_RE.match(query):
        is_clinvar = upper.startswith("VCV")
        accession = upper.split(".")[0] if is_clinvar else query.lower()
        label = "ClinVar accession" if is_clinvar else "dbSNP rsID"
        note("clinvar_vcv" if is_clinvar else "rsid", accession, label)
        known = index.variants_by_accession.get(accession.upper())
        if known is not None:
            results.add(_flagship_variant_result(*known, MatchKind.IDENTIFIER, label, accession), 100.0)
        elif is_clinvar:
            results.add(
                _external_result(
                    SearchResultType.VARIANT,
                    accession,
                    accession,
                    label,
                    source_name="ClinVar",
                    description="Not a flagship variant. Resolved through ClinVar when the variant opens.",
                    href=entity_href(EntityType.VARIANT, accession),
                    external_url=_clinvar_url(accession),
                    evidence_class=EvidenceClass.CLINICAL_DATABASE,
                ),
                90.0,
            )
        else:
            results.add(
                _external_result(
                    SearchResultType.VARIANT,
                    accession,
                    accession,
                    label,
                    source_name="dbSNP",
                    description="Not a flagship variant. Open the record at dbSNP.",
                    external_url=f"https://www.ncbi.nlm.nih.gov/snp/{accession}",
                ),
                70.0,
            )
        return

    for pattern, prefix, kind in (
        (_MONDO_RE, "MONDO", "mondo_id"),
        (_ORPHA_RE, "ORPHA", "orphanet_id"),
        (_OMIM_RE, "OMIM", "omim_number"),
    ):
        disease_match = pattern.match(query)
        if not disease_match:
            continue
        curie = f"{prefix}:{disease_match.group(1)}"
        label = _XREF_LABELS[prefix]
        note(kind, curie, label)
        diseases = [
            catalog.disease(reference.id)
            for reference in catalog.lookup(curie)
            if reference.type is EntityType.DISEASE
        ]
        for disease in diseases:
            if disease is not None:
                results.add(_disease_result(disease, MatchKind.IDENTIFIER, label, curie), 100.0)
        if not any(diseases):
            results.add(
                _external_result(
                    SearchResultType.DISEASE,
                    curie,
                    curie,
                    label,
                    source_name=prefix,
                    description="No disease in the IEI catalog carries this cross-reference.",
                    external_url=_disease_xref_url(curie),
                ),
                70.0,
            )
        return

    afdb = _AFDB_RE.match(query)
    if afdb:
        accession = afdb.group(1).upper()
        entry_id = f"AF-{accession}-F{afdb.group(2)}"
        note("afdb_entry", entry_id, "AlphaFold DB entry")
        results.add(
            _external_result(
                SearchResultType.STRUCTURE,
                f"afdb:{entry_id}",
                f"AlphaFold DB model {entry_id}",
                "AlphaFold DB entry",
                source_name="AlphaFold DB",
                description="Predicted, not experimental.",
                href=f"{entity_href(EntityType.PROTEIN, accession)}?s=afdb:{entry_id}",
                external_url=f"https://alphafold.ebi.ac.uk/entry/{accession}",
                origin=StructureOrigin.PREDICTED_EXTERNAL,
                accession=accession,
                evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
                in_catalog=catalog.gene_by_uniprot(accession) is not None,
            ),
            98.0,
        )
        return

    pdb = _PDB_RE.match(query)
    if pdb and (pdb.group(1) or re.search(r"[A-Za-z]", pdb.group(2))):
        pdb_id = pdb.group(2).upper()
        note("pdb_id", pdb_id, "PDB ID")
        plan.pdb_id = pdb_id
        plan.calls["pdbe"] = SourceCall(
            _adapter(_PdbeLookup, "pdbe", "sifts"),
            _adapter(_PdbeLookup, "pdbe", "sifts").get_json(
                f"https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{pdb_id.lower()}",
                record_id=pdb_id,
                empty_statuses={404},
                timeout=LIVE_TIMEOUT_SECONDS,
            ),
            LIVE_TIMEOUT_SECONDS,
        )
        return

    if CHEMBL_ID_RE.match(query) or INCHIKEY_RE.match(upper):
        is_chembl = upper.startswith("CHEMBL")
        note("chembl_id" if is_chembl else "inchikey", upper, "ChEMBL ID" if is_chembl else "InChIKey")
        results.add(
            _external_result(
                SearchResultType.COMPOUND,
                upper,
                upper,
                "ChEMBL ID" if is_chembl else "InChIKey",
                source_name="ChEMBL" if is_chembl else "InChIKey",
                description="Resolved when the compound opens.",
                href=entity_href(EntityType.COMPOUND, upper),
                external_url=f"https://www.ebi.ac.uk/chembl/explore/compound/{upper}" if is_chembl else None,
            ),
            98.0,
        )
        return

    pmid, doi = _PMID_RE.match(query), _DOI_RE.match(query)
    if pmid or doi or _PMCID_RE.match(query):
        if pmid:
            paper_id, label = f"PMID:{pmid.group(1)}", "PubMed ID"
            url = f"https://europepmc.org/article/MED/{pmid.group(1)}"
        elif doi:
            paper_id, label = f"DOI:{doi.group(1)}", "DOI"
            url = f"https://doi.org/{doi.group(1)}"
        else:
            paper_id, label = upper, "PubMed Central ID"
            url = f"https://europepmc.org/article/PMC/{upper}"
        note("paper_id", paper_id, label)
        results.add(
            _external_result(
                SearchResultType.PAPER,
                paper_id,
                paper_id,
                label,
                source_name=label,
                description="Opens at the publisher or Europe PMC.",
                external_url=url,
                evidence_class=EvidenceClass.LITERATURE,
            ),
            98.0,
        )
        return

    if _PROJECT_ID_RE.match(query):
        note("project_id", query, "Project ID")
        results.add(
            _external_result(
                SearchResultType.PROJECT,
                query,
                query,
                "Project ID",
                source_name="OrphaFold",
                href=entity_href(EntityType.PROJECT, query),
            ),
            98.0,
        )


def _uniprot_rows(payload: dict[str, Any], reason: str, matched: str) -> list[SearchResult]:
    rows: list[SearchResult] = []
    for entry in payload.get("results", []):
        accession = entry.get("primaryAccession")
        if not accession:
            continue
        description = entry.get("proteinDescription", {})
        names = description.get("recommendedName") or (description.get("submissionNames") or [{}])[0]
        protein_name = names.get("fullName", {}).get("value")
        genes = entry.get("genes") or [{}]
        symbol = genes[0].get("geneName", {}).get("value")
        organism = entry.get("organism", {}).get("scientificName")
        length = entry.get("sequence", {}).get("length")
        uniprot_url = f"https://www.uniprot.org/uniprotkb/{accession}/entry"
        details = [symbol, organism, f"{length} aa" if length else None]
        rows.append(
            SearchResult(
                type=SearchResultType.PROTEIN,
                id=accession,
                label=protein_name or accession,
                description=" · ".join(part for part in details if part),
                match=MatchKind.LIVE,
                match_reason=reason,
                matched_text=matched,
                href=entity_href(EntityType.PROTEIN, accession),
                external_url=uniprot_url,
                ids=_identifier("UniProt", accession, uniprot_url),
                in_catalog=False,
                source="uniprot",
                evidence_class=EvidenceClass.CURATED_DATABASE,
                gene_symbol=symbol,
                accession=accession,
            )
        )
    return rows


def _paper_rows(payload: dict[str, Any]) -> list[SearchResult]:
    rows: list[SearchResult] = []
    for record in payload.get("resultList", {}).get("result", []):
        title = record.get("title")
        if not title:
            continue
        pmid, pmcid, doi = record.get("pmid"), record.get("pmcid"), record.get("doi")
        paper_id = f"PMID:{pmid}" if pmid else pmcid or (f"DOI:{doi}" if doi else None)
        if paper_id is None:
            continue
        url = f"https://europepmc.org/article/{record.get('source', 'MED')}/{record.get('id')}"
        details = [record.get("authorString"), record.get("journalTitle"), record.get("pubYear")]
        rows.append(
            SearchResult(
                type=SearchResultType.PAPER,
                id=paper_id,
                label=title,
                description=" · ".join(str(part) for part in details if part) or None,
                match=MatchKind.LIVE,
                match_reason="Europe PMC text search",
                href=None,
                external_url=url,
                ids=[
                    *_identifier("PubMed", pmid, f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"),
                    *_identifier("PMC", pmcid, f"https://europepmc.org/article/PMC/{pmcid}"),
                    *_identifier("DOI", doi, f"https://doi.org/{doi}"),
                ],
                in_catalog=False,
                source="europe_pmc",
                evidence_class=EvidenceClass.LITERATURE,
            )
        )
    return rows


def _compound_rows(payload: dict[str, Any]) -> list[SearchResult]:
    rows: list[SearchResult] = []
    for molecule in payload.get("molecules", []):
        chembl_id = molecule.get("molecule_chembl_id")
        if not chembl_id:
            continue
        inchikey = (molecule.get("molecule_structures") or {}).get("standard_inchi_key")
        chembl_url = f"https://www.ebi.ac.uk/chembl/explore/compound/{chembl_id}"
        rows.append(
            SearchResult(
                type=SearchResultType.COMPOUND,
                id=inchikey or chembl_id,
                label=molecule.get("pref_name") or chembl_id,
                description=molecule.get("molecule_type"),
                match=MatchKind.LIVE,
                match_reason="ChEMBL text search",
                href=entity_href(EntityType.COMPOUND, inchikey or chembl_id),
                external_url=chembl_url,
                ids=[*_identifier("ChEMBL", chembl_id, chembl_url), *_identifier("InChIKey", inchikey)],
                in_catalog=False,
                source="chembl",
                evidence_class=EvidenceClass.CURATED_DATABASE,
            )
        )
    return rows


def _pdb_row(pdb_id: str, payload: dict[str, Any] | None, catalog: Catalog) -> SearchResult:
    mapped = (payload or {}).get(pdb_id.lower(), {}).get("UniProt", {})
    accessions = list(mapped)
    accession = next((item for item in accessions if catalog.gene_by_uniprot(item)), None) or (
        accessions[0] if accessions else None
    )
    in_catalog = bool(accession) and catalog.gene_by_uniprot(accession) is not None
    if accession:
        name = mapped[accession].get("name") or accession
        description = f"Experimental structure of {name} ({accession})" + (
            "" if in_catalog else ", outside the IEI catalog"
        )
        href = f"{entity_href(EntityType.PROTEIN, accession)}?s=pdb:{pdb_id}"
    else:
        description = "No UniProt mapping found in PDBe SIFTS. Open the entry at RCSB PDB."
        href = None
    return _external_result(
        SearchResultType.STRUCTURE,
        f"pdb:{pdb_id}",
        f"PDB {pdb_id}",
        "PDB ID",
        source_name="PDB",
        description=description,
        href=href,
        external_url=f"https://www.rcsb.org/structure/{pdb_id}",
        origin=StructureOrigin.EXPERIMENTAL,
        accession=accession,
        source="pdbe_sifts" if accession else "query",
        evidence_class=EvidenceClass.EXPERIMENTAL,
        in_catalog=in_catalog,
    )


async def _project_rows(session: AsyncSession, actor: Actor, query: str, limit: int) -> list[SearchResult]:
    statement = (
        select(Project)
        .where(
            Project.owner_actor_id == actor.id,
            Project.deleted_at.is_(None),
            Project.title.ilike(f"%{query}%"),
        )
        .order_by(Project.updated_at.desc())
        .limit(limit)
    )
    return [
        SearchResult(
            type=SearchResultType.PROJECT,
            id=project.id,
            label=project.title,
            description=project.description,
            match=MatchKind.TOKEN,
            match_reason="Project title contains the query",
            matched_text=project.title,
            href=entity_href(EntityType.PROJECT, project.id),
            in_catalog=False,
            source="orphafold",
        )
        for project in (await session.scalars(statement)).all()
    ]


async def search(
    catalog: Catalog,
    query: str,
    *,
    types: frozenset[SearchResultType] | None = None,
    limit: int = DEFAULT_LIMIT,
    session: AsyncSession | None = None,
    actor: Actor | None = None,
) -> SearchResponse:
    started = time.perf_counter()
    query = " ".join(query.split())
    wanted = types or frozenset(SearchResultType)
    results = _Results()
    parsed: list[ParsedIdentifier] = []
    plan = _LivePlan(calls={})
    sources: list[SourceStatus] = [catalog.source_status()]

    catalog_types = wanted - LIVE_TEXT_TYPES - {SearchResultType.PROJECT}
    if query and catalog.ready and (catalog_types or types is None):
        index = _index(catalog)
        _parse_identifiers(catalog, index, query, results, parsed, plan)
        _match_catalog(catalog, index, query, results)
        _expand(catalog, results)
        if not results.hits and not plan.calls and _GENE_SYMBOL_RE.match(query):
            plan.uniprot_symbol = query.upper()
            plan.calls["uniprot"] = SourceCall(
                _adapter(_UniProtLookup),
                _uniprot_search(f"gene_exact:{plan.uniprot_symbol} AND organism_id:9606 AND reviewed:true"),
                LIVE_TIMEOUT_SECONDS,
            )

    if types is not None and len(query) >= 3 and not parsed:
        if SearchResultType.PAPER in types:
            europe_pmc = _adapter(_EuropePmcLookup, "europepmc")
            plan.calls["papers"] = SourceCall(
                europe_pmc,
                europe_pmc.get_json(
                    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                    params={"query": query, "format": "json", "pageSize": limit, "resultType": "lite"},
                    empty_if=lambda payload: not payload.get("resultList", {}).get("result"),
                    ttl=3600,
                    timeout=LIVE_TEXT_TIMEOUT_SECONDS,
                ),
                LIVE_TEXT_TIMEOUT_SECONDS,
            )
        if SearchResultType.COMPOUND in types:
            chembl = _adapter(_ChemblLookup)
            plan.calls["compounds"] = SourceCall(
                chembl,
                chembl.get_json(
                    "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json",
                    params={"q": query, "limit": limit},
                    empty_if=lambda payload: not payload.get("molecules"),
                    timeout=CHEMBL_TIMEOUT_SECONDS,
                ),
                CHEMBL_TIMEOUT_SECONDS,
            )

    if plan.calls:
        gathered = await gather_sources(plan.calls)
        sources.extend(gathered.sources)
        if "uniprot" in plan.calls:
            if plan.uniprot_accession:
                reason, matched = "Resolved through UniProt", plan.uniprot_accession
            else:
                reason, matched = "Gene symbol resolved through UniProt", plan.uniprot_symbol or query
            rows = _uniprot_rows(gathered.data("uniprot", {}), reason, matched)
            for position, row in enumerate(rows):
                results.add(row, 90.0 - position)
            if not rows and plan.uniprot_accession:
                state = gathered["uniprot"]
                results.add(
                    _external_result(
                        SearchResultType.PROTEIN,
                        plan.uniprot_accession,
                        plan.uniprot_accession,
                        "UniProt accession",
                        source_name="UniProt",
                        description=(
                            "Outside the IEI catalog. UniProt has no entry with this accession."
                            if state.is_empty
                            else "Outside the IEI catalog. UniProt did not answer; the entry is unverified."
                        ),
                        href=None
                        if state.is_empty
                        else entity_href(EntityType.PROTEIN, plan.uniprot_accession),
                        external_url=f"https://www.uniprot.org/uniprotkb/{plan.uniprot_accession}/entry",
                    ),
                    60.0,
                )
        if plan.pdb_id:
            results.add(_pdb_row(plan.pdb_id, gathered.data("pdbe"), catalog), 98.0)
        if "papers" in plan.calls:
            for position, row in enumerate(_paper_rows(gathered.data("papers", {}))):
                results.add(row, 50.0 - position)
        if "compounds" in plan.calls:
            for position, row in enumerate(_compound_rows(gathered.data("compounds", {}))):
                results.add(row, 50.0 - position)

    if SearchResultType.PROJECT in wanted and session is not None and actor is not None and len(query) >= 2:
        try:
            for position, row in enumerate(await _project_rows(session, actor, query, limit)):
                results.add(row, 55.0 - position)
        except Exception:
            logger.exception("Project search failed")

    ranked = sorted(
        (hit for hit in results.hits.values() if hit.result.type in wanted),
        key=lambda hit: (-hit.rank, TYPE_ORDER.index(hit.result.type), hit.result.label),
    )
    grouped: dict[SearchResultType, list[SearchResult]] = {}
    for hit in ranked:
        grouped.setdefault(hit.result.type, []).append(hit.result)
    groups = [
        SearchGroup(
            type=result_type, label=SEARCH_GROUP_LABELS[result_type], total=len(rows), results=rows[:limit]
        )
        for result_type, rows in grouped.items()
    ]
    top = next((hit.result for hit in ranked if hit.result.href), None)
    return SearchResponse(
        query=query,
        parsed=parsed,
        groups=groups,
        top=top,
        total=len(ranked),
        outside_catalog=bool(ranked) and not any(hit.result.in_catalog for hit in ranked),
        took_ms=round((time.perf_counter() - started) * 1000, 2),
        sources=sources,
    )
