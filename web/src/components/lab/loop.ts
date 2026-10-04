import { agentLabel, humanise } from "@/components/lab/format";
import {
  LOOP_STAGES,
  stageOfEvent,
  summariseEvent,
  type LoopStageId,
} from "@/components/lab/record";
import {
  isRecord,
  readBoolean,
  readList,
  readText,
  type LabEvent,
} from "@/components/lab/types";

const STAGE_INDEX = new Map<LoopStageId, number>(
  LOOP_STAGES.map((stage, index) => [stage.id, index]),
);

/** Short stepper labels; the record view keeps the long ones. */
export const STEP_LABEL: Record<LoopStageId, string> = {
  question: "Question",
  evidence: "Evidence",
  hypothesis: "Hypothesis",
  experiment: "Experiment",
  result: "Result",
  decision: "Decision",
  candidates: "Candidates",
};

/**
 * The furthest loop step the record has reached. Evidence filed after a result does not move the
 * run back; a reopened assumption does.
 */
export function loopPosition(events: LabEvent[]): LoopStageId | null {
  let furthest = -1;
  for (const event of events) {
    if (
      event.type === "note" &&
      readText(event.payload.kind) === "reopened_assumption"
    ) {
      furthest = STAGE_INDEX.get("hypothesis") ?? furthest;
      continue;
    }
    const stage = stageOfEvent(event);
    if (!stage) continue;
    furthest = Math.max(furthest, STAGE_INDEX.get(stage) ?? -1);
  }
  return furthest < 0 ? null : LOOP_STAGES[furthest].id;
}

export const stepIndex = (stage: LoopStageId | null): number =>
  stage ? (STAGE_INDEX.get(stage) ?? -1) : -1;

export type AgentState = "waiting" | "working" | "done" | "unused";

export interface AgentStatus {
  id: string;
  state: AgentState;
  /** the agent's latest record line, shortened */
  line: string | null;
  lines: number;
}

const SPECIALISTS = [
  "orchestrator",
  "literature",
  "knowledge_graph",
  "insight",
  "planner",
  "safety",
  "runner",
  "analysis",
  "translator",
];

const withId = (id: string | null, text: string | null): string | null =>
  id && text ? `${id} ${text}` : (text ?? id);

/** One short line for the agent column, built only from fields the event recorded. */
export function briefLine(event: LabEvent): string | null {
  const payload = event.payload;
  switch (event.type) {
    case "handoff": {
      const to = readText(payload.to);
      return to ? `Handed to ${agentLabel(to)}` : readText(payload.summary);
    }
    case "evidence":
    case "gap":
      return withId(readText(payload.id), readText(payload.statement));
    case "hypothesis": {
      const mechanism = readText(payload.mechanism_class);
      return withId(
        readText(payload.id),
        mechanism ? humanise(mechanism) : readText(payload.statement),
      );
    }
    case "test_candidate": {
      const kind = readText(payload.test_kind);
      return withId(
        readText(payload.id),
        kind ? humanise(kind) : readText(payload.description),
      );
    }
    case "plan": {
      const chosen = readText(payload.chosen_test_id);
      return chosen ? `Chose ${chosen}` : readText(payload.rationale);
    }
    case "approval_request": {
      const testId = readText(payload.test_id);
      return testId ? `Asked approval for ${testId}` : "Asked for approval";
    }
    case "approval_decision": {
      const decision = readText(payload.decision);
      return decision ? humanise(decision) : null;
    }
    case "experiment_started": {
      const testId = readText(payload.test_id);
      return testId ? `Running ${testId}` : "Running the test";
    }
    case "experiment_result": {
      const values = isRecord(payload.values) ? payload.values : {};
      return readText(values.headline) ?? readText(payload.summary);
    }
    case "interpretation": {
      const verdicts = readList(payload.per_hypothesis)
        .filter(isRecord)
        .map((entry) => {
          const id = readText(entry.id);
          const verdict = readText(entry.verdict);
          return id && verdict ? `${id} ${humanise(verdict)}` : null;
        })
        .filter(Boolean);
      return verdicts.length ? verdicts.join(", ") : summariseEvent(event);
    }
    case "decision": {
      const changed = readBoolean(payload.changed);
      if (changed === null) return readText(payload.why);
      return changed ? "Decision changed" : "Decision unchanged";
    }
    case "target_rationale":
      return withId(readText(payload.id), readText(payload.what_to_act_on));
    case "candidate": {
      const molecule = isRecord(payload.molecule) ? payload.molecule : {};
      const target = isRecord(payload.target) ? payload.target : {};
      const name = readText(molecule.name) ?? readText(target.gene_symbol);
      return withId(readText(payload.id), name);
    }
    case "note": {
      const kind = readText(payload.kind);
      if (kind === "candidate_review") {
        const verdict = readText(payload.verdict);
        return verdict
          ? `Candidates ${humanise(verdict)}`
          : "Checked candidates";
      }
      if (kind === "candidate_rejected")
        return `Ruled out ${readText(payload.molecule) ?? "a molecule"}`;
      if (kind === "candidates_proposed") return "Put candidates forward";
      if (kind === "safety_review") {
        const verdict = readText(payload.verdict);
        return (
          withId(readText(payload.test_id), verdict) ?? summariseEvent(event)
        );
      }
      if (kind === "final_report") return "Final report written";
      return summariseEvent(event);
    }
    default:
      return summariseEvent(event);
  }
}

