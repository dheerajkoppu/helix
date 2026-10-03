/**
 * AlphaMissense pathogenicity. A prediction: every use is labelled "AlphaMissense (predicted)"
 * and never shares a visual form with curated clinical assertions.
 */
export type AlphaMissenseClass =
  "likely_benign" | "ambiguous" | "likely_pathogenic";

export interface AlphaMissenseClassMeta {
  id: AlphaMissenseClass;
  label: string;
  /** class label as written in AlphaFold DB files */
  sourceLabel: "LBen" | "Amb" | "LPath";
  range: string;
  hex: string;
  color: number;
  swatchClass: string;
  onFill: "white" | "ink";
}

export const ALPHAMISSENSE_BENIGN_BELOW = 0.34;
export const ALPHAMISSENSE_PATHOGENIC_ABOVE = 0.564;

export const ALPHAMISSENSE_CLASSES: AlphaMissenseClassMeta[] = [
  {
    id: "likely_benign",
    label: "Likely benign",
    sourceLabel: "LBen",
    range: "score < 0.34",
    hex: "#2166AC",
    color: 0x2166ac,
    swatchClass: "bg-am-benign",
    onFill: "white",
  },
  {
    id: "ambiguous",
    label: "Uncertain",
    sourceLabel: "Amb",
    range: "0.34 to 0.564",
    hex: "#A8A9AC",
    color: 0xa8a9ac,
    swatchClass: "bg-am-ambiguous",
    onFill: "ink",
  },
  {
    id: "likely_pathogenic",
    label: "Likely pathogenic",
    sourceLabel: "LPath",
    range: "score > 0.564",
    hex: "#B2182B",
    color: 0xb2182b,
    swatchClass: "bg-am-pathogenic",
    onFill: "white",
  },
];

const CLASS_BY_ID = Object.fromEntries(
  ALPHAMISSENSE_CLASSES.map((entry) => [entry.id, entry]),
) as Record<AlphaMissenseClass, AlphaMissenseClassMeta>;

const CLASS_BY_SOURCE_LABEL: Record<string, AlphaMissenseClass> = {
  LBen: "likely_benign",
  Amb: "ambiguous",
  LPath: "likely_pathogenic",
  likely_benign: "likely_benign",
  ambiguous: "ambiguous",
  likely_pathogenic: "likely_pathogenic",
};

/** Prefer the class shipped in the source file; thresholds are the published ones. */
export function alphaMissenseClass(
  score: number,
  sourceClass?: string | null,
): AlphaMissenseClassMeta {
  const supplied = sourceClass ? CLASS_BY_SOURCE_LABEL[sourceClass] : undefined;
  if (supplied) return CLASS_BY_ID[supplied];
  if (score < ALPHAMISSENSE_BENIGN_BELOW) return CLASS_BY_ID.likely_benign;
  if (score > ALPHAMISSENSE_PATHOGENIC_ABOVE)
    return CLASS_BY_ID.likely_pathogenic;
  return CLASS_BY_ID.ambiguous;
}

/** Continuous heatmap ramp from the AlphaFold DB front-end: score to colour, linear between stops. */
export const ALPHAMISSENSE_RAMP: ReadonlyArray<
  readonly [score: number, hex: string]
> = [
  [0, "#2166ac"],
  [0.1132, "#4290bf"],
  [0.2264, "#8cbcd4"],
  [0.3395, "#c3d6e0"],
  [0.4527, "#e2e2e2"],
  [0.5895, "#edcdba"],
  [0.7264, "#e99e7c"],
  [0.8632, "#d15e4b"],
  [1, "#b2182b"],
];

const channel = (hex: string, offset: number) =>
  parseInt(hex.slice(offset, offset + 2), 16);

/** Returns `#rrggbb` for a score in 0 to 1. */
export function alphaMissenseColor(score: number): string {
  const clamped = Math.min(1, Math.max(0, score));
  for (let index = 1; index < ALPHAMISSENSE_RAMP.length; index += 1) {
    const [upperScore, upperHex] = ALPHAMISSENSE_RAMP[index];
    if (clamped > upperScore) continue;
    const [lowerScore, lowerHex] = ALPHAMISSENSE_RAMP[index - 1];
    const fraction = (clamped - lowerScore) / (upperScore - lowerScore);
    const mixed = [1, 3, 5].map((offset) =>
      Math.round(
        channel(lowerHex, offset) +
          (channel(upperHex, offset) - channel(lowerHex, offset)) * fraction,
      ),
    );
    return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return ALPHAMISSENSE_RAMP[ALPHAMISSENSE_RAMP.length - 1][1];
}

export const ALPHAMISSENSE_RAMP_CSS = `linear-gradient(90deg, ${ALPHAMISSENSE_RAMP.map(
  ([score, hex]) => `${hex} ${(score * 100).toFixed(2)}%`,
).join(", ")})`;
