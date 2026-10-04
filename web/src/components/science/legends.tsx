"use client";

import { cn } from "cn";

import { Swatch } from "@/components/science/swatch";
import {
  CONFIDENCE_LABEL,
  VIEWER_WORDS,
  plainClinicalClass,
  plainColouring,
  plainImpact,
} from "@/lib/plain-language";
import {
  ALPHAMISSENSE_BENIGN_BELOW,
  ALPHAMISSENSE_CLASSES,
  ALPHAMISSENSE_PATHOGENIC_ABOVE,
  ALPHAMISSENSE_RAMP_CSS,
} from "@/lib/science/alphamissense";
import {
  CLINICAL_SIGNIFICANCE,
  CLINICAL_SIGNIFICANCE_ORDER,
  type ClinicalSignificance,
} from "@/lib/science/clinical-significance";
import { PLDDT_BANDS } from "@/lib/science/plddt";
import { useAdvancedMode } from "@/lib/state/preferences";

interface LegendProps {
  /** horizontal for toolbars and plot footers, vertical for inspectors */
  orientation?: "horizontal" | "vertical";
  /** print the numeric range beside each label */
  showRanges?: boolean;
  /** false keeps a horizontal legend on one line, for zone footers and toolbars */
  wrap?: boolean;
  className?: string;
}

const NOWRAP = "flex-nowrap whitespace-nowrap [&_ul]:flex-nowrap";

function LegendFrame({
  title,
  note,
  orientation,
  className,
  children,
}: {
  title: string;
  note?: string;
  orientation: "horizontal" | "vertical";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <figure
      className={cn(
        "flex text-2xs text-muted-foreground",
        orientation === "horizontal"
          ? "flex-wrap items-center gap-x-3 gap-y-1"
          : "flex-col gap-1.5",
        className,
      )}
    >
      <figcaption className="font-medium text-foreground">
        {title}
        {note ? (
          <span className="ml-1 font-normal text-subtle-foreground">
            {note}
          </span>
        ) : null}
      </figcaption>
      {children}
    </figure>
  );
}

