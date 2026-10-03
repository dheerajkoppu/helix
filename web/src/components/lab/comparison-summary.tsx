"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import type { Served } from "@/components/lab/api";
import { formatMeasure, humanise, modeLabel } from "@/components/lab/format";
import type { BenchmarkArm, LabBenchmark } from "@/components/lab/types";
import { QueryErrorState } from "@/components/states/query-state";
import { Skeleton } from "@/components/ui/skeleton";

interface Figure {
  label: string;
  value: string;
  unit?: string;
  /** the control arm's value for the same measure */
  against?: string | null;
}

const armLabel = (arm: BenchmarkArm | undefined, fallback: string) =>
  arm?.label ?? modeLabel(arm?.id) ?? fallback;

/** Three figures from the benchmark file: the headline comparison when it records one, else the lab arm. */
function figuresOf(data: LabBenchmark): {
  caption: string | null;
  figures: Figure[];
} {
  const lab =
    data.arms.find((arm) => arm.id === "specialist_lab") ?? data.arms[0];
  const baseline = data.arms.find((arm) => arm !== lab);
  const comparison = data.comparison;
  if (
    comparison &&
    comparison.lab !== null &&
    comparison.baseline !== null &&
    comparison.ratio !== null
  ) {
    return {
      caption: comparison.metric ? humanise(comparison.metric) : null,
      figures: [
        {
          label: armLabel(lab, "Lab"),
          value: formatMeasure(comparison.lab, 2),
        },
        {
          label: armLabel(baseline, "Single agent"),
          value: formatMeasure(comparison.baseline, 2),
        },
        {
          label: "Ratio",
          value: formatMeasure(comparison.ratio, 2),
          unit: "×",
        },
      ],
    };
  }
  if (!lab) return { caption: null, figures: [] };
  const figures: Figure[] = [];
  if (lab.median_wall_seconds !== null)
    figures.push({
      label: "Median time",
      value: formatMeasure(lab.median_wall_seconds, 0),
      unit: "s",
      against:
        baseline?.median_wall_seconds != null
          ? `${formatMeasure(baseline.median_wall_seconds, 0)} s`
          : null,
    });
  if (lab.mean_distinct_sources !== null)
    figures.push({
      label: "Sources cited",
      value: formatMeasure(lab.mean_distinct_sources, 1),
      against:
        baseline?.mean_distinct_sources != null
          ? formatMeasure(baseline.mean_distinct_sources, 1)
          : null,
    });
  if (lab.agreement.n_agree !== null && lab.agreement.n_with_reference !== null)
    figures.push({
      label: "Agrees with reference",
      value: `${lab.agreement.n_agree} of ${lab.agreement.n_with_reference}`,
      against:
        baseline &&
        baseline.agreement.n_agree !== null &&
        baseline.agreement.n_with_reference !== null
          ? `${baseline.agreement.n_agree} of ${baseline.agreement.n_with_reference}`
          : null,
    });
  return { caption: armLabel(lab, "Lab"), figures: figures.slice(0, 3) };
}

/** The measured comparison as three large numbers and one caveat. The full table sits behind Details. */
export function ComparisonSummary({
  benchmark,
}: {
  benchmark: UseQueryResult<Served<LabBenchmark | null>>;
}) {
  if (benchmark.isPending) return <Skeleton className="h-16 w-full" />;
  if (benchmark.isError) {
    return (
      <QueryErrorState
        error={benchmark.error}
        subject="the measured comparison"
        onRetry={() => void benchmark.refetch()}
        retrying={benchmark.isFetching}
        size="inline"
      />
    );
  }
  const data = benchmark.data.data;
  const { caption, figures } = data
    ? figuresOf(data)
    : { caption: null, figures: [] };
  if (!data || figures.length === 0) {
    return (
      <p className="text-base text-muted-foreground">
        Not measured yet. Nothing is reported until the comparison has run.
      </p>
    );
  }
  const caveat = data.caveats[0] ?? data.comparison?.note ?? null;
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-14 gap-y-5 border-y border-border py-5">
        {figures.map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="tabular font-mono text-3xl leading-8 font-medium text-foreground">
              {figure.value}
              {figure.unit ? (
                <span className="ml-1.5 text-base font-normal text-muted-foreground">
                  {figure.unit}
                </span>
              ) : null}
            </dd>
            {figure.against ? (
              <dd className="text-xs text-muted-foreground">
                Single agent{" "}
                <span className="tabular font-mono text-foreground">
                  {figure.against}
                </span>
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        {caption ? (
          <span className="text-foreground">{sentenceCase(caption)}</span>
        ) : null}
        {caption && data.n_variants !== null ? ", " : null}
        {data.n_variants !== null ? `${data.n_variants} variants` : null}
        {caveat ? (
          <>
            {caption || data.n_variants !== null ? ". " : null}
            <span className="line-clamp-1 inline" title={caveat}>
              {caveat}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function sentenceCase(value: string) {
  return value.replace(/^./, (first) => first.toUpperCase());
}
