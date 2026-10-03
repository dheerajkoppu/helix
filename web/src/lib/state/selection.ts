import { create } from "zustand";

/** UniProt canonical numbering, 1-based, inclusive. A single residue is `{ start: n, end: n }`. */
export interface ResidueRange {
  start: number;
  end: number;
}

export interface SelectedVariant {
  /** one-letter amino-acid codes */
  reference: string;
  position: number;
  alternate: string;
  /** source record for the variant, e.g. a ClinVar VCV accession; null when typed by hand */
  sourceId: string | null;
}

export const COLOR_MODES = [
  "confidence",
  "chain",
  "domain",
  "secondary-structure",
  "alphamissense",
  "reference-variant",
] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const REPRESENTATIONS = [
  "cartoon",
  "surface",
  "ball-and-stick",
] as const;
export type Representation = (typeof REPRESENTATIONS)[number];

export const COMPARE_MODES = ["split", "overlay", "difference"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** The one selection every zone reads and writes. Persistent, and mirrored into the URL. */
export interface WorkspaceSelection {
  /** UniProt accession the residue numbers refer to */
  accession: string | null;
  /** e.g. "P42224-2"; null means the canonical isoform */
  isoform: string | null;
  ranges: ResidueRange[];
  variant: SelectedVariant | null;
  /** "pdb:1BF5" | "afdb:AF-P42224-F1" | "of:<job_id>" */
  structureId: string | null;
  /** label_asym_id of the chain in focus */
  chain: string | null;
  /** visible window of the sequence axis; null shows the whole protein */
  window: ResidueRange | null;
  /** null follows the structure origin: confidence for predictions, chain for experimental */
  colorMode: ColorMode | null;
  representation: Representation;
  compareMode: CompareMode;
}

export const SELECTION_DEFAULTS: WorkspaceSelection = {
  accession: null,
  isoform: null,
  ranges: [],
  variant: null,
  structureId: null,
  chain: null,
  window: null,
  colorMode: null,
  representation: "cartoon",
  compareMode: "split",
};

export interface WorkspaceSelectionActions {
  /** Binds the protein the numbering refers to. Moving to a different protein clears residue-level state. */
  bindAccession: (accession: string | null) => void;
  selectResidue: (position: number) => void;
  selectRange: (range: ResidueRange) => void;
  /** Cmd/Ctrl+click: adds a range, or removes it when already selected */
  toggleRange: (range: ResidueRange) => void;
  setRanges: (ranges: ResidueRange[]) => void;
  clearResidues: () => void;
  /** Selecting a variant also selects its residue. Null clears the variant and keeps the residue. */
  selectVariant: (variant: SelectedVariant | null) => void;
  setStructure: (structureId: string | null, chain?: string | null) => void;
  setIsoform: (isoform: string | null) => void;
  setWindow: (window: ResidueRange | null) => void;
  setColorMode: (colorMode: ColorMode | null) => void;
  setRepresentation: (representation: Representation) => void;
  setCompareMode: (compareMode: CompareMode) => void;
  /** Applies a partial selection read from the URL */
  hydrate: (partial: Partial<WorkspaceSelection>) => void;
  /** Esc: clears residues and variant, keeps structure and view settings */
  clear: () => void;
}

export function normalizeRange(range: ResidueRange): ResidueRange {
  const start = Math.max(1, Math.round(Math.min(range.start, range.end)));
  const end = Math.max(1, Math.round(Math.max(range.start, range.end)));
  return { start, end };
}

const sameRange = (left: ResidueRange, right: ResidueRange) =>
  left.start === right.start && left.end === right.end;

export const useWorkspaceSelection = create<
  WorkspaceSelection & WorkspaceSelectionActions
>()((set) => ({
  ...SELECTION_DEFAULTS,

  bindAccession: (accession) =>
    set((state) => {
      if (state.accession === accession) return state;
      // First binding keeps what the URL supplied; switching protein invalidates residue numbers.
      if (state.accession === null) return { accession };
      return {
        ...SELECTION_DEFAULTS,
        accession,
        representation: state.representation,
        compareMode: state.compareMode,
      };
    }),

  selectResidue: (position) =>
    set({ ranges: [normalizeRange({ start: position, end: position })] }),
  selectRange: (range) => set({ ranges: [normalizeRange(range)] }),
  toggleRange: (range) =>
    set((state) => {
      const next = normalizeRange(range);
      const exists = state.ranges.some((existing) => sameRange(existing, next));
      return {
        ranges: exists
          ? state.ranges.filter((existing) => !sameRange(existing, next))
          : [...state.ranges, next],
      };
    }),
  setRanges: (ranges) => set({ ranges: ranges.map(normalizeRange) }),
  clearResidues: () => set({ ranges: [] }),

  selectVariant: (variant) =>
    set(
      variant
        ? {
            variant,
            ranges: [{ start: variant.position, end: variant.position }],
          }
        : { variant: null },
    ),

  setStructure: (structureId, chain = null) => set({ structureId, chain }),
  setIsoform: (isoform) => set({ isoform }),
  setWindow: (window) =>
    set({ window: window ? normalizeRange(window) : null }),
  setColorMode: (colorMode) => set({ colorMode }),
  setRepresentation: (representation) => set({ representation }),
  setCompareMode: (compareMode) => set({ compareMode }),

  hydrate: (partial) => set(partial),
  clear: () => set({ ranges: [], variant: null }),
}));

/** Read the selection outside React (canvas code, Mol* callbacks). */
export const getWorkspaceSelection = () => useWorkspaceSelection.getState();

/** True when `position` falls inside any selected range. */
export function isResidueSelected(
  ranges: ResidueRange[],
  position: number,
): boolean {
  return ranges.some(
    (range) => position >= range.start && position <= range.end,
  );
}

/** "R28", "150-180" or "3 ranges": the compact readout used in the status line. */
export function describeRanges(
  ranges: ResidueRange[],
  sequence?: string | null,
): string | null {
  if (ranges.length === 0) return null;
  if (ranges.length > 1) return `${ranges.length} ranges`;
  const [range] = ranges;
  if (range.start !== range.end)
    return `${range.start}-${range.end} (${range.end - range.start + 1} aa)`;
  const letter = sequence?.[range.start - 1];
  return letter ? `${letter}${range.start}` : String(range.start);
}

export type StructureOriginLike =
  "experimental" | "predicted_external" | "predicted_internal";

/** Predicted structures default to confidence colouring, experimental ones to chain colouring. */
export function resolveColorMode(
  colorMode: ColorMode | null,
  origin: StructureOriginLike | null,
): ColorMode {
  if (colorMode)
    return colorMode === "confidence" && origin === "experimental"
      ? "chain"
      : colorMode;
  return origin === "experimental" ? "chain" : "confidence";
}
