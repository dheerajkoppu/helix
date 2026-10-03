"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import type { Served } from "@/components/lab/api";
import { RunStatusTag, variantLabel } from "@/components/lab/format";
import { isActiveStatus, type LabRun } from "@/components/lab/types";
import { QueryErrorState } from "@/components/states/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import {
  LAB_WORDS,
  STEP_WORDS,
  plainCause,
  plainMutationLabel,
  plainRunMode,
} from "@/lib/plain-language";

const SHORT_LIST = 5;

function Outcome({ run }: { run: LabRun }) {
  const { favoured_before: before, favoured_after: after } = run.outcome;
  if (!after) {
    return (
      <span className="text-subtle-foreground">
        {isActiveStatus(run.status)
          ? LAB_WORDS.inProgress
          : LAB_WORDS.noAnswer}
      </span>
    );
  }
  const changed = run.outcome.decision_changed;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {before && before !== after ? (
        <>
          <span className="text-muted-foreground">{plainCause(before)}</span>
          <ArrowRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </>
      ) : null}
      <span className="text-foreground">{plainCause(after)}</span>
      {changed !== null ? (
        <span
          className={
            changed
              ? "rounded-xs border border-foreground px-1.5 text-xs leading-5 font-medium whitespace-nowrap text-foreground"
              : "text-xs whitespace-nowrap text-muted-foreground"
          }
        >
          {changed ? STEP_WORDS.answerChanged : STEP_WORDS.answerHeld}
        </span>
      ) : null}
    </span>
  );
}

/** The runs as one line each: the mutation, its state, the answer before and after, who ran it. */
export function RecentRuns({
  runs,
  all = false,
}: {
  runs: UseQueryResult<Served<LabRun[]>>;
  /** every run instead of the newest few */
  all?: boolean;
}) {
  if (runs.isPending) return <Skeleton className="h-24 w-full" />;
  if (runs.isError) {
    return (
      <QueryErrorState
        error={runs.error}
        subject="lab runs"
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
        size="inline"
      />
    );
  }
  const rows = all ? runs.data.data : runs.data.data.slice(0, SHORT_LIST);
  if (rows.length === 0) {
    return (
      <p className="text-base text-muted-foreground">
        {runs.data.served ? LAB_WORDS.noRuns : LAB_WORDS.labMissing}
      </p>
    );
  }
  return (
    <ul className="border-t border-border">
      {rows.map((run) => (
        <li key={run.run_id} className="border-b border-border-subtle">
          <Link
            href={`/lab/${encodeURIComponent(run.run_id)}`}
            title={run.run_id}
            className="group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-1 py-2.5 text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset md:grid-cols-[9.5rem_9.5rem_minmax(0,1fr)_7.5rem_5.5rem]"
          >
            <span
              className="truncate font-medium text-foreground underline-offset-2 group-hover:underline"
              translate="no"
            >
              {run.subject.variant_id
                ? plainMutationLabel(variantLabel(run.subject.variant_id))
                : LAB_WORDS.run}
            </span>
            <RunStatusTag
              status={run.status}
              plain
              className="justify-self-end md:justify-self-start"
            />
            <span className="col-span-2 min-w-0 md:col-span-1">
              <Outcome run={run} />
            </span>
            <span className="hidden truncate text-sm text-muted-foreground md:block">
              {plainRunMode(run.mode)}
            </span>
            <span className="tabular hidden text-right font-mono text-sm text-muted-foreground md:block">
              {isActiveStatus(run.status) || run.metrics.wall_seconds === null
                ? null
                : formatDuration(run.metrics.wall_seconds)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
