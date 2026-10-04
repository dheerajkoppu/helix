"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRightIcon, PlayIcon } from "lucide-react";

import type { Served } from "@/components/lab/api";
import { variantLabel } from "@/components/lab/format";
import type { LabRun } from "@/components/lab/types";
import { ButtonLink } from "@/components/data/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import {
  LAB_WORDS,
  STEP_WORDS,
  plainCause,
  plainCount,
  plainMutationLabel,
} from "@/lib/plain-language";

/** Molecules a run kept at the end of the loop, from either place the list is recorded. */
function keptCount(run: LabRun): number {
  return Math.max(
    run.metrics.candidates ?? 0,
    run.outcome.candidate_molecules.length,
  );
}

/**
 * The strongest finished run: one that reaches the end of the loop with molecules to show, then one
 * the evidence made change its answer, then the one with the most evidence behind it. A demo should
 * land on the payoff, so candidates outrank everything. Baseline arms never lead.
 */
export function bestRun(runs: LabRun[]): LabRun | null {
  const finished = runs.filter(
    (run) =>
      run.status === "succeeded" &&
      run.outcome.favoured_after &&
      run.mode !== "single_agent_baseline",
  );
  if (finished.length === 0) return null;
  const score = (run: LabRun) =>
    (keptCount(run) > 0 ? 16 : 0) +
    (run.outcome.decision_changed ? 4 : 0) +
    (run.outcome.favoured_before &&
    run.outcome.favoured_before !== run.outcome.favoured_after
      ? 2
      : 0) +
    Math.min(
      1,
      ((run.metrics.evidence_items ?? 0) +
        (run.metrics.distinct_sources ?? 0)) /
        100,
    );
  return finished.reduce((best, run) =>
    score(run) > score(best) ? run : best,
  );
}

/** The run that leads the lab: the mutation, the cause before and after, and the way in. */
export function FeaturedRun({
  runs,
}: {
  runs: UseQueryResult<Served<LabRun[]>>;
}) {
  if (runs.isPending) return <Skeleton className="h-28 w-full" />;
  if (runs.isError) return null;
  const run = bestRun(runs.data.data);
  if (!run) return null;

  const { favoured_before: before, favoured_after: after } = run.outcome;
  const changed = run.outcome.decision_changed;
  const kept = keptCount(run);
  const seconds = run.metrics.wall_seconds;
  const mutation = run.subject.variant_id
    ? plainMutationLabel(variantLabel(run.subject.variant_id))
    : LAB_WORDS.title;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2
          className="text-2xl font-semibold tracking-[-0.015em] text-foreground"
          translate="no"
        >
          {mutation}
        </h2>
        {changed ? (
          <span className="rounded-xs border border-foreground px-1.5 text-xs leading-5 font-medium text-foreground">
            {STEP_WORDS.answerChanged}
          </span>
        ) : null}
        {seconds === null ? null : (
          <span className="tabular font-mono text-sm text-muted-foreground">
            {LAB_WORDS.tookTime} {formatDuration(seconds)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {before && before !== after ? (
          <>
            <span className="flex flex-col gap-0.5">
              <span className="text-2xs font-medium tracking-[0.06em] text-subtle-foreground uppercase">
                {LAB_WORDS.firstAnswer}
              </span>
              <span className="text-lg text-muted-foreground line-through decoration-border-strong">
                {plainCause(before)}
              </span>
            </span>
            <ArrowRightIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </>
        ) : null}
        <span className="flex flex-col gap-0.5">
          <span className="text-2xs font-medium tracking-[0.06em] text-subtle-foreground uppercase">
            {LAB_WORDS.finalAnswer}
          </span>
          <span className="text-lg font-medium text-foreground">
            {plainCause(after)}
          </span>
        </span>
        {kept > 0 ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-2xs font-medium tracking-[0.06em] text-subtle-foreground uppercase">
              {LAB_WORDS.endsWith}
            </span>
            <span className="text-lg text-foreground">
              {plainCount(kept, "candidate")}
            </span>
          </span>
        ) : null}
      </div>

      <div>
        <ButtonLink
          href={`/lab/${encodeURIComponent(run.run_id)}?play=1`}
          variant="default"
          size="lg"
        >
          <PlayIcon data-icon="inline-start" />
          {LAB_WORDS.watchIt}
        </ButtonLink>
      </div>
    </div>
  );
}
