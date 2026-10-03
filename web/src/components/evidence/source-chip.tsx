import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "cn";

export interface SourceChipProps {
  /** database that owns the identifier: "UniProt", "HGNC", "ClinVar", "PDB" */
  source: string;
  /** the identifier exactly as the source writes it */
  id: string;
  /** link to the source record; renders the chip as an external link */
  href?: string | null;
  /** class marker placed before the identifier: an EvidenceGlyph or a StructureOriginTag */
  marker?: React.ReactNode;
  /** entity label placed before the source, e.g. "BTK" in the subject bar */
  label?: React.ReactNode;
  className?: string;
}

/**
 * A source identifier as a chip: source name in sans, identifier in monospace.
 * Square, ruled, never a pill. Clicking opens the source record.
 */
export function SourceChip({
  source,
  id,
  href,
  marker,
  label,
  className,
}: SourceChipProps) {
  const body = (
    <>
      {label ? (
        <span className="pr-1.5 font-medium text-foreground">{label}</span>
      ) : null}
      <span className="text-muted-foreground">{source}</span>
      <span className="mx-1.5 h-2.5 w-px bg-border" aria-hidden />
      {marker ? <span className="mr-1 inline-flex">{marker}</span> : null}
      <span
        className="font-mono tracking-[-0.01em] text-foreground"
        translate="no"
      >
        {id}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex h-5 shrink-0 items-center rounded-xs border border-border bg-background px-1.5 text-2xs whitespace-nowrap",
    className,
  );
  if (!href) {
    return (
      <span data-slot="source-chip" className={classes}>
        {body}
      </span>
    );
  }
  return (
    <a
      data-slot="source-chip"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(classes, "hover:border-border-strong hover:bg-accent")}
    >
      {body}
      <ArrowUpRightIcon
        className="ml-1 size-2.5 text-subtle-foreground"
        aria-hidden
      />
      <span className="sr-only"> (opens the {source} record in a new tab)</span>
    </a>
  );
}
