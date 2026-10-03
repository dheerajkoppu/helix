"""GET /explore/genes and GET /explore/facets: browse the seeded IEI gene set."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from helix.deps import CatalogDep, Pagination
from helix.errors import PROBLEM_RESPONSES, BadRequest
from helix.schemas.catalog import (
    ExploreFacetsResponse,
    ExploreGenesResponse,
    ExploreSort,
    SortOrder,
    StructureAvailability,
    VariantMetric,
)
from helix.services.explore import ExploreFilters, explore_facets, explore_genes

router = APIRouter(prefix="/explore", tags=["explore"], responses=PROBLEM_RESPONSES)


def _split(values: list[str] | None) -> list[str]:
    """Accept repeated parameters and comma-separated lists."""
    return [part.strip() for value in values or [] for part in value.split(",") if part.strip()]


@dataclass(slots=True)
class ExploreQuery:
    category: Annotated[list[str] | None, Query(description="IUIS category ID, e.g. iuis-t1. Repeatable")] = (
        None
    )
    subcategory: Annotated[list[str] | None, Query(description="IUIS subcategory ID. Repeatable")] = None
    inheritance: Annotated[
        list[str] | None, Query(description="Inheritance code, e.g. AR, AD, XL. Repeatable")
    ] = None
    q: Annotated[
        str | None,
        Query(max_length=200, description="Text in the gene symbol, gene or protein name, or disease name"),
    ] = None
    protein_family: Annotated[
        list[str] | None,
        Query(description="Protein family, exact. 'unknown' selects genes with none. Repeatable"),
    ] = None
    structure: Annotated[
        list[StructureAvailability] | None,
        Query(description="Structure availability: experimental, predicted, none, unknown. Repeatable"),
    ] = None
    variant_metric: Annotated[
        VariantMetric, Query(description="Which ClinVar count the variant range applies to")
    ] = VariantMetric.PATHOGENIC
    variants_min: Annotated[int | None, Query(ge=0, description="Minimum number of reported variants")] = None
    variants_max: Annotated[int | None, Query(ge=0, description="Maximum number of reported variants")] = None
    publications_min: Annotated[int | None, Query(ge=0, description="Minimum publication count")] = None
    publications_max: Annotated[int | None, Query(ge=0, description="Maximum publication count")] = None

    def filters(self) -> ExploreFilters:
        if (
            self.variants_min is not None
            and self.variants_max is not None
            and self.variants_min > self.variants_max
        ):
            raise BadRequest("variants_min is greater than variants_max.", code="invalid_range")
        if (
            self.publications_min is not None
            and self.publications_max is not None
            and self.publications_min > self.publications_max
        ):
            raise BadRequest("publications_min is greater than publications_max.", code="invalid_range")
        return ExploreFilters(
            categories=frozenset(_split(self.category)),
            subcategories=frozenset(_split(self.subcategory)),
            inheritance=frozenset(code.upper() for code in _split(self.inheritance)),
            query=self.q.strip() if self.q and self.q.strip() else None,
            protein_families=frozenset(
                family.strip() for family in self.protein_family or [] if family.strip()
            ),
            structure=frozenset(self.structure or []),
            variant_metric=self.variant_metric,
            variants_min=self.variants_min,
            variants_max=self.variants_max,
            publications_min=self.publications_min,
            publications_max=self.publications_max,
        )


ExploreQueryDep = Annotated[ExploreQuery, Depends()]


@router.get(
    "/genes",
    response_model=ExploreGenesResponse,
    summary="Filter, sort and page the IEI gene set, with facet counts",
)
async def list_genes(
    catalog: CatalogDep,
    query: ExploreQueryDep,
    page: Pagination,
    sort: Annotated[
        ExploreSort | None, Query(description="Default: relevance with q, otherwise symbol")
    ] = None,
    order: Annotated[
        SortOrder | None, Query(description="Genes with no value for the sort key come last")
    ] = None,
) -> ExploreGenesResponse:
    return explore_genes(
        catalog, query.filters(), sort=sort, order=order, limit=page.limit, offset=page.offset
    )


@router.get(
    "/facets",
    response_model=ExploreFacetsResponse,
    summary="Facet values, counts and numeric ranges for the explore filters",
)
async def list_facets(catalog: CatalogDep, query: ExploreQueryDep) -> ExploreFacetsResponse:
    return explore_facets(catalog, query.filters())
