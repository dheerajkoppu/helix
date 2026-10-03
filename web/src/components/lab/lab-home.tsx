"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { AgentRoster } from "@/components/lab/agent-roster";
import { AgentRow } from "@/components/lab/agent-row";
import {
  fetchBenchmark,
  fetchRoster,
  fetchRuns,
  labKeys,
} from "@/components/lab/api";
import { Benchmark } from "@/components/lab/benchmark";
import { ComparisonSummary } from "@/components/lab/comparison-summary";
import { RecentRuns } from "@/components/lab/recent-runs";
import { RunsList } from "@/components/lab/runs-list";
import { StartRun } from "@/components/lab/start-run";
import { isActiveStatus } from "@/components/lab/types";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
} from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { useAdvancedMode } from "@/lib/state/preferences";

const ACTIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 15000;
const SHORT_LIST = 5;

/**
 * The lab's front page: pick a variant and run, then the recent runs, the measured comparison and
 * the agents. Advanced shows the full tables and specifications.
 */
export function LabHome() {
  const advanced = useAdvancedMode();
  const [allRuns, setAllRuns] = useState(false);
  const [comparisonDetails, setComparisonDetails] = useState(false);
  const runs = useQuery({
    queryKey: labKeys.runs(),
    queryFn: ({ signal }) => fetchRuns(signal),
    staleTime: 0,
    refetchInterval: (query) => {
      const state = query.state.data;
      if (!state?.served) return false;
      return state.data.some((run) => isActiveStatus(run.status))
        ? ACTIVE_INTERVAL_MS
        : IDLE_INTERVAL_MS;
    },
  });
  const roster = useQuery({
    queryKey: labKeys.agents(),
    queryFn: ({ signal }) => fetchRoster(signal),
  });
  const benchmark = useQuery({
    queryKey: labKeys.benchmark(),
    queryFn: ({ signal }) => fetchBenchmark(signal),
    staleTime: 60 * 1000,
  });

  const runCount = runs.data?.served ? runs.data.data.length : undefined;
  const agentCount = roster.data?.data?.agents.length;
  const hasBenchmark = Boolean(
    benchmark.data?.data &&
    (benchmark.data.data.arms.length > 0 ||
      benchmark.data.data.per_variant.length > 0),
  );
  const fullRuns = advanced || allRuns;
  const fullComparison = advanced || comparisonDetails;

  return (
    <Page>
      <PageHeader
        title="Discovery lab"
        description="Agents take one variant from question to an updated decision."
      />
      <PageBody>
        {advanced ? (
          <section className="border-b border-border-subtle py-4">
            <DefinitionList termWidth="6.5rem" className="text-sm">
              <DefinitionRow term="Question" className="px-0">
                For a pathogenic missense variant in an immune-deficiency gene,
                which molecular mechanism best explains the loss of function,
                and does a targeted computational test change the conclusion the
                starting evidence suggested?
              </DefinitionRow>
              <DefinitionRow term="Bottleneck" className="px-0">
                Going from a variant to a cited, ranked mechanism hypothesis
                means visiting many separate databases and tools by hand. The
                lab assembles the evidence, chooses a test, runs it and records
                the updated decision.
              </DefinitionRow>
            </DefinitionList>
          </section>
        ) : null}

        <section
          id="start"
          aria-label="Start a run"
          className="border-b border-border-subtle py-7"
        >
          <StartRun
            apiState={
              runs.isPending
                ? "checking"
                : runs.isError
                  ? "unreachable"
                  : runs.data.served
                    ? "ready"
                    : "not_served"
            }
            defaultBudget={roster.data?.data?.default_budget ?? null}
          />
        </section>

        <PageSection
          id="runs"
          title="Recent runs"
          count={runCount}
          className="py-7"
          actions={
            !advanced && runCount !== undefined && runCount > SHORT_LIST ? (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={allRuns}
                onClick={() => setAllRuns((current) => !current)}
              >
                {allRuns ? "Recent only" : "All runs"}
              </Button>
            ) : null
          }
        >
          {fullRuns ? <RunsList runs={runs} /> : <RecentRuns runs={runs} />}
        </PageSection>

        <PageSection
          id="benchmark"
          title="Measured comparison"
          description={
            advanced
              ? "The specialist lab against a single agent with the same tools, over flagship variants. The numbers are printed as measured, with the conditions they were measured under."
              : undefined
          }
          className="py-7"
          actions={
            !advanced && hasBenchmark ? (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={comparisonDetails}
                onClick={() => setComparisonDetails((current) => !current)}
              >
                {comparisonDetails ? "Hide details" : "Details"}
              </Button>
            ) : null
          }
        >
          {advanced ? null : <ComparisonSummary benchmark={benchmark} />}
          {fullComparison ? (
            <div className={advanced ? undefined : "mt-4"}>
              <Benchmark benchmark={benchmark} />
            </div>
          ) : null}
        </PageSection>

        <PageSection
          id="agents"
          title="Agents"
          count={agentCount}
          description={
            advanced
              ? "The specifications the orchestrator runs, served as data. Each agent owns one scientific decision and can call only the tools listed for it."
              : undefined
          }
          className="py-7"
        >
          {advanced ? (
            <AgentRoster roster={roster} />
          ) : (
            <AgentRow roster={roster} />
          )}
        </PageSection>
      </PageBody>
    </Page>
  );
}
