"use client";

import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { SubjectLinks } from "@/components/lab/entity-links";
import {
  RunStatusTag,
  formatClock,
  formatMeasure,
  formatSeconds,
  modeLabel,
} from "@/components/lab/format";
import {
  useAgentLabel,
  useEntryProps,
  useRun,
} from "@/components/lab/run-context";
import { ByLine, LoopSection, Subhead } from "@/components/lab/section";
import type { PolicyDenialEntry } from "@/components/lab/record";
import { isActiveStatus, type LabEvent } from "@/components/lab/types";
import { Plate } from "@/components/shell/page";
import { apiUrl } from "@/lib/api/client";

const count = (value: number | null) =>
  value === null ? <Unknown /> : formatMeasure(value);

function ObjectiveLine({
  event,
  statement,
}: {
  event: LabEvent;
  statement: string | null;
}) {
  const props = useEntryProps(event.seq, "px-3 py-3");
  return (
    <div {...props}>
      <p className="max-w-[72ch] text-base text-foreground">
        {statement ?? (
          <span className="text-subtle-foreground">
            The objective line carries no statement.
          </span>
        )}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Objective set by <ByLine event={event} className="text-xs" />
      </p>
    </div>
  );
}

/** The question the run was started with: the objective, its subject and the budget it was given. */
export function Question() {
  const { run, view } = useRun();
  const objective = view.objective;
  return (
    <LoopSection stage="question" title="Question">
      <Plate>
        {objective ? (
          <ObjectiveLine
            event={objective.event}
            statement={objective.statement ?? run.objective}
          />
        ) : (
          <p className="max-w-[72ch] px-3 py-3 text-base text-foreground">
            {run.objective ?? (
              <span className="text-subtle-foreground">
                No objective recorded
              </span>
            )}
          </p>
        )}
        <DefinitionList className="border-t border-border-subtle">
          <DefinitionRow term="Subject">
            <SubjectLinks subject={run.subject} />
          </DefinitionRow>
          <DefinitionRow term="Mode">{modeLabel(run.mode)}</DefinitionRow>
          <DefinitionRow term="Budget">
            <span className="tabular font-mono">
              {count(run.budget.max_tool_calls)}
            </span>{" "}
            tool calls,{" "}
            <span className="tabular font-mono">
              {count(run.budget.max_compute_seconds)}
            </span>{" "}
            compute seconds
          </DefinitionRow>
          <DefinitionRow term="Approval">
            {run.approval_mode ? (
              <>
                {run.approval_mode.replace(/^./, (first) =>
                  first.toUpperCase(),
                )}
                <span className="text-muted-foreground">
                  {" "}
                  (how consequential actions were authorised for this run)
                </span>
              </>
            ) : null}
          </DefinitionRow>
        </DefinitionList>
      </Plate>
    </LoopSection>
  );
}

function PolicyDenialRow({ denial }: { denial: PolicyDenialEntry }) {
  const agentLabel = useAgentLabel();
  const props = useEntryProps(
    denial.event.seq,
    "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0",
  );
  return (
    <li {...props}>
      <span className="font-mono font-medium text-foreground" translate="no">
        {denial.policy ?? "policy"}
      </span>
      <span className="text-muted-foreground">
        denied{" "}
        <span className="font-mono text-foreground" translate="no">
          {denial.tool ?? "a tool call"}
        </span>
        {denial.calling_agent ? (
          <>
            {" "}
            called by{" "}
            <span className="font-medium text-foreground">
              {agentLabel(denial.calling_agent)}
            </span>
          </>
        ) : null}
      </span>
      <ByLine event={denial.event} className="ml-auto" />
      {denial.reason ? (
        <p className="w-full max-w-[88ch] text-foreground">{denial.reason}</p>
      ) : null}
    </li>
  );
}

