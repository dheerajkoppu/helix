/**
 * Pure builders for the comparison stage: displacement colouring, dock rows and evidence records.
 * Every number comes from the difference payload of `/compare/results/{job_id}`.
 */
import type { SequenceFeature, SequenceTrack } from "@/components/sequence";
import type { ResidueColoring } from "@/components/viewer";
import type { EvidenceItem } from "@/lib/evidence";
import {
  apiFileUrl,
  type ComparePlanResponse,
  type CompareResultResponse,
} from "@/lib/workspace-data";

export type Difference = CompareResultResponse["difference"];
export type PerResidue = Difference["per_residue"][number];
export type Caveat = ComparePlanResponse["caveats"][number];
export type Citation = Caveat["citations"][number];
export type ProviderOption = ComparePlanResponse["providers"][number];
export type ResultSummary = ComparePlanResponse["results"][number];
export type Construct = CompareResultResponse["construct"];

export type DisplacementScale = "fixed" | "data";
export type ShownModels = "both" | "reference" | "variant";

/** Upper end of the fixed displacement scale, in ångström. */
export const FIXED_SCALE_MAX = 2;

const DISPLACEMENT_BINS = [2, 1, 0.5] as const;

export const formatAngstrom = (value: number, digits = 2) =>
  `${value.toFixed(digits)} Å`;

