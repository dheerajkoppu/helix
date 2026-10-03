"use client";

import { cn } from "cn";

import { EmptyState } from "@/components/states/empty-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE_URL, isApiError } from "@/lib/api/client";

export interface QueryErrorStateProps {
  error: unknown;
  /** what was being loaded, e.g. "variants for BTK" */
  subject: string;
  onRetry?: () => void;
  retrying?: boolean;
  size?: "zone" | "inline";
}

/** Maps a failed API call onto the right state: unreachable API, missing record or source failure. */
export function QueryErrorState({
  error,
  subject,
  onRetry,
  retrying,
  size = "zone",
}: QueryErrorStateProps) {
  if (isApiError(error) && error.isUnreachable) {
    return (
      <SourceUnavailable
        source="The Helix API"
        message={`no answer from ${API_BASE_URL}`}
        onRetry={onRetry}
        retrying={retrying}
        size={size}
      />
    );
  }
  if (isApiError(error) && error.isNotFound) {
    return (
      <EmptyState
        size={size}
        title={`No record for ${subject}`}
        description={error.message}
      />
    );
  }
  const message = isApiError(error)
    ? `HTTP ${error.status} while loading ${subject}: ${error.message}`
    : `unexpected error while loading ${subject}`;
  return (
    <SourceUnavailable source="The Helix API" message={message} onRetry={onRetry} retrying={retrying} size={size} />
  );
}

/** Placeholder rows that match the 28px table rhythm. Show after a 200ms delay, never animate values. */
export function RowsSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex h-7 items-center gap-3 border-b border-border-subtle px-3"
        >
          <Skeleton className="h-2.5 w-10 rounded-xs" />
          <Skeleton
            className="h-2.5 rounded-xs"
            style={{ width: `${38 + ((index * 17) % 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
