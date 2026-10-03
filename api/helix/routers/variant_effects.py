from typing import Annotated

from fastapi import APIRouter, Path, Query

from helix.errors import PROBLEM_RESPONSES
from helix.schemas.variant_effects import EffectMapResponse, ResidueEffectsResponse
from helix.services.variant_effects import effect_map, residue_effects

router = APIRouter(prefix="/proteins", tags=["variant-effects"], responses=PROBLEM_RESPONSES)


@router.get(
    "/{accession}/residues/{position}/effects",
    response_model=ResidueEffectsResponse,
    summary="Effect evidence at a residue, grouped by evidence kind",
)
async def get_residue_effects(
    accession: str,
    position: Annotated[int, Path(ge=1, description="UniProt canonical residue number")],
    alt: Annotated[str | None, Query(description="Alternate residue, one-letter code")] = None,
    ref: Annotated[
        str | None, Query(description="Reference residue the caller expects; a mismatch is flagged")
    ] = None,
) -> ResidueEffectsResponse:
    return await residue_effects(accession, position, alt, ref)


@router.get(
    "/{accession}/effect-map",
    response_model=EffectMapResponse,
    summary="Per-residue AlphaMissense summary, with the substitution matrix on request",
)
async def get_effect_map(
    accession: str,
    matrix: Annotated[bool, Query(description="Include the full residue x substitution matrix")] = False,
) -> EffectMapResponse:
    return await effect_map(accession, matrix)
