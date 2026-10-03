import {
  ALPHAMISSENSE_CLASSES,
  alphaMissenseClass,
} from "@/lib/science/alphamissense";
import { PLDDT_BANDS, plddtBand } from "@/lib/science/plddt";

export type MetricId =
  | "plddt"
  | "pae"
  | "ptm"
  | "iptm"
  | "alphamissense"
  | "ddg"
  | "affinity"
  | "binder_probability";

export interface MetricInterpretation {
  /** plain-language reading of the value, worded as the source words it */
  text: string;
  /** Tailwind background utility when the reading maps onto a canonical colour band */
  swatchClass?: string;
  /** letter or short code that carries the band without colour */
  code?: string;
  /** ink for the code printed on the swatch */
  onFill?: "white" | "ink";
}

export interface MetricScaleRow {
  range: string;
  meaning: string;
  swatchClass?: string;
  code?: string;
  onFill?: "white" | "ink";
}

export interface MetricDefinition {
  id: MetricId;
  label: string;
  /** spelled-out name shown in the explainer header */
  name: string;
  unit: string | null;
  digits: number;
  advancedDigits: number;
  /** what the number measures, one or two sentences */
  what: string;
  scale: MetricScaleRow[];
  /** what the number does not tell you */
  limits: string;
  interpret: (value: number) => MetricInterpretation | null;
}

const formatMicromolar = (micromolar: number): string => {
  if (micromolar < 0.001)
    return `${(micromolar * 1_000_000).toPrecision(2)} pM`;
  if (micromolar < 1) return `${(micromolar * 1000).toPrecision(2)} nM`;
  if (micromolar < 1000) return `${micromolar.toPrecision(2)} µM`;
  return `${(micromolar / 1000).toPrecision(2)} mM`;
};

