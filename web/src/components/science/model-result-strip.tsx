"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  Explainer,
  isMetricId,
  type ExplainerKey,
} from "@/components/science/explainer";
import {
  plainDuration,
  plainImpact,
  plainMetricLabel,
  plainMetricUnit,
  plainMetricWord,
  plainMetricWordOnly,
  plainReadoutLabel,
  plainUnit,
} from "@/lib/plain-language";
import { formatMetricValue } from "@/lib/science/metrics";
import { useAdvancedMode } from "@/lib/state/preferences";
import type { StructureOrigin } from "@/lib/structure-origin";

export interface ModelResultMetric {
  /** one to three words: "Mean pLDDT", "Cα RMSD" */
  label: string;
  /** a number is formatted here; pass a string to print it exactly. null prints the reason. */
  value: number | string | null | undefined;
  /** always printed when the value has one: "Å", "kcal/mol" */
  unit?: string | null;
  /** metric id or glossary term id; adds the `?` that opens the explanation */
  explainer?: ExplainerKey | (string & {});
  /** why the value is absent: "Not reported" */
  missingReason?: string;
  /** short text under the value: a class label such as "likely pathogenic" */
  caption?: string | null;
}

export interface ModelResultStripProps {
  /** heading above the name, default "Model"; "Test" or "Method" when it is not one model */
  label?: string;
  /** "ESMFold", "AlphaFold DB", "Boltz-2" */
  model: string;
  /** printed as given: "v6", "2.1.1" */
  version?: string | null;
  origin?: StructureOrigin | null;
  /** the two or three numbers that matter */
  metrics: ModelResultMetric[];
  /** seconds as a number, or text printed as given: "cached", "1 min 12 s" */
  runtime?: number | string | null;
  /** the run, job or model page */
  href?: string | null;
  /** link text, default "Details" */
  hrefLabel?: string;
  /** "rule": top rule, for a zone footer. "box": ruled box, for a page. "none": bare. */
  frame?: "rule" | "box" | "none";
  className?: string;
}

export function formatRuntime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes - hours * 60} min`;
}

function formatNumber(value: number, advanced: boolean): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  return value.toFixed(advanced ? digits + 1 : digits);
}

const FRAME_CLASS: Record<
  NonNullable<ModelResultStripProps["frame"]>,
  string
> = {
  rule: "border-t border-border px-4 py-3",
  box: "rounded-md border border-border px-4 py-3",
  none: "",
};

/**
 * The one way a model's output is shown: which model and version, the few numbers that matter
 * with their units, run time and the origin tag. Values are never coloured or animated.
 */
export function ModelResultStrip({
  label = "Model",
  model,
  version,
  origin,
  metrics,
  runtime,
  href,
  hrefLabel = "Details",
  frame = "rule",
  className,
}: ModelResultStripProps) {
  const advanced = useAdvancedMode();
  const producedBy = version ? `${model} ${version}` : model;
  const runtimeText =
    typeof runtime === "number"
      ? advanced
        ? formatRuntime(runtime)
        : plainDuration(runtime)
      : runtime || null;

  return (
    <div
      data-slot="model-result-strip"
      className={cn(
        "flex min-w-0 flex-wrap gap-x-8 gap-y-3 bg-background",
        advanced ? "items-end" : "items-start",
        FRAME_CLASS[frame],
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-2xs text-subtle-foreground">
          {advanced ? label : plainReadoutLabel(label)}
        </span>
        <span className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="truncate text-base font-medium text-foreground"
            title={advanced ? undefined : producedBy}
          >
            {model}
          </span>
          {version ? (
            <span className="font-mono text-xs text-muted-foreground">
              {version}
            </span>
          ) : null}
          {origin ? <StructureOriginTag origin={origin} /> : null}
        </span>
      </div>

      {metrics.map((metric) => {
        const value = metric.value;
        const hasValue =
          typeof value === "number"
            ? Number.isFinite(value)
            : typeof value === "string" && value.trim() !== "";
        const text =
          typeof value === "number"
            ? metric.explainer && isMetricId(metric.explainer)
              ? formatMetricValue(metric.explainer, value, advanced)
              : formatNumber(value, advanced)
            : value;
        const metricId =
          metric.explainer && isMetricId(metric.explainer)
            ? metric.explainer
            : null;
        if (!advanced) {
          const word =
            metricId && typeof value === "number" && hasValue
              ? plainMetricWord(metricId, value)
              : null;
          const wordOnly =
            word !== null && metricId !== null && plainMetricWordOnly(metricId);
          const unit =
            (metricId ? plainMetricUnit(metricId) : null) ??
            (metric.unit ? plainUnit(metric.unit) : null);
          const caption =
            word ??
            (metric.caption
              ? /pathogenic|benign|ambiguous/i.test(metric.caption)
                ? plainImpact(metric.caption)
                : metric.caption
              : null);
          return (
            <div
              key={metric.label}
              data-slot="model-result-metric"
              className="flex min-w-0 flex-col gap-1"
            >
              <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
                {metricId
                  ? plainMetricLabel(metricId, metric.label)
                  : plainReadoutLabel(metric.label)}
                {metric.explainer ? (
                  <Explainer term={metric.explainer} producedBy={producedBy} />
                ) : null}
              </span>
              {!hasValue ? (
                <span className="text-base leading-6 text-subtle-foreground">
                  {metric.missingReason ?? "Unknown"}
                </span>
              ) : wordOnly ? (
                <span
                  className="text-xl leading-6 font-medium text-foreground"
                  title={`${text}${metric.unit ? ` ${metric.unit}` : ""}`}
                >
                  {word}
                </span>
              ) : (
                <span className="tabular font-mono text-2xl leading-6 font-medium text-foreground">
                  {text}
                  {unit ? (
                    <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                      {unit}
                    </span>
                  ) : null}
                </span>
              )}
              {hasValue && caption && !wordOnly ? (
                <span className="text-xs text-muted-foreground">{caption}</span>
              ) : null}
            </div>
          );
        }
        return (
          <div
            key={metric.label}
            data-slot="model-result-metric"
            className="flex min-w-0 flex-col gap-1"
          >
            <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
              {metric.label}
              {metric.explainer ? (
                <Explainer term={metric.explainer} producedBy={producedBy} />
              ) : null}
            </span>
            {hasValue ? (
              <span className="tabular font-mono text-2xl leading-6 font-medium text-foreground">
                {text}
                {metric.unit ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {metric.unit}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-base leading-6 text-subtle-foreground">
                {metric.missingReason ?? "Unknown"}
              </span>
            )}
            {hasValue && metric.caption ? (
              <span className="text-xs text-muted-foreground">
                {metric.caption}
              </span>
            ) : null}
          </div>
        );
      })}

      {runtimeText ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs text-subtle-foreground">
            {advanced ? "Run time" : plainReadoutLabel("Run time")}
          </span>
          <span className="tabular font-mono text-base leading-6 text-muted-foreground">
            {runtimeText}
          </span>
        </div>
      ) : null}

      {href ? (
        <Link
          href={href}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-xs text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {hrefLabel}
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}
