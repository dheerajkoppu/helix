/**
 * pLDDT bands as shipped by AlphaFold DB. Colours are canonical and identical in both themes.
 * Reserved for per-residue confidence and nothing else.
 */
export type PlddtBand = "very_high" | "high" | "low" | "very_low";

export interface PlddtBandMeta {
  id: PlddtBand;
  /** AlphaFold DB confidenceCategory letter, printed in 2D cells so the band survives without colour */
  code: "H" | "M" | "L" | "D";
  label: string;
  range: string;
  hex: string;
  /** numeric colour for Mol* and canvas drawing */
  color: number;
  swatchClass: string;
  /** ink that stays readable on the band fill */
  onFill: "white" | "ink";
  /** AlphaFold DB's own wording for the band */
  meaning: string;
}

export const PLDDT_BANDS: PlddtBandMeta[] = [
  {
    id: "very_high",
    code: "H",
    label: "Very high",
    range: "pLDDT > 90",
    hex: "#0053D6",
    color: 0x0053d6,
    swatchClass: "bg-plddt-very-high",
    onFill: "white",
    meaning: "Expected to be modelled to high accuracy.",
  },
  {
    id: "high",
    code: "M",
    label: "High",
    range: "90 > pLDDT > 70",
    hex: "#65CBF3",
    color: 0x65cbf3,
    swatchClass: "bg-plddt-high",
    onFill: "ink",
    meaning: "Modelled well: a generally good backbone prediction.",
  },
  {
    id: "low",
    code: "L",
    label: "Low",
    range: "70 > pLDDT > 50",
    hex: "#FFDB13",
    color: 0xffdb13,
    swatchClass: "bg-plddt-low",
    onFill: "ink",
    meaning: "Low confidence. Treat with caution.",
  },
  {
    id: "very_low",
    code: "D",
    label: "Very low",
    range: "pLDDT < 50",
    hex: "#FF7D45",
    color: 0xff7d45,
    swatchClass: "bg-plddt-very-low",
    onFill: "ink",
    meaning: "Should not be interpreted. Often a sign of disorder.",
  },
];

export const PLDDT_NO_SCORE = {
  hex: "#AAAAAA",
  color: 0xaaaaaa,
  swatchClass: "bg-plddt-none",
} as const;

const BAND_BY_ID = Object.fromEntries(
  PLDDT_BANDS.map((band) => [band.id, band]),
) as Record<PlddtBand, PlddtBandMeta>;
const BAND_BY_CODE = Object.fromEntries(
  PLDDT_BANDS.map((band) => [band.code, band]),
) as Record<string, PlddtBandMeta>;

/**
 * One banding function for tracks, tables and the viewer. Cut-offs are lower-inclusive at 90, 70 and 50
 * on the 0 to 100 scale, which agrees with the categories AlphaFold DB serves at exactly 90.0.
 * When the source supplies its own category letter, pass it and it wins.
 */
export function plddtBand(
  score: number,
  sourceCategory?: string | null,
): PlddtBandMeta {
  if (sourceCategory && BAND_BY_CODE[sourceCategory])
    return BAND_BY_CODE[sourceCategory];
  if (score >= 90) return BAND_BY_ID.very_high;
  if (score >= 70) return BAND_BY_ID.high;
  if (score >= 50) return BAND_BY_ID.low;
  return BAND_BY_ID.very_low;
}

/** Boltz and ESM Atlas PDB files report 0 to 1. Display is always 0 to 100. */
export function normalizePlddt(score: number, scale: "0-1" | "0-100"): number {
  return scale === "0-1" ? score * 100 : score;
}
