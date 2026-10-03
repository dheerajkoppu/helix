"use client";

import { useEffect } from "react";
import { create } from "zustand";

import type { SourceStatus } from "@/lib/api/types";

interface ShellState {
  /** command palette */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  /** keyboard shortcut sheet */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** per-source status reported by whatever the current page loaded, keyed by reporter */
  sourceReports: Record<string, SourceStatus[]>;
  reportSources: (reporter: string, sources: SourceStatus[]) => void;
  clearSources: (reporter: string) => void;
  /** running and queued job counts, published by the jobs feature; null until it reports */
  jobs: { running: number; queued: number } | null;
  setJobs: (jobs: { running: number; queued: number } | null) => void;
}

export const useShell = create<ShellState>()((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  sourceReports: {},
  reportSources: (reporter, sources) =>
    set((state) => ({
      sourceReports: { ...state.sourceReports, [reporter]: sources },
    })),
  clearSources: (reporter) =>
    set((state) => {
      const remaining = { ...state.sourceReports };
      delete remaining[reporter];
      return { sourceReports: remaining };
    }),
  jobs: null,
  setJobs: (jobs) => set({ jobs }),
}));

const STATE_SEVERITY: Record<SourceStatus["state"], number> = {
  unavailable: 4,
  not_configured: 3,
  disabled_by_license: 2,
  empty: 1,
  ok: 0,
};

/** One row per source. When reporters disagree, the least healthy answer is kept. */
export function mergeSourceReports(
  reports: Record<string, SourceStatus[]>,
): SourceStatus[] {
  const merged = new Map<string, SourceStatus>();
  for (const sources of Object.values(reports)) {
    for (const status of sources) {
      const existing = merged.get(status.source);
      if (
        !existing ||
        STATE_SEVERITY[status.state] > STATE_SEVERITY[existing.state]
      )
        merged.set(status.source, status);
    }
  }
  return [...merged.values()].sort((left, right) =>
    (left.name ?? left.source).localeCompare(right.name ?? right.source),
  );
}

/**
 * Publishes the per-source status of a response to the status line for as long as the calling
 * component is mounted. `reporter` is any stable name for the caller, e.g. "gene-page".
 */
export function useReportSources(
  reporter: string,
  sources: SourceStatus[] | undefined,
): void {
  const reportSources = useShell((state) => state.reportSources);
  const clearSources = useShell((state) => state.clearSources);
  useEffect(() => {
    if (!sources) return;
    reportSources(reporter, sources);
    return () => clearSources(reporter);
  }, [reporter, sources, reportSources, clearSources]);
}
