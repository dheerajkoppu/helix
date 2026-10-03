import { EVIDENCE_META } from "@/lib/evidence";
import { CLINICAL_SIGNIFICANCE } from "@/lib/science/clinical-significance";
import { alphaMissenseClass } from "@/lib/science/alphamissense";
import { plddtBand } from "@/lib/science/plddt";
import type { ResidueRange } from "@/lib/state/selection";
import { STRUCTURE_ORIGIN_META } from "@/lib/structure-origin";

import { trackHasData } from "./draw";
import { CONSEQUENCE_LABEL } from "./legend";
import type { SequenceTrack, SequenceVariant } from "./types";

const ROW_LIMIT = 400;
const TH =
  "sticky top-0 z-10 border-b border-border bg-muted px-2 py-1 text-left text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase";
const TD = "border-b border-border-subtle px-2 py-1 align-top";
const NUM = `${TD} tabular text-right font-mono`;

function valueSummary(
  track: SequenceTrack,
  window: ResidueRange,
): string | null {
  const values = (track.values ?? [])
    .slice(window.start - 1, window.end)
    .filter((value): value is number => value !== null && value !== undefined);
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (track.kind === "confidence") {
    return `mean ${mean.toFixed(1)} (${plddtBand(mean).label}), range ${low.toFixed(1)} to ${high.toFixed(1)}, ${values.length} residues`;
  }
  if (track.kind === "pathogenicity") {
    return `mean ${mean.toFixed(2)} (${alphaMissenseClass(mean).label}), range ${low.toFixed(2)} to ${high.toFixed(2)}, ${values.length} residues`;
  }
  return `mean ${mean.toFixed(2)}, range ${low.toFixed(2)} to ${high.toFixed(2)}, ${values.length} residues`;
}

export interface AxisTableProps {
  accession: string;
  window: ResidueRange;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
  selectedVariantId: string | null;
  onSelectRange: (range: ResidueRange) => void;
  onSelectVariant: (variant: SequenceVariant) => void;
}

