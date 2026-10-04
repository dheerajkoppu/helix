"""GET /discovery/candidates and GET /discovery/controls."""

from typing import Annotated

from fastapi import APIRouter, Query

from helix.deps import CatalogDep
from helix.errors import PROBLEM_RESPONSES
from helix.schemas.discovery import ControlsResponse, DiscoveryResponse
from helix.services.discovery import candidates, controls

router = APIRouter(prefix="/discovery", tags=["discovery"], responses=PROBLEM_RESPONSES)


@router.get(
    "/candidates",
    response_model=DiscoveryResponse,
    summary="Candidate targets and molecules for a gene, disease or variant, with the chain behind each",
)
async def read_candidates(
    catalog: CatalogDep,
    gene: Annotated[
        str | None,
        Query(max_length=40, description="HGNC symbol, e.g. PIK3CD"),
    ] = None,
    disease: Annotated[
        str | None,
        Query(max_length=120, description="Catalog disease slug, e.g. activated-p110-delta-syndrome-pik3cd"),
    ] = None,
    variant: Annotated[
        str | None,
        Query(max_length=120, description="Variant ID, e.g. BTK-p.Arg28His"),
    ] = None,
    exclude_direct: Annotated[
        bool,
        Query(
            description="Drop every record linking this disease straight to a molecule, so a molecule can "
            "only be reached through a bridge"
        ),
    ] = False,
) -> DiscoveryResponse:
    return await candidates(
        catalog, gene=gene, disease=disease, variant=variant, exclude_direct=exclude_direct
    )


@router.get(
    "/controls",
    response_model=ControlsResponse,
    summary="The stored result of the discovery controls: one positive, one negative, one upstream target",
)
async def read_controls() -> ControlsResponse:
    return controls()
