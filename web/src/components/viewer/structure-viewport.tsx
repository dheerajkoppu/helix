"use client";

import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { toast } from "sonner";
import { cn } from "cn";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { normalizePlddt, PLDDT_BANDS, plddtBand } from "@/lib/science/plddt";
import { setWorkspaceHover, subscribeWorkspaceHover } from "@/lib/state/hover";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  describeRanges,
  resolveColorMode,
  useWorkspaceSelection,
  type ColorMode,
  type ResidueRange,
} from "@/lib/state/selection";
import {
  STRUCTURE_ORIGIN_META,
  type StructureOrigin,
} from "@/lib/structure-origin";

import type {
  ResidueColoring,
  ViewerDomain,
  ViewerLegendSpec,
} from "./colorings";
import {
  composeFigure,
  downloadStructure,
  figureFilename,
  saveBlob,
  structureFilename,
} from "./figure";
import {
  MolecularViewer,
  residueName,
  shortStructureId,
} from "./molecular-viewer";
import {
  NO_VALUE_COLOR,
  SECONDARY_STRUCTURE_COLORS,
  useViewerPalette,
  type ViewerPalette,
} from "./palette";
import {
  defaultResidueMap,
  mapRanges,
  pickPosition,
  toStructureSeq,
  toUniProtPosition,
} from "./residue-map";
import { VIEWER_THEMES, toRepresentationKind, viewerThemeFor } from "./theme";
import type {
  BindingSiteResidue,
  MolecularViewerHandle,
  PickInfo,
  ResidueColorDataset,
  ResidueMap,
  ResiduePick,
  StructureChainSummary,
  StructureSource,
  StructureSummary,
  SuperpositionResult,
} from "./types";
import { ViewerLegend, type ViewerLegendEntry } from "./viewer-legend";
import { ViewerToolbar, type ViewerColorOption } from "./viewer-toolbar";

export interface ViewportStructure {
  /** "pdb:1B55", "afdb:AF-Q06187-F1", "of:<job_id>" */
  id: string;
  source: StructureSource;
  origin: StructureOrigin;
  /** printed after the corner tag: "AlphaFold DB v6", "X-ray 2.40 Å" */
  detail?: string;
  /** printed in the corner tag in place of the ID: "Reference", "Variant" */
  label?: string;
  /** model name and version, or the experimental method, burned into exported figures */
  modelVersion?: string;
  /** label_asym_id of the chain that carries the protein; default is the first polymer chain */
  chain?: string;
  /** UniProt position to structure numbering; see `defaultResidueMap` for the default */
  residueMap?: ResidueMap;
  assemblyId?: string;
  plddtScale?: "0-1" | "0-100";
  /** comparison slot printed before the tag: "A", "B" */
  slot?: string;
  /** loaded as the alignment frame only and never drawn (the reference in the second pane of a split view) */
  frameOnly?: boolean;
}

/** Residues drawn as ball-and-stick: an annotated binding site, pocket residues from a predictor. */
export interface ViewportResidueSet {
  id: string;
  label: string;
  /** UniProt canonical positions */
  positions: number[];
  /** limit the set to one structure; default is every structure shown */
  structureId?: string;
  /** carbon colour; default is element colours */
  color?: number;
}

export interface ViewportLigand {
  structureId: string;
  compId: string;
  authAsymId?: string;
  authSeqId?: number;
  /** contact shell in ångström, default 5 */
  radius?: number;
}

export interface ViewportBindingSiteResidue extends BindingSiteResidue {
  /** UniProt position, null for chains the residue map does not cover */
  position: number | null;
}

export interface ViewportScene {
  summaries: Record<string, StructureSummary>;
  superposition: SuperpositionResult | null;
}

export interface StructureViewportProps {
  /** what the viewport shows, for screen readers: "BTK structure" */
  ariaLabel: string;
  /** UniProt accession the residue numbers refer to; binds the hover channel and the selection */
  accession: string | null;
  /** first is the reference (A). A second one is superposed on it (B). */
  structures: ViewportStructure[];
  /** per-residue colour maps in UniProt numbering, by colour mode. Pass a memoised object. */
  colorings?: Partial<Record<ColorMode, ResidueColoring>>;
  /** regions offered by "Select domain" */
  domains?: ViewerDomain[];
  /** drawn as ball-and-stick with a text label on every structure that covers the position */
  variant?: { position: number; label: string } | null;
  residueSets?: ViewportResidueSet[];
  /** shows the bound component, the residues within `radius` and their contacts */
  ligand?: ViewportLigand | null;
  superposition?: "sequence-ca" | "tm-align";
  /**
   * Set while this viewport's camera is locked to another one with `useCameraLink`. Focus then
   * jumps instead of animating: two linked cameras animating at once cancel each other.
   */
  linkedCamera?: boolean;
  toolbar?: boolean;
  legend?: boolean;
  /** "auto" follows the Advanced preference; "full" always draws every control and status line */
  chrome?: "auto" | "full";
  viewerRef?: Ref<MolecularViewerHandle>;
  onSceneReady?: (scene: ViewportScene) => void;
  onBindingSite?: (residues: ViewportBindingSiteResidue[]) => void;
  /** called with every exported figure, after it has been saved */
  onExport?: (figure: Blob, filename: string) => void;
  className?: string;
}

