import { cn } from "cn";

export interface EmptyStateProps {
  /** what is absent, stated plainly: "No experimental structure" */
  title: React.ReactNode;
  /** what was checked and what the reader can do next */
  description?: React.ReactNode;
  /** sources that were searched and returned nothing, e.g. ["RCSB PDB", "PDBe"] */
  searched?: string[];
  /** next steps: buttons or links. An empty state always offers one when one exists. */
  actions?: React.ReactNode;
  /** "zone" centres in a panel; "inline" sits in a row or table body */
  size?: "zone" | "inline";
  className?: string;
}

/**
 * States an absence and offers the next step. No illustration, no slogan.
 * "Nothing found" is a result: say which sources were searched.
 */
export function EmptyState({
  title,
  description,
  searched,
  actions,
  size = "zone",
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex text-xs",
        size === "zone"
          ? "h-full min-h-32 items-center justify-center p-6"
          : "px-3 py-3",
        className,
      )}
    >
      <div
        className={cn("flex max-w-sm gap-3", size === "inline" && "max-w-none")}
      >
        <span
          aria-hidden
          className="mt-0.5 size-3 shrink-0 rounded-xs border border-dashed border-border-strong"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground">{title}</p>
          {description ? (
            <p className="text-muted-foreground">{description}</p>
          ) : null}
          {searched && searched.length > 0 ? (
            <p className="text-subtle-foreground">
              Searched:{" "}
              <span className="text-muted-foreground">
                {searched.join(", ")}
              </span>
            </p>
          ) : null}
          {actions ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
