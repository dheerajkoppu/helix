"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { KeyHint } from "@/components/data/key-hint";
import { QueryErrorState } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { apiQuery } from "@/lib/api/query";
import {
  AUDIENCE_LEVELS,
  useAssistant,
  type AudienceLevel,
} from "@/lib/state/assistant";
import { useAdvancedMode } from "@/lib/state/preferences";

import { AnswerView, DraftSegments, LookupList } from "./answer-view";
import { useAssistantChat } from "./chat-store";
import { SEGMENT_KIND_META, SEGMENT_KIND_ORDER } from "./segment-kinds";
import type {
  AssistantAnswer,
  AssistantStatus,
  ChatContext,
  Turn,
} from "./types";
import {
  digestQuery,
  hasEntity,
  suggestedChips,
  useAssistantContext,
  type ContextChip,
  type QuestionChip,
} from "./use-assistant-context";

const AUDIENCE_LABELS: Record<
  AudienceLevel,
  { label: string; short: string; description: string }
> = {
  high_school: {
    short: "Student",
    label: "High-school student",
    description: "Plain language, every term explained",
  },
  undergraduate: {
    short: "Undergraduate",
    label: "Biology undergraduate",
    description: "Standard vocabulary, specialist terms defined",
  },
  researcher: {
    short: "Researcher",
    label: "Researcher",
    description: "Compact, identifiers and scales stated",
  },
  structural_biologist: {
    short: "Structural",
    label: "Structural biologist",
    description: "Residue-level detail, methods and confidence",
  },
};

