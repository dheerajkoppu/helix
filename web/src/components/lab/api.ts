"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  isActiveStatus,
  isRecord,
  mergeEvents,
  readBoolean,
  readList,
  readNumber,
  readStrings,
  readText,
  toEvents,
  toRun,
  verbatim,
  type BenchmarkArm,
  type BenchmarkVariantRow,
  type LabAgentSpec,
  type LabBenchmark,
  type LabEvent,
  type LabPolicySpec,
  type LabRoster,
  type LabTestSpec,
  type LabRun,
  type LabRunRecord,
  type LabToolSpec,
} from "@/components/lab/types";
import { toRows } from "@/components/lab/record";
import { apiFetch, isApiError } from "@/lib/api/client";

export const labKeys = {
  runs: () => ["lab", "runs"] as const,
  run: (runId: string) => ["lab", "run", runId] as const,
  tail: (runId: string) => ["lab", "tail", runId] as const,
  agents: () => ["lab", "agents"] as const,
  benchmark: () => ["lab", "benchmark"] as const,
};

/** `served` is false when this API build has no such route (HTTP 404), which is not an error. */
export interface Served<Data> {
  served: boolean;
  data: Data;
}

async function orNotServed<Data>(
  request: Promise<Data>,
  empty: Data,
): Promise<Served<Data>> {
  try {
    return { served: true, data: await request };
  } catch (error) {
    if (isApiError(error) && error.isNotFound)
      return { served: false, data: empty };
    throw error;
  }
}

const startedAt = (run: LabRun) =>
  run.started_at ? Date.parse(run.started_at) || 0 : 0;

export function fetchRuns(signal?: AbortSignal): Promise<Served<LabRun[]>> {
  return orNotServed(
    apiFetch<unknown>("/lab/runs", { signal }).then((body) => {
      const rows = Array.isArray(body)
        ? body
        : isRecord(body)
          ? readList(body.runs ?? body.items)
          : [];
      return rows
        .map(toRun)
        .filter((run): run is LabRun => run !== null)
        .sort((left, right) => startedAt(right) - startedAt(left));
    }),
    [],
  );
}

function toRunRecord(body: unknown): LabRunRecord | null {
  if (!isRecord(body)) return null;
  const run = toRun(isRecord(body.run) ? body.run : body);
  if (!run) return null;
  return {
    run,
    events: toEvents(body.events ?? body.record),
    report: readText(body.report),
  };
}

export async function fetchRun(
  runId: string,
  signal?: AbortSignal,
): Promise<LabRunRecord> {
  const body = await apiFetch<unknown>(
    `/lab/runs/${encodeURIComponent(runId)}`,
    { signal },
  );
  const record = toRunRecord(body);
  if (!record)
    throw new Error(`The API answered for run ${runId} without a run record.`);
  return record;
}

export async function fetchEventsAfter(
  runId: string,
  after: number,
  signal?: AbortSignal,
): Promise<LabEvent[]> {
  const body = await apiFetch<unknown>(
    `/lab/runs/${encodeURIComponent(runId)}/events`,
    { query: { after }, signal },
  );
  return toEvents(
    Array.isArray(body)
      ? body
      : isRecord(body)
        ? (body.events ?? body.items)
        : [],
  ).filter((event) => event.seq > after);
}

export interface StartRunInput {
  variant_id: string;
  objective?: string;
  mode?: string;
  budget?: { max_tool_calls?: number; max_compute_seconds?: number };
}

/** Starts a run in the background and returns its id. */
export async function startRun(input: StartRunInput): Promise<string> {
  const body = await apiFetch<unknown>("/lab/runs", {
    method: "POST",
    body: input,
  });
  const runId = isRecord(body)
    ? (readText(body.run_id) ??
      (isRecord(body.run) ? readText(body.run.run_id) : null))
    : null;
  if (!runId)
    throw new Error("The API started a run without returning its id.");
  return runId;
}

