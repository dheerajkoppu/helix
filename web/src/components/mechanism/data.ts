"use client";

import { useQuery } from "@tanstack/react-query";

import { apiQuery } from "@/lib/api/query";
import type { Schema } from "@/lib/api/types";
import type { EvidenceItem } from "@/lib/evidence";

export type MechanismsResponse = Schema<"MechanismsResponse">;
export type MechanismCandidate = Schema<"MechanismCandidate">;
export type MechanismObservation = Schema<"MechanismObservation">;
export type UnsupportedCategory = Schema<"UnsupportedCategory">;
export type MechanismLigandRef = Schema<"MechanismLigandRef">;
export type SupportKind = MechanismCandidate["support"];
type ApiEvidence = Schema<"Evidence">;

/** Candidate mechanisms of a variant. Built on the shared `apiQuery`, like every workspace hook. */
export function useVariantMechanisms(variantId: string | null | undefined) {
  return useQuery({
    ...apiQuery<MechanismsResponse>(
      `/variants/${encodeURIComponent(variantId ?? "")}/mechanisms`,
    ),
    staleTime: 30 * 60 * 1000,
    enabled: Boolean(variantId),
  });
}

const DATABASE_NAMES: Record<string, string> = {
  uniprot: "UniProt",
  interpro: "InterPro",
  protvar: "EBI ProtVar",
  rcsb_pdb: "RCSB PDB",
  pdbe: "PDBe",
  prankweb: "PrankWeb (P2Rank)",
  intact: "IntAct",
  afdb: "AlphaFold DB",
};

/** A backend Evidence record in the shape the evidence components take. */
export function toEvidenceItem(
  evidence: ApiEvidence,
  statement?: string | null,
): EvidenceItem {
  const { source, strength, eco } = evidence;
  return {
    evidenceClass: evidence.evidence_class,
    statement: statement ?? evidence.statement,
    source: source
      ? {
          database:
            DATABASE_NAMES[source.database.toLowerCase()] ?? source.database,
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
    method: eco ? `${eco.id}${eco.label ? `, ${eco.label}` : ""}` : null,
    modifiers: evidence.modifiers,
  };
}

/** Evidence class of the strongest record kind, for the badge beside a candidate. */
export const SUPPORT_CLASS: Record<SupportKind, EvidenceItem["evidenceClass"]> =
  {
    experimental_annotation: "experimental",
    curated_annotation: "curated_database",
    computational_prediction: "computational_prediction",
  };

export const PROXIMITY_LABEL: Record<
  MechanismObservation["proximity"],
  string
> = {
  at_residue: "At the residue",
  structure_contact: "Contact in a structure",
  covering_region: "Region covers the residue",
  sequence_neighbour: "Sequence neighbour",
  protein_level: "Whole protein",
};

export const raises = (observation: MechanismObservation): boolean =>
  observation.raises_candidate && observation.direction === "supports";

export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
