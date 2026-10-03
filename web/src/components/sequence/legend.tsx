import { cn } from "cn";

import { AlphaMissenseLegend, PlddtLegend } from "@/components/science/legends";
import { Swatch } from "@/components/science/swatch";
import {
  SEQUENCE_WORDS,
  plainClassGroup,
  plainMutationKind,
} from "@/lib/plain-language";
import {
  CLINICAL_SIGNIFICANCE,
  type ClinicalSignificanceGroup,
} from "@/lib/science/clinical-significance";

import { SIGNIFICANCE_GROUPS } from "./draw";
import type { VariantConsequence } from "./types";

export const CONSEQUENCES: VariantConsequence[] = [
  "loss_of_function",
  "missense",
  "inframe",
  "splice",
  "synonymous",
  "other",
];

export const CONSEQUENCE_LABEL: Record<VariantConsequence, string> = {
  loss_of_function: "Loss of function",
  missense: "Missense",
  inframe: "In-frame indel",
  splice: "Splice region",
  synonymous: "Synonymous",
  other: "Other",
};

export const GROUP_SHORT: Record<
  ClinicalSignificanceGroup,
  { code: string; label: string; swatchClass: string }
> = {
  pathogenic: {
    code: "P / LP",
    label: "Pathogenic, likely pathogenic",
    swatchClass: CLINICAL_SIGNIFICANCE.pathogenic.swatchClass,
  },
  uncertain: {
    code: "VUS / CONF",
    label: "Uncertain, conflicting",
    swatchClass: CLINICAL_SIGNIFICANCE.uncertain.swatchClass,
  },
  benign: {
    code: "B / LB",
    label: "Benign, likely benign",
    swatchClass: CLINICAL_SIGNIFICANCE.benign.swatchClass,
  },
  other: {
    code: "OTHER",
    label: "Other or not classified",
    swatchClass: CLINICAL_SIGNIFICANCE.other.swatchClass,
  },
};

/** The lollipop head for a consequence class, in ink. */
export function ConsequenceGlyph({
  consequence,
  className,
}: {
  consequence: VariantConsequence;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn("size-2.5 shrink-0 text-foreground", className)}
    >
      {consequence === "loss_of_function" ? (
        <path d="M2 2 8 8M8 2 2 8" stroke="currentColor" strokeWidth="2" />
      ) : consequence === "missense" || consequence === "inframe" ? (
        <path d="M5 1.2 9.2 8.8H.8z" fill="currentColor" />
      ) : consequence === "splice" ? (
        <path d="M5 .6 9.4 5 5 9.4.6 5z" fill="currentColor" />
      ) : (
        <circle cx="5" cy="5" r="3.6" fill="currentColor" />
      )}
    </svg>
  );
}

const SHAPE_ENTRIES: Array<{
  consequences: VariantConsequence[];
  label: string;
}> = [
  { consequences: ["loss_of_function"], label: "loss of function" },
  { consequences: ["missense", "inframe"], label: "missense, in-frame" },
  { consequences: ["splice"], label: "splice" },
  { consequences: ["synonymous", "other"], label: "synonymous, other" },
];

const ENTRY =
  "inline-flex h-5 cursor-pointer items-center gap-1 rounded-xs px-1 text-foreground hover:bg-accent aria-[pressed=false]:text-subtle-foreground aria-[pressed=false]:line-through";
const TITLE = "font-medium text-foreground";
const RULE = "h-3 w-px shrink-0 bg-border";

export interface AxisLegendProps {
  hasClinical: boolean;
  hasPopulation: boolean;
  /** variants are drawn as stacked bins at this zoom */
  binned: boolean;
  trackKinds: Set<string>;
  groups: Set<ClinicalSignificanceGroup>;
  consequences: Set<VariantConsequence>;
  onToggleGroup: (group: ClinicalSignificanceGroup, isolate: boolean) => void;
  onToggleConsequences: (
    consequences: VariantConsequence[],
    isolate: boolean,
  ) => void;
  /** simple mode: shapes and colours in everyday words, nothing else */
  plain?: boolean;
}

