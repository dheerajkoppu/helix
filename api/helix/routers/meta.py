"""GET /health and GET /meta."""

from fastapi import APIRouter, Request

from helix import __version__
from helix.config import API_PREFIX
from helix.db.session import database_ok
from helix.deps import CatalogDep, SettingsDep
from helix.errors import PROBLEM_RESPONSES
from helix.ids import utcnow
from helix.jobs.registry import all_handlers
from helix.plugins import load_errors
from helix.providers.base import all_providers
from helix.schemas.catalog import DatasetInfo, EnumEntry, Features, HealthResponse, MetaResponse
from helix.schemas.common import (
    CLAIM_LABELS,
    EVIDENCE_CODES,
    EVIDENCE_DISPLAY_ORDER,
    EVIDENCE_LABELS,
    STRUCTURE_ORIGIN_LABELS,
    STRUCTURE_ORIGIN_TAGS,
    StructureOrigin,
)
from helix.sources.base import all_sources

router = APIRouter(tags=["meta"], responses=PROBLEM_RESPONSES)

RESEARCH_USE_NOTICE = (
    "Helix is a research and hypothesis-generation tool. It is not clinical decision software."
)


@router.get("/health", response_model=HealthResponse, summary="Liveness and component state")
async def health(request: Request, catalog: CatalogDep, settings: SettingsDep) -> HealthResponse:
    database_up = await database_ok()
    worker = getattr(request.app.state, "worker", None)
    if worker is not None:
        worker_state = "embedded" if worker.running else "stopped"
    else:
        worker_state = "external"
    return HealthResponse(
        status="ok" if database_up else "degraded",
        version=__version__,
        time=utcnow(),
        database="ok" if database_up else "unavailable",
        catalog=catalog.status.state,
        data_release=catalog.release,
        job_queue=settings.resolved_job_queue,
        worker=worker_state,
        load_errors=load_errors(),
    )


@router.get("/meta", response_model=MetaResponse, summary="Dataset, sources and deployment features")
async def meta(catalog: CatalogDep, settings: SettingsDep) -> MetaResponse:
    manifest = catalog.manifest
    return MetaResponse(
        name="Helix",
        version=__version__,
        api_prefix=API_PREFIX,
        license="Apache-2.0",
        research_use_notice=RESEARCH_USE_NOTICE,
        dataset=DatasetInfo(
            id=manifest.dataset if manifest else None,
            citation=manifest.citation if manifest else None,
            doi=manifest.doi if manifest else None,
            generated_at=manifest.generated_at if manifest else None,
            declared_counts=manifest.counts if manifest else {},
            loaded_counts=catalog.status.counts,
        ),
        catalog=catalog.status,
        seed_sources=manifest.sources if manifest else [],
        live_sources=[adapter.describe() for adapter in all_sources()],
        features=Features(
            noncommercial_sources_enabled=settings.enable_noncommercial_sources,
            assistant_configured=bool(settings.anthropic_api_key),
            ncbi_api_key_configured=bool(settings.ncbi_api_key),
            boltz_configured=bool(settings.boltz_executable),
            msa_server_configured=bool(settings.msa_server_url),
            job_queue=settings.resolved_job_queue,
            artifact_store=settings.resolved_artifact_store,
            database="sqlite" if settings.is_sqlite else "postgresql",
        ),
        evidence_classes=[
            EnumEntry(
                value=evidence_class.value,
                code=EVIDENCE_CODES[evidence_class],
                label=EVIDENCE_LABELS[evidence_class],
                extra={"claim_label": CLAIM_LABELS[evidence_class].value},
            )
            for evidence_class in EVIDENCE_DISPLAY_ORDER
        ],
        structure_origins=[
            EnumEntry(
                value=origin.value, code=STRUCTURE_ORIGIN_TAGS[origin], label=STRUCTURE_ORIGIN_LABELS[origin]
            )
            for origin in StructureOrigin
        ],
        job_kinds=[handler.kind for handler in all_handlers()],
        providers=[provider.id for provider in all_providers()],
    )
