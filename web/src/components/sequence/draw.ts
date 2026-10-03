/**
 * Canvas drawing for the sequence axis. Every row shares one linear scale, so a residue sits at the
 * same x in every track. Nothing here touches React: the component calls `drawAxis` when the view,
 * the data or the theme changes.
 */
import { alphaMissenseColor } from "@/lib/science/alphamissense";
import {
  CLINICAL_SIGNIFICANCE,
  type ClinicalSignificanceGroup,
} from "@/lib/science/clinical-significance";
import { plddtBand } from "@/lib/science/plddt";
import type { ResidueRange } from "@/lib/state/selection";
import type { StructureOrigin } from "@/lib/structure-origin";

import type {
  SequenceFeature,
  SequenceTrack,
  SequenceVariant,
  VariantConsequence,
} from "./types";

export const MAX_PX_PER_RESIDUE = 24;
export const LETTER_MIN_PX = 8;
export const BAND_LETTER_MIN_PX = 10;
/** below this width per residue, variants are drawn as stacked bins */
export const BIN_BELOW_PX = 2;

const CLINICAL_HEIGHT = 48;
const AXIS_HEIGHT = 31;
const POPULATION_HEIGHT = 28;
const LANE_HEIGHT = 16;
const STRIP_HEIGHT = 18;
const COVERAGE_LANE = 13;
const MAX_LANES = 3;
const BIN_PX = 6;
/** shared positions print their count from this width; narrower, a bar above the head marks a stack */
const COUNT_LABEL_MIN_PX = 10;
const HEAD_RADIUS = 4;
const STEM_BASE = 9;
const STEM_PER_STAR = 7;
/** ink that stays readable on a scale fill, the same value Swatch prints codes in */
const INK_ON_FILL = "#15171a";

export const SIGNIFICANCE_GROUPS: ClinicalSignificanceGroup[] = [
  "pathogenic",
  "uncertain",
  "benign",
  "other",
];

export const SIGNIFICANCE_GROUP_LABEL: Record<
  ClinicalSignificanceGroup,
  string
> = {
  pathogenic: "pathogenic or likely pathogenic",
  uncertain: "uncertain or conflicting",
  benign: "benign or likely benign",
  other: "other or not classified",
};

const GROUP_HEX: Record<ClinicalSignificanceGroup, string> = {
  pathogenic: CLINICAL_SIGNIFICANCE.pathogenic.hex,
  uncertain: CLINICAL_SIGNIFICANCE.uncertain.hex,
  benign: CLINICAL_SIGNIFICANCE.benign.hex,
  other: CLINICAL_SIGNIFICANCE.other.hex,
};

export const COVERAGE_ORIGINS: StructureOrigin[] = [
  "experimental",
  "predicted_external",
  "predicted_orphafold",
];

export interface Palette {
  background: string;
  muted: string;
  foreground: string;
  mutedForeground: string;
  subtleForeground: string;
  borderSubtle: string;
  border: string;
  borderStrong: string;
  mono: string;
  sans: string;
}

export function readPalette(
  element: HTMLElement,
  monoProbe: HTMLElement | null,
): Palette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: token("--background"),
    muted: token("--muted"),
    foreground: token("--foreground"),
    mutedForeground: token("--muted-foreground"),
    subtleForeground: token("--fg-subtle"),
    borderSubtle: token("--border-subtle"),
    border: token("--border"),
    borderStrong: token("--border-strong"),
    mono: monoProbe ? getComputedStyle(monoProbe).fontFamily : "monospace",
    sans: style.fontFamily,
  };
}

export interface View {
  /** residues to the left of the plot's left edge; fractional while panning */
  start: number;
  /** residues across the plot width */
  span: number;
}

export function clampView(view: View, length: number, width: number): View {
  const minSpan = Math.min(length, Math.max(1, width / MAX_PX_PER_RESIDUE));
  const span = Math.min(length, Math.max(minSpan, view.span));
  const start = Math.min(Math.max(0, view.start), Math.max(0, length - span));
  return { start, span };
}

export interface PositionGroup {
  position: number;
  /** lead variant first: strongest review, then most severe class */
  variants: SequenceVariant[];
}

