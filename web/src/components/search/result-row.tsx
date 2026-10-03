import { ArrowUpRightIcon } from "lucide-react";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { EntityTypeTag } from "@/components/search/entity-type";
import type { SearchResult } from "@/components/search/types";

/** cmdk item value of a result. Lower case, because cmdk compares values case-insensitively. */
export const resultValue = (result: SearchResult) =>
  `${result.type}:${result.id}`.toLowerCase();

/** Opens the entity's page, or its record at the owning database when it has no page here. */
export function openSearchResult(
  result: SearchResult,
  navigate: (href: string) => void,
): void {
  if (result.href) navigate(result.href);
  else openAtSource(result);
}

export function openAtSource(result: SearchResult): void {
  if (result.external_url)
    window.open(result.external_url, "_blank", "noopener,noreferrer");
}

const SHOWS_CATALOG_SCOPE = new Set(["gene", "protein", "disease", "variant"]);

/**
 * One typed result: type marker, label, what it is, its source ID in monospace and why it matched.
 * The children of a `CommandItem`.
 */
export function SearchResultRow({
  result,
  size = "compact",
}: {
  result: SearchResult;
  size?: "compact" | "roomy";
}) {
  const primaryId = result.ids[0]?.id ?? null;
  const labelIsId = primaryId !== null && primaryId === result.label;
  return (
    <>
      <EntityTypeTag type={result.type} />
      <span
        className={
          size === "roomy"
            ? "max-w-[55%] shrink-0 truncate text-sm font-medium text-foreground"
            : "max-w-[55%] shrink-0 truncate font-medium text-foreground"
        }
        translate="no"
      >
        {result.label}
      </span>
      {result.origin ? (
        <StructureOriginTag origin={result.origin} size="compact" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {result.description}
      </span>
      {!result.in_catalog && SHOWS_CATALOG_SCOPE.has(result.type) ? (
        <span className="shrink-0 rounded-xs border border-dashed border-border-strong px-1 text-2xs text-muted-foreground">
          outside IEI catalog
        </span>
      ) : null}
      {primaryId && !labelIsId ? (
        <span
          className="hidden shrink-0 font-mono text-2xs text-muted-foreground sm:inline"
          translate="no"
        >
          {primaryId}
        </span>
      ) : null}
      <span className="hidden max-w-[14rem] shrink-0 truncate text-2xs text-subtle-foreground md:inline">
        {result.match_reason}
      </span>
      {result.href ? null : (
        <ArrowUpRightIcon
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="Opens at the source"
        />
      )}
    </>
  );
}
