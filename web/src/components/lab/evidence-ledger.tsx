"use client";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { SourceLinks } from "@/components/lab/entity-links";
import { humanise } from "@/components/lab/format";
import type { EvidenceEntry, GapEntry } from "@/components/lab/record";
import { useEntryProps, useRun } from "@/components/lab/run-context";
import {
  ByLine,
  IdList,
  LoopSection,
  NotRecorded,
  Subhead,
} from "@/components/lab/section";
import { Plate } from "@/components/shell/page";
import { isEvidenceClass, type EvidenceClass } from "@/lib/evidence";
import { useAdvancedMode } from "@/lib/state/preferences";

const CLASS_ALIASES: Record<string, EvidenceClass> = {
  exp: "experimental",
  experiment: "experimental",
  clin: "clinical_database",
  clinical: "clinical_database",
  lit: "literature",
  publication: "literature",
  cur: "curated_database",
  curated: "curated_database",
  pred: "computational_prediction",
  prediction: "computational_prediction",
  computational: "computational_prediction",
  hyp: "helix_hypothesis",
  hypothesis: "helix_hypothesis",
};

export function toEvidenceClass(raw: string | null): EvidenceClass | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (isEvidenceClass(key)) return key;
  return CLASS_ALIASES[key] ?? null;
}

const ROW_GRID =
  "grid grid-cols-[3.25rem_3.5rem_minmax(0,1fr)] gap-x-3 px-3 text-xs";
// the class is a word outside Advanced, so its column is wider
const PLAIN_ROW_GRID =
  "grid grid-cols-[3.25rem_8.5rem_minmax(0,1fr)] gap-x-3 px-3 text-xs";

const useRowGrid = () => (useAdvancedMode() ? ROW_GRID : PLAIN_ROW_GRID);

/** Record items the line was linked to when it was written: hypotheses, tests, other evidence. */
function Refs({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
      Linked to <IdList ids={refs} empty="" />
    </p>
  );
}

function EvidenceRow({ entry }: { entry: EvidenceEntry }) {
  const { run } = useRun();
  const evidenceClass = toEvidenceClass(entry.evidence_class);
  const rowGrid = useRowGrid();
  const props = useEntryProps(
    entry.event.seq,
    `${rowGrid} border-b border-border-subtle py-2 last:border-b-0`,
  );
  return (
    <li {...props}>
      <span className="font-mono font-medium text-foreground" translate="no">
        {entry.id}
      </span>
      <span>
        {evidenceClass ? (
          <EvidenceBadge evidenceClass={evidenceClass} size="compact" />
        ) : (
          <span className="font-mono text-2xs text-muted-foreground">
            {entry.evidence_class ? humanise(entry.evidence_class) : "no class"}
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm text-foreground">
          {entry.statement ?? (
            <span className="text-subtle-foreground">
              No statement recorded
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SourceLinks sources={entry.event.sources} subject={run.subject} />
          <ByLine event={entry.event} className="ml-auto" />
        </div>
        {entry.strength ? (
          <p className="text-muted-foreground">
            Strength as the source states it:{" "}
            <span className="text-foreground">{entry.strength}</span>
          </p>
        ) : null}
        <Refs refs={entry.event.refs} />
      </div>
    </li>
  );
}

function GapRow({ entry }: { entry: GapEntry }) {
  const { run } = useRun();
  const rowGrid = useRowGrid();
  const props = useEntryProps(
    entry.event.seq,
    `${rowGrid} border-b border-border-subtle py-2 last:border-b-0`,
  );
  return (
    <li {...props}>
      <span className="font-mono font-medium text-foreground" translate="no">
        {entry.id ?? "gap"}
      </span>
      <span className="text-2xs text-muted-foreground">Gap</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm text-foreground">
          {entry.statement ?? (
            <span className="text-subtle-foreground">
              No statement recorded
            </span>
          )}
        </p>
        {entry.why_it_matters ? (
          <p className="text-muted-foreground">
            Why it matters:{" "}
            <span className="text-foreground">{entry.why_it_matters}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {entry.event.sources.length ? (
            <SourceLinks sources={entry.event.sources} subject={run.subject} />
          ) : null}
          <ByLine event={entry.event} className="ml-auto" />
        </div>
        <Refs refs={entry.event.refs} />
      </div>
    </li>
  );
}

/** Every evidence item the agents recorded, with its class, its source records and who found it. */
export function EvidenceLedger() {
  const { view } = useRun();
  const rowGrid = useRowGrid();
  const cited = view.databases;
  return (
    <LoopSection
      stage="evidence"
      title="Evidence"
      count={view.evidence.length}
      detail={
        cited.length ? (
          <>
            <span className="tabular font-mono text-foreground">
              {cited.length}
            </span>{" "}
            {cited.length === 1 ? "database" : "databases"} cited:{" "}
            {cited.join(", ")}
          </>
        ) : null
      }
    >
      <Plate>
        <div
          className={`${rowGrid} h-7 items-center border-b border-border bg-muted text-2xs font-medium tracking-[0.02em] text-muted-foreground uppercase`}
        >
          <span>ID</span>
          <span>Class</span>
          <span>Statement and source records</span>
        </div>
        {view.evidence.length ? (
          <ul>
            {view.evidence.map((entry) => (
              <EvidenceRow key={entry.event.seq} entry={entry} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="evidence items" />
        )}
        <Subhead
          title="Gaps"
          count={view.gaps.length}
          detail="What the agents looked for and did not find"
          className="border-t border-t-border"
        />
        {view.gaps.length ? (
          <ul>
            {view.gaps.map((entry) => (
              <GapRow key={entry.event.seq} entry={entry} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="gaps" />
        )}
      </Plate>
    </LoopSection>
  );
}
