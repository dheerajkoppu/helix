"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "cn";

import type { AgentState, AgentStatus } from "@/components/lab/loop";
import { agentCounts } from "@/components/lab/plain";
import { useAgentLabel, useRun } from "@/components/lab/run-context";
import {
  plainAgentLine,
  plainAgentName,
  plainAgentRole,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

const STATE_LABEL: Record<AgentState, string> = {
  waiting: "Waiting",
  working: "Working",
  done: "Done",
  unused: "Not used",
};

function StateMark({ state }: { state: AgentState }) {
  if (state === "done") {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
      >
        <CheckIcon className="size-2.5" />
      </span>
    );
  }
  if (state === "working") {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full border border-dashed border-border-strong"
    />
  );
}

/**
 * The agents of the run with a state each. By default the second line is the agent's role until
 * it has written something, then what it did, from counts; Advanced prints its latest record line.
 */
export function AgentColumn({
  agents,
  className,
}: {
  agents: AgentStatus[];
  className?: string;
}) {
  const agentLabel = useAgentLabel();
  const advanced = useAdvancedMode();
  const { run, view } = useRun();
  const singleAgent = run.mode === "single_agent_baseline";
  return (
    <section aria-label="Agents" className={cn("min-w-0", className)}>
      <h2 className="px-4 pt-4 pb-2 text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
        Agents
      </h2>
      <ul>
        {agents.map((agent) => {
          const working = agent.state === "working";
          const idle = agent.state === "waiting" || agent.state === "unused";
          const plainId =
            singleAgent && agent.id === "orchestrator"
              ? "generalist"
              : agent.id;
          const role = plainAgentRole(plainId);
          const counts = agentCounts(view, agent.id);
          // a count that grows while the agent works is shown as it grows
          const counted =
            { literature: counts.papers, knowledge_graph: counts.facts }[
              agent.id
            ] ?? 0;
          const hasOutput =
            agent.lines > 0 && (agent.state === "done" || counted > 0);
          const line = advanced
            ? agent.line
            : hasOutput
              ? plainAgentLine(plainId, counts)
              : role;
          return (
            <li
              key={agent.id}
              data-state={agent.state}
              className={cn(
                "flex min-h-[3.25rem] items-center gap-3 px-4 py-2 transition-colors duration-300",
                working && "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
              )}
            >
              <StateMark state={agent.state} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "truncate text-sm",
                      idle
                        ? "text-muted-foreground"
                        : "font-medium text-foreground",
                    )}
                  >
                    {advanced ? agentLabel(agent.id) : plainAgentName(plainId)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-2xs",
                      working ? "text-foreground" : "text-subtle-foreground",
                    )}
                  >
                    {STATE_LABEL[agent.state]}
                  </span>
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={(advanced ? agent.line : role) ?? undefined}
                >
                  {line ?? " "}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
