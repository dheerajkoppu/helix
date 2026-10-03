"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";

import { Unknown } from "@/components/data/definition-list";
import type { Served } from "@/components/lab/api";
import {
  formatMeasure,
  formatSeconds,
  humanise,
  modeLabel,
  variantLabel,
} from "@/components/lab/format";
import { Subhead } from "@/components/lab/section";
import { ValuesView } from "@/components/lab/values-view";
import type { BenchmarkArm, LabBenchmark } from "@/components/lab/types";
import { Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api/client";
import { formatTimestamp } from "@/lib/format";

const NUMERIC = "tabular text-right font-mono";

const measure = (value: number | null, digits = 2) =>
  value === null ? <Unknown /> : formatMeasure(value, digits);

const yesNo = (value: boolean | null) =>
  value === null ? <Unknown reason="No reference" /> : value ? "Yes" : "No";

function agreement(arm: BenchmarkArm) {
  const { n_agree: agree, n_with_reference: withReference } = arm.agreement;
  if (agree === null || withReference === null) return <Unknown />;
  return `${agree} of ${withReference}`;
}

function Notes({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <Subhead title={title} count={items.length} className="bg-transparent" />
      {items.length ? (
        <ul className="flex flex-col gap-1.5 px-3 py-2 text-xs text-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                aria-hidden
                className="mt-2 h-px w-2 shrink-0 bg-border-strong"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs text-subtle-foreground">{empty}</p>
      )}
    </div>
  );
}

function Comparison({ benchmark }: { benchmark: LabBenchmark }) {
  const comparison = benchmark.comparison;
  if (!comparison) {
    return (
      <p className="border-t border-border px-3 py-2.5 text-xs text-subtle-foreground">
        The file records no headline comparison.
      </p>
    );
  }
  return (
    <div className="border-t border-border px-3 py-3">
      <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
        Observed{comparison.metric ? `: ${humanise(comparison.metric)}` : null}
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">Baseline </span>
          <span className="tabular font-mono text-foreground">
            {measure(comparison.baseline, 3)}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Lab </span>
          <span className="tabular font-mono text-foreground">
            {measure(comparison.lab, 3)}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Ratio as measured </span>
          <span className="tabular font-mono text-lg font-medium text-foreground">
            {measure(comparison.ratio, 3)}
          </span>
        </span>
      </p>
      {comparison.note ? (
        <p className="mt-1.5 max-w-[80ch] text-xs text-muted-foreground">
          {comparison.note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The measured comparison of the specialist lab against the single-agent baseline, exactly as the
 * benchmark file records it, with its conditions, controls and caveats beside the numbers.
 */
export function Benchmark({
  benchmark,
}: {
  benchmark: UseQueryResult<Served<LabBenchmark | null>>;
}) {
  if (benchmark.isPending) {
    return (
      <Plate>
        <RowsSkeleton rows={4} />
      </Plate>
    );
  }
  if (benchmark.isError) {
    return (
      <Plate className="h-40">
        <QueryErrorState
          error={benchmark.error}
          subject="the measured comparison"
          onRetry={() => void benchmark.refetch()}
          retrying={benchmark.isFetching}
        />
      </Plate>
    );
  }
  const data = benchmark.data.data;
  if (!data || (data.arms.length === 0 && data.per_variant.length === 0)) {
    return (
      <Plate className="h-40">
        <EmptyState
          title="No measured comparison recorded yet"
          description={
            benchmark.data.served
              ? "The benchmark file holds no arms. Nothing is reported until the comparison has been run."
              : `GET /api/v1/lab/benchmark answered 404 at ${API_BASE_URL}: no benchmark result is available. Nothing is reported until the comparison has been run.`
          }
        />
      </Plate>
    );
  }

  return (
    <Plate>
      {data.question ? (
        <p className="border-b border-border-subtle px-3 py-2.5 text-sm text-foreground">
          {data.question}
        </p>
      ) : null}
      <Table className="min-w-[52rem]">
        <TableHeader className="static">
          <TableRow className="hover:bg-transparent">
            <TableHead>Arm</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Median wall time</TableHead>
            <TableHead className="text-right">Mean tool calls</TableHead>
            <TableHead className="text-right">Mean distinct sources</TableHead>
            <TableHead className="text-right">Mean evidence items</TableHead>
            <TableHead className="text-right">Agrees with reference</TableHead>
            <TableHead className="text-right">Decision changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.arms.map((arm) => (
            <TableRow key={arm.id}>
              <TableCell className="font-medium">
                {arm.label ?? modeLabel(arm.id)}
              </TableCell>
              <TableCell className={NUMERIC}>{measure(arm.runs)}</TableCell>
              <TableCell className={NUMERIC}>
                {arm.median_wall_seconds === null ? (
                  <Unknown />
                ) : (
                  formatSeconds(arm.median_wall_seconds)
                )}
              </TableCell>
              <TableCell className={NUMERIC}>
                {measure(arm.mean_tool_calls)}
              </TableCell>
              <TableCell className={NUMERIC}>
                {measure(arm.mean_distinct_sources)}
              </TableCell>
              <TableCell className={NUMERIC}>
                {measure(arm.mean_evidence_items)}
              </TableCell>
              <TableCell className={NUMERIC}>{agreement(arm)}</TableCell>
              <TableCell className={NUMERIC}>
                {arm.decision_changed === null ? (
                  <Unknown />
                ) : arm.runs === null ? (
                  arm.decision_changed
                ) : (
                  `${arm.decision_changed} of ${arm.runs}`
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Comparison benchmark={data} />

      <div className="grid border-t border-border lg:grid-cols-3">
        <div className="min-w-0 border-b border-border-subtle lg:border-r lg:border-b-0">
          <Subhead
            title="Conditions"
            detail={
              data.generated_at
                ? `Measured ${formatTimestamp(data.generated_at)}`
                : null
            }
            className="bg-transparent"
          />
          <ValuesView
            bare
            values={{ variants: data.n_variants, ...data.conditions }}
          />
        </div>
        <div className="min-w-0 border-b border-border-subtle lg:border-r lg:border-b-0">
          <Notes
            title="Controls"
            items={data.controls}
            empty="No controls recorded."
          />
        </div>
        <div className="min-w-0">
          <Notes
            title="Caveats"
            items={data.caveats}
            empty="No caveats recorded."
          />
        </div>
      </div>

      {data.per_variant.length ? (
        <>
          <Subhead
            title="Per variant"
            count={data.per_variant.length}
            detail="One row per run; the reference mechanism is the comparison target, where one exists"
            className="border-t border-t-border"
          />
          <Table className="min-w-[56rem]">
            <TableHeader className="static">
              <TableRow className="hover:bg-transparent">
                <TableHead>Variant</TableHead>
                <TableHead>Arm</TableHead>
                <TableHead>Run</TableHead>
                <TableHead className="text-right">Wall time</TableHead>
                <TableHead className="text-right">Sources</TableHead>
                <TableHead>Favoured after</TableHead>
                <TableHead>Reference mechanism</TableHead>
                <TableHead>Agrees</TableHead>
                <TableHead>Decision changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.per_variant.map((row, index) => (
                <TableRow key={`${row.variant_id}:${row.arm}:${index}`}>
                  <TableCell className="font-mono" translate="no">
                    {variantLabel(row.variant_id)}
                  </TableCell>
                  <TableCell>{modeLabel(row.arm) ?? <Unknown />}</TableCell>
                  <TableCell>
                    {row.run_id ? (
                      <Link
                        href={`/lab/${encodeURIComponent(row.run_id)}`}
                        className="font-mono text-foreground underline-offset-2 hover:underline"
                        translate="no"
                      >
                        {row.run_id}
                      </Link>
                    ) : (
                      <Unknown />
                    )}
                  </TableCell>
                  <TableCell className={NUMERIC}>
                    {row.wall_seconds === null ? (
                      <Unknown />
                    ) : (
                      formatSeconds(row.wall_seconds)
                    )}
                  </TableCell>
                  <TableCell className={NUMERIC}>
                    {measure(row.distinct_sources)}
                  </TableCell>
                  <TableCell>
                    {row.favoured_after ? (
                      humanise(row.favoured_after)
                    ) : (
                      <Unknown reason="None" />
                    )}
                  </TableCell>
                  <TableCell>
                    {row.reference_mechanism ? (
                      humanise(row.reference_mechanism)
                    ) : (
                      <Unknown reason="No reference" />
                    )}
                  </TableCell>
                  <TableCell>{yesNo(row.agrees)}</TableCell>
                  <TableCell>
                    {row.decision_changed === null ? (
                      <Unknown />
                    ) : row.decision_changed ? (
                      "Yes"
                    ) : (
                      "No"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}

      {data.next_experiment ? (
        <p className="border-t border-border px-3 py-2.5 text-xs">
          <span className="text-muted-foreground">Next experiment: </span>
          <span className="text-foreground">{data.next_experiment}</span>
        </p>
      ) : null}
    </Plate>
  );
}
