import {
  overallOutcome,
  type EvidenceEntry,
  type HypothesisEntry,
  type RecordView,
  type ResultEntry,
} from "@/components/lab/record";
import {
  isRecord,
  readBoolean,
  readList,
  readNumber,
  readText,
} from "@/components/lab/types";
import type {
  AgentCounts,
  StepCounts,
  TestFinding,
} from "@/lib/plain-language";

/** Counts and yes-or-no findings read from the record. The wording lives in `@/lib/plain-language`. */

export interface SourceGroup {
  database: string;
  entries: EvidenceEntry[];
}

/** Evidence grouped by the database it cites, largest group first. */
export function evidenceBySource(view: RecordView): {
  groups: SourceGroup[];
  unsourced: EvidenceEntry[];
} {
  const byDatabase = new Map<string, EvidenceEntry[]>();
  const unsourced: EvidenceEntry[] = [];
  for (const entry of view.evidence) {
    const databases = new Set(
      entry.event.sources.map((source) => source.database),
    );
    if (databases.size === 0) unsourced.push(entry);
    for (const database of databases) {
      const rows = byDatabase.get(database) ?? [];
      rows.push(entry);
      byDatabase.set(database, rows);
    }
  }
  const groups = [...byDatabase.entries()]
    .map(([database, entries]) => ({ database, entries }))
    .sort(
      (left, right) =>
        right.entries.length - left.entries.length ||
        left.database.localeCompare(right.database),
    );
  return { groups, unsourced };
}

/**
 * What the caption under each loop step is built from. A run that writes no rejected row still
 * counts the molecules the direction check refused in its metrics, so that total stands in once the
 * run has said what to aim at.
 */
export function stepCounts(
  view: RecordView,
  ruledOutTotal?: number | null,
): StepCounts {
  const outcome = overallOutcome(view);
  return {
    facts: view.evidence.length,
    sources: evidenceBySource(view).groups.length,
    causes: view.hypotheses.length,
    tests: view.plans.at(-1)?.chosen_test_id ? view.tests.length : 0,
    finished: view.results.length > 0,
    changed: outcome ? outcome.changed : null,
    candidates: view.candidates.length,
    ruledOut:
      view.ruledOut.length ||
      (view.targetRationales.length ? (ruledOutTotal ?? 0) : 0),
  };
}

/** What one agent's line is built from: only its own lines of the record. */
export function agentCounts(view: RecordView, agent: string): AgentCounts {
  const own = view.evidence.filter((entry) => entry.event.agent === agent);
  const papers = new Set<string>();
  for (const entry of own)
    for (const source of entry.event.sources)
      papers.add(`${source.database}:${source.record_id ?? entry.id}`);
  const outcome = overallOutcome(view);
  return {
    papers: papers.size,
    facts: own.length,
    causes: view.hypotheses.length,
    tests: view.plans.at(-1)?.chosen_test_id ? view.tests.length : 0,
    approvals: view.approvals.length,
    results: view.results.length,
    changed: outcome ? outcome.changed : null,
    candidates: view.candidates.length,
    ruledOut: view.ruledOut.length,
  };
}

/** The causes with the one the lab favours now first, then in the order it first ranked them. */
export function rankedCauses(view: RecordView): HypothesisEntry[] {
  const favoured = view.decisions.at(-1)?.favoured_after_hypothesis ?? null;
  const rank = (hypothesis: HypothesisEntry) =>
    hypothesis.id === favoured
      ? -1
      : (hypothesis.starting_rank ?? Number.MAX_SAFE_INTEGER);
  return [...view.hypotheses].sort((left, right) => rank(left) - rank(right));
}

/** What the test found, as yes or no, from the values it recorded. */
export function findingOf(result: ResultEntry): TestFinding {
  const values = result.values;
  const verdict = readText(values.verdict);
  switch (result.test_kind) {
    case "ligand_contact": {
      const examined = readNumber(values.ligand_bound_structures_examined);
      if (examined === 0) return { touches: null };
      return { touches: readList(values.structures_with_contact).length > 0 };
    }
    case "structural_context": {
      const lists = [
        values.p2rank_pockets_containing_residue,
        values.protvar_pockets_containing_residue,
      ].filter(Array.isArray);
      return {
        pocketTools: lists.filter((list) => list.length > 0).length,
        toolsRun: lists.length,
        onSurface: readBoolean(values.in_predicted_interface),
      };
    }
    case "stability_effect": {
      const change = readNumber(values.foldx_ddg_kcal_mol);
      const threshold = readNumber(values.destabilising_threshold_kcal_mol);
      if (change !== null && threshold !== null)
        return { lessStable: change >= threshold };
      if (verdict === "predicted_destabilising") return { lessStable: true };
      if (verdict === "not_predicted_destabilising")
        return { lessStable: false };
      return { lessStable: null };
    }
    case "structure_comparison": {
      const summary = isRecord(values.summary) ? values.summary : {};
      const changed =
        readBoolean(values.local_change) ?? readBoolean(summary.local_change);
      return { shapeChanged: changed };
    }
    default:
      return {};
  }
}
