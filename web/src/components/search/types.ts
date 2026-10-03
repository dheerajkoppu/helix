import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceClass } from "@/lib/evidence";
import type { StructureOrigin } from "@/lib/structure-origin";

/** Mirrors api/helix/schemas/search.py (GET /search). */
export const SEARCH_RESULT_TYPES = [
  "gene",
  "protein",
  "disease",
  "variant",
  "structure",
  "compound",
  "paper",
  "project",
] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export type MatchKind =
  | "identifier"
  | "exact"
  | "alias"
  | "prefix"
  | "token"
  | "fuzzy"
  | "related"
  | "live";

export interface SearchIdentifier {
  source: string;
  id: string;
  url: string | null;
}

export interface SearchResult {
  type: SearchResultType;
  /** URL-facing ID of the entity */
  id: string;
  label: string;
  description: string | null;
  match: MatchKind;
  match_reason: string;
  matched_text: string | null;
  /** web route; null when the entity has no page */
  href: string | null;
  external_url: string | null;
  ids: SearchIdentifier[];
  in_catalog: boolean;
  source: string;
  evidence_class: EvidenceClass | null;
  gene_symbol: string | null;
  accession: string | null;
  structures: {
    experimental_count: number | null;
    has_alphafold_model: boolean | null;
  } | null;
  origin: StructureOrigin | null;
  count: number | null;
}

export interface SearchGroup {
  type: SearchResultType;
  label: string;
  total: number;
  results: SearchResult[];
}

export interface ParsedIdentifier {
  kind: string;
  value: string;
  description: string;
}

export interface SearchResponse {
  query: string;
  parsed: ParsedIdentifier[];
  groups: SearchGroup[];
  top: SearchResult | null;
  total: number;
  outside_catalog: boolean;
  took_ms: number;
  sources: SourceStatus[];
}
