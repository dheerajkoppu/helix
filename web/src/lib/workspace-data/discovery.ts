"use client";

import { useQuery } from "@tanstack/react-query";

import { apiQuery } from "@/lib/api/query";
import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceClass, EvidenceItem } from "@/lib/evidence";

/**
 * Candidate targets and molecules for a disease, gene or variant: `GET /discovery/candidates`.
 *
 * The shapes here are written by hand against the contract in docs rather than generated from
 * `api/openapi.json`, because this screen is built alongside the endpoint. Every field the screen
 * reads is optional or nullable: a response that is one release ahead renders, it does not crash.
 * Direction of effect is a hard filter on the backend, so `candidates` never carries an "opposes"
 * verdict; those rows arrive in `ruled_out` with the reason.
 */

/** Only the parts of the backend Evidence record this screen reads. */
export interface DiscoveryEvidence {
  evidence_class: EvidenceClass;
  statement?: string | null;
  source?: {
    database: string;
    record_id?: string | null;
    release?: string | null;
    retrieved_at?: string | null;
    url?: string | null;
    license?: string | null;
  } | null;
  strength?: {
    scheme: string;
    value: string | number | null;
    rank?: number | null;
    max_rank?: number | null;
  } | null;
  eco?: { id: string; label?: string | null } | null;
  modifiers?: string[];
}

export type BridgeKind =
  | "same_target"
  | "pathway_node"
  | "interaction_partner"
  | "structural_analogue"
  | "mechanism_class";

export type DirectionVerdict = "matches" | "opposes" | "unknown";

export interface DiscoveryRef {
  id?: string | null;
  name?: string | null;
  label?: string | null;
}

export interface SubjectMechanism {
  class?: string | null;
  direction?: string | null;
  confidence?: string | null;
  /** the catalog sentence the class was read from */
  basis?: string | null;
  /** records that do not agree, stated rather than hidden */
  disagreements?: string[] | null;
  evidence?: DiscoveryEvidence[];
}

export interface DiscoverySubject {
  gene_symbol?: string | null;
  accession?: string | null;
  disease?: DiscoveryRef | null;
  variant?: (DiscoveryRef & { label?: string | null }) | null;
  mechanism?: SubjectMechanism | null;
}

export interface RequiredAction {
  actions?: string[];
  /** the backend's own plain label per action, in the same order */
  action_labels?: string[] | null;
  rule?: string | null;
  why?: string | null;
  direction_needed?: string | null;
}

export interface CandidateTarget {
  accession?: string | null;
  gene_symbol?: string | null;
  name?: string | null;
  /** the bridge kind, restated on the target */
  relation?: string | null;
  druggability?: Record<string, unknown> | null;
}

export interface MeasuredAffinity {
  /** median pChEMBL across the qualifying activities, the backend's summary */
  median_pchembl?: number | null;
  /** the assay types behind it: ["IC50"], ["Kd", "Ki"] */
  standard_types?: string[] | null;
  activity_count?: number | null;
  assay_count?: number | null;
  organism?: string | null;
  url?: string | null;
  /** a value with its own unit, when a source reports one that way */
  type?: string | null;
  value?: number | string | null;
  units?: string | null;
}

export interface CandidateMolecule {
  inchikey?: string | null;
  chembl_id?: string | null;
  name?: string | null;
  modality?: string | null;
  max_phase?: number | null;
  /** ChEMBL mechanism action_type: INHIBITOR, AGONIST, ... */
  action_type?: string | null;
  measured_affinity?: MeasuredAffinity | null;
}

export interface BridgeStep {
  statement?: string | null;
  evidence?: DiscoveryEvidence[];
}

export interface CandidateBridge {
  kind?: string | null;
  from_disease?: DiscoveryRef | null;
  steps?: BridgeStep[];
}

export interface DirectionCheck {
  required?: string | string[] | null;
  required_direction?: string | null;
  molecule_action?: string | null;
  /** "lowers", "raises" */
  molecule_effect?: string | null;
  /** "same_way", "opposite_way" */
  target_relation_effect?: string | null;
  verdict?: DirectionVerdict | string | null;
  why?: string | null;
}

export interface SimilarPocket {
  accession?: string | null;
  gene_symbol?: string | null;
  structure_id?: string | null;
  pocket_id?: string | null;
  residues?: number[];
  /** similarity measures by name: foldseek_tm_score, pocket_rmsd, shared_ligands */
  metrics?: Record<string, number | string | null> | null;
}

