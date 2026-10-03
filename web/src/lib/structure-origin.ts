import type { EvidenceBorder } from "@/lib/evidence";

export const STRUCTURE_ORIGINS = [
  "experimental",
  "predicted_external",
  "predicted_internal",
] as const;

export type StructureOrigin = (typeof STRUCTURE_ORIGINS)[number];

export interface StructureOriginMeta {
  id: StructureOrigin;
  tag: "EXP" | "PRD" | "OF";
  label: string;
  /** fixed caption shown wherever a structure of this class is displayed */
  caption: string;
  border: EvidenceBorder;
  textClass: string;
  borderClass: string;
}

export const STRUCTURE_ORIGIN_META: Record<
  StructureOrigin,
  StructureOriginMeta
> = {
  experimental: {
    id: "experimental",
    tag: "EXP",
    label: "Experimental structure",
    caption: "experimentally determined",
    border: "solid",
    textClass: "text-origin-experimental",
    borderClass: "border-origin-experimental/60",
  },
  predicted_external: {
    id: "predicted_external",
    tag: "PRD",
    label: "Existing predicted structure",
    caption: "predicted, not experimental",
    border: "dashed",
    textClass: "text-origin-predicted-external",
    borderClass: "border-origin-predicted-external/70",
  },
  predicted_internal: {
    id: "predicted_internal",
    tag: "OF",
    label: "Helix-generated prediction",
    caption: "generated here, not validated",
    border: "dotted",
    textClass: "text-origin-predicted-internal",
    borderClass: "border-origin-predicted-internal",
  },
};

/** Ledger grouping order. Sorting never interleaves classes unless the user asks. */
export const STRUCTURE_ORIGIN_ORDER: StructureOrigin[] = [
  "experimental",
  "predicted_external",
  "predicted_internal",
];

export function isStructureOrigin(value: unknown): value is StructureOrigin {
  return (
    typeof value === "string" &&
    (STRUCTURE_ORIGINS as readonly string[]).includes(value)
  );
}

export type StructureIdKind = "pdb" | "afdb" | "of";

export interface ParsedStructureId {
  kind: StructureIdKind;
  id: string;
  origin: StructureOrigin;
}

const ORIGIN_BY_KIND: Record<StructureIdKind, StructureOrigin> = {
  pdb: "experimental",
  afdb: "predicted_external",
  of: "predicted_internal",
};

/** Parses `pdb:1BF5`, `afdb:AF-P42224-F1` and `of:<job_id>`. */
export function parseStructureId(value: string): ParsedStructureId | null {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || (kind !== "pdb" && kind !== "afdb" && kind !== "of")) return null;
  return { kind, id, origin: ORIGIN_BY_KIND[kind] };
}

export function formatStructureId(kind: StructureIdKind, id: string): string {
  return `${kind}:${id}`;
}
