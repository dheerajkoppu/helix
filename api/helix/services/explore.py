"""Explore: filter, sort and facet the seeded IEI gene set.

Every number shown is a source-native count from the seed (ClinVar records, publications, PDB
entries). Nothing here ranks genes by a composite score.
"""

import weakref
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

from helix.knowledge.catalog import Catalog, SeedDisease, SeedGene
from helix.schemas.catalog import (
    ExploreDisease,
    ExploreFacets,
    ExploreFacetsResponse,
    ExploreGene,
    ExploreGenesResponse,
    ExploreGeneStats,
    ExploreRanges,
    ExploreSort,
    FacetValue,
    NumericRange,
    SortOrder,
    StructureAvailability,
    VariantMetric,
)
from helix.schemas.common import EntityType, entity_href

UNKNOWN_FACET_VALUE = "unknown"

_STRUCTURE_LABELS = {
    StructureAvailability.EXPERIMENTAL: "Experimental structure",
    StructureAvailability.PREDICTED: "AlphaFold DB model",
    StructureAvailability.NONE: "No structure found",
    StructureAvailability.UNKNOWN: "Unknown",
}


@dataclass(frozen=True, slots=True)
class ExploreFilters:
    categories: frozenset[str] = frozenset()
    subcategories: frozenset[str] = frozenset()
    inheritance: frozenset[str] = frozenset()
    query: str | None = None
    protein_families: frozenset[str] = frozenset()
    structure: frozenset[StructureAvailability] = frozenset()
    variant_metric: VariantMetric = VariantMetric.PATHOGENIC
    variants_min: int | None = None
    variants_max: int | None = None
    publications_min: int | None = None
    publications_max: int | None = None


@dataclass(slots=True)
class _GeneRow:
    gene: SeedGene
    diseases: list[SeedDisease]
    category_ids: list[str]
    subcategory_ids: list[str]
    inheritance_codes: list[str]
    inheritance_keys: frozenset[str]
    structure: frozenset[StructureAvailability]
    family_key: str
    is_flagship: bool
    symbol_key: str = ""
    gene_text: str = ""
    disease_text: str = ""
    view: ExploreGene | None = field(default=None, repr=False)


_rows_cache: weakref.WeakKeyDictionary[Catalog, list[_GeneRow]] = weakref.WeakKeyDictionary()


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _structure_availability(gene: SeedGene) -> frozenset[StructureAvailability]:
    experimental = gene.stats.experimental_structure_count
    predicted = gene.stats.has_alphafold_model
    found: set[StructureAvailability] = set()
    if experimental:
        found.add(StructureAvailability.EXPERIMENTAL)
    if predicted:
        found.add(StructureAvailability.PREDICTED)
    if experimental == 0 and predicted is False:
        found.add(StructureAvailability.NONE)
    if experimental is None or predicted is None:
        found.add(StructureAvailability.UNKNOWN)
    return frozenset(found)


def _rows(catalog: Catalog) -> list[_GeneRow]:
    rows = _rows_cache.get(catalog)
    if rows is not None:
        return rows
    rows = []
    for gene in catalog.genes:
        diseases = catalog.diseases_for_gene(gene.symbol)
        inheritance_codes = _unique([code for disease in diseases for code in disease.inheritance.codes])
        disease_names = [name for disease in diseases for name in (disease.name, *disease.aliases)]
        rows.append(
            _GeneRow(
                gene=gene,
                diseases=diseases,
                category_ids=_unique([disease.category_id for disease in diseases if disease.category_id]),
                subcategory_ids=_unique(
                    [disease.subcategory_id for disease in diseases if disease.subcategory_id]
                ),
                inheritance_codes=inheritance_codes,
                inheritance_keys=frozenset(code.upper() for code in inheritance_codes),
                structure=_structure_availability(gene),
                family_key=gene.protein_family or UNKNOWN_FACET_VALUE,
                is_flagship=catalog.flagship_for_gene(gene.symbol) is not None,
                symbol_key=gene.symbol.casefold(),
                gene_text=" ".join(
                    part.casefold()
                    for part in (
                        gene.name,
                        gene.protein_name,
                        gene.uniprot_accession,
                        gene.hgnc_id,
                        gene.ensembl_gene_id,
                    )
                    if part
                ),
                disease_text=" | ".join(name.casefold() for name in disease_names),
            )
        )
    _rows_cache[catalog] = rows
    return rows


