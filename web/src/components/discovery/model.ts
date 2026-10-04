/**
 * Reading the candidates response. Everything the screen prints passes through here, so a field the
 * API renames or sends as a bare string degrades to "not stated" instead of breaking the page.
 * Nothing in this file invents a fact: it only picks, names and orders what the response carries.
 */

import {
  DISCOVERY_WORDS,
  plainAffinity,
  plainAffinityDetail,
  plainBridge,
  plainDrugKind,
  plainBridgeMeaning,
  plainIndication,
  plainPhase,
  plainMoleculeAction,
  plainRuledOutReason,
} from "@/lib/plain-language";
import type {
  CandidateMolecule,
  CandidateTarget,
  DiscoveryCandidate,
  DiscoveryCandidatesResponse,
  RuledOutRow,
  WithheldEdge,
} from "@/lib/workspace-data";

const trimmed = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** A molecule or target that may have arrived as a bare string. */
function refName(value: unknown): string | null {
  if (typeof value === "string") return trimmed(value);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    trimmed(record.name) ??
    trimmed(record.gene_symbol) ??
    trimmed(record.label) ??
    trimmed(record.chembl_id) ??
    trimmed(record.accession) ??
    trimmed(record.inchikey)
  );
}

const asMolecule = (value: unknown): CandidateMolecule | null =>
  value && typeof value === "object" ? (value as CandidateMolecule) : null;

const asTarget = (value: unknown): CandidateTarget | null =>
  value && typeof value === "object" ? (value as CandidateTarget) : null;

/** What the candidate is aimed at: the gene symbol, else the protein name, else the accession. */
export function targetName(target: CandidateTarget | null | undefined): string {
  return (
    trimmed(target?.gene_symbol) ??
    trimmed(target?.name) ??
    trimmed(target?.accession) ??
    "Not stated"
  );
}

/** The molecule's name, or the honest absence when the candidate is a target only. */
export function moleculeName(
  molecule: CandidateMolecule | null | undefined,
): string {
  return (
    trimmed(molecule?.name) ??
    trimmed(molecule?.chembl_id) ??
    trimmed(molecule?.inchikey) ??
    DISCOVERY_WORDS.noMolecule
  );
}

export interface CandidateRow {
  candidate: DiscoveryCandidate;
  id: string;
  rank: number;
  /** the molecule's name, or "No molecule yet" */
  title: string;
  hasMolecule: boolean;
  target: string;
  bridgeKind: string | null;
  /** "Same protein" */
  bridgeTag: string;
  /** one plain sentence: "Blocks the same overactive protein; approved for a blood cancer" */
  summary: string;
  verdict: string;
  /** the summary's own direction note, when the verdict is not a clean match */
  unknownDirection: boolean;
  caveats: string[];
  /** the bridge names a structure, so the pocket can be shown in 3D */
  structural: boolean;
  /** a look-alike protein is named too, so both pockets can be superposed */
  twoPockets: boolean;
}

/**
 * The row's one sentence, composed from the fields and the dictionary rather than from the API's
 * own statement: a backend sentence is a claim with its own evidence and belongs in the chain, and
 * printing it here would put database prose in a headline. Never a sentence about efficacy.
 */
