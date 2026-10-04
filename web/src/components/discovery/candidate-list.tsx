"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DISCOVERY_WORDS,
  plainBridgeMeaning,
  plainPhase,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

import type { CandidateRow } from "./model";

/** How a candidate was found, as a quiet tag with the explanation on hover. */
export function BridgeTag({ row }: { row: CandidateRow }) {
  const meaning = plainBridgeMeaning(row.bridgeKind);
  const tag = (
    <span className="shrink-0 border-l border-border-strong pl-2 text-2xs whitespace-nowrap text-muted-foreground">
      {row.bridgeTag}
    </span>
  );
  if (!meaning) return tag;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="shrink-0" />}>
        {tag}
      </TooltipTrigger>
      <TooltipContent side="left">{meaning}</TooltipContent>
    </Tooltip>
  );
}

function Row({
  row,
  selected,
  onSelect,
  advanced,
}: {
  row: CandidateRow;
  selected: boolean;
  onSelect: () => void;
  advanced: boolean;
}) {
  const phase = plainPhase(row.candidate.molecule?.max_phase ?? null);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "relative grid w-full cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border-subtle px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset sm:px-6",
        selected && "bg-active",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
        />
      ) : null}
      <span className="tabular pt-0.5 font-mono text-xs text-subtle-foreground">
        {row.rank}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "text-sm font-medium",
              row.hasMolecule ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {row.title}
          </span>
          <span className="text-xs text-muted-foreground">
            {DISCOVERY_WORDS.aimsAt.toLowerCase()} {row.target}
          </span>
          {phase ? (
            <span className="text-2xs text-subtle-foreground">{phase}</span>
          ) : null}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">
          {row.summary}
        </span>
        {row.unknownDirection ? (
          <span className="text-2xs text-warning">
            {DISCOVERY_WORDS.unknownDirection}
          </span>
        ) : null}
        <span className="text-2xs text-muted-foreground sm:hidden">
          {row.bridgeTag}
        </span>
        {advanced && row.candidate.molecule?.chembl_id ? (
          <span className="font-mono text-2xs text-subtle-foreground">
            {row.candidate.molecule.chembl_id}
            {row.candidate.target?.accession
              ? ` → ${row.candidate.target.accession}`
              : ""}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-1 pt-0.5">
        <span className="hidden sm:flex">
          <BridgeTag row={row} />
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-subtle-foreground"
        />
      </span>
    </button>
  );
}

export interface CandidateListProps {
  rows: CandidateRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The simple view keeps the list short; the rest are one click away. */
const SHORT_LIST = 8;

/** The candidates in rank order. One row per candidate, one sentence for how it was found. */
export function CandidateList({
  rows,
  selectedId,
  onSelect,
}: CandidateListProps) {
  const advanced = useAdvancedMode();
  const [showAll, setShowAll] = useState(false);
  const capped = !advanced && !showAll && rows.length > SHORT_LIST;
  const shown = capped ? rows.slice(0, SHORT_LIST) : rows;
  return (
    <div>
      <div role="listbox" aria-label={DISCOVERY_WORDS.list}>
        {shown.map((row) => (
          <Row
            key={row.id}
            row={row}
            advanced={advanced}
            selected={selectedId === row.id}
            onSelect={() => onSelect(row.id)}
          />
        ))}
      </div>
      {!advanced && rows.length > SHORT_LIST ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex h-9 w-full cursor-pointer items-center gap-2 border-b border-border-subtle px-4 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent sm:px-6"
        >
          {capped
            ? `${DISCOVERY_WORDS.showAll} (${rows.length})`
            : DISCOVERY_WORDS.showFewer}
        </button>
      ) : null}
    </div>
  );
}
