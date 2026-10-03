import { create } from "zustand";

import { apiRequest, apiUrl } from "@/lib/api/client";
import type { AudienceLevel } from "@/lib/state/assistant";
import { WORKSPACE_HEADER, getWorkspaceId } from "@/lib/workspace-identity";

import { digestQuery } from "./use-assistant-context";
import {
  SEGMENT_KINDS,
  type AssistantAnswer,
  type ChatContext,
  type DraftSegment,
  type Lookup,
  type SegmentKind,
  type Turn,
} from "./types";

interface ChatState {
  turns: Turn[];
  streaming: boolean;
  /** the unsent question in the composer */
  composer: string;
  setComposer: (composer: string) => void;
  send: (
    question: string,
    context: ChatContext,
    audience: AudienceLevel,
  ) => void;
  /** Adds the model-free digest of the cited records for the context as a turn. */
  digest: (context: ChatContext) => void;
  stop: () => void;
  reset: () => void;
}

let turnCount = 0;
let controller: AbortController | null = null;

const isSegmentKind = (value: unknown): value is SegmentKind =>
  typeof value === "string" &&
  (SEGMENT_KINDS as readonly string[]).includes(value);

/** A finished answer as the plain text sent back as conversation history. */
function answerText(answer: AssistantAnswer): string {
  return answer.segments
    .map((segment) => `[${segment.kind}] ${segment.text}`)
    .join("\n");
}

function history(turns: Turn[]) {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of turns) {
    if (turn.status !== "done" || !turn.answer) continue;
    if (turn.answer.generated_by !== "model") continue;
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: answerText(turn.answer) });
  }
  return messages.slice(-10);
}

interface Frame {
  event: string;
  data: string;
}

/** Splits a server-sent event stream into frames. sse-starlette ends lines with CRLF. */
async function* readFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Frame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) yield { event, data: data.join("\n") };
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parse(data: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(data);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const useAssistantChat = create<ChatState>()((set, get) => {
  const patch = (id: string, change: (turn: Turn) => Turn) =>
    set((state) => ({
      turns: state.turns.map((turn) => (turn.id === id ? change(turn) : turn)),
    }));

  function apply(id: string, frame: Frame) {
    const data = parse(frame.data);
    switch (frame.event) {
      case "status":
        patch(id, (turn) => ({
          ...turn,
          step:
            data.state === "answering"
              ? "Writing the answer"
              : turn.lookups.length > 0
                ? "Reading the records"
                : "Choosing what to look up",
        }));
        break;
      case "tool_call":
        patch(id, (turn) => ({
          ...turn,
          step: `Looking up: ${String(data.label ?? data.tool)}`,
          lookups: [
            ...turn.lookups,
            {
              id: String(data.id),
              tool: String(data.tool),
              label: String(data.label ?? data.tool),
              ok: true,
              message: null,
              evidence_count: 0,
              pending: true,
            },
          ],
        }));
        break;
      case "tool_result":
        patch(id, (turn) => ({
          ...turn,
          lookups: turn.lookups.map((lookup) =>
            lookup.id === data.id
              ? { ...(data as unknown as Lookup), pending: false }
              : lookup,
          ),
        }));
        break;
      case "segment_delta": {
        const index = typeof data.index === "number" ? data.index : 0;
        patch(id, (turn) => {
          const draft: DraftSegment[] = turn.draft.slice();
          while (draft.length <= index) draft.push({ kind: null, text: "" });
          draft[index] = {
            kind: isSegmentKind(data.kind) ? data.kind : draft[index].kind,
            text: draft[index].text + String(data.delta ?? ""),
          };
          return { ...turn, draft };
        });
        break;
      }
      case "answer_reset":
        patch(id, (turn) => ({ ...turn, draft: [] }));
        break;
      case "answer":
        patch(id, (turn) => ({
          ...turn,
          status: "done",
          step: null,
          draft: [],
          answer: data as unknown as AssistantAnswer,
        }));
        break;
      case "error":
        patch(id, (turn) => ({
          ...turn,
          status: "error",
          step: null,
          draft: [],
          error: {
            code: String(data.code ?? "error"),
            message: String(data.message ?? "The assistant failed."),
          },
        }));
        break;
      default:
        break;
    }
  }

  function begin(
    question: string,
    context: ChatContext,
    audience: AudienceLevel,
  ) {
    turnCount += 1;
    const turn: Turn = {
      id: `turn-${Date.now()}-${turnCount}`,
      question,
      context,
      audience,
      status: "streaming",
      step: "Choosing what to look up",
      lookups: [],
      draft: [],
      answer: null,
      error: null,
    };
    controller?.abort();
    controller = new AbortController();
    set((state) => ({ turns: [...state.turns, turn], streaming: true }));
    return { turn, signal: controller.signal };
  }

  const fail = (id: string, code: string, message: string) =>
    patch(id, (turn) =>
      turn.status === "streaming"
        ? { ...turn, status: "error", step: null, error: { code, message } }
        : turn,
    );

  return {
    turns: [],
    streaming: false,
    composer: "",
    setComposer: (composer) => set({ composer }),

    send: (question, context, audience) => {
      const text = question.trim();
      if (!text || get().streaming) return;
      const messages = [
        ...history(get().turns),
        { role: "user" as const, content: text },
      ];
      const { turn, signal } = begin(text, context, audience);
      void (async () => {
        try {
          const workspaceId = getWorkspaceId();
          const response = await fetch(apiUrl("/assistant/chat"), {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              ...(workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : {}),
            },
            body: JSON.stringify({ messages, context, audience }),
          });
          if (!response.ok || !response.body) {
            const problem = (await response.json().catch(() => ({}))) as {
              code?: string;
              detail?: string;
            };
            fail(
              turn.id,
              problem.code ?? "request_failed",
              problem.detail ?? `The assistant answered ${response.status}.`,
            );
            return;
          }
          for await (const frame of readFrames(response.body))
            apply(turn.id, frame);
          fail(turn.id, "stream_closed", "The answer stream ended early.");
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            patch(turn.id, (current) =>
              current.status === "streaming"
                ? { ...current, status: "stopped", step: null }
                : current,
            );
          else
            fail(
              turn.id,
              "unreachable",
              "The OrphaFold API could not be reached.",
            );
        } finally {
          set({ streaming: false });
        }
      })();
    },

    digest: (context) => {
      if (get().streaming) return;
      const { turn, signal } = begin(
        "Source digest for the open entities",
        context,
        "researcher",
      );
      patch(turn.id, (current) => ({
        ...current,
        step: "Reading the source records",
      }));
      void (async () => {
        try {
          const result = await apiRequest<AssistantAnswer>("/assistant/digest", {
            query: digestQuery(context),
            signal,
          });
          patch(turn.id, (current) => ({
            ...current,
            status: "done",
            step: null,
            answer: result.data,
          }));
        } catch (error) {
          fail(
            turn.id,
            "digest_failed",
            error instanceof Error
              ? error.message
              : "The digest could not be assembled.",
          );
        } finally {
          set({ streaming: false });
        }
      })();
    },

    stop: () => controller?.abort(),

    reset: () => {
      controller?.abort();
      set({ turns: [], streaming: false });
    },
  };
});
