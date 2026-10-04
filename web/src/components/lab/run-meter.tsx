"use client";

import { cn } from "cn";

import { formatMeasure } from "@/components/lab/format";
import { formatDuration } from "@/lib/format";
import { METER_WORDS, plainSource } from "@/lib/plain-language";

/** A budget is shown by default only once this much of it is spent. */
const NEAR_LIMIT = 0.9;

const nearLimit = (used: number | null, limit: number | null): boolean =>
  used !== null && limit !== null && limit > 0 && used / limit >= NEAR_LIMIT;

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
  /** everyday labels, and budgets only when one is nearly spent */
  plain?: boolean;
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
  plain = false,
  className,
}: RunMeterProps) {
  const pendingReason = active ? "At finish" : "Unknown";
  if (plain) {
    const stepsNear = nearLimit(toolCalls, maxToolCalls);
    const computeNear = nearLimit(computeSeconds, maxComputeSeconds);
    const pending = active ? METER_WORDS.atTheEnd : undefined;
    // a total that is not on record yet, or a zero, tells a first-time viewer nothing
    const showSteps = !totalsOnly && toolCalls !== null;
    const showCompute =
      !totalsOnly && computeSeconds !== null && computeSeconds > 0;
    return (
      <section
        aria-label={METER_WORDS.time}
        className={cn("min-w-0", className)}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 py-4 lg:grid-cols-1">
          <Reading
            label={METER_WORDS.time}
            value={
              elapsedSeconds === null ? null : formatDuration(elapsedSeconds)
            }
          />
          {!showSteps ? null : (
            <Reading
              label={METER_WORDS.steps}
              value={toolCalls === null ? null : formatMeasure(toolCalls)}
              unit={stepsNear ? `of ${maxToolCalls}` : null}
              missing={pending}
            >
              {stepsNear ? <Bar used={toolCalls} limit={maxToolCalls} /> : null}
            </Reading>
          )}
          <Reading label={METER_WORDS.sources} value={String(databases.length)}>
            {databases.length ? (
              <span
                className="line-clamp-5 text-xs leading-5 text-muted-foreground"
                title={databases.map(plainSource).join(", ")}
              >
                {databases.map(plainSource).join(", ")}
              </span>
            ) : null}
          </Reading>
          {!showCompute ? null : (
            <Reading
              label={METER_WORDS.compute}
              value={
                computeSeconds === null
                  ? null
                  : formatMeasure(computeSeconds, 1)
              }
              unit={
                computeNear && maxComputeSeconds !== null
                  ? `of ${formatMeasure(maxComputeSeconds, 1)} s`
                  : "s"
              }
              missing={pending}
            >
              {computeNear ? (
                <Bar used={computeSeconds} limit={maxComputeSeconds} />
              ) : null}
            </Reading>
          )}
        </dl>
      </section>
    );
  }
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
