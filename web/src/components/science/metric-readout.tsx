"use client";

import { cn } from "cn";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { Swatch } from "@/components/science/swatch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  METRICS,
  formatMetricValue,
  type MetricId,
} from "@/lib/science/metrics";
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
 * A technical metric with its reading and an inline explainer:
 * "pLDDT 93  Very high local structural confidence  What does this mean?"
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
              layout === "stack" ? "text-lg" : "text-sm",
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

      <Popover>
        <PopoverTrigger
          className="shrink-0 cursor-pointer self-start rounded-xs text-left text-2xs text-subtle-foreground underline decoration-dotted decoration-1 underline-offset-[3px] hover:text-foreground aria-expanded:text-foreground"
          aria-label={`What does ${definition.label} mean?`}
        >
          What does this mean?
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[23rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{definition.label}</p>
              <p className="text-2xs text-muted-foreground">
                {definition.name}
              </p>
            </div>
            <EvidenceBadge evidenceClass="computational_prediction" />
          </div>
          <p className="px-3 py-2 text-foreground">{definition.what}</p>
          {definition.scale.length > 0 ? (
            <ul className="border-t border-border-subtle py-1">
              {definition.scale.map((row) => (
                <li
                  key={row.range}
                  className="grid grid-cols-[0.875rem_7rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1"
                >
                  {row.swatchClass ? (
                    <Swatch
                      swatchClass={row.swatchClass}
                      code={row.code}
                      onFill={row.onFill}
                      className="self-center"
                    />
                  ) : (
                    <span aria-hidden />
                  )}
                  <span className="tabular font-mono text-2xs text-foreground">
                    {row.range}
                  </span>
                  <span className="text-muted-foreground">{row.meaning}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="border-t border-border-subtle px-3 py-2 text-muted-foreground">
            {definition.limits}
          </p>
          {producedBy ? (
            <p className="border-t border-border-subtle px-3 py-2 text-2xs text-subtle-foreground">
              Produced by{" "}
              <span className="font-mono text-muted-foreground">
                {producedBy}
              </span>
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