const GROUP_RANK: Record<ClinicalSignificanceGroup, number> = {
  pathogenic: 0,
  uncertain: 1,
  benign: 2,
  other: 3,
};

export const significanceGroup = (
  variant: SequenceVariant,
): ClinicalSignificanceGroup =>
  variant.significance
    ? CLINICAL_SIGNIFICANCE[variant.significance].group
    : "other";

export function groupByPosition(variants: SequenceVariant[]): PositionGroup[] {
  const byPosition = new Map<number, SequenceVariant[]>();
  for (const variant of variants) {
    const list = byPosition.get(variant.position);
    if (list) list.push(variant);
    else byPosition.set(variant.position, [variant]);
  }
  const groups: PositionGroup[] = [];
  for (const [position, list] of byPosition) {
    list.sort(
      (left, right) =>
        (right.reviewStars ?? -1) - (left.reviewStars ?? -1) ||
        GROUP_RANK[significanceGroup(left)] -
          GROUP_RANK[significanceGroup(right)],
    );
    groups.push({ position, variants: list });
  }
  return groups.sort((left, right) => left.position - right.position);
}

export type RowKind = "clinical" | "axis" | "population" | "track";

export interface LaidOutFeature {
  feature: SequenceFeature;
  lane: number;
}

export interface Row {
  id: string;
  kind: RowKind;
  label: string;
  y: number;
  height: number;
  track?: SequenceTrack;
  features?: LaidOutFeature[];
  /** coverage rows: one lane per structure class present */
  lanes?: Array<{ origin: StructureOrigin; merged: ResidueRange[] }>;
}

function assignLanes(features: SequenceFeature[]): {
  placed: LaidOutFeature[];
  laneCount: number;
} {
  const sorted = [...features].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const laneEnds: number[] = [];
  const placed = sorted.map((feature) => {
    let lane = laneEnds.findIndex((end) => end < feature.start);
    if (lane === -1) {
      lane =
        laneEnds.length < MAX_LANES
          ? laneEnds.length
          : laneEnds.indexOf(Math.min(...laneEnds));
    }
    laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, feature.end);
    return { feature, lane };
  });
  return { placed, laneCount: Math.max(1, laneEnds.length) };
}

function mergeRanges(features: SequenceFeature[]): ResidueRange[] {
  const sorted = [...features].sort((left, right) => left.start - right.start);
  const merged: ResidueRange[] = [];
  for (const feature of sorted) {
    const last = merged[merged.length - 1];
    if (last && feature.start <= last.end + 1) {
      last.end = Math.max(last.end, feature.end);
    } else {
      merged.push({ start: feature.start, end: feature.end });
    }
  }
  return merged;
}

export const trackHasData = (track: SequenceTrack) =>
  !track.status || track.status.state === "ok";

export function layoutRows(
  tracks: SequenceTrack[],
  hasClinical: boolean,
  hasPopulation: boolean,
): { rows: Row[]; height: number } {
  const rows: Row[] = [];
  let y = 0;
  const push = (row: Omit<Row, "y">) => {
    rows.push({ ...row, y });
    y += row.height;
  };
  if (hasClinical) {
    push({
      id: "clinical",
      kind: "clinical",
      label: "Clinical",
      height: CLINICAL_HEIGHT,
    });
  }
  push({ id: "axis", kind: "axis", label: "Residue", height: AXIS_HEIGHT });
  if (hasPopulation) {
    push({
      id: "population",
      kind: "population",
      label: "Population",
      height: POPULATION_HEIGHT,
    });
  }
  for (const track of tracks) {
    const base = { id: track.id, kind: "track" as const, label: track.label };
    const features = track.features ?? [];
    if (!trackHasData(track)) {
      push({ ...base, track, height: LANE_HEIGHT + 2 });
    } else if (track.kind === "coverage") {
      const lanes = COVERAGE_ORIGINS.map((origin) => ({
        origin,
        merged: mergeRanges(
          features.filter((feature) => feature.origin === origin),
        ),
      })).filter((lane) => lane.merged.length > 0);
      push({
        ...base,
        track,
        lanes,
        features: features.map((feature) => ({ feature, lane: 0 })),
        height: Math.max(1, lanes.length) * COVERAGE_LANE + 4,
      });
    } else if (
      track.kind === "confidence" ||
      track.kind === "pathogenicity" ||
      track.kind === "conservation"
    ) {
      push({ ...base, track, height: STRIP_HEIGHT });
    } else if (track.kind === "secondary_structure" || track.kind === "site") {
      push({
        ...base,
        track,
        features: features.map((feature) => ({ feature, lane: 0 })),
        height: LANE_HEIGHT + 2,
      });
    } else {
      const { placed, laneCount } = assignLanes(features);
      push({
        ...base,
        track,
        features: placed,
        height: laneCount * LANE_HEIGHT + 2,
      });
    }
  }
  return { rows, height: y };
}