export const citationHref = (citation: Citation): string | null =>
  citation.url ??
  (citation.doi ? `https://doi.org/${citation.doi}` : null) ??
  (citation.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/` : null);

export const constructRange = (construct: Construct) =>
  construct.full_length
    ? `${construct.start}-${construct.end}, full length`
    : `${construct.start}-${construct.end} of ${construct.protein_length}`;

export function largestDisplacement(difference: Difference): number {
  return difference.per_residue.reduce(
    (largest, residue) => Math.max(largest, residue.ca_displacement ?? 0),
    0,
  );
}

function mix(from: number, to: number, fraction: number): number {
  const channel = (shift: number) => {
    const start = (from >> shift) & 0xff;
    const end = (to >> shift) & 0xff;
    return Math.round(start + (end - start) * fraction);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * C-alpha displacement after superposition as a per-residue colour map: the reference token at
 * zero, the variant token at `scaleMax`, and a separate colour for masked residues. Geometry of two
 * predicted models, never a damage scale.
 */
export function displacementColoring(
  difference: Difference,
  colors: { reference: number; variant: number; masked: number },
  scaleMax: number,
  clamped: boolean,
): ResidueColoring {
  const map = new Map<number, number>();
  for (const residue of difference.per_residue) {
    if (residue.masked || residue.ca_displacement === null) {
      map.set(residue.position, colors.masked);
      continue;
    }
    const fraction =
      scaleMax > 0 ? Math.min(1, residue.ca_displacement / scaleMax) : 0;
    map.set(residue.position, mix(colors.reference, colors.variant, fraction));
  }
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return {
    colors: map,
    fallback: colors.masked,
    legend: {
      title: "Cα displacement after superposition",
      note: difference.geometry_label,
      items: [
        ...steps.map((step) => ({
          label: `${step === 1 && clamped ? "≥ " : ""}${formatAngstrom(step * scaleMax)}`,
          color: mix(colors.reference, colors.variant, step),
        })),
        {
          label: `Masked, pLDDT < ${difference.masking.plddt_threshold}`,
          color: colors.masked,
          code: "M",
        },
      ],
    },
  };
}

function displacementFeatures(difference: Difference): SequenceFeature[] {
  const features: SequenceFeature[] = [];
  const binOf = (residue: PerResidue) =>
    residue.masked || residue.ca_displacement === null
      ? null
      : (DISPLACEMENT_BINS.find(
          (threshold) => (residue.ca_displacement as number) >= threshold,
        ) ?? null);
  let open: { bin: number; start: number; end: number; peak: number } | null =
    null;
  const close = () => {
    if (!open) return;
    features.push({
      id: `displacement-${open.start}`,
      start: open.start,
      end: open.end,
      label: `≥ ${open.bin} Å`,
      description: `Cα displacement up to ${formatAngstrom(open.peak)} (${difference.geometry_label})`,
      evidenceClass: "computational_prediction",
      sourceId: difference.job_id,
    });
    open = null;
  };
  for (const residue of difference.per_residue) {
    const bin = binOf(residue);
    if (
      open &&
      bin === open.bin &&
      residue.position === open.end + 1 &&
      residue.ca_displacement !== null
    ) {
      open.end = residue.position;
      open.peak = Math.max(open.peak, residue.ca_displacement);
      continue;
    }
    close();
    if (bin !== null && residue.ca_displacement !== null)
      open = {
        bin,
        start: residue.position,
        end: residue.position,
        peak: residue.ca_displacement,
      };
  }
  close();
  return features;
}

/** Dock rows of one comparison: construct, displacement, masked stretches and both pLDDT strips. */
export function comparisonTracks(
  result: CompareResultResponse,
  sequenceLength: number,
): SequenceTrack[] {
  const { difference, construct, provider } = result;
  const source =
    `${provider.model_name ?? provider.name} ${provider.model_version ?? ""}`.trim();
  const reference: Array<number | null> = new Array(sequenceLength).fill(null);
  const variant: Array<number | null> = new Array(sequenceLength).fill(null);
  for (const residue of difference.per_residue) {
    if (residue.position < 1 || residue.position > sequenceLength) continue;
    reference[residue.position - 1] = residue.plddt_reference;
    variant[residue.position - 1] = residue.plddt_variant;
  }
  const moved = displacementFeatures(difference);
  const compared =
    difference.masking.total_residues - difference.masking.masked_residues;
  return [
    {
      id: "compare-construct",
      label: "Construct",
      kind: "custom",
      source,
      evidenceClass: "computational_prediction",
      features: [
        {
          id: "compare-construct-range",
          start: construct.start,
          end: construct.end,
          label: `Modelled ${construct.start}-${construct.end}`,
          description: construct.rationale,
          evidenceClass: "computational_prediction",
          sourceId: result.job_id,
        },
      ],
    },
    {
      id: "compare-displacement",
      label: "Cα shift",
      kind: "custom",
      source,
      evidenceClass: "computational_prediction",
      features: moved,
      valueLabel: "Cα displacement after superposition, 0.5 Å and above",
      status:
        moved.length === 0
          ? {
              source: "helix_compare",
              name: `these models at or above 0.5 Å (largest ${formatAngstrom(largestDisplacement(difference))} among ${compared} compared residues)`,
              state: "empty",
            }
          : undefined,
    },
    {
      id: "compare-masked",
      label: "Masked",
      kind: "custom",
      source,
      evidenceClass: "computational_prediction",
      features: difference.masking.masked_ranges.map((range) => ({
        id: `masked-${range.start}`,
        start: range.start,
        end: range.end,
        label: `pLDDT < ${difference.masking.plddt_threshold}`,
        description: difference.masking.rule,
        evidenceClass: "computational_prediction" as const,
        sourceId: difference.job_id,
      })),
    },
    {
      id: "compare-plddt-reference",
      label: "pLDDT ref",
      kind: "confidence",
      source,
      evidenceClass: "computational_prediction",
      values: reference,
      valueLabel: "reference model",
    },
    {
      id: "compare-plddt-variant",
      label: "pLDDT var",
      kind: "confidence",
      source,
      evidenceClass: "computational_prediction",
      values: variant,
      valueLabel: "variant model",
    },
  ];
}

/** Source record for anything measured on the two models: the run, its provider and the stored payload. */
export function modelEvidence(
  result: CompareResultResponse,
  statement: string,
): EvidenceItem {
  const { provider, difference } = result;
  return {
    evidenceClass: "computational_prediction",
    statement,
    source: {
      database: provider.name,
      recordId: result.job_id,
      release: provider.model_version,
      retrievedAt: result.generated_at,
      url: apiFileUrl(result.difference_url),
      license: result.reference_model.provenance?.license ?? null,
    },
    method: `${provider.model_name ?? provider.name} models; ${difference.superposition.method}`,
    modifiers: [
      difference.geometry_label,
      ...(result.origin === "cached_example" ? ["cached output"] : []),
    ],
  };
}
