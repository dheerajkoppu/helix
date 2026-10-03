import type { SourceStatus } from "@/lib/api/types";

/** What the surrounding view is about. Every field is optional; the panel searches what it is given. */
export interface LiteratureContextInput {
  /** HGNC symbol */
  gene?: string | null;
  /** catalog disease ID */
  disease?: string | null;
  /** variant ID or protein change, e.g. BTK-p.Arg28His */
  variant?: string | null;
  /** UniProt accession */
  accession?: string | null;
  /** UniProt canonical position, optionally with its residue: 28, "R28" */
  residue?: number | string | null;
}

export type LiteratureKind = "all" | "review" | "primary";
export type LiteratureSort = "relevance" | "cited" | "date";

export type RelevanceCode =
  | "variant_in_title"
  | "variant_in_abstract"
  | "residue_in_title"
  | "residue_in_abstract"
  | "matched_outside_abstract"
  | "uniprot_linked"
  | "gene_in_title"
  | "disease_in_title"
  | "review"
  | "highly_cited";

export interface RelevanceReason {
  code: RelevanceCode;
  label: string;
  detail: string | null;
}

/** Mirrors LiteraturePublication in api/orphafold/schemas/literature.py. */
export interface LiteraturePublication {
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string;
  journal: string | null;
  journal_abbreviation: string | null;
  year: number | null;
  published: string | null;
  authors: string[];
  author_string: string | null;
  abstract: string | null;
  is_open_access: boolean | null;
  license: string | null;
  cited_by_count: number | null;
  publication_types: string[];
  is_review: boolean;
  url: string | null;
  pubmed_url: string | null;
  doi_url: string | null;
  full_text_url: string | null;
  relevance: RelevanceReason[];
  evidence: unknown | null;
}

export interface LiteratureResolvedContext {
  gene: string | null;
  disease: string | null;
  disease_name: string | null;
  variant: string | null;
  variant_terms: string[];
  accession: string | null;
  residue: string | null;
  residue_terms: string[];
  q: string | null;
  kind: LiteratureKind;
  sort: LiteratureSort;
}

/** Mirrors LiteratureResponse: GET /api/v1/literature. */
export interface LiteratureResponse {
  items: LiteraturePublication[];
  /** null when Europe PMC did not answer */
  total: number | null;
  page: number;
  page_size: number;
  has_more: boolean;
  query: string | null;
  query_url: string | null;
  context: LiteratureResolvedContext;
  notes: string[];
  highly_cited_threshold: number;
  sources: SourceStatus[];
}

/** Mirrors LiteratureRecordResponse: GET /api/v1/literature/{pmid}. */
export interface LiteratureRecordResponse {
  publication: LiteraturePublication | null;
  sources: SourceStatus[];
}
