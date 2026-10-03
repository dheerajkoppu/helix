import {
  compoundName,
  modalityLabel,
  type TargetCompound,
  type Treatment,
} from "@/components/compound/format";
import type { Schema, SourceStatus } from "@/lib/api/types";
import type { JobOut, JobStatus } from "@/lib/state/jobs";
import type { ApiStructureDescriptor } from "@/lib/workspace-data";

export type PredictedPocket = Schema<"PredictedPocket">;

/** The first of the named sources that did not answer. An empty answer is an answer. */
export function sourceDown(
  sources: readonly SourceStatus[] | null | undefined,
  ...ids: string[]
): SourceStatus | null {
  return (
    (sources ?? []).find(
      (status) =>
        ids.includes(status.source) &&
        status.state !== "ok" &&
        status.state !== "empty",
    ) ?? null
  );
}

export interface SourcesDown {
  chembl: SourceStatus | null;
  pdb: SourceStatus | null;
  openTargets: SourceStatus | null;
  pockets: SourceStatus | null;
  intact: SourceStatus | null;
  string: SourceStatus | null;
}

/** `result` of a finished binding_prediction job (BindingPredictionResult in the API). */
export interface BindingResult {
  statement: string;
  structure: ApiStructureDescriptor;
  protein: {
    uniprot_accession: string | null;
    residue_start: number;
    residue_end: number;
    length: number;
    variant_id: string | null;
  };
  ligand: {
    entity_id: string;
    label: string | null;
    smiles: string | null;
    ccd: string | null;
    inchikey: string | null;
    heavy_atom_count: number | null;
    xrefs: string[];
  };
  pocket_constraint: {
    uniprot_positions: number[];
    max_distance_angstrom: number;
    force: boolean;
  } | null;
  pose_confidence: {
    confidence_score: number | null;
    iptm: number | null;
    ligand_iptm: number | null;
    complex_plddt: number | null;
  };
  affinity: {
    affinity_pred_value: number;
    affinity_pred_value_unit: string;
    affinity_pred_value_spread: number | null;
    affinity_probability_binary: number;
    derived: { approx_ic50_um: number; note: string };
  } | null;
  affinity_status: "predicted" | "not_requested" | "not_produced";
  caveats: string[];
  limitations: string[];
  warnings: string[];
}

