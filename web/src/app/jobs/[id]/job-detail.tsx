"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  JobStatusTag,
  elapsedSeconds,
  formatClock,
  formatElapsed,
  jobKindLabel,
  stageProgressText,
  useNow,
} from "@/components/jobs/job-status";
import { JobWatcher, RunJobButton } from "@/components/jobs/run-job";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { PlddtLegend } from "@/components/science/legends";
import {
  ModelResultStrip,
  type ModelResultMetric,
} from "@/components/science/model-result-strip";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Plate,
} from "@/components/shell/page";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { ButtonLink } from "@/components/data/button-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MolecularViewer,
  type MolecularViewerHandle,
} from "@/components/viewer";
import { apiFetch, apiUrl, isApiError } from "@/lib/api/client";
import { apiQuery, apiQueryKey } from "@/lib/api/query";
import type { ApiResult } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  isTerminal,
  jobFileUrl,
  type JobEvent,
  type JobOut,
  type ModelsOut,
} from "@/lib/state/jobs";
import {
  isStructureOrigin,
  type StructureOrigin,
} from "@/lib/structure-origin";

interface ResultStructure {
  id: string;
  origin: StructureOrigin;
  title: string | null;
  providerName: string | null;
  modelName: string | null;
  modelVersion: string | null;
  fileUrl: string;
  format: "mmcif" | "pdb";
  confidence: Record<string, unknown> | null;
  coveredResidues: number | null;
  limitations: string[];
  /** where in the result document the descriptor sits: "structure", "variant_model.structure" */
  path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : null);
const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/** Structure descriptors anywhere in a job result, in document order. */
function findStructures(
  value: unknown,
  path: string,
  depth: number,
  found: ResultStructure[],
): ResultStructure[] {
  if (!isRecord(value) || depth > 3) return found;
  const files = isRecord(value.files) ? value.files : null;
  if (files && text(value.id) && isStructureOrigin(value.origin)) {
    const cif = text(files.cif_url);
    const pdb = text(files.pdb_url);
    if (cif || pdb)
      found.push({
        id: value.id as string,
        origin: value.origin,
        title: text(value.title),
        providerName: text(value.provider_name) ?? text(value.provider),
        modelName: text(value.model_name),
        modelVersion: text(value.model_version),
        fileUrl: jobFileUrl((cif ?? pdb) as string),
        format: cif ? "mmcif" : "pdb",
        confidence: isRecord(value.confidence) ? value.confidence : null,
        coveredResidues: isRecord(value.coverage)
          ? numeric(value.coverage.covered_residues)
          : null,
        limitations: strings(value.limitations),
        path,
      });
    return found;
  }
  for (const [key, child] of Object.entries(value))
    findStructures(child, path ? `${path}.${key}` : key, depth + 1, found);
  return found;
}

/** Follows the job's event stream: the full log from the first event, live while the job runs. */
function useJobEvents(jobId: string, onChange: () => void) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [streamState, setStreamState] = useState<
    "connecting" | "live" | "ended" | "interrupted"
  >("connecting");
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const source = new EventSource(apiUrl(`/jobs/${jobId}/events`));
    const seen = new Set<number>();
    let ended = false;
    const receive = (message: MessageEvent<string>) => {
      let event: JobEvent;
      try {
        event = JSON.parse(message.data) as JobEvent;
      } catch {
        return;
      }
      if (typeof event.id !== "number" || seen.has(event.id)) return;
      seen.add(event.id);
      setEvents((current) => [...current, event]);
      if (event.type !== "log") changed.current();
    };
    for (const type of ["status", "stage", "log", "artifact"])
      source.addEventListener(type, receive as EventListener);
    source.addEventListener("end", () => {
      ended = true;
      source.close();
      setStreamState("ended");
      changed.current();
    });
    source.onopen = () => setStreamState("live");
    source.onerror = () => {
      if (!ended) setStreamState("interrupted");
    };
    return () => source.close();
  }, [jobId]);

  return { events, streamState };
}

