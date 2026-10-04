"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { useState } from "react";
import { toast } from "sonner";

import { TextLink } from "@/components/data/text-link";
import { decideApproval, labKeys } from "@/components/lab/api";
import { CandidatesPanel } from "@/components/lab/candidates-panel";
import { VerdictTag } from "@/components/lab/format";
import {
  evidenceBySource,
  findingOf,
  rankedCauses,
  stepCounts,
} from "@/components/lab/plain";
import {
  overallOutcome,
  type ApprovalEntry,
  type EvidenceEntry,
  type LoopStageId,
  type TestEntry,
} from "@/components/lab/record";
import { ResultFigure } from "@/components/lab/result-figure";
import { useRun } from "@/components/lab/run-context";
import { isActiveStatus } from "@/components/lab/types";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/client";
import { aminoAcidName, parseVariantId, routes } from "@/lib/ids";
import {
  HYPOTHESIS_CAVEAT,
  LOOP_STEPS,
  RESULT_WORDS,
  STEP_WORDS,
  plainCause,
  plainChange,
  plainCount,
  plainDuration,
  plainEffort,
  plainLearning,
  plainMutationRow,
  plainNext,
  plainResult,
  plainSource,
  plainStepCaption,
  plainTestCaveat,
  plainTestName,
  plainTestQuestion,
  type LoopStep,
} from "@/lib/plain-language";

const STEP_OF: Record<LoopStageId, LoopStep> = {
  question: LOOP_STEPS[0],
  evidence: LOOP_STEPS[1],
  hypothesis: LOOP_STEPS[2],
  experiment: LOOP_STEPS[3],
  result: LOOP_STEPS[4],
  decision: LOOP_STEPS[5],
  candidates: LOOP_STEPS[6],
};

