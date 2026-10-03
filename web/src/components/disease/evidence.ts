import type { Schema, SourceStatus } from "@/lib/api/types";
import type { EvidenceClass, EvidenceItem } from "@/lib/evidence";

export type ApiEvidence = Schema<"Evidence">;
export type RecordSource = Schema<"RecordSource">;

const SOURCE_NAMES: Record<string, string> = {
  iuis: "IUIS 2024 classification",
  monarch: "Monarch Initiative",
  uniprot: "UniProtKB",
  reactome: "Reactome",
  intact: "IntAct",
  string: "STRING",
  open_targets: "Open Targets Platform",
  clinvar: "ClinVar",
  europe_pmc: "Europe PMC",
};

/** Class of a statement taken from a seeded record: publications and ClinVar keep their own class. */
const CLASS_BY_SOURCE: Record<string, EvidenceClass> = {
  iuis_2024: "literature",
  europe_pmc: "literature",
  clinvar: "clinical_database",
};

export function sourceName(
  database: string,
  sources?: SourceStatus[] | null,
): string {
  return (
    sources?.find((entry) => entry.source === database)?.name ??
    SOURCE_NAMES[database] ??
    database
  );
}

/** A seeded source record as an inspectable evidence item. */
export function recordEvidence(
  source: RecordSource | null | undefined,
  statement?: string | null,
): EvidenceItem | null {
  if (!source) return null;
  return {
    evidenceClass: CLASS_BY_SOURCE[source.source_id] ?? "curated_database",
    statement: statement ?? null,
    source: {
      database: source.name ?? source.source_id,
      recordId: source.record_id,
      release: source.release,
      retrievedAt: source.retrieved_at,
      url: source.url,
      license: source.license,
    },
  };
}

/** A backend Evidence record in the shape EvidencePopover takes. */
export function apiEvidence(
  evidence: ApiEvidence,
  options: { sources?: SourceStatus[] | null; statement?: string | null } = {},
): EvidenceItem {
  const { source, strength } = evidence;
  const pmids = evidence.citations
    .map((citation) => citation.pmid)
    .filter((pmid): pmid is string => Boolean(pmid));
  return {
    evidenceClass: evidence.evidence_class,
    statement: evidence.statement ?? options.statement ?? null,
    source: source
      ? {
          database: sourceName(source.database, options.sources),
          recordId: source.record_id,
          release: source.release,
          retrievedAt: source.retrieved_at,
          url: source.url,
          license: source.license,
        }
      : null,
    strength:
      strength && strength.value !== null
        ? {
            scheme: strength.scheme,
            value: String(strength.value),
            rank: strength.rank,
            maxRank: strength.max_rank,
          }
        : null,
    method: pmids.length
      ? pmids.map((pmid) => `PubMed:${pmid}`).join(", ")
      : null,
    modifiers: evidence.modifiers,
  };
}