/**
 * Who is waiting, working or done at this point of the record. An agent works from the handoff
 * that dispatches it until it hands back; the supervisor works until the report is written.
 */
export function agentStatuses(
  events: LabEvent[],
  options: { specialistLab: boolean; complete: boolean },
): AgentStatus[] {
  const order = options.specialistLab ? [...SPECIALISTS] : [];
  const status = new Map<string, AgentStatus>();
  const entry = (id: string): AgentStatus => {
    let found = status.get(id);
    if (!found) {
      found = { id, state: "waiting", line: null, lines: 0 };
      status.set(id, found);
      if (!order.includes(id)) order.push(id);
    }
    return found;
  };
  for (const id of order) entry(id);

  for (const event of events) {
    if (event.agent === "human" || event.agent === "unknown") continue;
    const agent = entry(event.agent);
    agent.lines += 1;
    if (event.type === "handoff") {
      const to = readText(event.payload.to);
      if (to && to !== "orchestrator" && to !== "human" && to !== event.agent)
        entry(to).state = "working";
      // a specialist hands over when its part is finished; the supervisor keeps working
      if (event.agent === "orchestrator") {
        agent.state = "working";
        agent.line = briefLine(event);
      } else {
        agent.state = "done";
        agent.line ??= briefLine(event);
      }
      continue;
    }
    agent.state = "working";
    agent.line = briefLine(event) ?? agent.line;
    if (
      event.type === "note" &&
      readText(event.payload.kind) === "final_report"
    )
      agent.state = "done";
  }

  // the supervisor starts with the run, before it has written its first line
  const lead = order.length ? entry(order[0]) : null;
  const started = [...status.values()].some(
    (agent) => agent.state !== "waiting",
  );
  if (lead && !options.complete && !started) lead.state = "working";

  return order.map((id) => {
    const agent = entry(id);
    if (!options.complete) return agent;
    return {
      ...agent,
      state: agent.lines > 0 || agent.state !== "waiting" ? "done" : "unused",
    };
  });
}

/** How long a replay rests on a line, relative to the base interval: results longer, evidence shorter. */
const DWELL: Record<string, number> = {
  objective: 1.6,
  handoff: 0.6,
  evidence: 0.5,
  gap: 0.5,
  hypothesis: 1.8,
  test_candidate: 0.9,
  plan: 2.2,
  approval_request: 1.6,
  approval_decision: 1.2,
  experiment_started: 1.4,
  experiment_result: 6,
  interpretation: 2,
  decision: 3,
  next_experiment: 2,
  note: 1,
};

export const dwellOf = (event: LabEvent | undefined): number =>
  event ? (DWELL[event.type] ?? 1) : 1;

/** Seconds between the first record line and the given one, from the recorded timestamps. */
export function secondsBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, (to - from) / 1000);
}