export interface BinInfo {
  start: number;
  end: number;
  group: "clinical" | "population";
  counts: Record<ClinicalSignificanceGroup, number>;
  total: number;
}

export interface HitRegion {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  variants?: SequenceVariant[];
  bin?: BinInfo;
}

export interface DrawInput {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  palette: Palette;
  rows: Row[];
  sequence: string;
  view: View;
  clinical: PositionGroup[];
  population: PositionGroup[];
  selection: ResidueRange[];
  selectedVariantId: string | null;
}

const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

function headPath(
  context: CanvasRenderingContext2D,
  consequence: VariantConsequence,
  x: number,
  y: number,
  radius: number,
) {
  context.beginPath();
  if (consequence === "missense" || consequence === "inframe") {
    context.moveTo(x, y - radius - 0.5);
    context.lineTo(x + radius + 0.5, y + radius);
    context.lineTo(x - radius - 0.5, y + radius);
    context.closePath();
  } else if (consequence === "splice") {
    context.moveTo(x, y - radius - 1);
    context.lineTo(x + radius + 1, y);
    context.lineTo(x, y + radius + 1);
    context.lineTo(x - radius - 1, y);
    context.closePath();
  } else {
    context.arc(x, y, radius, 0, Math.PI * 2);
  }
}

function drawHead(
  context: CanvasRenderingContext2D,
  palette: Palette,
  variant: SequenceVariant,
  x: number,
  y: number,
  radius: number,
  selected: boolean,
) {
  const meta = variant.significance
    ? CLINICAL_SIGNIFICANCE[variant.significance]
    : null;
  const fill = meta ? meta.hex : palette.background;
  const outline = selected ? palette.foreground : palette.borderStrong;
  if (variant.consequence === "loss_of_function") {
    const arm = radius;
    const cross = () => {
      context.beginPath();
      context.moveTo(x - arm, y - arm);
      context.lineTo(x + arm, y + arm);
      context.moveTo(x + arm, y - arm);
      context.lineTo(x - arm, y + arm);
      context.stroke();
    };
    context.lineCap = "butt";
    context.strokeStyle = selected
      ? palette.foreground
      : palette.mutedForeground;
    context.lineWidth = selected ? 5 : 3.6;
    cross();
    context.strokeStyle = fill;
    context.lineWidth = 2.2;
    cross();
    return;
  }
  headPath(context, variant.consequence, x, y, radius);
  context.fillStyle = fill;
  context.fill();
  if (meta && !meta.certain) {
    // "likely" and conflicting classes carry a slash so they differ from the certain class without hue
    context.save();
    context.clip();
    context.strokeStyle = palette.background;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x - radius - 2, y + radius + 2);
    context.lineTo(x + radius + 2, y - radius - 2);
    context.stroke();
    context.restore();
    headPath(context, variant.consequence, x, y, radius);
  }
  context.strokeStyle = outline;
  context.lineWidth = selected ? 2 : 0.75;
  context.stroke();
}

function emptyCounts(): Record<ClinicalSignificanceGroup, number> {
  return { pathogenic: 0, uncertain: 0, benign: 0, other: 0 };
}

