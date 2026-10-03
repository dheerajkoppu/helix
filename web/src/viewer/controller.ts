import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { createViewer } from "./plugin";
import { loadStructure, removeStructure, LoadedStructure } from "./load";
import {
  buildScene,
  setRepresentationAlpha,
  setRepresentationKind,
  setStructureVisibility,
  StructureScene,
} from "./representations";
import { ColorMode, setColorMode } from "./themes";
import { deleteResidueColorDataset, registerResidueDataTheme, setResidueColorDataset } from "./residue-data-theme";
import { clearHighlight, clearSelection, focusResidues, highlightResidues, selectResidues } from "./selection";
import { PickHandlers, subscribePicks } from "./events";
import { removeRefs, showBindingSite } from "./binding-site";
import { addResidueLabel, removeLabel } from "./labels";
import { showResidueSet, summarizeStructure } from "./residue-sets";
import { StateTree } from "molstar/lib/mol-state";
import { applyMotionPreference, resetCamera, viewerSettled } from "./camera";
import { applyPerformanceProfile, applyViewerTheme, dataUrlToBlob, screenshotPng, ViewerTheme } from "./canvas";
import { applySuperposition, clearSuperposition, computeSuperposition } from "./superpose";
import { camerasInSync, CameraState } from "./camera-sync";
import type { MolecularViewerHandle, StructureDescriptor } from "./types";

interface Entry {
  descriptor: StructureDescriptor;
  loaded: LoadedStructure;
  scene: StructureScene;
  bindingSiteRefs: string[];
  residueSetRefs: Map<string, string>;
  datasetVersion: number;
}

export interface ViewerController extends Omit<MolecularViewerHandle, "ready" | "syncCameraWith"> {
  readonly plugin: PluginContext;
  dispose(): void;
}

function toCameraState(plugin: PluginContext): CameraState | undefined {
  const snapshot = plugin.canvas3d?.camera.getSnapshot();
  if (!snapshot) return undefined;
  const { mode, position, target, up, radius, radiusMax, fov } = snapshot;
  return { mode, position: Array.from(position), target: Array.from(target), up: Array.from(up), radius, radiusMax, fov };
}

let controllerCount = 0;

