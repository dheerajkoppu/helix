"use client";

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

export interface SourceUnavailableProps {
  /** display name of the source that did not answer, e.g. "RCSB PDB" */
  source: string;
  /** the upstream's own failure text: "HTTP 503", "timeout after 30 s" */
  message?: string | null;
  /** ISO date of the cached copy being shown instead, when there is one */
  cachedAt?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  size?: "zone" | "inline";
  className?: string;
}

/**
 * One source failed; the rest of the page keeps working. Row-level by default.
 * A 404 that means "no record" is an EmptyState, not this.
 */
export function SourceUnavailable({
  source,
  message,
  cachedAt,
  onRetry,
  retrying = false,
  size = "inline",
  className,
}: SourceUnavailableProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex text-xs",
        size === "zone"
          ? "h-full min-h-32 items-center justify-center p-6"
          : "px-3 py-2",
        className,
      )}
    >
      <div className="flex max-w-md items-start gap-2.5">
        <TriangleAlertIcon
          className="mt-px size-3.5 shrink-0 text-warning"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-foreground">
            <span className="font-medium">{source}</span> is temporarily
            unavailable
            {message ? (
              <span className="text-muted-foreground"> ({message})</span>
            ) : null}
            .
          </p>
          <p className="text-muted-foreground">
            {cachedAt
              ? `Showing the cached copy from ${cachedAt}. `
              : "Nothing from this source is shown. "}
            Other sources are unaffected.
          </p>
          {onRetry ? (
            <div className="mt-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retrying}
              >
                <RotateCwIcon
                  data-icon="inline-start"
                  className={cn(retrying && "animate-spin")}
                  aria-hidden
                />
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