/** The agents' own text, closed until asked for. */
function Reveal({
  label = STEP_WORDS.details,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group/reveal", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-open/reveal:rotate-90"
        />
        {label}
      </summary>
      <div className="mt-2 max-w-[72ch] text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function Waiting() {
  const { run, replaying } = useRun();
  const live = replaying || isActiveStatus(run.status);
  return (
    <p
      role="status"
      className="border border-dashed border-border-strong px-4 py-6 text-base text-muted-foreground"
    >
      {live ? STEP_WORDS.waiting : STEP_WORDS.notReached}
    </p>
  );
}

function QuestionStep() {
  const { run } = useRun();
  const subject = run.subject;
  const parsed = subject.variant_id ? parseVariantId(subject.variant_id) : null;
  const substitution = parsed?.kind === "substitution" ? parsed : null;
  const change = substitution
    ? plainChange(
        aminoAcidName(substitution.change.reference),
        aminoAcidName(substitution.change.alternate),
        substitution.change.position,
      )
    : null;
  return (
    <>
      <p className="text-2xl font-medium tracking-[-0.01em] text-foreground">
        {plainStepCaption("Question")}
      </p>
      <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4">
        {subject.gene ? (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-subtle-foreground">
              {STEP_WORDS.gene}
            </dt>
            <dd className="text-lg text-foreground">
              <TextLink href={routes.gene(subject.gene)} translate="no">
                {subject.gene}
              </TextLink>
            </dd>
          </div>
        ) : null}
        {subject.variant_id ? (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-subtle-foreground">
              {STEP_WORDS.mutation}
            </dt>
            <dd className="text-lg text-foreground">
              <TextLink
                href={routes.variant(subject.variant_id)}
                translate="no"
              >
                {change ??
                  plainMutationRow(substitution?.label ?? subject.variant_id)}
              </TextLink>
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

function Statements({ entries }: { entries: EvidenceEntry[] }) {
  return (
    <ul className="flex flex-col gap-3 pt-1 pr-2 pb-4 pl-6">
      {entries.map((entry) => {
        const source = entry.event.sources[0];
        return (
          <li
            key={entry.event.seq}
            className="max-w-[78ch] text-sm leading-6 text-muted-foreground"
          >
            {entry.statement}{" "}
            {source?.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground"
              >
                {plainSource(source.database)}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CountRow({
  name,
  count,
  children,
}: {
  name: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <li className="border-b border-border-subtle">
      <details className="group/row">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-1 text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/row:rotate-90"
          />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {name}
          </span>
          <span className="tabular font-mono text-base text-muted-foreground">
            {count}
          </span>
        </summary>
        {children}
      </details>
    </li>
  );
}

function EvidenceStep() {
  const { view } = useRun();
  if (view.evidence.length === 0) return <Waiting />;
  const { groups, unsourced } = evidenceBySource(view);
  return (
    <ul className="max-w-3xl border-t border-border">
      {groups.map((group) => (
        <CountRow
          key={group.database}
          name={plainSource(group.database)}
          count={group.entries.length}
        >
          <Statements entries={group.entries} />
        </CountRow>
      ))}
      {unsourced.length ? (
        <CountRow name={STEP_WORDS.noSource} count={unsourced.length}>
          <Statements entries={unsourced} />
        </CountRow>
      ) : null}
      {view.gaps.length ? (
        <CountRow name={STEP_WORDS.openQuestions} count={view.gaps.length}>
          <ul className="flex flex-col gap-3 pt-1 pr-2 pb-4 pl-6">
            {view.gaps.map((gap) => (
              <li
                key={gap.event.seq}
                className="max-w-[78ch] text-sm leading-6 text-muted-foreground"
              >
                {gap.statement}
              </li>
            ))}
          </ul>
        </CountRow>
      ) : null}
    </ul>
  );
}

function Caveat({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function HypothesisStep() {
  const { view } = useRun();
  if (view.hypotheses.length === 0) return <Waiting />;
  const causes = rankedCauses(view);
  const verdicts = new Map(
    view.interpretations
      .at(-1)
      ?.per_hypothesis.map((entry) => [entry.id, entry.verdict]),
  );
  return (
    <div className="flex flex-col gap-4">
      <ol className="max-w-3xl border-t border-border">
        {causes.map((cause, index) => {
          const verdict = verdicts.get(cause.id) ?? null;
          return (
            <li
              key={cause.id}
              className={cn(
                "flex flex-col gap-1.5 border-b border-border-subtle py-3.5 pr-1 pl-3",
                index === 0 && "shadow-[inset_2px_0_0_var(--foreground)]",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="tabular w-4 font-mono text-base text-muted-foreground">
                  {index + 1}
                </span>
                <h3
                  className={cn(
                    "text-lg text-foreground",
                    index === 0 && "font-medium",
                  )}
                >
                  {plainCause(cause.mechanism_class)}
                </h3>
                {index === 0 ? (
                  <span className="rounded-xs border border-foreground px-1.5 text-xs leading-5 font-medium text-foreground">
                    {STEP_WORDS.topCause}
                  </span>
                ) : null}
                {verdict ? (
                  <VerdictTag
                    verdict={verdict}
                    plain
                    className="ml-auto text-sm"
                  />
                ) : null}
              </div>
              {cause.statement ? (
                <Reveal className="pl-7">{cause.statement}</Reveal>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Caveat>{HYPOTHESIS_CAVEAT}</Caveat>
    </div>
  );
}

function ApprovalAction({
  approval,
  test,
}: {
  approval: ApprovalEntry;
  test: TestEntry | undefined;
}) {
  const { run } = useRun();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      decideApproval(run.run_id, approval.id, decision, ""),
    onSuccess: (_, decision) => {
      toast(
        decision === "approved" ? STEP_WORDS.approved : STEP_WORDS.rejected,
      );
      void queryClient.invalidateQueries({ queryKey: labKeys.run(run.run_id) });
      void queryClient.invalidateQueries({ queryKey: labKeys.runs() });
    },
    onError: (error) => {
      toast.error(STEP_WORDS.notSaved, {
        description: isApiError(error) ? error.message : undefined,
      });
    },
  });
  return (
    <div
      role="group"
      aria-label={STEP_WORDS.needsApproval}
      className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 border border-foreground px-4 py-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-lg font-medium text-foreground">
          {STEP_WORDS.needsApproval}
        </p>
        <p className="text-base text-muted-foreground">
          {plainTestQuestion(test?.test_kind)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="lg"
          className="h-10 px-5 text-sm"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approved")}
        >
          {STEP_WORDS.approve}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-10"
          disabled={decide.isPending}
          onClick={() => decide.mutate("rejected")}
        >
          {STEP_WORDS.reject}
        </Button>
      </div>
    </div>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="text-base text-foreground">{value}</dd>
    </div>
  );
}

function ExperimentStep() {
  const { run, view, replaying } = useRun();
  if (view.tests.length === 0) return <Waiting />;
  const chosenId = view.plans.at(-1)?.chosen_test_id ?? null;
  const pending =
    !replaying && isActiveStatus(run.status)
      ? view.approvals.filter((approval) => !approval.decision)
      : [];
  const review = view.safetyReviews.findLast(
    (entry) => entry.test_id === chosenId,
  );
  const ran = new Set(view.results.map((result) => result.test_id));
  const refused = new Set(
    view.approvals
      .filter((approval) => approval.decision?.decision === "rejected")
      .map((approval) => approval.test_id),
  );
  const approved = view.approvals.some(
    (approval) =>
      approval.test_id === chosenId &&
      approval.decision?.decision === "approved",
  );
  const notes: string[] = [];
  if (review?.verdict)
    notes.push(
      review.verdict === "cleared"
        ? STEP_WORDS.safetyOk
        : STEP_WORDS.safetyBlocked,
    );
  if (approved) notes.push(STEP_WORDS.approved);
  return (
    <>
      {pending.map((approval) => (
        <ApprovalAction
          key={approval.id}
          approval={approval}
          test={view.tests.find((test) => test.id === approval.test_id)}
        />
      ))}
      <ul className="max-w-4xl border-t border-border">
        {view.tests.map((test) => {
          const chosen = test.id === chosenId;
          const waitingOnYou = pending.some(
            (approval) => approval.test_id === test.id,
          );
          const state = waitingOnYou
            ? STEP_WORDS.needsApproval
            : chosen
              ? STEP_WORDS.chosen
              : ran.has(test.id)
                ? STEP_WORDS.alreadyRun
                : refused.has(test.id)
                  ? STEP_WORDS.rejected
                  : null;
          return (
            <li
              key={test.id}
              data-chosen={chosen || undefined}
              className={cn(
                "grid items-center gap-x-6 gap-y-2 border-b border-border-subtle py-3.5 pr-2 pl-3 md:grid-cols-[minmax(0,1fr)_auto_6.5rem]",
                chosen && "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
              )}
            >
              <p
                className={cn(
                  "text-lg text-foreground",
                  chosen && "font-medium",
                )}
              >
                {plainTestQuestion(test.test_kind)}
              </p>
              <dl className="grid grid-cols-[4.5rem_4.5rem_4.5rem] gap-x-4">
                <Score
                  label={STEP_WORDS.learn}
                  value={plainLearning(test.expected_learning.value)}
                />
                <Score
                  label={STEP_WORDS.effort}
                  value={plainEffort(test.feasibility.value)}
                />
                <Score
                  label={STEP_WORDS.time}
                  value={plainDuration(test.cost.compute_seconds)}
                />
              </dl>
              <span
                className={cn(
                  "text-sm md:text-right",
                  chosen || waitingOnYou
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {state}
              </span>
            </li>
          );
        })}
      </ul>
      {notes.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {notes.join(" · ")}
        </p>
      ) : null}
    </>
  );
}

function ResultStep() {
  const { run, view } = useRun();
  const [picked, setPicked] = useState<number | null>(null);
  const latest = view.results.at(-1);
  if (!latest) return <Waiting />;
  const result =
    view.results.find((entry) => entry.event.seq === picked) ?? latest;
  const interpretation = view.interpretations.findLast(
    (entry) => entry.test_id === result.test_id,
  );
  const causeOf = new Map(
    view.hypotheses.map((hypothesis) => [
      hypothesis.id,
      hypothesis.mechanism_class,
    ]),
  );
  return (
    <div className="flex flex-col gap-4">
      {view.results.length > 1 ? (
        <div
          role="tablist"
          aria-label={RESULT_WORDS.testsRun}
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
                {plainTestName(entry.test_kind)}
              </button>
            );
          })}
        </div>
      ) : null}
      <p className="text-2xl font-medium tracking-[-0.01em] text-foreground">
        {plainResult(result.test_kind, findingOf(result))}
      </p>
      <ResultFigure
        key={result.event.seq}
        result={result}
        subject={run.subject}
      />
      {interpretation?.per_hypothesis.length ? (
        <ul
          aria-label={RESULT_WORDS.causesAfter}
          className="max-w-3xl border-t border-border"
        >
          {interpretation.per_hypothesis.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border-subtle px-1 py-2.5 text-base"
            >
              <span className="text-foreground">
                {plainCause(causeOf.get(entry.id))}
              </span>
              <VerdictTag verdict={entry.verdict} plain className="text-sm" />
            </li>
          ))}
        </ul>
      ) : null}
      <Caveat>{plainTestCaveat(result.test_kind)}</Caveat>
    </div>
  );
}

function Answer({
  label,
  cause,
  strong,
}: {
  label: string;
  cause: string | null;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-subtle-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl",
          strong ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {plainCause(cause)}
      </span>
    </div>
  );
}

function DecisionStep() {
  const { view } = useRun();
  const outcome = overallOutcome(view);
  if (!outcome) return <Waiting />;
  const next = view.nextExperiments.at(-1);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 border-y border-border py-5">
        <Answer label={STEP_WORDS.before} cause={outcome.before.value} />
        <ArrowRightIcon
          aria-hidden
          className="mb-1.5 size-5 shrink-0 text-muted-foreground"
        />
        <Answer label={STEP_WORDS.after} cause={outcome.after.value} strong />
        <span
          data-changed={outcome.changed}
          className={cn(
            "ml-auto rounded-xs border px-2.5 py-1 text-base font-medium",
            outcome.changed
              ? "border-foreground bg-foreground text-background"
              : "border-border-strong text-foreground",
          )}
        >
          {outcome.changed ? STEP_WORDS.answerChanged : STEP_WORDS.answerHeld}
        </span>
      </div>
      <Caveat>{HYPOTHESIS_CAVEAT}</Caveat>
      {next ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-lg font-medium text-foreground">
            {plainNext(next.kind)}
          </p>
          <p className="text-base text-muted-foreground">
            {STEP_WORDS.nextLine}
          </p>
          {next.description ? <Reveal>{next.description}</Reveal> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One loop step in everyday words: counts and fixed wording, the agents' text behind Details. */
export function PlainStepPanel({
  stage,
  onDetails,
}: {
  stage: LoopStageId;
  onDetails: (stage: LoopStageId) => void;
}) {
  const { run, view, replaying } = useRun();
  const step = STEP_OF[stage];
  const counts = stepCounts(view);
  const reached =
    (stage === "evidence" && view.evidence.length > 0) ||
    (stage === "hypothesis" && view.hypotheses.length > 0) ||
    (stage === "experiment" && view.tests.length > 0) ||
    (stage === "candidates" &&
      (view.candidates.length > 0 || view.ruledOut.length > 0));
  const needsYou =
    stage === "experiment" &&
    !replaying &&
    isActiveStatus(run.status) &&
    view.approvals.some((approval) => !approval.decision);
  const line = needsYou
    ? STEP_WORDS.needsApproval
    : stage === "experiment" && reached && !counts.tests
      ? plainCount(view.tests.length, "test")
      : reached
        ? plainStepCaption(step, counts)
        : null;
  return (
    <section aria-label={step} data-step={stage}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            {step}
          </h2>
          {line ? (
            <p className="text-base text-muted-foreground">{line}</p>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onDetails(stage)}>
          {STEP_WORDS.fullRecord}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
      {stage === "question" ? <QuestionStep /> : null}
      {stage === "evidence" ? <EvidenceStep /> : null}
      {stage === "hypothesis" ? <HypothesisStep /> : null}
      {stage === "experiment" ? <ExperimentStep /> : null}
      {stage === "result" ? <ResultStep /> : null}
      {stage === "decision" ? <DecisionStep /> : null}
      {stage === "candidates" ? <CandidatesPanel /> : null}
    </section>
  );
}
