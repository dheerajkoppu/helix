/**
 * The lab's shared research record, as written to lab/runs/<run_id>/run.json and record.jsonl.
 * Field names are the backend's. Every reader is tolerant: a run in progress has not written every
 * field, so a missing value becomes null and is printed as "Unknown", never guessed.
 */

export const RUN_STATUSES = [
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ["specialist_lab", "single_agent_baseline"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const LAB_AGENTS = [
  "orchestrator",
  "literature",
  "knowledge_graph",
  "insight",
  "planner",
  "safety",
  "runner",
  "analysis",
  "translator",
  "human",
] as const;
export type LabAgent = (typeof LAB_AGENTS)[number];

export const LAB_EVENT_TYPES = [
  "objective",
  "handoff",
  "evidence",
  "gap",
  "hypothesis",
  "test_candidate",
  "plan",
  "approval_request",
  "approval_decision",
  "experiment_started",
  "experiment_result",
  "interpretation",
  "decision",
  "next_experiment",
  "target_rationale",
  "candidate",
  "note",
] as const;
export type LabEventType = (typeof LAB_EVENT_TYPES)[number];

export interface LabSource {
  database: string;
  record_id: string | null;
  url: string | null;
}

export interface LabEvent {
  seq: number;
  at: string | null;
  run_id: string | null;
  agent: string;
  type: string;
  payload: LooseRecord;
  refs: string[];
  sources: LabSource[];
}

export interface LabRun {
  run_id: string;
  objective: string | null;
  subject: {
    gene: string | null;
    variant_id: string | null;
    accession: string | null;
  };
  mode: string | null;
  status: string;
  budget: {
    max_tool_calls: number | null;
    max_compute_seconds: number | null;
  };
  started_at: string | null;
  finished_at: string | null;
  omnigent: {
    version: string | null;
    harness: string | null;
    model: string | null;
    session_id: string | null;
  };
  spec_hash: string | null;
  metrics: {
    wall_seconds: number | null;
    tool_calls: number | null;
    distinct_sources: number | null;
    evidence_items: number | null;
    hypotheses: number | null;
    tests_considered: number | null;
    approvals: number | null;
    tests_executed: number | null;
    compute_seconds: number | null;
    policy_denials: number | null;
    reopenings: number | null;
    candidates: number | null;
    /** molecules the direction filter refused, which the run counts from the stored responses */
    ruled_out_by_direction: number | null;
    tool_calls_by_agent: Array<{ key: string; value: string }>;
  };
  outcome: {
    favoured_before: string | null;
    favoured_after: string | null;
    decision_changed: boolean | null;
    next_experiment: string | null;
  };
  /** why the run failed, when it did */
  error: string | null;
  /** how approvals were granted for this run, e.g. pre-approved at launch */
  approval_mode: string | null;
  /** model per agent, when the run recorded it */
  models: Array<{ key: string; value: string }>;
}

export interface LabRunRecord {
  run: LabRun;
  events: LabEvent[];
  /** the final report in markdown, when the API serves one */
  report: string | null;
}

export interface LabToolSpec {
  name: string;
  /** record, retrieval or experiment, as the registry classes it */
  kind: string | null;
  description: string | null;
  requires_approval: boolean | null;
}

export interface LabAgentSpec {
  id: string;
  title: string;
  model: string | null;
  harness: string | null;
  decision: string | null;
  inputs: string[];
  outputs: string[];
  tools: LabToolSpec[];
  /** Omnigent's own dispatch tools, held by a supervisor */
  orchestration_tools: string[];
  policies: string[];
  spec_path: string | null;
  prompt_path: string | null;
}

export interface LabPolicySpec {
  id: string;
  name: string | null;
  description: string | null;
  handler: string | null;
  /** where Omnigent runs the handler: tool_call, request, response */
  phases: string[];
}

export interface LabTestSpec {
  kind: string;
  tool: string | null;
  title: string | null;
  measures: string | null;
  bears_on: Array<{ key: string; value: string }>;
  cost: { compute_seconds: number | null; tool_calls: number | null };
  requires_approval: boolean | null;
  controls: string[];
  limitations: string[];
}

export interface LabRoster {
  agents: LabAgentSpec[];
  /** the single agent of the control arm */
  baseline: LabAgentSpec | null;
  policies: LabPolicySpec[];
  orchestration: {
    framework: string | null;
    version: string | null;
    harness: string | null;
    dispatch: string | null;
    bundle: string | null;
  };
  approval: { tools: string[]; how: string | null };
  tests: LabTestSpec[];
  mechanism_classes: Array<{ key: string; value: string }>;
  spec_hash: string | null;
  default_budget: {
    max_tool_calls: number | null;
    max_compute_seconds: number | null;
  };
}

export interface BenchmarkArm {
  id: string;
  label: string | null;
  runs: number | null;
  median_wall_seconds: number | null;
  mean_tool_calls: number | null;
  mean_distinct_sources: number | null;
  mean_evidence_items: number | null;
  agreement: { n_with_reference: number | null; n_agree: number | null };
  decision_changed: number | null;
}

export interface BenchmarkVariantRow {
  variant_id: string;
  arm: string | null;
  run_id: string | null;
  wall_seconds: number | null;
  distinct_sources: number | null;
  favoured_after: string | null;
  reference_mechanism: string | null;
  agrees: boolean | null;
  decision_changed: boolean | null;
}

export interface LabBenchmark {
  generated_at: string | null;
  question: string | null;
  conditions: LooseRecord;
  n_variants: number | null;
  arms: BenchmarkArm[];
  comparison: {
    metric: string | null;
    baseline: number | null;
    lab: number | null;
    ratio: number | null;
    note: string | null;
  } | null;
  per_variant: BenchmarkVariantRow[];
  controls: string[];
  caveats: string[];
  next_experiment: string | null;
}

export type LooseRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is LooseRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  return lowered === "true" ? true : lowered === "false" ? false : null;
}

export const readList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Strings out of a list of strings or of records naming themselves by one of `keys`. */
export function readStrings(
  value: unknown,
  keys: string[] = ["name", "id"],
): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  return readList(value)
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (typeof entry === "number") return String(entry);
      if (!isRecord(entry)) return null;
      for (const key of keys) {
        const found = readText(entry[key]);
        if (found) return found;
      }
      return null;
    })
    .filter((entry): entry is string => entry !== null && entry.length > 0);
}

