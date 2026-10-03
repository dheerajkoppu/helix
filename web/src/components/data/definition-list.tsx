import { cn } from "cn";

/** Printed wherever a value has no source. Never substitute a guess. */
export function Unknown({
  reason = "Unknown",
  className,
}: {
  reason?: "Unknown" | "No source found" | string;
  className?: string;
}) {
  return (
    <span className={cn("text-subtle-foreground", className)}>{reason}</span>
  );
}

export interface DefinitionListProps extends React.ComponentProps<"dl"> {
  /** width of the term column; default 7.5rem */
  termWidth?: string;
}

/** Label and value pairs as ruled rows. Use it instead of a card of stats. */
export function DefinitionList({
  termWidth = "7.5rem",
  className,
  style,
  ...props
}: DefinitionListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[var(--term-width)_minmax(0,1fr)] text-xs",
        className,
      )}
      style={{ "--term-width": termWidth, ...style } as React.CSSProperties}
      {...props}
    />
  );
}

export interface DefinitionRowProps {
  term: React.ReactNode;
  /** the value; null or undefined prints "Unknown" */
  children?: React.ReactNode;
  /** set the value in monospace (identifiers, coordinates, numbers) */
  mono?: boolean;
  className?: string;
}

export function DefinitionRow({
  term,
  children,
  mono = false,
  className,
}: DefinitionRowProps) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div
      className={cn(
        "col-span-2 grid min-h-7 grid-cols-subgrid items-baseline border-b border-border-subtle px-3 py-1.5 last:border-b-0",
        className,
      )}
    >
      <dt className="pr-3 text-muted-foreground">{term}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "tabular font-mono",
        )}
      >
        {empty ? <Unknown /> : children}
      </dd>
    </div>
  );
}
