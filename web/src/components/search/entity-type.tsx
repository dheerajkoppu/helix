import {
  ActivityIcon,
  BoxIcon,
  DnaIcon,
  FileTextIcon,
  FolderIcon,
  GitCommitHorizontalIcon,
  HexagonIcon,
  SplineIcon,
} from "lucide-react";
import { cn } from "cn";

import type { SearchResultType } from "@/components/search/types";

export const ENTITY_TYPE_META: Record<
  SearchResultType,
  {
    code: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  gene: { code: "GENE", label: "Gene", icon: DnaIcon },
  protein: { code: "PROT", label: "Protein", icon: SplineIcon },
  disease: { code: "DIS", label: "Disease", icon: ActivityIcon },
  variant: { code: "VAR", label: "Variant", icon: GitCommitHorizontalIcon },
  structure: { code: "STR", label: "Structure", icon: BoxIcon },
  compound: { code: "CPD", label: "Compound", icon: HexagonIcon },
  paper: { code: "LIT", label: "Paper", icon: FileTextIcon },
  project: { code: "PRJ", label: "Project", icon: FolderIcon },
};

/** Fixed-width type marker: a glyph and a printed code, so the type never rests on shape alone. */
export function EntityTypeTag({
  type,
  className,
}: {
  type: SearchResultType;
  className?: string;
}) {
  const meta = ENTITY_TYPE_META[type];
  return (
    <span
      data-slot="entity-type-tag"
      data-type={type}
      className={cn(
        "inline-flex h-[18px] w-[3.375rem] shrink-0 items-center gap-1 rounded-xs border border-border px-1 text-muted-foreground",
        className,
      )}
    >
      <meta.icon className="size-3 shrink-0" aria-hidden />
      <span
        aria-hidden
        className="font-mono text-2xs leading-none font-semibold tracking-[0.06em]"
      >
        {meta.code}
      </span>
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}
