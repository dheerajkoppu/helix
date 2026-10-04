import {
  isRecord,
  readBoolean,
  readList,
  readNumber,
  readStrings,
  readText,
  verbatim,
  type LabEvent,
  type LooseRecord,
} from "@/components/lab/types";

/** The seven positions of the discovery loop, in order. */
export const LOOP_STAGES = [
  { id: "question", number: 1, label: "Question" },
  { id: "evidence", number: 2, label: "Evidence" },
  { id: "hypothesis", number: 3, label: "Hypothesis" },
  { id: "experiment", number: 4, label: "Experiment" },
  { id: "result", number: 5, label: "Result" },
  { id: "decision", number: 6, label: "Updated decision" },
  { id: "candidates", number: 7, label: "Candidates" },
] as const;

export type LoopStageId = (typeof LOOP_STAGES)[number]["id"];

const STAGE_OF_TYPE: Record<string, LoopStageId> = {
  objective: "question",
  evidence: "evidence",
  gap: "evidence",
  hypothesis: "hypothesis",
  test_candidate: "experiment",
  plan: "experiment",
  approval_request: "experiment",
  approval_decision: "experiment",
  experiment_started: "experiment",
  experiment_result: "result",
  interpretation: "result",
  decision: "decision",
  next_experiment: "decision",
  target_rationale: "candidates",
  candidate: "candidates",
};

const STAGE_OF_NOTE_KIND: Record<string, LoopStageId> = {
  safety_review: "experiment",
  reopened_assumption: "hypothesis",
  final_report: "decision",
  candidates_proposed: "candidates",
  candidate_review: "candidates",
  candidate_rejected: "candidates",
};

/** Handoffs and plain notes belong to no stage; they are read in the timeline. */
export function stageOfEvent(event: LabEvent): LoopStageId | null {
  if (event.type === "note") {
    const kind = readText(event.payload.kind);
    return kind ? (STAGE_OF_NOTE_KIND[kind] ?? null) : null;
  }
  return STAGE_OF_TYPE[event.type] ?? null;
}

/** True when the page shows the event as a row of its own, which the timeline can link to. */
export const hasEntry = (event: LabEvent): boolean =>
  stageOfEvent(event) !== null ||
  (event.type === "note" && readText(event.payload.kind) === "policy_denial");

export interface Scored {
  value: number | null;
  reasoning: string | null;
}

export interface EvidenceEntry {
  id: string;
  statement: string | null;
  evidence_class: string | null;
  strength: string | null;
  event: LabEvent;
}

export interface GapEntry {
  id: string | null;
  statement: string | null;
  why_it_matters: string | null;
  event: LabEvent;
}

export interface HypothesisEntry {
  id: string;
  statement: string | null;
  mechanism_class: string | null;
  supports: string[];
  would_refute: string | null;
  label: string | null;
  /** 1 is the hypothesis the starting evidence favoured most */
  starting_rank: number | null;
  rank_rationale: string | null;
  event: LabEvent;
  /** seq of earlier events that stated the same hypothesis id */
  revises: number[];
}

export interface TestEntry {
  id: string;
  test_kind: string | null;
  /** the one tool that executes the test */
  tool: string | null;
  controls: string[];
  round: number | null;
  description: string | null;
  tests_hypotheses: string[];
  expected_learning: Scored;
  feasibility: Scored;
  cost: { compute_seconds: number | null; tool_calls: number | null };
  requires_approval: boolean | null;
  event: LabEvent;
}

export interface PlanEntry {
  chosen_test_id: string | null;
  rationale: string | null;
  rejected: Array<{ test_id: string; reason: string | null }>;
  budget_remaining: Array<{ key: string; value: string }>;
  round: number | null;
  event: LabEvent;
}

export interface ApprovalEntry {
  id: string;
  action: string | null;
  reason: string | null;
  risk: string | null;
  test_id: string | null;
  tool: string | null;
  request: LabEvent;
  decision: {
    decision: string | null;
    by: string | null;
    note: string | null;
    event: LabEvent;
  } | null;
}