type EffectiveMode = ColorMode | "structure";

interface SceneState extends ViewportScene {
  key: string;
  superpositionError: string | null;
}

const COLOR_LABEL: Record<EffectiveMode, string> = {
  confidence: "Confidence (pLDDT)",
  chain: "Chain",
  domain: "Domain",
  "secondary-structure": "Secondary structure",
  alphamissense: "Variant impact (predicted)",
  "reference-variant": "Reference vs variant",
  structure: "Structure A / B",
};

const METHOD_LABEL: Record<SuperpositionResult["method"], string> = {
  "sequence-ca": "sequence-aligned Cα least-squares fit",
  "tm-align": "TM-align",
};

const PLDDT_LEGEND: ViewerLegendSpec = {
  title: "Model confidence",
  note: "pLDDT",
  items: PLDDT_BANDS.map((band) => ({
    label: band.label,
    color: band.color,
    code: band.code,
    detail: band.range,
  })),
};

const SECONDARY_STRUCTURE_LEGEND: ViewerLegendSpec = {
  title: "Secondary structure",
  note: "Mol* assignment",
  items: SECONDARY_STRUCTURE_COLORS.map((entry) => ({ ...entry })),
};

const mapOf = (structure: ViewportStructure): ResidueMap =>
  structure.residueMap ?? defaultResidueMap(structure.origin);

const chainOf = (
  structure: ViewportStructure,
  summary: StructureSummary,
): StructureChainSummary | undefined =>
  summary.chains.find((chain) => chain.labelAsymId === structure.chain) ??
  summary.chains[0];

function chainDataset(
  summary: StructureSummary,
  palette: ViewerPalette,
): ResidueColorDataset {
  const colors = new Map<string, number>();
  summary.chains.forEach((chain, index) => {
    const color = palette.chains[index % palette.chains.length];
    for (
      let seqId = chain.labelSeqRange[0];
      seqId <= chain.labelSeqRange[1];
      seqId += 1
    )
      colors.set(`${chain.labelAsymId}:${seqId}`, color);
  });
  return { numbering: "label", colors, fallback: NO_VALUE_COLOR };
}

/** A UniProt-numbered colouring, addressed onto every chain of the mapped protein. */
function coloringDataset(
  coloring: ResidueColoring,
  structure: ViewportStructure,
  summary: StructureSummary,
): ResidueColorDataset {
  const map = mapOf(structure);
  const focus = chainOf(structure, summary);
  const colors = new Map<string, number>();
  for (const chain of summary.chains) {
    if (chain.entityId !== focus?.entityId) continue;
    const asymId =
      map.numbering === "auth" ? chain.authAsymId : chain.labelAsymId;
    coloring.colors.forEach((color, position) => {
      const seqId = toStructureSeq(map, position);
      if (seqId !== null) colors.set(`${asymId}:${seqId}`, color);
    });
  }
  return { numbering: map.numbering, colors, fallback: coloring.fallback };
}

const classCaption = (reference: StructureOrigin, mobile: StructureOrigin) => {
  const referenceMeasured = reference === "experimental";
  const mobileMeasured = mobile === "experimental";
  if (referenceMeasured && mobileMeasured) return null;
  if (!referenceMeasured && !mobileMeasured)
    return "Both structures are predictions.";
  return `Differences include model error. ${referenceMeasured ? "A" : "B"} is measured; ${referenceMeasured ? "B" : "A"} is predicted.`;
};

/**
 * The 3D instrument: Mol* viewport, toolbar and legend, bound to the workspace selection and the
 * hover channel. Residues are addressed in UniProt canonical numbering throughout. Give it one
 * structure, or two for an overlay with superposition; link two viewports with `useCameraLink`
 * for a split view.
 */