def _view(row: _GeneRow) -> ExploreGene:
    if row.view is None:
        gene = row.gene
        row.view = ExploreGene(
            symbol=gene.symbol,
            hgnc_id=gene.hgnc_id,
            name=gene.name,
            chromosome=gene.chromosome,
            uniprot_accession=gene.uniprot_accession,
            protein_name=gene.protein_name,
            protein_length=gene.protein_length,
            protein_family=gene.protein_family,
            category_ids=row.category_ids,
            subcategory_ids=row.subcategory_ids,
            inheritance_codes=row.inheritance_codes,
            diseases=[
                ExploreDisease(
                    id=disease.id,
                    name=disease.name,
                    category_id=disease.category_id,
                    subcategory_id=disease.subcategory_id,
                    inheritance_codes=disease.inheritance.codes,
                    is_phenocopy=disease.is_phenocopy,
                )
                for disease in row.diseases
            ],
            stats=ExploreGeneStats(**gene.stats.model_dump()),
            is_flagship=row.is_flagship,
            href=entity_href(EntityType.GENE, gene.symbol) or "",
        )
    return row.view


def _variant_count(row: _GeneRow, metric: VariantMetric) -> int | None:
    stats = row.gene.stats
    return stats.clinvar_pathogenic_count if metric is VariantMetric.PATHOGENIC else stats.clinvar_total_count


def _in_range(value: int | None, minimum: int | None, maximum: int | None) -> bool:
    if minimum is None and maximum is None:
        return True
    if value is None:
        return False
    return (minimum is None or value >= minimum) and (maximum is None or value <= maximum)


def _query_rank(row: _GeneRow, needle: str) -> int | None:
    """Lower is closer. None when the gene does not match the text."""
    if row.symbol_key == needle:
        return 0
    if row.symbol_key.startswith(needle):
        return 1
    if needle in row.symbol_key:
        return 2
    if needle in row.gene_text:
        return 3
    if needle in row.disease_text:
        return 4
    return None


def _predicates(filters: ExploreFilters) -> dict[str, Callable[[_GeneRow], bool]]:
    """One predicate per filter group, so a facet can be counted with its own group left out."""
    predicates: dict[str, Callable[[_GeneRow], bool]] = {}
    if filters.categories:
        predicates["category"] = lambda row: not filters.categories.isdisjoint(row.category_ids)
    if filters.subcategories:
        predicates["subcategory"] = lambda row: not filters.subcategories.isdisjoint(row.subcategory_ids)
    if filters.inheritance:
        predicates["inheritance"] = lambda row: not filters.inheritance.isdisjoint(row.inheritance_keys)
    if filters.protein_families:
        predicates["protein_family"] = lambda row: row.family_key in filters.protein_families
    if filters.structure:
        predicates["structure"] = lambda row: not filters.structure.isdisjoint(row.structure)
    if filters.query:
        needle = filters.query.casefold().strip()
        predicates["query"] = lambda row: _query_rank(row, needle) is not None
    if filters.variants_min is not None or filters.variants_max is not None:
        predicates["variants"] = lambda row: _in_range(
            _variant_count(row, filters.variant_metric), filters.variants_min, filters.variants_max
        )
    if filters.publications_min is not None or filters.publications_max is not None:
        predicates["publications"] = lambda row: _in_range(
            row.gene.stats.publication_count, filters.publications_min, filters.publications_max
        )
    return predicates


def _apply(
    rows: list[_GeneRow], predicates: dict[str, Callable[[_GeneRow], bool]], *, skip: str | None = None
) -> list[_GeneRow]:
    active = [predicate for name, predicate in predicates.items() if name != skip]
    return [row for row in rows if all(predicate(row) for predicate in active)]


