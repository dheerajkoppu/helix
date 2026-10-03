"use client";

import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { eventTypeLabel, formatClockTime } from "@/components/lab/format";
import { hasEntry, summariseEvent } from "@/components/lab/record";
import { entryAnchor, useAgentLabel } from "@/components/lab/run-context";
import { readBoolean, readText, type LabEvent } from "@/components/lab/types";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";

type Filter = "all" | "handoffs";

function Who({ event }: { event: LabEvent }) {
  const agentLabel = useAgentLabel();
  const from = readText(event.payload.from);
  const to = readText(event.payload.to);
  if (event.type === "handoff" && (from || to)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1 font-medium text-foreground">
        {agentLabel(from ?? event.agent)}
        <ArrowRightIcon className="size-3 shrink-0" aria-label="hands off to" />
        {agentLabel(to)}
      </span>
    );
  }
  return (
    <span className="font-medium text-foreground">
      {agentLabel(event.agent)}
    </span>
  );
}

function Row({
  event,
  dimmed,
  current,
}: {
  event: LabEvent;
  dimmed: boolean;
  current: boolean;
}) {
  const summary = summariseEvent(event);
  const parallel =
    readBoolean(event.payload.parallel) === true ||
    readText(event.payload.parallel_group) !== null;
  return (
    <span
      className={cn(
        "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-1.5 pr-3 pl-4 text-left md:pl-6",
        current && "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
        dimmed && "opacity-45",
      )}
    >
      <span className="tabular pt-px text-right font-mono text-2xs text-subtle-foreground">
        {event.seq}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
          <Who event={event} />
          <span className="shrink-0 text-2xs tracking-[0.04em] text-muted-foreground uppercase">
            {event.type === "handoff"
              ? null
              : eventTypeLabel(event.type, readText(event.payload.kind))}
            {parallel ? " parallel" : null}
          </span>
          <time
            dateTime={event.at ?? undefined}
            className="tabular ml-auto shrink-0 font-mono text-2xs text-subtle-foreground"
          >
            {formatClockTime(event.at) ?? "no time"}
          </time>
        </span>
        {summary ? (
          <span
            className={cn(
              "text-xs text-muted-foreground",
              hasEntry(event) && "line-clamp-2",
            )}
          >
            {summary}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export interface HandoffTimelineProps {
  events: LabEvent[];
  /** the record is still being written */
  live: boolean;
  replaying: boolean;
  /** seq the replay is on; later lines are dimmed */
  currentSeq: number | null;
  /** replay only: move to this line */
  onStep: (seq: number) => void;
  className?: string;
}

/**
 * Every line of the record in order: who acted, what kind of line it is, when, and what it says.
 * A line that has its own row on the page links to it; handoffs and notes are read here.
 */
export function HandoffTimeline({
  events,
  live,
  replaying,
  currentSeq,
  onStep,
  className,
}: HandoffTimelineProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);

  const rows = useMemo(
    () =>
      filter === "handoffs"
        ? events.filter((event) => event.type === "handoff")
        : events,
    [events, filter],
  );
  const handoffCount = useMemo(
    () => events.filter((event) => event.type === "handoff").length,
    [events],
  );

  useEffect(() => {
    const element = scroller.current;
    if (!element || !live || !pinnedToEnd.current) return;
    element.scrollTop = element.scrollHeight;
  }, [rows.length, live]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !replaying || currentSeq === null) return;
    const row = element.querySelector<HTMLElement>(
      `[data-row="${currentSeq}"]`,
    );
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight)
      element.scrollTop = bottom - element.clientHeight;
  }, [replaying, currentSeq]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4 md:pl-6">
        <span aria-hidden className="h-2.5 w-px shrink-0 bg-foreground" />
        <h2 className="text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
          Research record
        </h2>
        <span className="tabular font-mono text-2xs text-subtle-foreground">
          {events.length}
        </span>
        <div
          role="group"
          aria-label="Lines shown"
          className="ml-auto flex items-center gap-0.5"
        >
          <Button
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filter === "handoffs" ? "secondary" : "ghost"}
            aria-pressed={filter === "handoffs"}
            onClick={() => setFilter("handoffs")}
          >
            Handoffs {handoffCount}
          </Button>
        </div>
      </div>
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToEnd.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            32;
        }}
        className="scroll-thin relative min-h-0 flex-1 overflow-y-auto"
      >
        {rows.length === 0 ? (
          <EmptyState
            title={
              filter === "handoffs" && events.length > 0
                ? "No handoffs in this record"
                : "No record lines yet"
            }
            description={
              live
                ? "Lines appear here as the agents write them."
                : "The run wrote nothing to its record."
            }
          />
        ) : (
          <ol aria-label="Record lines in order">
            {rows.map((event) => {
              const dimmed =
                replaying && currentSeq !== null && event.seq > currentSeq;
              const current = replaying && event.seq === currentSeq;
              const body = (
                <Row event={event} dimmed={dimmed} current={current} />
              );
              const interactive =
                "block w-full outline-offset-[-2px] hover:bg-accent";
              return (
                <li
                  key={event.seq}
                  data-row={event.seq}
                  className="border-b border-border-subtle"
                >
                  {replaying ? (
                    <button
                      type="button"
                      onClick={() => onStep(event.seq)}
                      aria-current={current ? "step" : undefined}
                      className={interactive}
                    >
                      {body}
                    </button>
                  ) : hasEntry(event) ? (
                    <a
                      href={`#${entryAnchor(event.seq)}`}
                      className={interactive}
                    >
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <p className="flex h-6 shrink-0 items-center gap-1.5 border-t border-border bg-sunken pr-3 pl-4 text-2xs text-muted-foreground md:pl-6">
        {live ? (
          <>
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-foreground"
            />
            Reading new lines as they are written
          </>
        ) : replaying ? (
          "Replay: lines after the current step are dimmed"
        ) : (
          "Recorded run. Times are UTC."
        )}
      </p>
    </div>
  );
}
