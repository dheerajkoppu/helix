/**
 * Per-residue colourings a page hands to the viewport. The page computes them from records that
 * carry source IDs; the viewer only paints them. Positions are UniProt canonical.
 */
import {
  ALPHAMISSENSE_CLASSES,
  alphaMissenseColor,
} from "@/lib/science/alphamissense";

import {
  DOMAIN_COLORS,
  NO_VALUE_COLOR,
  hexToColor,
  readViewerPalette,
} from "./palette";

export interface ViewerLegendItem {
  label: string;
  color: number;
  /** letter printed in the swatch so the item reads without colour */
  code?: string;
  /** range or residue span set in monospace after the label */
  detail?: string;
}

export interface ViewerLegendSpec {
  title: string;
  note?: string;
  items: ViewerLegendItem[];
}

export interface ResidueColoring {
  /** UniProt position to 0xRRGGBB */
  colors: ReadonlyMap<number, number>;
  /** colour for residues without a value */
  fallback: number;
  legend: ViewerLegendSpec;
  /** the shared legend component to show on screen instead of the generic one */
  legendKind?: "alphamissense" | "reference-variant";
}

export interface ViewerDomain {
  id: string;
  label: string;
  start: number;
  end: number;
}

/** One colour per annotated region, in the order given. `source` names the annotation's origin. */
export function domainColoring(
  domains: ViewerDomain[],
  source?: string,
): ResidueColoring {
  const colors = new Map<number, number>();
  const items = domains.map((domain, index) => {
    const color = DOMAIN_COLORS[index % DOMAIN_COLORS.length];
    for (let position = domain.start; position <= domain.end; position += 1)
      colors.set(position, color);
    return {
      label: domain.label,
      color,
      detail: `${domain.start}-${domain.end}`,
    };
  });
  return {
    colors,
    fallback: NO_VALUE_COLOR,
    legend: {
      title: "Domain",
      note: source,
      items: [...items, { label: "Not annotated", color: NO_VALUE_COLOR }],
    },
  };
}

/**
 * AlphaMissense pathogenicity per residue (the page decides the aggregate, e.g. the mean over
 * the 19 substitutions). Always labelled as a prediction.
 */
export function variantImpactColoring(
  scores: ReadonlyMap<number, number>,
  source = "AlphaMissense",
): ResidueColoring {
  const colors = new Map<number, number>();
  scores.forEach((score, position) =>
    colors.set(position, hexToColor(alphaMissenseColor(score))),
  );
  return {
    colors,
    fallback: NO_VALUE_COLOR,
    legendKind: "alphamissense",
    legend: {
      title: `${source} (predicted)`,
      items: [
        ...ALPHAMISSENSE_CLASSES.map((entry) => ({
          label: entry.label,
          color: entry.color,
          detail: entry.range,
        })),
        { label: "No score", color: NO_VALUE_COLOR },
      ],
    },
  };
}

/** Reference in grey, variant positions in magenta. Call on the client; the tokens step per theme. */
export function referenceVariantColoring(positions: number[]): ResidueColoring {
  const palette = readViewerPalette();
  return {
    colors: new Map(positions.map((position) => [position, palette.variant])),
    fallback: palette.reference,
    legendKind: "reference-variant",
    legend: {
      title: "Structure",
      items: [
        { label: "Reference", color: palette.reference, code: "R" },
        { label: "Variant", color: palette.variant, code: "V" },
      ],
    },
  };
}