function binGroups(
  groups: PositionGroup[],
  binSize: number,
): { bins: Map<number, BinInfo>; max: number } {
  const bins = new Map<number, BinInfo>();
  let max = 0;
  for (const group of groups) {
    const index = Math.floor((group.position - 1) / binSize);
    let bin = bins.get(index);
    if (!bin) {
      bin = {
        start: index * binSize + 1,
        end: (index + 1) * binSize,
        group: "clinical",
        counts: emptyCounts(),
        total: 0,
      };
      bins.set(index, bin);
    }
    for (const variant of group.variants) {
      bin.counts[significanceGroup(variant)] += 1;
      bin.total += 1;
    }
    if (bin.total > max) max = bin.total;
  }
  return { bins, max };
}

/** stem depth for a population variant: log10 allele frequency clamped to 1e-6 .. 1e-1 */
function frequencyDepth(frequency: number | null | undefined): number {
  if (!frequency || frequency <= 0) return 5;
  const clamped = Math.min(-1, Math.max(-6, Math.log10(frequency)));
  return 5 + ((clamped + 6) / 5) * 13;
}

export function drawAxis(input: DrawInput): HitRegion[] {
  const {
    context,
    width,
    height,
    palette,
    rows,
    sequence,
    view,
    clinical,
    population,
    selection,
    selectedVariantId,
  } = input;
  const length = sequence.length;
  const pxPerResidue = width / view.span;
  const x = (position: number) => (position - 1 - view.start) * pxPerResidue;
  const first = Math.max(1, Math.floor(view.start) + 1);
  const last = Math.min(length, Math.ceil(view.start + view.span));
  const hits: HitRegion[] = [];
  const sansFont = `11px ${palette.sans}`;
  const monoFont = `11px ${palette.mono}`;
  const selectedAt = (position: number) =>
    selection.some((range) => position >= range.start && position <= range.end);

  context.clearRect(0, 0, width, height);
  context.textBaseline = "middle";

  const visibleGroups = (groups: PositionGroup[]) =>
    groups.filter(
      (group) => group.position >= first - 2 && group.position <= last + 2,
    );

  const drawBins = (row: Row, groups: PositionGroup[], upward: boolean) => {
    const binSize = Math.max(1, Math.ceil(BIN_PX / pxPerResidue));
    const { bins, max } = binGroups(groups, binSize);
    const usable = row.height - 8;
    const base = upward ? row.y + row.height : row.y;
    for (const bin of bins.values()) {
      if (bin.end < first || bin.start > last) continue;
      bin.group = upward ? "clinical" : "population";
      const left = x(bin.start);
      const binWidth = Math.max(2, binSize * pxPerResidue - 1);
      let offset = 0;
      for (const group of SIGNIFICANCE_GROUPS) {
        const count = bin.counts[group];
        if (count === 0) continue;
        const segment = Math.max(2, (count / max) * usable);
        context.fillStyle = upward ? GROUP_HEX[group] : palette.mutedForeground;
        context.fillRect(
          left,
          upward ? base - offset - segment : base + offset,
          binWidth,
          segment - (upward ? 1 : 0),
        );
        offset += segment;
      }
      const drawn = Math.min(usable + 4, offset);
      context.strokeStyle = palette.borderStrong;
      context.lineWidth = 0.5;
      context.strokeRect(
        left,
        upward ? base - drawn : base,
        binWidth,
        Math.max(1, drawn - (upward ? 1 : 0)),
      );
      hits.push({
        x0: left,
        x1: left + binWidth,
        y0: row.y,
        y1: row.y + row.height,
        bin,
      });
    }
  };

  const drawClinical = (row: Row) => {
    if (pxPerResidue < BIN_BELOW_PX) {
      drawBins(row, clinical, true);
      return;
    }
    const base = row.y + row.height;
    // draw benign first so the classes of most interest stay on top where heads overlap
    const groups = visibleGroups(clinical).sort(
      (left, right) =>
        GROUP_RANK[significanceGroup(right.variants[0])] -
        GROUP_RANK[significanceGroup(left.variants[0])],
    );
    for (const group of groups) {
      const lead = group.variants[0];
      const centre = x(group.position) + pxPerResidue / 2;
      const stars = Math.min(4, Math.max(0, lead.reviewStars ?? 0));
      const top = base - STEM_BASE - stars * STEM_PER_STAR;
      const selected = group.variants.some(
        (variant) => variant.id === selectedVariantId,
      );
      context.strokeStyle = selected
        ? palette.foreground
        : palette.borderStrong;
      context.lineWidth = selected ? 1.5 : 1;
      context.setLineDash(
        lead.reviewStars === null || lead.reviewStars === undefined
          ? [2, 2]
          : [],
      );
      context.beginPath();
      context.moveTo(centre, base);
      context.lineTo(centre, top);
      context.stroke();
      context.setLineDash([]);
      drawHead(context, palette, lead, centre, top, HEAD_RADIUS, selected);
      if (group.variants.length > 1) {
        if (pxPerResidue >= COUNT_LABEL_MIN_PX) {
          context.font = `600 10px ${palette.mono}`;
          context.textAlign = "left";
          context.fillStyle = palette.foreground;
          context.fillText(
            String(group.variants.length),
            centre + HEAD_RADIUS + 1.5,
            top - HEAD_RADIUS + 1,
          );
        } else {
          context.fillStyle = palette.foreground;
          context.fillRect(centre - 2, top - HEAD_RADIUS - 3.5, 4, 1.5);
        }
      }
      hits.push({
        x0: centre - HEAD_RADIUS - 2,
        x1: centre + HEAD_RADIUS + 2,
        y0: top - HEAD_RADIUS - 3,
        y1: top + HEAD_RADIUS + 3,
        variants: group.variants,
      });
    }
  };

  const drawPopulation = (row: Row) => {
    if (pxPerResidue < BIN_BELOW_PX) {
      drawBins(row, population, false);
      return;
    }
    const radius = 3;
    for (const group of visibleGroups(population)) {
      const lead = group.variants[0];
      const centre = x(group.position) + pxPerResidue / 2;
      const bottom = row.y + frequencyDepth(lead.alleleFrequency);
      const selected = group.variants.some(
        (variant) => variant.id === selectedVariantId,
      );
      context.strokeStyle = selected
        ? palette.foreground
        : palette.borderStrong;
      context.lineWidth = 1;
      context.setLineDash(lead.alleleFrequency ? [] : [2, 2]);
      context.beginPath();
      context.moveTo(centre, row.y);
      context.lineTo(centre, bottom);
      context.stroke();
      context.setLineDash([]);
      drawHead(context, palette, lead, centre, bottom, radius, selected);
      if (group.variants.length > 1 && pxPerResidue >= COUNT_LABEL_MIN_PX) {
        context.font = `600 10px ${palette.mono}`;
        context.textAlign = "left";
        context.fillStyle = palette.foreground;
        context.fillText(
          String(group.variants.length),
          centre + radius + 1.5,
          bottom + 3,
        );
      }
      hits.push({
        x0: centre - radius - 2,
        x1: centre + radius + 2,
        y0: bottom - radius - 3,
        y1: bottom + radius + 3,
        variants: group.variants,
      });
    }
  };

  const drawAxisRow = (row: Row) => {
    // a rail: clinical lollipops stand on the top line, population ones hang from the bottom line
    const baseline = row.y + 0.5;
    const lower = row.y + row.height - 0.5;
    const step =
      TICK_STEPS.find((candidate) => candidate * pxPerResidue >= 56) ?? 5000;
    const minor = step >= 10 ? step / 5 : step >= 5 ? 1 : 0;
    context.strokeStyle = palette.borderStrong;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(Math.max(0, x(1)), baseline);
    context.lineTo(Math.min(width, x(length + 1)), baseline);
    context.moveTo(Math.max(0, x(1)), lower);
    context.lineTo(Math.min(width, x(length + 1)), lower);
    context.stroke();
    if (minor > 0 && minor * pxPerResidue >= 4) {
      context.beginPath();
      for (
        let position = Math.ceil(first / minor) * minor;
        position <= last;
        position += minor
      ) {
        const centre = Math.round(x(position) + pxPerResidue / 2) + 0.5;
        context.moveTo(centre, baseline);
        context.lineTo(centre, baseline + 3);
      }
      context.stroke();
    }
    context.font = monoFont;
    context.fillStyle = palette.mutedForeground;
    context.textAlign = "center";
    const ticks = [1];
    for (
      let position = Math.ceil(first / step) * step;
      position <= last;
      position += step
    )
      ticks.push(position);
    context.beginPath();
    for (const position of ticks) {
      if (position < first || position > last) continue;
      if (position === 1 && step !== 1 && step * pxPerResidue < 80) continue;
      const centre = Math.round(x(position) + pxPerResidue / 2) + 0.5;
      context.moveTo(centre, baseline);
      context.lineTo(centre, baseline + 5);
      const text = String(position);
      const half = context.measureText(text).width / 2;
      context.fillText(
        text,
        Math.min(width - half - 1, Math.max(half + 1, centre)),
        row.y + 10.5,
      );
    }
    context.stroke();
    if (pxPerResidue >= LETTER_MIN_PX) {
      const letterY = row.y + 22;
      for (let position = first; position <= last; position += 1) {
        const selected = selectedAt(position);
        const centre = x(position) + pxPerResidue / 2;
        context.font = selected ? `600 11px ${palette.mono}` : monoFont;
        context.fillStyle = palette.foreground;
        context.fillText(sequence[position - 1], centre, letterY);
        if (selected) {
          context.fillRect(centre - 3, row.y + row.height - 3, 6, 1);
        }
      }
    }
  };

  const drawStrip = (row: Row, track: SequenceTrack) => {
    const values = track.values ?? [];
    const top = row.y + 3;
    const stripHeight = row.height - 6;
    const amColours = new Map<number, string>();
    const colourOf = (value: number): string => {
      if (track.kind === "confidence") return plddtBand(value).hex;
      const key = Math.round(value * 100);
      let colour = amColours.get(key);
      if (!colour) {
        colour = alphaMissenseColor(key / 100);
        amColours.set(key, colour);
      }
      return colour;
    };
    const drawCell = (left: number, cellWidth: number, value: number) => {
      if (track.kind === "conservation") {
        const bar = Math.max(1, Math.min(1, Math.max(0, value)) * stripHeight);
        context.fillStyle = palette.mutedForeground;
        context.fillRect(left, top + stripHeight - bar, cellWidth, bar);
      } else {
        context.fillStyle = colourOf(value);
        context.fillRect(left, top, cellWidth, stripHeight);
      }
    };
    if (pxPerResidue >= 3) {
      const gap = pxPerResidue >= 6 ? 1 : 0;
      for (let position = first; position <= last; position += 1) {
        const value = values[position - 1];
        if (value === null || value === undefined) continue;
        const left = x(position);
        drawCell(left, pxPerResidue - gap, value);
        if (track.kind === "confidence" && pxPerResidue >= BAND_LETTER_MIN_PX) {
          const band = plddtBand(value);
          context.font = `600 10px ${palette.mono}`;
          context.textAlign = "center";
          context.fillStyle = band.onFill === "white" ? "#ffffff" : INK_ON_FILL;
          context.fillText(
            band.code,
            left + (pxPerResidue - gap) / 2,
            top + stripHeight / 2 + 0.5,
          );
        } else if (track.kind === "pathogenicity" && pxPerResidue >= 20) {
          context.font = `500 10px ${palette.mono}`;
          context.textAlign = "center";
          context.fillStyle =
            value < 0.12 || value > 0.86 ? "#ffffff" : INK_ON_FILL;
          context.fillText(
            value.toFixed(2).slice(1),
            left + (pxPerResidue - gap) / 2,
            top + stripHeight / 2 + 0.5,
          );
        }
      }
    } else {
      const from = Math.max(0, Math.floor(x(1)));
      const to = Math.min(width, Math.ceil(x(length + 1)));
      for (let pixel = from; pixel < to; pixel += 1) {
        const startIndex = Math.floor(view.start + pixel / pxPerResidue);
        const endIndex = Math.max(
          startIndex + 1,
          Math.floor(view.start + (pixel + 1) / pxPerResidue),
        );
        let sum = 0;
        let count = 0;
        for (
          let index = Math.max(0, startIndex);
          index < Math.min(length, endIndex);
          index += 1
        ) {
          const value = values[index];
          if (value === null || value === undefined) continue;
          sum += value;
          count += 1;
        }
        if (count > 0) drawCell(pixel, 1, sum / count);
      }
    }
    if (track.kind !== "conservation") {
      const left = Math.max(-1, x(1));
      const right = Math.min(width + 1, x(length + 1));
      context.strokeStyle = palette.borderStrong;
      context.lineWidth = 1;
      context.strokeRect(
        Math.round(left) + 0.5,
        top - 0.5,
        Math.round(right - left) - 1,
        stripHeight + 1,
      );
    }
  };

  const drawCoverage = (row: Row) => {
    (row.lanes ?? []).forEach((lane, index) => {
      const top = row.y + 2 + index * COVERAGE_LANE + 2;
      const barHeight = COVERAGE_LANE - 5;
      for (const range of lane.merged) {
        if (range.end < first || range.start > last) continue;
        const left = Math.max(-2, x(range.start));
        const right = Math.min(width + 2, x(range.end + 1));
        const barWidth = Math.max(1, right - left);
        if (lane.origin === "experimental") {
          context.fillStyle = palette.foreground;
          context.globalAlpha = 0.78;
          context.fillRect(left, top, barWidth, barHeight);
          context.globalAlpha = 1;
        } else if (lane.origin === "predicted_external") {
          context.save();
          context.beginPath();
          context.rect(left, top, barWidth, barHeight);
          context.clip();
          context.strokeStyle = palette.mutedForeground;
          context.lineWidth = 1;
          context.beginPath();
          for (
            let offset = left - barHeight;
            offset < right + barHeight;
            offset += 4
          ) {
            context.moveTo(offset, top + barHeight);
            context.lineTo(offset + barHeight, top);
          }
          context.stroke();
          context.restore();
          context.strokeStyle = palette.mutedForeground;
          context.lineWidth = 1;
          context.strokeRect(
            left + 0.5,
            top + 0.5,
            barWidth - 1,
            barHeight - 1,
          );
        } else {
          context.strokeStyle = palette.foreground;
          context.lineWidth = 1.5;
          context.setLineDash([1.5, 2.5]);
          context.strokeRect(
            left + 0.5,
            top + 0.5,
            barWidth - 1,
            barHeight - 1,
          );
          context.setLineDash([]);
        }
      }
    });
  };

  const drawSecondaryStructure = (row: Row) => {
    const middle = row.y + row.height / 2;
    for (const { feature } of row.features ?? []) {
      if (feature.end < first || feature.start > last) continue;
      const left = x(feature.start);
      const right = x(feature.end + 1);
      const featureWidth = Math.max(1, right - left);
      if (feature.secondaryStructure === "helix") {
        context.fillStyle = palette.mutedForeground;
        context.beginPath();
        context.roundRect(left, middle - 5, featureWidth, 10, 3);
        context.fill();
      } else if (feature.secondaryStructure === "strand") {
        const head = Math.min(6, featureWidth);
        context.fillStyle = palette.foreground;
        context.fillRect(left, middle - 2.5, featureWidth - head, 5);
        context.beginPath();
        context.moveTo(right - head, middle - 5);
        context.lineTo(right, middle);
        context.lineTo(right - head, middle + 5);
        context.closePath();
        context.fill();
      } else {
        context.strokeStyle = palette.borderStrong;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(left, middle);
        context.lineTo(right, middle);
        context.stroke();
      }
    }
  };

  const drawFeatures = (row: Row, track: SequenceTrack) => {
    context.font = sansFont;
    context.textAlign = "left";
    for (const { feature, lane } of row.features ?? []) {
      if (feature.end < first || feature.start > last) continue;
      const top = row.y + 2 + lane * LANE_HEIGHT;
      const boxHeight = LANE_HEIGHT - 3;
      const left = x(feature.start);
      const right = x(feature.end + 1);
      const predicted =
        (feature.evidenceClass ?? track.evidenceClass) ===
          "computational_prediction" ||
        (feature.evidenceClass ?? track.evidenceClass) ===
          "orphafold_hypothesis";
      if (track.kind === "site") {
        const centre = (left + right) / 2;
        const half = Math.max(3, Math.min(5, (right - left) / 2));
        if (feature.end > feature.start && right - left > 10) {
          context.fillStyle = palette.foreground;
          context.fillRect(left, top + boxHeight / 2 - 1.5, right - left, 3);
        }
        context.beginPath();
        context.moveTo(centre, top);
        context.lineTo(centre + half, top + boxHeight / 2);
        context.lineTo(centre, top + boxHeight);
        context.lineTo(centre - half, top + boxHeight / 2);
        context.closePath();
        context.fillStyle = predicted ? palette.background : palette.foreground;
        context.fill();
        context.strokeStyle = palette.foreground;
        context.lineWidth = 1;
        context.setLineDash(predicted ? [2, 1.5] : []);
        context.stroke();
        context.setLineDash([]);
        continue;
      }
      const clippedLeft = Math.max(-2, left);
      const clippedRight = Math.min(width + 2, right);
      const boxWidth = Math.max(1.5, clippedRight - clippedLeft);
      if (track.kind !== "region") {
        context.fillStyle = palette.muted;
        context.fillRect(clippedLeft, top, boxWidth, boxHeight);
      }
      context.strokeStyle = palette.borderStrong;
      context.lineWidth = 1;
      context.setLineDash(predicted ? [3, 2] : []);
      context.strokeRect(
        clippedLeft + 0.5,
        top + 0.5,
        Math.max(1, boxWidth - 1),
        boxHeight - 1,
      );
      context.setLineDash([]);
      const text = feature.label ?? feature.description;
      if (text && boxWidth >= 22) {
        context.save();
        context.beginPath();
        context.rect(clippedLeft + 2, top, boxWidth - 4, boxHeight);
        context.clip();
        context.fillStyle = palette.foreground;
        context.fillText(
          text,
          Math.max(clippedLeft, 0) + 4,
          top + boxHeight / 2 + 0.5,
        );
        context.restore();
      }
    }
  };

  for (const row of rows) {
    if (row.kind === "clinical") drawClinical(row);
    else if (row.kind === "axis") drawAxisRow(row);
    else if (row.kind === "population") drawPopulation(row);
    else if (row.track) {
      const track = row.track;
      if (!trackHasData(track)) {
        const status = track.status;
        const name = status?.name ?? status?.source ?? "source";
        context.font = sansFont;
        context.textAlign = "left";
        context.fillStyle = palette.subtleForeground;
        context.fillText(
          status?.state === "empty"
            ? `No ${track.label} record in ${name}`
            : `${name} unavailable${status?.message ? `: ${status.message}` : ""}`,
          6,
          row.y + row.height / 2,
        );
      } else if (track.kind === "coverage") drawCoverage(row);
      else if (track.kind === "secondary_structure")
        drawSecondaryStructure(row);
      else if (
        track.kind === "confidence" ||
        track.kind === "pathogenicity" ||
        track.kind === "conservation"
      )
        drawStrip(row, track);
      else drawFeatures(row, track);
      context.fillStyle = palette.borderSubtle;
      context.fillRect(0, row.y + row.height - 1, width, 1);
    }
  }
  return hits;
}

