"use client";

import { cn } from "cn";
import { CheckIcon, FolderPlusIcon, MinusIcon, XIcon } from "lucide-react";

import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { Fold } from "@/components/intervention/fold";
import { openAddToProject } from "@/components/project/add-to-project";
import { Button } from "@/components/ui/button";
import { toEvidenceItem } from "@/components/variant/evidence";
import { useAdvancedMode } from "@/lib/state/preferences";

import { SEGMENT_KIND_META, SEGMENT_KIND_ORDER } from "./segment-kinds";
import type {
  AnswerSegment,
  AssistantAnswer,
  CitedEvidence,
  DraftSegment,
  Lookup,
  SegmentKind,
  Turn,
} from "./types";

const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

function KindMark({
  kind,
  withLabel = true,
}: {
  kind: SegmentKind;
  withLabel?: boolean;
}) {
  const meta = SEGMENT_KIND_META[kind];
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-2xs leading-4"
      title={withLabel ? undefined : `${meta.label}. ${meta.description}`}
    >
      <span
        className={cn(
          "font-mono font-semibold tracking-[0.06em]",
          meta.textClass,
        )}
      >
        {meta.code}
      </span>
      {withLabel ? (
        <span className="text-muted-foreground">{meta.label}</span>
      ) : (
        <span className="sr-only">{meta.label}</span>
      )}
    </span>
  );
}

function Citation({
  cited,
  advanced,
}: {
  cited: CitedEvidence;
  advanced: boolean;
}) {
  const record = cited.evidence.source?.record_id ?? cited.key;
  return (
    <EvidencePopover
      evidence={toEvidenceItem(cited.evidence)}
      detail={shorten(record, advanced ? 24 : 16)}
      side="left"
      align="start"
    />
  );
}

function Segment({
  segment,
  evidence,
  onSaveHypothesis,
  advanced,
}: {
  segment: AnswerSegment;
  evidence: Map<string, CitedEvidence>;
  onSaveHypothesis?: () => void;
  advanced: boolean;
}) {
  const meta = SEGMENT_KIND_META[segment.kind];
  const cited = segment.citations
    .map((key) => evidence.get(key))
    .filter((row): row is CitedEvidence => row !== undefined);
  const save = onSaveHypothesis ? (
    <button
      type="button"
      onClick={onSaveHypothesis}
      className="w-fit cursor-pointer text-2xs text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
    >
      Save as hypothesis
    </button>
  ) : null;

  if (!advanced)
    return (
      <div
        data-segment={segment.kind}
        className={cn("flex flex-col gap-1 py-0.5 pl-2.5", meta.ruleClass)}
      >
        <p className="text-sm text-foreground">{segment.text}</p>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <KindMark kind={segment.kind} withLabel={false} />
          {cited.map((row) => (
            <Citation key={row.key} cited={row} advanced={false} />
          ))}
          {cited.length === 0 && segment.kind === "reasoning_hypothesis" ? (
            <span className="text-2xs text-subtle-foreground">No source</span>
          ) : null}
          {segment.note ? (
            <span
              className="text-2xs text-subtle-foreground"
              title={`Checked by Helix: ${segment.note}`}
            >
              relabelled
            </span>
          ) : null}
          {save}
        </div>
      </div>
    );

  return (
    <div
      data-segment={segment.kind}
      className={cn("flex flex-col gap-0.5 py-0.5 pl-2.5", meta.ruleClass)}
    >
      <KindMark kind={segment.kind} />
      <p className="text-sm text-foreground">{segment.text}</p>
      {cited.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-0.5">
          {segment.kind === "reasoning_hypothesis" ? (
            <span className="mr-1.5 text-2xs text-muted-foreground">
              Rests on
            </span>
          ) : null}
          {cited.map((row) => (
            <Citation key={row.key} cited={row} advanced />
          ))}
        </div>
      ) : segment.kind === "reasoning_hypothesis" ? (
        <p className="text-2xs text-subtle-foreground">
          No source record cited.
        </p>
      ) : null}
      {segment.note ? (
        <p className="text-2xs text-muted-foreground">
          Checked by Helix: {segment.note}
        </p>
      ) : null}
      {save}
    </div>
  );
}

