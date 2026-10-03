import { cn } from "cn";

import type { SourceStatus, SourceStatusState } from "@/lib/api/types";
import { formatDate } from "@/lib/format";

interface StateMeta {
  label: string;
  /** shown first in summaries */
  problem: boolean;
  textClass: string;
}

export const SOURCE_STATE_META: Record<SourceStatusState, StateMeta> = {
  ok: { label: "answered", problem: false, textClass: "text-foreground" },
  empty: {
    label: "no record",
    problem: false,
    textClass: "text-muted-foreground",
  },
  unavailable: {
    label: "temporarily unavailable",
    problem: true,
    textClass: "text-warning",
  },
  disabled_by_license: {
    label: "disabled by licence setting",
    problem: false,
    textClass: "text-subtle-foreground",
  },
  not_configured: {
    label: "not configured",
    problem: false,
    textClass: "text-subtle-foreground",
  },
};

/** State is carried by shape as well as text: filled, hollow, triangle, barred, dash. */
export function SourceStateGlyph({
  state,
  className,
}: {
  state: SourceStatusState;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 10 10",
    "aria-hidden": true,
    className: cn(
      "size-2.5 shrink-0",
      SOURCE_STATE_META[state].textClass,
      className,
    ),
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.2,
  } as const;
  switch (state) {
    case "ok":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "empty":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3" />
        </svg>
      );
    case "unavailable":
      return (
        <svg {...common}>
          <path d="M5 1.6 8.8 8.4H1.2z" strokeLinejoin="round" />
        </svg>
      );
    case "disabled_by_license":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3" />
          <path d="M2.9 7.1 7.1 2.9" />
        </svg>
      );
    case "not_configured":
      return (
        <svg {...common}>
          <path d="M2.5 5h5" />
        </svg>
      );
  }
}

const sourceName = (status: SourceStatus) => status.name ?? status.source;

export interface SourceStatusListProps {
  sources: SourceStatus[];
  /** hide sources that answered normally and show only the exceptions */
  exceptionsOnly?: boolean;
  className?: string;
}

/**
 * Which sources answered, which had no record and which are temporarily unavailable.
 * A page renders with whatever answered; this list says what is missing and why.
 */
export function SourceStatusList({
  sources,
  exceptionsOnly = false,
  className,
}: SourceStatusListProps) {
  const rows = exceptionsOnly
    ? sources.filter((status) => status.state !== "ok")
    : sources;
  if (rows.length === 0) {
    return (
      <p className={cn("px-3 py-2 text-xs text-muted-foreground", className)}>
        {sources.length === 0
          ? "No source status reported for this view."
          : "Every source answered."}
      </p>
    );
  }
  return (
    <ul className={cn("flex flex-col text-xs", className)}>
      {rows.map((status) => {
        const meta = SOURCE_STATE_META[status.state];
        return (
          <li
            key={status.source}
            className="grid min-h-7 grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
          >
            <SourceStateGlyph state={status.state} className="self-center" />
            <div className="min-w-0">
              <span className="font-medium text-foreground">
                {sourceName(status)}
              </span>
              <span
                className={cn(
                  "ml-2",
                  status.state === "ok"
                    ? "text-muted-foreground"
                    : meta.textClass,
                )}
              >
                {meta.label}
              </span>
              {status.message ? (
                <span className="ml-1 text-muted-foreground">
                  ({status.message})
                </span>
              ) : null}
              {status.stale ? (
                <span className="ml-2 text-warning">stale copy</span>
              ) : status.from_cache ? (
                <span className="ml-2 text-subtle-foreground">cached</span>
              ) : null}
            </div>
            <div className="tabular flex items-baseline gap-2 font-mono text-2xs text-muted-foreground">
              {status.release ? <span>{status.release}</span> : null}
              {formatDate(status.retrieved_at) ? (
                <span className="text-subtle-foreground">
                  {formatDate(status.retrieved_at)}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "6 sources, 1 unavailable": the one-line form used in the status line and zone footers. */
export function summarizeSources(sources: SourceStatus[]): {
  text: string;
  /** "5/6", for narrow layouts */
  ratio: string;
  hasProblem: boolean;
} {
  if (sources.length === 0)
    return { text: "No sources reported", ratio: "0/0", hasProblem: false };
  const unavailable = sources.filter(
    (status) => status.state === "unavailable",
  ).length;
  const answered = sources.filter(
    (status) => status.state === "ok" || status.state === "empty",
  ).length;
  const ratio = `${answered}/${sources.length}`;
  const parts = [`${ratio} sources answered`];
  if (unavailable > 0) parts.push(`${unavailable} unavailable`);
  return { text: parts.join(", "), ratio, hasProblem: unavailable > 0 };
}
