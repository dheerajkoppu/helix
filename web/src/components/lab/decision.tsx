"use client";

import { ArrowRightIcon } from "lucide-react";

import { humanise } from "@/components/lab/format";
import {
  overallOutcome,
  type DecisionEntry,
  type NextExperimentEntry,
} from "@/components/lab/record";
import { useEntryProps, useRun } from "@/components/lab/run-context";
import {
  ByLine,
  IdLink,
  LoopSection,
  NotRecorded,
  Subhead,
} from "@/components/lab/section";
import { Plate } from "@/components/shell/page";

/** The hypothesis a decision names, by its id or, failing that, by its mechanism class. */
function Favoured({
  hypothesisId,
  value,
  label,
  withStatement = false,
}: {
  hypothesisId: string | null;
  value: string | null;
  label: string;
  withStatement?: boolean;
}) {
  const { view } = useRun();
  const hypothesis =
    view.hypotheses.find((entry) => entry.id === (hypothesisId ?? value)) ??
    view.hypotheses.find((entry) => entry.mechanism_class === value);
  const mechanism = hypothesis?.mechanism_class ?? value;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      {mechanism === null && !hypothesis ? (
        <span className="text-sm text-subtle-foreground">Not recorded</span>
      ) : (
        <>
          <span className="flex flex-wrap items-baseline gap-x-2 text-base font-medium text-foreground">
            {mechanism ? humanise(mechanism) : null}
            {hypothesis ? <IdLink id={hypothesis.id} /> : null}
          </span>
          {withStatement && hypothesis?.statement ? (
            <span className="line-clamp-3 text-xs text-muted-foreground">
              {hypothesis.statement}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function BeforeAfter({
  before,
  after,
  beforeLabel,
  afterLabel,
  withStatement,
}: {
  before: { hypothesisId: string | null; value: string | null };
  after: { hypothesisId: string | null; value: string | null };
  beforeLabel: string;
  afterLabel: string;
  withStatement?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
      <Favoured {...before} label={beforeLabel} withStatement={withStatement} />
      <ArrowRightIcon
        aria-hidden
        className="hidden size-4 shrink-0 self-center text-subtle-foreground md:block"
      />
      <Favoured {...after} label={afterLabel} withStatement={withStatement} />
    </div>
  );
}

function DecisionRound({
  decision,
  showFavoured,
}: {
  decision: DecisionEntry;
  /** false when the run has one decision, which the summary above already spells out */
  showFavoured: boolean;
}) {
  const props = useEntryProps(
    decision.event.seq,
    "border-b border-border-subtle px-3 py-3 last:border-b-0",
  );
  return (
    <li {...props}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {decision.round !== null ? `Round ${decision.round}` : "Decision"}
          {decision.after_test_id ? (
            <>
              , after <IdLink id={decision.after_test_id} />
            </>
          ) : null}
        </span>
        <span
          data-changed={decision.changed ?? undefined}
          className="font-medium text-foreground"
        >
          {decision.changed === null
            ? "Change not stated"
            : decision.changed
              ? "Changed"
              : "Unchanged"}
        </span>
        <ByLine event={decision.event} className="ml-auto" />
      </div>
      {showFavoured ? (
        <div className="mt-2.5">
          <BeforeAfter
            before={{
              hypothesisId: decision.favoured_before_hypothesis,
              value: decision.favoured_before,
            }}
            after={{
              hypothesisId: decision.favoured_after_hypothesis,
              value: decision.favoured_after,
            }}
            beforeLabel="Favoured before this test"
            afterLabel="Favoured after this test"
          />
        </div>
      ) : null}
      <p className="mt-2.5 max-w-[80ch] text-sm">
        <span className="text-muted-foreground">Why: </span>
        <span className="text-foreground">
          {decision.why ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </span>
      </p>
    </li>
  );
}

function NextExperimentBlock({ entry }: { entry: NextExperimentEntry }) {
  const props = useEntryProps(
    entry.event.seq,
    "border-b border-border-subtle px-3 py-3 last:border-b-0",
  );
  return (
    <li {...props}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {entry.kind
            ? `${humanise(entry.kind).replace(/^./, (first) => first.toUpperCase())} experiment`
            : "Experiment of unstated kind"}
        </span>
        <span className="text-muted-foreground">proposed, not run</span>
        <ByLine event={entry.event} className="ml-auto" />
      </div>
      <p className="mt-1.5 max-w-[72ch] text-base text-foreground">
        {entry.description ?? (
          <span className="text-subtle-foreground">
            No description recorded
          </span>
        )}
      </p>
      <p className="mt-1.5 text-xs">
        <span className="text-muted-foreground">Why now: </span>
        <span className="text-foreground">
          {entry.why_now ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </span>
      </p>
    </li>
  );
}

/**
 * The run's answer: whether testing moved the favoured mechanism away from what the starting
 * evidence suggested, stated plainly, then each round's decision and the experiment proposed next.
 */
export function UpdatedDecision() {
  const { view } = useRun();
  const outcome = overallOutcome(view);
  return (
    <LoopSection
      stage="decision"
      title="Updated decision"
      detail="A research conclusion about mechanism. Not clinical advice."
    >
      <Plate>
        {outcome ? (
          <div className="border-b border-border px-3 py-3">
            <p
              data-changed={outcome.changed}
              className="text-lg font-medium text-foreground"
            >
              {outcome.changed
                ? "Changed. Testing moved the favoured mechanism away from what the starting evidence suggested."
                : "Unchanged. Testing left the favoured mechanism where the starting evidence put it."}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Read from{" "}
              <span className="tabular font-mono text-foreground">
                {outcome.rounds}
              </span>{" "}
              recorded {outcome.rounds === 1 ? "decision" : "decisions"}: the
              favourite before the first test against the favourite after the
              last.
            </p>
            <div className="mt-3">
              <BeforeAfter
                before={outcome.before}
                after={outcome.after}
                beforeLabel="Suggested by the starting evidence"
                afterLabel="Favoured after testing"
                withStatement
              />
            </div>
          </div>
        ) : null}
        {view.decisions.length ? (
          <ul>
            {view.decisions.map((decision) => (
              <DecisionRound
                key={decision.event.seq}
                decision={decision}
                showFavoured={view.decisions.length > 1}
              />
            ))}
          </ul>
        ) : (
          <NotRecorded what="decision" />
        )}
        <Subhead
          title="Next experiment"
          count={view.nextExperiments.length}
          className="border-t border-t-border"
        />
        {view.nextExperiments.length ? (
          <ul>
            {view.nextExperiments.map((entry) => (
              <NextExperimentBlock key={entry.event.seq} entry={entry} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="next experiment" />
        )}
      </Plate>
    </LoopSection>
  );
}
