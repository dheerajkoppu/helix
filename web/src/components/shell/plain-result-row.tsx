import { ArrowUpRightIcon } from "lucide-react";

import { ENTITY_TYPE_META } from "@/components/search/entity-type";
import type { SearchResult } from "@/components/search/types";
import { plainMutation, plainOrigin } from "@/lib/plain-language";

/** Simple mode's search result: an icon, the name and one short note. No codes or record IDs. */
export function PlainResultRow({ result }: { result: SearchResult }) {
  const Icon = ENTITY_TYPE_META[result.type].icon;
  const label =
    result.type === "variant"
      ? `${result.gene_symbol ?? ""} ${plainMutation(result.label)}`.trim()
      : result.type === "structure"
        ? result.label.replace(/\s+AF-\S+$/, "")
        : result.label;
  const note =
    result.type === "gene"
      ? result.description
      : result.origin
        ? plainOrigin(result.origin)
        : null;
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span
        className="max-w-[60%] shrink-0 truncate text-sm font-medium text-foreground"
        translate="no"
      >
        {label}
      </span>
      {note ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {note}
        </span>
      ) : null}
      {result.href ? null : (
        <ArrowUpRightIcon
          className="ml-auto size-3 shrink-0 text-muted-foreground"
          aria-label="Opens the source"
        />
      )}
    </>
  );
}
