"use client";

import { cn } from "cn";

import { Explainer } from "@/components/science/explainer";
import { Swatch } from "@/components/science/swatch";
import {
  METRICS,
  formatMetricValue,
  type MetricId,
} from "@/lib/science/metrics";
import {
  plainMetricLabel,
  plainMetricUnit,
  plainMetricWord,
  plainMetricWordOnly,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

export interface MetricReadoutProps {
  metric: MetricId;
  /** null or undefined prints the reason instead of a number */
  value: number | null | undefined;
  /** why the value is absent: "Not provided by this model", "n/a (single chain)" */
  missingReason?: string;
  /** overrides the metric's label, e.g. "Mean pLDDT", "pLDDT at Asp165" */
  label?: React.ReactNode;
  /** model or tool that produced the number, shown in the explainer: "AlphaFold DB v6" */
  producedBy?: string | null;
  /** "row": label, value and reading on one line. "stack": label above value, for inspector headers. */
  layout?: "row" | "stack";
  /** hide the interpretation text and keep label, value and explainer */
  terse?: boolean;
  className?: string;
}

/**
 * A technical metric with its reading; the explanation sits behind the `?`:
 * "pLDDT 93  Very high local structural confidence  ?"
 * The value is never animated and never coloured; a swatch beside it carries the band.
 */
export function MetricReadout({
  metric,
  value,
  missingReason = "Unknown",
  label,
  producedBy,
  layout = "row",
  terse = false,
  className,
}: MetricReadoutProps) {
  const advanced = useAdvancedMode();
  const definition = METRICS[metric];
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const interpretation = hasValue ? definition.interpret(value) : null;

  if (!advanced) {
    const word = hasValue ? plainMetricWord(metric, value) : null;
    const number = hasValue ? formatMetricValue(metric, value, false) : null;
    const unit = plainMetricUnit(metric) ?? definition.unit;
    const wordOnly = word !== null && plainMetricWordOnly(metric);
    const large = layout === "stack" ? "text-2xl leading-7" : "text-sm";
    return (
      <div
        data-slot="metric-readout"
        className={cn(
          "flex min-w-0 text-xs",
          layout === "row"
            ? "flex-wrap items-baseline gap-x-2 gap-y-0.5"
            : "flex-col gap-0.5",
          className,
        )}
      >
        <span className="shrink-0 text-muted-foreground">
          {plainMetricLabel(metric, typeof label === "string" ? label : null)}
        </span>
        <span
          className="inline-flex shrink-0 items-baseline gap-1.5"
          title={wordOnly && number ? `${number} ${unit ?? ""}`.trim() : undefined}
        >
          {interpretation?.swatchClass ? (
            <Swatch
              swatchClass={interpretation.swatchClass}
              className="self-center"
            />
          ) : null}
          {!hasValue ? (
            <span className="text-subtle-foreground">{missingReason}</span>
          ) : wordOnly ? (
            <span className={cn("font-medium text-foreground", large)}>
              {word}
            </span>
          ) : (
            <span
              className={cn(
                "tabular font-mono font-medium text-foreground",
                large,
              )}
            >
              {number}
              {unit ? (
                <span className="ml-1 font-sans text-2xs font-normal text-muted-foreground">
                  {unit}
                </span>
              ) : null}
            </span>
          )}
        </span>
        {word && !wordOnly && !terse ? (
          <span className="min-w-0 text-foreground">{word}</span>
        ) : null}
        <Explainer
          term={metric}
          producedBy={producedBy}
          className="self-center"
        />
      </div>
    );
  }

  return (
    <div
      data-slot="metric-readout"
      className={cn(
        "flex min-w-0 text-xs",
        layout === "row"
          ? "flex-wrap items-baseline gap-x-2 gap-y-0.5"
          : "flex-col gap-0.5",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">
        {label ?? definition.label}
      </span>

      <span className="inline-flex shrink-0 items-baseline gap-1.5">
        {interpretation?.swatchClass ? (
          <Swatch
            swatchClass={interpretation.swatchClass}
            code={interpretation.code}
            onFill={interpretation.onFill}
            className="self-center"
          />
        ) : null}
        {hasValue ? (
          <span
            className={cn(
              "tabular font-mono font-medium text-foreground",
              layout === "stack" ? "text-2xl leading-7" : "text-sm",
            )}
          >
            {formatMetricValue(metric, value, advanced)}
            {definition.unit ? (
              <span className="ml-1 text-2xs font-normal text-muted-foreground">
                {definition.unit}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-subtle-foreground">{missingReason}</span>
        )}
      </span>

      {interpretation && !terse ? (
        <span className="min-w-0 text-foreground">{interpretation.text}</span>
      ) : null}

      <Explainer
        term={metric}
        producedBy={producedBy}
        className="self-center"
      />
    </div>
  );
}