function AudienceControl() {
  const audience = useAssistant((state) => state.audience);
  const setAudience = useAssistant((state) => state.setAudience);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Explain for: ${AUDIENCE_LABELS[audience].label}`}
        className="inline-flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-active aria-expanded:text-foreground"
      >
        <span className="truncate">{AUDIENCE_LABELS[audience].short}</span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <p className="px-2 pt-1.5 pb-1 text-2xs text-muted-foreground">
          Depth of explanation. The facts and their labels stay the same.
        </p>
        <DropdownMenuRadioGroup
          value={audience}
          onValueChange={(value) => {
            if ((AUDIENCE_LEVELS as readonly string[]).includes(String(value)))
              setAudience(value as AudienceLevel);
          }}
        >
          {AUDIENCE_LEVELS.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} closeOnClick>
              <span className="flex flex-col">
                <span>{AUDIENCE_LABELS[level].label}</span>
                <span className="text-2xs text-muted-foreground">
                  {AUDIENCE_LABELS[level].description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextBar({
  chips,
  advanced,
}: {
  chips: ContextChip[];
  advanced: boolean;
}) {
  if (chips.length === 0 && !advanced) return null;
  return (
    <div className="no-scrollbar flex min-h-8 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border-subtle px-3 py-1.5">
      {advanced ? (
        <span className="text-[0.625rem] font-medium tracking-[0.08em] text-subtle-foreground uppercase">
          Context
        </span>
      ) : null}
      {chips.length === 0 ? (
        <span className="text-xs text-muted-foreground">No entity open</span>
      ) : (
        chips.map((chip) => (
          <span
            key={chip.kind}
            title={chip.kind}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-border px-1.5 text-2xs"
          >
            {advanced ? (
              <span className="text-muted-foreground">{chip.kind}</span>
            ) : (
              <span className="sr-only">{chip.kind}</span>
            )}
            <span className="max-w-40 truncate font-mono text-foreground">
              {chip.value}
            </span>
          </span>
        ))
      )}
    </div>
  );
}

function Legend() {
  return (
    <section className="flex flex-col gap-2 px-3 py-3">
      <h3 className="text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
        How answers are labelled
      </h3>
      {SEGMENT_KIND_ORDER.map((kind) => {
        const meta = SEGMENT_KIND_META[kind];
        return (
          <div key={kind} className={cn("pl-2.5", meta.ruleClass)}>
            <p className="flex items-center gap-1.5 text-2xs leading-4">
              <span
                className={cn(
                  "font-mono font-semibold tracking-[0.06em]",
                  meta.textClass,
                )}
              >
                {meta.code}
              </span>
              <span className="text-foreground">{meta.label}</span>
            </p>
            <p className="text-2xs text-muted-foreground">{meta.description}</p>
          </div>
        );
      })}
      <p className="text-2xs text-muted-foreground">
        OrphaFold checks every factual segment against the records it cites. A
        claim without a source record is shown as reasoning.
      </p>
    </section>
  );
}

/** The label key behind a `?`, so the chat itself carries no explanation. */
function LegendButton() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="How answers are labelled"
            title="How answers are labelled"
          >
            <CircleHelpIcon aria-hidden />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <Legend />
      </PopoverContent>
    </Popover>
  );
}

function QuestionChips({
  chips,
  onAsk,
  disabled,
}: {
  chips: QuestionChip[];
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
      {chips.map((chip) => (
        <li key={chip.prompt}>
          <button
            type="button"
            disabled={disabled}
            title={chip.prompt}
            onClick={() => onAsk(chip.prompt)}
            className="inline-flex h-7 cursor-pointer items-center rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none hover:border-border-strong hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:text-disabled-foreground"
          >
            {chip.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SetupSteps({ status }: { status: AssistantStatus }) {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-muted-foreground">
      <li>
        Add{" "}
        <span className="font-mono text-foreground">
          {status.setting}=&lt;your key&gt;
        </span>{" "}
        to <span className="font-mono text-foreground">.env</span> at the
        repository root, or to{" "}
        <span className="font-mono text-foreground">api/.env</span>.
      </li>
      <li>Restart the API.</li>
      <li>
        Optional:{" "}
        <span className="font-mono text-foreground">
          ORPHAFOLD_ASSISTANT_MODEL
        </span>{" "}
        selects the model (default{" "}
        <span className="font-mono text-foreground">{status.model}</span>).
      </li>
    </ol>
  );
}

function NotConfigured({
  status,
  advanced,
}: {
  status: AssistantStatus;
  advanced: boolean;
}) {
  if (!advanced)
    return (
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          No model key set. Showing source records.
        </span>
        <Popover>
          <PopoverTrigger className="ml-auto shrink-0 cursor-pointer rounded-xs text-xs text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            Setup
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <SetupSteps status={status} />
          </PopoverContent>
        </Popover>
      </div>
    );
  return (
    <section className="flex flex-col gap-1.5 border-b border-border px-3 py-3 text-xs">
      <h3 className="font-medium text-foreground">No model is configured</h3>
      <p className="text-muted-foreground">
        Orpha writes answers with a Claude model that reads OrphaFold&apos;s
        records. This deployment has no API key, so questions cannot be
        answered.
      </p>
      <SetupSteps status={status} />
      <p className="text-muted-foreground">
        The source digest below needs no model: it lists the cited records for
        the open entities, straight from the databases.
      </p>
    </section>
  );
}

function SourceDigest({
  context,
  advanced,
}: {
  context: ChatContext;
  advanced: boolean;
}) {
  const enabled = hasEntity(context);
  const digest = useQuery({
    ...apiQuery<AssistantAnswer>("/assistant/digest", digestQuery(context)),
    enabled,
    staleTime: 5 * 60_000,
  });

  if (!enabled)
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        Open a disease, gene, protein or variant to see its records.
      </p>
    );
  if (digest.isPending)
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        Reading the source records
      </p>
    );
  if (digest.error)
    return (
      <QueryErrorState
        error={digest.error}
        subject="the source digest"
        onRetry={() => void digest.refetch()}
      />
    );
  const turn: Turn & { answer: AssistantAnswer } = {
    id: "digest",
    question: "Source digest",
    context,
    audience: "researcher",
    status: "done",
    step: null,
    lookups: digest.data.data.lookups,
    draft: [],
    answer: digest.data.data,
    error: null,
  };
  return (
    <section className="flex flex-col gap-2 px-3 py-3">
      {advanced ? (
        <h3 className="text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
          Source digest
        </h3>
      ) : null}
      <LookupList lookups={turn.lookups} />
      <AnswerView turn={turn} />
    </section>
  );
}

function TurnView({
  turn,
  onDigest,
  advanced,
}: {
  turn: Turn;
  onDigest: () => void;
  advanced: boolean;
}) {
  const digest = turn.answer?.generated_by === "source_digest";
  return (
    <article className="flex flex-col gap-2.5 border-b border-border-subtle px-3 py-3">
      {advanced ? (
        <header className="flex flex-col gap-0.5">
          <span className="text-[0.625rem] font-medium tracking-[0.08em] text-subtle-foreground uppercase">
            {digest ? "Digest" : "Question"}
          </span>
          <h3 className="text-sm font-medium text-foreground">
            {turn.question}
          </h3>
        </header>
      ) : (
        <h3 className="ml-8 w-fit max-w-full self-end rounded-md border border-border-subtle bg-sunken px-2.5 py-1.5 text-sm font-normal text-foreground">
          {digest ? "Source records" : turn.question}
        </h3>
      )}
      <LookupList lookups={turn.lookups} />
      {turn.status === "streaming" && turn.step ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Spinner className="size-3" />
          {turn.step}
        </p>
      ) : null}
      {turn.draft.length > 0 ? <DraftSegments draft={turn.draft} /> : null}
      {turn.answer ? (
        <AnswerView turn={{ ...turn, answer: turn.answer }} />
      ) : null}
      {turn.status === "stopped" ? (
        <p className="text-xs text-muted-foreground">Stopped.</p>
      ) : null}
      {turn.error ? (
        <div role="alert" className="flex flex-col gap-1.5 text-xs">
          <p className="text-foreground">{turn.error.message}</p>
          {advanced ? (
            <p className="font-mono text-2xs text-muted-foreground">
              {turn.error.code}
            </p>
          ) : null}
          {hasEntity(turn.context) ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={onDigest}
            >
              Show source records
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** The assistant, docked beside the page. One conversation survives navigation and closing. */
export function AssistantDock() {
  const open = useAssistant((state) => state.open);
  const setOpen = useAssistant((state) => state.setOpen);
  const toggle = useAssistant((state) => state.toggle);
  const pending = useAssistant((state) => state.pending);
  const clearPending = useAssistant((state) => state.clearPending);
  const audience = useAssistant((state) => state.audience);
  const restoreAudience = useAssistant((state) => state.restoreAudience);
  const advanced = useAdvancedMode();

  const turns = useAssistantChat((state) => state.turns);
  const streaming = useAssistantChat((state) => state.streaming);
  const send = useAssistantChat((state) => state.send);
  const digest = useAssistantChat((state) => state.digest);
  const stop = useAssistantChat((state) => state.stop);
  const reset = useAssistantChat((state) => state.reset);

  const { context, chips } = useAssistantContext();
  const text = useAssistantChat((state) => state.composer);
  const setText = useAssistantChat((state) => state.setComposer);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({
    ...apiQuery<AssistantStatus>("/assistant/status"),
    enabled: open,
    staleTime: 30_000,
  });
  const configured = status.data?.data.configured ?? null;

  useHotkeys(
    {
      "$mod+j": (event) => {
        event.preventDefault();
        toggle();
      },
    },
    { singleKey: false },
  );

  useEffect(() => {
    restoreAudience();
  }, [restoreAudience]);

  useEffect(() => {
    if (!pending || configured === null) return;
    const merged = { ...context, ...(pending.context ?? {}) } as ChatContext;
    if (configured && pending.prompt) send(pending.prompt, merged, audience);
    else if (pending.prompt) setText(pending.prompt);
    clearPending();
  }, [pending, configured, context, audience, send, clearPending, setText]);

  const last = turns[turns.length - 1];
  const progress = `${turns.length}:${last?.status}:${last?.draft.length}:${last?.lookups.length}`;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [progress]);

  useEffect(() => {
    if (open && configured) input.current?.focus();
  }, [open, configured]);

  if (!open) return null;

  const ask = (question: string) => {
    send(question, context, audience);
    setText("");
  };
  const suggestions = suggestedChips(context);
  const hasReasoning = last?.answer?.segments.some(
    (segment) => segment.kind === "reasoning_hypothesis",
  );
  const followUps: QuestionChip[] =
    last?.status === "done" && last.answer?.generated_by === "model"
      ? [
          ...(hasReasoning
            ? [
                {
                  label: "Experiments to run",
                  prompt:
                    "What experiments could distinguish these hypotheses?",
                },
              ]
            : []),
          {
            label: "Which are predictions?",
            prompt:
              "Which of these statements rest on predictions rather than experiments?",
          },
        ]
      : [];
  const starters: QuestionChip[] =
    suggestions.length > 0
      ? suggestions
      : [
          {
            label: "What BTK does",
            prompt: "What does BTK do, and which diseases involve it?",
          },
          {
            label: "BTK p.Arg28His evidence",
            prompt: "What evidence connects BTK p.Arg28His to disease?",
          },
        ];
  const chipsShown = !configured
    ? []
    : turns.length === 0
      ? starters
      : followUps;

  return (
    <aside
      aria-label="Orpha, research assistant"
      className="flex min-h-0 flex-col border-border bg-background max-lg:absolute max-lg:inset-0 max-lg:z-30 lg:w-[380px] lg:shrink-0 lg:border-l"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="shrink-0 truncate text-sm font-medium text-foreground">
          Orpha
        </h2>
        {advanced ? (
          <span className="truncate text-xs text-muted-foreground">
            Research assistant
          </span>
        ) : null}
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          <AudienceControl />
          <LegendButton />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            title="New conversation"
            disabled={turns.length === 0}
            onClick={reset}
          >
            <RotateCcwIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      </header>

      <ContextBar chips={chips} advanced={advanced} />

      <div
        ref={scroller}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
      >
        {status.isPending ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Checking</p>
        ) : status.error ? (
          <QueryErrorState
            error={status.error}
            subject="the assistant"
            onRetry={() => void status.refetch()}
          />
        ) : !status.data.data.configured ? (
          <>
            <NotConfigured status={status.data.data} advanced={advanced} />
            <SourceDigest context={context} advanced={advanced} />
          </>
        ) : turns.length === 0 ? (
          <>
            <p className="px-3 pt-4 text-sm text-muted-foreground">
              Ask about what is open. Answers cite their sources.
            </p>
            {advanced ? <Legend /> : null}
          </>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              advanced={advanced}
              onDigest={() => digest(turn.context)}
            />
          ))
        )}
      </div>

      <form
        className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() && configured && !streaming) ask(text);
        }}
      >
        <QuestionChips chips={chipsShown} onAsk={ask} disabled={streaming} />
        <div className="flex items-end gap-1.5">
          <Textarea
            ref={input}
            value={text}
            rows={1}
            disabled={!configured}
            aria-label="Question for Orpha"
            placeholder={
              configured === false ? "Needs a model key" : "Ask a question"
            }
            className="max-h-40 min-h-8 flex-1 resize-none bg-background text-sm"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {streaming ? (
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Stop"
              onClick={stop}
            >
              <SquareIcon aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Ask"
              disabled={!configured || !text.trim()}
            >
              <ArrowUpIcon aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-2xs text-subtle-foreground">
            Research use. Not medical advice.
          </span>
          {configured && turns.length === 0 && hasEntity(context) ? (
            <button
              type="button"
              onClick={() => digest(context)}
              className="ml-auto shrink-0 cursor-pointer rounded-xs text-2xs text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
            >
              Source records only
            </button>
          ) : advanced ? (
            <KeyHint
              keys="mod+j"
              label="Toggle"
              className="ml-auto max-sm:hidden"
            />
          ) : null}
        </div>
      </form>
    </aside>
  );
}
