"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";

import { Unknown } from "@/components/data/definition-list";
import type { Served } from "@/components/lab/api";
import {
  RunStatusTag,
  formatMeasure,
  formatSeconds,
  humanise,
  modeLabel,
  variantLabel,
} from "@/components/lab/format";
import { isActiveStatus, type LabRun } from "@/components/lab/types";
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

const count = (value: number | null) =>
  value === null ? <Unknown /> : formatMeasure(value);

function RunRow({ run }: { run: LabRun }) {
  const href = `/lab/${encodeURIComponent(run.run_id)}`;
  const active = isActiveStatus(run.status);
  // run.json holds false until a decision exists, so the flag counts only beside a favoured mechanism
  const changed = run.outcome.favoured_after
    ? run.outcome.decision_changed
    : null;
  return (
    <TableRow className="h-auto">
      <TableCell className="py-1.5">
        <Link
          href={href}
          className="font-mono font-medium text-foreground underline-offset-2 hover:underline"
          translate="no"
        >
          {run.run_id}
        </Link>
        <p className="text-muted-foreground">
          <span className="font-mono" translate="no">
            {run.subject.variant_id
              ? variantLabel(run.subject.variant_id)
              : "no variant recorded"}
          </span>
          {modeLabel(run.mode) ? `, ${modeLabel(run.mode)}` : null}
        </p>
      </TableCell>
      <TableCell>
        <RunStatusTag status={run.status} />
      </TableCell>
      <TableCell className="tabular font-mono text-muted-foreground">
        {formatTimestamp(run.started_at)?.replace(" UTC", "") ?? <Unknown />}
      </TableCell>
      {active ? (
        // run.json holds zeros until a run finishes, so an active run prints no figure
        <TableCell colSpan={3} className="text-right text-subtle-foreground">
          Written when the run finishes
        </TableCell>
      ) : (
        <>
          <TableCell className="tabular text-right font-mono">
            {run.metrics.wall_seconds === null ? (
              <Unknown />
            ) : (
              formatSeconds(run.metrics.wall_seconds)
            )}
          </TableCell>
          <TableCell className="tabular text-right font-mono">
            {count(run.metrics.tool_calls)}
          </TableCell>
          <TableCell className="tabular text-right font-mono">
            {count(run.metrics.distinct_sources)}
          </TableCell>
        </>
      )}
      <TableCell>
        {run.outcome.favoured_after ? (
          humanise(run.outcome.favoured_after)
        ) : (
          <Unknown reason="None yet" />
        )}
      </TableCell>
      <TableCell>
        {changed === null ? (
          <Unknown reason="None yet" />
        ) : changed ? (
          <span className="font-medium">Changed</span>
        ) : (
          "Unchanged"
        )}
      </TableCell>
    </TableRow>
  );
}

/** Every run in the shared research record, newest first. */
export function RunsList({ runs }: { runs: UseQueryResult<Served<LabRun[]>> }) {
  if (runs.isPending) {
    return (
      <Plate>
        <RowsSkeleton rows={4} />
      </Plate>
    );
  }
  if (runs.isError) {
    return (
      <Plate className="h-40">
        <QueryErrorState
          error={runs.error}
          subject="lab runs"
          onRetry={() => void runs.refetch()}
          retrying={runs.isFetching}
        />
      </Plate>
    );
  }
  const rows = runs.data.data;
  if (rows.length === 0) {
    return (
      <Plate className="h-40">
        <EmptyState
          title="No lab runs recorded yet"
          description={
            runs.data.served
              ? "The shared research record under lab/runs is empty. Start a run above; it appears here as soon as it writes its first line."
              : `GET /api/v1/lab/runs answered 404 at ${API_BASE_URL}: this API build does not serve the lab routes yet.`
          }
        />
      </Plate>
    );
  }
  return (
    <Plate>
      <Table className="min-w-[56rem]">
        <TableHeader className="static">
          <TableRow className="hover:bg-transparent">
            <TableHead>Run, variant and mode</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started (UTC)</TableHead>
            <TableHead className="text-right">Wall time</TableHead>
            <TableHead className="text-right">Tool calls</TableHead>
            <TableHead className="text-right">Sources</TableHead>
            <TableHead>Favoured after</TableHead>
            <TableHead>Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((run) => (
            <RunRow key={run.run_id} run={run} />
          ))}
        </TableBody>
      </Table>
    </Plate>
  );
}
