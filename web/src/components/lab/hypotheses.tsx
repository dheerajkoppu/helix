"use client";

import { RotateCcwIcon } from "lucide-react";
import { Fragment } from "react";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { VerdictTag, humanise } from "@/components/lab/format";
import type { HypothesisEntry, ReopeningEntry } from "@/components/lab/record";
import {
  ANCHOR_OFFSET,
  entryAnchor,
  useEntryProps,
  useRun,
} from "@/components/lab/run-context";
import {
  ByLine,
  IdLink,
  IdList,
  LoopSection,
  NotRecorded,
} from "@/components/lab/section";
import { Plate } from "@/components/shell/page";

const DEFAULT_LABEL = "agent-generated hypothesis";

function ReopeningRow({ reopening }: { reopening: ReopeningEntry }) {
  const props = useEntryProps(
    reopening.event.seq,
    "col-span-2 grid grid-cols-subgrid",
  );
  return (
    <div {...props}>
      <dt className="flex items-center gap-1 font-medium text-foreground">
        <RotateCcwIcon className="size-3" aria-hidden />
        Reopened
      </dt>
      <dd className="text-foreground">
        {reopening.reason ?? (
          <span className="text-subtle-foreground">No reason recorded</span>
        )}{" "}
        <ByLine event={reopening.event} />
      </dd>
    </div>
  );
}

function HypothesisRow({ entry }: { entry: HypothesisEntry }) {
  const { view } = useRun();
  const props = useEntryProps(
    entry.event.seq,
    "border-b border-border-subtle px-3 py-3 last:border-b-0",
  );
  const verdicts = view.interpretations.flatMap((interpretation) => {
    const verdict = interpretation.per_hypothesis.find(
      (item) => item.id === entry.id,
    );
    return verdict ? [{ interpretation, verdict }] : [];
  });
  const decision = view.decisions.at(-1);
  const favouredAfter =
    decision?.favoured_after_hypothesis ?? decision?.favoured_after ?? null;
  const reopenings = view.reopenings.filter(
    (reopening) => reopening.hypothesis_id === entry.id,
  );
  const label =
    entry.label ??
    (entry.event.agent === "human" ? "stated by a human" : DEFAULT_LABEL);

  return (
    <li {...props}>
      {entry.revises.map((seq) => (
        <span key={seq} id={entryAnchor(seq)} className={ANCHOR_OFFSET} />
      ))}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          className="font-mono text-xs font-medium text-foreground"
          translate="no"
        >
          {entry.id}
        </span>
        <EvidenceBadge evidenceClass="orphafold_hypothesis" detail={label} />
        {entry.mechanism_class ? (
          <span className="text-xs text-muted-foreground">
            Mechanism class{" "}
            <span className="font-medium text-foreground">
              {humanise(entry.mechanism_class)}
            </span>
          </span>
        ) : null}
        {entry.starting_rank !== null ? (
          <span className="text-xs text-muted-foreground">
            Starting rank{" "}
            <span className="tabular font-mono font-medium text-foreground">
              {entry.starting_rank}
            </span>
          </span>
        ) : null}
        {favouredAfter === entry.id ? (
          <span className="text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
            Favoured after the test
          </span>
        ) : null}
        <ByLine event={entry.event} className="ml-auto" />
      </div>
      <p className="mt-2 max-w-[72ch] text-base text-foreground">
        {entry.statement ?? (
          <span className="text-subtle-foreground">No statement recorded</span>
        )}
      </p>
      <dl className="mt-2.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Supported by</dt>
        <dd>
          <IdList ids={entry.supports} empty="No evidence item cited" />
        </dd>
        <dt className="text-muted-foreground">Would refute it</dt>
        <dd className="text-foreground">
          {entry.would_refute ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </dd>
        {entry.rank_rationale ? (
          <>
            <dt className="text-muted-foreground">Why that rank</dt>
            <dd className="text-foreground">{entry.rank_rationale}</dd>
          </>
        ) : null}
        {reopenings.map((reopening) => (
          <ReopeningRow key={reopening.event.seq} reopening={reopening} />
        ))}
        {entry.revises.length ? (
          <>
            <dt className="text-muted-foreground">Revised</dt>
            <dd className="text-foreground">
              Restated after {entry.revises.length === 1 ? "line" : "lines"}{" "}
              <span className="tabular font-mono">
                {entry.revises.join(", ")}
              </span>
              ; the latest statement is shown.
            </dd>
          </>
        ) : null}
        {verdicts.map(({ interpretation, verdict }) => (
          <Fragment key={interpretation.event.seq}>
            <dt className="text-muted-foreground">
              After{" "}
              {interpretation.test_id ? (
                <IdLink id={interpretation.test_id} />
              ) : (
                "the test"
              )}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <VerdictTag verdict={verdict.verdict} />
              {verdict.why ? (
                <span className="text-foreground">{verdict.why}</span>
              ) : null}
            </dd>
          </Fragment>
        ))}
      </dl>
    </li>
  );
}

/** The competing explanations, each labelled as generated by an agent and tied to its evidence. */
export function Hypotheses() {
  const { view } = useRun();
  const ranked = [...view.hypotheses].sort(
    (left, right) =>
      (left.starting_rank ?? Number.MAX_SAFE_INTEGER) -
      (right.starting_rank ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <LoopSection
      stage="hypothesis"
      title="Hypotheses"
      count={view.hypotheses.length}
      detail="Proposed by an agent from the evidence above, in the order the starting evidence ranked them. None is an established fact."
    >
      <Plate>
        {view.hypotheses.length ? (
          <ul>
            {ranked.map((entry) => (
              <HypothesisRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="hypotheses" />
        )}
      </Plate>
    </LoopSection>
  );
}