/** A value printed verbatim: strings as written, everything else as compact JSON. */
export function verbatim(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

export function toSource(raw: unknown): LabSource | null {
  if (!isRecord(raw)) return null;
  const database =
    readText(raw.database) ?? readText(raw.source) ?? readText(raw.name);
  if (!database) return null;
  return {
    database,
    record_id: verbatim(raw.record_id ?? raw.id),
    url: readText(raw.url),
  };
}

export function toEvent(raw: unknown, index: number): LabEvent | null {
  if (!isRecord(raw)) return null;
  return {
    seq: readNumber(raw.seq) ?? index + 1,
    at: readText(raw.at),
    run_id: readText(raw.run_id),
    agent: readText(raw.agent) ?? "unknown",
    type: readText(raw.type) ?? "note",
    payload: isRecord(raw.payload) ? raw.payload : {},
    refs: readStrings(raw.refs),
    sources: readList(raw.sources)
      .map(toSource)
      .filter((source): source is LabSource => source !== null),
  };
}

/** Events in record order, one per seq. */
export function toEvents(raw: unknown): LabEvent[] {
  const bySeq = new Map<number, LabEvent>();
  readList(raw).forEach((entry, index) => {
    const event = toEvent(entry, index);
    if (event) bySeq.set(event.seq, event);
  });
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function mergeEvents(
  current: LabEvent[],
  incoming: LabEvent[],
): LabEvent[] {
  if (incoming.length === 0) return current;
  const bySeq = new Map(current.map((event) => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function toRun(raw: unknown): LabRun | null {
  if (!isRecord(raw)) return null;
  const runId = readText(raw.run_id) ?? readText(raw.id);
  if (!runId) return null;
  const subject = isRecord(raw.subject) ? raw.subject : {};
  const budget = isRecord(raw.budget) ? raw.budget : {};
  const omnigent = isRecord(raw.omnigent) ? raw.omnigent : {};
  const metrics = isRecord(raw.metrics) ? raw.metrics : {};
  const outcome = isRecord(raw.outcome) ? raw.outcome : {};
  const nextExperiment = isRecord(outcome.next_experiment)
    ? readText(outcome.next_experiment.description)
    : readText(outcome.next_experiment);
  return {
    run_id: runId,
    objective: readText(raw.objective),
    subject: {
      gene: readText(subject.gene),
      variant_id: readText(subject.variant_id),
      accession: readText(subject.accession),
    },
    mode: readText(raw.mode),
    status: readText(raw.status) ?? "unknown",
    budget: {
      max_tool_calls: readNumber(budget.max_tool_calls),
      max_compute_seconds: readNumber(budget.max_compute_seconds),
    },
    started_at: readText(raw.started_at),
    finished_at: readText(raw.finished_at),
    omnigent: {
      version: readText(omnigent.version),
      harness: readText(omnigent.harness),
      model: readText(omnigent.model),
      session_id: readText(omnigent.session_id),
    },
    spec_hash: readText(raw.spec_hash),
    metrics: {
      wall_seconds: readNumber(metrics.wall_seconds),
      tool_calls: readNumber(metrics.tool_calls),
      distinct_sources: readNumber(metrics.distinct_sources),
      evidence_items: readNumber(metrics.evidence_items),
      hypotheses: readNumber(metrics.hypotheses),
      tests_considered: readNumber(metrics.tests_considered),
      approvals: readNumber(metrics.approvals),
      tests_executed: readNumber(metrics.tests_executed),
      compute_seconds: readNumber(metrics.compute_seconds),
      policy_denials: readNumber(metrics.policy_denials),
      reopenings: readNumber(metrics.reopenings),
      candidates: readNumber(metrics.candidates),
      ruled_out_by_direction: readNumber(metrics.ruled_out_by_direction),
      tool_calls_by_agent: isRecord(metrics.tool_calls_by_agent)
        ? Object.entries(metrics.tool_calls_by_agent)
            .map(([key, value]) => ({ key, value: verbatim(value) }))
            .filter(
              (row): row is { key: string; value: string } =>
                row.value !== null,
            )
        : [],
    },
    outcome: {
      favoured_before: readText(outcome.favoured_before),
      favoured_after: readText(outcome.favoured_after),
      decision_changed: readBoolean(outcome.decision_changed),
      next_experiment: nextExperiment,
    },
    error: verbatim(raw.error),
    approval_mode: readText(raw.approval_mode),
    models: isRecord(omnigent.models)
      ? Object.entries(omnigent.models)
          .map(([key, value]) => ({ key, value: readText(value) }))
          .filter(
            (row): row is { key: string; value: string } => row.value !== null,
          )
      : [],
  };
}

export const isActiveStatus = (status: string | null | undefined): boolean =>
  status === "running" || status === "awaiting_approval";

export const isFinishedStatus = (status: string | null | undefined): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled";
