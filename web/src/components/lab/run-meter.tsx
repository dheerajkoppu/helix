"use client";

import { cn } from "cn";

import { formatMeasure } from "@/components/lab/format";
import { formatDuration } from "@/lib/format";

function Bar({ used, limit }: { used: number | null; limit: number | null }) {
  const fraction =
    used !== null && limit !== null && limit > 0
      ? Math.min(1, Math.max(0, used / limit))
      : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit ?? undefined}
      aria-valuenow={used ?? undefined}
      className="h-1 w-full bg-border"
    >
      <div
        className="h-full bg-foreground transition-[width] duration-500"
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}

function Reading({
  label,
  value,
  unit,
  missing,
  children,
}: {
  label: string;
  value: string | null;
  unit?: string | null;
  missing?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-2xs text-subtle-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">
        {value !== null ? (
          <span className="tabular font-mono text-2xl leading-6 font-medium text-foreground">
            {value}
            {unit ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {unit}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-sm leading-6 text-subtle-foreground">
            {missing ?? "Unknown"}
          </span>
        )}
        {children}
      </dd>
    </div>
  );
}

export interface RunMeterProps {
  /** seconds since the run started, at the step shown */
  elapsedSeconds: number | null;
  /** null while a run is active: the count is written when it finishes */
  toolCalls: number | null;
  maxToolCalls: number | null;
  computeSeconds: number | null;
  maxComputeSeconds: number | null;
  /** distinct databases cited at the step shown */
  databases: string[];
  /** the run has not finished, so the totals are not on record yet */
  active: boolean;
  /** a replay is mid-run: the record holds totals only for the whole run */
  totalsOnly?: boolean;
  className?: string;
}

/** Time, tool calls, sources and the budget the scientist set. */
export function RunMeter({
  elapsedSeconds,
  toolCalls,
  maxToolCalls,
  computeSeconds,
  maxComputeSeconds,
  databases,
  active,
  totalsOnly = false,
  className,
}: RunMeterProps) {
  const pendingReason = active ? "At finish" : "Unknown";
  return (
    <section aria-label="Run totals" className={cn("min-w-0", className)}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 lg:grid-cols-1">
        <Reading
          label="Elapsed"
          value={
            elapsedSeconds === null ? null : formatDuration(elapsedSeconds)
          }
        />
        <Reading
          label={totalsOnly ? "Tool calls, whole run" : "Tool calls"}
          value={toolCalls === null ? null : formatMeasure(toolCalls)}
          unit={maxToolCalls !== null ? `of ${maxToolCalls}` : null}
          missing={pendingReason}
        >
          <Bar used={toolCalls} limit={maxToolCalls} />
        </Reading>
        <Reading
          label={totalsOnly ? "Compute, whole run" : "Compute"}
          value={
            computeSeconds === null ? null : formatMeasure(computeSeconds, 1)
          }
          unit={
            maxComputeSeconds !== null
              ? `of ${formatMeasure(maxComputeSeconds, 1)} s`
              : "s"
          }
          missing={pendingReason}
        >
          <Bar used={computeSeconds} limit={maxComputeSeconds} />
        </Reading>
        <Reading label="Sources" value={String(databases.length)}>
          {databases.length ? (
            <span className="line-clamp-3 text-xs text-muted-foreground">
              {databases.join(", ")}
            </span>
          ) : null}
        </Reading>
      </dl>
    </section>
  );
}
