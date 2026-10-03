import { formatProteinChange, parseProteinChange } from "@/lib/ids";
import {
  COLOR_MODES,
  COMPARE_MODES,
  REPRESENTATIONS,
  SELECTION_DEFAULTS,
  normalizeRange,
  type ColorMode,
  type CompareMode,
  type Representation,
  type ResidueRange,
  type WorkspaceSelection,
} from "@/lib/state/selection";

/**
 * URL contract for the workspace selection. A parameter is written only when it differs from its
 * default, so a bare path is always the default view.
 *
 *   sel    selected residues       165 | 150-180 | 28,150-180
 *   var    selected variant        p.Arg28His (optionally p.Arg28His@VCV000011393)
 *   s      active structure        pdb:1BF5 | afdb:AF-P42224-F1 | of:<job_id>
 *   chain  chain in focus          A
 *   win    sequence axis window    150-180
 *   iso    isoform                 P42224-2
 *   color  colour mode             confidence | chain | domain | secondary-structure | alphamissense | reference-variant
 *   rep    representation          surface | ball-and-stick      (default cartoon)
 *   mode   compare mode            overlay | difference          (default split)
 */
export const SELECTION_PARAM_KEYS = [
  "sel",
  "var",
  "s",
  "chain",
  "win",
  "iso",
  "color",
  "rep",
  "mode",
] as const;

type SelectionSnapshot = Omit<WorkspaceSelection, "accession">;

const formatRange = (range: ResidueRange) =>
  range.start === range.end
    ? String(range.start)
    : `${range.start}-${range.end}`;

function parseRange(value: string): ResidueRange | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (start < 1 || end < 1) return null;
  return normalizeRange({ start, end });
}

const oneOf = <Value extends string>(
  allowed: readonly Value[],
  value: string | null,
): Value | null =>
  value !== null && (allowed as readonly string[]).includes(value)
    ? (value as Value)
    : null;

/** Serialises the non-default part of a selection. Keys are emitted in a fixed order. */
export function selectionToParams(
  selection: SelectionSnapshot,
): URLSearchParams {
  const params = new URLSearchParams();
  if (selection.ranges.length > 0)
    params.set("sel", selection.ranges.map(formatRange).join(","));
  if (selection.variant) {
    const change = formatProteinChange(selection.variant);
    params.set(
      "var",
      selection.variant.sourceId
        ? `${change}@${selection.variant.sourceId}`
        : change,
    );
  }
  if (selection.structureId) params.set("s", selection.structureId);
  if (selection.chain) params.set("chain", selection.chain);
  if (selection.window) params.set("win", formatRange(selection.window));
  if (selection.isoform) params.set("iso", selection.isoform);
  if (selection.colorMode) params.set("color", selection.colorMode);
  if (selection.representation !== SELECTION_DEFAULTS.representation)
    params.set("rep", selection.representation);
  if (selection.compareMode !== SELECTION_DEFAULTS.compareMode)
    params.set("mode", selection.compareMode);
  return params;
}

/** Reads a selection from URL parameters. Absent or malformed parameters fall back to defaults. */
export function selectionFromParams(
  params: URLSearchParams,
): SelectionSnapshot {
  const ranges = (params.get("sel") ?? "")
    .split(",")
    .map(parseRange)
    .filter((range): range is ResidueRange => range !== null);

  let variant: SelectionSnapshot["variant"] = null;
  const rawVariant = params.get("var");
  if (rawVariant) {
    const [change, sourceId] = rawVariant.split("@");
    const parsed = parseProteinChange(change);
    if (parsed) variant = { ...parsed, sourceId: sourceId || null };
  }

  const rawWindow = params.get("win");
  return {
    isoform: params.get("iso") || null,
    ranges,
    variant,
    structureId: params.get("s") || null,
    chain: params.get("chain") || null,
    window: rawWindow ? parseRange(rawWindow) : null,
    colorMode: oneOf<ColorMode>(COLOR_MODES, params.get("color")),
    representation:
      oneOf<Representation>(REPRESENTATIONS, params.get("rep")) ??
      SELECTION_DEFAULTS.representation,
    compareMode:
      oneOf<CompareMode>(COMPARE_MODES, params.get("mode")) ??
      SELECTION_DEFAULTS.compareMode,
  };
}

/**
 * Merges the selection into an existing query string, leaving parameters owned by the page
 * (filters, sort, tabs) untouched. Returns the query without a leading "?".
 */
export function mergeSelectionIntoQuery(
  currentQuery: string,
  selection: SelectionSnapshot,
): string {
  const merged = new URLSearchParams(currentQuery);
  SELECTION_PARAM_KEYS.forEach((key) => merged.delete(key));
  selectionToParams(selection).forEach((value, key) => merged.set(key, value));
  // Colons and commas are legal in a query and keep structure IDs readable.
  return merged
    .toString()
    .replace(/%3A/gi, ":")
    .replace(/%2C/gi, ",")
    .replace(/%40/gi, "@");
}

/** The selection part of a query string, canonicalised, for change detection. */
export function selectionSignature(query: string): string {
  return selectionToParams(
    selectionFromParams(new URLSearchParams(query)),
  ).toString();
}

/** Appends the current selection to a path so context survives a move between stages. */
export function withSelection(
  path: string,
  selection: SelectionSnapshot,
): string {
  const query = mergeSelectionIntoQuery("", selection);
  return query ? `${path}?${query}` : path;
}
