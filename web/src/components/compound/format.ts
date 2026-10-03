import type { Schema } from "@/lib/api/types";
import { isEvidenceClass, type EvidenceItem } from "@/lib/evidence";

export type ApiEvidence = Schema<"Evidence">;
export type TargetCompound = Schema<"TargetCompound">;
export type CompoundCore = Schema<"CompoundCore">;
export type Treatment = Schema<"Treatment">;
export type MechanismRecord = Schema<"MechanismRecord">;
export type MeasuredAffinitySummary = Schema<"MeasuredAffinitySummary">;

const DATABASE_NAME: Record<string, string> = {
  chembl: "ChEMBL",
  open_targets: "Open Targets",
  pdbe: "PDBe",
  rcsb_pdb: "RCSB PDB",
  prankweb: "PrankWeb",
  intact: "IntAct",
  string: "STRING",
  unichem: "UniChem",
  uniprot: "UniProt",
  orphafold: "OrphaFold",
};

/** Source IDs as the API writes them, printed the way the database names itself. */
export const databaseName = (id: string): string => DATABASE_NAME[id] ?? id;

/** The backend evidence record in the shape EvidencePopover reads. */
export function toEvidenceItem(
  evidence: ApiEvidence | null | undefined,
  statement?: string | null,
): EvidenceItem | null {
  if (!evidence || !isEvidenceClass(evidence.evidence_class)) return null;
  const { source, strength } = evidence;
  return {
    evidenceClass: evidence.evidence_class,
    statement: statement ?? evidence.statement,
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
      strength && strength.value !== null && strength.value !== undefined
        ? {
            scheme: strength.scheme,
            value: String(strength.value),
            rank: strength.rank,
            maxRank: strength.max_rank,
          }
        : null,
    method: evidence.eco ? `${evidence.eco.id} ${evidence.eco.label}` : null,
    modifiers: evidence.modifiers,
  };
}

const MODALITY_LABEL: Record<string, string> = {
  small_molecule: "Small molecule",
  biologic: "Biologic",
  cell_or_gene_therapy: "Cell or gene therapy",
  procedure: "Procedure",
  unknown: "Unknown modality",
};

export const modalityLabel = (compound: {
  modality: string;
  molecule_type?: string | null;
}): string =>
  compound.modality === "small_molecule"
    ? MODALITY_LABEL.small_molecule
    : compound.molecule_type && compound.molecule_type !== "Unknown"
      ? compound.molecule_type
      : (MODALITY_LABEL[compound.modality] ?? compound.modality);

/** ChEMBL max_phase as text. Approval is for any indication, which the label says. */
export function phaseLabel(
  maxPhase: number | null | undefined,
  firstApproval?: number | null,
): string | null {
  if (maxPhase === null || maxPhase === undefined) return null;
  if (maxPhase >= 4)
    return firstApproval ? `Approved ${firstApproval}` : "Approved";
  if (maxPhase >= 1) return `Phase ${Math.floor(maxPhase)}`;
  if (maxPhase > 0) return "Early phase 1";
  return "Preclinical";
}

const trim = (value: number): string =>
  Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(3)));

/** "IC50 = 5.1 nM": type, relation, value and unit of the representative row, always together. */
export const measuredValue = (summary: MeasuredAffinitySummary): string => {
  const row = summary.representative;
  return `${row.standard_type} ${row.relation} ${trim(row.value)} ${row.units}`;
};

/** "pChEMBL 8.29, median of 17 rows in 17 assays" */
export const measuredBasis = (summary: MeasuredAffinitySummary): string =>
  `pChEMBL ${summary.median_pchembl.toFixed(2)}, median of ${summary.activity_count} ${
    summary.activity_count === 1 ? "row" : "rows"
  } in ${summary.assay_count} ${summary.assay_count === 1 ? "assay" : "assays"}`;

export const compoundName = (compound: {
  name?: string | null;
  chembl_id?: string | null;
  id: string;
}): string => compound.name ?? compound.chembl_id ?? compound.id;
