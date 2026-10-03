"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import { Unknown } from "@/components/data/definition-list";
import type { Served } from "@/components/lab/api";
import { formatMeasure, humanise } from "@/components/lab/format";
import { Subhead } from "@/components/lab/section";
import type {
  LabAgentSpec,
  LabPolicySpec,
  LabRoster,
  LabTestSpec,
  LabToolSpec,
} from "@/components/lab/types";
import { Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api/client";

const CELL = "py-2 align-top whitespace-normal [overflow-wrap:anywhere]";

const capitalise = (value: string) =>
  value.replace(/^./, (first) => first.toUpperCase());

function Lines({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Unknown reason={empty} />;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Tool names grouped by the kind the registry gives them. */
function ToolNames({ agent }: { agent: LabAgentSpec }) {
  const groups = new Map<string, LabToolSpec[]>();
  for (const tool of agent.tools) {
    const kind = tool.kind ?? "tool";
    groups.set(kind, [...(groups.get(kind) ?? []), tool]);
  }
  if (groups.size === 0 && agent.orchestration_tools.length === 0)
    return <Unknown reason="No tools" />;
  return (
    <dl className="flex flex-col gap-1.5">
      {[...groups.entries()].map(([kind, tools]) => (
        <div key={kind}>
          <dt className="text-2xs tracking-[0.04em] text-muted-foreground uppercase">
            {humanise(kind)}{" "}
            <span className="tabular font-mono">{tools.length}</span>
          </dt>
          <dd className="font-mono text-foreground" translate="no">
            {tools.map((tool) => tool.name).join(", ")}
          </dd>
        </div>
      ))}
      {agent.orchestration_tools.length ? (
        <div>
          <dt className="text-2xs tracking-[0.04em] text-muted-foreground uppercase">
            Dispatch{" "}
            <span className="tabular font-mono">
              {agent.orchestration_tools.length}
            </span>
          </dt>
          <dd className="font-mono text-foreground" translate="no">
            {agent.orchestration_tools.join(", ")}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function AgentRow({
  agent,
  control = false,
}: {
  agent: LabAgentSpec;
  control?: boolean;
}) {
  return (
    <TableRow className="h-auto hover:bg-transparent">
      <TableCell className={CELL}>
        <p className="font-medium text-foreground">{agent.title}</p>
        <p className="font-mono text-2xs text-subtle-foreground" translate="no">
          {agent.id}
        </p>
        {agent.model ? (
          <p className="mt-1 font-mono text-2xs text-muted-foreground">
            {agent.model}
          </p>
        ) : null}
        {control ? (
          <p className="mt-1 text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
            Control arm
          </p>
        ) : null}
      </TableCell>
      <TableCell className={`${CELL} text-foreground`}>
        {agent.decision ?? <Unknown reason="Not stated" />}
      </TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>
        <Lines items={agent.inputs} empty="Not stated" />
      </TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>
        <Lines items={agent.outputs} empty="Not stated" />
      </TableCell>
      <TableCell className={CELL}>
        <ToolNames agent={agent} />
      </TableCell>
      <TableCell className={`${CELL} font-mono`}>
        {agent.policies.length ? (
          <ul className="flex flex-col gap-1">
            {agent.policies.map((policy) => {
              const [name, argument] = policy.split(/(?=\()/, 2);
              return (
                <li key={policy} translate="no">
                  <span className="inline-block text-foreground">{name}</span>
                  {argument ? (
                    <span className="inline-block text-2xs text-subtle-foreground">
                      {argument}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Unknown reason="None" />
        )}
      </TableCell>
    </TableRow>
  );
}

interface ToolRow {
  tool: LabToolSpec;
  agents: string[];
}

/** One row per distinct tool, with every agent whose specification lists it. */
function toolRows(agents: LabAgentSpec[]): ToolRow[] {
  const rows = new Map<string, ToolRow>();
  for (const agent of agents) {
    for (const tool of agent.tools) {
      const row = rows.get(tool.name) ?? { tool, agents: [] };
      row.agents.push(agent.id);
      rows.set(tool.name, row);
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      (left.tool.kind ?? "").localeCompare(right.tool.kind ?? "") ||
      left.tool.name.localeCompare(right.tool.name),
  );
}

function ToolPermissions({
  agents,
  approvalTools,
}: {
  agents: LabAgentSpec[];
  approvalTools: string[];
}) {
  const rows = toolRows(agents);
  if (rows.length === 0) return null;
  return (
    <>
      <Subhead
        title="Tool permissions"
        count={rows.length}
        detail="A specialist can call only the tools its row names. The role boundary policy denies the rest."
        className="border-t border-t-border"
      />
      <div className="scroll-thin max-h-[26rem] overflow-auto">
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Tool</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Human approval</TableHead>
              <TableHead>What it does</TableHead>
              <TableHead>Specialists that can call it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ tool, agents: holders }) => {
              const needsApproval =
                tool.requires_approval ?? approvalTools.includes(tool.name);
              return (
                <TableRow key={tool.name} className="h-auto">
                  <TableCell
                    className="py-1.5 align-top font-mono font-medium"
                    translate="no"
                  >
                    {tool.name}
                  </TableCell>
                  <TableCell className="py-1.5 align-top text-muted-foreground">
                    {tool.kind ? humanise(tool.kind) : <Unknown />}
                  </TableCell>
                  <TableCell
                    className={
                      needsApproval
                        ? "py-1.5 align-top font-medium"
                        : "py-1.5 align-top text-muted-foreground"
                    }
                  >
                    {needsApproval ? "Required" : "Not required"}
                  </TableCell>
                  <TableCell className={`${CELL} py-1.5 text-foreground`}>
                    {tool.description ?? <Unknown reason="Not described" />}
                  </TableCell>
                  <TableCell
                    className={`${CELL} py-1.5 font-mono text-muted-foreground`}
                    translate="no"
                  >
                    {holders.join(", ")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function PolicyRow({ policy }: { policy: LabPolicySpec }) {
  return (
    <TableRow className="h-auto hover:bg-transparent">
      <TableCell className={CELL}>
        <p className="font-medium text-foreground">
          {policy.name ?? capitalise(humanise(policy.id))}
        </p>
        <p className="font-mono text-2xs text-subtle-foreground" translate="no">
          {policy.id}
        </p>
      </TableCell>
      <TableCell className={`${CELL} text-foreground`}>
        {policy.description ?? <Unknown reason="Not stated" />}
      </TableCell>
      <TableCell className={`${CELL} font-mono text-muted-foreground`}>
        {policy.phases.length ? (
          policy.phases.map(humanise).join(", ")
        ) : (
          <Unknown reason="Not stated" />
        )}
      </TableCell>
      <TableCell
        className={`${CELL} font-mono text-muted-foreground`}
        translate="no"
      >
        {policy.handler ?? <Unknown reason="Not stated" />}
      </TableCell>
    </TableRow>
  );
}

function NoteList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-0.5 text-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              aria-hidden
              className="mt-2 h-px w-2 shrink-0 bg-border-strong"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestBlock({ test }: { test: LabTestSpec }) {
  return (
    <li className="grid gap-x-6 gap-y-2 border-b border-border-subtle px-3 py-3 text-xs last:border-b-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-medium text-foreground">
          {test.title ?? capitalise(humanise(test.kind))}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-muted-foreground">
          <span className="font-mono" translate="no">
            {test.kind}
          </span>
          {test.tool ? (
            <span>
              tool{" "}
              <span className="font-mono text-foreground" translate="no">
                {test.tool}
              </span>
            </span>
          ) : null}
          <span>
            cost{" "}
            <span className="tabular font-mono text-foreground">
              {test.cost.compute_seconds === null
                ? "unknown"
                : formatMeasure(test.cost.compute_seconds)}
            </span>{" "}
            compute s,{" "}
            <span className="tabular font-mono text-foreground">
              {test.cost.tool_calls === null
                ? "unknown"
                : formatMeasure(test.cost.tool_calls)}
            </span>{" "}
            tool calls
          </span>
          <span
            className={
              test.requires_approval ? "font-medium text-foreground" : ""
            }
          >
            {test.requires_approval === null
              ? "approval not stated"
              : test.requires_approval
                ? "human approval required"
                : "no human approval required"}
          </span>
        </p>
        {test.measures ? (
          <p className="text-foreground">{test.measures}</p>
        ) : null}
        {test.bears_on.length ? (
          <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {test.bears_on.map((row) => (
              <div key={row.key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-muted-foreground">{humanise(row.key)}</dt>
                <dd className="text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <NoteList title="Controls" items={test.controls} />
        <NoteList title="Limitations" items={test.limitations} />
      </div>
    </li>
  );
}

/**
 * The orchestration as data: for each agent, the scientific decision it owns, what it reads and
 * writes, the only tools it can call and the policies that bound it; then the policies, the human
 * approval boundary and the tests the runner can execute.
 */
export function AgentRoster({
  roster,
}: {
  roster: UseQueryResult<Served<LabRoster | null>>;
}) {
  if (roster.isPending) {
    return (
      <Plate>
        <RowsSkeleton rows={6} />
      </Plate>
    );
  }
  if (roster.isError) {
    return (
      <Plate className="h-40">
        <QueryErrorState
          error={roster.error}
          subject="the agent specifications"
          onRetry={() => void roster.refetch()}
          retrying={roster.isFetching}
        />
      </Plate>
    );
  }
  const data = roster.data.data;
  if (!data || data.agents.length === 0) {
    return (
      <Plate className="h-40">
        <EmptyState
          title="No agent specifications served"
          description={
            roster.data.served
              ? "GET /api/v1/lab/agents answered without any agent."
              : `GET /api/v1/lab/agents answered 404 at ${API_BASE_URL}: this API build does not serve the lab routes yet.`
          }
        />
      </Plate>
    );
  }
  const orchestration = data.orchestration;
  return (
    <Plate>
      <Table className="min-w-[66rem] table-fixed">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[18%]" />
          <col className="w-[14%]" />
          <col className="w-[17%]" />
          <col className="w-[22%]" />
          <col className="w-[15%]" />
        </colgroup>
        <TableHeader className="static">
          <TableRow className="hover:bg-transparent">
            <TableHead>Agent</TableHead>
            <TableHead>Decision it owns</TableHead>
            <TableHead>Inputs</TableHead>
            <TableHead>Output</TableHead>
            <TableHead>Tools it can call</TableHead>
            <TableHead>Policies</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
          {data.baseline ? <AgentRow agent={data.baseline} control /> : null}
        </TableBody>
      </Table>

      {orchestration.dispatch || orchestration.framework ? (
        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border bg-sunken px-3 py-1.5 text-xs text-muted-foreground">
          {orchestration.framework ? (
            <span>
              Orchestrated by{" "}
              <span className="font-medium text-foreground">
                {orchestration.framework}
              </span>
              {orchestration.version ? (
                <span className="font-mono text-foreground">
                  {" "}
                  {orchestration.version}
                </span>
              ) : null}
              {orchestration.harness ? (
                <>
                  , harness{" "}
                  <span className="font-mono text-foreground">
                    {orchestration.harness}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
          {orchestration.dispatch ? (
            <span>{orchestration.dispatch}</span>
          ) : null}
          {orchestration.bundle ? (
            <span>
              Specification{" "}
              <span className="font-mono text-foreground" translate="no">
                {orchestration.bundle}
              </span>
            </span>
          ) : null}
          {data.spec_hash ? (
            <span>
              Hash{" "}
              <span className="font-mono break-all text-foreground">
                {data.spec_hash}
              </span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div id="policies">
        <Subhead
          title="Policies"
          count={data.policies.length}
          detail="Handlers Omnigent runs at the phases listed"
          className="border-t border-t-border"
        />
        {data.policies.length ? (
          <Table className="min-w-[52rem]">
            <TableHeader className="static">
              <TableRow className="hover:bg-transparent">
                <TableHead>Policy</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Runs on</TableHead>
                <TableHead>Handler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.policies.map((policy) => (
                <PolicyRow key={policy.id} policy={policy} />
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-3 py-2 text-xs text-subtle-foreground">
            The specification names no policy.
          </p>
        )}
      </div>

      {data.approval.tools.length || data.approval.how ? (
        <>
          <Subhead
            title="Human approval"
            detail="The boundary a scientist holds"
            className="border-t border-t-border"
          />
          <dl className="grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
            <dt className="text-muted-foreground">
              Tools that wait for a person
            </dt>
            <dd
              className="font-mono font-medium text-foreground"
              translate="no"
            >
              {data.approval.tools.length ? (
                data.approval.tools.join(", ")
              ) : (
                <Unknown reason="None named" />
              )}
            </dd>
            {data.approval.how ? (
              <>
                <dt className="text-muted-foreground">How it is enforced</dt>
                <dd className="max-w-[88ch] text-foreground">
                  {data.approval.how}
                </dd>
              </>
            ) : null}
          </dl>
        </>
      ) : null}

      <ToolPermissions
        agents={data.agents}
        approvalTools={data.approval.tools}
      />

      {data.tests.length ? (
        <div id="tests">
          <Subhead
            title="Tests the runner can execute"
            count={data.tests.length}
            detail="The planner chooses among these; cost and approval come from this catalogue"
            className="border-t border-t-border"
          />
          <ul>
            {data.tests.map((test) => (
              <TestBlock key={test.kind} test={test} />
            ))}
          </ul>
        </div>
      ) : null}

      {data.mechanism_classes.length ? (
        <>
          <Subhead
            title="Mechanism classes"
            count={data.mechanism_classes.length}
            detail="Competing hypotheses must name different classes"
            className="border-t border-t-border"
          />
          <dl className="grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] text-xs">
            {data.mechanism_classes.map((row) => (
              <div
                key={row.key}
                className="col-span-2 grid grid-cols-subgrid border-b border-border-subtle px-3 py-1.5 last:border-b-0"
              >
                <dt className="pr-3 font-medium text-foreground">
                  {humanise(row.key)}
                </dt>
                <dd className="text-muted-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </Plate>
  );
}