export interface BindingRun {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  providerId: string | null;
  inchikey: string | null;
  smiles: string | null;
  label: string | null;
  result: BindingResult | null;
  error: JobOut["error"];
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Binding jobs of one protein, newest first. Jobs of other proteins are dropped. */
export function bindingRuns(jobs: JobOut[], accession: string): BindingRun[] {
  return jobs
    .filter((job) => job.kind === "binding_prediction")
    .map((job): BindingRun | null => {
      const result =
        job.status === "succeeded" && job.result
          ? (job.result as unknown as BindingResult)
          : null;
      const target =
        result?.protein?.uniprot_accession ??
        text(job.params.uniprot_accession);
      if (target !== accession) return null;
      return {
        jobId: job.id,
        status: job.status,
        createdAt: job.created_at,
        providerId: job.provider_id,
        inchikey: result?.ligand?.inchikey ?? null,
        smiles: result?.ligand?.smiles ?? text(job.params.ligand_smiles),
        label: result?.ligand?.label ?? text(job.params.ligand_label),
        result,
        error: job.error,
      };
    })
    .filter((run): run is BindingRun => run !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type EvidenceTier = "A_experimental" | "C_predicted";

export const TIER_META: Record<
  EvidenceTier,
  { code: string; label: string; rank: number; description: string }
> = {
  A_experimental: {
    code: "A",
    label: "Experimental or clinical record",
    rank: 0,
    description:
      "A measured activity, a ligand observed in an experimental structure, or a curated mechanism or clinical record names this compound with this target.",
  },
  C_predicted: {
    code: "C",
    label: "Prediction only",
    rank: 2,
    description:
      "Only an Helix binding prediction links this compound to this target. No source record was found.",
  },
};

export interface ComparisonRow {
  /** InChIKey, a ChEMBL ID for records without a structure, or job:<id> */
  id: string;
  name: string;
  compound: TargetCompound | null;
  treatment: Treatment | null;
  modality: string;
  /** null: no source states the modality */
  smallMolecule: boolean | null;
  eligible: boolean;
  /** why a binding prediction is or is not offered, as the API words it */
  eligibility: string;
  tier: EvidenceTier;
  runs: BindingRun[];
  /** newest finished prediction */
  pose: BindingRun | null;
}

const STAGE_RANK: Record<string, number> = {
  APPROVAL: 4,
  PHASE_4: 4,
  PREAPPROVAL: 3.5,
  PHASE_3: 3,
  PHASE_2_3: 2.5,
  PHASE_2: 2,
  PHASE_1_2: 1.5,
  PHASE_1: 1,
  EARLY_PHASE_1: 0.5,
};

export const stageRank = (row: ComparisonRow): number =>
  Math.max(
    row.compound?.max_phase ?? -1,
    row.treatment ? (STAGE_RANK[row.treatment.clinical_stage ?? ""] ?? 0) : -1,
  );

const NOT_SMALL_MOLECULE =
  "Not applicable: binding prediction co-folds a protein with one small molecule.";

/** One row per compound across ChEMBL / PDB records, Open Targets records and binding jobs. */
export function comparisonRows(
  compounds: TargetCompound[],
  treatments: Treatment[],
  runs: BindingRun[],
): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();
  const byChembl = new Map<string, ComparisonRow>();

  for (const compound of compounds) {
    const row: ComparisonRow = {
      id: compound.id,
      name: compoundName(compound),
      compound,
      treatment: null,
      modality: modalityLabel(compound),
      smallMolecule:
        compound.modality === "small_molecule"
          ? true
          : compound.modality === "unknown"
            ? null
            : false,
      eligible: compound.binding_prediction.eligible,
      eligibility: compound.binding_prediction.reason,
      tier: "A_experimental",
      runs: [],
      pose: null,
    };
    rows.set(row.id, row);
    if (compound.chembl_id) byChembl.set(compound.chembl_id, row);
  }

  for (const treatment of treatments) {
    const existing = byChembl.get(treatment.drug_id);
    if (existing) {
      existing.treatment ??= treatment;
      continue;
    }
    if (rows.has(treatment.drug_id)) continue;
    const unknown = !treatment.modality || treatment.modality === "Unknown";
    rows.set(treatment.drug_id, {
      id: treatment.drug_id,
      name: treatment.name ?? treatment.drug_id,
      compound: null,
      treatment,
      modality: treatment.modality && !unknown ? treatment.modality : "Unknown modality",
      smallMolecule: treatment.is_small_molecule
        ? true
        : unknown
          ? null
          : false,
      eligible: false,
      eligibility: treatment.is_small_molecule
        ? "Not offered here: this record carries no chemical structure. Open the compound to resolve one."
        : unknown
          ? "Not offered: no source states that this is a small molecule."
          : NOT_SMALL_MOLECULE,
      tier: "A_experimental",
      runs: [],
      pose: null,
    });
  }

  for (const run of runs) {
    let row = run.inchikey ? rows.get(run.inchikey) : undefined;
    if (!row && run.smiles)
      row = [...rows.values()].find(
        (candidate) => candidate.compound?.smiles === run.smiles,
      );
    if (!row) {
      const id = run.inchikey ?? `job:${run.jobId}`;
      row = {
        id,
        name: run.label ?? run.inchikey ?? "Unnamed ligand",
        compound: null,
        treatment: null,
        modality: "Small molecule",
        smallMolecule: true,
        eligible: false,
        eligibility: "Submitted as a binding prediction from the job dialog.",
        tier: "C_predicted",
        runs: [],
        pose: null,
      };
      rows.set(id, row);
    }
    row.runs.push(run);
    if (!row.pose && run.result) row.pose = run;
  }

  return [...rows.values()];
}

const median = (row: ComparisonRow) =>
  row.compound?.measured_affinity?.median_pchembl ?? -1;
const entries = (row: ComparisonRow) =>
  row.compound?.co_crystal?.pdb_entry_count ?? 0;
const predicted = (row: ComparisonRow) =>
  row.pose?.result?.affinity?.affinity_pred_value ?? null;

export type ComparisonSort = "tier" | "measured" | "predicted";

/**
 * tier: evidence tier, then clinical stage, measured affinity, structures. measured: median pChEMBL,
 * highest first. predicted: predicted log10(IC50 / µM), lowest first. Rows without the value follow.
 */
export function sortRows(
  rows: ComparisonRow[],
  sort: ComparisonSort,
): ComparisonRow[] {
  const byTier = (left: ComparisonRow, right: ComparisonRow) =>
    TIER_META[left.tier].rank - TIER_META[right.tier].rank ||
    stageRank(right) - stageRank(left) ||
    median(right) - median(left) ||
    entries(right) - entries(left) ||
    left.name.localeCompare(right.name);
  return [...rows].sort((left, right) => {
    if (sort === "measured")
      return median(right) - median(left) || byTier(left, right);
    if (sort === "predicted") {
      const a = predicted(left);
      const b = predicted(right);
      if (a !== null && b !== null) return a - b || byTier(left, right);
      if (a !== null) return -1;
      if (b !== null) return 1;
    }
    return byTier(left, right);
  });
}

export interface PocketOverlap {
  pocket: PredictedPocket;
  shared: number;
}

/** The predicted pocket sharing the most residues with a set of positions; null when none shares any. */
export function pocketOverlap(
  positions: number[] | null | undefined,
  pockets: PredictedPocket[],
): PocketOverlap | null {
  if (!positions || positions.length === 0) return null;
  const wanted = new Set(positions);
  let best: PocketOverlap | null = null;
  for (const pocket of pockets) {
    const shared = pocket.positions.filter((position) =>
      wanted.has(position),
    ).length;
    if (shared > 0 && (!best || shared > best.shared))
      best = { pocket, shared };
  }
  return best;
}

/** "408-409, 416, 428-430" */
export function formatPositions(positions: number[]): string {
  const sorted = [...new Set(positions)].sort((left, right) => left - right);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    if (start !== undefined)
      parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  return parts.join(", ");
}

export type Selected =
  | { kind: "compound"; id: string }
  | { kind: "treatment"; id: string }
  | { kind: "pocket"; id: string }
  | { kind: "partner"; id: string }
  | { kind: "class"; id: string }
  | null;

export interface MechanismClass {
  id: string;
  mechanism: string;
  actionType: string | null;
  targetName: string | null;
  modalities: string[];
  drugs: Treatment[];
  scope: string;
}

/** Mechanisms as the source records word them, grouped. Nothing is inferred beyond the grouping. */
export function mechanismClasses(treatments: Treatment[]): MechanismClass[] {
  const classes = new Map<string, MechanismClass>();
  for (const treatment of treatments) {
    for (const mechanism of treatment.mechanisms) {
      if (!mechanism.mechanism) continue;
      const id = `${mechanism.mechanism}|${mechanism.action_type ?? ""}`;
      let entry = classes.get(id);
      if (!entry) {
        entry = {
          id,
          mechanism: mechanism.mechanism,
          actionType: mechanism.action_type ?? null,
          targetName: mechanism.target_name ?? null,
          modalities: [],
          drugs: [],
          scope: treatment.scope,
        } satisfies MechanismClass;
        classes.set(id, entry);
      }
      if (!entry.drugs.includes(treatment)) entry.drugs.push(treatment);
      const modality = treatment.modality || "Unknown";
      if (!entry.modalities.includes(modality)) entry.modalities.push(modality);
    }
  }
  return [...classes.values()].sort(
    (left, right) => right.drugs.length - left.drugs.length,
  );
}