/** The same rows as the drawn axis, as tables: every feature and variant in the visible window. */
export function AxisTable({
  accession,
  window,
  tracks,
  variants,
  selectedVariantId,
  onSelectRange,
  onSelectVariant,
}: AxisTableProps) {
  const features = tracks.flatMap((track) =>
    trackHasData(track)
      ? (track.features ?? [])
          .filter(
            (feature) =>
              feature.end >= window.start && feature.start <= window.end,
          )
          .map((feature) => ({ track, feature }))
      : [],
  );
  const inWindow = variants.filter(
    (variant) =>
      variant.position >= window.start && variant.position <= window.end,
  );
  const stripTracks = tracks.filter(
    (track) => track.values && trackHasData(track),
  );
  const unavailable = tracks.filter((track) => !trackHasData(track));

  return (
    <div
      data-slot="axis-table"
      className="scroll-thin min-h-0 flex-1 overflow-auto text-xs"
    >
      <table className="w-full border-collapse">
        <caption className="border-b border-border-subtle px-2 py-1 text-left text-2xs text-muted-foreground">
          Variants at residues {window.start}-{window.end} of {accession}{" "}
          canonical, after filters: {inWindow.length}
          {inWindow.length > ROW_LIMIT
            ? `. Showing the first ${ROW_LIMIT}; zoom in to narrow the window.`
            : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Variant
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Position
            </th>
            <th scope="col" className={TH}>
              Row
            </th>
            <th scope="col" className={TH}>
              Consequence
            </th>
            <th scope="col" className={TH}>
              Classification
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Review
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Allele freq.
            </th>
            <th scope="col" className={TH}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {inWindow.slice(0, ROW_LIMIT).map((variant) => {
            const meta = variant.significance
              ? CLINICAL_SIGNIFICANCE[variant.significance]
              : null;
            return (
              <tr
                key={`${variant.group}-${variant.id}`}
                className={
                  variant.id === selectedVariantId ? "bg-active" : undefined
                }
              >
                <th scope="row" className={`${TD} text-left font-normal`}>
                  <button
                    type="button"
                    onClick={() => onSelectVariant(variant)}
                    className="cursor-pointer font-mono text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
                  >
                    {variant.label}
                  </button>
                </th>
                <td className={NUM}>{variant.position}</td>
                <td className={TD}>{variant.group}</td>
                <td className={TD}>{CONSEQUENCE_LABEL[variant.consequence]}</td>
                <td className={TD}>
                  {meta ? `${meta.code} ${meta.label}` : "No classification"}
                </td>
                <td className={NUM}>
                  {variant.reviewStars === null ||
                  variant.reviewStars === undefined
                    ? "Unknown"
                    : `${variant.reviewStars}/4`}
                </td>
                <td className={NUM}>
                  {variant.alleleFrequency
                    ? variant.alleleFrequency.toExponential(2)
                    : "Unknown"}
                </td>
                <td className={TD}>
                  {variant.evidenceClass
                    ? `${EVIDENCE_META[variant.evidenceClass].code} `
                    : ""}
                  {variant.source ?? "No source found"}
                  {variant.sourceId ? (
                    <span className="ml-1 font-mono">{variant.sourceId}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="w-full border-collapse">
        <caption className="border-b border-border-subtle px-2 py-1 text-left text-2xs text-muted-foreground">
          Features overlapping residues {window.start}-{window.end}:{" "}
          {features.length}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Track
            </th>
            <th scope="col" className={TH}>
              Feature
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Start
            </th>
            <th scope="col" className={`${TH} text-right`}>
              End
            </th>
            <th scope="col" className={TH}>
              Evidence
            </th>
            <th scope="col" className={TH}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {features.slice(0, ROW_LIMIT).map(({ track, feature }) => {
            const evidenceClass = feature.evidenceClass ?? track.evidenceClass;
            return (
              <tr key={`${track.id}-${feature.id}`}>
                <td className={TD}>{track.label}</td>
                <th scope="row" className={`${TD} text-left font-normal`}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectRange({ start: feature.start, end: feature.end })
                    }
                    className="cursor-pointer text-left text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
                  >
                    {feature.origin
                      ? `${STRUCTURE_ORIGIN_META[feature.origin].tag} `
                      : ""}
                    {feature.label ?? feature.description ?? feature.id}
                  </button>
                  {feature.label && feature.description ? (
                    <span className="ml-1.5 text-muted-foreground">
                      {feature.description}
                    </span>
                  ) : null}
                </th>
                <td className={NUM}>{feature.start}</td>
                <td className={NUM}>{feature.end}</td>
                <td className={TD}>
                  {evidenceClass
                    ? `${EVIDENCE_META[evidenceClass].code} ${EVIDENCE_META[evidenceClass].claim}`
                    : "Unknown"}
                </td>
                <td className={TD}>
                  {track.source ?? "No source found"}
                  {feature.sourceId ? (
                    <span className="ml-1 font-mono">{feature.sourceId}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {stripTracks.map((track) => (
            <tr key={track.id}>
              <td className={TD}>{track.label}</td>
              <th scope="row" className={`${TD} text-left font-normal`}>
                {valueSummary(track, window) ?? "No values in this window"}
                {track.valueLabel ? (
                  <span className="ml-1.5 text-muted-foreground">
                    {track.valueLabel}
                  </span>
                ) : null}
              </th>
              <td className={NUM}>{window.start}</td>
              <td className={NUM}>{window.end}</td>
              <td className={TD}>
                {track.evidenceClass
                  ? `${EVIDENCE_META[track.evidenceClass].code} ${EVIDENCE_META[track.evidenceClass].claim}`
                  : "Unknown"}
              </td>
              <td className={TD}>{track.source ?? "No source found"}</td>
            </tr>
          ))}
          {unavailable.map((track) => (
            <tr key={track.id}>
              <td className={TD}>{track.label}</td>
              <td className={TD} colSpan={5}>
                {track.status?.state === "empty"
                  ? `No record in ${track.status.name ?? track.status.source}`
                  : `${track.status?.name ?? track.status?.source} unavailable${track.status?.message ? `: ${track.status.message}` : ""}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
