"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import type { Served } from "@/components/lab/api";
import { formatMeasure } from "@/components/lab/format";
import {
  readNumber,
  type BenchmarkArm,
  type LabBenchmark,
} from "@/components/lab/types";
import { QueryErrorState } from "@/components/states/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import {
  LAB_WORDS,
  plainCount,
  plainProgress,
  plainShare,
} from "@/lib/plain-language";

interface Measure {
  label: string;
  /** what the number is, on hover */
  hint?: string;
  team: string | null;
  oneAgent: string | null;
}

const share = (part: number | null, whole: number | null): string | null =>
  part !== null && whole !== null && whole > 0 ? plainShare(part, whole) : null;

const mean = (value: number | null | undefined): string | null =>
  value == null ? null : formatMeasure(value, 1);

const time = (value: number | null | undefined): string | null =>
  value == null ? null : formatDuration(value);

/** The measures both arms report, as the benchmark file wrote them. */
function measuresOf(
  team: BenchmarkArm,
  oneAgent: BenchmarkArm | undefined,
): Measure[] {
  const rows: Measure[] = [
    {
      label: LAB_WORDS.timePerMutation,
      hint: LAB_WORDS.typicalTime,
      team: time(team.median_wall_seconds),
      oneAgent: time(oneAgent?.median_wall_seconds),
    },
    {
      label: LAB_WORDS.sourcesChecked,
      hint: LAB_WORDS.average,
      team: mean(team.mean_distinct_sources),
      oneAgent: mean(oneAgent?.mean_distinct_sources),
    },
    {
      label: LAB_WORDS.factsGathered,
      hint: LAB_WORDS.average,
      team: mean(team.mean_evidence_items),
      oneAgent: mean(oneAgent?.mean_evidence_items),
    },
    {
      label: LAB_WORDS.changedAnswer,
      team: share(team.decision_changed, team.runs),
      oneAgent: share(
        oneAgent?.decision_changed ?? null,
        oneAgent?.runs ?? null,
      ),
    },
    {
      label: LAB_WORDS.matchedKnown,
      team: share(team.agreement.n_agree, team.agreement.n_with_reference),
      oneAgent: share(
        oneAgent?.agreement.n_agree ?? null,
        oneAgent?.agreement.n_with_reference ?? null,
      ),
    },
  ];
  return rows.filter((row) => row.team !== null || row.oneAgent !== null);
}

/** The measured comparison in everyday words: team against one agent. The full table sits behind Details. */
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
  const team =
    data?.arms.find((arm) => arm.id === "specialist_lab") ?? data?.arms[0];
  const oneAgent = data?.arms.find((arm) => arm !== team);
  const measures = team ? measuresOf(team, oneAgent) : [];
  if (!data || !team || measures.length === 0) {
    return (
      <p className="text-base text-muted-foreground">{LAB_WORDS.notMeasured}</p>
    );
  }
  const done = readNumber(data.conditions.runs_succeeded);
  const planned = readNumber(data.conditions.runs_planned);
  const unfinished = done !== null && planned !== null && done < planned;
  const heads = [
    { name: LAB_WORDS.team, runs: team.runs },
    { name: LAB_WORDS.oneAgent, runs: oneAgent?.runs ?? null },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full min-w-[30rem] max-w-3xl border-collapse text-left">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-2.5 pr-4 font-normal">
                <span className="sr-only">{LAB_WORDS.comparison}</span>
              </th>
              {heads.map((head) => (
                <th
                  key={head.name}
                  scope="col"
                  className="py-2.5 pr-4 text-sm font-medium text-foreground"
                >
                  {head.name}
                  {head.runs !== null ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {plainCount(head.runs, "run")}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {measures.map((measure) => (
              <tr
                key={measure.label}
                className="border-b border-border-subtle last:border-b-0"
              >
                <th
                  scope="row"
                  title={measure.hint}
                  className="py-3 pr-4 text-base font-normal text-muted-foreground"
                >
                  {measure.label}
                </th>
                {[measure.team, measure.oneAgent].map((value, index) => (
                  <td
                    key={heads[index].name}
                    className="tabular py-3 pr-4 font-mono text-xl font-medium text-foreground"
                  >
                    {value ?? (
                      <span className="font-sans text-base font-normal text-subtle-foreground">
                        {LAB_WORDS.notMeasured}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unfinished ? (
        <p className="text-sm text-muted-foreground">
          {plainProgress(done, planned)}
        </p>
      ) : null}
    </div>
  );
}