export async function createViewerController(
  container: HTMLElement,
  options: { theme: ViewerTheme; reducedMotion: boolean; handlers: PickHandlers },
): Promise<ViewerController> {
  const viewer = await createViewer(container, {
    backgroundColor: options.theme.background,
    reducedMotion: options.reducedMotion,
  });
  const plugin = viewer.plugin;
  registerResidueDataTheme(plugin);
  applyViewerTheme(plugin, options.theme);
  const entries = new Map<string, Entry>();
  // a pick reports the state ref of its structure node; pages address structures by their own id
  const withStructureId = <T extends { structureRef: string | undefined }>(pick: T | undefined) => {
    if (!pick) return pick;
    for (const [id, candidate] of entries) {
      const ref = candidate.loaded.structure.ref;
      if (pick.structureRef === ref || pick.structureRef === StateTree.getDecoratorRoot(plugin.state.data.tree, ref)) {
        return { ...pick, structureId: id };
      }
    }
    return pick;
  };
  const unsubscribePicks = subscribePicks(plugin, {
    onHover: (pick) => options.handlers.onHover?.(withStructureId(pick)),
    onClick: (pick, info) => options.handlers.onClick?.(withStructureId(pick), info),
  });

  // the residue colour registry is module-wide, so keys are namespaced per viewer instance
  const instanceKey = `viewer-${++controllerCount}`;
  const datasetKey = (id: string) => `${instanceKey}:${id}`;
  let reducedMotion = options.reducedMotion;
  const duration = (durationMs = 250) => (reducedMotion ? 0 : durationMs);
  const entry = (id: string): Entry => {
    const found = entries.get(id);
    if (!found) throw new Error(`Unknown structure "${id}"`);
    return found;
  };
  const representations = (target: Entry) =>
    [target.scene.polymer, target.scene.ligand, target.scene.branched, target.scene.ion].filter((r) => r !== undefined);
  // Mol* reports plddt-confidence as applicable to RCSB entries and would colour their B-factors as pLDDT
  const assertColorModeAllowed = (target: Entry, mode: ColorMode) => {
    if (mode.kind === "plddt" && target.descriptor.origin === "experimental") {
      throw new Error("pLDDT colouring is not defined for experimental structures");
    }
  };

  // state updates from separate React effects must not interleave
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };
  const removeEntry = async (id: string) => {
    await removeStructure(plugin, entry(id).loaded);
    deleteResidueColorDataset(datasetKey(id));
    entries.delete(id);
  };

  const controller: ViewerController = {
    plugin,
    load: (descriptor) => serialized(async () => {
      if (entries.has(descriptor.id)) await removeEntry(descriptor.id);
      const loaded = await loadStructure(plugin, descriptor.source, { assemblyId: descriptor.assemblyId });
      const scene = await buildScene(plugin, loaded, descriptor.representation ?? "cartoon");
      const created: Entry = { descriptor, loaded, scene, bindingSiteRefs: [], residueSetRefs: new Map(), datasetVersion: 0 };
      entries.set(descriptor.id, created);
      const mode = descriptor.colorMode ?? { kind: descriptor.origin === "experimental" ? "chain" : "plddt" };
      assertColorModeAllowed(created, mode);
      if (scene.polymer) await setColorMode(plugin, [scene.polymer], mode);
      if (entries.size === 1) await resetCamera(plugin, 0);
    }),
    remove: (id) => serialized(() => removeEntry(id)),
    clear: () => serialized(async () => {
      await plugin.clear();
      for (const id of entries.keys()) deleteResidueColorDataset(datasetKey(id));
      entries.clear();
    }),
    list: () => Array.from(entries.keys()),

    setRepresentation: (id, kind) => serialized(async () => {
      const polymer = entry(id).scene.polymer;
      if (polymer) await setRepresentationKind(plugin, polymer, kind);
    }),
    setColorMode: (id, mode) => serialized(async () => {
      const target = entry(id);
      assertColorModeAllowed(target, mode);
      if (target.scene.polymer) await setColorMode(plugin, [target.scene.polymer], mode);
    }),
    setResidueColors: (id, dataset) => serialized(async () => {
      const target = entry(id);
      setResidueColorDataset(datasetKey(id), dataset);
      target.datasetVersion += 1;
      if (target.scene.polymer) {
        const mode: ColorMode = { kind: "residue-data", datasetId: datasetKey(id), version: target.datasetVersion };
        await setColorMode(plugin, [target.scene.polymer], mode);
      }
    }),
    setVisibility: (id, visible) => setStructureVisibility(plugin, entry(id).loaded, visible),
    setOpacity: (id, alpha) => serialized(async () => {
      for (const representation of representations(entry(id))) {
        await setRepresentationAlpha(plugin, representation, alpha);
      }
    }),

    highlight(id, ranges, markOptions) {
      if (ranges) highlightResidues(plugin, entry(id).loaded, ranges, markOptions?.add);
      else clearHighlight(plugin);
    },
    select(id, ranges, markOptions) {
      if (ranges) selectResidues(plugin, entry(id).loaded, ranges, markOptions?.add);
      else clearSelection(plugin);
    },
    focus(id, ranges, focusOptions) {
      focusResidues(plugin, entry(id).loaded, ranges, {
        ...focusOptions,
        durationMs: duration(focusOptions?.durationMs),
      });
    },

    showBindingSite: (id, ligand, radius) => serialized(async () => {
      const target = entry(id);
      await removeRefs(plugin, target.bindingSiteRefs);
      const site = await showBindingSite(plugin, target.loaded, ligand, radius, duration());
      target.bindingSiteRefs = site?.refs ?? [];
      return site?.residues ?? [];
    }),
    hideBindingSite: (id) => serialized(async () => {
      const target = entry(id);
      await removeRefs(plugin, target.bindingSiteRefs);
      target.bindingSiteRefs = [];
    }),
    showResidueSet: (id, setId, ranges, setOptions) => serialized(async () => {
      const target = entry(id);
      const previous = target.residueSetRefs.get(setId);
      if (previous) await removeRefs(plugin, [previous]);
      target.residueSetRefs.delete(setId);
      const ref = await showResidueSet(plugin, target.loaded, `${instanceKey}-${setId}`, ranges, setOptions);
      if (ref) target.residueSetRefs.set(setId, ref);
    }),
    hideResidueSet: (id, setId) => serialized(async () => {
      const target = entries.get(id);
      const ref = target?.residueSetRefs.get(setId);
      if (!target || !ref) return;
      await removeRefs(plugin, [ref]);
      target.residueSetRefs.delete(setId);
    }),
    describe: (id) => {
      const target = entries.get(id);
      return target ? summarizeStructure(plugin, target.loaded) : undefined;
    },
    addLabel: (id, range, text, labelOptions) =>
      serialized(() => addResidueLabel(plugin, entry(id).loaded, range, text, labelOptions)),
    removeLabel: (labelId) => serialized(async () => {
      // the label goes away with its structure, so a late removal can find nothing
      if (plugin.state.data.cells.has(labelId)) await removeLabel(plugin, labelId);
    }),

    superpose: (mobileId, superposeOptions) => serialized(async () => {
      const { referenceId, referenceChain, mobileChain, numbering, method } = superposeOptions;
      const mobile = entry(mobileId);
      const result = computeSuperposition(
        entry(referenceId).loaded,
        { chain: referenceChain, numbering },
        mobile.loaded,
        { chain: mobileChain, numbering },
        method ?? "sequence-ca",
      );
      await applySuperposition(plugin, mobile.loaded, result.transform);
      return result;
    }),
    clearSuperposition: (mobileId) => serialized(() => clearSuperposition(plugin, entry(mobileId).loaded)),

    resetCamera(durationMs) {
      void resetCamera(plugin, duration(durationMs));
    },
    getCamera: () => toCameraState(plugin),
    setCamera(state, durationMs) {
      const view = {
        mode: state.mode,
        position: Vec3.create(state.position[0], state.position[1], state.position[2]),
        target: Vec3.create(state.target[0], state.target[1], state.target[2]),
        up: Vec3.create(state.up[0], state.up[1], state.up[2]),
        radius: state.radius,
        fov: state.fov,
      };
      if (duration(durationMs) > 0) {
        plugin.managers.camera.setSnapshot(view, duration(durationMs));
        return;
      }
      // immediate, so a linked viewer never observes a stale state
      plugin.canvas3d?.camera.setState(view, 0);
      plugin.canvas3d?.requestDraw();
    },
    onCameraChange(listener) {
      const camera = plugin.canvas3d?.camera;
      if (!camera) return () => {};
      let last: CameraState | undefined;
      const subscription = camera.changed.subscribe(() => {
        const state = toCameraState(plugin);
        // `changed` repeats on anti-aliasing jitter frames
        if (!state || (last && camerasInSync(state, last) && state.radius === last.radius)) return;
        last = state;
        listener(state);
      });
      return () => subscription.unsubscribe();
    },

    setTheme: (theme) => applyViewerTheme(plugin, theme),
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      applyMotionPreference(plugin, reduced);
    },
    setPerformanceProfile: (profile) => applyPerformanceProfile(plugin, profile),
    settled: () => serialized(() => viewerSettled(plugin)),
    screenshot: (screenshotOptions) => serialized(async () => {
      await viewerSettled(plugin);
      return dataUrlToBlob(await screenshotPng(plugin, screenshotOptions));
    }),

    dispose() {
      unsubscribePicks();
      for (const id of entries.keys()) deleteResidueColorDataset(datasetKey(id));
      entries.clear();
      viewer.dispose();
    },
  };
  return controller;
}
