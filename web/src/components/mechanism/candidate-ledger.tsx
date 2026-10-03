"use client";

import { cn } from "cn";

import { SectionHeader } from "@/components/data/section-header";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { Fold } from "@/components/intervention/fold";
import { useAdvancedMode } from "@/lib/state/preferences";

import {
  SUPPORT_CLASS,
  plural,
  raises,
  type MechanismCandidate,
  type MechanismsResponse,
  type UnsupportedCategory,
} from "./data";

function Row({
  selected,
  onSelect,
  lead,
  title,
  trailing,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  lead: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
  /** second line, Advanced only */
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "relative grid w-full cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1 border-b border-border-subtle px-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        children ? "py-2 text-xs" : "min-h-10 items-center py-1.5 text-sm",
        selected && "bg-active",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
        />
      ) : null}
      <span
        className={cn(
          "tabular font-mono text-subtle-foreground",
          children ? "pt-px text-2xs" : "text-xs",
        )}
      >
        {lead}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{title}</span>
          {trailing ? (
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {trailing}
            </span>
          ) : null}
        </span>
        {children ? (
          <span className="text-muted-foreground">{children}</span>
        ) : null}
      </span>
    </button>
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
  advanced,
}: {
  candidate: MechanismCandidate;
  selected: boolean;
  onSelect: () => void;
  advanced: boolean;
}) {
  const first = candidate.observations.find(raises);
  if (!advanced)
    return (
      <Row
        selected={selected}
        onSelect={onSelect}
        lead={candidate.rank}
        title={candidate.label}
        trailing={
          <>
            <EvidenceBadge
              evidenceClass={SUPPORT_CLASS[candidate.support]}
              title={candidate.support_label}
            />
            <span
              className="tabular w-5 text-right font-mono text-xs text-muted-foreground"
              title={plural(candidate.supporting_count, "supporting record")}
            >
              {candidate.supporting_count}
            </span>
          </>
        }
      />
    );
  return (
    <Row
      selected={selected}
      onSelect={onSelect}
      lead={candidate.rank}
      title={candidate.label}
      trailing={
        <span className="tabular font-mono text-2xs text-subtle-foreground">
          {plural(candidate.supporting_count, "record")}
          {candidate.disputing_count
            ? `, ${candidate.disputing_count} disputing`
            : ""}
        </span>
      }
    >
      <span className="line-clamp-2">{first?.summary}</span>
    </Row>
  );
}

function UnsupportedRow({
  entry,
  selected,
  onSelect,
  advanced,
}: {
  entry: UnsupportedCategory;
  selected: boolean;
  onSelect: () => void;
  advanced: boolean;
}) {
  const read = entry.observations.length;
  return (
    <Row selected={selected} onSelect={onSelect} lead="–" title={entry.label}>
      {advanced
        ? entry.not_checked.length
          ? `Not checked: ${entry.not_checked.join(", ")}`
          : read
            ? `${plural(read, "record")} read; ${read === 1 ? "it does" : "they do"} not raise this candidate`
            : `${plural(entry.checked.length, "record type")} checked, none at this residue`
        : null}
    </Row>
  );
}

export interface CandidateLedgerProps {
  data: MechanismsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Candidates in rank order, one line each with the class of their strongest record. Advanced groups
 * them under that class and prints the first record; the empty categories follow.
 */
export function CandidateLedger({
  data,
  selectedId,
  onSelect,
}: CandidateLedgerProps) {
  const advanced = useAdvancedMode();
  const unsupported = data.unsupported.map((entry) => (
    <UnsupportedRow
      key={entry.category}
      entry={entry}
      advanced={advanced}
      selected={selectedId === entry.category}
      onSelect={() => onSelect(entry.category)}
    />
  ));

  if (!advanced)
    return (
      <div>
        <div role="listbox" aria-label="Candidate mechanisms">
          {data.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              advanced={false}
              selected={selectedId === candidate.id}
              onSelect={() => onSelect(candidate.id)}
            />
          ))}
        </div>
        {data.unsupported.length ? (
          <Fold
            title="No data found"
            count={data.unsupported.length}
            defaultOpen={data.unsupported.some(
              (entry) => entry.category === selectedId,
            )}
          >
            <div role="listbox" aria-label="Categories with no supporting data">
              {unsupported}
            </div>
          </Fold>
        ) : null}
      </div>
    );

  const groups = data.support_order
    .map((kind) => ({
      kind,
      candidates: data.candidates.filter(
        (candidate) => candidate.support === kind.key,
      ),
    }))
    .filter((group) => group.candidates.length > 0);

  return (
    <div role="listbox" aria-label="Candidate mechanisms">
      {groups.map(({ kind, candidates }) => (
        <div key={kind.key} role="group" aria-label={kind.label}>
          <SectionHeader
            title={kind.label}
            count={candidates.length}
            actions={
              <EvidenceBadge
                evidenceClass={SUPPORT_CLASS[kind.key]}
                size="compact"
              />
            }
          />
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              advanced
              selected={selectedId === candidate.id}
              onSelect={() => onSelect(candidate.id)}
            />
          ))}
        </div>
      ))}
      {data.unsupported.length ? (
        <div role="group" aria-label="No supporting data found">
          <SectionHeader
            title="No supporting data found"
            count={data.unsupported.length}
          />
          {unsupported}
        </div>
      ) : null}
    </div>
  );
}