def _facets(catalog: Catalog, rows: list[_GeneRow], filters: ExploreFilters) -> ExploreFacets:
    predicates = _predicates(filters)

    def counts(facet: str, values: Callable[[_GeneRow], list[str]]) -> Counter[str]:
        counter: Counter[str] = Counter()
        for row in _apply(rows, predicates, skip=facet):
            counter.update(set(values(row)))
        return counter

    category_counts = counts("category", lambda row: row.category_ids)
    subcategory_counts = counts("subcategory", lambda row: row.subcategory_ids)
    inheritance_counts = counts("inheritance", lambda row: row.inheritance_codes)
    family_counts = counts("protein_family", lambda row: [row.family_key])
    structure_counts = counts("structure", lambda row: [availability.value for availability in row.structure])

    return ExploreFacets(
        category=[
            FacetValue(
                value=category.id,
                label=category.name,
                table=category.table,
                count=category_counts.get(category.id, 0),
            )
            for category in catalog.categories
        ],
        subcategory=[
            FacetValue(
                value=subcategory.id,
                label=subcategory.name,
                parent=category.id,
                table=category.table,
                count=subcategory_counts.get(subcategory.id, 0),
            )
            for category in catalog.categories
            for subcategory in category.subcategories
        ],
        inheritance=[
            FacetValue(value=code, label=code, count=count)
            for code, count in sorted(inheritance_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        protein_family=[
            FacetValue(
                value=family, label="Unknown" if family == UNKNOWN_FACET_VALUE else family, count=count
            )
            for family, count in sorted(family_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        structure=[
            FacetValue(
                value=availability.value,
                label=_STRUCTURE_LABELS[availability],
                count=structure_counts.get(availability.value, 0),
            )
            for availability in StructureAvailability
        ],
    )


def _range(values: list[int | None]) -> NumericRange:
    known = [value for value in values if value is not None]
    return NumericRange(
        min=min(known) if known else None, max=max(known) if known else None, known=len(known)
    )


def _ranges(rows: list[_GeneRow]) -> ExploreRanges:
    return ExploreRanges(
        pathogenic_variants=_range([row.gene.stats.clinvar_pathogenic_count for row in rows]),
        total_variants=_range([row.gene.stats.clinvar_total_count for row in rows]),
        publications=_range([row.gene.stats.publication_count for row in rows]),
    )


_SORT_KEYS: dict[ExploreSort, Callable[[_GeneRow], str | int | None]] = {
    ExploreSort.SYMBOL: lambda row: row.symbol_key,
    ExploreSort.NAME: lambda row: row.gene.name.casefold() if row.gene.name else None,
    ExploreSort.PATHOGENIC_VARIANTS: lambda row: row.gene.stats.clinvar_pathogenic_count,
    ExploreSort.TOTAL_VARIANTS: lambda row: row.gene.stats.clinvar_total_count,
    ExploreSort.PUBLICATIONS: lambda row: row.gene.stats.publication_count,
    ExploreSort.EXPERIMENTAL_STRUCTURES: lambda row: row.gene.stats.experimental_structure_count,
    ExploreSort.PROTEIN_LENGTH: lambda row: row.gene.protein_length,
}


def _sort(rows: list[_GeneRow], sort: ExploreSort, order: SortOrder, query: str | None) -> list[_GeneRow]:
    if sort is ExploreSort.RELEVANCE:
        if not query:
            return sorted(rows, key=lambda row: row.symbol_key)
        needle = query.casefold().strip()
        return sorted(rows, key=lambda row: (_query_rank(row, needle) or 0, row.symbol_key))
    key = _SORT_KEYS[sort]
    known = [row for row in rows if key(row) is not None]
    unknown = [row for row in rows if key(row) is None]
    known.sort(key=lambda row: row.symbol_key)
    known.sort(key=key, reverse=order is SortOrder.DESC)  # type: ignore[arg-type]
    unknown.sort(key=lambda row: row.symbol_key)
    # A gene whose source reported no value sorts last in both directions
    return known + unknown


def explore_genes(
    catalog: Catalog,
    filters: ExploreFilters,
    *,
    sort: ExploreSort | None = None,
    order: SortOrder | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ExploreGenesResponse:
    rows = _rows(catalog)
    resolved_sort = sort or (ExploreSort.RELEVANCE if filters.query else ExploreSort.SYMBOL)
    resolved_order = order or SortOrder.ASC
    matched = _sort(_apply(rows, _predicates(filters)), resolved_sort, resolved_order, filters.query)
    page = matched[offset : offset + limit]
    return ExploreGenesResponse(
        items=[_view(row) for row in page],
        total=len(matched),
        limit=limit,
        offset=offset,
        sort=resolved_sort,
        order=resolved_order,
        facets=_facets(catalog, rows, filters),
        ranges=_ranges(rows),
        catalog_state=catalog.status.state,
        sources=[catalog.source_status()],
    )


def explore_facets(catalog: Catalog, filters: ExploreFilters) -> ExploreFacetsResponse:
    rows = _rows(catalog)
    return ExploreFacetsResponse(
        facets=_facets(catalog, rows, filters),
        ranges=_ranges(rows),
        total=len(_apply(rows, _predicates(filters))),
        catalog_state=catalog.status.state,
        sources=[catalog.source_status()],
    )
