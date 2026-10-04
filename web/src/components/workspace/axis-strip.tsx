"use client";

import { useMemo, useRef } from "react";

import type { SequenceTrack, SequenceVariant } from "@/components/sequence";
import { CLINICAL_SIGNIFICANCE } from "@/lib/science/clinical-significance";
import type { ResidueRange } from "@/lib/state/selection";

export interface AxisStripProps {
  /** residues in the canonical sequence */
  length: number;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
  selection: ResidueRange[];
  hoverPosition: number | null;
  onSelect: (position: number) => void;
  onHover: (position: number | null) => void;
}

/** Positions carrying at least one variant a clinical database classifies pathogenic or likely pathogenic. */
export function pathogenicPositions(variants: SequenceVariant[]): number[] {
  const positions = new Set<number>();
  for (const variant of variants) {
    if (
      variant.group === "clinical" &&
      variant.significance &&
      CLINICAL_SIGNIFICANCE[variant.significance].group === "pathogenic"
    )
      positions.add(variant.position);
  }
  return [...positions].sort((first, second) => first - second);
}

/**
 * The sequence axis reduced to one row: domains on the baseline, a tick for every position with a
 * pathogenic or likely pathogenic variant, and the selected residue. Click selects a residue.
 */
export function AxisStrip({
  length,
  tracks,
  variants,
  selection,
  hoverPosition,
  onSelect,
  onHover,
}: AxisStripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const domains = useMemo(
    () =>
      tracks.find((track) => track.kind === "domain" && track.features?.length)
        ?.features ?? [],
    [tracks],
  );
  const marks = useMemo(() => pathogenicPositions(variants), [variants]);

  const left = (position: number) => `${((position - 0.5) / length) * 100}%`;
  const positionAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const fraction = (clientX - box.left) / box.width;
    return Math.min(length, Math.max(1, Math.floor(fraction * length) + 1));
  };

  return (
    <div
      ref={strip}
      role="presentation"
      className="relative h-8 min-w-0 flex-1 cursor-crosshair"
      onPointerMove={(event) => onHover(positionAt(event.clientX))}
      onPointerLeave={() => onHover(null)}
      onClick={(event) => {
        const position = positionAt(event.clientX);
        if (position !== null) onSelect(position);
      }}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 hidden h-2.5 sm:block"
      >
        {marks.map((position) => (
          <span
            key={position}
            className="absolute inset-y-0 w-px bg-clin-pathogenic"
            style={{ left: left(position) }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-4">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px bg-border-strong"
        />
        {domains.map((domain) => (
          <span
            key={domain.id}
            title={`${domain.label ?? domain.description ?? "Domain"} ${domain.start}-${domain.end}`}
            className="absolute inset-y-0 overflow-hidden border border-border-strong bg-muted px-1 text-2xs leading-4 whitespace-nowrap text-muted-foreground"
            style={{
              left: `${((domain.start - 1) / length) * 100}%`,
              width: `${((domain.end - domain.start + 1) / length) * 100}%`,
            }}
          >
            {domain.label ?? domain.description}
          </span>
        ))}
      </div>
      {hoverPosition !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-border-strong"
          style={{ left: left(hoverPosition) }}
        />
      ) : null}
      {selection.map((range) => (
        <span
          key={`${range.start}-${range.end}`}
          aria-hidden
          className={
            range.start === range.end
              ? "pointer-events-none absolute inset-y-0 min-w-0.5 bg-foreground"
              : "pointer-events-none absolute inset-y-0 border-x border-foreground bg-foreground/10"
          }
          style={{
            left: `${((range.start - 1) / length) * 100}%`,
            width: `${((range.end - range.start + 1) / length) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
