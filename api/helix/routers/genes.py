"""GET /genes/{symbol}."""

from typing import Annotated

from fastapi import APIRouter, Path

from helix.deps import CatalogDep
from helix.errors import PROBLEM_RESPONSES
from helix.schemas.genes import GeneResponse
from helix.services.genes import get_gene

router = APIRouter(prefix="/genes", tags=["genes"], responses=PROBLEM_RESPONSES)


@router.get(
    "/{symbol}",
    response_model=GeneResponse,
    summary="Gene record: IDs, statistics with definitions, IEI entries, transcripts and protein summary",
)
async def read_gene(
    symbol: Annotated[
        str,
        Path(max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]*$", description="HGNC symbol, e.g. BTK"),
    ],
    catalog: CatalogDep,
) -> GeneResponse:
    return await get_gene(symbol, catalog)
