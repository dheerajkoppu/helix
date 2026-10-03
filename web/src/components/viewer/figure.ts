/**
 * Figure export: burns the structure-origin tags, the legend of the active colour mode, the model
 * version and the research-use line into the PNG, so a figure cannot leave the app without its
 * provenance. No Mol* imports.
 */
import {
  STRUCTURE_ORIGIN_META,
  type StructureOrigin,
} from "@/lib/structure-origin";

import type { ViewerLegendSpec } from "./colorings";
import { colorToHex } from "./palette";
import { VIEWER_THEMES } from "./theme";
import type { StructureSource } from "./types";

export const RESEARCH_USE_LINE =
  "OrphaFold research software. For research use only, not for clinical decisions.";

export interface FigureStructure {
  /** "A" or "B" in a comparison */
  slot?: string;
  id: string;
  origin: StructureOrigin;
  /** "X-ray 2.40 Å", "AlphaFold DB v6" */
  detail?: string;
  /** model name and version, or the experimental method, as supplied by the source record */
  modelVersion?: string;
}

export interface FigureAnnotation {
  structures: FigureStructure[];
  legends: ViewerLegendSpec[];
  /** superposition readout, numbering reference, selection */
  notes: string[];
  /** canvas background the image was rendered on */
  background: number;
}

const DASH: Record<StructureOrigin, number[]> = {
  experimental: [],
  predicted_external: [4, 2],
  predicted_orphafold: [1, 2],
};

function fontFamilies(): { sans: string; mono: string } {
  const sans = getComputedStyle(document.body).fontFamily || "sans-serif";
  const mono =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim() || "ui-monospace, monospace";
  return { sans, mono };
}