/** One scrolling line of legends for the rows on screen. Every colour and shape has its text beside it. */
export function AxisLegend({
  hasClinical,
  hasPopulation,
  binned,
  trackKinds,
  groups,
  consequences,
  onToggleGroup,
  onToggleConsequences,
  plain = false,
}: AxisLegendProps) {
  if (plain) {
    return (
      <div
        data-slot="axis-legend"
        className="scroll-thin flex h-6 shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden border-t border-border bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground"
      >
        {hasClinical ? (
          <>
            <span className="flex items-center gap-1">
              <span className={TITLE}>{SEQUENCE_WORDS.colour}</span>
              {SIGNIFICANCE_GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={groups.has(group)}
                  onClick={(event) => onToggleGroup(group, event.shiftKey)}
                  className={ENTRY}
                >
                  <Swatch swatchClass={GROUP_SHORT[group].swatchClass} />
                  {plainClassGroup(group)}
                </button>
              ))}
              <span className="flex items-center gap-1 px-1">
                <Swatch swatchClass="bg-clin-other" hatched />
                {SEQUENCE_WORDS.striped}
              </span>
            </span>
            <span className={RULE} />
          </>
        ) : null}
        {hasClinical || hasPopulation ? (
          <span className="flex items-center gap-1">
            <span className={TITLE}>{SEQUENCE_WORDS.shape}</span>
            {SHAPE_ENTRIES.map((entry) => (
              <button
                key={entry.label}
                type="button"
                aria-pressed={entry.consequences.some((consequence) =>
                  consequences.has(consequence),
                )}
                onClick={(event) =>
                  onToggleConsequences(entry.consequences, event.shiftKey)
                }
                className={ENTRY}
              >
                <ConsequenceGlyph consequence={entry.consequences[0]} />
                {plainMutationKind(entry.consequences[0])}
              </button>
            ))}
          </span>
        ) : null}
        {trackKinds.has("confidence") ? (
          <>
            <span className={RULE} />
            <PlddtLegend wrap={false} showRanges={false} className="shrink-0" />
          </>
        ) : null}
        {trackKinds.has("pathogenicity") ? (
          <>
            <span className={RULE} />
            <AlphaMissenseLegend
              wrap={false}
              showRanges={false}
              className="shrink-0 pr-3"
            />
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div
      data-slot="axis-legend"
      className="scroll-thin flex h-6 shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden border-t border-border bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground"
    >
      {hasClinical || hasPopulation ? (
        <>
          <span className="flex items-center gap-1">
            <span className={TITLE}>Head</span>
            {SHAPE_ENTRIES.map((entry) => (
              <button
                key={entry.label}
                type="button"
                aria-pressed={entry.consequences.some((consequence) =>
                  consequences.has(consequence),
                )}
                title="Click to filter, Shift+click to show only this"
                onClick={(event) =>
                  onToggleConsequences(entry.consequences, event.shiftKey)
                }
                className={ENTRY}
              >
                <ConsequenceGlyph consequence={entry.consequences[0]} />
                {entry.label}
              </button>
            ))}
          </span>
          <span className={RULE} />
        </>
      ) : null}
      {hasClinical ? (
        <>
          <span className="flex items-center gap-1">
            <span className={TITLE}>Fill</span>
            {SIGNIFICANCE_GROUPS.map((group) => (
              <button
                key={group}
                type="button"
                aria-pressed={groups.has(group)}
                title={`${GROUP_SHORT[group].label}. Click to filter, Shift+click to show only this`}
                onClick={(event) => onToggleGroup(group, event.shiftKey)}
                className={ENTRY}
              >
                <Swatch swatchClass={GROUP_SHORT[group].swatchClass} />
                <span className="font-mono">{GROUP_SHORT[group].code}</span>
              </button>
            ))}
            <span className="flex items-center gap-1 px-1">
              <Swatch swatchClass="bg-clin-other" hatched />
              slash: likely or conflicting
            </span>
            <span className="flex items-center gap-1 px-1">
              <Swatch swatchClass="bg-background" />
              hollow: no classification
            </span>
          </span>
          <span className={RULE} />
          <span>
            <span className={TITLE}>Stem</span>{" "}
            {binned
              ? "bins stack P/LP, VUS/CONF, B/LB, other upward from the axis; height is the count"
              : "height is ClinVar review stars 0 to 4; dashed: no review status; number: variants at one position"}
          </span>
          <span className={RULE} />
        </>
      ) : null}
      {hasPopulation ? (
        <>
          <span>
            <span className={TITLE}>Population</span>{" "}
            {binned
              ? "bar depth is the count per bin"
              : "depth is log10 allele frequency, 1e-6 to 1e-1; dashed: no frequency reported"}
          </span>
          <span className={RULE} />
        </>
      ) : null}
      {trackKinds.has("coverage") ? (
        <>
          <span className="flex items-center gap-2">
            <span className={TITLE}>Coverage</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 bg-foreground/80" aria-hidden />
              <span className="font-mono">EXP</span> experimental, solid
            </span>
            <span className="flex items-center gap-1">
              <span
                className="hatch h-2 w-4 border border-muted-foreground text-muted-foreground"
                aria-hidden
              />
              <span className="font-mono">PRD</span> predicted, hatched
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-4 border border-dotted border-foreground"
                aria-hidden
              />
              <span className="font-mono">OF</span> Helix-generated, dotted
            </span>
          </span>
          <span className={RULE} />
        </>
      ) : null}
      {trackKinds.has("secondary_structure") ? (
        <>
          <span className="flex items-center gap-2">
            <span className={TITLE}>Secondary structure</span>
            <span className="flex items-center gap-1">
              <span
                className="h-2.5 w-4 rounded-[3px] bg-muted-foreground"
                aria-hidden
              />
              helix, block
            </span>
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 10" className="h-2.5 w-4" aria-hidden>
                <path
                  d="M0 2.5h10V0l6 5-6 5V7.5H0z"
                  className="fill-foreground"
                />
              </svg>
              strand, arrow
            </span>
            <span className="flex items-center gap-1">
              <span className="h-px w-4 bg-border-strong" aria-hidden />
              turn, line
            </span>
          </span>
          <span className={RULE} />
        </>
      ) : null}
      {trackKinds.has("confidence") ? (
        <>
          <PlddtLegend wrap={false} showRanges={false} className="shrink-0" />
          <span className={RULE} />
        </>
      ) : null}
      {trackKinds.has("pathogenicity") ? (
        <>
          <AlphaMissenseLegend
            wrap={false}
            showRanges={false}
            className="shrink-0"
          />
          <span className={RULE} />
        </>
      ) : null}
      {trackKinds.has("conservation") ? (
        <span>
          <span className={TITLE}>Conservation</span> bar height, 0 to 1
        </span>
      ) : null}
      <span className="pr-3">
        <span className={TITLE}>Outline</span> solid: from a database; dashed:
        computed prediction
      </span>
    </div>
  );
}
