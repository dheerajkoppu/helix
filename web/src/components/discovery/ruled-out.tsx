"use client";

import { useState } from "react";

import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { Detail, Fold } from "@/components/intervention/fold";
import { DISCOVERY_WORDS } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { toDiscoveryEvidence } from "@/lib/workspace-data";

import { badgeEvidence, type RuledOutDisplay } from "./model";

/** The simple view lists the first few; the rest are one click away. */
const SHORT_LIST = 8;

/**
 * Molecules the direction filter rejected: what each would have done, and why that is wrong here.
 * Closed by default with the count in its header. This list is the evidence the filter works, so it
 * stays legible: one plain sentence per row, full width, every row citing its own records, with the
 * engine's own longer reason a click away.
 */
export function RuledOutSection({ rows }: { rows: RuledOutDisplay[] }) {
  const advanced = useAdvancedMode();
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const capped = !advanced && !showAll && rows.length > SHORT_LIST;
  const shown = capped ? rows.slice(0, SHORT_LIST) : rows;

  return (
    <Fold
      title={
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-medium text-foreground">
            {DISCOVERY_WORDS.ruledOut}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {DISCOVERY_WORDS.ruledOutLine}
          </span>
        </span>
      }
      count={rows.length}
    >
      <ul className="flex flex-col">
        {shown.map((row) => (
          <li
            key={row.key}
            className="flex flex-col gap-1 border-t border-border-subtle px-4 py-3 sm:px-6"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-foreground">
                {row.molecule}
              </span>
              <span className="text-xs text-muted-foreground">
                {DISCOVERY_WORDS.aimsAt.toLowerCase()} {row.target}
              </span>
            </div>
            <p className="max-w-[46rem] text-xs leading-snug text-foreground">
              {row.reason}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {badgeEvidence(row.row.evidence, advanced).map((item, index) => (
                <EvidencePopover
                  key={`${row.key}-evidence-${index}`}
                  evidence={toDiscoveryEvidence(item)}
                  size="compact"
                />
              ))}
              {advanced && row.row.reason_code ? (
                <span className="font-mono text-2xs text-subtle-foreground">
                  {row.row.reason_code}
                </span>
              ) : null}
            </div>
            {row.detail ? (
              <Detail advanced={advanced} title={DISCOVERY_WORDS.whyWrong}>
                <p className="max-w-[46rem] py-1 text-xs leading-snug text-muted-foreground">
                  {row.detail}
                </p>
              </Detail>
            ) : null}
          </li>
        ))}
      </ul>
      {!advanced && rows.length > SHORT_LIST ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex h-9 w-full cursor-pointer items-center border-t border-border-subtle px-4 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent sm:px-6"
        >
          {capped
            ? `${DISCOVERY_WORDS.showAllRuledOut} (${rows.length})`
            : DISCOVERY_WORDS.showFewer}
        </button>
      ) : null}
    </Fold>
  );
}
