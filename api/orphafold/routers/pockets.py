from typing import Annotated

from fastapi import APIRouter, Query

from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.pockets import PocketsResponse
from orphafold.services.pockets import protein_pockets

router = APIRouter(prefix="/proteins", tags=["pockets"], responses=PROBLEM_RESPONSES)


@router.get(
    "/{accession}/pockets",
    response_model=PocketsResponse,
    summary="Predicted pockets (P2Rank through PrankWeb) of an AlphaFold DB model or a PDB entry",
)
async def get_protein_pockets(
    accession: str,
    structure_id: Annotated[
        str | None,
        Query(description="pdb:<ID> or afdb:<entryId>; the AlphaFold DB model of the protein when omitted"),
    ] = None,
    residue: Annotated[
        int | None, Query(ge=1, description="UniProt position to test against every pocket")
    ] = None,
) -> PocketsResponse:
    return await protein_pockets(accession, structure_id, residue)
