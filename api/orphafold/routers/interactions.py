"""Interactions and pathways of a protein, and the drugs acting on a gene product."""

from typing import Annotated

from fastapi import APIRouter, Path

from orphafold.deps import CatalogDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.diseases import TreatmentsResponse
from orphafold.schemas.interactions import InteractionsResponse, PathwaysResponse
from orphafold.services.interactions import protein_interactions
from orphafold.services.pathways import protein_pathways
from orphafold.services.treatments import gene_treatments

router = APIRouter(responses=PROBLEM_RESPONSES)

Accession = Annotated[
    str,
    Path(
        max_length=20,
        pattern=r"^[A-Za-z0-9]{6,10}$",
        description="UniProt accession, e.g. Q06187",
    ),
]


@router.get(
    "/proteins/{accession}/interactions",
    response_model=InteractionsResponse,
    tags=["interactions"],
    summary="IntAct curated interactions, and STRING physical associations as a separate layer",
)
async def read_interactions(accession: Accession, catalog: CatalogDep) -> InteractionsResponse:
    return await protein_interactions(accession, catalog)


@router.get(
    "/proteins/{accession}/pathways",
    response_model=PathwaysResponse,
    tags=["pathways"],
    summary="Reactome pathways of a protein",
)
async def read_pathways(accession: Accession, catalog: CatalogDep) -> PathwaysResponse:
    return await protein_pathways(accession, catalog)


@router.get(
    "/genes/{symbol}/treatments",
    response_model=TreatmentsResponse,
    tags=["treatments"],
    summary="Drugs and clinical candidates whose recorded mechanism acts on the gene product (Open Targets)",
)
async def read_treatments(
    symbol: Annotated[
        str,
        Path(max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]*$", description="HGNC symbol, e.g. BTK"),
    ],
    catalog: CatalogDep,
) -> TreatmentsResponse:
    return await gene_treatments(symbol, catalog)
