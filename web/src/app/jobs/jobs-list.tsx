"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { useEffect, useMemo, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import {
  JobStatusTag,
  elapsedSeconds,
  formatClock,
  formatElapsed,
  jobKindLabel,
  stageProgressText,
  useNow,
} from "@/components/jobs/job-status";
import { JobWatcher, openRunJob } from "@/components/jobs/run-job";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { WorkspaceIdentity } from "@/components/shell/workspace-identity";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiQuery } from "@/lib/api/query";
import { routes } from "@/lib/ids";
import {
  JOB_STATUSES,
  isTerminal,
  useJobs,
  type JobOut,
  type JobPage,
  type JobStatus,
  type ModelsOut,
} from "@/lib/state/jobs";
import { useAdvancedMode } from "@/lib/state/preferences";

type StatusFilter = "all" | "active" | JobStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "succeeded", label: "Succeeded" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

const isStatusFilter = (value: string | null): value is StatusFilter =>
  value !== null &&
  (value === "all" ||
    value === "active" ||
    (JOB_STATUSES as string[]).includes(value));

/** What the job is doing now: the running stage and any measured progress the API reported. */
function currentStage(job: JobOut): string | null {
  const stage =
    job.stages.find((entry) => entry.status === "running") ??
    job.stages.find((entry) => entry.id === job.current_stage);
  if (job.status !== "running" || !stage) return null;
  const progress = stageProgressText(stage);
  const position = job.stages.indexOf(stage) + 1;
  return `${position}/${job.stages.length} ${stage.label}${progress ? ` (${progress})` : ""}`;
}

