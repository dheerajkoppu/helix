"""Candidate mechanisms of a variant, derived by fixed rules from retrieved records."""

from fastapi import APIRouter

from orphafold.deps import CatalogDep, OptionalActor, SessionDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.mechanisms import MechanismsResponse
from orphafold.services.mechanisms import variant_mechanisms

router = APIRouter(tags=["mechanisms"], responses=PROBLEM_RESPONSES)


@router.get(
    "/variants/{variant_id}/mechanisms",
    response_model=MechanismsResponse,
    summary="Candidate mechanisms of a single-residue variant, each with the records that raise it",
)
async def get_variant_mechanisms(
    variant_id: str, catalog: CatalogDep, session: SessionDep, actor: OptionalActor
) -> MechanismsResponse:
    return await variant_mechanisms(variant_id, catalog, session, actor)
