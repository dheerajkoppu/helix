import type { Schema } from "@/lib/api/types";
import {
  toEvidenceSource,
  type EvidenceClass,
  type EvidenceItem,
} from "@/lib/evidence";

type ApiEvidence = Schema<"Evidence">;
type Provenance = Schema<"Provenance">;

/** An API evidence record as the shape `EvidencePopover` takes. */
export function toEvidenceItem(
  evidence: ApiEvidence,
  statement?: string | null,
): EvidenceItem {
  const strength = evidence.strength;
  return {
    evidenceClass: evidence.evidence_class,
    statement:
      statement ?? evidence.statement ?? evidence.object?.label ?? null,
    source: toEvidenceSource(evidence.source),
    strength:
      strength && strength.value !== null && strength.value !== undefined
        ? {
            scheme: strength.scheme,
            value: `${strength.value}${strength.unit ? ` ${strength.unit}` : ""}`,
            rank: strength.rank,
            maxRank: strength.max_rank,
          }
        : null,
    method: evidence.eco ? `${evidence.eco.id}, ${evidence.eco.label}` : null,
    modifiers: evidence.modifiers,
  };
}

/** For values that carry a provenance block and no evidence record of their own. */
export function provenanceEvidence(
  provenance: Provenance | null | undefined,
  evidenceClass: EvidenceClass,
  statement?: string | null,
  method?: string | null,
): EvidenceItem {
  return {
    evidenceClass,
    statement: statement ?? null,
    source: provenance
      ? toEvidenceSource({
          database: provenance.source_name,
          record_id: provenance.record_id,
          release: provenance.release,
          retrieved_at: provenance.retrieved_at,
          url: provenance.record_url ?? provenance.request_url,
          license: provenance.license,
        })
      : null,
    method: method ?? null,
  };
}
