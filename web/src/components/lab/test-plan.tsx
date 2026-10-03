"use client";

import { cn } from "cn";

import { Unknown } from "@/components/data/definition-list";
import { Approvals } from "@/components/lab/approvals";
import { formatMeasure, humanise } from "@/components/lab/format";
import type {
  PlanEntry,
  SafetyReviewEntry,
  Scored,
  TestEntry,
} from "@/components/lab/record";
import { useEntryProps, useRun } from "@/components/lab/run-context";
import {
  ByLine,
  IdLink,
  LoopSection,
  NotRecorded,
  Subhead,
} from "@/components/lab/section";
import {
  isActiveStatus,
  readText,
  type LabEvent,
} from "@/components/lab/types";
import { Plate } from "@/components/shell/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const measure = (value: number | null) =>
  value === null ? <Unknown /> : formatMeasure(value);

const roundLabel = (round: number | null) =>
  round === null ? "" : ` in round ${round}`;

function ScoreCell({ score }: { score: Scored }) {
  return (
    <TableCell className="tabular text-right font-mono">
      {score.value === null ? <Unknown /> : score.value.toFixed(2)}
    </TableCell>
  );
}

function Reasoning({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </p>
  );
}

function TestRows({ test }: { test: TestEntry }) {
  const { view } = useRun();
  const chosenBy = view.plans.find((plan) => plan.chosen_test_id === test.id);
  const rejections = view.plans.flatMap((plan) => {
    const rejection = plan.rejected.find((entry) => entry.test_id === test.id);
    return rejection ? [{ plan, reason: rejection.reason }] : [];
  });
  const executed = view.results.some((result) => result.test_id === test.id);
  const mark = useEntryProps(test.event.seq);
  const planned = view.plans.length > 0;

  return (
    <tbody
      id={mark.id}
      data-seq={mark["data-seq"]}
      data-current={mark["data-current"]}
      data-chosen={chosenBy ? true : undefined}
      className={cn(mark.className, "border-b border-border-subtle")}
    >
      <TableRow className="border-b-0 hover:bg-transparent">
        <TableCell
          className={cn(
            "font-mono font-medium",
            chosenBy && "shadow-[inset_2px_0_0_var(--foreground)]",
          )}
          translate="no"
        >
          {test.id}
        </TableCell>
        <TableCell className="font-mono" translate="no">
          {test.tests_hypotheses.length ? (
            test.tests_hypotheses.join(", ")
          ) : (
            <Unknown reason="None" />
          )}
        </TableCell>
        <ScoreCell score={test.expected_learning} />
        <ScoreCell score={test.feasibility} />
        <TableCell className="tabular text-right font-mono">
          {measure(test.cost.compute_seconds)}
        </TableCell>
        <TableCell className="tabular text-right font-mono">
          {measure(test.cost.tool_calls)}
        </TableCell>
        <TableCell>
          {test.requires_approval === null ? (
            <Unknown />
          ) : test.requires_approval ? (
            "Required"
          ) : (
            "Not required"
          )}
        </TableCell>
        <TableCell className={cn(chosenBy && "font-medium")}>
          {chosenBy ? (
            `Chosen${roundLabel(chosenBy.round)}`
          ) : rejections.length ? (
            `Rejected${roundLabel(rejections.at(-1)?.plan.round ?? null)}`
          ) : planned ? (
            <span className="text-muted-foreground">Not chosen</span>
          ) : (
            <span className="text-subtle-foreground">Undecided</span>
          )}
        </TableCell>
      </TableRow>
      <TableRow className="h-auto border-b-0 hover:bg-transparent">
        <TableCell
          colSpan={8}
          className="pt-0 pb-2.5 whitespace-normal text-foreground"
        >
          {/* Prose keeps the width of the plate while the figures above scroll sideways on a phone. */}
          <div className="sticky left-2 w-[calc(100cqw-1rem)] space-y-1">
            <p className="max-w-[80ch] text-sm">
              {test.test_kind ? (
                <span className="font-medium">
                  {humanise(test.test_kind).replace(/^./, (first) =>
                    first.toUpperCase(),
                  )}
                  .{" "}
                </span>
              ) : null}
              {test.description ?? (
                <span className="text-subtle-foreground">
                  No description recorded
                </span>
              )}
            </p>
            {test.expected_learning.reasoning ? (
              <Reasoning label="Expected learning">
                {test.expected_learning.reasoning}
              </Reasoning>
            ) : null}
            {test.feasibility.reasoning ? (
              <Reasoning label="Feasibility">
                {test.feasibility.reasoning}
              </Reasoning>
            ) : null}
            {test.controls.length ? (
              <Reasoning label="Controls">{test.controls.join(" ")}</Reasoning>
            ) : null}
            {rejections.map(({ plan, reason }) =>
              reason ? (
                <Reasoning
                  key={plan.event.seq}
                  label={`Rejected${roundLabel(plan.round)} because`}
                >
                  {reason}
                </Reasoning>
              ) : null,
            )}
            <p className="flex flex-wrap items-baseline gap-x-3 text-2xs text-muted-foreground">
              {test.tool ? (
                <span>
                  Runs through{" "}
                  <span className="font-mono text-foreground" translate="no">
                    {test.tool}
                  </span>
                </span>
              ) : null}
              {test.round !== null ? (
                <span>
                  Proposed in round{" "}
                  <span className="tabular font-mono">{test.round}</span>
                </span>
              ) : null}
              {executed ? (
                <span className="text-foreground">Result recorded below</span>
              ) : null}
              <ByLine event={test.event} />
            </p>
          </div>
        </TableCell>
      </TableRow>
    </tbody>
  );
}