export interface ResultEntry {
  test_id: string | null;
  test_kind: string | null;
  summary: string | null;
  values: LooseRecord;
  controls: string[];
  limitations: string[];
  elapsed_seconds: number | null;
  job_id: string | null;
  manifest_url: string | null;
  result_url: string | null;
  reproducible_command: string | null;
  event: LabEvent;
}

export interface InterpretationEntry {
  test_id: string | null;
  per_hypothesis: Array<{
    id: string;
    verdict: string | null;
    why: string | null;
  }>;
  uncertainty: string | null;
  event: LabEvent;
}

export interface DecisionEntry {
  /** mechanism class, or whatever the record wrote */
  favoured_before: string | null;
  favoured_after: string | null;
  favoured_before_hypothesis: string | null;
  favoured_after_hypothesis: string | null;
  changed: boolean | null;
  why: string | null;
  after_test_id: string | null;
  round: number | null;
  event: LabEvent;
}

export interface NextExperimentEntry {
  description: string | null;
  kind: string | null;
  why_now: string | null;
  event: LabEvent;
}

export interface SafetyReviewEntry {
  test_id: string | null;
  /** cleared or blocked */
  verdict: string | null;
  findings: string | null;
  requires_approval: boolean | null;
  event: LabEvent;
}

export interface ReopeningEntry {
  hypothesis_id: string | null;
  reason: string | null;
  event: LabEvent;
}

export interface PolicyDenialEntry {
  policy: string | null;
  calling_agent: string | null;
  tool: string | null;
  reason: string | null;
  event: LabEvent;
}

export interface ReportEntry {
  text: string | null;
  file: string | null;
  event: LabEvent;
}

/** What the lab decided a molecule would have to do, and why. */
export interface TargetRationaleEntry {
  id: string;
  what_to_act_on: string | null;
  why: string | null;
  mechanism_class: string | null;
  /** gain_of_function, loss_of_function and so on, as the catalogue states it */
  direction: string | null;
  required_actions: string[];
  rule: string | null;
  event: LabEvent;
}

/** One step of a bridge: a claim with the records behind it. */
export interface BridgeStep {
  statement: string | null;
  records: string[];
}

/**
 * A candidate the lab recorded: a molecule, the protein it acts on, how it was reached and whether its
 * direction of effect matches what the mechanism needs. Always a Helix hypothesis, never a recommendation.
 */
export interface CandidateEntry {
  id: string;
  rank: number | null;
  target: {
    accession: string | null;
    gene_symbol: string | null;
    name: string | null;
    relation: string | null;
  };
  molecule: {
    name: string | null;
    chembl_id: string | null;
    inchikey: string | null;
    modality: string | null;
    max_phase: number | null;
    action_type: string | null;
  } | null;
  bridge: {
    kind: string | null;
    from_disease: string | null;
    steps: BridgeStep[];
  };
  direction_check: {
    /** the actions the mechanism needs, as the direction rule derived them */
    required: string[];
    molecule_action: string | null;
    verdict: string | null;
    why: string | null;
  };
  structure: {
    structure_id: string | null;
    pocket_id: string | null;
    similar_to: string | null;
  } | null;
  caveats: string[];
  what_would_have_to_be_true: string | null;
  label: string | null;
  event: LabEvent;
}

/** A molecule the direction filter refused, with the reason the record gives. */
export interface RuledOutEntry {
  molecule: string | null;
  target: string | null;
  reason_code: string | null;
  reason: string | null;
  direction_verdict: string | null;
  event: LabEvent;
}

