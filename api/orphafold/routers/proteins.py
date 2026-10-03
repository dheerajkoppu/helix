"""GET /proteins/{accession}, its residues and its FASTA."""

from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import PlainTextResponse

from orphafold.deps import CatalogDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.proteins import ProteinResponse, ResidueResponse
from orphafold.services.proteins import get_fasta, get_protein, get_residue

router = APIRouter(prefix="/proteins", tags=["proteins"], responses=PROBLEM_RESPONSES)

Accession = Annotated[str, Path(max_length=20, description="UniProt accession, e.g. Q06187")]


@router.get(
    "/{accession}",
    response_model=ProteinResponse,
    summary="Protein entry: names, sequence, annotations and feature tracks from UniProt and InterPro",
)
async def read_protein(accession: Accession, catalog: CatalogDep) -> ProteinResponse:
    return await get_protein(accession, catalog)


@router.get(
    "/{accession}/fasta",
    response_class=PlainTextResponse,
    summary="Canonical sequence in FASTA format, as UniProt serves it",
    responses={200: {"content": {"text/x-fasta": {}}}},
)
async def read_fasta(accession: Accession) -> PlainTextResponse:
    text, provenance = await get_fasta(accession)
    headers = {"Content-Disposition": f'inline; filename="{accession.strip().upper()}.fasta"'}
    if provenance is not None:
        headers["X-OrphaFold-Source"] = provenance.source
        if provenance.release:
            headers["X-OrphaFold-Source-Release"] = provenance.release
    return PlainTextResponse(text, media_type="text/x-fasta", headers=headers)


@router.get(
    "/{accession}/residues/{position}",
    response_model=ResidueResponse,
    summary="One residue: the amino acid and every feature and InterPro entry covering it",
)
async def read_residue(
    accession: Accession,
    position: Annotated[int, Path(ge=1, description="UniProt canonical residue number")],
    catalog: CatalogDep,
) -> ResidueResponse:
    return await get_residue(accession, position, catalog)