/** Returns a PNG with a provenance block under the image and the origin tags inside it. */
export async function composeFigure(
  image: Blob,
  annotation: FigureAnnotation,
): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const unit = Math.max(1, bitmap.width / 960);
  const size = Math.round(12 * unit);
  const line = Math.round(20 * unit);
  const pad = Math.round(12 * unit);
  const { sans, mono } = fontFamilies();
  const dark = annotation.background === VIEWER_THEMES.dark.background;
  const ground = colorToHex(annotation.background);
  const ink = colorToHex(
    dark ? VIEWER_THEMES.dark.select : VIEWER_THEMES.light.select,
  );

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw the figure");
  const text = (weight: number, family: string) =>
    (context.font = `${weight} ${size}px ${family}`);

  // legend items wrap, so lay them out before sizing the canvas
  text(400, sans);
  const swatch = Math.round(10 * unit);
  const legendRows: Array<
    Array<{ label: string; color?: number; code?: string; bold?: boolean }>
  > = [];
  for (const legend of annotation.legends) {
    let row: (typeof legendRows)[number] = [];
    let used = 0;
    const title = legend.note
      ? `${legend.title} (${legend.note})`
      : legend.title;
    const cells = [
      { label: title, bold: true },
      ...legend.items.map((item) => ({
        label: item.detail ? `${item.label} ${item.detail}` : item.label,
        color: item.color,
        code: item.code,
      })),
    ];
    for (const cell of cells) {
      text("bold" in cell ? 600 : 400, sans);
      const printed =
        "code" in cell && cell.code ? `${cell.code} ${cell.label}` : cell.label;
      const width =
        context.measureText(printed).width +
        ("color" in cell ? swatch + 6 * unit : 0) +
        14 * unit;
      if (used + width > bitmap.width - pad * 2 && row.length > 0) {
        legendRows.push(row);
        row = [];
        used = 0;
      }
      row.push(cell);
      used += width;
    }
    legendRows.push(row);
  }

  const structureLines = annotation.structures.length;
  const footerLines =
    structureLines + legendRows.length + annotation.notes.length + 1;
  const footer = pad * 2 + footerLines * line;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height + footer;

  context.fillStyle = ground;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  context.strokeStyle = ink;
  context.globalAlpha = 0.35;
  context.lineWidth = Math.max(1, Math.round(unit));
  context.beginPath();
  context.moveTo(0, bitmap.height + 0.5);
  context.lineTo(canvas.width, bitmap.height + 0.5);
  context.stroke();
  context.globalAlpha = 1;
  context.textBaseline = "middle";

  const drawTag = (structure: FigureStructure, x: number, y: number) => {
    const meta = STRUCTURE_ORIGIN_META[structure.origin];
    let cursor = x;
    context.fillStyle = ink;
    if (structure.slot) {
      text(600, mono);
      context.fillText(structure.slot, cursor, y);
      cursor += context.measureText(structure.slot).width + 6 * unit;
    }
    text(600, mono);
    const tagWidth = context.measureText(meta.tag).width + 8 * unit;
    const tagHeight = Math.round(16 * unit);
    context.setLineDash(DASH[structure.origin].map((dash) => dash * unit));
    context.strokeRect(
      Math.round(cursor) + 0.5,
      Math.round(y - tagHeight / 2) + 0.5,
      Math.round(tagWidth),
      tagHeight,
    );
    context.setLineDash([]);
    context.fillText(meta.tag, cursor + 4 * unit, y);
    cursor += tagWidth + 8 * unit;
    const id = structure.id;
    context.fillText(id, cursor, y);
    cursor += context.measureText(id).width + 8 * unit;
    text(400, sans);
    const rest = [meta.caption, structure.detail, structure.modelVersion]
      .filter(Boolean)
      .join(" · ");
    context.globalAlpha = 0.75;
    context.fillText(rest, cursor, y);
    context.globalAlpha = 1;
    return cursor + context.measureText(rest).width;
  };

  // inside the image, so cropping the footer does not remove the class of the structure
  annotation.structures.forEach((structure, index) => {
    const y = pad + line / 2 + index * line;
    text(600, mono);
    const meta = STRUCTURE_ORIGIN_META[structure.origin];
    const label = `${structure.slot ? `${structure.slot} ` : ""}${meta.tag} ${structure.id} ${meta.caption}`;
    const width = context.measureText(label).width + 40 * unit;
    context.fillStyle = ground;
    context.globalAlpha = 0.85;
    context.fillRect(pad / 2, y - line / 2, width, line);
    context.globalAlpha = 1;
    drawTag(
      { ...structure, detail: undefined, modelVersion: undefined },
      pad,
      y,
    );
  });

  let y = bitmap.height + pad + line / 2;
  for (const structure of annotation.structures) {
    drawTag(structure, pad, y);
    y += line;
  }
  for (const row of legendRows) {
    let x = pad;
    for (const cell of row) {
      if (cell.color !== undefined) {
        context.fillStyle = colorToHex(cell.color);
        context.fillRect(x, y - swatch / 2, swatch, swatch);
        context.globalAlpha = 0.6;
        context.strokeRect(x + 0.5, y - swatch / 2 + 0.5, swatch, swatch);
        context.globalAlpha = 1;
        x += swatch + 6 * unit;
      }
      context.fillStyle = ink;
      text(cell.bold ? 600 : 400, sans);
      const label = cell.code ? `${cell.code} ${cell.label}` : cell.label;
      context.fillText(label, x, y);
      x += context.measureText(label).width + 14 * unit;
    }
    y += line;
  }
  text(400, sans);
  context.fillStyle = ink;
  for (const note of annotation.notes) {
    context.fillText(note, pad, y);
    y += line;
  }
  context.globalAlpha = 0.75;
  context.fillText(
    `${RESEARCH_USE_LINE} Exported ${new Date().toISOString().slice(0, 10)}.`,
    pad,
    y,
  );
  context.globalAlpha = 1;

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode the PNG")),
      "image/png",
    ),
  );
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]+/g, "_");

export function structureFilename(id: string, source: StructureSource): string {
  if (source.kind === "url") {
    const basename = source.url.split("/").pop()?.split("?")[0];
    if (basename && basename.includes(".")) return basename;
  }
  const extension =
    source.format === "pdb"
      ? "pdb"
      : source.kind === "url" && source.isBinary
        ? "bcif"
        : "cif";
  return `${safeName(id)}.${extension}`;
}

/** Saves the coordinate file exactly as the source served it. */
export async function downloadStructure(
  id: string,
  source: StructureSource,
): Promise<string> {
  const filename = structureFilename(id, source);
  if (source.kind === "data") {
    saveBlob(new Blob([source.data]), filename);
    return filename;
  }
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  saveBlob(await response.blob(), filename);
  return filename;
}

export const figureFilename = (ids: string[]) =>
  `orphafold_${ids.map(safeName).join("_vs_")}_${new Date().toISOString().slice(0, 10)}.png`;
