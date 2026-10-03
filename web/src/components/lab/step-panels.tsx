"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "cn";
import { useState } from "react";
import { toast } from "sonner";

import { TextLink } from "@/components/data/text-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { SourceChip } from "@/components/evidence/source-chip";
import { decideApproval, labKeys } from "@/components/lab/api";
import { toEvidenceClass } from "@/components/lab/evidence-ledger";
import {
  VerdictTag,
  agentLabel,
  formatMeasure,
  humanise,
  modeLabel,
  variantLabel,
} from "@/components/lab/format";
import { STEP_LABEL } from "@/components/lab/loop";
import {
  overallOutcome,
  type ApprovalEntry,
  type HypothesisEntry,
  type LoopStageId,
  type TestEntry,
} from "@/components/lab/record";
import { ResultFigure } from "@/components/lab/result-figure";
import { useRun } from "@/components/lab/run-context";
import { isActiveStatus } from "@/components/lab/types";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/client";
import { routes } from "@/lib/ids";

const SHORT_LIST = 6;

const sentenceCase = (value: string) =>
  value.replace(/^./, (first) => first.toUpperCase());

function PanelHead({
  stage,
  line,
  onDetails,
  children,
}: {
  stage: LoopStageId;
  /** one short sentence */
  line?: React.ReactNode;
  onDetails: (stage: LoopStageId) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
          {STEP_LABEL[stage]}
        </h2>
        {line ? (
          <p className="text-base text-muted-foreground">{line}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" onClick={() => onDetails(stage)}>
          Details
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

function Waiting({ who }: { who: string }) {
  const { run, replaying } = useRun();
  const live = replaying || isActiveStatus(run.status);
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 border border-dashed border-border-strong px-4 py-6 text-base text-muted-foreground"
    >
      {live ? `Waiting for the ${who}.` : "Not recorded in this run."}
    </p>
  );
}

function QuestionStep() {
  const { run, view } = useRun();
  const subject = run.subject;
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (subject.variant_id)
    facts.push({
      label: "Variant",
      value: (
        <TextLink href={routes.variant(subject.variant_id)} translate="no">
          {variantLabel(subject.variant_id)}
        </TextLink>
      ),
    });
  if (subject.gene)
    facts.push({
      label: "Gene",
      value: (
        <TextLink href={routes.gene(subject.gene)} translate="no">
          {subject.gene}
        </TextLink>
      ),
    });
  if (subject.accession)
    facts.push({
      label: "Protein",
      value: (
        <TextLink href={routes.protein(subject.accession)} translate="no">
          {subject.accession}
        </TextLink>
      ),
    });
  const mode = modeLabel(run.mode);
  if (mode) facts.push({ label: "Mode", value: mode });
  return (
    <>
      <p className="max-w-[62ch] text-xl leading-8 text-foreground">
        {view.objective?.statement ?? run.objective ?? "No objective recorded."}
      </p>
      {facts.length ? (
        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-1">
              <dt className="text-2xs text-subtle-foreground">{fact.label}</dt>
              <dd className="text-lg text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

function EvidenceStep() {
  const { view } = useRun();
  const [all, setAll] = useState(false);
  if (view.evidence.length === 0)
    return <Waiting who="literature and knowledge graph agents" />;
  const rows = all ? view.evidence : view.evidence.slice(0, SHORT_LIST);
  return (
    <>
      <ul className="border-t border-border">
        {rows.map((entry) => {
          const evidenceClass = toEvidenceClass(entry.evidence_class);
          const source = entry.event.sources[0];
          return (
            <li
              key={entry.event.seq}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b border-border-subtle py-3 sm:grid-cols-[2.5rem_3.25rem_minmax(0,1fr)]"
            >
              <span
                className="font-mono text-sm text-muted-foreground"
                translate="no"
              >
                {entry.id}
              </span>
              <span className="hidden pt-0.5 sm:block">
                {evidenceClass ? (
                  <EvidenceBadge evidenceClass={evidenceClass} size="compact" />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <p
                  className="line-clamp-2 text-base text-foreground"
                  title={entry.statement ?? undefined}
                >
                  {entry.statement ?? "No statement recorded"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {evidenceClass ? (
                    <EvidenceBadge
                      evidenceClass={evidenceClass}
                      size="compact"
                      className="sm:hidden"
                    />
                  ) : null}
                  {source ? (
                    <SourceChip
                      source={source.database}
                      id={source.record_id ?? "no record ID"}
                      href={source.url}
                      className="max-w-full overflow-hidden"
                    />
                  ) : (
                    <span className="text-xs text-subtle-foreground">
                      No source found
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {view.evidence.length > SHORT_LIST ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setAll((current) => !current)}
        >
          {all ? "Show fewer" : `Show all ${view.evidence.length}`}
        </Button>
      ) : null}
    </>
  );
}

function HypothesisColumn({
  hypothesis,
  favoured,
  verdict,
}: {
  hypothesis: HypothesisEntry;
  favoured: boolean;
  verdict: string | null;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 px-5 py-4 first:pl-0 last:pr-0 max-md:px-0">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="font-mono text-base text-muted-foreground">
          {hypothesis.id}
        </span>
        <h3 className="text-lg font-medium text-foreground">
          {hypothesis.mechanism_class
            ? sentenceCase(humanise(hypothesis.mechanism_class))
            : "Mechanism not classed"}
        </h3>
        {favoured ? (
          <span className="rounded-xs border border-foreground px-1.5 text-2xs leading-[1.125rem] font-medium text-foreground">
            Favoured
          </span>
        ) : null}
      </header>
      <EvidenceBadge
        evidenceClass="orphafold_hypothesis"
        detail="agent-generated"
        className="self-start"
      />
      <p
        className="line-clamp-5 text-base text-foreground"
        title={hypothesis.statement ?? undefined}
      >
        {hypothesis.statement ?? "No statement recorded"}
      </p>
      <dl className="mt-auto flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-2xs text-subtle-foreground">Starting rank</dt>
          <dd className="tabular font-mono text-foreground">
            {hypothesis.starting_rank ?? "Unknown"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-2xs text-subtle-foreground">Rests on</dt>
          <dd className="font-mono text-foreground" translate="no">
            {hypothesis.supports.length
              ? hypothesis.supports.join(" ")
              : "No evidence cited"}
          </dd>
        </div>
        {verdict ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs text-subtle-foreground">After the test</dt>
            <dd>
              <VerdictTag verdict={verdict} />
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function HypothesisStep() {
  const { view } = useRun();
  const [all, setAll] = useState(false);
  if (view.hypotheses.length === 0) return <Waiting who="insight agent" />;
  const ranked = [...view.hypotheses].sort(
    (left, right) =>
      (left.starting_rank ?? Number.MAX_SAFE_INTEGER) -
      (right.starting_rank ?? Number.MAX_SAFE_INTEGER),
  );
  const shown = all ? ranked : ranked.slice(0, 2);
  const verdicts = new Map(
    view.interpretations
      .at(-1)
      ?.per_hypothesis.map((entry) => [entry.id, entry.verdict]),
  );
  const favouredAfter = view.decisions.at(-1)?.favoured_after_hypothesis;
  const favouredId = favouredAfter ?? ranked[0]?.id;
  return (
    <>
      <div className="grid border-y border-border md:grid-cols-2 md:divide-x md:divide-border max-md:divide-y max-md:divide-border-subtle">
        {shown.map((hypothesis) => (
          <HypothesisColumn
            key={hypothesis.id}
            hypothesis={hypothesis}
            favoured={hypothesis.id === favouredId}
            verdict={verdicts.get(hypothesis.id) ?? null}
          />
        ))}
      </div>
      {ranked.length > 2 ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setAll((current) => !current)}
        >
          {all ? "Show two" : `Show all ${ranked.length}`}
        </Button>
      ) : null}
    </>
  );
}

function ApprovalAction({ approval }: { approval: ApprovalEntry }) {
  const { run } = useRun();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      decideApproval(run.run_id, approval.id, decision, ""),
    onSuccess: (_, decision) => {
      toast(`${approval.id} ${decision}`);
      void queryClient.invalidateQueries({ queryKey: labKeys.run(run.run_id) });
      void queryClient.invalidateQueries({ queryKey: labKeys.runs() });
    },
    onError: (error) => {
      toast.error("Decision not recorded", {
        description: isApiError(error)
          ? error.message
          : "The API did not accept the decision.",
      });
    },
  });
  return (
    <div
      role="group"
      aria-label={`Approval ${approval.id}`}
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 border border-foreground px-4 py-3"
    >
      <p className="min-w-0 flex-1 text-base text-foreground">
        <span className="font-medium">Approval needed.</span>{" "}
        <span className="text-muted-foreground">
          {approval.action ?? approval.reason ?? "The run is waiting."}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="lg"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approved")}
        >
          {decide.isPending && decide.variables === "approved"
            ? "Recording"
            : "Approve"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => decide.mutate("rejected")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

const score = (value: number | null) =>
  value === null ? (
    <span className="text-subtle-foreground">Unknown</span>
  ) : (
    value.toFixed(2)
  );

function cost(test: TestEntry): string {
  const parts: string[] = [];
  if (test.cost.tool_calls !== null)
    parts.push(`${test.cost.tool_calls} calls`);
  if (test.cost.compute_seconds !== null)
    parts.push(`${formatMeasure(test.cost.compute_seconds, 1)} s`);
  return parts.length ? parts.join(" · ") : "Unknown";
}

function ExperimentStep() {
  const { run, view, replaying } = useRun();
  if (view.tests.length === 0) return <Waiting who="planner" />;
  const plan = view.plans.at(-1);
  const chosenId = plan?.chosen_test_id ?? null;
  const pending =
    !replaying && isActiveStatus(run.status)
      ? view.approvals.filter((approval) => !approval.decision)
      : [];
  const review = view.safetyReviews.findLast(
    (entry) => entry.test_id === chosenId,
  );
  const approval = view.approvals.findLast(
    (entry) => entry.test_id === chosenId,
  );
  const cleared: string[] = [];
  if (review?.verdict) cleared.push(`Safety ${humanise(review.verdict)}`);
  if (approval?.decision?.decision)
    cleared.push(
      `${sentenceCase(humanise(approval.decision.decision))} by ${approval.decision.by ?? agentLabel(approval.decision.event.agent)}`,
    );
  else if (approval && pending.length === 0)
    cleared.push("Approval requested, no decision recorded");
  else if (review && review.requires_approval === false)
    cleared.push("No approval needed");
  return (
    <>
      {pending.map((entry) => (
        <ApprovalAction key={entry.id} approval={entry} />
      ))}
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full min-w-[34rem] border-collapse text-left text-base">
          <thead>
            <tr className="border-b border-border-subtle text-2xs text-subtle-foreground">
              <th className="py-2 pr-4 font-normal">Test</th>
              <th className="py-2 pr-4 font-normal">Bears on</th>
              <th className="py-2 pr-4 text-right font-normal">Learning</th>
              <th className="py-2 pr-4 text-right font-normal">Feasibility</th>
              <th className="py-2 pr-4 text-right font-normal">Cost</th>
              <th className="py-2 font-normal">
                <span className="sr-only">Choice</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.tests.map((test) => {
              const chosen = test.id === chosenId;
              const earlier = view.plans.findIndex(
                (entry) => entry.chosen_test_id === test.id,
              );
              const earlierRound =
                !chosen && earlier >= 0
                  ? (view.plans[earlier].round ?? earlier + 1)
                  : undefined;
              return (
                <tr
                  key={test.id}
                  data-chosen={chosen || undefined}
                  className={cn(
                    "border-b border-border-subtle last:border-b-0",
                    chosen &&
                      "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
                  )}
                >
                  <td className="py-3 pr-4 pl-3">
                    <span className="font-mono text-muted-foreground">
                      {test.id}
                    </span>{" "}
                    <span className={cn(chosen && "font-medium")}>
                      {test.test_kind
                        ? sentenceCase(humanise(test.test_kind))
                        : "Unnamed test"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-sm" translate="no">
                    {test.tests_hypotheses.join(" ") || "None"}
                  </td>
                  <td className="tabular py-3 pr-4 text-right font-mono">
                    {score(test.expected_learning.value)}
                  </td>
                  <td className="tabular py-3 pr-4 text-right font-mono">
                    {score(test.feasibility.value)}
                  </td>
                  <td className="tabular py-3 pr-4 text-right font-mono text-sm whitespace-nowrap">
                    {cost(test)}
                  </td>
                  <td className="py-3 pr-3 text-right text-xs whitespace-nowrap">
                    {chosen ? (
                      <span className="font-medium text-foreground">
                        Chosen
                      </span>
                    ) : earlierRound !== undefined ? (
                      <span className="text-foreground">
                        Run in round {earlierRound}
                      </span>
                    ) : test.requires_approval ? (
                      <span className="text-muted-foreground">
                        Needs approval
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cleared.length ? (
        <p
          className="mt-3 line-clamp-2 text-sm text-muted-foreground"
          title={cleared.join(" · ")}
        >
          {cleared.join(" · ")}
        </p>
      ) : null}
    </>
  );
}

function ResultStep({
  onDetails,
}: {
  onDetails: (stage: LoopStageId) => void;
}) {
  const { run, view } = useRun();
  const [picked, setPicked] = useState<number | null>(null);
  const latest = view.results.at(-1);
  if (!latest) return <Waiting who="runner" />;
  const result =
    view.results.find((entry) => entry.event.seq === picked) ?? latest;
  const interpretation = view.interpretations.findLast(
    (entry) => entry.test_id === result.test_id,
  );
  const caveat = result.limitations[0];
  return (
    <div className="flex flex-col gap-4">
      {view.results.length > 1 ? (
        <div
          role="tablist"
          aria-label="Tests run"
          className="flex flex-wrap items-center gap-1 self-start rounded-md border border-border p-0.5"
        >
          {view.results.map((entry) => {
            const selected = entry === result;
            return (
              <button
                key={entry.event.seq}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPicked(entry.event.seq)}
                className={cn(
                  "h-7 rounded-sm px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="font-mono">{entry.test_id}</span>{" "}
                {entry.test_kind
                  ? sentenceCase(humanise(entry.test_kind))
                  : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <ResultFigure
        key={result.event.seq}
        result={result}
        subject={run.subject}
      />
      {interpretation?.per_hypothesis.length ? (
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          {interpretation.per_hypothesis.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-base">
              <span className="font-mono text-muted-foreground">
                {entry.id}
              </span>
              <VerdictTag verdict={entry.verdict} className="text-sm" />
            </li>
          ))}
        </ul>
      ) : null}
      {caveat ? (
        <p className="text-sm text-muted-foreground">
          {caveat}{" "}
          <button
            type="button"
            onClick={() => onDetails("result")}
            className="rounded-xs text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground"
          >
            Limits
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Favoured({
  label,
  hypothesisId,
  mechanism,
}: {
  label: string;
  hypothesisId: string | null;
  mechanism: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs text-subtle-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        {hypothesisId ? (
          <span className="font-mono text-lg text-muted-foreground">
            {hypothesisId}
          </span>
        ) : null}
        <span className="text-2xl font-medium text-foreground">
          {mechanism ? sentenceCase(humanise(mechanism)) : "Unknown"}
        </span>
      </span>
    </div>
  );
}

function DecisionStep() {
  const { view } = useRun();
  const outcome = overallOutcome(view);
  if (!outcome) return <Waiting who="analysis agent" />;
  const next = view.nextExperiments.at(-1);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 border-y border-border py-5">
        <Favoured
          label={outcome.rounds > 1 ? "Before testing" : "Before the test"}
          hypothesisId={outcome.before.hypothesisId}
          mechanism={outcome.before.value}
        />
        <ArrowRightIcon
          aria-hidden
          className="mb-1.5 size-5 shrink-0 text-muted-foreground"
        />
        <Favoured
          label={
            outcome.rounds > 1
              ? `After ${outcome.rounds} tests`
              : "After the test"
          }
          hypothesisId={outcome.after.hypothesisId}
          mechanism={outcome.after.value}
        />
        <span
          data-changed={outcome.changed}
          className={cn(
            "ml-auto rounded-xs border px-2.5 py-1 text-lg font-medium",
            outcome.changed
              ? "border-foreground bg-foreground text-background"
              : "border-border-strong text-foreground",
          )}
        >
          {outcome.changed ? "Changed" : "Unchanged"}
        </span>
      </div>
      <EvidenceBadge
        evidenceClass="orphafold_hypothesis"
        detail="agent-generated, not validated"
        className="self-start"
      />
      {next?.description ? (
        <div className="flex flex-col gap-1">
          <span className="text-2xs text-subtle-foreground">
            Next experiment
          </span>
          <p
            className="line-clamp-2 max-w-[72ch] text-base text-foreground"
            title={next.description}
          >
            {next.description}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const STEP_LINE: Record<LoopStageId, (counts: Counts) => string | null> = {
  question: () => null,
  evidence: ({ evidence, databases, gaps }) =>
    evidence
      ? `${evidence} sourced items from ${databases} databases, ${gaps} gaps.`
      : null,
  hypothesis: ({ hypotheses }) =>
    hypotheses ? `${hypotheses} competing mechanisms, ranked.` : null,
  experiment: ({ tests }) =>
    tests ? `${tests} tests scored, one chosen.` : null,
  result: ({ results }) =>
    results ? "A computational test, not a laboratory observation." : null,
  decision: () => null,
};

interface Counts {
  evidence: number;
  databases: number;
  gaps: number;
  hypotheses: number;
  tests: number;
  results: number;
}

/** The output of one loop step, reduced to what a first reading needs. */
export function StepPanel({
  stage,
  onDetails,
}: {
  stage: LoopStageId;
  onDetails: (stage: LoopStageId) => void;
}) {
  const { view } = useRun();
  const line = STEP_LINE[stage]({
    evidence: view.evidence.length,
    databases: view.databases.length,
    gaps: view.gaps.length,
    hypotheses: view.hypotheses.length,
    tests: view.tests.length,
    results: view.results.length,
  });
  return (
    <section aria-label={STEP_LABEL[stage]} data-step={stage}>
      <PanelHead stage={stage} line={line} onDetails={onDetails} />
      {stage === "question" ? <QuestionStep /> : null}
      {stage === "evidence" ? <EvidenceStep /> : null}
      {stage === "hypothesis" ? <HypothesisStep /> : null}
      {stage === "experiment" ? <ExperimentStep /> : null}
      {stage === "result" ? <ResultStep onDetails={onDetails} /> : null}
      {stage === "decision" ? <DecisionStep /> : null}
    </section>
  );
}