/** What the run cost and exactly what ran it, so the record can be checked against the code. */
export function RunProvenance() {
  const { run, replaying, view } = useRun();
  const agentLabel = useAgentLabel();
  const metrics = run.metrics;
  // run.json holds zeros until the run finishes; while it runs, the record itself is counted
  const live = isActiveStatus(run.status);
  const whenFinished = <Unknown reason="Written when the run finishes" />;
  const decided = view.approvals.filter((approval) => approval.decision);
  return (
    <LoopSection
      id="record"
      title="Run record"
      detail={
        replaying
          ? "Final values of the recorded run, not the replay step"
          : null
      }
    >
      <Plate className="grid md:grid-cols-2">
        <div className="border-b border-border md:border-r md:border-b-0">
          <Subhead
            title="Metrics"
            detail={
              live ? "Counted from the record so far" : "As written to run.json"
            }
          />
          <DefinitionList termWidth="9.5rem">
            <DefinitionRow term="Status">
              <RunStatusTag status={run.status} />
            </DefinitionRow>
            <DefinitionRow term="Wall time" mono>
              {live
                ? whenFinished
                : metrics.wall_seconds === null
                  ? null
                  : formatSeconds(metrics.wall_seconds)}
            </DefinitionRow>
            <DefinitionRow term="Tool calls" mono>
              {live ? whenFinished : count(metrics.tool_calls)}
            </DefinitionRow>
            <DefinitionRow term="Compute seconds" mono>
              {live ? whenFinished : count(metrics.compute_seconds)}
            </DefinitionRow>
            <DefinitionRow term="Distinct sources" mono>
              {live ? view.databases.length : count(metrics.distinct_sources)}
            </DefinitionRow>
            <DefinitionRow term="Evidence items" mono>
              {live ? view.evidence.length : count(metrics.evidence_items)}
            </DefinitionRow>
            <DefinitionRow term="Hypotheses" mono>
              {live ? view.hypotheses.length : count(metrics.hypotheses)}
            </DefinitionRow>
            <DefinitionRow term="Tests considered" mono>
              {live ? view.tests.length : count(metrics.tests_considered)}
            </DefinitionRow>
            <DefinitionRow term="Tests run" mono>
              {live ? view.results.length : count(metrics.tests_executed)}
            </DefinitionRow>
            <DefinitionRow term="Approvals decided" mono>
              {live ? decided.length : count(metrics.approvals)}
            </DefinitionRow>
            <DefinitionRow term="Assumptions reopened" mono>
              {live ? view.reopenings.length : count(metrics.reopenings)}
            </DefinitionRow>
            <DefinitionRow term="Candidates" mono>
              {live ? view.candidates.length : count(metrics.candidates)}
            </DefinitionRow>
            <DefinitionRow term="Ruled out on direction" mono>
              {live
                ? view.ruledOut.length
                : count(metrics.ruled_out_by_direction)}
            </DefinitionRow>
            <DefinitionRow term="Record lines" mono>
              {view.events.length}
            </DefinitionRow>
            {metrics.tool_calls_by_agent.length && !live ? (
              <DefinitionRow term="Tool calls by agent">
                <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {metrics.tool_calls_by_agent.map((row) => (
                    <span key={row.key}>
                      {agentLabel(row.key)}{" "}
                      <span className="tabular font-mono">{row.value}</span>
                    </span>
                  ))}
                </span>
              </DefinitionRow>
            ) : null}
          </DefinitionList>
        </div>
        <div>
          <Subhead title="Orchestration" detail="What ran this loop" />
          <DefinitionList termWidth="9.5rem">
            <DefinitionRow term="Omnigent" mono>
              {run.omnigent.version}
            </DefinitionRow>
            <DefinitionRow term="Harness" mono>
              {run.omnigent.harness}
            </DefinitionRow>
            <DefinitionRow term="Supervisor model" mono>
              {run.omnigent.model}
            </DefinitionRow>
            {run.models.length ? (
              <DefinitionRow term="Model per agent">
                <span className="flex flex-col gap-0.5">
                  {run.models.map((row) => (
                    <span key={row.key} className="flex flex-wrap gap-x-2">
                      {agentLabel(row.key)}
                      <span className="font-mono whitespace-nowrap text-muted-foreground">
                        {row.value}
                      </span>
                    </span>
                  ))}
                </span>
              </DefinitionRow>
            ) : null}
            <DefinitionRow term="Session">
              {run.omnigent.session_id ? (
                <span className="font-mono break-all" translate="no">
                  {run.omnigent.session_id}
                </span>
              ) : null}
            </DefinitionRow>
            <DefinitionRow term="Specification hash">
              {run.spec_hash ? (
                <span className="font-mono break-all" translate="no">
                  {run.spec_hash}
                </span>
              ) : null}
            </DefinitionRow>
            <DefinitionRow term="Started" mono>
              {formatClock(run.started_at)}
            </DefinitionRow>
            <DefinitionRow term="Finished" mono>
              {formatClock(run.finished_at)}
            </DefinitionRow>
            <DefinitionRow term="Run">
              <MonoId value={run.run_id} />
            </DefinitionRow>
          </DefinitionList>
        </div>
      </Plate>
      <Plate className="mt-3">
        <Subhead
          title="Policy denials"
          count={view.policyDenials.length}
          detail="Tool calls a policy refused, as written to the record"
        />
        {view.policyDenials.length ? (
          <ul>
            {view.policyDenials.map((denial) => (
              <PolicyDenialRow key={denial.event.seq} denial={denial} />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {replaying
              ? "No policy denial at this step of the replay."
              : "No tool call was refused by a policy in this record."}
          </p>
        )}
      </Plate>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <TextLink href="/lab#agents">
          Agent specifications and policies
        </TextLink>
        <ExternalLink
          href={apiUrl(`/lab/runs/${encodeURIComponent(run.run_id)}`)}
        >
          Run and record as JSON
        </ExternalLink>
      </p>
    </LoopSection>
  );
}
