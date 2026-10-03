/**
 * Contract for the 3D viewer. The Mol* specialist replaces the implementation in this directory and
 * keeps every exported name. This file must stay free of Mol* imports so pages can import it statically.
 * Interface source: docs/research/molstar-recipes.md, section 5.
 */
import type { Ref } from "react";

import type { StructureOrigin } from "@/lib/structure-origin";

export type { StructureOrigin };

/** "mmcif" covers text mmCIF and BinaryCIF; set `isBinary` for .bcif */
export type StructureFormat = "mmcif" | "pdb";

export type StructureSource =
  | {
      kind: "url";
      url: string;
      format: StructureFormat;
      isBinary?: boolean;
      label?: string;
    }
  | {
      kind: "data";
      data: string | ArrayBuffer | Uint8Array<ArrayBuffer>;
      format: StructureFormat;
      label?: string;
    };

export type RepresentationKind =
  "cartoon" | "molecular-surface" | "ball-and-stick" | "spacefill";

/** Viewer-level colour mode. `plddt` is legal only for predicted structures. */
export type ViewerColorMode =
  | { kind: "chain" }
  | { kind: "secondary-structure" }
  | { kind: "plddt" }
  | { kind: "b-factor"; domain?: [number, number] }
  | { kind: "element" }
  | { kind: "uniform"; color: number }
  | { kind: "residue-data"; datasetId: string; version: number };

/** Per-residue colours computed in app code from data that carries source IDs. */
export interface ResidueColorDataset {
  /** which identifiers the keys use: label_asym_id + label_seq_id, or auth_asym_id + auth_seq_id */
  numbering: "label" | "auth";
  /** key `${asymId}:${seqId}`, value 0xRRGGBB */
  colors: ReadonlyMap<string, number>;
  /** colour for residues without a value */
  fallback: number;
}

/** A residue range on one chain of one loaded structure. */
export interface ViewerResidueRange {
  /** label_asym_id, or auth_asym_id when numbering is "auth" */
  chain: string;
  start: number;
  end?: number;
  numbering?: "label" | "auth";
}

export interface ResiduePick {
  /** state ref of the structure node the pick belongs to */
  structureRef: string | undefined;
  entryId: string;
  labelAsymId: string;
  authAsymId: string;
  labelSeqId: number;
  authSeqId: number;
  insertionCode: string;
  compId: string;
  atomName: string;
  bFactor: number;
}

export interface PickInfo {
  button: "primary" | "secondary" | "other";
  shift: boolean;
}

export interface LigandSelector {
  compId: string;
  authAsymId?: string;
  authSeqId?: number;
}

export interface BindingSiteResidue {
  labelAsymId: string;
  authAsymId: string;
  labelSeqId: number;
  authSeqId: number;
  compId: string;
}

export interface SuperpositionResult {
  method: "sequence-ca" | "tm-align";
  /** C-alpha RMSD in ångström over the aligned residue pairs */
  rmsd: number;
  alignedResidues: number;
  referenceCaCount: number;
  mobileCaCount: number;
  alignmentScore?: number;
  tmScoreReference?: number;
  tmScoreMobile?: number;
  /** column-major 4x4 to apply to the mobile structure */
  transform: number[];
}

export interface ViewerTheme {
  background: number;
  highlight: number;
  select: number;
  /** dark silhouette lines; keeps pale colours readable on a white canvas */
  outline?: boolean;
}

export type PerformanceProfile = "quality" | "balanced" | "fast";

/** Plain camera description, structurally compatible with a Mol* camera snapshot. */
export interface CameraState {
  mode: "perspective" | "orthographic";
  position: ArrayLike<number>;
  target: ArrayLike<number>;
  up: ArrayLike<number>;
  radius: number;
  radiusMax: number;
  fov: number;
}

export interface StructureDescriptor {
  /** stable structure ID: "pdb:1YVL", "afdb:AF-P42224-F1", "of:<job_id>" */
  id: string;
  source: StructureSource;
  /** drives the corner tag and which colour modes are legal */
  origin: StructureOrigin;
  assemblyId?: string;
  representation?: RepresentationKind;
  colorMode?: ViewerColorMode;
}

export interface SuperposeOptions {
  referenceId: string;
  referenceChain: string;
  mobileChain: string;
  numbering?: "label" | "auth";
  method?: "sequence-ca" | "tm-align";
}

export interface MolecularViewerHandle {
  /** resolves once WebGL is up, rejects when the context cannot be created */
  readonly ready: Promise<void>;

  load(descriptor: StructureDescriptor): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  list(): string[];

  setRepresentation(id: string, kind: RepresentationKind): Promise<void>;
  /** throws for { kind: "plddt" } on an experimental structure */
  setColorMode(id: string, mode: ViewerColorMode): Promise<void>;
  /** registers or replaces per-residue colours (domains, variant impact, difference values) and shows them */
  setResidueColors(id: string, dataset: ResidueColorDataset): Promise<void>;
  setVisibility(id: string, visible: boolean): void;
  setOpacity(id: string, alpha: number): Promise<void>;

  /** null clears */
  highlight(id: string, ranges: ViewerResidueRange[] | null): void;
  /** null clears */
  select(id: string, ranges: ViewerResidueRange[] | null): void;
  focus(
    id: string,
    ranges: ViewerResidueRange[],
    options?: { durationMs?: number; extraRadius?: number },
  ): void;

  showBindingSite(
    id: string,
    ligand: LigandSelector,
    radius?: number,
  ): Promise<BindingSiteResidue[]>;
  hideBindingSite(id: string): Promise<void>;
  addLabel(
    id: string,
    range: ViewerResidueRange,
    text: string,
  ): Promise<string | undefined>;
  removeLabel(labelId: string): Promise<void>;

  /** overlay: moves `mobileId` onto the reference and returns RMSD and aligned residue count */
  superpose(
    mobileId: string,
    options: SuperposeOptions,
  ): Promise<SuperpositionResult>;
  clearSuperposition(mobileId: string): Promise<void>;

  resetCamera(durationMs?: number): void;
  getCamera(): CameraState | undefined;
  /** `radiusMax` of the given state is ignored; duration 0 applies immediately */
  setCamera(state: CameraState, durationMs?: number): void;
  /** fires once per distinct camera state, drags included; returns unsubscribe */
  onCameraChange(listener: (state: CameraState) => void): () => void;
  /** split view: two-way camera lock with another viewer; returns unlink */
  syncCameraWith(other: MolecularViewerHandle): () => void;

  /** resolves once queued operations, scene commits and camera transitions have been applied */
  settled(): Promise<void>;
  setTheme(theme: ViewerTheme): void;
  setReducedMotion(reduced: boolean): void;
  setPerformanceProfile(profile: PerformanceProfile): void;
  /** PNG blob; viewport size unless width and height are given */
  screenshot(options?: {
    width?: number;
    height?: number;
    transparent?: boolean;
  }): Promise<Blob>;
}

export interface MolecularViewerProps {
  ref?: Ref<MolecularViewerHandle>;
  /** defaults to the canvas theme for the current app theme */
  theme?: ViewerTheme;
  reducedMotion?: boolean;
  className?: string;
  /** text description of what the viewport shows, for screen readers */
  ariaLabel: string;
  onHover?: (pick: ResiduePick | undefined) => void;
  onClick?: (pick: ResiduePick | undefined, info: PickInfo) => void;
  onError?: (error: Error) => void;
}