function StageMark({ status }: { status: string }) {
  if (status === "running") return <Spinner className="size-3" />;
  if (status === "failed")
    return (
      <span
        aria-hidden
        className="font-mono text-xs leading-3 text-destructive"
      >
        ✕
      </span>
    );
  const done = status === "done" || status === "succeeded";
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border",
        done
          ? "border-foreground bg-foreground"
          : status === "pending" || status === "queued"
            ? "border-border-strong"
            : "border-dashed border-border-strong",
      )}
    />
  );
}

/** The stages on one line: which are done, which is running, how long each took. */
function StageStrip({ job, now }: { job: JobOut; now: number }) {
  return (
    <ol
      aria-label="Stages"
      className="flex flex-col gap-y-2.5 sm:flex-row sm:gap-y-0"
    >
      {job.stages.map((stage, index) => {
        const running = stage.status === "running";
        const waiting = stage.status === "pending" || stage.status === "queued";
        const duration = formatElapsed(
          elapsedSeconds(
            stage.started_at,
            stage.completed_at,
            running ? now : Date.parse(stage.started_at ?? ""),
          ),
        );
        const progress = stageProgressText(stage);
        return (
          <li
            key={stage.id}
            aria-current={running ? "step" : undefined}
            className="flex min-w-0 flex-1 items-start gap-2.5 sm:flex-col sm:gap-2"
          >
            <span className="flex h-4 shrink-0 items-center sm:w-full">
              <StageMark status={stage.status} />
              {index < job.stages.length - 1 ? (
                <span
                  aria-hidden
                  className="mx-2 hidden h-px flex-1 bg-border sm:block"
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 sm:pr-4">
              <span
                className={cn(
                  "text-sm",
                  running && "font-medium",
                  waiting ? "text-subtle-foreground" : "text-foreground",
                )}
              >
                {stage.label}
              </span>
              <span className="tabular font-mono text-xs text-muted-foreground">
                <span className="sr-only">{stage.status}: </span>
                {[duration ?? (waiting ? "waiting" : stage.status), progress]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StageTimeline({ job, now }: { job: JobOut; now: number }) {
  return (
    <Plate className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead>Progress reported</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {job.stages.map((stage, index) => {
            const running = stage.status === "running";
            return (
              <TableRow
                key={stage.id}
                data-state={running ? "selected" : undefined}
              >
                <TableCell className="text-right font-mono text-subtle-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <span className={cn(running && "font-medium")}>
                    {stage.label}
                  </span>
                  {stage.detail ? (
                    <span className="block text-muted-foreground">
                      {stage.detail}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <JobStatusTag status={stage.status} />
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {formatClock(stage.started_at) ?? ""}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {formatClock(stage.completed_at) ?? ""}
                </TableCell>
                <TableCell className="tabular text-right font-mono">
                  {formatElapsed(
                    elapsedSeconds(
                      stage.started_at,
                      stage.completed_at,
                      running ? now : Date.parse(stage.started_at ?? ""),
                    ),
                  ) ?? ""}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {stageProgressText(stage) ?? (running ? "none reported" : "")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Plate>
  );
}

function StructurePreview({
  structure,
  extraMetrics,
  runtime,
  href,
  hrefLabel,
}: {
  structure: ResultStructure;
  extraMetrics: ModelResultMetric[];
  runtime: number | null;
  href: string | null;
  hrefLabel: string;
}) {
  const advanced = useAdvancedMode();
  const viewer = useRef<MolecularViewerHandle>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const detail = [structure.providerName, structure.modelVersion]
    .filter(Boolean)
    .join(" ");
  const confidence = structure.confidence;
  const scale = text(confidence?.plddt_native_scale);
  const { id, fileUrl, format, origin } = structure;
  const predicted = origin !== "experimental";

  useEffect(() => {
    const handle = viewer.current;
    if (!handle) return;
    let cancelled = false;
    handle
      .clear()
      .then(() =>
        handle.load({
          id,
          source: { kind: "url", url: fileUrl, format },
          origin,
          detail,
          colorMode: predicted ? { kind: "plddt" } : { kind: "chain" },
          plddtScale: scale === "0-1" ? "0-1" : "0-100",
        }),
      )
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : "The file did not load.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [id, fileUrl, format, origin, detail, predicted, scale]);

  const fractions = isRecord(confidence?.plddt_fractions)
    ? confidence.plddt_fractions
    : null;
  const ptm = numeric(confidence?.ptm);
  const iptm = numeric(confidence?.iptm);
  const metrics: ModelResultMetric[] = [
    {
      label: "Mean pLDDT",
      value: numeric(confidence?.plddt_mean),
      explainer: "plddt",
      missingReason: "Not reported",
    },
    ...(ptm !== null ? [{ label: "pTM", value: ptm, explainer: "ptm" }] : []),
    ...(iptm !== null
      ? [{ label: "ipTM", value: iptm, explainer: "iptm" }]
      : []),
    ...extraMetrics,
    ...(structure.coveredResidues !== null && extraMetrics.length === 0
      ? [{ label: "Residues", value: structure.coveredResidues, unit: "aa" }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <Plate>
        <ModelResultStrip
          frame="none"
          className="border-b border-border px-4 py-3"
          model={
            structure.modelName ?? structure.providerName ?? "Unknown model"
          }
          version={structure.modelVersion}
          origin={structure.origin}
          metrics={metrics}
          runtime={runtime}
          href={href}
          hrefLabel={hrefLabel}
        />
        <div className="relative h-[min(32rem,46dvh)] min-h-72">
          <MolecularViewer
            ref={viewer}
            ariaLabel={`Structure ${structure.id} produced by this job`}
          />
        </div>
      </Plate>
      {loadError ? (
        <p className="text-xs text-destructive">
          The structure file could not be displayed: {loadError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {predicted ? <PlddtLegend /> : <span />}
        <AddToProjectButton
          label="Add structure"
          item={{
            kind: "structure",
            ref: structure.id,
            label: structure.title
              ? `${structure.title} (${structure.id})`
              : structure.id,
            origin: { route: window.location.pathname },
            data: {
              origin: structure.origin,
              model_name: structure.modelName,
              model_version: structure.modelVersion,
              file_url: structure.fileUrl,
            },
          }}
        />
      </div>
      {advanced ? (
        <DefinitionList termWidth="9rem">
          <DefinitionRow term="Structure ID">
            <MonoId value={structure.id} />
          </DefinitionRow>
          {structure.title ? (
            <DefinitionRow term="Title">{structure.title}</DefinitionRow>
          ) : null}
          {fractions
            ? (
                [
                  ["very_high", "pLDDT above 90"],
                  ["confident", "pLDDT 70 to 90"],
                  ["low", "pLDDT 50 to 70"],
                  ["very_low", "pLDDT below 50"],
                ] as const
              ).map(([key, label]) => {
                const fraction = numeric(fractions[key]);
                return (
                  <DefinitionRow key={key} term={label} mono>
                    {fraction === null
                      ? null
                      : `${(fraction * 100).toFixed(1)}% of residues`}
                  </DefinitionRow>
                );
              })
            : null}
          <DefinitionRow term="PAE matrix">
            {confidence?.pae_available === true
              ? "stored with this job"
              : confidence?.pae_available === false
                ? "not provided by this model"
                : null}
          </DefinitionRow>
        </DefinitionList>
      ) : null}
    </div>
  );
}

function ParamValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="text-subtle-foreground">not set</span>;
  const printed = typeof value === "string" ? value : JSON.stringify(value);
  return <span className="break-all">{printed}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EventLog({
  events,
  streamState,
}: {
  events: JobEvent[];
  streamState: string;
}) {
  const stateLabel: Record<string, string> = {
    connecting: "connecting to the event stream",
    live: "following the event stream",
    ended: "stream ended",
    interrupted: "stream interrupted; the browser is reconnecting",
  };
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        {stateLabel[streamState]}
      </p>
      <Plate className="scroll-thin max-h-80 overflow-auto">
        {events.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No events received.
          </p>
        ) : (
          <ol className="font-mono text-xs">
            {events.map((event) => (
              <li
                key={event.id}
                className="grid grid-cols-[5.5rem_4.5rem_minmax(0,1fr)] gap-x-3 border-b border-border-subtle px-3 py-0.5 last:border-b-0"
              >
                <span className="text-subtle-foreground">
                  {event.at.slice(11, 23)}
                </span>
                <span className="text-muted-foreground">
                  {event.level ?? event.type}
                </span>
                <span
                  className={cn(
                    "break-words",
                    event.level === "error" && "text-destructive",
                  )}
                >
                  {event.stage_id && event.type !== "stage" ? (
                    <span className="text-muted-foreground">
                      [{event.stage_id}]{" "}
                    </span>
                  ) : null}
                  {event.message ?? ""}
                  {event.type === "stage" && isRecord(event.data?.stage)
                    ? ` · ${String(event.data.stage.status)}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Plate>
    </>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const advanced = useAdvancedMode();
  const [tab, setTab] = useState("result");
  const path = `/jobs/${jobId}`;
  const jobQuery = useQuery({
    ...apiQuery<JobOut>(path),
    staleTime: 0,
    refetchInterval: (query) => {
      const current = query.state.data?.data;
      return current && !isTerminal(current.status) ? 3000 : false;
    },
  });
  const job = jobQuery.data?.data ?? null;
  const refetchJob = jobQuery.refetch;
  const { events, streamState } = useJobEvents(jobId, () => void refetchJob());

  const models = useQuery(apiQuery<ModelsOut>("/models"));
  const provider =
    models.data?.data.providers.find(
      (entry) => entry.id === job?.provider_id,
    ) ?? null;

  const manifest = useQuery({
    ...apiQuery<Record<string, unknown>>(`${path}/manifest`),
    enabled: Boolean(job?.manifest_url),
  });

  const cancel = useMutation({
    mutationFn: () => apiFetch<JobOut>(`${path}/cancel`, { method: "POST" }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ApiResult<JobOut>>(
        apiQueryKey(path),
        (current) => (current ? { ...current, data: updated } : current),
      );
    },
  });

  const jobResult = job?.result ?? null;
  const structures = useMemo(
    () => (jobResult ? findStructures(jobResult, "", 0, []) : []),
    [jobResult],
  );
  const [structureIndex, setStructureIndex] = useState(0);
  const structure = structures[structureIndex] ?? structures[0] ?? null;

  const now = useNow(job?.status === "running");

  if (jobQuery.error && !job)
    return (
      <Page>
        <JobWatcher />
        <PageHeader
          kind="Job"
          title="Computational job"
          id={<MonoId value={jobId} />}
        />
        <PageBody className="py-5">
          <Plate className="h-64">
            <QueryErrorState
              error={jobQuery.error}
              subject={`job ${jobId}`}
              onRetry={() => void jobQuery.refetch()}
              retrying={jobQuery.isFetching}
            />
          </Plate>
          <p className="mt-3 text-xs">
            <TextLink href={routes.jobs()}>All jobs</TextLink>
          </p>
        </PageBody>
      </Page>
    );

  if (!job)
    return (
      <Page>
        <PageHeader
          kind="Job"
          title="Computational job"
          id={<MonoId value={jobId} />}
        />
        <PageBody className="py-5">
          <RowsSkeleton rows={8} />
        </PageBody>
      </Page>
    );

  const result = job.result ?? {};
  const manifestModel = isRecord(manifest.data?.data.model)
    ? manifest.data.data.model
    : null;
  const manifestSoftware = isRecord(manifest.data?.data.software)
    ? manifest.data.data.software
    : null;
  const orphafold = isRecord(manifestSoftware?.orphafold)
    ? manifestSoftware.orphafold
    : null;
  const limitations = [
    ...new Set([
      ...structures.flatMap((entry) => entry.limitations),
      ...strings(result.limitations),
      ...strings(result.caveats),
      ...(structures.length === 0 && strings(result.limitations).length === 0
        ? (provider?.limitations ?? [])
        : []),
    ]),
  ];
  const warnings = [
    ...strings(result.warnings),
    ...(isRecord(result.structure) ? strings(result.structure.warnings) : []),
  ];
  const totalSeconds = elapsedSeconds(job.started_at, job.completed_at, now);
  const active = !isTerminal(job.status);

  const variantRecord = isRecord(result.variant) ? result.variant : null;
  const variantGene = text(variantRecord?.gene_symbol);
  const variantChange = text(variantRecord?.hgvs_p);
  const compareHref =
    job.kind === "variant_comparison" && variantGene && variantChange
      ? routes.compare(variantGene, variantChange)
      : null;
  const openHref = compareHref ?? job.subject?.href ?? null;
  const openLabel = compareHref
    ? "Open comparison"
    : `Open ${job.subject?.type ?? "subject"}`;

  const summary = isRecord(result.summary) ? result.summary : null;
  const confidentRmsd = numeric(summary?.rmsd_ca_confident);
  const extraMetrics: ModelResultMetric[] =
    confidentRmsd !== null
      ? [{ label: "Confident Cα RMSD", value: confidentRmsd, unit: "Å" }]
      : [];

  const modelName =
    text(manifestModel?.name) ??
    provider?.model_name ??
    provider?.name ??
    job.provider_id;
  const modelVersion =
    text(manifestModel?.version) ?? provider?.model_version ?? null;

  return (
    <Page>
      <JobWatcher />
      <PageHeader
        kind={`Job · ${jobKindLabel(job.kind)}`}
        title={job.title ?? "Computational job"}
        id={advanced ? <MonoId value={job.id} /> : undefined}
        meta={
          <>
            <JobStatusTag status={job.status} />
            {job.cancel_requested && active ? (
              <span className="text-xs text-muted-foreground">
                Stops at the next checkpoint
              </span>
            ) : null}
            {totalSeconds !== null ? (
              <span className="tabular font-mono text-xs text-muted-foreground">
                {formatElapsed(totalSeconds)}
              </span>
            ) : null}
            {job.subject?.href ? (
              <TextLink href={job.subject.href} className="text-xs">
                {job.subject.label ?? job.subject.id}
              </TextLink>
            ) : null}
          </>
        }
        actions={
          <>
            {active ? (
              <Button
                variant="outline"
                disabled={cancel.isPending || job.cancel_requested}
                onClick={() => cancel.mutate()}
              >
                {job.cancel_requested ? "Cancelling" : "Cancel job"}
              </Button>
            ) : job.status === "succeeded" && openHref ? (
              <ButtonLink variant="default" href={openHref}>
                {openLabel}
              </ButtonLink>
            ) : null}
            <AddToProjectButton
              item={{
                kind: "job",
                ref: job.id,
                label: job.title ?? job.id,
                origin: { route: routes.job(job.id) },
                data: {
                  job_kind: job.kind,
                  status: job.status,
                  provider_id: job.provider_id,
                  manifest_sha256: job.manifest_sha256,
                },
              }}
            />
          </>
        }
      />
      <PageBody className="pb-8">
        {cancel.error ? (
          <p role="alert" className="pt-3 text-xs text-destructive">
            Cancellation was not accepted:{" "}
            {isApiError(cancel.error)
              ? cancel.error.message
              : "the request failed"}
          </p>
        ) : null}

        <section className="border-b border-border-subtle py-5">
          <StageStrip job={job} now={now} />
        </section>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="gap-0 pt-2"
        >
          <div className="border-b border-border-subtle pb-1">
            <TabsList variant="line">
              <TabsTrigger value="result">Result</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="files">
                Files
                <span className="tabular font-mono text-2xs text-subtle-foreground">
                  {job.artifacts.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="result" className="py-4">
            {job.error ? (
              <DefinitionList termWidth="9rem" className="mb-4">
                <DefinitionRow term="Failure" mono>
                  {job.error.code}
                </DefinitionRow>
                <DefinitionRow term="Reason">{job.error.message}</DefinitionRow>
                {job.error.detail ? (
                  <DefinitionRow term="Detail" mono>
                    <span className="break-all">
                      {JSON.stringify(job.error.detail)}
                    </span>
                  </DefinitionRow>
                ) : null}
                <DefinitionRow term="Attempts" mono>
                  {job.attempts}
                </DefinitionRow>
              </DefinitionList>
            ) : null}

            {structure ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-sm text-muted-foreground">
                    {text(result.statement) ??
                      (result.performs_inference !== false
                        ? "Computational prediction, not an experimental structure."
                        : structure.origin === "predicted_orphafold"
                          ? "Stored output of an earlier prediction run. This job ran no model."
                          : "Existing predicted model. OrphaFold ran no inference.")}{" "}
                    {limitations.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setTab("details")}
                        className="cursor-pointer rounded-xs underline decoration-dotted underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        Limits ({limitations.length})
                      </button>
                    ) : null}
                  </p>
                  {structures.length > 1 ? (
                    <div
                      role="group"
                      aria-label="Model shown"
                      className="flex items-center gap-0.5"
                    >
                      {structures.map((entry, index) => (
                        <Button
                          key={`${entry.path}:${entry.id}`}
                          size="sm"
                          variant={entry === structure ? "secondary" : "ghost"}
                          aria-pressed={entry === structure}
                          onClick={() => setStructureIndex(index)}
                          className="capitalize"
                        >
                          {entry.path
                            .split(".")[0]
                            .replace(/_model$/, "")
                            .replaceAll("_", " ")}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <StructurePreview
                  key={`${structure.path}:${structure.id}`}
                  structure={structure}
                  extraMetrics={extraMetrics}
                  runtime={totalSeconds}
                  href={openHref}
                  hrefLabel={openLabel}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {modelName ? (
                  <ModelResultStrip
                    frame="box"
                    model={modelName}
                    version={modelVersion}
                    origin={provider?.structure_origin}
                    metrics={[]}
                    runtime={totalSeconds}
                    href={job.status === "succeeded" ? openHref : null}
                    hrefLabel={openLabel}
                  />
                ) : null}
                {job.result ? (
                  <details open={advanced}>
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      Result document
                    </summary>
                    <Plate className="scroll-thin mt-2 max-h-96 overflow-auto">
                      <pre className="px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                        {JSON.stringify(job.result, null, 2)}
                      </pre>
                    </Plate>
                  </details>
                ) : !job.error ? (
                  <p className="text-sm text-muted-foreground">
                    {active ? "No result yet." : "This job returned no result."}
                  </p>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="details">
            <PageSection title="Stages" count={job.stages.length}>
              <StageTimeline job={job} now={now} />
              <DefinitionList termWidth="9rem" className="mt-3">
                <DefinitionRow term="Created" mono>
                  {formatClock(job.created_at)}
                </DefinitionRow>
                <DefinitionRow term="Started" mono>
                  {formatClock(job.started_at) ?? (
                    <Unknown reason="not started" />
                  )}
                </DefinitionRow>
                <DefinitionRow term="Completed" mono>
                  {formatClock(job.completed_at) ?? (
                    <Unknown reason="not completed" />
                  )}
                </DefinitionRow>
                <DefinitionRow term="Job ID">
                  <MonoId value={job.id} />
                </DefinitionRow>
              </DefinitionList>
            </PageSection>

            <PageSection
              title="Inputs"
              count={Object.keys(job.params).length}
              actions={
                active ? null : (
                  <RunJobButton
                    kind={job.kind}
                    params={job.params}
                    label="Run again"
                    size="sm"
                  />
                )
              }
            >
              <DefinitionList termWidth="12rem">
                {Object.entries(job.params).map(([name, value]) => (
                  <DefinitionRow key={name} term={name} mono>
                    <ParamValue value={value} />
                  </DefinitionRow>
                ))}
                {job.parent_job_id ? (
                  <DefinitionRow term="Repeats job" mono>
                    <TextLink href={routes.job(job.parent_job_id)}>
                      {job.parent_job_id}
                    </TextLink>
                  </DefinitionRow>
                ) : null}
              </DefinitionList>
            </PageSection>

            <PageSection title="Model">
              <DefinitionList termWidth="12rem">
                <DefinitionRow term="Provider">
                  {job.provider_id ? (
                    <>
                      {provider?.name ?? job.provider_id}{" "}
                      <TextLink
                        href={`${routes.models()}#${job.provider_id}`}
                        className="font-mono"
                      >
                        {job.provider_id}
                      </TextLink>
                    </>
                  ) : null}
                </DefinitionRow>
                <DefinitionRow term="Model" mono>
                  {text(manifestModel?.name) ?? provider?.model_name}
                </DefinitionRow>
                <DefinitionRow term="Model version" mono>
                  {modelVersion}
                </DefinitionRow>
                <DefinitionRow term="Recorded in">
                  {manifestModel ? "run manifest" : "provider registry"}
                </DefinitionRow>
                <DefinitionRow term="Execution mode" mono>
                  {text(manifestModel?.execution_mode) ??
                    provider?.execution_mode}
                </DefinitionRow>
                <DefinitionRow term="License" mono>
                  {text(manifestModel?.license) ?? provider?.license}
                </DefinitionRow>
                {provider ? (
                  <DefinitionRow term="Commercial use">
                    {provider.commercial_use === null
                      ? null
                      : provider.commercial_use
                        ? "permitted by the license"
                        : "not permitted by the license"}
                  </DefinitionRow>
                ) : null}
                {orphafold ? (
                  <DefinitionRow term="OrphaFold" mono>
                    {text(orphafold.version)}
                    {text(orphafold.git_commit)
                      ? ` · ${(orphafold.git_commit as string).slice(0, 12)}`
                      : ""}
                  </DefinitionRow>
                ) : null}
                {provider?.attribution ? (
                  <DefinitionRow term="Attribution">
                    {provider.attribution}
                  </DefinitionRow>
                ) : null}
              </DefinitionList>
            </PageSection>

            {limitations.length > 0 || warnings.length > 0 ? (
              <PageSection title="Limits" count={limitations.length}>
                <ul className="flex max-w-[80ch] list-disc flex-col gap-1.5 pl-4 text-sm text-muted-foreground">
                  {limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                  {warnings.map((warning) => (
                    <li key={warning} className="font-mono text-xs">
                      {warning}
                    </li>
                  ))}
                </ul>
              </PageSection>
            ) : null}
          </TabsContent>

          <TabsContent value="files" className="py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                Manifest
                {job.manifest_sha256 ? (
                  <MonoId value={job.manifest_sha256}>
                    {job.manifest_sha256.slice(0, 16)}
                  </MonoId>
                ) : (
                  <Unknown
                    reason={
                      active ? "written when the job ends" : "not recorded"
                    }
                  />
                )}
              </span>
              {job.manifest_url ? (
                <a
                  href={jobFileUrl(job.manifest_url)}
                  target="_blank"
                  rel="noreferrer"
                  download={`${job.id}.manifest.json`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Download manifest
                </a>
              ) : null}
            </div>
            {job.artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {active ? "No files stored yet." : "This job stored no files."}
              </p>
            ) : (
              <Plate className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      {advanced ? (
                        <>
                          <TableHead>Media type</TableHead>
                          <TableHead>SHA-256</TableHead>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.artifacts.map((artifact) => (
                      <TableRow key={artifact.id}>
                        <TableCell className="font-mono">
                          <ExternalLink href={jobFileUrl(artifact.url)}>
                            {artifact.name}
                          </ExternalLink>
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {artifact.role}
                        </TableCell>
                        <TableCell>
                          {artifact.structure_origin ? (
                            <StructureOriginTag
                              origin={artifact.structure_origin}
                              size="compact"
                            />
                          ) : null}
                        </TableCell>
                        <TableCell
                          className="tabular text-right font-mono"
                          title={`${formatCount(artifact.size_bytes)} bytes`}
                        >
                          {formatBytes(artifact.size_bytes)}
                        </TableCell>
                        {advanced ? (
                          <>
                            <TableCell className="font-mono text-muted-foreground">
                              {artifact.media_type}
                            </TableCell>
                            <TableCell>
                              <MonoId value={artifact.sha256}>
                                {artifact.sha256.slice(0, 16)}
                              </MonoId>
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Plate>
            )}
          </TabsContent>

          <TabsContent value="log" className="py-4">
            <EventLog events={events} streamState={streamState} />
          </TabsContent>
        </Tabs>
      </PageBody>
    </Page>
  );
}