/** Text as it streams. The labels are the model's own until the server has checked the citations. */
export function DraftSegments({ draft }: { draft: DraftSegment[] }) {
  const advanced = useAdvancedMode();
  return (
    <div className="flex flex-col gap-2.5">
      {draft.map((segment, index) => {
        const meta = segment.kind ? SEGMENT_KIND_META[segment.kind] : null;
        return (
          <div
            key={index}
            className={cn(
              "flex flex-col gap-0.5 py-0.5 pl-2.5",
              meta?.ruleClass ?? "border-l-2 border-border",
            )}
          >
            {segment.kind && advanced ? <KindMark kind={segment.kind} /> : null}
            <p className="text-sm text-foreground">{segment.text}</p>
          </div>
        );
      })}
      <p className="text-2xs text-muted-foreground">
        {advanced
          ? "Labels are unchecked until the citations are verified."
          : "Checking citations"}
      </p>
    </div>
  );
}

function LookupRows({
  lookups,
}: {
  lookups: (Lookup & { pending?: boolean })[];
}) {
  return (
    <ul className="flex flex-col text-2xs">
      {lookups.map((lookup) => (
        <li key={lookup.id} className="flex min-h-5 items-center gap-1.5">
          {lookup.pending ? (
            <MinusIcon aria-hidden className="size-3 text-subtle-foreground" />
          ) : lookup.ok ? (
            <CheckIcon aria-hidden className="size-3 text-muted-foreground" />
          ) : (
            <XIcon aria-hidden className="size-3 text-destructive" />
          )}
          <span className="min-w-0 truncate text-muted-foreground">
            {lookup.label}
          </span>
          <span className="tabular ml-auto shrink-0 font-mono text-subtle-foreground">
            {lookup.pending
              ? "reading"
              : lookup.ok
                ? `${lookup.evidence_count} record${lookup.evidence_count === 1 ? "" : "s"}`
                : (lookup.message ?? "failed")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What was read to answer: one line, the list behind it. Advanced prints the list. */
export function LookupList({
  lookups,
}: {
  lookups: (Lookup & { pending?: boolean })[];
}) {
  const advanced = useAdvancedMode();
  if (lookups.length === 0) return null;
  if (advanced)
    return (
      <div className="border-y border-border-subtle py-1">
        <LookupRows lookups={lookups} />
      </div>
    );
  const reading = lookups.find((lookup) => lookup.pending);
  const failed = lookups.filter(
    (lookup) => !lookup.pending && !lookup.ok,
  ).length;
  const records = lookups.reduce(
    (total, lookup) => total + (lookup.ok ? lookup.evidence_count : 0),
    0,
  );
  return (
    <Fold
      tone="quiet"
      className="-mx-3"
      title={
        reading
          ? `Reading ${reading.label}`
          : `${lookups.length} lookup${lookups.length === 1 ? "" : "s"}, ${records} record${records === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`
      }
    >
      <div className="px-3 pb-1">
        <LookupRows lookups={lookups} />
      </div>
    </Fold>
  );
}

export function AnswerView({
  turn,
}: {
  turn: Turn & { answer: AssistantAnswer };
}) {
  const advanced = useAdvancedMode();
  const { answer } = turn;
  const evidence = new Map(answer.evidence.map((row) => [row.key, row]));
  const route =
    typeof window === "undefined"
      ? undefined
      : `${window.location.pathname}${window.location.search}`;
  const digest = answer.generated_by === "source_digest";

  const saveAnswer = () =>
    openAddToProject({
      kind: "note",
      ref: `orpha:${turn.id}`,
      label: digest
        ? "Helix source digest"
        : `Helix: ${shorten(turn.question, 90)}`,
      origin: route ? { route, note: "Saved from the assistant" } : undefined,
      evidence: answer.evidence.map((row) => row.evidence),
      data: {
        question: turn.question,
        context: turn.context,
        audience: turn.audience,
        generated_by: answer.generated_by,
        model: answer.model,
        segments: answer.segments,
      },
    });

  const saveHypothesis = (segment: AnswerSegment, index: number) =>
    openAddToProject({
      kind: "hypothesis",
      ref: `orpha:${turn.id}:${index}`,
      label: shorten(segment.text, 140),
      origin: route
        ? {
            route,
            note: `Reasoning by Helix on "${shorten(turn.question, 80)}"`,
          }
        : undefined,
      evidence: segment.citations
        .map((key) => evidence.get(key)?.evidence)
        .filter((row) => row !== undefined),
      data: {
        statement: segment.text,
        question: turn.question,
        authoring: { method: "llm_assisted", model: answer.model },
        derived_from: segment.citations
          .map((key) => evidence.get(key)?.evidence.id)
          .filter((id) => id !== undefined),
      },
    });

  const counts = SEGMENT_KIND_ORDER.map((kind) => ({
    kind,
    count: answer.segments.filter((segment) => segment.kind === kind).length,
  })).filter((row) => row.count > 0);

  const renderSegment = (segment: AnswerSegment, index: number) => (
    <Segment
      segment={segment}
      evidence={evidence}
      advanced={advanced}
      onSaveHypothesis={
        segment.kind === "reasoning_hypothesis" && !digest
          ? () => saveHypothesis(segment, index)
          : undefined
      }
    />
  );

  // A digest is a list of records per entity: closed to its counts in the simple view
  const groups: { heading: string; rows: [AnswerSegment, number][] }[] = [];
  if (digest && !advanced)
    answer.segments.forEach((segment, index) => {
      if (segment.heading || groups.length === 0)
        groups.push({ heading: segment.heading ?? "Records", rows: [] });
      groups[groups.length - 1].rows.push([segment, index]);
    });

  return (
    <div className="flex flex-col gap-2.5">
      {answer.segments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No source record found.</p>
      ) : null}
      {groups.length > 0 ? (
        <div className="-mx-3 border-t border-border-subtle">
          {groups.map((group, position) => (
            <Fold
              key={`${group.heading}-${position}`}
              title={group.heading}
              count={group.rows.length}
              defaultOpen={position === 0}
            >
              <div className="flex flex-col gap-2.5 px-3 pt-1 pb-3">
                {group.rows.map(([segment, index]) => (
                  <div key={index}>{renderSegment(segment, index)}</div>
                ))}
              </div>
            </Fold>
          ))}
        </div>
      ) : (
        answer.segments.map((segment, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            {segment.heading ? (
              <h4 className="mt-1 border-b border-border-subtle pb-1 text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
                {segment.heading}
              </h4>
            ) : null}
            {renderSegment(segment, index)}
          </div>
        ))
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        {advanced
          ? counts.map(({ kind, count }) => (
              <span key={kind} className="tabular font-mono">
                {count} {SEGMENT_KIND_META[kind].code}
              </span>
            ))
          : null}
        {answer.downgraded > 0 ? (
          <span>
            {answer.downgraded} uncited claim
            {answer.downgraded === 1 ? "" : "s"} shown as reasoning
          </span>
        ) : null}
        <span className="min-w-0 truncate">
          {digest
            ? "Source records, no model"
            : advanced
              ? `Written by ${answer.model ?? "the model"} from the records above`
              : (answer.model ?? "Model")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={saveAnswer}
        >
          <FolderPlusIcon data-icon="inline-start" aria-hidden />
          Save
        </Button>
      </div>
    </div>
  );
}
