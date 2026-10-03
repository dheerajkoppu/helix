"use client";

import { cn } from "cn";
import { createContext, useContext, useMemo } from "react";

import { agentLabel } from "@/components/lab/format";
import type { RecordView } from "@/components/lab/record";
import type { LabRun } from "@/components/lab/types";

export interface RunContextValue {
  run: LabRun;
  view: RecordView;
  /** true while a recorded run is shown step by step */
  replaying: boolean;
  /** seq of the record line the replay is on */
  currentSeq: number | null;
  /** the final report as the API serves it, when the record itself carries none */
  reportText: string | null;
  /** seq of the record line that stated an evidence, hypothesis, test or approval id */
  seqOf: (id: string) => number | null;
}

const RunContext = createContext<RunContextValue | null>(null);

export function RunProvider({
  run,
  view,
  replaying,
  currentSeq,
  reportText,
  children,
}: Omit<RunContextValue, "seqOf"> & { children: React.ReactNode }) {
  const value = useMemo<RunContextValue>(() => {
    const index = new Map<string, number>();
    for (const entry of view.evidence) index.set(entry.id, entry.event.seq);
    for (const entry of view.gaps)
      if (entry.id) index.set(entry.id, entry.event.seq);
    for (const entry of view.hypotheses) index.set(entry.id, entry.event.seq);
    for (const entry of view.tests) index.set(entry.id, entry.event.seq);
    for (const entry of view.approvals) index.set(entry.id, entry.request.seq);
    return {
      run,
      view,
      replaying,
      currentSeq,
      reportText,
      seqOf: (id) => index.get(id) ?? null,
    };
  }, [run, view, replaying, currentSeq, reportText]);
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRun must be used inside RunProvider");
  return value;
}

/**
 * Agent names for this run. The control arm writes its lines under the orchestrator's name, so in
 * a single-agent run that name is printed as what it is: the single agent.
 */
export function useAgentLabel(): (agent: string | null | undefined) => string {
  const { run } = useRun();
  const singleAgent = run.mode === "single_agent_baseline";
  return (agent) =>
    singleAgent && agent === "orchestrator"
      ? agentLabel("generalist")
      : agentLabel(agent);
}

export const entryAnchor = (seq: number) => `ev-${seq}`;

/** Offset that keeps an anchored row clear of the sticky loop rail. */
export const ANCHOR_OFFSET = "scroll-mt-[calc(var(--lab-top)+0.75rem)]";

const ENTRY_MARK =
  "target:bg-active target:shadow-[inset_2px_0_0_var(--foreground)] data-[current=true]:bg-active data-[current=true]:shadow-[inset_2px_0_0_var(--foreground)]";

/**
 * Props for the element that shows one record line. The timeline links to it by `#ev-<seq>`, and a
 * replay marks the line it is on with the selected-row treatment.
 */
export function useEntryProps(seq: number, className?: string) {
  const { currentSeq, replaying } = useRun();
  return {
    id: entryAnchor(seq),
    "data-seq": seq,
    "data-current": replaying && currentSeq === seq ? true : undefined,
    className: cn(ANCHOR_OFFSET, ENTRY_MARK, className),
  };
}
