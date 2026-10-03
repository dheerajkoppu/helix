import { cn } from "cn";

export interface SectionHeaderProps {
  title: React.ReactNode;
  /** printed in monospace after the title; pass the real count or omit */
  count?: number | null;
  /** one short line under the title */
  description?: React.ReactNode;
  /** right-aligned controls */
  actions?: React.ReactNode;
  /** heading level for the document outline; default h3 */
  as?: "h2" | "h3" | "h4";
  className?: string;
}

/**
 * Section header inside a zone or page: 28px rule-topped row with an axis tick, title, count and actions.
 * Sections are separated by this header, never by a card.
 */
export function SectionHeader({
  title,
  count,
  description,
  actions,
  as: Heading = "h3",
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("border-b border-border-subtle", className)}>
      <div className="flex h-7 items-center gap-2 px-3">
        <span aria-hidden className="h-2.5 w-px shrink-0 bg-foreground" />
        <Heading className="text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
          {title}
        </Heading>
        {count !== undefined && count !== null ? (
          <span className="tabular font-mono text-2xs text-subtle-foreground">
            {count}
          </span>
        ) : null}
        {actions ? (
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
