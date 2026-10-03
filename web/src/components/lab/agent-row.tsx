"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import type { Served } from "@/components/lab/api";
import { agentLabel } from "@/components/lab/format";
import type { LabAgentSpec, LabRoster } from "@/components/lab/types";
import { QueryErrorState } from "@/components/states/query-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { plainAgentName, plainAgentRole } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

/** What each agent is for, in a few words. The served specification opens on click. */
const ROLE: Record<string, string> = {
  orchestrator: "Runs the loop",
  literature: "Reads papers",
  knowledge_graph: "Links records",
  insight: "Forms hypotheses",
  planner: "Chooses the test",
  safety: "Checks and gates",
  runner: "Runs the test",
  analysis: "Updates the decision",
};

function SpecRow({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function Specification({ agent }: { agent: LabAgentSpec }) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{agent.title}</p>
        {agent.model ? (
          <p className="font-mono text-2xs text-muted-foreground">
            {agent.model}
            {agent.harness ? ` · ${agent.harness}` : null}
          </p>
        ) : null}
      </div>
      <dl className="flex flex-col gap-2 text-xs">
        {agent.decision ? (
          <SpecRow term="Decides">{agent.decision}</SpecRow>
        ) : null}
        {agent.inputs.length ? (
          <SpecRow term="Reads">{agent.inputs.join(" ")}</SpecRow>
        ) : null}
        {agent.outputs.length ? (
          <SpecRow term="Writes">{agent.outputs.join(" ")}</SpecRow>
        ) : null}
        <SpecRow term="Tools">
          {agent.tools.length ? (
            <span className="font-mono text-2xs break-words" translate="no">
              {agent.tools.map((tool) => tool.name).join(", ")}
            </span>
          ) : (
            "None listed"
          )}
        </SpecRow>
        {agent.policies.length ? (
          <SpecRow term="Policies">
            <span className="font-mono text-2xs break-words" translate="no">
              {agent.policies
                .map((policy) => policy.replace(/\(.*\)$/, ""))
                .join(", ")}
            </span>
          </SpecRow>
        ) : null}
        {agent.spec_path ? (
          <SpecRow term="Spec">
            <span className="font-mono text-2xs break-all" translate="no">
              {agent.spec_path}
            </span>
          </SpecRow>
        ) : null}
      </dl>
    </>
  );
}

/** The lab's agents in loop order: a name and a role each, the specification behind a click. */
export function AgentRow({
  roster,
}: {
  roster: UseQueryResult<Served<LabRoster | null>>;
}) {
  const advanced = useAdvancedMode();
  if (roster.isPending) return <Skeleton className="h-16 w-full" />;
  if (roster.isError) {
    return (
      <QueryErrorState
        error={roster.error}
        subject="the agent specifications"
        onRetry={() => void roster.refetch()}
        retrying={roster.isFetching}
        size="inline"
      />
    );
  }
  const agents = roster.data.data?.agents ?? [];
  if (agents.length === 0) {
    return (
      <p className="text-base text-muted-foreground">
        No agent specification served by this API.
      </p>
    );
  }
  return (
    <ol className="grid grid-cols-2 border-y border-border sm:grid-cols-4 lg:grid-cols-8">
      {agents.map((agent, index) => (
        <li key={agent.id} className="min-w-0">
          <Popover>
            <PopoverTrigger className="flex h-full w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 px-3 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset aria-expanded:bg-active">
              <span className="tabular font-mono text-2xs text-subtle-foreground">
                {index + 1}
              </span>
              <span className="w-full truncate text-base font-medium text-foreground">
                {advanced ? agentLabel(agent.id) : plainAgentName(agent.id)}
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">
                {advanced
                  ? (ROLE[agent.id] ?? agent.title)
                  : plainAgentRole(agent.id) || agent.title}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[26rem] max-w-[calc(100vw-2rem)] gap-3 p-3.5"
            >
              <Specification agent={agent} />
            </PopoverContent>
          </Popover>
        </li>
      ))}
    </ol>
  );
}
