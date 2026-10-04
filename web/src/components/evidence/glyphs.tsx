import { cn } from "cn";

import type { EvidenceClass } from "@/lib/evidence";
import type { StructureOrigin } from "@/lib/structure-origin";

interface GlyphProps {
  className?: string;
}

const frame = {
  viewBox: "0 0 12 12",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.1,
  "aria-hidden": true,
} as const;

/** Diagonal hatch for a 12px square or diamond; marks anything computed. */
const HATCH = "M2.9 7.6 7.6 2.9M3.9 8.9 8.9 3.9M4.4 9.1l4.7-4.7";

/**
 * One shape per evidence class so a badge survives greyscale and 12px rendering:
 * filled square, shield, page, circle, hatched diamond, dotted hexagon.
 */
export function EvidenceGlyph({
  evidenceClass,
  className,
}: GlyphProps & { evidenceClass: EvidenceClass }) {
  const classes = cn("size-3 shrink-0", className);
  switch (evidenceClass) {
    case "experimental":
      return (
        <svg {...frame} className={classes}>
          <rect x="2" y="2" width="8" height="8" fill="currentColor" />
        </svg>
      );
    case "clinical_database":
      return (
        <svg {...frame} className={classes}>
          <path
            d="M2.25 1.75h7.5v4.6L6 10.4 2.25 6.35z"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "literature":
      return (
        <svg {...frame} className={classes}>
          <path d="M2.75 1.5h4.4l2.1 2.1v6.9h-6.5z" strokeLinejoin="round" />
          <path d="M7.15 1.5v2.1h2.1" strokeLinejoin="round" />
        </svg>
      );
    case "curated_database":
      return (
        <svg {...frame} className={classes}>
          <circle cx="6" cy="6" r="3.9" />
        </svg>
      );
    case "computational_prediction":
      return (
        <svg {...frame} className={classes}>
          <path
            d="M6 1.2 10.8 6 6 10.8 1.2 6z"
            strokeDasharray="1.7 1.1"
            strokeLinejoin="round"
          />
          <path d="M4.3 6.9 6.9 4.3M5.3 7.9l2.6-2.6" strokeWidth="0.8" />
        </svg>
      );
    case "helix_hypothesis":
      return (
        <svg {...frame} className={classes}>
          <path
            d="M6 1.3 10.1 3.65v4.7L6 10.7 1.9 8.35v-4.7z"
            strokeDasharray="0.1 1.75"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
        </svg>
      );
  }
}

/** Structure origin: filled square (measured), hatched dashed square (predicted), dotted frame with the mark (made here). */
export function StructureOriginGlyph({
  origin,
  className,
}: GlyphProps & { origin: StructureOrigin }) {
  const classes = cn("size-3 shrink-0", className);
  switch (origin) {
    case "experimental":
      return (
        <svg {...frame} className={classes}>
          <rect x="2" y="2" width="8" height="8" fill="currentColor" />
        </svg>
      );
    case "predicted_external":
      return (
        <svg {...frame} className={classes}>
          <rect
            x="1.8"
            y="1.8"
            width="8.4"
            height="8.4"
            strokeDasharray="1.9 1.1"
          />
          <path d={HATCH} strokeWidth="0.8" />
        </svg>
      );
    case "predicted_internal":
      return (
        <svg {...frame} className={classes}>
          <rect
            x="1.6"
            y="1.6"
            width="8.8"
            height="8.8"
            strokeDasharray="0.1 1.75"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
          <path d="M3.6 8.2h4.8M6.6 8.2V5.6" strokeWidth="0.9" />
          <circle cx="6.6" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/** The Helix mark: two variant lollipops on a residue axis. */
export function HelixMark({ className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
    >
      {/* A sequence of residues with one standing out: the mutation the product is about. */}
      <path
        d="M1.7 6.8v2.4M4.5 6v4M8 2.6v10.8M11.5 5.6v4.8M14.3 7v2"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