const remainingFor = (plan: PlanEntry | null, needles: string[]) =>
  plan?.budget_remaining.find((row) =>
    needles.some((needle) => row.key.toLowerCase().includes(needle)),
  )?.value ?? null;

const asNumber = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The budget the scientist set, what the planner had left when it chose, and what the run spent. */
function Budget({
  plan,
  chosen,
}: {
  plan: PlanEntry | null;
  chosen: TestEntry | null;
}) {
  const { run, replaying } = useRun();
  // run.json holds zeros until the run finishes
  const live = isActiveStatus(run.status);
  const pending = <Unknown reason="When the run finishes" />;
  const remainingTools = remainingFor(plan, ["tool"]);
  const remainingCompute = remainingFor(plan, ["compute", "second"]);
  const used = (budget: number | null, remaining: string | null) => {
    const left = asNumber(remaining);
    return budget !== null && left !== null
      ? Number((budget - left).toFixed(1))
      : null;
  };
  const planBasis = plan
    ? `latest plan${roundLabel(plan.round)}`
    : "no plan yet";

  const rows: Array<{
    label: string;
    basis: string;
    tools: React.ReactNode;
    compute: React.ReactNode;
  }> = [
    {
      label: "Budget",
      basis: "set when the run was started",
      tools: measure(run.budget.max_tool_calls),
      compute: measure(run.budget.max_compute_seconds),
    },
    {
      label: "Used when the planner chose",
      basis: `budget minus remaining, ${planBasis}`,
      tools: measure(used(run.budget.max_tool_calls, remainingTools)),
      compute: measure(used(run.budget.max_compute_seconds, remainingCompute)),
    },
    {
      label: "Remaining when the planner chose",
      basis: `as recorded in the ${planBasis}`,
      tools: remainingTools ?? <Unknown />,
      compute: remainingCompute ?? <Unknown />,
    },
    {
      label: "Cost of the chosen test",
      basis: "as recorded with the candidate",
      tools: measure(chosen?.cost.tool_calls ?? null),
      compute: measure(chosen?.cost.compute_seconds ?? null),
    },
    {
      label: "Used by the whole run",
      basis: replaying
        ? "run metrics, final value of the recorded run"
        : "run metrics",
      tools: live ? pending : measure(run.metrics.tool_calls),
      compute: live ? pending : measure(run.metrics.compute_seconds),
    },
  ];

  return (
    <>
      <Subhead title="Budget" className="border-t border-t-border" />
      <Table>
        <TableHeader className="static">
          <TableRow className="hover:bg-transparent">
            <TableHead>Figure</TableHead>
            <TableHead className="text-right">Tool calls</TableHead>
            <TableHead className="text-right">Compute seconds</TableHead>
            <TableHead>Basis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="tabular text-right font-mono">
                {row.tools}
              </TableCell>
              <TableCell className="tabular text-right font-mono">
                {row.compute}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.basis}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function PlanNote({
  plan,
  superseded,
}: {
  plan: PlanEntry;
  superseded: boolean;
}) {
  const props = useEntryProps(
    plan.event.seq,
    "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0",
  );
  return (
    <li {...props}>
      <span
        className={cn("font-medium", superseded && "text-muted-foreground")}
      >
        {plan.round !== null ? `Round ${plan.round}` : "Plan"}
        {superseded ? "" : ", in force"}
      </span>
      <span>
        chose{" "}
        {plan.chosen_test_id ? <IdLink id={plan.chosen_test_id} /> : "no test"}
        {plan.rejected.length ? (
          <>
            {" "}
            over{" "}
            <span className="font-mono" translate="no">
              {plan.rejected.map((entry) => entry.test_id).join(", ")}
            </span>
          </>
        ) : null}
      </span>
      <ByLine event={plan.event} className="ml-auto" />
      {plan.rationale ? (
        <p className="w-full max-w-[80ch] text-sm text-foreground">
          {plan.rationale}
        </p>
      ) : null}
    </li>
  );
}

function SafetyReviewRow({ review }: { review: SafetyReviewEntry }) {
  const props = useEntryProps(
    review.event.seq,
    "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0",
  );
  return (
    <li {...props}>
      {review.test_id ? <IdLink id={review.test_id} /> : null}
      <span className="font-medium text-foreground">
        {review.verdict
          ? humanise(review.verdict).replace(/^./, (first) =>
              first.toUpperCase(),
            )
          : "No verdict recorded"}
      </span>
      {review.requires_approval !== null ? (
        <span className="text-muted-foreground">
          {review.requires_approval
            ? "human approval required before the test runs"
            : "no human approval required for this test"}
        </span>
      ) : null}
      <ByLine event={review.event} className="ml-auto" />
      {review.findings ? (
        <p className="w-full max-w-[80ch] text-sm text-foreground">
          {review.findings}
        </p>
      ) : null}
    </li>
  );
}

function StartedRow({ event }: { event: LabEvent }) {
  const props = useEntryProps(
    event.seq,
    "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0",
  );
  const testId = readText(event.payload.test_id);
  const testKind = readText(event.payload.test_kind);
  const tool = readText(event.payload.tool);
  const summary =
    readText(event.payload.summary) ?? readText(event.payload.description);
  return (
    <li {...props}>
      {testId ? <IdLink id={testId} /> : null}
      <span className="text-foreground">
        {summary ??
          (testKind
            ? `${humanise(testKind).replace(/^./, (first) => first.toUpperCase())} test started`
            : "Test started")}
      </span>
      {tool ? (
        <span className="text-muted-foreground">
          through{" "}
          <span className="font-mono text-foreground" translate="no">
            {tool}
          </span>
        </span>
      ) : null}
      <ByLine event={event} className="ml-auto" />
    </li>
  );
}

/**
 * The planner's competing tests in one table: what each would teach, how feasible it is, what it
 * costs, which one was chosen and why the others were not. Then the safety review, the human
 * approval and the start of the test.
 */
export function TestPlan() {
  const { view } = useRun();
  const plan = view.plans.at(-1) ?? null;
  const chosen = plan
    ? (view.tests.find((test) => test.id === plan.chosen_test_id) ?? null)
    : null;

  return (
    <LoopSection
      stage="experiment"
      title="Experiment"
      count={view.tests.length}
      detail="Candidate tests. Expected learning and feasibility are the planner's estimates, 0 to 1."
    >
      <Plate>
        {view.tests.length ? (
          <div className="@container">
            <Table className="min-w-[42rem]">
              <TableHeader className="static">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Test</TableHead>
                  <TableHead>Tests</TableHead>
                  <TableHead className="text-right">Learning</TableHead>
                  <TableHead className="text-right">Feasibility</TableHead>
                  <TableHead className="text-right">Compute s</TableHead>
                  <TableHead className="text-right">Tool calls</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Planner</TableHead>
                </TableRow>
              </TableHeader>
              {view.tests.map((test) => (
                <TestRows key={test.id} test={test} />
              ))}
            </Table>
          </div>
        ) : (
          <NotRecorded what="candidate tests" />
        )}

        <Subhead
          title="Plan"
          count={view.plans.length}
          detail="The planner chooses one test inside the remaining budget"
          className="border-t border-t-border"
        />
        {view.plans.length ? (
          <ul>
            {view.plans.map((entry, index) => (
              <PlanNote
                key={entry.event.seq}
                plan={entry}
                superseded={index < view.plans.length - 1}
              />
            ))}
          </ul>
        ) : (
          <NotRecorded what="plan" />
        )}

        <Budget plan={plan} chosen={chosen} />

        <Subhead
          title="Safety review"
          count={view.safetyReviews.length}
          detail="Recorded by the safety agent before a test runs"
          className="border-t border-t-border"
        />
        {view.safetyReviews.length ? (
          <ul>
            {view.safetyReviews.map((review) => (
              <SafetyReviewRow key={review.event.seq} review={review} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="safety review" />
        )}

        <Approvals />

        {view.experimentStarted.length ? (
          <>
            <Subhead
              title="Test started"
              count={view.experimentStarted.length}
              className="border-t border-t-border"
            />
            <ul>
              {view.experimentStarted.map((event) => (
                <StartedRow key={event.seq} event={event} />
              ))}
            </ul>
          </>
        ) : null}
      </Plate>
    </LoopSection>
  );
}
