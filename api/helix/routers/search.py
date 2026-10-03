"""GET /search: resolve a query to typed entities of the catalog, then of live sources."""

from typing import Annotated

from fastapi import APIRouter, Query

from helix.deps import CatalogDep, OptionalActor, SessionDep
from helix.errors import PROBLEM_RESPONSES, BadRequest
from helix.schemas.search import SearchResponse, SearchResultType
from helix.services.search import DEFAULT_LIMIT, search

router = APIRouter(prefix="/search", tags=["search"], responses=PROBLEM_RESPONSES)


def _result_types(values: list[str] | None) -> frozenset[SearchResultType] | None:
    names = [part.strip().lower() for value in values or [] for part in value.split(",") if part.strip()]
    if not names:
        return None
    try:
        return frozenset(SearchResultType(name) for name in names)
    except ValueError as error:
        allowed = ", ".join(result_type.value for result_type in SearchResultType)
        raise BadRequest(f"{error}. Allowed types: {allowed}.", code="invalid_search_type") from error


@router.get(
    "",
    response_model=SearchResponse,
    summary="Resolve a disease, gene, protein, variant, structure, compound or paper",
)
async def get_search(
    catalog: CatalogDep,
    session: SessionDep,
    actor: OptionalActor,
    q: Annotated[str, Query(max_length=200, description="Name, alias, identifier or variant notation")] = "",
    types: Annotated[
        list[str] | None,
        Query(
            description=(
                "Result types, repeatable or comma-separated. Compound and paper text search "
                "calls a live source and runs only when the type is named here."
            )
        ),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=50, description="Rows per group")] = DEFAULT_LIMIT,
) -> SearchResponse:
    return await search(catalog, q, types=_result_types(types), limit=limit, session=session, actor=actor)
