"""/assistant: status, the streamed chat, and the model-free source digest."""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Query
from sse_starlette import EventSourceResponse, ServerSentEvent

from orphafold.artifacts.store import get_artifact_store
from orphafold.assistant.digest import build_digest
from orphafold.assistant.engine import run_chat
from orphafold.assistant.prompts import AUDIENCES, SEGMENT_KIND_OPTIONS
from orphafold.assistant.registry import EvidenceRegistry
from orphafold.assistant.settings import get_assistant_settings
from orphafold.assistant.tools import TOOLS, ToolContext
from orphafold.db.session import session_scope
from orphafold.deps import ArtifactStoreDep, CatalogDep, OptionalActor, SessionDep, SettingsDep
from orphafold.errors import PROBLEM_RESPONSES, BadRequest, NotConfigured
from orphafold.knowledge.catalog import get_catalog
from orphafold.schemas.assistant import AssistantAnswer, AssistantContext, AssistantStatus, ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"], responses=PROBLEM_RESPONSES)

KEY_SETTING = "ANTHROPIC_API_KEY"


@router.get("/status", response_model=AssistantStatus, summary="Whether the assistant model is configured")
async def get_status(settings: SettingsDep) -> AssistantStatus:
    configured = bool(settings.anthropic_api_key)
    assistant = get_assistant_settings()
    return AssistantStatus(
        configured=configured,
        setting=KEY_SETTING,
        model=assistant.model,
        message=(
            f"Answers are written by {assistant.model} from records it reads through OrphaFold's services."
            if configured
            else f"No model is configured. Set {KEY_SETTING} in .env at the repository root (or api/.env) and "
            "restart the API. Until then the source digest lists the cited records for the open entity "
            "without a model."
        ),
        audiences=list(AUDIENCES),
        segment_kinds=list(SEGMENT_KIND_OPTIONS),
        tools=[tool.name for tool in TOOLS],
    )


@router.get(
    "/digest",
    response_model=AssistantAnswer,
    summary="Cited source records for the open entities, assembled without a model",
)
async def get_digest(
    session: SessionDep,
    catalog: CatalogDep,
    store: ArtifactStoreDep,
    actor: OptionalActor,
    disease: Annotated[str | None, Query(max_length=200)] = None,
    gene: Annotated[str | None, Query(max_length=40)] = None,
    accession: Annotated[str | None, Query(max_length=20)] = None,
    variant: Annotated[str | None, Query(max_length=80)] = None,
    residue: Annotated[int | None, Query(ge=1, le=40000)] = None,
    structure: Annotated[str | None, Query(max_length=120)] = None,
    compound: Annotated[str | None, Query(max_length=60)] = None,
    comparison: Annotated[str | None, Query(max_length=80)] = None,
) -> AssistantAnswer:
    context = AssistantContext(
        disease=disease,
        gene=gene,
        accession=accession,
        variant=variant,
        residue=residue,
        structure=structure,
        compound=compound,
        comparison=comparison,
    )
    if not any((disease, gene, accession, variant, compound)):
        raise BadRequest("Give at least one of disease, gene, accession, variant or compound.")
    tool_context = ToolContext(
        session=session,
        catalog=catalog,
        store=store,
        actor=actor,
        registry=EvidenceRegistry(),
        max_chars=get_assistant_settings().tool_result_chars,
    )
    return await build_digest(context, tool_context)


async def _chat_events(request: ChatRequest, actor_id: str | None, api_key: str) -> AsyncIterator[ServerSentEvent]:
    from orphafold.db.models import Actor

    assistant = get_assistant_settings()
    try:
        async with session_scope() as session:
            actor = await session.get(Actor, actor_id) if actor_id else None
            tool_context = ToolContext(
                session=session,
                catalog=get_catalog(),
                store=get_artifact_store(),
                actor=actor,
                registry=EvidenceRegistry(),
                max_chars=assistant.tool_result_chars,
            )
            async for name, data in run_chat(request, tool_context, api_key=api_key, settings=assistant):
                yield ServerSentEvent(event=name, data=json.dumps(data, default=str))
    except Exception:
        logger.exception("Assistant chat failed")
        yield ServerSentEvent(
            event="error",
            data=json.dumps({"code": "internal_error", "message": "The assistant failed inside OrphaFold."}),
        )
    yield ServerSentEvent(event="done", data="{}")


@router.post(
    "/chat",
    summary="Ask the assistant; the answer streams as server-sent events",
    description=(
        "Events: `status` (thinking, answering), `tool_call` and `tool_result` (one per lookup), "
        "`segment_delta` (index, kind, delta) while the answer is written, `answer_reset` when a partial "
        "answer is discarded, `answer` (the validated AssistantAnswer), `error` (code, message) and `done`. "
        "Only `answer` is authoritative: segment labels in `segment_delta` are the model's own and have not "
        "been checked yet."
    ),
    responses={200: {"content": {"text/event-stream": {}}, "description": "Server-sent events"}},
)
async def chat(request: ChatRequest, settings: SettingsDep, actor: OptionalActor) -> EventSourceResponse:
    if not settings.anthropic_api_key:
        raise NotConfigured("The assistant", setting=KEY_SETTING)
    if request.messages[-1].role != "user":
        raise BadRequest("The last message must be the reader's question.")
    return EventSourceResponse(
        _chat_events(request, actor.id if actor else None, settings.anthropic_api_key),
        ping=15,
        headers={"Cache-Control": "no-store"},
    )
