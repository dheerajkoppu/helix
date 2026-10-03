import { cn } from "cn";

/**
 * Frame for every route outside the workspace: Explore, Projects, Jobs, Models, About, Docs,
 * Compound, Project. A ruled header band over a left-aligned column. No cards.
 */
export function Page({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page"
      className={cn("flex min-h-full flex-col", className)}
      {...props}
    />
  );
}

export interface PageHeaderProps {
  /** entity type or area in small caps: "Compound", "Job", "Project" */
  kind?: React.ReactNode;
  title: React.ReactNode;
  /** identifier or count set in monospace beside the title */
  id?: React.ReactNode;
  /** one or two sentences; no marketing copy */
  description?: React.ReactNode;
  /** source chips, origin tags, status */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  kind,
  title,
  id,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("border-b border-border", className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-6 pb-4 md:px-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          {kind ? (
            <p className="flex items-center gap-2 text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
              <span aria-hidden className="h-2.5 w-px bg-foreground" />
              {kind}
            </p>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.015em] text-foreground">
              {title}
            </h1>
            {id ? (
              <span className="font-mono text-sm text-muted-foreground">
                {id}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="max-w-[68ch] text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
          {meta ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** Page column. `flush` drops the horizontal padding for full-bleed tables. */
export function PageBody({
  className,
  flush = false,
  ...props
}: React.ComponentProps<"div"> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl flex-1",
        !flush && "px-4 md:px-6",
        className,
      )}
      {...props}
    />
  );
}

export interface PageSectionProps extends Omit<
  React.ComponentProps<"section">,
  "title"
> {
  title: React.ReactNode;
  /** real count, in monospace */
  count?: number | null;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** A titled block on a page: rule, title row, content. Sections stack; they never sit in a grid of cards. */
export function PageSection({
  title,
  count,
  description,
  actions,
  className,
  children,
  ...props
}: PageSectionProps) {
  return (
    <section
      className={cn(
        "border-b border-border-subtle py-5 last:border-b-0",
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          {count !== undefined && count !== null ? (
            <span className="tabular font-mono text-xs text-subtle-foreground">
              {count}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="mb-3 max-w-[68ch] text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/** A ruled box for one self-contained object: a table, a plot, a state. Square corners, no shadow. */
export function Plate({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="plate"
      className={cn("border border-border bg-background", className)}
      {...props}
    />
  );
}