export interface CandidateStructure {
  structure_id?: string | null;
  pocket_id?: string | null;
  residues?: number[];
  similar_to?: SimilarPocket | null;
  /** one plain sentence on what the residues are, written by the backend */
  note?: string | null;
}

export interface DiscoveryCandidate {
  id: string;
  rank?: number | null;
  target?: CandidateTarget | null;
  molecule?: CandidateMolecule | null;
  bridge?: CandidateBridge | null;
  direction_check?: DirectionCheck | null;
  structure?: CandidateStructure | null;
  caveats?: string[];
  evidence?: DiscoveryEvidence[];
  label?: string | null;
}

export interface RuledOutRow {
  molecule?: CandidateMolecule | string | null;
  target?: CandidateTarget | string | null;
  reason_code?: string | null;
  reason?: string | null;
  evidence?: DiscoveryEvidence[];
}

export interface WithheldEdge {
  /** the backend's own sentence for what was withheld and why */
  detail?: string | null;
  statement?: string | null;
  reason?: string | null;
  kind?: string | null;
  source?: string | { database?: string | null; record_id?: string | null } | null;
  disease_id?: string | null;
  disease_name?: string | null;
  molecule_name?: string | null;
  molecule_chembl_id?: string | null;
  disease?: DiscoveryRef | string | null;
  molecule?: CandidateMolecule | string | null;
  target?: CandidateTarget | string | null;
}

export interface DiscoveryCandidatesResponse {
  subject?: DiscoverySubject | null;
  required_action?: RequiredAction | null;
  candidates?: DiscoveryCandidate[];
  ruled_out?: RuledOutRow[];
  withheld_edges?: WithheldEdge[];
  sources?: SourceStatus[];
  limits?: string[];
  /** the ordering rule, as sentences, so the ranking can be inspected */
  ranking_rule?: string[] | null;
  counts?: Record<string, number> | null;
  exclude_direct?: boolean | null;
  elapsed_ms?: number | null;
}

export interface DiscoveryControlRun {
  id?: string | null;
  name?: string | null;
  kind?: string | null;
  subject?: string | null;
  gene?: string | null;
  expected?: string | null;
  passed?: boolean | null;
  elapsed_ms?: number | null;
  sources_answered?: number | null;
  sources_total?: number | null;
  candidate_count?: number | null;
  ruled_out_count?: number | null;
  chain?: BridgeStep[];
  notes?: string | null;
}

export interface DiscoveryControlsResponse {
  generated_at?: string | null;
  passed?: boolean | null;
  controls?: DiscoveryControlRun[];
}

export interface CandidateQuery {
  gene?: string | null;
  disease?: string | null;
  variant?: string | null;
  /** drops every edge linking the subject disease straight to a molecule */
  excludeDirect?: boolean;
}

/** Candidate targets and molecules. Idle until a gene is known. */
export function useDiscoveryCandidates(query: CandidateQuery) {
  const { gene, disease, variant, excludeDirect = false } = query;
  return useQuery({
    ...apiQuery<DiscoveryCandidatesResponse>("/discovery/candidates", {
      gene: gene ?? undefined,
      disease: disease ?? undefined,
      variant: variant ?? undefined,
      exclude_direct: excludeDirect ? "true" : undefined,
    }),
    // a cold run asks ChEMBL, Reactome, IntAct and a structure search: keep the answer
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: Boolean(gene),
  });
}

/** The stored validation result file. 404 until the controls have been run. */
export function useDiscoveryControls(enabled = true) {
  return useQuery({
    ...apiQuery<DiscoveryControlsResponse>("/discovery/controls"),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** A backend evidence record in the shape the shared evidence components take. */
export function toDiscoveryEvidence(
  evidence: DiscoveryEvidence,
  statement?: string | null,
): EvidenceItem {
  const { source, strength, eco } = evidence;
  return {
    evidenceClass: evidence.evidence_class,
    statement: statement ?? evidence.statement ?? null,
    source: source?.database
      ? {
          database: source.database,
          recordId: source.record_id ?? null,
          release: source.release ?? null,
          retrievedAt: source.retrieved_at ?? null,
          url: source.url ?? null,
          license: source.license ?? null,
        }
      : null,
    strength:
      strength && strength.value !== null && strength.value !== undefined
        ? {
            scheme: strength.scheme,
            value: String(strength.value),
            rank: strength.rank ?? null,
            maxRank: strength.max_rank ?? null,
          }
        : null,
    method: eco ? `${eco.id}${eco.label ? `, ${eco.label}` : ""}` : null,
    modifiers: evidence.modifiers,
  };
}
