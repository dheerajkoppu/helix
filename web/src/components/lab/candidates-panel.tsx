"use client";

import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";

import { ButtonLink } from "@/components/data/button-link";
import type {
  CandidateEntry,
  RuledOutEntry,
  TargetRationaleEntry,
} from "@/components/lab/record";
import { useRun } from "@/components/lab/run-context";
import { LoopSection } from "@/components/lab/section";
import { routes } from "@/lib/ids";
import {
  CANDIDATE_CAVEAT,
  CANDIDATE_WORDS,
  plainBridge,
  plainDirection,
  plainIndication,
  plainMechanismDirection,
  plainNoCandidateFinding,
  plainPhase,
  plainRequiredAction,
  plainRunSentence,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

/** The chain behind one candidate, closed until asked for. */
function Chain({
  candidate,
  onlyIf,
}: {
  candidate: CandidateEntry;
  onlyIf: string | null;
}) {
  const steps = candidate.bridge.steps;
  if (steps.length === 0 && candidate.caveats.length === 0 && !onlyIf)
    return null;
  return (
    <details className="group/chain mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-open/chain:rotate-90"
        />
        {CANDIDATE_WORDS.howWeGotHere}
      </summary>
      <ol className="mt-2 flex max-w-[72ch] flex-col gap-2 text-sm leading-6 text-muted-foreground">
        {onlyIf ? (
          <li>
            <span className="text-subtle-foreground">
              {CANDIDATE_WORDS.onlyIf}:
            </span>{" "}
            {onlyIf}
          </li>
        ) : null}
        {steps.map((step, index) => (
          <li key={index} className="flex gap-2">
            <span className="tabular shrink-0 font-mono text-2xs text-subtle-foreground">
              {index + 1}
            </span>
            <span className="min-w-0">
              {step.statement}
              {step.records.length ? (
                <span className="ml-2 font-mono text-2xs text-subtle-foreground">
                  {step.records.join(" · ")}
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {candidate.caveats.map((caveat) => (
          <li key={caveat} className="text-subtle-foreground">
            {caveat}
          </li>
        ))}
      </ol>
    </details>
  );
}

function CandidateRow({ candidate }: { candidate: CandidateEntry }) {
  const advanced = useAdvancedMode();
  const molecule = candidate.molecule;
  const phase = plainPhase(molecule?.max_phase);
  const onlyIf = plainRunSentence(
    candidate.what_would_have_to_be_true,
    advanced,
  );
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xl font-medium text-foreground" translate="no">
          {molecule?.name ?? CANDIDATE_WORDS.noMolecule}
        </span>
        {candidate.target.gene_symbol ? (
          <span className="text-base text-muted-foreground">
            on{" "}
            <span className="text-foreground" translate="no">
              {candidate.target.gene_symbol}
            </span>
          </span>
        ) : null}
        <span className="ml-auto shrink-0 rounded-xs border border-border-strong px-2 py-0.5 text-xs whitespace-nowrap text-foreground">
          {plainDirection(candidate.direction_check.verdict)}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {plainBridge(candidate.bridge.kind)}
        {plainIndication(candidate.bridge.from_disease)
          ? ` · ${plainIndication(candidate.bridge.from_disease)}`
          : ""}
        {phase ? ` · ${phase}` : ""}
      </p>
      <Chain candidate={candidate} onlyIf={onlyIf} />
    </li>
  );
}

function RuledOutList({ rows }: { rows: RuledOutEntry[] }) {
  return (
    <details className="group/ruled border-t border-border-strong pt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-4 transition-transform group-open/ruled:rotate-90"
        />
        {CANDIDATE_WORDS.ruledOut}
        <span className="tabular ml-1 font-mono text-sm text-muted-foreground">
          {rows.length}
        </span>
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {rows.map((row, index) => (
          <li
            key={`${row.molecule ?? "row"}-${index}`}
            className="flex flex-col"
          >
            <span className="text-foreground" translate="no">
              {row.molecule ?? "A molecule"}
              {row.target ? (
                <span className="text-muted-foreground"> on {row.target}</span>
              ) : null}
            </span>
            <span className="text-muted-foreground">
              {row.reason ?? CANDIDATE_WORDS.ruledOutLine}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Directions that mean the protein does too little, so there is little left to act on. */
const TOO_LITTLE = new Set([
  "loss_of_function",
  "decreased_activity",
  "decreased_function",
  "no_function",
  "haploinsufficiency",
  "too_little",
]);

/** The end of a run that keeps nothing: the finding in three lines, not a blank. */
function NoCandidates({
  rationale,
  ruledOut,
}: {
  rationale: TargetRationaleEntry | undefined;
  ruledOut: number;
}) {
  const [lead, ...rest] = plainNoCandidateFinding({
    ruledOut,
    action: rationale?.required_actions[0],
    tooLittle: [rationale?.direction, rationale?.mechanism_class].some(
      (value) => value && TOO_LITTLE.has(value.toLowerCase()),
    ),
  });
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="max-w-[48ch] text-2xl font-medium tracking-[-0.01em] text-foreground">
        {lead}
      </p>
      {rest.map((line) => (
        <p key={line} className="max-w-[72ch] text-base text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The end of the loop: what a molecule would have to do to the protein, the candidates that push it that
 * way, and the rows the direction filter refused. Every row is a Helix hypothesis.
 */
export function CandidatesPanel({ className }: { className?: string }) {
  const { view, run } = useRun();
  const rationale = view.targetRationales.at(-1);
  const gene = run.subject.gene;
  const discoverHref = gene
    ? routes.discover(gene, { variant: run.subject.variant_id })
    : null;
  if (!rationale && view.candidates.length === 0 && view.ruledOut.length === 0)
    return (
      <p
        role="status"
        className={cn(
          "border border-dashed border-border-strong px-4 py-6 text-base text-muted-foreground",
          className,
        )}
      >
        {CANDIDATE_WORDS.notReached}
      </p>
    );
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {rationale ? (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-y border-border py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-subtle-foreground">
              {CANDIDATE_WORDS.direction}
            </span>
            <span className="text-lg text-foreground">
              {plainMechanismDirection(rationale.direction)}
            </span>
          </div>
          <ArrowRightIcon
            aria-hidden
            className="mb-1.5 size-5 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-subtle-foreground">
              {CANDIDATE_WORDS.whatToAimAt}
            </span>
            <span className="text-2xl font-medium text-foreground">
              {plainRequiredAction(rationale.required_actions[0])}
            </span>
          </div>
        </div>
      ) : null}

      {view.candidates.length ? (
        <ul className="flex flex-col">
          {view.candidates.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} />
          ))}
        </ul>
      ) : (
        <NoCandidates
          rationale={rationale}
          ruledOut={
            view.ruledOut.length || (run.metrics.ruled_out_by_direction ?? 0)
          }
        />
      )}

      {view.ruledOut.length ? <RuledOutList rows={view.ruledOut} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-subtle-foreground">{CANDIDATE_CAVEAT}</p>
        {discoverHref ? (
          <ButtonLink href={discoverHref} variant="ghost" size="sm">
            {CANDIDATE_WORDS.seeAll}
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

/** The candidates block of the full record: the same rows under the loop's seventh position. */
export function Candidates() {
  const { view } = useRun();
  return (
    <LoopSection
      stage="candidates"
      title="Candidates"
      count={view.candidates.length}
      detail="Hypotheses Helix generated about a molecular action. Not recommendations."
    >
      <CandidatesPanel />
    </LoopSection>
  );
}
