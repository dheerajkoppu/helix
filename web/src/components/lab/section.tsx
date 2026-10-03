"use client";

import { cn } from "cn";

import { formatClockTime } from "@/components/lab/format";
import { LOOP_STAGES, type LoopStageId } from "@/components/lab/record";
import {
  ANCHOR_OFFSET,
  useAgentLabel,
  useRun,
} from "@/components/lab/run-context";
import { isActiveStatus, type LabEvent } from "@/components/lab/types";

export interface LoopSectionProps {
  /** loop position this section belongs to; omit for sections outside the loop */
  stage?: LoopStageId;
  id?: string;
  title: React.ReactNode;
  count?: number | null;
  /** right-aligned note on the title row */
  detail?: React.ReactNode;
  children: React.ReactNode;
}

/** One position of the loop as a titled, rule-separated block. The loop rail links to its id. */
export function LoopSection({
  stage,
  id,
  title,
  count,
  detail,
  children,
}: LoopSectionProps) {
  const position = LOOP_STAGES.find((entry) => entry.id === stage);
  return (
    <section
      id={id ?? stage}
      className={cn(
        ANCHOR_OFFSET,
        "border-b border-border-subtle py-5 last:border-b-0",
      )}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-baseline gap-2 text-base font-medium text-foreground">
          {position ? (
            <span className="tabular font-mono text-xs font-normal text-subtle-foreground">
              {position.number}
            </span>
          ) : null}
          {title}
          {count !== undefined && count !== null ? (
            <span className="tabular font-mono text-xs font-normal text-subtle-foreground">
              {count}
            </span>
          ) : null}
        </h2>
        {detail ? (
          <div className="text-xs text-muted-foreground">{detail}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A titled block inside a section: tick, small-caps label, optional count. */
export function Subhead({
  title,
  count,
  detail,
  className,
}: {
  title: React.ReactNode;
  count?: number | null;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-x-2 border-b border-border-subtle bg-muted px-3",
        className,
      )}
    >
      <span aria-hidden className="h-2.5 w-px shrink-0 bg-foreground" />
      <h3 className="text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
        {title}
      </h3>
      {count !== undefined && count !== null ? (
        <span className="tabular font-mono text-2xs text-subtle-foreground">
          {count}
        </span>
      ) : null}
      {detail ? (
        <span className="ml-auto text-2xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

/** Says why a block is empty: not reached in the replay, still running, or never recorded. */
export function NotRecorded({
  what,
  className,
}: {
  /** plural noun phrase: "hypotheses", "candidate tests" */
  what: string;
  className?: string;
}) {
  const { replaying, run } = useRun();
  const message = replaying
    ? `No ${what} at this step of the replay.`
    : isActiveStatus(run.status)
      ? `No ${what} recorded yet. The run is still in progress.`
      : `This run recorded no ${what}.`;
  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-2.5 px-3 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-xs border border-dashed border-border-strong"
      />
      {message}
    </p>
  );
}

/** Who wrote a record line, which line, and when. */
export function ByLine({
  event,
  className,
}: {
  event: LabEvent;
  className?: string;
}) {
  const agentLabel = useAgentLabel();
  const time = formatClockTime(event.at);
  return (
    <span
      className={cn(
        "text-2xs whitespace-nowrap text-subtle-foreground",
        className,
      )}
    >
      {agentLabel(event.agent)}
      <span className="tabular font-mono">
        {" · line "}
        {event.seq}
        {time ? ` · ${time} UTC` : null}
      </span>
    </span>
  );
}

/** A link to the row that stated an id in this record; plain monospace when the id is not in it. */
export function IdLink({ id }: { id: string }) {
  const { seqOf } = useRun();
  const seq = seqOf(id);
  if (seq === null)
    return (
      <span className="font-mono text-xs" translate="no">
        {id}
      </span>
    );
  return (
    <a
      href={`#ev-${seq}`}
      className="rounded-xs font-mono text-xs text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground"
      translate="no"
    >
      {id}
    </a>
  );
}

export function IdList({ ids, empty }: { ids: string[]; empty: string }) {
  if (ids.length === 0)
    return <span className="text-subtle-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {ids.map((id) => (
        <IdLink key={id} id={id} />
      ))}
    </span>
  );
}
