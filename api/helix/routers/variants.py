"""Variants of a gene (table and CSV) and one variant in detail."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from helix.deps import CatalogDep, Pagination
from helix.errors import PROBLEM_RESPONSES, BadRequest
from helix.hgvs import SIGNIFICANCE_KEYS, normalise_consequence
from helix.schemas.variants import GeneVariantsResponse, VariantDetail
from helix.services.variants import (
    DEFAULT_SIGNIFICANCE,
    SORTS,
    VariantListFilters,
    gene_variants,
    gene_variants_csv,
    variant_detail,
)

router = APIRouter(tags=["variants"], responses=PROBLEM_RESPONSES)


def _split(values: list[str] | None) -> list[str]:
    """Accept repeated parameters and comma-separated lists."""
    return [part.strip() for value in values or [] for part in value.split(",") if part.strip()]


@dataclass(slots=True)
class VariantListQuery:
    significance: Annotated[
        list[str] | None,
        Query(
            description=(
                "Clinical significance keys: pathogenic, likely_pathogenic, uncertain_significance, "
                "likely_benign, benign, conflicting, other, not_classified, or all. Repeatable. "
                "Default: pathogenic and likely_pathogenic"
            )
        ),
    ] = None
    consequence: Annotated[
        list[str] | None, Query(description="Molecular consequence, e.g. missense_variant. Repeatable")
    ] = None
    min_stars: Annotated[int | None, Query(ge=0, le=4, description="Minimum ClinVar review stars")] = None
    residue_start: Annotated[int | None, Query(ge=1, description="First residue, UniProt numbering")] = None
    residue_end: Annotated[int | None, Query(ge=1, description="Last residue, UniProt numbering")] = None
    q: Annotated[
        str | None,
        Query(max_length=200, description="Text in the name, protein change, condition, VCV or rsID"),
    ] = None
    sort: Annotated[str, Query(description="position, stars or last_evaluated")] = "position"

    def filters(self) -> VariantListFilters:
        significance = [value.lower() for value in _split(self.significance)] or list(DEFAULT_SIGNIFICANCE)
        unknown = [value for value in significance if value != "all" and value not in SIGNIFICANCE_KEYS]
        if unknown:
            raise BadRequest(
                f"Unknown clinical significance: {', '.join(unknown)}.", code="invalid_significance"
            )
        if self.sort not in SORTS:
            raise BadRequest(f"Unknown sort '{self.sort}'.", code="invalid_sort")
        if self.residue_start and self.residue_end and self.residue_start > self.residue_end:
            raise BadRequest("residue_start is after residue_end.", code="invalid_residue_range")
        return VariantListFilters(
            significance=significance,
            consequence=[term for term in map(normalise_consequence, _split(self.consequence)) if term],
            min_stars=self.min_stars,
            residue_start=self.residue_start,
            residue_end=self.residue_end,
            q=self.q,
            sort=self.sort,
        )


@router.get(
    "/genes/{symbol}/variants.csv",
    summary="Variants of a gene as CSV",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def get_gene_variants_csv(
    symbol: str, catalog: CatalogDep, query: Annotated[VariantListQuery, Depends()]
) -> Response:
    body, filename = await gene_variants_csv(symbol, catalog, query.filters())
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/genes/{symbol}/variants",
    response_model=GeneVariantsResponse,
    summary="Variants of a gene: ClinVar merged with UniProt natural variants",
)
async def get_gene_variants(
    symbol: str,
    catalog: CatalogDep,
    query: Annotated[VariantListQuery, Depends()],
    pagination: Pagination,
) -> GeneVariantsResponse:
    return await gene_variants(symbol, catalog, query.filters(), pagination.limit, pagination.offset)


@router.get(
    "/variants/{variant_id}",
    response_model=VariantDetail,
    summary="One variant: ClinVar, UniProt, gnomAD, reference check and identifiers",
)
async def get_variant(variant_id: str, catalog: CatalogDep) -> VariantDetail:
    return await variant_detail(variant_id, catalog)
