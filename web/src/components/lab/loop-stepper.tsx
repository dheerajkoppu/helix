"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "cn";

import { STEP_LABEL, stepIndex } from "@/components/lab/loop";
import { LOOP_STAGES, type LoopStageId } from "@/components/lab/record";

export interface LoopStepperProps {
  /** furthest step the record has reached */
  reached: LoopStageId | null;
  /** step shown in the centre */
  selected: LoopStageId;
  /** the run is still writing, or a replay is playing */
  live: boolean;
  /** every step is on record */
  complete: boolean;
  /** one to three words under each label */
  notes: Record<LoopStageId, string | null>;
  onSelect: (stage: LoopStageId) => void;
  className?: string;
}

/** The discovery loop as six steps. The step the run is on carries the ink bar. */
export function LoopStepper({
  reached,
  selected,
  live,
  complete,
  notes,
  onSelect,
  className,
}: LoopStepperProps) {
  const reachedIndex = stepIndex(reached);
  return (
    <nav
      aria-label="Discovery loop"
      className={cn("border-b border-border bg-background", className)}
    >
      <ol className="mx-auto grid w-full max-w-[96rem] grid-cols-3 px-4 sm:grid-cols-6 md:px-6">
        {LOOP_STAGES.map((stage, index) => {
          const done = complete ? index <= reachedIndex : index < reachedIndex;
          const current = !complete && index === reachedIndex;
          const isSelected = stage.id === selected;
          const pending = index > reachedIndex;
          return (
            <li key={stage.id} className="min-w-0">
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                aria-pressed={isSelected}
                onClick={() => onSelect(stage.id)}
                className={cn(
                  "group relative flex h-14 w-full min-w-0 items-center gap-2.5 px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
                  "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity after:duration-300",
                  isSelected && "after:opacity-100",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors duration-300",
                    done && "border-foreground bg-foreground text-background",
                    current && "border-foreground text-foreground",
                    pending && "border-border-strong text-subtle-foreground",
                  )}
                >
                  {done ? (
                    <CheckIcon className="size-3.5" />
                  ) : current && live ? (
                    <span className="size-2 animate-pulse rounded-full bg-foreground" />
                  ) : (
                    stage.number
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm transition-colors duration-300",
                      pending
                        ? "text-subtle-foreground"
                        : "font-medium text-foreground",
                      !isSelected && "group-hover:text-foreground",
                    )}
                  >
                    {STEP_LABEL[stage.id]}
                  </span>
                  <span className="hidden truncate text-2xs text-muted-foreground sm:block">
                    {notes[stage.id] ?? (pending ? "Waiting" : " ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
