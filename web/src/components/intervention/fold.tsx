"use client";

import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "cn";

export interface FoldProps {
  title: React.ReactNode;
  /** real count, in monospace after the title */
  count?: number | null;
  /** shown at the right end of the row, outside the toggle */
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  /** "section": a ruled row for a zone. "quiet": a small inline toggle for detail under a block. */
  tone?: "section" | "quiet";
  className?: string;
  children: React.ReactNode;
}

/** A section closed to its title and count until opened. The content is not mounted while closed. */
export function Fold({
  title,
  count,
  trailing,
  defaultOpen = false,
  tone = "section",
  className,
  children,
}: FoldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div
      data-slot="fold"
      className={cn(
        tone === "section" && "border-b border-border-subtle",
        className,
      )}
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
            tone === "section"
              ? "h-9 text-sm text-foreground"
              : "h-7 text-xs text-muted-foreground hover:text-foreground",
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate">{title}</span>
          {count !== undefined && count !== null ? (
            <span className="tabular ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {count}
            </span>
          ) : null}
        </button>
        {trailing ? <div className="shrink-0 pr-3">{trailing}</div> : null}
      </div>
      {open ? <div id={panelId}>{children}</div> : null}
    </div>
  );
}

/** Detail that Advanced prints in place and the simple view keeps behind one toggle. */
export function Detail({
  advanced,
  title = "Details",
  children,
}: {
  advanced: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (advanced) return <>{children}</>;
  return (
    <Fold title={title} tone="quiet">
      {children}
    </Fold>
  );
}
