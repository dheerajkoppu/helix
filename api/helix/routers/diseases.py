"""GET /diseases and GET /diseases/{id}."""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from helix.deps import CatalogDep
from helix.errors import PROBLEM_RESPONSES
from helix.schemas.diseases import DiseaseListResponse, DiseaseResponse
from helix.services.diseases import get_disease, list_diseases

router = APIRouter(prefix="/diseases", tags=["diseases"], responses=PROBLEM_RESPONSES)


@router.get("", response_model=DiseaseListResponse, summary="Browse the IUIS disease catalog")
async def browse_diseases(
    catalog: CatalogDep,
    category: Annotated[
        str | None,
        Query(max_length=40, description="IUIS category or subcategory ID, e.g. iuis-t3 or iuis-t3-a"),
    ] = None,
    q: Annotated[
        str | None,
        Query(max_length=120, description="Text in the name, an alias, the gene symbol or a cross-reference"),
    ] = None,
    page: Annotated[int, Query(ge=1, description="Page number, from 1")] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> DiseaseListResponse:
    return list_diseases(catalog, category=category, q=q, page=page, page_size=page_size)


@router.get(
    "/{disease_id}",
    response_model=DiseaseResponse,
    summary="Disease bundle: catalog record, gene and protein, sourced treatments, research status and "
    "relationship graph",
)
async def read_disease(
    disease_id: Annotated[
        str,
        Path(max_length=160, description="Catalog slug, or an exact cross-reference such as MONDO:0010421"),
    ],
    catalog: CatalogDep,
) -> DiseaseResponse:
    return await get_disease(disease_id, catalog)
