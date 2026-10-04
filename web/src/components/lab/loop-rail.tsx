"use client";

import { cn } from "cn";
import { RotateCcwIcon } from "lucide-react";

import { variantLabel } from "@/components/lab/format";
import {
  LOOP_STAGES,
  overallOutcome,
  type LoopStageId,
  type RecordView,
} from "@/components/lab/record";
import { isActiveStatus, type LabRun } from "@/components/lab/types";

const plural = (count: number, singular: string, pluralForm?: string) =>
  `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;

/** What each position holds so far, read from the record. Null when nothing is recorded there. */
function stageSummary(
  stage: LoopStageId,
  view: RecordView,
  run: LabRun,
): string | null {
  switch (stage) {
    case "question":
      return run.subject.variant_id
        ? variantLabel(run.subject.variant_id)
        : view.objective
          ? "objective set"
          : null;
    case "evidence": {
      if (view.evidence.length === 0 && view.gaps.length === 0) return null;
      const gaps = view.gaps.length
        ? `, ${plural(view.gaps.length, "gap")}`
        : "";
      return `${plural(view.evidence.length, "item")}${gaps}`;
    }
    case "hypothesis":
      return view.hypotheses.length
        ? plural(view.hypotheses.length, "hypothesis", "hypotheses")
        : null;
    case "experiment": {
      const pending = view.approvals.some((approval) => !approval.decision);
      if (pending) return "approval requested";
      const plan = view.plans.at(-1);
      if (plan?.chosen_test_id) return `chose ${plan.chosen_test_id}`;
      return view.tests.length ? plural(view.tests.length, "candidate") : null;
    }
    case "result":
      if (view.results.length)
        return view.interpretations.length
          ? "interpreted"
          : plural(view.results.length, "result");
      return view.experimentStarted.length ? "test running" : null;
    case "decision": {
      const outcome = overallOutcome(view);
      if (!outcome) return view.nextExperiments.length ? "next test set" : null;
      return outcome.changed ? "changed" : "unchanged";
    }
    case "candidates": {
      if (view.candidates.length) {
        const ruled = view.ruledOut.length
          ? `, ${view.ruledOut.length} ruled out`
          : "";
        return `${plural(view.candidates.length, "candidate")}${ruled}`;
      }
      if (view.ruledOut.length)
        return `${plural(view.ruledOut.length, "row")} ruled out`;
      return view.targetRationales.length ? "target set" : null;
    }
  }
}

export interface LoopRailProps {
  run: LabRun;
  view: RecordView;
  /** the record is still being written: the current position is marked as live */
  live: boolean;
  /** a recorded run is being shown step by step */
  replaying: boolean;
  className?: string;
  ref?: React.Ref<HTMLElement>;
}

/**
 * The discovery loop as six positions on an axis. A position is filled once the record holds an
 * event for it; the position of the latest event carries the ink bar. A position the run came back
 * to after a result says so.
 */
export function LoopRail({
  run,
  view,
  live,
  replaying,
  className,
  ref,
}: LoopRailProps) {
  const emptyLabel = replaying
    ? "not reached"
    : isActiveStatus(run.status)
      ? "not recorded yet"
      : "not recorded";
  return (
    <nav
      ref={ref}
      aria-label="Discovery loop"
      className={cn(
        "border-b border-border-strong/70 bg-background",
        className,
      )}
    >
      <ol className="mx-auto grid w-full max-w-6xl grid-cols-2 sm:grid-cols-4 md:grid-cols-7 md:px-3">
        {LOOP_STAGES.map((stage, index) => {
          const reached = view.stageCounts[stage.id] > 0;
          const current = view.stage === stage.id;
          const summary = stageSummary(stage.id, view, run);
          const reopened = view.reopened[stage.id];
          return (
            <li
              key={stage.id}
              className={cn(
                "min-w-0",
                index < LOOP_STAGES.length - 1 &&
                  "border-b border-border-subtle md:border-b-0",
              )}
            >
              <a
                href={`#${stage.id}`}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "relative flex h-12 min-w-0 flex-col justify-center gap-0.5 px-3 outline-offset-[-2px] hover:bg-accent",
                  "before:absolute before:bottom-0 before:left-0 before:h-1.5 before:w-px before:bg-border-strong",
                  current &&
                    "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "tabular font-mono text-2xs",
                      reached ? "text-foreground" : "text-subtle-foreground",
                    )}
                  >
                    {stage.number}
                  </span>
                  <span
                    className={cn(
                      "truncate",
                      current && "font-medium",
                      reached ? "text-foreground" : "text-disabled-foreground",
                    )}
                  >
                    {stage.id === "decision" ? (
                      <>
                        <span className="md:hidden">Decision</span>
                        <span className="hidden md:inline">{stage.label}</span>
                      </>
                    ) : (
                      stage.label
                    )}
                  </span>
                  {current && live && isActiveStatus(run.status) ? (
                    <span
                      aria-label="in progress"
                      className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground"
                    />
                  ) : null}
                  {reopened > 0 ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-2xs text-foreground">
                      <RotateCcwIcon className="size-2.5" aria-hidden />
                      <span className="sr-only md:not-sr-only">reopened</span>
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "truncate pl-[1.125rem] font-mono text-2xs",
                    summary
                      ? "text-muted-foreground"
                      : "text-disabled-foreground",
                  )}
                  translate="no"
                >
                  {summary ?? emptyLabel}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
