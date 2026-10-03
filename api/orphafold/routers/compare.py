"""/compare: plan a reference-versus-variant comparison and read its results.

Running one goes through POST /api/v1/jobs with kind variant_comparison.
"""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from orphafold.deps import ArtifactStoreDep, CatalogDep, OptionalActor, SessionDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.compare import ComparePlanResponse, CompareResultResponse
from orphafold.services import compare as service

router = APIRouter(prefix="/compare", tags=["compare"], responses=PROBLEM_RESPONSES)


@router.get(
    "/results/{job_id}",
    response_model=CompareResultResponse,
    summary="Both models and the difference payload of one comparison",
)
async def get_comparison_result(
    job_id: str, session: SessionDep, store: ArtifactStoreDep
) -> CompareResultResponse:
    return await service.comparison_result(session, store, job_id)


@router.get(
    "/examples/{job_id}/files/{name}",
    summary="A stored file of a cached example",
    responses={200: {"content": {"application/octet-stream": {}}, "description": "The stored file"}},
)
async def get_example_file(job_id: str, name: str) -> FileResponse:
    path, media_type = service.example_file(job_id, name)
    return FileResponse(
        path, media_type=media_type, filename=name, headers={"Cache-Control": "public, max-age=3600"}
    )


@router.get(
    "/{gene}/{change}",
    response_model=ComparePlanResponse,
    summary="What a reference-versus-variant comparison of this variant would run, and existing results",
)
async def get_comparison_plan(
    gene: str, change: str, session: SessionDep, catalog: CatalogDep, actor: OptionalActor
) -> ComparePlanResponse:
    return await service.plan_comparison(session, actor, catalog, gene, change)
