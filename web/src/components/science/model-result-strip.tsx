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
}

export interface ModelResultStripProps {
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
    typeof runtime === "number" ? formatRuntime(runtime) : runtime || null;

  return (
    <div
      data-slot="model-result-strip"
      className={cn(
        "flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3 bg-background",
        FRAME_CLASS[frame],
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-2xs text-subtle-foreground">Model</span>
        <span className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-base font-medium text-foreground">
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
          </div>
        );
      })}

      {runtimeText ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs text-subtle-foreground">Run time</span>
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
