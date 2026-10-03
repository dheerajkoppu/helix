"use client";

import { EvidencePopover } from "@/components/evidence/evidence-popover";
import type { Schema } from "@/lib/api/types";
import type { EvidenceClass, EvidenceItem } from "@/lib/evidence";

export type ApiEvidence = Schema<"Evidence">;
type Provenance = Schema<"Provenance">;
type RecordSource = Schema<"RecordSource">;

const DATABASE_NAMES: Record<string, string> = {
  clinvar: "ClinVar",
  uniprot: "UniProt",
  gnomad: "gnomAD",
  ensembl: "Ensembl",
  ensembl_vep: "Ensembl VEP",
  interpro: "InterPro",
  afdb: "AlphaFold DB",
  alphamissense: "AlphaMissense",
  protvar: "EBI ProtVar",
  mavedb: "MaveDB",
  hgnc: "HGNC",
  pdbe: "PDBe",
  rcsb_pdb: "RCSB PDB",
};

const databaseName = (id: string) => DATABASE_NAMES[id.toLowerCase()] ?? id;

/** A backend Evidence record as the shape the evidence components take. */
export function toEvidenceItem(evidence: ApiEvidence): EvidenceItem {
  const { source, strength, eco } = evidence;
  return {
    evidenceClass: evidence.evidence_class,
    statement: evidence.statement,
    source: source
      ? {
          database: databaseName(source.database),
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
    method: eco
      ? `${eco.id}${eco.label ? `, ${eco.label}` : ""}`
      : evidence.generated_by,
    modifiers: evidence.modifiers,
  };
}

/** The provenance block of a fetched record, for values that carry no Evidence record of their own. */
export function provenanceEvidence(
  provenance: Provenance,
  evidenceClass: EvidenceClass,
  statement?: string | null,
  method?: string | null,
): EvidenceItem {
  return {
    evidenceClass,
    statement,
    method,
    source: {
      database: provenance.source_name,
      recordId: provenance.record_id,
      release: provenance.release,
      retrievedAt: provenance.retrieved_at,
      url: provenance.record_url ?? provenance.request_url,
      license: provenance.license,
    },
  };
}

export function recordSourceEvidence(
  source: RecordSource,
  evidenceClass: EvidenceClass,
  statement?: string | null,
): EvidenceItem {
  return {
    evidenceClass,
    statement,
    source: {
      database: source.name ?? databaseName(source.source_id),
      recordId: source.record_id,
      release: source.release,
      retrievedAt: source.retrieved_at,
      url: source.url,
      license: source.license,
    },
  };
}

export interface EvidenceMarkProps {
  evidence: ApiEvidence | EvidenceItem | null | undefined;
  size?: "compact" | "standard";
  detail?: React.ReactNode;
  className?: string;
}

const isApiEvidence = (
  evidence: ApiEvidence | EvidenceItem,
): evidence is ApiEvidence => "evidence_class" in evidence;

/** The evidence badge of a statement, opening its source record. Renders nothing without a record. */
export function EvidenceMark({
  evidence,
  size = "compact",
  detail,
  className,
}: EvidenceMarkProps) {
  if (!evidence) return null;
  return (
    <EvidencePopover
      evidence={isApiEvidence(evidence) ? toEvidenceItem(evidence) : evidence}
      size={size}
      detail={detail}
      className={className}
    />
  );
}
