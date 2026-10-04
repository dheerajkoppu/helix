import { cn } from "cn";

import { plainRunState, plainVerdict } from "@/lib/plain-language";

const AGENT_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator",
  literature: "Literature",
  knowledge_graph: "Knowledge graph",
  insight: "Insight",
  planner: "Planner",
  safety: "Safety",
  runner: "Runner",
  analysis: "Analysis",
  translator: "Translator",
  human: "Human",
  generalist: "Single agent",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  objective: "Objective",
  handoff: "Handoff",
  evidence: "Evidence",
  gap: "Gap",
  hypothesis: "Hypothesis",
  test_candidate: "Test candidate",
  plan: "Plan",
  approval_request: "Approval request",
  approval_decision: "Approval decision",
  experiment_started: "Experiment started",
  experiment_result: "Experiment result",
  interpretation: "Interpretation",
  decision: "Decision",
  next_experiment: "Next experiment",
  target_rationale: "Target rationale",
  candidate: "Candidate",
  note: "Note",
};

const MODE_LABEL: Record<string, string> = {
  specialist_lab: "Specialist lab",
  single_agent_baseline: "Single-agent baseline",
};

/** `ligand_binding` reads as "ligand binding"; identifiers the record wrote stay as written. */
export const humanise = (value: string): string => value.replaceAll("_", " ");

export const agentLabel = (agent: string | null | undefined): string =>
  agent ? (AGENT_LABEL[agent] ?? humanise(agent)) : "Unknown agent";

const NOTE_KIND_LABEL: Record<string, string> = {
  safety_review: "Safety review",
  reopened_assumption: "Reopened assumption",
  final_report: "Final report",
  policy_denial: "Policy denial",
};

/** A note that names its kind is labelled by it: "Safety review", "Reopened assumption". */
export function eventTypeLabel(type: string, kind?: string | null): string {
  if (type === "note" && kind) return NOTE_KIND_LABEL[kind] ?? humanise(kind);
  return EVENT_TYPE_LABEL[type] ?? humanise(type);
}

export const modeLabel = (mode: string | null | undefined): string | null =>
  mode ? (MODE_LABEL[mode] ?? humanise(mode)) : null;

/** `BTK-p.Arg28His` reads as "BTK p.Arg28His". */
export const variantLabel = (variantId: string): string =>
  variantId.replace("-p.", " p.");

const pad = (value: number) => String(value).padStart(2, "0");

/** "16:40:12" in UTC, for timeline rows. */
export function formatClockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** "2026-10-03 16:40:12 UTC" */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** A measured number as recorded: integers whole, anything else to at most `digits` decimals. */
export function formatMeasure(value: number, digits = 2): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(digits)));
}

export const formatSeconds = (value: number): string =>
  `${formatMeasure(value, 1)} s`;

const STATUS_META: Record<
  string,
  { glyph: string; label: string; className: string }
> = {
  running: { glyph: "◐", label: "Running", className: "text-foreground" },
  awaiting_approval: {
    glyph: "◇",
    label: "Awaiting approval",
    className: "text-foreground",
  },
  succeeded: { glyph: "●", label: "Succeeded", className: "text-foreground" },
  failed: { glyph: "✕", label: "Failed", className: "text-destructive" },
  cancelled: {
    glyph: "–",
    label: "Cancelled",
    className: "text-muted-foreground",
  },
};

/** Run status exactly as the record reports it; the glyph vocabulary matches job status. */
export function RunStatusTag({
  status,
  plain = false,
  className,
}: {
  status: string;
  /** everyday wording: "Finished" */
  plain?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? {
    glyph: "·",
    label: humanise(status),
    className: "text-muted-foreground",
  };
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[0.625rem]">
        {meta.glyph}
      </span>
      {plain ? plainRunState(status) : meta.label}
    </span>
  );
}

const VERDICT_META: Record<string, { glyph: string; label: string }> = {
  supported: { glyph: "+", label: "Supported" },
  weakened: { glyph: "−", label: "Weakened" },
  refuted: { glyph: "×", label: "Refuted" },
  unchanged: { glyph: "=", label: "Unchanged" },
};

/** What the test did to a hypothesis. Word and glyph, no colour. */
export function VerdictTag({
  verdict,
  plain = false,
  className,
}: {
  verdict: string | null;
  /** everyday wording: "More likely" */
  plain?: boolean;
  className?: string;
}) {
  if (!verdict)
    return (
      <span className="text-subtle-foreground">
        {plain ? plainVerdict(verdict) : "No verdict recorded"}
      </span>
    );
  const meta = VERDICT_META[verdict] ?? {
    glyph: "·",
    label: humanise(verdict),
  };
  return (
    <span
      data-verdict={verdict}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-flex size-3.5 items-center justify-center rounded-xs border border-border-strong font-mono text-[0.625rem] leading-none"
      >
        {meta.glyph}
      </span>
      {plain ? plainVerdict(verdict) : meta.label}
    </span>
  );
}