export interface RecordView {
  events: LabEvent[];
  objective: { statement: string | null; event: LabEvent } | null;
  evidence: EvidenceEntry[];
  gaps: GapEntry[];
  hypotheses: HypothesisEntry[];
  tests: TestEntry[];
  /** every plan in record order; the last one is in force */
  plans: PlanEntry[];
  approvals: ApprovalEntry[];
  experimentStarted: LabEvent[];
  results: ResultEntry[];
  interpretations: InterpretationEntry[];
  decisions: DecisionEntry[];
  nextExperiments: NextExperimentEntry[];
  safetyReviews: SafetyReviewEntry[];
  /** what the lab decided a molecule would have to do to the protein */
  targetRationales: TargetRationaleEntry[];
  /** candidates the safety review cleared, strongest bridge first */
  candidates: CandidateEntry[];
  /** molecules the direction filter refused, which is the evidence the filter works */
  ruledOut: RuledOutEntry[];
  /** assumptions the lab opened again after a result contradicted them */
  reopenings: ReopeningEntry[];
  report: ReportEntry | null;
  /** tool calls a policy refused, as the policy wrote them to the record */
  policyDenials: PolicyDenialEntry[];
  /** stage of the latest staged event; null before the first one */
  stage: LoopStageId | null;
  /** events recorded per stage */
  stageCounts: Record<LoopStageId, number>;
  /**
   * Times a stage was opened again: a hypothesis the lab recorded as a reopened assumption, and a
   * new plan made after such a reopening. Evidence added after a result is an update, not a reopening.
   */
  reopened: Record<LoopStageId, number>;
  /** distinct databases cited by evidence items and test results */
  databases: string[];
}

/** A 0-1 estimate with its reasoning, wherever the agent put the reasoning. */
function readScored(payload: LooseRecord, key: string): Scored {
  const raw = payload[key];
  const sibling =
    readText(payload[`${key}_reasoning`]) ??
    readText(payload[`${key}_why`]) ??
    readText(payload[`${key}_rationale`]);
  if (typeof raw === "number")
    return { value: readNumber(raw), reasoning: sibling };
  if (isRecord(raw)) {
    return {
      value: readNumber(raw.value ?? raw.score ?? raw.estimate),
      reasoning:
        readText(raw.reasoning) ??
        readText(raw.why) ??
        readText(raw.rationale) ??
        readText(raw.reason) ??
        sibling,
    };
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed)
      ? {
          value: parsed,
          reasoning:
            sibling ?? readText(raw.replace(/^[\s\d.]+[:,;-]?\s*/, "")),
        }
      : { value: null, reasoning: raw };
  }
  return { value: null, reasoning: sibling };
}

/** Key and value rows of an object, values printed verbatim. A bare value gets the given key. */
export function toRows(
  value: unknown,
  bareKey = "value",
): Array<{ key: string; value: string }> {
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => ({ key, value: verbatim(entry) }))
      .filter(
        (row): row is { key: string; value: string } => row.value !== null,
      );
  }
  const printed = verbatim(value);
  return printed === null ? [] : [{ key: bareKey, value: printed }];
}

const emptyCounts = (): Record<LoopStageId, number> => ({
  question: 0,
  evidence: 0,
  hypothesis: 0,
  experiment: 0,
  result: 0,
  decision: 0,
  candidates: 0,
});

/**
 * Everything the run page shows, derived from the record alone. Passing a prefix of the events
 * gives the state of the run at that step, which is how a replay is rendered.
 */
