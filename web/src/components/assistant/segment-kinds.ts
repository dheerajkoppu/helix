import type { SegmentKind } from "./types";

export interface SegmentKindMeta {
  code: string;
  label: string;
  description: string;
  /** leading rule: style and width differ per kind, so the kind never rests on hue */
  ruleClass: string;
  textClass: string;
}

/**
 * Same border language as the evidence classes: solid is asserted by an external source, double is
 * a publication, dashed is computed by a tool, dotted is authored here.
 */
export const SEGMENT_KIND_META: Record<SegmentKind, SegmentKindMeta> = {
  database_fact: {
    code: "FACT",
    label: "Database fact",
    description:
      "Stated by an experimental, clinical or curated database record that the segment cites.",
    ruleClass: "border-l-2 border-solid border-ev-curated",
    textClass: "text-ev-curated",
  },
  paper_finding: {
    code: "PAPER",
    label: "Paper finding",
    description: "Reported by a publication that the segment cites.",
    ruleClass: "border-l-4 border-double border-ev-literature",
    textClass: "text-ev-literature",
  },
  computational_result: {
    code: "COMP",
    label: "Computational result",
    description:
      "Output of a prediction tool or an OrphaFold run. A prediction, not an observation.",
    ruleClass: "border-l-2 border-dashed border-ev-prediction",
    textClass: "text-ev-prediction",
  },
  reasoning_hypothesis: {
    code: "REASON",
    label: "Reasoning",
    description:
      "The assistant's own inference or a hypothesis. Not a source statement.",
    ruleClass: "border-l-2 border-dotted border-ev-hypothesis",
    textClass: "text-ev-hypothesis",
  },
};

export const SEGMENT_KIND_ORDER: SegmentKind[] = [
  "database_fact",
  "paper_finding",
  "computational_result",
  "reasoning_hypothesis",
];
