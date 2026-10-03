"use client";

import { cn } from "cn";
import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/format";
import type { JobStage, JobStatus } from "@/lib/state/jobs";

const STATUS_META: Record<
  string,
  { glyph: string; label: string; className: string }
> = {
  queued: { glyph: "○", label: "Queued", className: "text-muted-foreground" },
  pending: {
    glyph: "○",
    label: "Pending",
    className: "text-subtle-foreground",
  },
  running: { glyph: "◐", label: "Running", className: "text-foreground" },
  succeeded: { glyph: "●", label: "Succeeded", className: "text-foreground" },
  done: { glyph: "●", label: "Done", className: "text-foreground" },
  failed: { glyph: "✕", label: "Failed", className: "text-destructive" },
  cancelled: {
    glyph: "–",
    label: "Cancelled",
    className: "text-muted-foreground",
  },
  skipped: {
    glyph: "–",
    label: "Skipped",
    className: "text-subtle-foreground",
  },
};

/** Job or stage status exactly as the API reports it. */
export function JobStatusTag({
  status,
  className,
}: {
  status: JobStatus | string;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? {
    glyph: "·",
    label: status,
    className: "text-muted-foreground",
  };
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[0.625rem]">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}

/** Re-renders once a second while `active`, for elapsed clocks. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return now;
}

/** Seconds between two API timestamps; an open interval runs to `now`. */
export function elapsedSeconds(
  startedAt: string | null,
  completedAt: string | null,
  now: number,
): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}

export function formatElapsed(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return formatDuration(seconds);
}

/** "2026-10-03 19:58:18 UTC": stage timings need seconds. */
export function formatClock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** Progress is printed only when the handler reported measured counts. */
export function stageProgressText(stage: JobStage): string | null {
  const progress = stage.progress;
  if (!progress) return null;
  const unit = progress.unit ? ` ${progress.unit}` : "";
  return progress.total === null
    ? `${progress.completed}${unit}`
    : `${progress.completed} / ${progress.total}${unit}`;
}

export const jobKindLabel = (kind: string) => kind.replaceAll("_", " ");
