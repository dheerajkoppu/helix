"""The model loop: Claude reads OrphaFold records through tools and answers through submit_answer."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import anthropic
from pydantic import ValidationError

from orphafold.assistant.prompts import ANSWER_TOOL_DEFINITION, SYSTEM_PROMPT, context_block
from orphafold.assistant.settings import AssistantSettings
from orphafold.assistant.tools import (
    ANSWER_TOOL,
    TOOLS,
    ToolContext,
    ToolOutcome,
    merge_statuses,
    run_tool,
    tool_label,
)
from orphafold.assistant.validation import AnswerInput, SegmentInput, cited_keys, validate_answer
from orphafold.schemas.assistant import SEGMENT_KINDS, AssistantAnswer, ChatRequest, Lookup

logger = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_HISTORY_TURNS = 12
MAX_JSON_RETRIES = 2

Event = tuple[str, dict[str, Any]]


def build_messages(request: ChatRequest) -> list[dict[str, Any]]:
    turns = list(request.messages[-MAX_HISTORY_TURNS:])
    while turns and turns[0].role != "user":
        turns.pop(0)
    question = turns.pop()
    messages: list[dict[str, Any]] = [{"role": turn.role, "content": turn.content} for turn in turns]
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": context_block(request.context, request.audience)},
                {"type": "text", "text": question.content},
            ],
        }
    )
    return messages


class AnswerStream:
    """Turns the growing input of submit_answer into text deltas per segment."""

    def __init__(self) -> None:
        self.sent: list[int] = []
        self.kinds: list[str | None] = []

    def update(self, snapshot: object) -> list[Event]:
        segments = snapshot.get("segments") if isinstance(snapshot, dict) else None
        if not isinstance(segments, list):
            return []
        events: list[Event] = []
        for index, segment in enumerate(segments):
            if not isinstance(segment, dict):
                continue
            while len(self.sent) <= index:
                self.sent.append(0)
                self.kinds.append(None)
            kind = segment.get("kind")
            kind = kind if kind in SEGMENT_KINDS else None
            text = segment.get("text")
            text = text if isinstance(text, str) else ""
            if len(text) > self.sent[index] or (kind and kind != self.kinds[index]):
                events.append(
                    ("segment_delta", {"index": index, "kind": kind, "delta": text[self.sent[index] :]})
                )
                self.sent[index] = len(text)
                self.kinds[index] = kind
        return events


def _error(code: str, message: str) -> Event:
    return ("error", {"code": code, "message": message})


def _api_error(error: anthropic.APIError) -> Event:
    if isinstance(error, anthropic.AuthenticationError):
        return _error("invalid_key", "Anthropic rejected the configured ANTHROPIC_API_KEY.")
    if isinstance(error, anthropic.PermissionDeniedError):
        return _error("model_not_permitted", "The configured key is not permitted to use the assistant model.")
    if isinstance(error, anthropic.NotFoundError):
        return _error("model_not_found", "The configured assistant model does not exist for this key.")
    if isinstance(error, anthropic.RateLimitError):
        return _error("rate_limited", "The model provider is rate limiting this deployment. Try again shortly.")
    if isinstance(error, anthropic.APIStatusError):
        return _error("model_error", f"The model provider answered {error.status_code}.")
    if isinstance(error, anthropic.APIConnectionError):
        return _error("model_unreachable", "The model provider could not be reached.")
    return _error("model_error", "The model request failed.")


def _usage(total: dict[str, int], message: Any) -> None:
    usage = getattr(message, "usage", None)
    if usage is None:
        return
    for name in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
        total[name] = total.get(name, 0) + (getattr(usage, name, None) or 0)


async def run_chat(
    request: ChatRequest,
    context: ToolContext,
    *,
    api_key: str,
    settings: AssistantSettings,
) -> AsyncIterator[Event]:
    client = anthropic.AsyncAnthropic(api_key=api_key)
    params: dict[str, Any] = {
        "model": settings.model,
        "max_tokens": settings.max_tokens,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "tools": [*(tool.definition() for tool in TOOLS), ANSWER_TOOL_DEFINITION],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": settings.effort},
        "cache_control": {"type": "ephemeral"},
    }
    if settings.refusal_fallback:
        params["betas"] = [FALLBACK_BETA]
        params["fallbacks"] = "default"

    messages = build_messages(request)
    lookups: list[Lookup] = []
    usage: dict[str, int] = {}
    served_by = settings.model
    json_retries = 0
    nudged = False
    round_index = 0

    def finish(segments_input: AnswerInput) -> Event:
        segments = validate_answer(segments_input, context.registry)
        answer = AssistantAnswer(
            segments=segments,
            evidence=context.registry.cited(cited_keys(segments)),
            lookups=lookups,
            generated_by="model",
            model=served_by,
            audience=request.audience,
            downgraded=sum(
                1 for segment in segments if segment.claimed_kind and segment.kind == "reasoning_hypothesis"
            ),
            relabelled=sum(
                1 for segment in segments if segment.claimed_kind and segment.kind != "reasoning_hypothesis"
            ),
            usage=usage,
            sources=merge_statuses(context.sources),
        )
        return ("answer", answer.model_dump(mode="json"))

    try:
        while round_index < settings.max_rounds:
            round_index += 1
            answer_stream = AnswerStream()
            streaming_tool: str | None = None
            yield ("status", {"state": "thinking", "round": round_index})
            try:
                async with client.beta.messages.stream(**params, messages=messages) as stream:
                    async for event in stream:
                        if event.type == "content_block_start":
                            block = event.content_block
                            streaming_tool = block.name if block.type == "tool_use" else None
                            if streaming_tool == ANSWER_TOOL:
                                yield ("status", {"state": "answering", "round": round_index})
                        elif event.type == "input_json" and streaming_tool == ANSWER_TOOL:
                            for delta in answer_stream.update(event.snapshot):
                                yield delta
                        elif event.type == "content_block_stop":
                            streaming_tool = None
                    message = await stream.get_final_message()
                json_retries = 0
            except ValueError:
                # Tool input the SDK could not parse; there is no tool_use block to answer, so re-issue the turn
                json_retries += 1
                round_index -= 1
                if json_retries > MAX_JSON_RETRIES:
                    yield _error("model_error", "The model produced tool input that could not be read.")
                    return
                yield ("answer_reset", {})
                continue

            _usage(usage, message)
            served_by = message.model or served_by

            if message.stop_reason == "refusal":
                details = getattr(message, "stop_details", None)
                yield (
                    "error",
                    {
                        "code": "model_declined",
                        "category": getattr(details, "category", None),
                        "message": "The model declined this request. The source digest for the current "
                        "entity is still available.",
                    },
                )
                return
            if message.stop_reason == "pause_turn":
                messages.append({"role": "assistant", "content": message.content})
                continue

            tool_uses = [block for block in message.content if block.type == "tool_use"]
            if message.stop_reason == "max_tokens":
                yield _error("answer_truncated", "The answer exceeded the output limit and was cut off.")
                return

            if not tool_uses:
                text = "".join(block.text for block in message.content if block.type == "text").strip()
                if not nudged and round_index < settings.max_rounds:
                    nudged = True
                    messages.append({"role": "assistant", "content": message.content})
                    messages.append(
                        {
                            "role": "user",
                            "content": f"Deliver the answer by calling {ANSWER_TOOL} with labelled segments.",
                        }
                    )
                    continue
                if not text:
                    yield _error("no_answer", "The model returned no answer.")
                    return
                # Free text carries no verifiable citations, so all of it is reasoning
                yield ("answer_reset", {})
                yield finish(AnswerInput(segments=[SegmentInput(kind="reasoning_hypothesis", text=text[:4000])]))
                return

            answer_block = next((block for block in tool_uses if block.name == ANSWER_TOOL), None)
            lookup_blocks = [block for block in tool_uses if block.name != ANSWER_TOOL]

            results: list[dict[str, Any]] = []
            if lookup_blocks:
                for block in lookup_blocks:
                    yield (
                        "tool_call",
                        {"id": block.id, "tool": block.name, "label": tool_label(block.name, block.input)},
                    )
                outcomes: list[ToolOutcome] = await asyncio.gather(
                    *(run_tool(block.name, block.input, context) for block in lookup_blocks)
                )
                for block, outcome in zip(lookup_blocks, outcomes, strict=True):
                    lookup = Lookup(
                        id=block.id,
                        tool=block.name,
                        label=tool_label(block.name, block.input),
                        ok=outcome.ok,
                        message=outcome.message,
                        evidence_count=len(outcome.keys),
                    )
                    lookups.append(lookup)
                    yield ("tool_result", lookup.model_dump(mode="json"))
                    result: dict[str, Any] = {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": outcome.content,
                    }
                    if not outcome.ok:
                        result["is_error"] = True
                    results.append(result)

            if answer_block is not None:
                try:
                    parsed = AnswerInput.model_validate(answer_block.input)
                except ValidationError as error:
                    yield ("answer_reset", {})
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": answer_block.id,
                            "is_error": True,
                            "content": json.dumps({"INVALID_INPUT": error.errors(include_url=False)}, default=str),
                        }
                    )
                else:
                    yield finish(parsed)
                    return

            messages.append({"role": "assistant", "content": message.content})
            content: list[dict[str, Any]] = list(results)
            if round_index == settings.max_rounds - 1:
                content.append(
                    {
                        "type": "text",
                        "text": f"This was the last lookup. Call {ANSWER_TOOL} now with what the records support, "
                        "and say what could not be established.",
                    }
                )
            messages.append({"role": "user", "content": content})

        yield _error("no_answer", f"The assistant did not reach an answer within {settings.max_rounds} model turns.")
    except anthropic.APIError as error:
        logger.warning("Assistant model request failed: %s", error)
        yield _api_error(error)
    finally:
        await client.close()
