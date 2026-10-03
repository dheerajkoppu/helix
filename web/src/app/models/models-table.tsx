"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState, useSyncExternalStore } from "react";

import { Unknown } from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  elapsedSeconds,
  formatClock,
  jobKindLabel,
} from "@/components/jobs/job-status";
import { JobWatcher, RunJobButton } from "@/components/jobs/run-job";
import {
  ModelResultStrip,
  type ModelResultMetric,
} from "@/components/science/model-result-strip";
import { PageSection, Plate } from "@/components/shell/page";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiQuery } from "@/lib/api/query";
import { routes } from "@/lib/ids";
import type {
  JobOut,
  JobPage,
  ModelsOut,
  ProviderCitation,
  ProviderInfo,
} from "@/lib/state/jobs";
import { useAdvancedMode } from "@/lib/state/preferences";

const EXECUTION_MODE: Record<string, string> = {
  retrieval: "lookup of an existing result, no inference",
  remote_api: "inference through a remote API",
  local_cli: "inference by a local command",
  gpu_worker: "inference on a GPU worker",
};

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const TASK: Record<string, string> = {
  structure_predictor: "Structure prediction",
  variant_effect: "Variant effect",
  pocket: "Pocket detection",
  literature: "Literature search",
};

const RUNS_AS: Record<string, string> = {
  retrieval: "Lookup",
  remote_api: "Remote API",
  local_cli: "Local command",
  gpu_worker: "GPU worker",
};

