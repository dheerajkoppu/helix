/**
 * Clinical significance as classified by a clinical database (ClinVar). Colours follow the gnomAD
 * browser constants. Reserved for database classifications, never for Helix predictions.
 * The abbreviation is always printed: colour alone never carries the class.
 */
export type ClinicalSignificance =
  | "pathogenic"
  | "likely_pathogenic"
  | "uncertain"
  | "conflicting"
  | "likely_benign"
  | "benign"
  | "other";

export type ClinicalSignificanceGroup =
  "pathogenic" | "uncertain" | "benign" | "other";

export interface ClinicalSignificanceMeta {
  id: ClinicalSignificance;
  code: "P" | "LP" | "VUS" | "CONF" | "LB" | "B" | "OTHER";
  label: string;
  group: ClinicalSignificanceGroup;
  /** "likely" classes draw a hatched swatch so P and LP differ without relying on hue */
  certain: boolean;
  hex: string;
  swatchClass: string;
  textOnSwatch: "white" | "ink";
}

const GROUP_STYLE: Record<
  ClinicalSignificanceGroup,
  Pick<ClinicalSignificanceMeta, "hex" | "swatchClass">
> = {
  pathogenic: { hex: "#E6573D", swatchClass: "bg-clin-pathogenic" },
  uncertain: { hex: "#FAB470", swatchClass: "bg-clin-uncertain" },
  benign: { hex: "#5E6F9E", swatchClass: "bg-clin-benign" },
  other: { hex: "#BABABA", swatchClass: "bg-clin-other" },
};

function entry(
  id: ClinicalSignificance,
  code: ClinicalSignificanceMeta["code"],
  label: string,
  group: ClinicalSignificanceGroup,
  certain: boolean,
): ClinicalSignificanceMeta {
  return {
    id,
    code,
    label,
    group,
    certain,
    textOnSwatch: group === "benign" ? "white" : "ink",
    ...GROUP_STYLE[group],
  };
}

export const CLINICAL_SIGNIFICANCE: Record<
  ClinicalSignificance,
  ClinicalSignificanceMeta
> = {
  pathogenic: entry("pathogenic", "P", "Pathogenic", "pathogenic", true),
  likely_pathogenic: entry(
    "likely_pathogenic",
    "LP",
    "Likely pathogenic",
    "pathogenic",
    false,
  ),
  uncertain: entry(
    "uncertain",
    "VUS",
    "Uncertain significance",
    "uncertain",
    true,
  ),
  conflicting: entry(
    "conflicting",
    "CONF",
    "Conflicting classifications",
    "uncertain",
    false,
  ),
  likely_benign: entry("likely_benign", "LB", "Likely benign", "benign", false),
  benign: entry("benign", "B", "Benign", "benign", true),
  other: entry("other", "OTHER", "Other", "other", true),
};

export const CLINICAL_SIGNIFICANCE_ORDER: ClinicalSignificance[] = [
  "pathogenic",
  "likely_pathogenic",
  "uncertain",
  "conflicting",
  "likely_benign",
  "benign",
  "other",
];

/**
 * Maps a database's own wording onto a display class. Combined wordings such as
 * "Pathogenic/Likely pathogenic" resolve to the less certain member.
 */
export function parseClinicalSignificance(
  raw: string | null | undefined,
): ClinicalSignificance | null {
  if (!raw) return null;
  const value = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (value.includes("conflicting")) return "conflicting";
  if (value.includes("likely pathogenic")) return "likely_pathogenic";
  if (value.includes("pathogenic")) return "pathogenic";
  if (value.includes("likely benign")) return "likely_benign";
  if (value.includes("benign")) return "benign";
  if (value.includes("uncertain") || value === "vus") return "uncertain";
  return "other";
}

/** ClinVar review status as gold stars, always shown beside the status text as n/4. */
export function clinvarReviewStars(
  reviewStatus: string | null | undefined,
): number | null {
  if (!reviewStatus) return null;
  const value = reviewStatus.toLowerCase();
  if (value.includes("practice guideline")) return 4;
  if (value.includes("expert panel")) return 3;
  if (value.includes("multiple submitters") && value.includes("no conflicts"))
    return 2;
  if (value.includes("criteria provided"))
    return value.startsWith("no assertion criteria") ? 0 : 1;
  return 0;
}