/** One mark per stage, so progress reads without opening the job. */
function StageDots({ job }: { job: JobOut }) {
  const done = job.stages.filter(
    (stage) => stage.status === "done" || stage.status === "succeeded",
  ).length;
  return (
    <span
      role="img"
      aria-label={`${done} of ${job.stages.length} stages done`}
      className="flex shrink-0 items-center gap-1"
    >
      {job.stages.map((stage) => (
        <span
          key={stage.id}
          className={cn(
            "size-1.5 rounded-full border",
            stage.status === "done" || stage.status === "succeeded"
              ? "border-foreground bg-foreground"
              : stage.status === "running"
                ? "border-foreground"
                : stage.status === "failed"
                  ? "border-destructive bg-destructive"
                  : "border-border-strong",
          )}
        />
      ))}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function JobsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const revision = useJobs((state) => state.revision);
  const activeCount = useJobs((state) => state.active.length);

  const initialStatus = searchParams.get("status");
  const [status, setStatus] = useState<StatusFilter>(
    isStatusFilter(initialStatus) ? initialStatus : "all",
  );
  const [kind, setKind] = useState<string | null>(searchParams.get("kind"));
  const [text, setText] = useState("");

  // /jobs?new=<kind>&<params> opens the run dialog prefilled, then leaves a clean URL.
  const newKind = searchParams.get("new");
  useEffect(() => {
    if (newKind === null) return;
    const params: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      if (key !== "new") params[key] = value;
    });
    openRunJob({ kind: newKind || undefined, params });
    router.replace(routes.jobs());
  }, [newKind, searchParams, router]);

  const jobs = useQuery({
    ...apiQuery<JobPage>("/jobs", { limit: 200 }),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.data.items.some((job) => !isTerminal(job.status))
        ? 2000
        : false,
  });
  const refetch = jobs.refetch;
  useEffect(() => {
    if (revision > 0 || activeCount > 0) void refetch();
  }, [revision, activeCount, refetch]);

  const items = useMemo(() => jobs.data?.data.items ?? [], [jobs.data]);
  const kinds = useMemo(
    () => [...new Set(items.map((job) => job.kind))].sort(),
    [items],
  );
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return items.filter((job) => {
      if (status === "active" && isTerminal(job.status)) return false;
      if (status !== "all" && status !== "active" && job.status !== status)
        return false;
      if (kind && job.kind !== kind) return false;
      if (!needle) return true;
      return [
        job.id,
        job.title,
        job.subject?.id,
        job.subject?.label,
        job.provider_id,
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [items, status, kind, text]);

  const now = useNow(items.some((job) => job.status === "running"));
  const advanced = useAdvancedMode();
  const models = useQuery(apiQuery<ModelsOut>("/models"));
  const providers = models.data?.data.providers;

  const columns = useMemo<DataTableColumn<JobOut>[]>(() => {
    const simple: DataTableColumn<JobOut>[] = [
      {
        id: "status",
        header: "Status",
        width: 104,
        accessor: (job) => job.status,
        cell: (job) => <JobStatusTag status={job.status} />,
      },
      {
        id: "title",
        header: "Job",
        width: "minmax(13rem,2fr)",
        accessor: (job) => job.title ?? job.id,
        cell: (job) => (
          <TextLink href={routes.job(job.id)} className="truncate">
            {job.title ?? job.id}
          </TextLink>
        ),
      },
      {
        id: "stage",
        header: "Stages",
        width: "minmax(9rem,1.4fr)",
        sortable: false,
        cell: (job) => (
          <span className="flex min-w-0 items-center gap-2">
            <StageDots job={job} />
            {job.status === "failed" ? (
              <span
                className="truncate text-destructive"
                title={job.error?.message}
              >
                {job.error?.code ?? "failed"}
              </span>
            ) : (
              <span className="truncate text-muted-foreground">
                {currentStage(job) ?? ""}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "model",
        header: "Model",
        width: "minmax(9rem,1fr)",
        accessor: (job) => {
          const provider = providers?.find(
            (entry) => entry.id === job.provider_id,
          );
          return provider
            ? [provider.model_name ?? provider.name, provider.model_version]
                .filter(Boolean)
                .join(" ")
            : job.provider_id;
        },
      },
      {
        id: "elapsed",
        header: "Run time",
        width: 88,
        align: "right",
        accessor: (job) =>
          elapsedSeconds(job.started_at, job.completed_at, now),
        cell: (job) =>
          formatElapsed(
            elapsedSeconds(job.started_at, job.completed_at, now),
          ) ?? "",
      },
      {
        id: "created",
        header: "Created",
        width: 176,
        mono: true,
        accessor: (job) => job.created_at,
        cell: (job) => formatClock(job.created_at),
      },
    ];
    if (!advanced) return simple.filter((column) => column.id !== "created");
    return [
      ...simple,
      {
        id: "kind",
        header: "Kind",
        width: 150,
        accessor: (job) => jobKindLabel(job.kind),
      },
      {
        id: "provider",
        header: "Provider",
        width: 96,
        mono: true,
        accessor: (job) => job.provider_id,
      },
      {
        id: "id",
        header: "Job ID",
        width: 250,
        sortable: false,
        cell: (job) => <MonoId value={job.id} />,
      },
    ];
  }, [now, advanced, providers]);

  return (
    <Page>
      <JobWatcher />
      <PageHeader
        title="Jobs"
        id={jobs.data ? `${jobs.data.data.total}` : undefined}
        meta={advanced ? <WorkspaceIdentity className="text-xs" /> : undefined}
        actions={<Button onClick={() => openRunJob()}>New job</Button>}
      />
      <PageBody className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div
            role="group"
            aria-label="Filter by status"
            className="flex items-center gap-0.5"
          >
            {STATUS_FILTERS.map((filter) => (
              <FilterButton
                key={filter.id}
                active={status === filter.id}
                onClick={() => setStatus(filter.id)}
              >
                {filter.label}
              </FilterButton>
            ))}
          </div>
          {advanced && kinds.length > 1 ? (
            <div
              role="group"
              aria-label="Filter by kind"
              className="flex items-center gap-0.5"
            >
              <FilterButton
                active={kind === null}
                onClick={() => setKind(null)}
              >
                All kinds
              </FilterButton>
              {kinds.map((entry) => (
                <FilterButton
                  key={entry}
                  active={kind === entry}
                  onClick={() => setKind(entry)}
                >
                  {jobKindLabel(entry)}
                </FilterButton>
              ))}
            </div>
          ) : null}
          {advanced || items.length > 12 ? (
            <Input
              aria-label="Filter jobs by title, subject, provider or ID"
              placeholder="Filter"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="ml-auto w-56 max-w-full"
            />
          ) : null}
          {rows.length !== items.length ? (
            <span className="tabular font-mono text-xs text-subtle-foreground">
              {rows.length} of {items.length}
            </span>
          ) : null}
        </div>

        <Plate
          className="min-h-48 overflow-x-auto"
          style={{
            height: `min(calc(100dvh - 15rem), ${Math.max(rows.length, 5) * 28 + 32}px)`,
          }}
        >
          {jobs.error ? (
            <QueryErrorState
              error={jobs.error}
              subject="jobs of this workspace"
              onRetry={() => void jobs.refetch()}
              retrying={jobs.isFetching}
            />
          ) : (
            <div
              className={cn(
                "h-full",
                advanced ? "min-w-[78rem]" : "min-w-[44rem]",
              )}
            >
              <DataTable
                label="Jobs of this workspace"
                columns={columns}
                data={rows}
                getRowId={(job) => job.id}
                defaultSort={{ id: "created", desc: true }}
                onRowActivate={(job) => router.push(routes.job(job.id))}
                loading={jobs.isPending}
                empty={
                  <EmptyState
                    title={
                      items.length === 0
                        ? "No jobs yet"
                        : "No job matches these filters"
                    }
                    actions={
                      items.length === 0 ? (
                        <TextLink href={routes.models()}>Models</TextLink>
                      ) : undefined
                    }
                  />
                }
              />
            </div>
          )}
        </Plate>
      </PageBody>
    </Page>
  );
}
