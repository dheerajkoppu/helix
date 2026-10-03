"""Slim variant lists for the sequence axis: gnomAD population variants, and the axis bundle."""

from fastapi import APIRouter

from helix.deps import CatalogDep
from helix.errors import PROBLEM_RESPONSES
from helix.services.population import (
    AxisVariantsResponse,
    PopulationVariantsResponse,
    gene_axis_variants,
    gene_population_variants,
)

router = APIRouter(tags=["variants"], responses=PROBLEM_RESPONSES)


@router.get(
    "/genes/{symbol}/population-variants",
    response_model=PopulationVariantsResponse,
    summary="gnomAD single-residue protein variants of a gene",
)
async def get_population_variants(symbol: str, catalog: CatalogDep) -> PopulationVariantsResponse:
    return await gene_population_variants(symbol, catalog)


@router.get(
    "/genes/{symbol}/axis-variants",
    response_model=AxisVariantsResponse,
    summary="Clinical and population variants of a gene, slim rows for the sequence axis",
)
async def get_axis_variants(symbol: str, catalog: CatalogDep) -> AxisVariantsResponse:
    return await gene_axis_variants(symbol, catalog)