export interface OverviewInput {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  palette: Palette;
  length: number;
  domains: SequenceFeature[];
  clinical: PositionGroup[];
  selection: ResidueRange[];
}

/** Whole-protein strip: domain blocks, one tick per position with a clinical variant, selection marks. */
export function drawOverview({
  context,
  width,
  height,
  palette,
  length,
  domains,
  clinical,
  selection,
}: OverviewInput): void {
  const scale = width / length;
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.borderStrong;
  context.fillRect(0, height - 5.5, width, 1);
  for (const feature of domains) {
    const left = (feature.start - 1) * scale;
    const featureWidth = Math.max(1, (feature.end - feature.start + 1) * scale);
    context.fillStyle = palette.muted;
    context.fillRect(left, height - 9, featureWidth, 7);
    context.strokeStyle = palette.borderStrong;
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, height - 8.5, featureWidth - 1, 6);
  }
  context.fillStyle = palette.mutedForeground;
  for (const group of clinical) {
    context.fillRect(Math.round((group.position - 0.5) * scale), 2, 1, 5);
  }
  context.fillStyle = palette.foreground;
  context.globalAlpha = 0.4;
  for (const range of selection) {
    context.fillRect(
      (range.start - 1) * scale,
      0,
      Math.max(2, (range.end - range.start + 1) * scale),
      height,
    );
  }
  context.globalAlpha = 1;
}
