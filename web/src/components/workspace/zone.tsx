"use client";

import { cn } from "cn";

import { useAdvancedMode } from "@/lib/state/preferences";

export type ZoneName = "ledger" | "instrument" | "inspector";

const ZONE_LABEL: Record<ZoneName, string> = {
  ledger: "Ledger",
  instrument: "Instrument",
  inspector: "Inspector",
};

export interface ZoneProps {
  /** which of the three work areas this is */
  zone: ZoneName;
  /** what the zone holds right now: "Structures", "3D", "Asp165" */
  title: React.ReactNode;
  /** real count, set in monospace after the title */
  count?: number | null;
  /** inline detail after the title: an origin tag, an accession, a readout */
  detail?: React.ReactNode;
  /** right-aligned header controls: icon buttons at size "icon-sm", toggle groups */
  actions?: React.ReactNode;
  /** a second 32px toolbar row under the header: filters, colour mode, representation */
  toolbar?: React.ReactNode;
  /** 24px footer: key hints, legends, captions */
  footer?: React.ReactNode;
  /** false for content that manages its own scrolling: a DataTable, the 3D viewport */
  scroll?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * One of the three work areas. A 36px header names the zone and its content; the body fills the rest.
 * Zones are divided by 1px rules and share one surface. They are never cards.
 */
export function Zone({
  zone,
  title,
  count,
  detail,
  actions,
  toolbar,
  footer,
  scroll = true,
  className,
  children,
}: ZoneProps) {
  const advanced = useAdvancedMode();
  return (
    <section
      data-zone={zone}
      aria-label={ZONE_LABEL[zone]}
      className={cn(
        "flex size-full min-h-0 min-w-0 flex-col bg-background",
        className,
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-3",
          advanced ? "h-9 border-border" : "h-10 border-border-subtle",
        )}
      >
        {advanced ? (
          <span className="text-[0.625rem] font-medium tracking-[0.08em] text-subtle-foreground uppercase">
            {ZONE_LABEL[zone]}
          </span>
        ) : null}
        <h2
          className={cn(
            "max-w-[60%] shrink-0 truncate font-medium text-foreground",
            advanced ? "text-xs" : "text-sm",
          )}
        >
          {title}
        </h2>
        {count !== undefined && count !== null ? (
          <span className="tabular font-mono text-2xs text-subtle-foreground">
            {count}
          </span>
        ) : null}
        {detail ? (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {detail}
          </div>
        ) : null}
        {actions ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {actions}
          </div>
        ) : null}
      </header>
      {toolbar ? (
        <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border-subtle px-3 scroll-thin">
          {toolbar}
        </div>
      ) : null}
      <div
        className={cn(
          "relative min-h-0 flex-1",
          scroll ? "scroll-thin overflow-auto" : "overflow-hidden",
        )}
      >
        {children}
      </div>
      {footer ? (
        <footer className="no-scrollbar flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-t border-border-subtle bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