export function decideApproval(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<unknown> {
  return apiFetch<unknown>(
    `/lab/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { method: "POST", body: { decision, note } },
  );
}

function toTool(raw: unknown): LabToolSpec | null {
  if (typeof raw === "string") {
    return raw.trim()
      ? { name: raw, kind: null, description: null, requires_approval: null }
      : null;
  }
  if (!isRecord(raw)) return null;
  const name = readText(raw.name) ?? readText(raw.id) ?? readText(raw.callable);
  if (!name) return null;
  return {
    name,
    kind: readText(raw.kind),
    description: readText(raw.description) ?? readText(raw.summary),
    requires_approval: readBoolean(raw.requires_approval),
  };
}

function toAgentSpec(raw: unknown): LabAgentSpec | null {
  if (!isRecord(raw)) return null;
  const id = readText(raw.id) ?? readText(raw.name) ?? readText(raw.agent);
  if (!id) return null;
  return {
    id,
    title:
      readText(raw.title) ?? readText(raw.name) ?? readText(raw.role) ?? id,
    model: readText(raw.model),
    harness: readText(raw.harness),
    decision:
      readText(raw.decision) ??
      readText(raw.decision_owned) ??
      readText(raw.owns_decision),
    inputs: readStrings(raw.inputs ?? raw.input, ["name", "description", "id"]),
    outputs: readStrings(raw.output ?? raw.outputs, [
      "name",
      "description",
      "id",
    ]),
    tools: readList(raw.tools)
      .map(toTool)
      .filter((tool): tool is LabToolSpec => tool !== null),
    orchestration_tools: readStrings(raw.orchestration_tools),
    policies: readStrings(raw.policies ?? raw.guardrails, ["id", "name"]),
    spec_path: readText(raw.spec_path),
    prompt_path: readText(raw.prompt_path),
  };
}

function toPolicySpec(raw: unknown): LabPolicySpec | null {
  if (!isRecord(raw)) return null;
  const id = readText(raw.id) ?? readText(raw.name);
  if (!id) return null;
  return {
    id,
    name: readText(raw.name),
    description: readText(raw.description) ?? readText(raw.summary),
    handler: readText(raw.handler),
    phases: readStrings(raw.phases ?? raw.phase),
  };
}

function toTestSpec(kind: string, raw: unknown): LabTestSpec | null {
  if (!isRecord(raw)) return null;
  const cost = isRecord(raw.cost) ? raw.cost : {};
  return {
    kind,
    tool: readText(raw.tool),
    title: readText(raw.title),
    measures: readText(raw.measures),
    bears_on: isRecord(raw.bears_on) ? toRows(raw.bears_on) : [],
    cost: {
      compute_seconds: readNumber(cost.compute_seconds),
      tool_calls: readNumber(cost.tool_calls),
    },
    requires_approval: readBoolean(raw.requires_approval),
    controls: readStrings(raw.controls, ["description", "name"]),
    limitations: readStrings(raw.limitations, ["description", "name"]),
  };
}

function toRoster(body: unknown): LabRoster {
  const container = isRecord(body) ? body : {};
  const orchestration = isRecord(container.orchestration)
    ? container.orchestration
    : {};
  const omnigent = isRecord(container.omnigent) ? container.omnigent : {};
  const approval = isRecord(container.approval) ? container.approval : {};
  const budget = isRecord(container.default_budget)
    ? container.default_budget
    : isRecord(container.budget)
      ? container.budget
      : {};
  const tests = isRecord(container.tests) ? container.tests : {};
  return {
    agents: readList(
      Array.isArray(body) ? body : (container.agents ?? container.items),
    )
      .map(toAgentSpec)
      .filter((agent): agent is LabAgentSpec => agent !== null),
    baseline: toAgentSpec(container.baseline),
    policies: readList(container.policies)
      .map(toPolicySpec)
      .filter((policy): policy is LabPolicySpec => policy !== null),
    orchestration: {
      framework: readText(orchestration.framework),
      version:
        readText(orchestration.version) ??
        readText(omnigent.version) ??
        readText(container.omnigent_version),
      harness: readText(orchestration.harness) ?? readText(omnigent.harness),
      dispatch: readText(orchestration.dispatch),
      bundle: readText(orchestration.bundle),
    },
    approval: {
      tools: readStrings(approval.tools_requiring_human_approval),
      how: readText(approval.how),
    },
    tests: Object.entries(tests)
      .map(([kind, raw]) => toTestSpec(kind, raw))
      .filter((test): test is LabTestSpec => test !== null),
    mechanism_classes: isRecord(container.mechanism_classes)
      ? toRows(container.mechanism_classes)
      : [],
    spec_hash: readText(container.spec_hash),
    default_budget: {
      max_tool_calls: readNumber(budget.max_tool_calls),
      max_compute_seconds: readNumber(budget.max_compute_seconds),
    },
  };
}

export function fetchRoster(
  signal?: AbortSignal,
): Promise<Served<LabRoster | null>> {
  return orNotServed<LabRoster | null>(
    apiFetch<unknown>("/lab/agents", { signal }).then(toRoster),
    null,
  );
}

function toArm(raw: unknown): BenchmarkArm | null {
  if (!isRecord(raw)) return null;
  const id = readText(raw.id);
  if (!id) return null;
  const agreement = isRecord(raw.agreement) ? raw.agreement : {};
  return {
    id,
    label: readText(raw.label),
    runs: readNumber(raw.runs),
    median_wall_seconds: readNumber(raw.median_wall_seconds),
    mean_tool_calls: readNumber(raw.mean_tool_calls),
    mean_distinct_sources: readNumber(raw.mean_distinct_sources),
    mean_evidence_items: readNumber(raw.mean_evidence_items),
    agreement: {
      n_with_reference: readNumber(agreement.n_with_reference),
      n_agree: readNumber(agreement.n_agree),
    },
    decision_changed: readNumber(raw.decision_changed),
  };
}

function toVariantRow(raw: unknown): BenchmarkVariantRow | null {
  if (!isRecord(raw)) return null;
  const variantId = readText(raw.variant_id);
  if (!variantId) return null;
  return {
    variant_id: variantId,
    arm: readText(raw.arm),
    run_id: readText(raw.run_id),
    wall_seconds: readNumber(raw.wall_seconds),
    distinct_sources: readNumber(raw.distinct_sources),
    favoured_after: readText(raw.favoured_after),
    reference_mechanism: readText(raw.reference_mechanism),
    agrees: readBoolean(raw.agrees),
    decision_changed: readBoolean(raw.decision_changed),
  };
}

function toBenchmark(body: unknown): LabBenchmark | null {
  if (!isRecord(body)) return null;
  const comparison = isRecord(body.comparison) ? body.comparison : null;
  return {
    generated_at: readText(body.generated_at),
    question: readText(body.question),
    conditions: isRecord(body.conditions) ? body.conditions : {},
    n_variants: readNumber(body.n_variants),
    arms: readList(body.arms)
      .map(toArm)
      .filter((arm): arm is BenchmarkArm => arm !== null),
    comparison: comparison
      ? {
          metric: readText(comparison.metric),
          baseline: readNumber(comparison.baseline),
          lab: readNumber(comparison.lab),
          ratio: readNumber(comparison.ratio),
          note: readText(comparison.note),
        }
      : null,
    per_variant: readList(body.per_variant)
      .map(toVariantRow)
      .filter((row): row is BenchmarkVariantRow => row !== null),
    controls: readStrings(body.controls, ["description", "name"]),
    caveats: readStrings(body.caveats, ["description", "name"]),
    next_experiment: verbatim(body.next_experiment),
  };
}

export function fetchBenchmark(
  signal?: AbortSignal,
): Promise<Served<LabBenchmark | null>> {
  return orNotServed<LabBenchmark | null>(
    apiFetch<unknown>("/lab/benchmark", { signal }).then(toBenchmark),
    null,
  );
}

const TAIL_INTERVAL_MS = 1500;
const RUN_INTERVAL_MS = 6000;

/**
 * The run and its record. While the run is active the record is extended from
 * `/events?after=<seq>` and the run itself is re-read when new events arrive.
 */
export function useRunRecord(runId: string) {
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: labKeys.run(runId),
    queryFn: ({ signal }) => fetchRun(runId, signal),
    staleTime: 0,
    refetchInterval: (query) =>
      isActiveStatus(query.state.data?.run.status) ? RUN_INTERVAL_MS : false,
  });
  const active = isActiveStatus(record.data?.run.status);

  useQuery({
    queryKey: labKeys.tail(runId),
    enabled: active,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: TAIL_INTERVAL_MS,
    queryFn: async ({ signal }) => {
      const current = queryClient.getQueryData<LabRunRecord>(
        labKeys.run(runId),
      );
      const after = current?.events.at(-1)?.seq ?? 0;
      const fresh = await fetchEventsAfter(runId, after, signal);
      if (fresh.length > 0) {
        queryClient.setQueryData<LabRunRecord>(
          labKeys.run(runId),
          (previous) =>
            previous
              ? { ...previous, events: mergeEvents(previous.events, fresh) }
              : previous,
        );
        void queryClient.invalidateQueries({
          queryKey: labKeys.run(runId),
          exact: true,
        });
      }
      return fresh.length;
    },
  });

  return record;
}
