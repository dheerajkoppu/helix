import { isApiError } from "@/lib/api/client";
import type { SourceStatus, SourceStatusState } from "@/lib/api/types";

const SEVERITY: Record<SourceStatusState, number> = {
  ok: 0,
  empty: 1,
  disabled_by_license: 2,
  not_configured: 3,
  unavailable: 4,
};

/**
 * One row per source across several responses, for `useReportSources`. When two responses
 * disagree about a source the less healthy row is kept, so a failure is never hidden.
 */
export function mergeSources(
  ...lists: Array<readonly SourceStatus[] | null | undefined>
): SourceStatus[] {
  const merged = new Map<string, SourceStatus>();
  for (const list of lists) {
    for (const row of list ?? []) {
      const current = merged.get(row.source);
      if (!current || SEVERITY[row.state] > SEVERITY[current.state])
        merged.set(row.source, row);
    }
  }
  return [...merged.values()];
}

export const findSource = (
  sources: readonly SourceStatus[] | null | undefined,
  ...ids: string[]
): SourceStatus | undefined =>
  (sources ?? []).find((row) => ids.includes(row.source));

/** A status row for a request that failed before any source could answer. */
export function failedSource(
  source: string,
  name: string,
  error: unknown,
): SourceStatus {
  return {
    source,
    name,
    state: "unavailable",
    message: isApiError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : "The OrphaFold API did not answer.",
  };
}