function taskOf(provider: ProviderInfo): string {
  if (provider.kind === "structure_predictor" && !provider.performs_inference)
    return "Structure lookup";
  return TASK[provider.kind] ?? provider.kind.replaceAll("_", " ");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The first confidence block in a job result, in document order. */
function findConfidence(
  value: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!isRecord(value) || depth > 3) return null;
  if (isRecord(value.confidence)) return value.confidence;
  for (const child of Object.values(value)) {
    const found = findConfidence(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Numbers a finished job reported, as the job result states them. */
function runMetrics(job: JobOut): ModelResultMetric[] {
  const confidence = findConfidence(job.result);
  const summary = isRecord(job.result?.summary) ? job.result.summary : null;
  const ptm = numeric(confidence?.ptm);
  const rmsd = numeric(summary?.rmsd_ca_confident);
  return [
    ...(confidence
      ? [
          {
            label: "Mean pLDDT",
            value: numeric(confidence.plddt_mean),
            explainer: "plddt",
            missingReason: "Not reported",
          },
        ]
      : []),
    ...(ptm !== null ? [{ label: "pTM", value: ptm, explainer: "ptm" }] : []),
    ...(rmsd !== null
      ? [{ label: "Confident Cα RMSD", value: rmsd, unit: "Å" }]
      : []),
  ];
}

function RunStrip({
  provider,
  job,
  frame,
}: {
  provider: ProviderInfo;
  job: JobOut | null;
  frame: "box" | "none";
}) {
  return (
    <ModelResultStrip
      frame={frame}
      model={provider.model_name ?? provider.name}
      version={provider.model_version}
      origin={provider.structure_origin}
      metrics={job ? runMetrics(job) : []}
      runtime={
        job
          ? elapsedSeconds(
              job.started_at,
              job.completed_at,
              Date.parse(job.started_at ?? ""),
            )
          : null
      }
      href={job ? routes.job(job.id) : null}
      hrefLabel="Open run"
    />
  );
}

function citationHref(citation: ProviderCitation): string | null {
  if (citation.url) return citation.url;
  if (citation.doi) return `https://doi.org/${citation.doi}`;
  if (citation.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`;
  return null;
}

function citationText(citation: ProviderCitation): string {
  return (
    citation.text ??
    citation.title ??
    citation.doi ??
    citation.pmid ??
    "Untitled reference"
  );
}

function ProviderDetail({
  provider,
  lastRun,
}: {
  provider: ProviderInfo;
  lastRun: JobOut | null;
}) {
  return (
    <div className="grid gap-x-8 gap-y-3 py-2 whitespace-normal lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-1 lg:col-span-2">
        <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          {lastRun ? "Latest run here" : "No run here yet"}
        </p>
        <RunStrip provider={provider} job={lastRun} frame="none" />
        <p className="text-muted-foreground">
          {provider.availability.reason ?? "No reason reported."}
          {provider.availability.checked_at ? (
            <span className="ml-2 font-mono text-2xs text-subtle-foreground">
              checked {formatClock(provider.availability.checked_at)}
            </span>
          ) : null}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          Limits
        </p>
        {provider.limitations.length > 0 ? (
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 whitespace-normal text-muted-foreground">
            {provider.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">
            None recorded by the adapter.
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Citation
          </p>
          {provider.citation.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {provider.citation.map((citation) => {
                const href = citationHref(citation);
                const label = citationText(citation);
                return (
                  <li key={label}>
                    {href ? (
                      <ExternalLink href={href}>{label}</ExternalLink>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Unknown reason="No citation recorded" />
          )}
        </div>
        {provider.attribution ? (
          <div>
            <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
              Attribution
            </p>
            <p className="mt-1 text-muted-foreground">{provider.attribution}</p>
          </div>
        ) : null}
        <div>
          <p className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Requirements
          </p>
          <p className="mt-1 text-muted-foreground">
            {provider.requires_api_key ? "API key required" : "No API key"}
            {" · "}
            {provider.requires_gpu ? "GPU required" : "No GPU"}
            {provider.max_residues !== null
              ? ` · up to ${provider.max_residues} residues`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {provider.job_kinds.map((kind) => (
            <RunJobButton
              key={kind}
              kind={kind}
              params={{ provider: provider.id }}
              label={`Run ${jobKindLabel(kind)}`}
              size="sm"
            />
          ))}
          {provider.homepage ? (
            <ExternalLink href={provider.homepage}>Homepage</ExternalLink>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ModelsTable() {
  const advanced = useAdvancedMode();
  const models = useQuery({
    ...apiQuery<ModelsOut>("/models"),
    staleTime: 30 * 1000,
  });
  const runs = useQuery(
    apiQuery<JobPage>("/jobs", { status: "succeeded", limit: 50 }),
  );
  const providers = models.data?.data.providers ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const availableCount = providers.filter(
    (provider) => provider.availability.available,
  ).length;

  // A link from a job opens its provider: /models#esm_atlas
  const hashTarget = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );

  const succeeded = runs.data?.data.items ?? [];
  const lastRunOf = (providerId: string) =>
    succeeded.find((job) => job.provider_id === providerId) ?? null;
  const latest = succeeded.find((job) => runMetrics(job).length > 0) ?? null;
  const latestProvider = latest
    ? (providers.find((provider) => provider.id === latest.provider_id) ?? null)
    : null;
  const columnCount = advanced ? 8 : 5;

  return (
    <>
      {latest && latestProvider ? (
        <PageSection title="Latest result">
          <RunStrip provider={latestProvider} job={latest} frame="box" />
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {latest.title ?? latest.id}
          </p>
        </PageSection>
      ) : null}
      <PageSection
        title="Models"
        count={models.data ? providers.length : null}
        actions={
          <>
            {models.data ? (
              <span className="text-xs text-muted-foreground">
                {availableCount} of {providers.length} available
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={models.isFetching}
              onClick={() => void models.refetch()}
            >
              Check again
            </Button>
          </>
        }
      >
        <JobWatcher />
        {models.error ? (
          <Plate className="h-48">
            <QueryErrorState
              error={models.error}
              subject="model providers"
              onRetry={() => void models.refetch()}
              retrying={models.isFetching}
            />
          </Plate>
        ) : models.isPending ? (
          <RowsSkeleton rows={6} />
        ) : (
          <Plate className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Task</TableHead>
                  {advanced ? (
                    <>
                      <TableHead>Capabilities</TableHead>
                      <TableHead>Runs as</TableHead>
                      <TableHead>License</TableHead>
                    </>
                  ) : null}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => {
                  const open = expanded[provider.id] ?? provider.id === hashTarget;
                  return (
                    <Fragment key={provider.id}>
                      <TableRow id={provider.id} className="scroll-mt-12">
                        <TableCell className="py-2 text-sm whitespace-normal">
                          <span className="font-medium">
                            {provider.model_name ?? provider.name}
                          </span>
                          {provider.structure_origin ? (
                            <StructureOriginTag
                              origin={provider.structure_origin}
                              size="compact"
                              className="ml-2 align-middle"
                            />
                          ) : null}
                          {advanced ||
                          (provider.model_name &&
                            provider.model_name !== provider.name) ? (
                            <span className="block text-xs text-muted-foreground">
                              {provider.model_name ? provider.name : null}
                              {advanced ? (
                                <span className="font-mono">
                                  {provider.model_name ? " · " : ""}
                                  {provider.id}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono whitespace-normal">
                          {provider.model_version ?? <Unknown />}
                        </TableCell>
                        <TableCell>{taskOf(provider)}</TableCell>
                        {advanced ? (
                          <>
                            <TableCell className="max-w-40 font-mono whitespace-normal text-muted-foreground">
                              {provider.capabilities.join(", ")}
                            </TableCell>
                            <TableCell
                              title={EXECUTION_MODE[provider.execution_mode]}
                            >
                              {RUNS_AS[provider.execution_mode] ??
                                provider.execution_mode}
                            </TableCell>
                            <TableCell className="font-mono">
                              {provider.license ? (
                                provider.license_url ? (
                                  <ExternalLink href={provider.license_url}>
                                    {provider.license}
                                  </ExternalLink>
                                ) : (
                                  provider.license
                                )
                              ) : (
                                <Unknown />
                              )}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell title={provider.availability.reason ?? ""}>
                          <span
                            className={
                              provider.availability.available
                                ? "inline-flex items-center gap-1.5"
                                : "inline-flex items-center gap-1.5 text-muted-foreground"
                            }
                          >
                            <span
                              aria-hidden
                              className={
                                provider.availability.available
                                  ? "size-2 rounded-full border border-foreground bg-foreground"
                                  : "size-2 rounded-full border border-border-strong"
                              }
                            />
                            {provider.availability.available
                              ? "Available"
                              : "Unavailable"}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} details of ${provider.name}`}
                            onClick={() =>
                              setExpanded((current) => ({
                                ...current,
                                [provider.id]: !open,
                              }))
                            }
                          >
                            {open ? "Hide" : "Details"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={columnCount} className="bg-sunken">
                            <ProviderDetail
                              provider={provider}
                              lastRun={lastRunOf(provider.id)}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Plate>
        )}
      </PageSection>
    </>
  );
}
