"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import {
  SourceStateGlyph,
  SourceStatusList,
  summarizeSources,
} from "@/components/evidence/source-status-list";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { API_BASE_URL, apiRequest, isApiError } from "@/lib/api/client";
import type { Schema, SourceStatusState } from "@/lib/api/types";
import { site } from "@/lib/site";
import { useWorkspaceHover } from "@/lib/state/hover";
import { useAdvancedMode } from "@/lib/state/preferences";
import { describeRanges, useWorkspaceSelection } from "@/lib/state/selection";
import { mergeSourceReports, useShell } from "@/lib/state/shell";

/** Empty when something other than the OrphaFold API answered on that address. */
type HealthBody = Partial<Schema<"HealthResponse">>;

/** Any HTTP answer means the API process is up; only a network failure means it is not. */
function useApiHealth() {
  return useQuery({
    queryKey: ["api", "/health"],
    queryFn: async ({ signal }) => {
      try {
        return (await apiRequest<HealthBody>("/health", { signal })).data ?? {};
      } catch (error) {
        if (isApiError(error) && !error.isUnreachable) return {} as HealthBody;
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function Segment({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-full shrink-0 items-center gap-1.5 border-r border-border px-2.5",
        className,
      )}
      {...props}
    />
  );
}

function ApiSegment() {
  const health = useApiHealth();
  const state: SourceStatusState = health.isPending
    ? "not_configured"
    : health.isError
      ? "unavailable"
      : "ok";
  const text = health.isPending
    ? "checking"
    : health.isError
      ? "not reachable"
      : "connected";
  const skippedModules = Object.keys(health.data?.load_errors ?? {});
  return (
    <Segment title={`OrphaFold API at ${API_BASE_URL}`}>
      <SourceStateGlyph state={state} />
      <span className="text-muted-foreground">API</span>
      <span className={cn(health.isError ? "text-warning" : "text-foreground")}>
        {text}
      </span>
      {health.data?.version ? (
        <span className="text-subtle-foreground">{health.data.version}</span>
      ) : null}
      {health.data?.data_release ? (
        <span className="hidden text-subtle-foreground sm:inline">
          data {health.data.data_release}
        </span>
      ) : null}
      {health.data?.catalog && health.data.catalog !== "ready" ? (
        <span className="text-warning">catalog {health.data.catalog}</span>
      ) : null}
      {skippedModules.length > 0 ? (
        <span
          className="text-warning"
          title={skippedModules.join("\n")}
        >{`${skippedModules.length} API ${skippedModules.length === 1 ? "module" : "modules"} not loaded`}</span>
      ) : null}
    </Segment>
  );
}

/** Data release and source status slot. Pages feed it with `useReportSources`. */
function SourcesSegment() {
  const reports = useShell((state) => state.sourceReports);
  const sources = mergeSourceReports(reports);
  if (sources.length === 0) return null;
  const summary = summarizeSources(sources);
  const releases = sources
    .filter((status) => status.state === "ok" && status.release)
    .slice(0, 3);
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-full shrink-0 cursor-pointer items-center gap-2 border-r border-border px-2.5 hover:bg-accent aria-expanded:bg-active",
          summary.hasProblem && "text-warning",
        )}
        aria-label={`Sources: ${summary.text}. Show details.`}
      >
        <span
          className={summary.hasProblem ? "text-warning" : "text-foreground"}
        >
          <span className="sm:hidden">{summary.ratio} sources</span>
          <span className="hidden sm:inline">{summary.text}</span>
        </span>
        {releases.map((status) => (
          <span
            key={status.source}
            className="hidden text-muted-foreground xl:inline"
          >
            {status.name ?? status.source} {status.release}
          </span>
        ))}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-96 gap-0 p-0 font-sans"
      >
        <p className="border-b border-border-subtle px-3 py-2 text-xs font-medium">
          Sources for this view
        </p>
        <SourceStatusList sources={sources} />
      </PopoverContent>
    </Popover>
  );
}