export function buildRecordView(events: LabEvent[]): RecordView {
  const view: RecordView = {
    events,
    objective: null,
    evidence: [],
    gaps: [],
    hypotheses: [],
    tests: [],
    plans: [],
    approvals: [],
    experimentStarted: [],
    results: [],
    interpretations: [],
    decisions: [],
    nextExperiments: [],
    safetyReviews: [],
    targetRationales: [],
    candidates: [],
    ruledOut: [],
    reopenings: [],
    report: null,
    policyDenials: [],
    stage: null,
    stageCounts: emptyCounts(),
    reopened: emptyCounts(),
    databases: [],
  };
  const databases = new Set<string>();
  const hypotheses = new Map<string, HypothesisEntry>();
  const tests = new Map<string, TestEntry>();
  const approvals = new Map<string, ApprovalEntry>();
  let reopenedSincePlan = false;

  for (const event of events) {
    // the lab counts a database as cited when an evidence item or a test result names it
    if (event.type === "evidence" || event.type === "experiment_result")
      for (const source of event.sources) databases.add(source.database);
    const payload = event.payload;
    const stage = stageOfEvent(event);
    if (stage) {
      view.stageCounts[stage] += 1;
      view.stage = stage;
    }

    switch (event.type) {
      case "objective":
        view.objective = {
          statement:
            readText(payload.objective) ??
            readText(payload.statement) ??
            readText(payload.question) ??
            readText(payload.text),
          event,
        };
        break;
      case "evidence":
        view.evidence.push({
          id: readText(payload.id) ?? `seq ${event.seq}`,
          statement: readText(payload.statement),
          evidence_class: readText(payload.evidence_class),
          strength: verbatim(payload.strength),
          event,
        });
        break;
      case "gap":
        view.gaps.push({
          id: readText(payload.id),
          statement:
            readText(payload.statement) ??
            readText(payload.description) ??
            readText(payload.summary),
          why_it_matters: readText(payload.why_it_matters),
          event,
        });
        break;
      case "hypothesis": {
        const id = readText(payload.id) ?? `seq ${event.seq}`;
        const earlier = hypotheses.get(id);
        hypotheses.set(id, {
          id,
          statement: readText(payload.statement),
          mechanism_class: readText(payload.mechanism_class),
          supports: readStrings(payload.supports),
          would_refute: verbatim(payload.would_refute),
          label: readText(payload.label),
          starting_rank: readNumber(payload.starting_rank),
          rank_rationale: readText(payload.rank_rationale),
          event,
          revises: earlier ? [...earlier.revises, earlier.event.seq] : [],
        });
        break;
      }
      case "test_candidate": {
        const id = readText(payload.id) ?? `seq ${event.seq}`;
        const cost = isRecord(payload.cost) ? payload.cost : {};
        tests.set(id, {
          id,
          test_kind: readText(payload.test_kind),
          tool: readText(payload.tool),
          controls: readStrings(payload.controls, ["description", "name"]),
          round: readNumber(payload.round),
          description: readText(payload.description),
          tests_hypotheses: readStrings(payload.tests_hypotheses),
          expected_learning: readScored(payload, "expected_learning"),
          feasibility: readScored(payload, "feasibility"),
          cost: {
            compute_seconds: readNumber(cost.compute_seconds),
            tool_calls: readNumber(cost.tool_calls),
          },
          requires_approval: readBoolean(payload.requires_approval),
          event,
        });
        break;
      }
      case "plan":
        if (reopenedSincePlan) {
          view.reopened.experiment += 1;
          reopenedSincePlan = false;
        }
        view.plans.push({
          chosen_test_id: readText(payload.chosen_test_id),
          rationale: readText(payload.rationale),
          rejected: readList(payload.rejected)
            .map((entry) =>
              isRecord(entry)
                ? {
                    test_id: readText(entry.test_id) ?? readText(entry.id),
                    reason: readText(entry.reason),
                  }
                : { test_id: readText(entry), reason: null },
            )
            .filter(
              (entry): entry is { test_id: string; reason: string | null } =>
                entry.test_id !== null,
            ),
          budget_remaining: toRows(payload.budget_remaining, "remaining"),
          round: readNumber(payload.round),
          event,
        });
        break;
      case "approval_request": {
        const id = readText(payload.id) ?? `seq ${event.seq}`;
        approvals.set(id, {
          id,
          action: readText(payload.action),
          reason: readText(payload.reason),
          risk: verbatim(payload.risk),
          test_id: readText(payload.test_id),
          tool: readText(payload.tool),
          request: event,
          decision: null,
        });
        break;
      }
      case "approval_decision": {
        const id = readText(payload.id);
        const request = id ? approvals.get(id) : undefined;
        if (request) {
          request.decision = {
            decision: readText(payload.decision),
            by: readText(payload.by),
            note: readText(payload.note),
            event,
          };
        }
        break;
      }
      case "experiment_started":
        view.experimentStarted.push(event);
        break;
      case "experiment_result":
        view.results.push({
          test_id: readText(payload.test_id),
          test_kind: readText(payload.test_kind),
          summary: readText(payload.summary),
          values: isRecord(payload.values) ? payload.values : {},
          controls: readStrings(payload.controls, ["description", "name"]),
          limitations: readStrings(payload.limitations, [
            "description",
            "name",
          ]),
          elapsed_seconds: readNumber(payload.elapsed_seconds),
          job_id: readText(payload.job_id),
          manifest_url: readText(payload.manifest_url),
          result_url: readText(payload.result_url),
          reproducible_command: readText(payload.reproducible_command),
          event,
        });
        break;
      case "interpretation":
        view.interpretations.push({
          test_id: readText(payload.test_id),
          per_hypothesis: readList(payload.per_hypothesis)
            .filter(isRecord)
            .map((entry) => ({
              id: readText(entry.id) ?? "",
              verdict: readText(entry.verdict),
              why: readText(entry.why),
            }))
            .filter((entry) => entry.id.length > 0),
          uncertainty: verbatim(payload.uncertainty),
          event,
        });
        break;
      case "decision":
        view.decisions.push({
          favoured_before: readText(payload.favoured_before),
          favoured_after: readText(payload.favoured_after),
          favoured_before_hypothesis: readText(
            payload.favoured_before_hypothesis,
          ),
          favoured_after_hypothesis: readText(
            payload.favoured_after_hypothesis,
          ),
          changed: readBoolean(payload.changed),
          why: readText(payload.why),
          after_test_id: readText(payload.after_test_id),
          round: readNumber(payload.round),
          event,
        });
        break;
      case "next_experiment":
        view.nextExperiments.push({
          description: readText(payload.description),
          kind: readText(payload.kind),
          why_now: readText(payload.why_now),
          event,
        });
        break;
      case "target_rationale":
        view.targetRationales.push({
          id: readText(payload.id) ?? "",
          what_to_act_on: readText(payload.what_to_act_on),
          why: readText(payload.why),
          mechanism_class: readText(payload.mechanism_class),
          direction: readText(payload.direction),
          required_actions: readStrings(payload.required_actions),
          rule: readText(payload.rule),
          event,
        });
        break;
      case "candidate": {
        const target = isRecord(payload.target) ? payload.target : {};
        const molecule = isRecord(payload.molecule) ? payload.molecule : null;
        const bridge = isRecord(payload.bridge) ? payload.bridge : {};
        const check = isRecord(payload.direction_check)
          ? payload.direction_check
          : {};
        const structure = isRecord(payload.structure)
          ? payload.structure
          : null;
        const similar = isRecord(structure?.similar_to)
          ? structure.similar_to
          : null;
        const fromDisease = isRecord(bridge.from_disease)
          ? bridge.from_disease
          : null;
        view.candidates.push({
          id: readText(payload.id) ?? "",
          rank: readNumber(payload.rank),
          target: {
            accession: readText(target.accession),
            gene_symbol: readText(target.gene_symbol),
            name: readText(target.name),
            relation: readText(target.relation),
          },
          molecule: molecule
            ? {
                name: readText(molecule.name),
                chembl_id: readText(molecule.chembl_id),
                inchikey: readText(molecule.inchikey),
                modality: readText(molecule.modality),
                max_phase: readNumber(molecule.max_phase),
                action_type: readText(molecule.action_type),
              }
            : null,
          bridge: {
            kind: readText(bridge.kind),
            from_disease: fromDisease
              ? (readText(fromDisease.name) ?? readText(fromDisease.id))
              : readText(bridge.from_disease),
            steps: readList(bridge.steps)
              .filter(isRecord)
              .map((step) => ({
                statement: readText(step.statement),
                records: readStrings(step.records),
              })),
          },
          direction_check: {
            required: readStrings(check.required),
            molecule_action: readText(check.molecule_action),
            verdict: readText(check.verdict),
            why: readText(check.why),
          },
          structure: structure
            ? {
                structure_id: readText(structure.structure_id),
                pocket_id: readText(structure.pocket_id),
                similar_to: similar
                  ? (readText(similar.gene_symbol) ??
                    readText(similar.accession) ??
                    readText(similar.structure_id))
                  : readText(structure.similar_to),
              }
            : null,
          caveats: readStrings(payload.caveats),
          what_would_have_to_be_true: readText(
            payload.what_would_have_to_be_true,
          ),
          label: readText(payload.label),
          event,
        });
        break;
      }
      case "note": {
        const kind = readText(payload.kind);
        if (kind === "candidate_rejected") {
          view.ruledOut.push({
            molecule: readText(payload.molecule),
            target: readText(payload.target),
            reason_code: readText(payload.reason_code),
            reason: readText(payload.reason),
            direction_verdict: readText(payload.direction_verdict),
            event,
          });
        } else if (kind === "safety_review") {
          view.safetyReviews.push({
            test_id: readText(payload.test_id),
            verdict: readText(payload.verdict),
            findings: readText(payload.findings),
            requires_approval: readBoolean(payload.requires_approval),
            event,
          });
        } else if (kind === "reopened_assumption") {
          view.reopened.hypothesis += 1;
          reopenedSincePlan = true;
          view.reopenings.push({
            hypothesis_id: readText(payload.hypothesis_id),
            reason: readText(payload.reason),
            event,
          });
        } else if (kind === "final_report") {
          view.report = {
            text: readText(payload.text),
            file: readText(payload.file),
            event,
          };
        } else if (kind === "policy_denial") {
          view.policyDenials.push({
            policy: readText(payload.policy),
            calling_agent: readText(payload.calling_agent),
            tool: readText(payload.tool),
            reason: readText(payload.text) ?? readText(payload.reason),
            event,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  view.hypotheses = [...hypotheses.values()];
  view.tests = [...tests.values()];
  view.approvals = [...approvals.values()];
  view.databases = [...databases].sort((left, right) =>
    left.localeCompare(right),
  );
  return view;
}

/** One line for the timeline: what the event says, in the agent's own words where it wrote any. */
export function summariseEvent(event: LabEvent): string | null {
  const payload = event.payload;
  switch (event.type) {
    case "handoff":
      return readText(payload.summary);
    case "objective":
      return (
        readText(payload.objective) ??
        readText(payload.statement) ??
        readText(payload.question) ??
        readText(payload.text)
      );
    case "evidence":
    case "gap":
    case "hypothesis":
      return (
        readText(payload.statement) ??
        readText(payload.description) ??
        readText(payload.summary)
      );
    case "test_candidate":
      return readText(payload.description);
    case "plan": {
      const chosen = readText(payload.chosen_test_id);
      const rationale = readText(payload.rationale);
      return [chosen ? `Chose ${chosen}.` : null, rationale]
        .filter(Boolean)
        .join(" ");
    }
    case "approval_request":
      return readText(payload.action) ?? readText(payload.reason);
    case "approval_decision": {
      const decision = readText(payload.decision);
      const by = readText(payload.by);
      const note = readText(payload.note);
      return [decision ? `${decision}${by ? ` by ${by}` : ""}.` : null, note]
        .filter(Boolean)
        .join(" ");
    }
    case "experiment_started": {
      const stated = readText(payload.summary) ?? readText(payload.description);
      if (stated) return stated;
      const testId = readText(payload.test_id);
      const tool = readText(payload.tool);
      return testId
        ? `Started ${testId}${tool ? ` through ${tool}` : ""}.`
        : null;
    }
    case "experiment_result":
      return readText(payload.summary);
    case "interpretation": {
      const verdicts = readList(payload.per_hypothesis)
        .filter(isRecord)
        .map((entry) => {
          const id = readText(entry.id);
          const verdict = readText(entry.verdict);
          return id && verdict ? `${id} ${verdict}` : null;
        })
        .filter(Boolean);
      return verdicts.length
        ? verdicts.join(", ")
        : verbatim(payload.uncertainty);
    }
    case "decision": {
      const changed = readBoolean(payload.changed);
      const why = readText(payload.why);
      const head =
        changed === null
          ? null
          : changed
            ? "Decision changed."
            : "Decision unchanged.";
      return [head, why].filter(Boolean).join(" ");
    }
    case "next_experiment":
      return readText(payload.description);
    case "target_rationale":
      return readText(payload.what_to_act_on);
    case "candidate": {
      const molecule = isRecord(payload.molecule) ? payload.molecule : {};
      const target = isRecord(payload.target) ? payload.target : {};
      const bridge = isRecord(payload.bridge) ? payload.bridge : {};
      const head = [
        readText(molecule.name),
        readText(target.gene_symbol)
          ? `on ${readText(target.gene_symbol)}`
          : null,
        readText(bridge.kind),
      ]
        .filter(Boolean)
        .join(" ");
      return (
        [head || null, readText(payload.what_would_have_to_be_true)]
          .filter(Boolean)
          .join(". ") || null
      );
    }
    default: {
      const kind = readText(payload.kind);
      if (kind === "candidate_review") {
        const verdict = readText(payload.verdict);
        return [
          verdict ? `Candidate review ${verdict}.` : null,
          readText(payload.findings),
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (kind === "candidate_rejected")
        return [readText(payload.molecule), readText(payload.reason)]
          .filter(Boolean)
          .join(": ");
      if (kind === "candidates_proposed") return readText(payload.text);
      if (kind === "final_report")
        return `Final report written${readText(payload.file) ? ` to ${readText(payload.file)}` : ""}.`;
      if (kind === "safety_review") {
        const verdict = readText(payload.verdict);
        const testId = readText(payload.test_id);
        return [
          verdict && testId ? `${testId} ${verdict}.` : null,
          readText(payload.findings),
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (kind === "policy_denial") {
        const policy = readText(payload.policy);
        const tool = readText(payload.tool);
        return [
          policy && tool ? `${policy} denied ${tool}.` : null,
          readText(payload.text),
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (kind === "reopened_assumption") {
        const hypothesisId = readText(payload.hypothesis_id);
        return [
          hypothesisId ? `Reopened ${hypothesisId}.` : null,
          readText(payload.reason),
        ]
          .filter(Boolean)
          .join(" ");
      }
      return (
        readText(payload.summary) ??
        readText(payload.text) ??
        readText(payload.reason) ??
        readText(payload.findings) ??
        readText(payload.message) ??
        readText(payload.note)
      );
    }
  }
}

export interface OverallOutcome {
  before: { hypothesisId: string | null; value: string | null };
  after: { hypothesisId: string | null; value: string | null };
  changed: boolean;
  rounds: number;
}

/**
 * The run's answer to its own question: what the starting evidence favoured against what is
 * favoured after the last recorded decision. Null until a decision is on record.
 */
export function overallOutcome(view: RecordView): OverallOutcome | null {
  const first = view.decisions[0];
  const last = view.decisions.at(-1);
  if (!first || !last) return null;
  const before = {
    hypothesisId: first.favoured_before_hypothesis,
    value: first.favoured_before,
  };
  const after = {
    hypothesisId: last.favoured_after_hypothesis,
    value: last.favoured_after,
  };
  const comparable =
    before.hypothesisId !== null && after.hypothesisId !== null
      ? before.hypothesisId !== after.hypothesisId
      : before.value !== after.value;
  return {
    before,
    after,
    changed:
      view.decisions.length === 1 && last.changed !== null
        ? last.changed
        : comparable,
    rounds: view.decisions.length,
  };
}