function bridgeSummary(candidate: DiscoveryCandidate): string {
  const from = plainIndication(refName(candidate.bridge?.from_disease));
  const used = from ? ` Used for ${from}.` : "";
  if (!candidate.molecule) {
    const meaning = plainBridgeMeaning(
      candidate.bridge?.kind ?? candidate.target?.relation,
    );
    return meaning
      ? `${meaning} ${DISCOVERY_WORDS.targetOnly}`
      : DISCOVERY_WORDS.targetOnly;
  }
  const action = plainMoleculeAction(candidate.molecule.action_type);
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}.${used}`;
}

export function candidateRows(
  candidates: readonly DiscoveryCandidate[],
): CandidateRow[] {
  return candidates.map((candidate, index) => {
    const verdict = trimmed(candidate.direction_check?.verdict) ?? "unknown";
    const kind =
      trimmed(candidate.bridge?.kind) ?? trimmed(candidate.target?.relation);
    return {
      candidate,
      id: candidate.id ?? `candidate-${index}`,
      rank: candidate.rank ?? index + 1,
      title: moleculeName(candidate.molecule),
      hasMolecule: Boolean(candidate.molecule),
      target: targetName(candidate.target),
      bridgeKind: kind,
      bridgeTag: plainBridge(kind),
      summary: bridgeSummary(candidate),
      verdict,
      unknownDirection: verdict !== "matches",
      caveats: (candidate.caveats ?? []).filter(
        (caveat): caveat is string => typeof caveat === "string",
      ),
      // a 3D view is offered whenever the bridge names a structure, with or without a look-alike
      structural: Boolean(candidate.structure?.structure_id),
      twoPockets: Boolean(candidate.structure?.similar_to?.structure_id),
    };
  });
}

export interface RuledOutDisplay {
  key: string;
  molecule: string;
  target: string;
  /** one plain sentence: what it would have done and why that is wrong here */
  reason: string;
  /** the engine's own longer explanation, kept for Details and Advanced */
  detail: string | null;
  row: RuledOutRow;
}

/**
 * The ruled-out list. The sentence on the row is composed here from the dictionary so every row
 * reads the same way in a few words; the engine's own longer explanation is kept beside it and
 * shown on demand, never dropped.
 */
export function ruledOutRows(
  rows: readonly RuledOutRow[],
  subject: { fault?: string | null } = {},
): RuledOutDisplay[] {
  return rows.map((row, index) => {
    const molecule = asMolecule(row.molecule);
    const name = refName(row.molecule) ?? "A molecule";
    // the gene symbol, not the long protein name, is what a reader recognises
    const target = asTarget(row.target)
      ? targetName(asTarget(row.target))
      : (refName(row.target) ?? "this protein");
    return {
      key: `${name}-${target}-${index}`,
      molecule: name,
      target,
      reason: plainRuledOutReason({
        molecule: name,
        target,
        actionType: molecule?.action_type ?? null,
        fault: subject.fault ?? null,
      }),
      detail: trimmed(row.reason),
      row,
    };
  });
}

/** One hidden edge as a sentence, preferring the backend's own. */
export function withheldEdgeLine(edge: WithheldEdge): string {
  const stated =
    trimmed(edge.detail) ?? trimmed(edge.statement) ?? trimmed(edge.reason);
  if (stated) return stated;
  const molecule = trimmed(edge.molecule_name) ?? refName(edge.molecule);
  const disease = trimmed(edge.disease_name) ?? refName(edge.disease);
  const target = refName(edge.target);
  const parts = [
    molecule,
    disease ? `for ${disease}` : null,
    target ? `on ${target}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return parts || "An edge was withheld.";
}

/** The subject's fault as the API keys it, for the wording of a missing ruled-out reason. */
export function subjectFault(
  data: DiscoveryCandidatesResponse | null | undefined,
): string | null {
  return (
    data?.subject?.mechanism?.class ??
    data?.subject?.mechanism?.direction ??
    null
  );
}

/** Advanced rows for one molecule: identifiers, action type, affinity, modality and phase. */
export interface MoleculeFact {
  label: string;
  value: string;
  mono?: boolean;
}

export function moleculeFacts(
  molecule: CandidateMolecule | null | undefined,
): MoleculeFact[] {
  if (!molecule) return [];
  const facts: MoleculeFact[] = [];
  if (molecule.chembl_id)
    facts.push({ label: "ChEMBL", value: molecule.chembl_id, mono: true });
  if (molecule.inchikey)
    facts.push({ label: "InChIKey", value: molecule.inchikey, mono: true });
  if (molecule.action_type)
    facts.push({ label: "Action type", value: molecule.action_type });
  if (molecule.modality)
    facts.push({ label: "Modality", value: plainDrugKind(molecule.modality) });
  const phase = plainPhase(molecule.max_phase ?? null);
  if (phase)
    facts.push({
      label: "Highest phase",
      value:
        molecule.max_phase != null
          ? `${phase} (phase ${molecule.max_phase})`
          : phase,
    });
  // moleculeFacts is the Advanced block, so the numbers are printed in full
  const affinity = molecule.measured_affinity
    ? (plainAffinityDetail(molecule.measured_affinity) ??
      plainAffinity(molecule.measured_affinity))
    : null;
  if (affinity)
    facts.push({ label: DISCOVERY_WORDS.strength, value: affinity });
  return facts;
}

/** Target rows for Advanced: accession and whatever druggability fields the API sent. */
export function targetFacts(
  target: CandidateTarget | null | undefined,
): MoleculeFact[] {
  const facts: MoleculeFact[] = [];
  if (target?.accession)
    facts.push({ label: "UniProt", value: target.accession, mono: true });
  if (target?.name) facts.push({ label: "Protein", value: target.name });
  for (const [name, value] of Object.entries(target?.druggability ?? {})) {
    if (value === null || value === undefined || typeof value === "object")
      continue;
    facts.push({ label: name.replace(/[_-]+/g, " "), value: String(value) });
  }
  return facts;
}

/**
 * Evidence badges for a row. Simple mode shows one badge per database, at most three: a reader
 * needs to see that a claim is sourced, not every record behind it. Advanced shows them all.
 */
export function badgeEvidence<
  T extends { source?: { database: string } | null },
>(evidence: readonly T[] | null | undefined, advanced: boolean): T[] {
  const list = [...(evidence ?? [])];
  if (advanced) return list;
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of list) {
    const key = item.source?.database ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.slice(0, 3);
}

export { asMolecule, asTarget, refName };