export const METRICS: Record<MetricId, MetricDefinition> = {
  plddt: {
    id: "plddt",
    label: "pLDDT",
    name: "Predicted local distance difference test",
    unit: null,
    digits: 0,
    advancedDigits: 2,
    what: "The model's own estimate, per residue, of how accurate the local structure is. Scale 0 to 100.",
    scale: PLDDT_BANDS.map((band) => ({
      range: band.range,
      meaning: `${band.label}. ${band.meaning}`,
      swatchClass: band.swatchClass,
      code: band.code,
      onFill: band.onFill,
    })),
    limits:
      "It says nothing about how domains or chains sit relative to each other. Low pLDDT means disorder or too little information, not that a variant misfolds the protein.",
    interpret: (value) => {
      const band = plddtBand(value);
      return {
        text: `${band.label} local structural confidence`,
        swatchClass: band.swatchClass,
        code: band.code,
        onFill: band.onFill,
      };
    },
  },
  pae: {
    id: "pae",
    label: "PAE",
    name: "Predicted aligned error",
    unit: "Å",
    digits: 1,
    advancedDigits: 2,
    what: "The expected positional error at residue X, in ångströms, if the predicted and actual structures were aligned on residue Y. It reports confidence in relative position.",
    scale: [
      {
        range: "Low",
        meaning:
          "The two residues are confidently placed relative to each other.",
      },
      {
        range: "High",
        meaning:
          "Their relative placement is uncertain, even when each is locally confident.",
      },
      {
        range: "31.75 Å",
        meaning:
          "The cap for AlphaFold 2 models. Values at the cap carry no placement information.",
      },
    ],
    limits:
      "A confident domain arrangement needs low PAE between the domains. High pLDDT alone is not enough. The matrix is not symmetric.",
    interpret: () => null,
  },
  ptm: {
    id: "ptm",
    label: "pTM",
    name: "Predicted TM-score",
    unit: null,
    digits: 2,
    advancedDigits: 4,
    what: "A single predicted score for the overall fold of the whole structure. Scale 0 to 1.",
    scale: [
      {
        range: "> 0.5",
        meaning:
          "The overall predicted fold might be similar to the true structure.",
      },
      {
        range: "≤ 0.5",
        meaning: "The overall fold is not supported by this score.",
      },
    ],
    limits:
      "Unreliable for very short inputs (fewer than 20 residues). Use PAE or pLDDT there.",
    interpret: (value) => ({
      text:
        value > 0.5
          ? "Above 0.5: overall fold might be similar to the true structure"
          : "At or below 0.5",
    }),
  },
  iptm: {
    id: "iptm",
    label: "ipTM",
    name: "Interface predicted TM-score",
    unit: null,
    digits: 2,
    advancedDigits: 4,
    what: "The predicted TM-score restricted to the interfaces between chains. Scale 0 to 1. Reported only for predictions with more than one chain.",
    scale: [
      {
        range: "> 0.8",
        meaning: "Confident, high-quality interface prediction.",
      },
      {
        range: "0.6 to 0.8",
        meaning: "Grey zone. The interface may or may not be correct.",
      },
      { range: "< 0.6", meaning: "Suggests a failed interface prediction." },
    ],
    limits: "Never compare ipTM numerically between different model families.",
    interpret: (value) => {
      if (value > 0.8) return { text: "Confident interface prediction" };
      if (value >= 0.6)
        return { text: "Grey zone: interface may or may not be correct" };
      return { text: "Suggests a failed interface prediction" };
    },
  },
  alphamissense: {
    id: "alphamissense",
    label: "AlphaMissense",
    name: "AlphaMissense pathogenicity (predicted)",
    unit: null,
    digits: 3,
    advancedDigits: 4,
    what: "A model's predicted pathogenicity score for a single amino-acid substitution. Scale 0 to 1; higher means more likely pathogenic.",
    scale: ALPHAMISSENSE_CLASSES.map((entry) => ({
      range: entry.range,
      meaning: entry.label,
      swatchClass: entry.swatchClass,
    })),
    limits:
      "A prediction, not a clinical classification. It does not replace a database assertion such as ClinVar and is never shown in the same form as one.",
    interpret: (value) => {
      const entry = alphaMissenseClass(value);
      return {
        text: `${entry.label} (predicted)`,
        swatchClass: entry.swatchClass,
      };
    },
  },
  ddg: {
    id: "ddg",
    label: "ΔΔG",
    name: "Predicted change in folding stability",
    unit: "kcal/mol",
    digits: 2,
    advancedDigits: 3,
    what: "The predicted difference in folding free energy between the variant and the reference protein. Positive values mean the variant is predicted to be less stable.",
    scale: [
      {
        range: "≥ 2 kcal/mol",
        meaning: "Likely to be destabilising (ProtVar threshold for FoldX).",
      },
      { range: "< 2 kcal/mol", meaning: "Unlikely to be destabilising." },
    ],
    limits:
      "Computed on a structure model, so it is only as good as that model at this residue. Check the residue's pLDDT. A variant can be damaging without changing stability.",
    interpret: (value) => ({
      text:
        value >= 2
          ? "Likely to be destabilising"
          : "Unlikely to be destabilising",
    }),
  },
  affinity: {
    id: "affinity",
    label: "Predicted affinity",
    name: "Predicted log10(IC50 / µM)",
    unit: "log10(IC50 / µM)",
    digits: 2,
    advancedDigits: 4,
    what: "A model's predicted binding strength for one small molecule against one protein, expressed as log10 of an IC50 in micromolar. Lower is stronger: -3 is 1 nM, 0 is 1 µM, 2 is 100 µM.",
    scale: [
      { range: "-3", meaning: "1 nM" },
      { range: "0", meaning: "1 µM" },
      { range: "2", meaning: "100 µM" },
    ],
    limits:
      "Computational prediction for hypothesis generation. Not experimental data. Not for clinical decisions. It is not a Kd, a Ki or a measured ΔG, and it is only meaningful when comparing molecules that do bind. Read it together with the structural confidence of the same run.",
    interpret: (value) => ({
      text: `Corresponds to a predicted IC50 near ${formatMicromolar(10 ** value)}`,
    }),
  },
  binder_probability: {
    id: "binder_probability",
    label: "Binder probability",
    name: "Predicted probability that the ligand binds",
    unit: null,
    digits: 2,
    advancedDigits: 4,
    what: "The model's predicted probability that the ligand is a binder. Scale 0 to 1. Intended for separating binders from non-binders.",
    scale: [],
    limits:
      "Computational prediction for hypothesis generation. Not experimental data. Not for clinical decisions. A pose with low interface confidence makes this value uninterpretable.",
    interpret: () => null,
  },
};

export function formatMetricValue(
  metric: MetricId,
  value: number,
  advanced = false,
): string {
  const definition = METRICS[metric];
  return value.toFixed(
    advanced ? definition.advancedDigits : definition.digits,
  );
}