export function StructureViewport(props: StructureViewportProps) {
  const {
    ariaLabel,
    accession,
    structures,
    colorings,
    domains,
    variant,
    residueSets,
    ligand,
    linkedCamera = false,
    toolbar = true,
    legend = true,
    chrome = "auto",
    viewerRef,
    className,
  } = props;
  const advanced = useAdvancedMode();
  const simple = chrome === "auto" && !advanced;

  const viewer = useRef<MolecularViewerHandle | null>(null);
  // the child handle is attached before this runs
  useImperativeHandle(
    viewerRef,
    () => viewer.current as MolecularViewerHandle,
    [],
  );

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const colorMode = useWorkspaceSelection((state) => state.colorMode);
  const representation = useWorkspaceSelection((state) => state.representation);

  const { resolvedTheme } = useTheme();
  const canvasTheme = useMemo(
    () => viewerThemeFor(resolvedTheme),
    [resolvedTheme],
  );
  const palette = useViewerPalette();

  const [fitMethod, setFitMethod] = useState<SuperpositionResult["method"]>(
    props.superposition ?? "sequence-ca",
  );
  const [tintChoice, setTintChoice] = useState<boolean | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [scene, setScene] = useState<SceneState | null>(null);

  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const sceneKey = `${structures
    .map(
      (structure) =>
        `${structure.id}|${structure.source.kind === "url" ? structure.source.url : "data"}|${structure.chain ?? ""}|${structure.frameOnly ? "frame" : "shown"}`,
    )
    .join(";")};${fitMethod}`;
  const ready = scene?.key === sceneKey ? scene : null;

  useEffect(() => {
    const handle = viewer.current;
    if (!handle) return;
    const wanted = latest.current.structures;
    let cancelled = false;

    (async () => {
      await handle.ready;
      if (cancelled) return;
      const wantedIds = new Set(wanted.map((structure) => structure.id));
      for (const id of handle.list())
        if (!wantedIds.has(id)) await handle.remove(id);
      for (const structure of wanted) {
        if (cancelled) return;
        if (handle.list().includes(structure.id)) continue;
        // the viewport reports a failed load itself; the other structures still load
        await handle
          .load({
            id: structure.id,
            source: structure.source,
            origin: structure.origin,
            assemblyId: structure.assemblyId,
            detail: structure.detail,
            label: structure.label,
            plddtScale: structure.plddtScale,
            representation: toRepresentationKind(
              useWorkspaceSelection.getState().representation,
            ),
          })
          .catch(() => {});
      }
      if (cancelled) return;

      const summaries: Record<string, StructureSummary> = {};
      for (const structure of wanted) {
        const summary = handle.describe(structure.id);
        if (summary) summaries[structure.id] = summary;
      }

      let superposition: SuperpositionResult | null = null;
      let superpositionError: string | null = null;
      const [reference, mobile] = wanted;
      const referenceChain =
        reference && summaries[reference.id]
          ? chainOf(reference, summaries[reference.id])
          : undefined;
      const mobileChain =
        mobile && summaries[mobile.id]
          ? chainOf(mobile, summaries[mobile.id])
          : undefined;
      if (reference && mobile && referenceChain && mobileChain) {
        try {
          superposition = await handle.superpose(mobile.id, {
            referenceId: reference.id,
            referenceChain: referenceChain.labelAsymId,
            mobileChain: mobileChain.labelAsymId,
            numbering: "label",
            method: fitMethod,
          });
        } catch (error) {
          superpositionError =
            error instanceof Error ? error.message : String(error);
        }
      }
      if (cancelled) return;
      for (const structure of wanted)
        if (summaries[structure.id])
          handle.setVisibility(structure.id, !structure.frameOnly);
      await handle.settled();
      if (cancelled) return;
      // Mol* applies a reset on a later frame; wait for it, or it would undo the focus that follows
      handle.resetCamera(0);
      await handle.settled();
      if (cancelled) return;
      setScene({ key: sceneKey, summaries, superposition, superpositionError });
      latest.current.onSceneReady?.({ summaries, superposition });
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
    // sceneKey stands for the structure list; fitMethod is part of it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  const displayed = useMemo(
    () =>
      ready
        ? structures.filter(
            (structure) =>
              !structure.frameOnly && ready.summaries[structure.id],
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready],
  );
  const slotOf = useCallback(
    (structure: ViewportStructure) =>
      structure.slot ??
      (displayed.length > 1
        ? String.fromCharCode(65 + displayed.indexOf(structure))
        : undefined),
    [displayed],
  );
  const rangesFor = useCallback(
    (structure: ViewportStructure, selection: ResidueRange[]) => {
      const summary = ready?.summaries[structure.id];
      const chain = summary ? chainOf(structure, summary) : undefined;
      return chain ? mapRanges(mapOf(structure), chain, selection) : [];
    },
    [ready],
  );
  /** UniProt position of a pick, or null when it is not on the mapped protein. */
  const positionOf = useCallback(
    (pick: ResiduePick): number | null => {
      const structure = latest.current.structures.find(
        (entry) => entry.id === pick.structureId,
      );
      const summary = structure ? ready?.summaries[structure.id] : undefined;
      if (!structure || !summary) return null;
      const focus = chainOf(structure, summary);
      const chain = summary.chains.find(
        (entry) => entry.labelAsymId === pick.labelAsymId,
      );
      if (!chain || chain.entityId !== focus?.entityId) return null;
      return pickPosition(mapOf(structure), pick);
    },
    [ready],
  );

  const variantColoring = useMemo<ResidueColoring | undefined>(
    () =>
      variant && palette
        ? {
            colors: new Map([[variant.position, palette.variant]]),
            fallback: palette.reference,
            legendKind: "reference-variant",
            legend: {
              title: "Structure",
              items: [
                { label: "Reference", color: palette.reference, code: "R" },
                { label: "Variant site", color: palette.variant, code: "V" },
              ],
            },
          }
        : undefined,
    [variant, palette],
  );
  const coloringFor = useCallback(
    (mode: ColorMode) =>
      colorings?.[mode] ??
      (mode === "reference-variant" ? variantColoring : undefined),
    [colorings, variantColoring],
  );

  const shownStructures = structures.filter(
    (structure) => !structure.frameOnly,
  );
  const overlay = shownStructures.length > 1;
  const tint = overlay && (tintChoice ?? true);
  const anyPredicted = shownStructures.some(
    (structure) => structure.origin !== "experimental",
  );

  const effectiveMode = useCallback(
    (
      structure: ViewportStructure,
    ): {
      mode: EffectiveMode;
      coloring?: ResidueColoring;
      note?: string;
    } => {
      if (tint) return { mode: "structure" };
      const requested = colorMode ?? "confidence";
      const resolved = resolveColorMode(colorMode, structure.origin);
      const fallbackNote =
        requested === "confidence" && resolved === "chain" && colorMode !== null
          ? `${shortStructureId(structure.id)}: pLDDT is defined only for predicted structures, coloured by chain`
          : undefined;
      if (
        resolved === "domain" ||
        resolved === "alphamissense" ||
        resolved === "reference-variant"
      ) {
        const coloring = coloringFor(resolved);
        return coloring
          ? { mode: resolved, coloring }
          : {
              mode: "chain",
              note: `No ${COLOR_LABEL[resolved].toLowerCase()} data supplied, coloured by chain`,
            };
      }
      return { mode: resolved, note: fallbackNote };
    },
    [tint, colorMode, coloringFor],
  );

  useEffect(() => {
    const handle = viewer.current;
    if (!handle || !ready || !palette) return;
    displayed.forEach((structure, index) => {
      const summary = ready.summaries[structure.id];
      const plan = effectiveMode(structure);
      const applied =
        plan.mode === "structure"
          ? handle.setColorMode(structure.id, {
              kind: "uniform",
              color: index === 0 ? palette.reference : palette.chains[1],
            })
          : plan.mode === "confidence"
            ? handle.setColorMode(structure.id, { kind: "plddt" })
            : plan.mode === "secondary-structure"
              ? handle.setColorMode(structure.id, {
                  kind: "secondary-structure",
                })
              : plan.coloring
                ? handle.setResidueColors(
                    structure.id,
                    coloringDataset(plan.coloring, structure, summary),
                  )
                : handle.setResidueColors(
                    structure.id,
                    chainDataset(summary, palette),
                  );
      applied.catch(() => {});
    });
  }, [ready, displayed, palette, effectiveMode]);

  useEffect(() => {
    const handle = viewer.current;
    if (!handle || !ready) return;
    for (const structure of displayed)
      handle
        .setRepresentation(structure.id, toRepresentationKind(representation))
        .catch(() => {});
  }, [ready, displayed, representation]);

  const ownClick = useRef(false);
  useEffect(() => {
    const handle = viewer.current;
    const [primary] = displayed;
    if (!handle || !primary) return;
    if (ranges.length === 0) {
      handle.select(primary.id, null);
      ownClick.current = false;
      return;
    }
    displayed.forEach((structure, index) =>
      handle.select(structure.id, rangesFor(structure, ranges), {
        add: index > 0,
      }),
    );
    // a click in 3D has already centred the camera on the residue
    if (ownClick.current) ownClick.current = false;
    else
      handle.focus(
        primary.id,
        rangesFor(primary, ranges),
        linkedCamera ? { durationMs: 0 } : undefined,
      );
    // the link state is read when the selection changes; toggling it must not refocus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, ranges, rangesFor]);

  const ownHover = useRef<number | null>(null);
  useEffect(() => {
    const handle = viewer.current;
    const [primary] = displayed;
    if (!handle || !primary) return;
    let marked = false;
    return subscribeWorkspaceHover((hover) => {
      if (!hover || hover.accession !== accession) {
        if (marked) handle.highlight(primary.id, null);
        marked = false;
        return;
      }
      if (hover.origin === "viewport" && ownHover.current === hover.position)
        return;
      const residue = [{ start: hover.position, end: hover.position }];
      displayed.forEach((structure, index) =>
        handle.highlight(structure.id, rangesFor(structure, residue), {
          add: index > 0,
        }),
      );
      marked = true;
    });
  }, [displayed, accession, rangesFor]);

  const handleHover = useCallback(
    (pick: ResiduePick | undefined) => {
      const position = pick ? positionOf(pick) : null;
      const previous = ownHover.current;
      ownHover.current = position;
      if (!accession) return;
      if (position !== null)
        setWorkspaceHover({ accession, position, origin: "viewport" });
      else if (previous !== null) setWorkspaceHover(null);
    },
    [accession, positionOf],
  );

  const handleClick = useCallback(
    (pick: ResiduePick | undefined, info: PickInfo) => {
      if (!pick || info.button !== "primary") return;
      const position = positionOf(pick);
      if (position === null) return;
      ownClick.current = true;
      const selection = useWorkspaceSelection.getState();
      if (info.shift) selection.toggleRange({ start: position, end: position });
      else selection.selectResidue(position);
    },
    [positionOf],
  );

  const variantPosition = variant?.position;
  const variantLabel = variant?.label;
  useEffect(() => {
    const handle = viewer.current;
    if (!handle || !palette || variantPosition === undefined || !variantLabel)
      return;
    const shown: string[] = [];
    const labels: Array<Promise<string | undefined>> = [];
    for (const structure of displayed) {
      const site = rangesFor(structure, [
        { start: variantPosition, end: variantPosition },
      ]);
      if (site.length === 0) continue;
      shown.push(structure.id);
      handle
        .showResidueSet(structure.id, "variant", site, {
          color: palette.variant,
          sizeFactor: 0.3,
        })
        .catch(() => {});
      labels.push(
        handle
          .addLabel(structure.id, site[0], variantLabel, {
            textColor: canvasTheme.select,
            borderColor: canvasTheme.background,
            textSize: 1,
          })
          .catch(() => undefined),
      );
    }
    return () => {
      for (const id of shown)
        handle.hideResidueSet(id, "variant").catch(() => {});
      for (const label of labels)
        void label
          .then((labelId) =>
            labelId ? handle.removeLabel(labelId) : undefined,
          )
          .catch(() => {});
    };
  }, [
    displayed,
    palette,
    canvasTheme,
    variantPosition,
    variantLabel,
    rangesFor,
  ]);

  useEffect(() => {
    const handle = viewer.current;
    if (!handle || !residueSets?.length) return;
    const shown: Array<[string, string]> = [];
    for (const set of residueSets) {
      for (const structure of displayed) {
        if (set.structureId && set.structureId !== structure.id) continue;
        const mapped = rangesFor(
          structure,
          set.positions.map((position) => ({ start: position, end: position })),
        );
        if (mapped.length === 0) continue;
        const setId = `set-${set.id}`;
        shown.push([structure.id, setId]);
        handle
          .showResidueSet(structure.id, setId, mapped, { color: set.color })
          .catch(() => {});
      }
    }
    return () => {
      for (const [id, setId] of shown)
        handle.hideResidueSet(id, setId).catch(() => {});
    };
  }, [displayed, residueSets, rangesFor]);

  const ligandKey = ligand
    ? `${ligand.structureId}|${ligand.compId}|${ligand.authAsymId ?? ""}|${ligand.authSeqId ?? ""}|${ligand.radius ?? 5}`
    : "";
  useEffect(() => {
    const handle = viewer.current;
    const target = latest.current.ligand;
    const structure = displayed.find(
      (entry) => entry.id === target?.structureId,
    );
    const summary = structure ? ready?.summaries[structure.id] : undefined;
    if (!handle || !target || !structure || !summary) return;
    let cancelled = false;
    handle
      .showBindingSite(
        structure.id,
        {
          compId: target.compId,
          authAsymId: target.authAsymId,
          authSeqId: target.authSeqId,
        },
        target.radius ?? 5,
      )
      .then((residues) => {
        if (cancelled) return;
        const map = mapOf(structure);
        const focus = chainOf(structure, summary);
        latest.current.onBindingSite?.(
          residues.map((residue) => {
            const chain = summary.chains.find(
              (entry) => entry.labelAsymId === residue.labelAsymId,
            );
            return {
              ...residue,
              position:
                chain && chain.entityId === focus?.entityId
                  ? toUniProtPosition(
                      map,
                      map.numbering === "auth"
                        ? residue.authSeqId
                        : residue.labelSeqId,
                    )
                  : null,
            };
          }),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      handle.hideBindingSite(structure.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, ligandKey]);

  useEffect(() => {
    if (!maximized) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setMaximized(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setMaximized(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [maximized]);

  const toggleFullscreen = () => {
    if (maximized) {
      setMaximized(false);
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      return;
    }
    // the page goes full screen and the viewport covers it, so menus and toasts stay usable
    setMaximized(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const legendEntries = useMemo<ViewerLegendEntry[]>(() => {
    if (!ready || !palette) return [];
    const entries: ViewerLegendEntry[] = [];
    const seen = new Set<string>();
    displayed.forEach((structure, index) => {
      const plan = effectiveMode(structure);
      const key = plan.mode === "chain" ? `chain:${structure.id}` : plan.mode;
      if (seen.has(key)) return;
      seen.add(key);
      if (plan.mode === "structure") {
        entries.push({
          spec: {
            title: "Structure",
            items: displayed.map((entry, at) => ({
              label: `${shortStructureId(entry.id)} (${STRUCTURE_ORIGIN_META[entry.origin].tag})`,
              color: at === 0 ? palette.reference : palette.chains[1],
              code: slotOf(entry),
            })),
          },
        });
      } else if (plan.mode === "confidence") {
        entries.push({ kind: "plddt", spec: PLDDT_LEGEND });
      } else if (plan.mode === "secondary-structure") {
        entries.push({ spec: SECONDARY_STRUCTURE_LEGEND });
      } else if (plan.coloring) {
        entries.push({
          kind: plan.coloring.legendKind,
          spec: plan.coloring.legend,
        });
      } else {
        const chains = ready.summaries[structure.id].chains;
        entries.push({
          spec: {
            title: "Chain",
            note: displayed.length > 1 ? shortStructureId(structure.id) : "",
            items: chains.slice(0, 8).map((chain, at) => ({
              label: `Chain ${chain.authAsymId}`,
              color: palette.chains[at % palette.chains.length],
            })),
          },
        });
      }
      void index;
    });
    return entries;
  }, [ready, palette, displayed, effectiveMode, slotOf]);

  const modeNotes = displayed
    .map((structure) => effectiveMode(structure).note)
    .filter((note): note is string => Boolean(note));
  const variantOutside =
    variant && ready
      ? displayed.filter((structure) => {
          const summary = ready.summaries[structure.id];
          const chain = chainOf(structure, summary);
          const map = mapOf(structure);
          const seqId = toStructureSeq(map, variant.position);
          const span =
            map.numbering === "auth"
              ? chain?.authSeqRange
              : chain?.labelSeqRange;
          return seqId === null || !span || seqId < span[0] || seqId > span[1];
        })
      : [];

  const notices = [
    ...new Set(modeNotes),
    ...(variant && variantOutside.length > 0
      ? [
          `Residue ${variant.position} has no coordinates in ${variantOutside
            .map((structure) => structure.label ?? shortStructureId(structure.id))
            .join(", ")}`,
        ]
      : []),
  ];

  const superposition = ready?.superposition ?? null;
  const [referenceStructure, mobileStructure] = structures;
  const superpositionLine =
    superposition && referenceStructure && mobileStructure
      ? `${shortStructureId(mobileStructure.id)} superposed on ${shortStructureId(referenceStructure.id)}: RMSD ${superposition.rmsd.toFixed(2)} Å over ${superposition.alignedResidues} Cα pairs, ${METHOD_LABEL[superposition.method]} (Mol*)`
      : null;
  const selectionText = describeRanges(ranges);

  const exportFigure = async (background: "canvas" | "white") => {
    const handle = viewer.current;
    if (!handle || !ready) return;
    const theme = background === "white" ? VIEWER_THEMES.light : canvasTheme;
    try {
      if (theme !== canvasTheme) handle.setTheme(theme);
      const image = await handle.screenshot();
      const figure = await composeFigure(image, {
        background: theme.background,
        structures: displayed.map((structure) => ({
          slot: slotOf(structure),
          id: structure.id,
          origin: structure.origin,
          detail: structure.detail,
          modelVersion: structure.modelVersion,
        })),
        legends: legendEntries.map((entry) => entry.spec),
        notes: [
          superpositionLine,
          variant
            ? `Variant site ${variant.label} drawn as ball-and-stick`
            : null,
          accession
            ? `Residue numbering: UniProt ${accession}${selectionText ? `, selection ${selectionText}` : ""}`
            : null,
        ].filter((note): note is string => Boolean(note)),
      });
      const filename = figureFilename(displayed.map((entry) => entry.id));
      saveBlob(figure, filename);
      latest.current.onExport?.(figure, filename);
      toast(`Figure saved as ${filename}`);
    } catch (error) {
      toast.error(
        `Figure export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (theme !== canvasTheme) handle.setTheme(canvasTheme);
    }
  };

  const download = (id: string) => {
    const structure = structures.find((entry) => entry.id === id);
    if (!structure) return;
    downloadStructure(structure.id, structure.source)
      .then((filename) => toast(`Saved ${filename}`))
      .catch((error: unknown) =>
        toast.error(
          `Download of ${structure.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };

  const colorOptions: ViewerColorOption[] = [
    ...(overlay ? [{ value: "structure", label: COLOR_LABEL.structure }] : []),
    {
      value: "confidence",
      label: COLOR_LABEL.confidence,
      unavailable: anyPredicted
        ? undefined
        : "Defined only for predicted structures",
    },
    { value: "chain", label: COLOR_LABEL.chain },
    {
      value: "domain",
      label: COLOR_LABEL.domain,
      unavailable: coloringFor("domain")
        ? undefined
        : "No domain annotation loaded",
    },
    { value: "secondary-structure", label: COLOR_LABEL["secondary-structure"] },
    {
      value: "alphamissense",
      label: COLOR_LABEL.alphamissense,
      unavailable: coloringFor("alphamissense")
        ? undefined
        : "No per-residue scores loaded",
    },
    {
      value: "reference-variant",
      label: COLOR_LABEL["reference-variant"],
      unavailable: coloringFor("reference-variant")
        ? undefined
        : "No variant selected",
    },
  ];
  const colorValue = tint
    ? "structure"
    : resolveColorMode(
        colorMode,
        anyPredicted ? "predicted_external" : "experimental",
      );

  const description = ready
    ? [
        displayed
          .map((structure) => {
            const meta = STRUCTURE_ORIGIN_META[structure.origin];
            const slot = slotOf(structure);
            return `${slot ? `${slot}: ` : ""}${structure.id}, ${meta.label.toLowerCase()}, ${meta.caption}, ${ready.summaries[structure.id].residueCount} residues`;
          })
          .join("; ") || "No structure shown",
        `Representation ${representation}`,
        `Coloured by ${legendEntries.map((entry) => entry.spec.title.toLowerCase()).join(" and ") || "nothing"}`,
        selectionText
          ? `Selected residues ${selectionText}${accession ? `, UniProt ${accession} numbering` : ""}`
          : "No residue selected",
        variant
          ? `Variant site ${variant.label} drawn as ball-and-stick`
          : null,
        superpositionLine,
      ]
        .filter(Boolean)
        .join(". ")
    : undefined;

  const renderHover = (pick: ResiduePick) => {
    const structure = structures.find((entry) => entry.id === pick.structureId);
    const position = positionOf(pick);
    const predicted = structure && structure.origin !== "experimental";
    const plddt = predicted
      ? normalizePlddt(pick.bFactor, structure.plddtScale ?? "0-100")
      : null;
    const slot = structure ? slotOf(structure) : undefined;
    return (
      <>
        {slot ? <span className="font-semibold">{slot}</span> : null}
        <span className="font-medium text-foreground">
          {residueName(pick.compId)}
          {position ?? pick.authSeqId}
        </span>
        <span>chain {pick.authAsymId}</span>
        {position === null ? (
          <span>author numbering</span>
        ) : position !== pick.authSeqId ? (
          <span>PDB {pick.authSeqId}</span>
        ) : null}
        {plddt !== null ? (
          <span>
            pLDDT {plddt.toFixed(1)} {plddtBand(plddt).label.toLowerCase()}
          </span>
        ) : null}
      </>
    );
  };

  const caption =
    superposition && referenceStructure && mobileStructure
      ? classCaption(referenceStructure.origin, mobileStructure.origin)
      : null;
  const slots = Object.fromEntries(
    structures.flatMap((structure) =>
      structure.slot ? [[structure.id, structure.slot]] : [],
    ),
  );

  return (
    <div
      data-slot="structure-viewport"
      data-ready={ready ? "" : undefined}
      className={cn(
        "flex min-h-0 flex-col bg-background",
        maximized ? "fixed inset-0 z-50" : "relative size-full",
        className,
      )}
    >
      {toolbar ? (
        <ViewerToolbar
          representation={representation}
          onRepresentationChange={(next) =>
            useWorkspaceSelection.getState().setRepresentation(next)
          }
          colorOptions={colorOptions}
          colorValue={colorValue}
          onColorChange={(value) => {
            if (value === "structure") return setTintChoice(true);
            setTintChoice(false);
            useWorkspaceSelection.getState().setColorMode(value as ColorMode);
          }}
          domains={accession ? domains : undefined}
          onDomainSelect={(domain) =>
            useWorkspaceSelection
              .getState()
              .selectRange({ start: domain.start, end: domain.end })
          }
          canFocus={ranges.length > 0 && displayed.length > 0}
          onReset={() => viewer.current?.resetCamera()}
          onFocus={() => {
            const [primary] = displayed;
            if (primary)
              viewer.current?.focus(
                primary.id,
                rangesFor(primary, ranges),
                linkedCamera ? { durationMs: 0 } : undefined,
              );
          }}
          fullscreen={maximized}
          onFullscreenToggle={toggleFullscreen}
          onScreenshot={(background) => void exportFigure(background)}
          downloads={shownStructures.map((structure) => ({
            id: structure.id,
            label: structureFilename(structure.id, structure.source),
          }))}
          onDownload={download}
          disabled={!ready || displayed.length === 0}
          compact={simple}
          moreItems={
            structures.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Fit</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={fitMethod}
                    onValueChange={(value) =>
                      setFitMethod(value as SuperpositionResult["method"])
                    }
                  >
                    <DropdownMenuRadioItem value="sequence-ca" closeOnClick>
                      Sequence Cα
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="tm-align" closeOnClick>
                      TM-align
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </>
            ) : null
          }
        >
          {structures.length > 1 ? (
            <>
              <span className="shrink-0 text-2xs text-muted-foreground">
                Fit
              </span>
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                aria-label="Superposition method"
                value={[fitMethod]}
                onValueChange={(value) => {
                  if (value.length)
                    setFitMethod(value[0] as SuperpositionResult["method"]);
                }}
              >
                <ToggleGroupItem value="sequence-ca">
                  Sequence Cα
                </ToggleGroupItem>
                <ToggleGroupItem value="tm-align">TM-align</ToggleGroupItem>
              </ToggleGroup>
            </>
          ) : null}
        </ViewerToolbar>
      ) : null}

      {simple ? null : superposition &&
        referenceStructure &&
        mobileStructure ? (
        <p
          data-slot="viewer-superposition"
          role="status"
          className="no-scrollbar flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-b border-border-subtle bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground"
        >
          <span>
            Cα RMSD{" "}
            <span className="tabular font-mono text-foreground">
              {superposition.rmsd.toFixed(2)} Å
            </span>
          </span>
          <span>
            <span className="tabular font-mono text-foreground">
              {superposition.alignedResidues}
            </span>{" "}
            aligned pairs of {superposition.referenceCaCount} /{" "}
            {superposition.mobileCaCount} Cα
          </span>
          {superposition.tmScoreReference !== undefined &&
          superposition.tmScoreMobile !== undefined ? (
            <span>
              TM-score{" "}
              <span className="tabular font-mono text-foreground">
                {superposition.tmScoreReference.toFixed(3)}
              </span>{" "}
              by reference length,{" "}
              <span className="tabular font-mono text-foreground">
                {superposition.tmScoreMobile.toFixed(3)}
              </span>{" "}
              by comparand length
            </span>
          ) : null}
          <span>
            <span className="text-foreground">
              {METHOD_LABEL[superposition.method]}
            </span>{" "}
            (Mol*), whole chain: {shortStructureId(mobileStructure.id)} moved
            onto {shortStructureId(referenceStructure.id)}
            {referenceStructure.frameOnly ? " (frame, not drawn)" : ""}
          </span>
          {caption ? <span>{caption}</span> : null}
        </p>
      ) : ready?.superpositionError ? (
        <p
          role="status"
          className="flex h-6 shrink-0 items-center border-b border-border-subtle bg-sunken px-3 text-2xs text-muted-foreground"
        >
          Not superposed: {ready.superpositionError}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <MolecularViewer
          ref={viewer}
          ariaLabel={ariaLabel}
          description={description}
          slots={slots}
          frameOnly={structures
            .filter((structure) => structure.frameOnly)
            .map((structure) => structure.id)}
          hoverReadout={renderHover}
          onHover={handleHover}
          onClick={handleClick}
        >
          {legend && simple && ready ? (
            <div
              data-slot="viewer-legend"
              className="pointer-events-none absolute right-2 bottom-2 left-2 flex flex-col items-start gap-1 text-2xs text-muted-foreground"
            >
              {notices.map((notice) => (
                <span
                  key={notice}
                  className="max-w-full border border-border-subtle bg-background/85 px-1.5 py-1"
                >
                  {notice}
                </span>
              ))}
              {legendEntries.length > 0 ? (
                <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 border border-border-subtle bg-background/85 px-1.5 py-1">
                  <ViewerLegend entries={legendEntries} compact />
                </div>
              ) : null}
            </div>
          ) : null}
        </MolecularViewer>
      </div>

      {legend && !simple ? (
        <footer
          data-slot="viewer-legend"
          className="no-scrollbar flex h-6 shrink-0 items-center gap-4 overflow-x-auto border-t border-border-subtle bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground"
        >
          <ViewerLegend entries={legendEntries} />
          {notices.map((notice) => (
            <span key={notice}>{notice}</span>
          ))}
          {accession ? (
            <span className="ml-auto pl-4">
              Numbering{" "}
              <span className="font-mono text-foreground">
                UniProt {accession}
              </span>
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