function SelectionSegment() {
  const accession = useWorkspaceSelection((state) => state.accession);
  const ranges = useWorkspaceSelection((state) => state.ranges);
  const hover = useWorkspaceHover();
  if (!accession) return null;
  return (
    <Segment className="hidden sm:flex">
      <span className="text-muted-foreground">sel</span>
      <span className="text-foreground">
        {describeRanges(ranges) ?? "none"}
      </span>
      <span className="ml-1.5 text-muted-foreground">hover</span>
      <span className="tabular min-w-8 text-foreground">
        {hover?.position ?? "none"}
      </span>
      <span className="text-subtle-foreground">{accession} canonical</span>
    </Segment>
  );
}

/**
 * Simple mode's whole status line: one dot in the top bar. It turns into a warning mark when the
 * API or a source for this view is not answering, and opens the same detail the full line prints.
 */
export function ApiDot({ className }: { className?: string }) {
  const health = useApiHealth();
  const reports = useShell((state) => state.sourceReports);
  const sources = mergeSourceReports(reports);
  const summary = summarizeSources(sources);
  const apiState: SourceStatusState = health.isPending
    ? "not_configured"
    : health.isError
      ? "unavailable"
      : "ok";
  const state: SourceStatusState =
    apiState === "ok" && summary.hasProblem ? "unavailable" : apiState;
  const apiText = health.isPending
    ? "Checking the API"
    : health.isError
      ? "API not reachable"
      : "API connected";
  const label =
    state === "unavailable" && apiState === "ok"
      ? `${apiText}, ${summary.text}`
      : apiText;

  return (
    <Popover>
      <PopoverTrigger
        data-slot="api-dot"
        aria-label={`${label}. Show status.`}
        title={label}
        className={cn(
          "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent aria-expanded:bg-active",
          className,
        )}
      >
        <SourceStateGlyph state={state} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1.5rem)] gap-0 p-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border-subtle px-3 py-2">
          <span
            className={cn(
              "font-medium",
              health.isError ? "text-warning" : "text-foreground",
            )}
          >
            {apiText}
          </span>
          {health.data?.version ? (
            <span className="font-mono text-2xs text-muted-foreground">
              {health.data.version}
            </span>
          ) : null}
          {health.data?.data_release ? (
            <span className="font-mono text-2xs text-subtle-foreground">
              data {health.data.data_release}
            </span>
          ) : null}
        </div>
        {sources.length > 0 ? (
          <>
            <p
              className={cn(
                "px-3 pt-2 text-2xs",
                summary.hasProblem ? "text-warning" : "text-muted-foreground",
              )}
            >
              {summary.text}
            </p>
            <SourceStatusList sources={sources} />
          </>
        ) : null}
        <p className="border-t border-border-subtle px-3 py-2 text-2xs text-muted-foreground">
          {site.researchUseNotice}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * IDE-style status line: API state, source status and data releases, current selection,
 * the research-use notice and the two keys worth learning first. 24px, monospace.
 * Advanced only; simple mode keeps `ApiDot` in the top bar.
 */
export function StatusLine() {
  const advanced = useAdvancedMode();
  const setShortcutsOpen = useShell((state) => state.setShortcutsOpen);
  if (!advanced) return null;
  return (
    <footer className="z-40 flex h-6 shrink-0 items-center overflow-hidden border-t border-border bg-sunken font-mono text-[0.6875rem] leading-none whitespace-nowrap">
      <div className="flex h-full min-w-0 items-center overflow-hidden">
        <ApiSegment />
        <SourcesSegment />
        <SelectionSegment />
      </div>
      <div className="ml-auto flex h-full shrink-0 items-center">
        <span className="hidden px-2.5 font-sans text-2xs text-muted-foreground md:inline">
          {site.researchUseNotice}
        </span>
        <span className="px-2.5 font-sans text-2xs text-muted-foreground md:hidden">
          Research use only
        </span>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="hidden h-full cursor-pointer items-center border-l border-border px-2.5 hover:bg-accent md:flex"
        >
          <KeyHint keys="?" label="Shortcuts" />
        </button>
        <div className="hidden h-full items-center border-l border-border px-2.5 md:flex">
          <KeyHint keys="mod+k" label="Search" />
        </div>
      </div>
    </footer>
  );
}
