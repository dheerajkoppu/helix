export const EVIDENCE_CLASSES = [
  "experimental",
  "clinical_database",
  "literature",
  "curated_database",
  "computational_prediction",
  "helix_hypothesis",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** The four claim labels used by comparison and mechanism views. */
export type ClaimLabel =
  | "Known experimentally"
  | "Database annotation"
  | "Computational prediction"
  | "Helix hypothesis";

export type EvidenceBorder = "solid" | "dashed" | "dotted";

export interface EvidenceClassMeta {
  id: EvidenceClass;
  code: "EXP" | "CLIN" | "LIT" | "CUR" | "PRED" | "HYP";
  label: string;
  claim: ClaimLabel;
  /** solid: asserted by an external source; dashed: computed by a tool; dotted: authored in Helix */
  border: EvidenceBorder;
  /** one sentence for popovers and screen readers */
  description: string;
  /** Tailwind text colour utility for the redundant hue channel */
  textClass: string;
  borderClass: string;
}

export const EVIDENCE_META: Record<EvidenceClass, EvidenceClassMeta> = {
  experimental: {
    id: "experimental",
    code: "EXP",
    label: "Experimental evidence",
    claim: "Known experimentally",
    border: "solid",
    description:
      "Observed in a laboratory experiment and reported by the cited source.",
    textClass: "text-ev-experimental",
    borderClass: "border-ev-experimental/60",
  },
  clinical_database: {
    id: "clinical_database",
    code: "CLIN",
    label: "Clinical database",
    claim: "Database annotation",
    border: "solid",
    description:
      "Asserted by a clinical database. Review status is the database's own.",
    textClass: "text-ev-clinical",
    borderClass: "border-ev-clinical/60",
  },
  literature: {
    id: "literature",
    code: "LIT",
    label: "Published literature",
    claim: "Database annotation",
    border: "solid",
    description: "Stated in a published article identified by PMID or DOI.",
    textClass: "text-ev-literature",
    borderClass: "border-ev-literature/60",
  },
  curated_database: {
    id: "curated_database",
    code: "CUR",
    label: "Curated database",
    claim: "Database annotation",
    border: "solid",
    description: "Annotation from a curated database record.",
    textClass: "text-ev-curated",
    borderClass: "border-ev-curated/60",
  },
  computational_prediction: {
    id: "computational_prediction",
    code: "PRED",
    label: "Computational prediction",
    claim: "Computational prediction",
    border: "dashed",
    description:
      "Computed by a model or tool. Not an experimental observation.",
    textClass: "text-ev-prediction",
    borderClass: "border-ev-prediction/70",
  },
  helix_hypothesis: {
    id: "helix_hypothesis",
    code: "HYP",
    label: "Helix hypothesis",
    claim: "Helix hypothesis",
    border: "dotted",
    description:
      "A statement authored inside Helix from the evidence it cites. Not established.",
    textClass: "text-ev-hypothesis",
    borderClass: "border-ev-hypothesis/80",
  },
};

/** Reading order in inspectors. A convention only; it implies no numeric weight. */
export const EVIDENCE_DISPLAY_ORDER: EvidenceClass[] = [
  "experimental",
  "clinical_database",
  "curated_database",
  "literature",
  "computational_prediction",
  "helix_hypothesis",
];

export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return (
    typeof value === "string" &&
    (EVIDENCE_CLASSES as readonly string[]).includes(value)
  );
}

/** Where a fact came from. Every field except `database` may be unknown. */
export interface EvidenceSource {
  database: string;
  recordId?: string | null;
  release?: string | null;
  retrievedAt?: string | null;
  url?: string | null;
  license?: string | null;
}

/** Source-native strength, shown verbatim. Never combined across sources. */
export interface EvidenceStrength {
  scheme: string;
  value: string;
  rank?: number | null;
  maxRank?: number | null;
}

export interface EvidenceItem {
  evidenceClass: EvidenceClass;
  /** the claim this evidence supports, as worded by the source or the computation */
  statement?: string | null;
  source: EvidenceSource | null;
  strength?: EvidenceStrength | null;
  /** tool and version for predictions, method for experiments */
  method?: string | null;
  /** short qualifiers such as "manual", "auto", "text-mined", "by similarity" */
  modifiers?: string[];
}

type LooseRecord = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Accepts the backend's snake_case source block and returns the component shape. */
export function toEvidenceSource(raw: unknown): EvidenceSource | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as LooseRecord;
  const database =
    text(record.database) ?? text(record.source_name) ?? text(record.name);
  if (!database) return null;
  return {
    database,
    recordId:
      text(record.record_id) ??
      text(record.source_record_id) ??
      text(record.recordId),
    release:
      text(record.release) ??
      text(record.source_release) ??
      text(record.version),
    retrievedAt: text(record.retrieved_at) ?? text(record.retrievedAt),
    url: text(record.url) ?? text(record.request_url),
    license: text(record.license),
  };
}