/** The four AlphaFold DB confidence bands with their letter codes. Required wherever pLDDT colours appear. */
export function PlddtLegend({
  orientation = "horizontal",
  showRanges = true,
  wrap = true,
  className,
}: LegendProps) {
  const advanced = useAdvancedMode();
  return (
    <LegendFrame
      title={advanced ? "Model confidence" : CONFIDENCE_LABEL}
      note={advanced ? "pLDDT" : undefined}
      orientation={orientation}
      className={cn(!wrap && NOWRAP, className)}
    >
      <ul
        className={cn(
          "flex",
          orientation === "horizontal"
            ? "flex-wrap items-center gap-x-3 gap-y-1"
            : "flex-col gap-1",
        )}
      >
        {PLDDT_BANDS.map((band) => (
          <li key={band.id} className="flex items-center gap-1.5">
            <Swatch
              swatchClass={band.swatchClass}
              code={advanced ? band.code : undefined}
              onFill={band.onFill}
            />
            <span className="text-foreground">{band.label}</span>
            {showRanges && advanced ? (
              <span className="tabular font-mono text-subtle-foreground">
                {band.range}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </LegendFrame>
  );
}

/** AlphaMissense classes plus the continuous ramp. Always labelled as predicted. */
export function AlphaMissenseLegend({
  orientation = "horizontal",
  showRanges = true,
  wrap = true,
  className,
}: LegendProps) {
  const advanced = useAdvancedMode();
  return (
    <LegendFrame
      title={advanced ? "AlphaMissense" : plainColouring("alphamissense")}
      note="(predicted)"
      orientation={orientation}
      className={cn(!wrap && NOWRAP, className)}
    >
      <ul
        className={cn(
          "flex",
          orientation === "horizontal"
            ? "flex-wrap items-center gap-x-3 gap-y-1"
            : "flex-col gap-1",
        )}
      >
        {ALPHAMISSENSE_CLASSES.map((entry) => (
          <li key={entry.id} className="flex items-center gap-1.5">
            <Swatch swatchClass={entry.swatchClass} />
            <span className="text-foreground">
              {advanced ? entry.label : plainImpact(entry.label)}
            </span>
            {showRanges && advanced ? (
              <span className="tabular font-mono text-subtle-foreground">
                {entry.range}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div
        className={cn(
          advanced ? "flex flex-col gap-0.5" : "hidden",
          orientation === "horizontal" ? "w-40" : "w-full max-w-56",
        )}
      >
        <div
          className="relative h-2 rounded-[1px] ring-1 ring-border-strong/60 ring-inset"
          style={{ backgroundImage: ALPHAMISSENSE_RAMP_CSS }}
        >
          {[ALPHAMISSENSE_BENIGN_BELOW, ALPHAMISSENSE_PATHOGENIC_ABOVE].map(
            (threshold) => (
              <span
                key={threshold}
                aria-hidden
                className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground"
                style={{ left: `${threshold * 100}%` }}
              />
            ),
          )}
        </div>
        <div className="tabular relative h-4 font-mono text-2xs text-subtle-foreground">
          <span className="absolute left-0">0</span>
          <span
            className="absolute -translate-x-1/2"
            style={{ left: `${ALPHAMISSENSE_BENIGN_BELOW * 100}%` }}
          >
            0.34
          </span>
          <span
            className="absolute -translate-x-1/2"
            style={{ left: `${ALPHAMISSENSE_PATHOGENIC_ABOVE * 100}%` }}
          >
            0.564
          </span>
          <span className="absolute right-0">1</span>
        </div>
      </div>
    </LegendFrame>
  );
}

export interface ClinicalSignificanceChipProps {
  significance: ClinicalSignificance;
  /** ClinVar gold stars 0 to 4, printed as n/4 */
  reviewStars?: number | null;
  /** print the full label instead of the abbreviation */
  long?: boolean;
  className?: string;
}

/**
 * A database's clinical classification: filled swatch plus printed abbreviation.
 * Only for curated assertions. A prediction never takes this form.
 */
export function ClinicalSignificanceChip({
  significance,
  reviewStars,
  long = false,
  className,
}: ClinicalSignificanceChipProps) {
  const advanced = useAdvancedMode();
  const meta = CLINICAL_SIGNIFICANCE[significance];
  if (!advanced) {
    return (
      <span
        data-slot="clinical-significance"
        title={
          reviewStars !== null && reviewStars !== undefined
            ? `${meta.label} · ClinVar review ${reviewStars} of 4 stars`
            : meta.label
        }
        className={cn(
          "inline-flex items-center gap-1.5 align-middle text-2xs whitespace-nowrap",
          className,
        )}
      >
        <Swatch swatchClass={meta.swatchClass} hatched={!meta.certain} />
        <span className="text-foreground">
          {plainClinicalClass(meta.label)}
        </span>
      </span>
    );
  }
  return (
    <span
      data-slot="clinical-significance"
      title={meta.label}
      className={cn(
        "inline-flex items-center gap-1.5 align-middle text-2xs whitespace-nowrap",
        className,
      )}
    >
      <Swatch swatchClass={meta.swatchClass} hatched={!meta.certain} />
      <span
        className={cn(
          "text-foreground",
          !long && "font-mono font-medium tracking-[0.04em]",
        )}
      >
        {long ? meta.label : meta.code}
      </span>
      {!long ? <span className="sr-only">{meta.label}</span> : null}
      {reviewStars !== null && reviewStars !== undefined ? (
        <span
          className="tabular font-mono text-subtle-foreground"
          title="ClinVar review status, gold stars out of 4"
        >
          {reviewStars}/4
        </span>
      ) : null}
    </span>
  );
}

export function ClinicalSignificanceLegend({
  orientation = "horizontal",
  wrap = true,
  className,
}: LegendProps) {
  const advanced = useAdvancedMode();
  return (
    <LegendFrame
      title={advanced ? "Clinical significance" : "Medical database class"}
      note={advanced ? "database classification" : undefined}
      orientation={orientation}
      className={cn(!wrap && NOWRAP, className)}
    >
      <ul
        className={cn(
          "flex",
          orientation === "horizontal"
            ? "flex-wrap items-center gap-x-3 gap-y-1"
            : "flex-col gap-1",
        )}
      >
        {CLINICAL_SIGNIFICANCE_ORDER.map((id) => (
          <li key={id} className="flex items-center gap-1.5">
            <ClinicalSignificanceChip significance={id} />
            {advanced ? <span>{CLINICAL_SIGNIFICANCE[id].label}</span> : null}
          </li>
        ))}
      </ul>
    </LegendFrame>
  );
}

/** Reference in neutral grey, variant in magenta with a second, non-colour channel in every view. */
export function ReferenceVariantLegend({
  orientation = "horizontal",
  wrap = true,
  className,
}: LegendProps) {
  const advanced = useAdvancedMode();
  return (
    <LegendFrame
      title="Structure"
      orientation={orientation}
      className={cn(!wrap && NOWRAP, className)}
    >
      <ul
        className={cn(
          "flex",
          orientation === "horizontal"
            ? "items-center gap-3"
            : "flex-col gap-1",
        )}
      >
        <li className="flex items-center gap-1.5">
          <Swatch swatchClass="bg-reference" code={advanced ? "R" : undefined} />
          <span className="text-foreground">
            {advanced ? "Reference" : VIEWER_WORDS.normal}
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch
            swatchClass="bg-variant"
            code={advanced ? "V" : undefined}
            onFill="white"
          />
          <span className="text-foreground">
            {advanced ? "Variant" : VIEWER_WORDS.mutationSite}
          </span>
        </li>
      </ul>
    </LegendFrame>
  );
}
