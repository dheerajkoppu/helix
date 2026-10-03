from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response

from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.compounds import (
    CompoundAnalogsResponse,
    CompoundDetailResponse,
    ProteinCompoundsResponse,
)
from orphafold.services.compounds import (
    compound_analogs,
    compound_depiction,
    compound_detail,
    protein_compounds,
)

router = APIRouter(tags=["compounds"], responses=PROBLEM_RESPONSES)


@router.get(
    "/proteins/{accession}/compounds",
    response_model=ProteinCompoundsResponse,
    summary="Compounds with experimental ligand evidence for a protein",
)
async def get_protein_compounds(accession: str) -> ProteinCompoundsResponse:
    return await protein_compounds(accession)


@router.get(
    "/compounds/{compound_id}",
    response_model=CompoundDetailResponse,
    summary="A compound by InChIKey or ChEMBL ID: cross-references, mechanisms, indications, targets",
)
async def get_compound(compound_id: str) -> CompoundDetailResponse:
    return await compound_detail(compound_id)


@router.get(
    "/compounds/{compound_id}/depiction.svg",
    summary="2D depiction of a compound (RDKit), transparent background",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}},
)
async def get_compound_depiction(
    compound_id: str,
    theme: Annotated[Literal["dark", "light"], Query()] = "light",
    width: Annotated[int, Query(ge=48, le=1024)] = 320,
    height: Annotated[int, Query(ge=48, le=1024)] = 240,
) -> Response:
    svg = await compound_depiction(compound_id, theme, width, height)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get(
    "/compounds/{compound_id}/analogs",
    response_model=CompoundAnalogsResponse,
    summary="Structurally similar ChEMBL compounds with the similarity value",
)
async def get_compound_analogs(
    compound_id: str,
    threshold: Annotated[int, Query(ge=40, le=100, description="Minimum similarity, percent")] = 70,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> CompoundAnalogsResponse:
    return await compound_analogs(compound_id, threshold, limit)
