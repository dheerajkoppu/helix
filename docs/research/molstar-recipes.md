# Mol\* integration cookbook for OrphaFold

Verified on 2026-10-03 against `molstar@5.12.0` (npm `latest`, published 2026-09-28, MIT), the version installed in `web/node_modules`. The code blocks in sections 4 and 5 are copied byte-for-byte from files that were type-checked and executed in a browser (section 1). The file is longer than the 800-line target because it embeds the complete tested implementation (17 files, about 1,450 lines).

## 0. Recommendation for OrphaFold

1. **Pin `molstar` to exactly `5.12.0`.** `web/package.json` currently has `^5.12.0`. All integration code uses deep `molstar/lib/<module>` paths, which carry no semver promise (the 5.12.0 changelog itself moves an extension directory). Upgrade on purpose and re-run the recipe checks.
2. **Use the plain `PluginContext` with `mountAsync(container)`.** No `mol-plugin-ui`, no Mol\* CSS, no default panels. OrphaFold supplies all chrome.
3. **Load Mol\* through `import()` inside a client-component effect.** The Mol\* chunk is 3.08 MB minified (855 kB gzip, 668 kB brotli) and stays out of the first page load.
4. **Put one `ViewerController` behind a `MolecularViewerHandle` ref** (section 5). React state never holds Mol\* objects. All mutating calls go through one promise queue.
5. **Set `canvas3d.camera.manualReset: true`.** The camera then moves only on explicit commands, which removes a race that made focus and screenshots non-deterministic in testing.
6. **Fetch BinaryCIF.** AlphaFold DB: resolve `bcifUrl` through the prediction API (model version is now v6, v4 URLs return 404). RCSB: `https://models.rcsb.org/{id}.bcif`.
7. **Gate pLDDT colouring on OrphaFold's own provenance class.** Mol\*'s `plddt-confidence` theme reports itself applicable to RCSB X-ray entries and paints their B-factors with the pLDDT palette. Experimental structures get chain or B-factor (`uncertainty`) colouring only.
8. **Use one custom theme, `orphafold-residue-data`, for every OrphaFold-computed per-residue colouring** (domains, variant impact, difference values). Colours are computed in app code from data with source IDs and passed as a `Map`; Mol\* state stores only a dataset id and a version number.
9. **Address residues with `StructureElement.Loci.fromSchema`.** Use `label_asym_id` + `label_seq_id` for predicted models and `auth_asym_id` + `auth_seq_id` when the UI shows PDB numbering. Pick events return both.
10. **Superpose with `alignAndSuperpose` (sequence-aligned C-alpha) by default and offer `tmAlign` for low sequence identity.** Always show RMSD together with the aligned pair count and the method.
11. **Split view is two plugin instances linked through `Camera.changed`** (available since 5.10.0) with a clamp-aware state comparison (recipe 4.11). Overlay is one plugin with a transform node on the mobile structure.
12. **Sequence tracks: Nightingale next to Mol\*, linked through our own hover and selection store.** Do not add a second 3D engine (NGL, 3Dmol.js) or a Mol\* wrapper (pdbe-molstar, rcsb-molstar).
13. **Reduced motion is our job.** Mol\* has no `prefers-reduced-motion` handling. Pass the flag at creation and at runtime (section 4.11).

## 1. Verified environment and method

| Item | Value |
| --- | --- |
| `molstar` | 5.12.0, MIT, published 2026-09-28, 241 releases on npm, `engines.node >= 22`, peer `react`/`react-dom >= 16.14.0` (only used by `mol-plugin-ui`) |
| Runtime test app | scratch Next.js 16.3.8 (Turbopack, App Router, `reactStrictMode: true`), React 19.3.0, TypeScript 7.0.2 |
| Project app (`web/`) | Next.js 16.3.8, React 19.2.8, TypeScript 5.9.3, `molstar` 5.12.0 via pnpm |
| Browser | Google Chrome 154.0.8037.95 headless, driven by `playwright-core` 1.63.0, WebGL2 through SwiftShader (`--use-angle=swiftshader`) |
| Node / npm | v26.10.0 / 11.19.1 |
| Test data | `AF-P42224-F1-model_v6` (STAT1, AlphaFold DB, bcif, cif, pdb), `1YVL` and `1BF5` (STAT1 X-ray, RCSB), `1CBS` (retinoic acid ligand) |

Tags used below:

| Tag | Meaning |
| --- | --- |
| [R] | Executed in headless Chrome with real WebGL2 rendering; result read back from plugin state, camera or screenshot pixels |
| [N] | Executed inside the Next.js app, both `next dev` (strict-mode double mount) and `next build` + `next start` |
| [T] | Type-checked with TypeScript 7.0.2 and with the project's TypeScript 5.9.3 against `web/node_modules/molstar` |
| [D] | Executed in Node against `molstar/lib/commonjs` (parsing, queries, themes, superposition) |
| [S] | Read in the 5.12.0 package source or `CHANGELOG.md`, not executed |
| [H] | HTTP endpoint called with `curl` on 2026-10-03 |

All code in sections 4 and 5 is [T]. Runtime status is listed per recipe.

## 2. Package and bundling facts

- `package.json` has no `main`, `exports`, `type` or `sideEffects` field [S]. Import deep paths: `molstar/lib/<module>` (ES modules). `molstar/lib/commonjs/<module>` is for Node scripts only. `molstar/build/viewer/` is the prebuilt full application and is not needed.
- Imports without a file extension (`molstar/lib/mol-plugin/context`) resolve under `moduleResolution: "bundler"`, which is what `web/tsconfig.json` uses [T]. Inside `lib/` Mol\* uses explicit `.js` paths since 5.0.0 [S].
- Next.js 16.3.8 with Turbopack built and prerendered the app with no `transpilePackages`, no webpack config and no Sass dependency [N]. The recipe import graph contains 1,281 modules, none from `mol-plugin-ui`, `react` or `react-markdown`, and no `.scss` import [R, esbuild metafile].
- A static import of the same modules in a client component also built and prerendered without error [N]. Mol\* module scope is therefore SSR-safe for these paths in 5.12.0. Keep the dynamic `import()` anyway: it removes 3.08 MB of script from the route's first load and from the server bundle.
- Installed size is 95 MB because the package also ships servers and CLIs (`express`, `swagger-ui-dist`, optional `gl`, `canvas`, `@google-cloud/storage` peers). None of it reaches the browser bundle.
- "Headless" in Mol\* terminology means `HeadlessPluginContext`, a Node.js renderer. The class to use for a custom browser UI is the ordinary `PluginContext` [S].
- `next dev` rejects dev-resource requests from `127.0.0.1` unless `allowedDevOrigins` is set. Point Playwright at `http://localhost:<port>` [N].

## 3. Gotchas found during verification

| # | Finding | Evidence | What to do |
| --- | --- | --- | --- |
| 1 | `plugin.mount`, `plugin.initViewer`, `plugin.initContainer` do not exist in 5.x. They were renamed to `mountAsync`, `initViewerAsync`, `initContainerAsync` in 5.0.0 (2025-09-28). The official "custom library" docs page still shows `plugin.initViewer(canvas, parent)`. | [T] [S] | Use `await plugin.mountAsync(container)`. |
| 2 | `plugin.dispose()` forces WebGL context loss on its canvas. A second plugin on the same `<canvas>` fails with `Need "MAX_VERTEX_TEXTURE_IMAGE_UNITS" >= 8` and `initViewerAsync` returns `false`. This is exactly what React strict mode does to a JSX-owned canvas. | [R] | Never render the canvas in JSX. `mountAsync(container)` creates a fresh wrapper div and canvas per plugin and `dispose()` removes them. 24 create/dispose cycles in one page succeeded. |
| 3 | `initViewerAsync(canvas, container)` throws inside `ResizeObserver.observe` when the canvas has no parent element. | [R] | Another reason to use `mountAsync`. |
| 4 | Resizing is built in: Mol\* observes the wrapper with a `ResizeObserver` (debounce 50 ms, throttle 100 ms). Canvas pixels = CSS pixels x `devicePixelRatio` x `pixelScale`. | [R] 640x480 to 500x300 and back | Do not add your own observer. The container needs `position: relative` and a real size. |
| 5 | `plddt-confidence` is not a built-in theme. It lives in `extensions/model-archive`. The `MAQualityAssessment` behaviour that normally registers it imports `mol-plugin-ui`. | [S] [R] | Register `PLDDTConfidenceColorThemeProvider` directly on the theme registry (recipe 4.1). |
| 6 | `plddt-confidence` is applicable to experimental RCSB entries. `Model.isExperimental` checks `_struct.pdbx_structure_determination_methodology`, which RCSB files for 1BF5 and 1YVL do not contain. 1YVL residue A150 with B = 79.12 is painted "Confident" blue. | [D] [R] | Gate in the controller on provenance origin (section 5). This refines the note in `ux-research.md` section 12. |
| 7 | pLDDT values come from `ma_qa_metric_local` when present (AlphaFold DB mmCIF and BCIF: 750 values for P42224) and fall back to the B-factor column otherwise (AlphaFold DB `.pdb`). Thresholds assume a 0 to 100 scale: `<= 50` `#ff7d45`, `<= 70` `#ffdb13`, `<= 90` `#65cbf3`, above `#0053d6`. | [S] [D] [R] | Confirm the scale of OrphaFold-generated files before using this theme on them. |
| 8 | An unknown colour theme name does not throw. The registry returns an empty provider and the structure renders grey. | [R] | Keep theme names in one typed union (`ColorMode`). |
| 9 | `colorThemeRegistry.add` throws when the name is already registered. | [S] | Guard with `registry.has(provider)`. |
| 10 | `plugin.behaviors.interaction.click` and `.hover` are `BehaviorSubject`s. Subscribing fires once immediately with an empty loci and button 0. | [R] | Skip the first click emission (recipe 4.8). |
| 11 | Mol\* re-frames the camera on its own when a scene commit moves geometry outside the previous bounds, and camera commands are applied on a later animation frame. With two linked viewers this made focus results and screenshots vary between runs. | [N] 3 of 4 runs lost the requested focus before the fix; every run after it (more than 10, dev and production) gave the same camera and the same screenshot byte count | `camera.manualReset: true` in the spec, explicit `resetCamera` after the first load, one serialized queue for controller calls, `viewerSettled()` before reading the camera or taking a screenshot. |
| 12 | A superposition transform is a decorator node under the structure node. `loaded.structure.cell.obj.data` stays untransformed. | [R] | Build loci for highlight, focus and labels from the decorated structure (`getStructureData`), compute superposition from the undecorated one. |
| 13 | `alignAndSuperpose` and `AlignSequences` read only the first unit (chain) of each loci. | [S] | One chain per structure per call. The recipe throws otherwise. |
| 14 | `element-symbol` colours carbons by chain by default (`carbonColor: 'chain-id'`). `chain-id` defaults to `auth` asym ids. `secondary-structure` defaults to `saturation: -1`. | [S] | Pass params explicitly, as the recipes do. |
| 15 | `builders.data.rawData` rejects `Uint8Array<ArrayBufferLike>` under TypeScript 5.7+ typed-array generics. | [T] | Type binary input as `ArrayBuffer | Uint8Array<ArrayBuffer>`. |
| 16 | Camera key bindings (W A S D and others) listen on `window`, but only fire when the event target is `body` or the canvas and the pointer is over the canvas. | [S] | Typing in OrphaFold inputs does not move the camera. |
| 17 | Query symbols are registered by a side-effect module. `Loci.fromSchema` with several items fails in a bare Node script with `structure-query.combinator.merge is not implemented`. | [D] | In unit tests that do not create a `PluginContext`, add `import "molstar/lib/mol-script/runtime/query/table"`. |
| 18 | Two separately loaded copies of the same file are not "equivalent" structures for marking, a structure and its transformed decorator are. | [D] | Highlights stay per structure in an overlay. |
| 19 | `Camera.changed` fires again on anti-aliasing jitter frames: two events per frame for about three frames after each real change, with an unchanged camera state. | [R] | Compare state before reacting. The controller deduplicates before calling React listeners. |
| 20 | A camera clamps `radius` to its own `radiusMax` (its scene radius). Linking two viewers with different scenes by copying or comparing full snapshots makes them overwrite each other's clipping radius. | [R] [S] | Never copy `radiusMax`; treat a clamped radius as equal (`camerasInSync`). |

Defaults read back from a live 5.12.0 plugin [R]: multisample `temporal`, ambient occlusion `on`, bloom `on`, outline `off`, antialiasing `smaa`, fog `on`, perspective camera, transparency `wboit`, `pixelScale` 1, `pickScale` 0.25, `resolutionMode` `auto`, picking granularity `residue`, highlight colour `#ff6699`, select colour `#33ff19`.

## 4. Recipes

File layout used in the tests: `viewer/*.ts` and `components/*.tsx` as sibling folders (in the project: `web/src/viewer/` and `web/src/components/`). Recipes import each other with relative paths.

### 4.1 Create and dispose the plugin

Status: [R] [N]. `web/src/viewer/plugin.ts`

```ts
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec, PluginSpec } from "molstar/lib/mol-plugin/spec";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { PluginBehaviors } from "molstar/lib/mol-plugin/behavior";
import { StructureFocusRepresentation } from "molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation";
import { PLDDTConfidenceColorThemeProvider } from "molstar/lib/extensions/model-archive/quality-assessment/color/plddt";
import { Color } from "molstar/lib/mol-util/color";

export interface CreateViewerOptions {
  backgroundColor: number;
  reducedMotion: boolean;
  /** clicking a residue adds ball-and-stick for it and its 5 A surroundings */
  focusOnClick?: boolean;
  pixelScale?: number;
}

export function createViewerSpec(options: CreateViewerOptions): PluginSpec {
  const cameraDurationMs = options.reducedMotion ? 0 : 250;
  const behaviors: PluginSpec.Behavior[] = [
    PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
    PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
    PluginSpec.Behavior(PluginBehaviors.Representation.DefaultLociLabelProvider),
    PluginSpec.Behavior(PluginBehaviors.Camera.FocusLoci, { durationMs: cameraDurationMs }),
    PluginSpec.Behavior(PluginBehaviors.Camera.CameraControls),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.Interactions),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.SecondaryStructure),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.ValenceModel),
  ];
  if (options.focusOnClick) {
    behaviors.push(
      PluginSpec.Behavior(PluginBehaviors.Representation.FocusLoci),
      PluginSpec.Behavior(StructureFocusRepresentation),
    );
  }
  return {
    ...DefaultPluginSpec(),
    behaviors,
    animations: [],
    canvas3d: {
      renderer: { backgroundColor: Color(options.backgroundColor), enableAnimation: !options.reducedMotion },
      cameraResetDurationMs: cameraDurationMs,
      // manualReset stops Mol* from re-framing the scene on its own whenever the scene bounds change
      camera: { manualReset: true, helper: { axes: { name: "off", params: {} } } },
      trackball: { animate: { name: "off", params: {} } },
    },
    config: [
      [PluginConfig.General.PixelScale, options.pixelScale ?? 1],
      [PluginConfig.VolumeStreaming.Enabled, false],
    ],
  };
}

export interface ViewerInstance {
  plugin: PluginContext;
  dispose(): void;
}

/** `target` must be positioned (position: relative) and have a non-zero size. */
export async function createViewer(target: HTMLElement, options: CreateViewerOptions): Promise<ViewerInstance> {
  const plugin = new PluginContext(createViewerSpec(options));
  await plugin.init();
  plugin.representation.structure.themes.colorThemeRegistry.add(PLDDTConfidenceColorThemeProvider);

  // creates its own wrapper div and canvas inside target, removed again by dispose()
  if (!(await plugin.mountAsync(target))) {
    plugin.dispose();
    throw new Error("Mol* could not create a WebGL context");
  }
  await plugin.canvas3dInitialized;
  return { plugin, dispose: () => plugin.dispose() };
}
```

- Behaviours kept from `DefaultPluginSpec()`: hover highlight, click select, loci labels, click-to-focus camera, camera controls, and the custom-property providers the recipes need (structure info, secondary structure, valence model, interactions). Dropped: `CameraAxisHelper`, `SnapshotControls`, `AccessibleSurfaceArea`, `BestDatabaseSequenceMapping`, `CrossLinkRestraint`, `Streamlines`. Volume streaming is switched off through config.
- `focusOnClick: true` adds Mol\*'s focus representation: `plugin.managers.structure.focus.setFromLoci(loci)` or a click shows the residue plus surroundings within 5 A as ball-and-stick and `focus.clear()` removes them [R].
- `dispose()` unsubscribes everything, stops the render loop and loses the WebGL context [S], and removes the wrapper element from the container [R].

### 4.2 React 19 client component

Status: [N] in `next dev` with strict mode and in the production build: one canvas per container, no console errors apart from a favicon 404, `onHover` firing, theme switch applied live, every handle method called at least once.

`web/src/components/MolecularViewer.tsx`

```tsx
"use client";

import { useEffect, useImperativeHandle, useRef } from "react";
import type { ViewerController } from "../viewer/controller";
// camera-sync has no Mol* import, so this static import keeps Mol* out of the component chunk
import { camerasInSync, CameraState } from "../viewer/camera-sync";
import type { MolecularViewerHandle, MolecularViewerProps } from "../viewer/types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function MolecularViewer(props: MolecularViewerProps) {
  const { ref, theme, reducedMotion = false, className, ariaLabel } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);
  const readyRef = useRef<Deferred<ViewerController> | null>(null);
  if (readyRef.current === null) readyRef.current = createDeferred<ViewerController>();

  const latestProps = useRef(props);
  useEffect(() => {
    latestProps.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let controller: ViewerController | undefined;

    (async () => {
      // keeps the ~3 MB Mol* chunk out of the server bundle and the initial page load
      const { createViewerController } = await import("../viewer/controller");
      if (cancelled) return;
      const created = await createViewerController(container, {
        theme: latestProps.current.theme,
        reducedMotion: latestProps.current.reducedMotion ?? false,
        handlers: {
          onHover: (pick) => latestProps.current.onHover?.(pick),
          onClick: (pick, info) => latestProps.current.onClick?.(pick, info),
        },
      });
      // strict mode: the first effect run was cleaned up while Mol* was still initializing
      if (cancelled) {
        created.dispose();
        return;
      }
      controller = created;
      controllerRef.current = created;
      readyRef.current?.resolve(created);
    })().catch((error: unknown) => {
      if (cancelled) return;
      const wrapped = error instanceof Error ? error : new Error(String(error));
      readyRef.current?.reject(wrapped);
      latestProps.current.onError?.(wrapped);
    });

    return () => {
      cancelled = true;
      if (!controller) return;
      controller.dispose();
      controllerRef.current = null;
      readyRef.current = createDeferred<ViewerController>();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    controllerRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useImperativeHandle(ref, (): MolecularViewerHandle => {
    const whenReady = () => readyRef.current!.promise;
    const current = () => controllerRef.current;
    return {
      get ready() {
        return whenReady().then(() => undefined);
      },
      load: async (descriptor) => (await whenReady()).load(descriptor),
      remove: async (id) => (await whenReady()).remove(id),
      clear: async () => (await whenReady()).clear(),
      list: () => current()?.list() ?? [],
      setRepresentation: async (id, kind) => (await whenReady()).setRepresentation(id, kind),
      setColorMode: async (id, mode) => (await whenReady()).setColorMode(id, mode),
      setResidueColors: async (id, dataset) => (await whenReady()).setResidueColors(id, dataset),
      setVisibility: (id, visible) => current()?.setVisibility(id, visible),
      setOpacity: async (id, alpha) => (await whenReady()).setOpacity(id, alpha),
      highlight: (id, ranges) => current()?.highlight(id, ranges),
      select: (id, ranges) => current()?.select(id, ranges),
      focus: (id, ranges, options) => current()?.focus(id, ranges, options),
      showBindingSite: async (id, ligand, radius) => (await whenReady()).showBindingSite(id, ligand, radius),
      hideBindingSite: async (id) => (await whenReady()).hideBindingSite(id),
      addLabel: async (id, range, text) => (await whenReady()).addLabel(id, range, text),
      removeLabel: async (labelId) => (await whenReady()).removeLabel(labelId),
      superpose: async (mobileId, options) => (await whenReady()).superpose(mobileId, options),
      clearSuperposition: async (mobileId) => (await whenReady()).clearSuperposition(mobileId),
      resetCamera: (durationMs) => current()?.resetCamera(durationMs),
      getCamera: () => current()?.getCamera(),
      setCamera: (state, durationMs) => current()?.setCamera(state, durationMs),
      onCameraChange: (listener) => current()?.onCameraChange(listener) ?? (() => {}),
      syncCameraWith(other) {
        const self = current();
        if (!self) return () => {};
        const copy = (state: CameraState, read: () => CameraState | undefined, write: (next: CameraState) => void) => {
          const existing = read();
          if (!existing || !camerasInSync(state, existing)) write(state);
        };
        const toOther = (state: CameraState) => copy(state, () => other.getCamera(), (next) => other.setCamera(next, 0));
        const toSelf = (state: CameraState) => copy(state, () => self.getCamera(), (next) => self.setCamera(next, 0));
        const unlinkSelf = self.onCameraChange(toOther);
        const unlinkOther = other.onCameraChange(toSelf);
        const initial = self.getCamera();
        if (initial) toOther(initial);
        return () => {
          unlinkSelf();
          unlinkOther();
        };
      },
      settled: async () => (await whenReady()).settled(),
      setTheme: (next) => current()?.setTheme(next),
      setReducedMotion: (reduced) => current()?.setReducedMotion(reduced),
      setPerformanceProfile: (profile) => current()?.setPerformanceProfile(profile),
      screenshot: async (options) => (await whenReady()).screenshot(options),
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}
```

- The component file itself has no static Mol\* import, so server rendering and the route's first-load JS never include Mol\*.
- Strict mode: the first effect run is cancelled while Mol\* is still initializing and its plugin is disposed as soon as it exists. The handle object stays the same when the controller is re-created. Fast Refresh goes through the same cleanup path but was not tested.
- Handle methods that return a promise wait for readiness. Synchronous ones (`highlight`, `select`, `focus`, `setVisibility`, camera getters) are no-ops before readiness.
- Consumer effects must be cancellation-safe as well, because strict mode runs them twice (section 5.3).

### 4.3 Load mmCIF, BinaryCIF or PDB from a URL or from memory

Status: [R] remote AlphaFold DB bcif by URL, local bcif and cif by URL, PDB text through `rawData`. `assemblyId` path is [T] only.

`web/src/viewer/load.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StateObjectSelector } from "molstar/lib/mol-state";
import type { PluginStateObject } from "molstar/lib/mol-plugin-state/objects";
import { Asset } from "molstar/lib/mol-util/assets";

/** "mmcif" covers text mmCIF and BinaryCIF, set isBinary for .bcif */
export type StructureFormat = "mmcif" | "pdb";

export type StructureSource =
  | { kind: "url"; url: string; format: StructureFormat; isBinary?: boolean; label?: string }
  | { kind: "data"; data: string | ArrayBuffer | Uint8Array<ArrayBuffer>; format: StructureFormat; label?: string };

export interface LoadedStructure {
  dataRef: string;
  model: StateObjectSelector<PluginStateObject.Molecule.Model>;
  structure: StateObjectSelector<PluginStateObject.Molecule.Structure>;
}

export async function loadStructure(
  plugin: PluginContext,
  source: StructureSource,
  options: { assemblyId?: string } = {},
): Promise<LoadedStructure> {
  const data =
    source.kind === "url"
      ? await plugin.builders.data.download(
          { url: Asset.Url(source.url), isBinary: source.isBinary ?? false, label: source.label },
          { state: { isGhost: true } },
        )
      : await plugin.builders.data.rawData({ data: source.data, label: source.label }, { state: { isGhost: true } });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, source.format);
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(
    model,
    options.assemblyId ? { name: "assembly", params: { id: options.assemblyId } } : { name: "model", params: {} },
  );
  return { dataRef: data.ref, model, structure };
}

/** Deleting the data node removes the whole subtree (model, structure, components, representations). */
export async function removeStructure(plugin: PluginContext, loaded: LoadedStructure): Promise<void> {
  await plugin.build().delete(loaded.dataRef).commit();
}

export const rcsbBcifUrl = (pdbId: string) => `https://models.rcsb.org/${pdbId.toLowerCase()}.bcif`;

/** Subset of the fields returned by the AlphaFold DB prediction API. */
export interface AlphaFoldDbEntry {
  modelEntityId: string;
  uniprotAccession: string;
  latestVersion: number;
  globalMetricValue: number;
  bcifUrl: string;
  cifUrl: string;
  paeDocUrl: string;
}

/** One entry per isoform model. File URLs carry the model version, so always resolve them here. */
export async function resolveAlphaFoldDb(uniprotAccession: string, signal?: AbortSignal): Promise<AlphaFoldDbEntry[]> {
  const url = `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(uniprotAccession)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`AlphaFold DB lookup failed for ${uniprotAccession}: HTTP ${response.status}`);
  return (await response.json()) as AlphaFoldDbEntry[];
}
```

Endpoints, all returning `access-control-allow-origin: *` [H]:

| Source | Request | Response |
| --- | --- | --- |
| AlphaFold DB API | `GET https://alphafold.ebi.ac.uk/api/prediction/{uniprotAccession}` | JSON array, one object per model. `P42224` returns two (`AF-P42224-F1`, `AF-P42224-2-F1`). Fields seen: `modelEntityId`, `uniprotAccession`, `latestVersion` (6), `allVersions`, `globalMetricValue`, `fractionPlddtVeryLow/Low/Confident/VeryHigh`, `sequenceStart`, `sequenceEnd`, `bcifUrl`, `cifUrl`, `pdbUrl`, `paeDocUrl`, `plddtDocUrl`, `amAnnotationsUrl`, `isComplex` |
| AlphaFold DB file | `https://alphafold.ebi.ac.uk/files/AF-P42224-F1-model_v6.bcif` | 267 kB raw, 84 kB gzip on the wire. `.cif`: 713 kB raw, 153 kB gzip. `.pdb`: 507 kB. `AF-P42224-F1-model_v4.cif` returns 404 |
| RCSB BinaryCIF | `https://models.rcsb.org/1yvl.bcif` | about 700 kB raw, 167 kB brotli |
| RCSB mmCIF / PDB | `https://files.rcsb.org/download/1YVL.cif`, `.pdb` | 285 kB gzip for the cif |
| PDBe BinaryCIF | `https://www.ebi.ac.uk/pdbe/entry-files/1yvl.bcif` | 111 kB gzip |
| PDBe updated mmCIF | `https://www.ebi.ac.uk/pdbe/entry-files/download/1bf5_updated.cif` | 767 kB raw |

- `format: "mmcif"` with `isBinary: true` handles `.bcif`; the same format name handles text mmCIF [R].
- In production route these through the FastAPI backend when provenance logging or caching is required. The loader does not care which origin serves the bytes.

### 4.4 Representations: build, switch, hide, fade

Status: [R] cartoon, molecular-surface, ball-and-stick, spacefill switched in place with the colour theme preserved; visibility flag and alpha read back from state.

`web/src/viewer/representations.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StateObjectSelector } from "molstar/lib/mol-state";
import type { PluginStateObject } from "molstar/lib/mol-plugin-state/objects";
import { createStructureRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import type { LoadedStructure } from "./load";

export type RepresentationKind = "cartoon" | "molecular-surface" | "ball-and-stick" | "spacefill";
export type RepresentationSelector = StateObjectSelector<PluginStateObject.Molecule.Structure.Representation3D>;

export interface StructureScene {
  loaded: LoadedStructure;
  polymer?: RepresentationSelector;
  ligand?: RepresentationSelector;
  branched?: RepresentationSelector;
  ion?: RepresentationSelector;
}

export async function buildScene(
  plugin: PluginContext,
  loaded: LoadedStructure,
  polymerKind: RepresentationKind = "cartoon",
): Promise<StructureScene> {
  const builder = plugin.builders.structure;
  const scene: StructureScene = { loaded };
  await plugin.dataTransaction(async () => {
    const polymer = await builder.tryCreateComponentStatic(loaded.structure, "polymer");
    if (polymer) {
      scene.polymer = await builder.representation.addRepresentation(polymer, {
        type: polymerKind,
        color: "chain-id",
        colorParams: { asymId: "label" },
      });
    }
    const atoms = { type: "ball-and-stick", color: "element-symbol" } as const;
    const ligand = await builder.tryCreateComponentStatic(loaded.structure, "ligand");
    if (ligand) scene.ligand = await builder.representation.addRepresentation(ligand, atoms);
    const ion = await builder.tryCreateComponentStatic(loaded.structure, "ion");
    if (ion) scene.ion = await builder.representation.addRepresentation(ion, atoms);
    const branched = await builder.tryCreateComponentStatic(loaded.structure, "branched");
    if (branched) {
      const glycan = { type: "carbohydrate", color: "carbohydrate-symbol" } as const;
      scene.branched = await builder.representation.addRepresentation(branched, glycan);
    }
  });
  return scene;
}

/** Swaps the representation type in place and keeps the current colour theme. */
export async function setRepresentationKind(
  plugin: PluginContext,
  representation: RepresentationSelector,
  kind: RepresentationKind,
): Promise<void> {
  const cell = representation.cell;
  const structure = cell?.obj?.data.sourceData;
  const previous = cell?.transform.params;
  if (!structure || !previous) return;
  const next = createStructureRepresentationParams(plugin, structure, { type: kind });
  next.colorTheme = previous.colorTheme;
  await plugin.build().to(representation).update(next).commit();
}

/** Works for any state ref: pass a representation ref to toggle a single representation. */
export function setStructureVisibility(plugin: PluginContext, loaded: LoadedStructure, visible: boolean): void {
  setSubtreeVisibility(plugin.state.data, loaded.structure.ref, !visible);
}

export async function setRepresentationAlpha(
  plugin: PluginContext,
  representation: RepresentationSelector,
  alpha: number,
): Promise<void> {
  const update = plugin.build().to(representation).update((old) => {
    old.type.params.alpha = alpha;
  });
  await update.commit();
}
```

- Registered structure representation names in 5.12.0 [S]: `cartoon`, `backbone`, `ball-and-stick`, `blob-surface`, `carbohydrate`, `ellipsoid`, `gaussian-surface`, `gaussian-volume`, `label`, `line`, `molecular-surface`, `orientation`, `plane`, `point`, `putty`, `spacefill`, `polyhedron`. The `Interactions` behaviour adds `interactions` and the `interaction-type` colour theme.
- Static component types [S]: `all`, `polymer`, `protein`, `nucleic`, `water`, `ion`, `lipid`, `branched`, `ligand`, `non-standard`, `coarse`. `tryCreateComponentStatic` returns `undefined` when the selection is empty.

### 4.5 Colour themes

Status: [R] every mode below applied and the resulting colour of a known residue read back from the live theme.

`web/src/viewer/themes.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { createStructureColorThemeParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { Color } from "molstar/lib/mol-util/color";
import type { RepresentationSelector } from "./representations";
import { RESIDUE_DATA_THEME } from "./residue-data-theme";

export type ColorMode =
  | { kind: "chain" }
  | { kind: "secondary-structure" }
  | { kind: "plddt" }
  | { kind: "b-factor"; domain?: [number, number] }
  | { kind: "element" }
  | { kind: "uniform"; color: number }
  | { kind: "residue-data"; datasetId: string; version: number };

function themeFor(mode: ColorMode): { name: string; params?: Record<string, unknown> } {
  // prettier-ignore
  switch (mode.kind) {
    case "chain": return { name: "chain-id", params: { asymId: "label" } };
    case "secondary-structure": return { name: "secondary-structure" };
    case "plddt": return { name: "plddt-confidence" };
    case "b-factor": return { name: "uncertainty", params: { domain: mode.domain ?? [0, 100] } };
    case "element": return { name: "element-symbol", params: { carbonColor: { name: "element-symbol", params: {} } } };
    case "uniform": return { name: "uniform", params: { value: Color(mode.color) } };
    case "residue-data": return { name: RESIDUE_DATA_THEME, params: { datasetId: mode.datasetId, version: mode.version } };
  }
}

/** Pass the representations of one structure for per-structure colouring, or of all structures. */
export async function setColorMode(
  plugin: PluginContext,
  representations: RepresentationSelector[],
  mode: ColorMode,
): Promise<void> {
  const { name, params } = themeFor(mode);
  const update = plugin.build();
  for (const representation of representations) {
    const cell = representation.cell;
    if (!cell?.obj || !cell.transform.params) continue;
    const typeName = cell.transform.params.type.name;
    const colorTheme = createStructureColorThemeParams(plugin, cell.obj.data.sourceData, typeName, name, params);
    update.to(representation).update((old) => {
      old.colorTheme = colorTheme;
    });
  }
  await update.commit();
}
```

| `ColorMode.kind` | Mol\* theme name | Source of values | Read-back on AF-P42224-F1 |
| --- | --- | --- | --- |
| `plddt` | `plddt-confidence` (extension, registered in 4.1) | `ma_qa_metric_local`, else B-factor column | residue 1 (pLDDT 64.25) `#ffdb13`, residue 150 (97.44) `#0053d6`; identical for the `.pdb` file through the B-factor fallback |
| `chain` | `chain-id` | `label_asym_id` | `#1b9e77` |
| `secondary-structure` | `secondary-structure` | computed or file-provided secondary structure | residue 150 `#e84481`, residue 1 `#ffffff` |
| `uniform` | `uniform` | `value` | `#336699` as requested |
| `b-factor` | `uncertainty` | B-factor column, `red-white-blue` scale over `domain`, high values red | `#c22d2d` for 97.44 on 0 to 100. Intended for experimental structures |
| `element` | `element-symbol` | element colours, carbons included | used for ligands and sticks in 4.9 |
| `residue-data` | `orphafold-residue-data` (4.6) | OrphaFold data | |

All 39 built-in names are the keys of `ColorTheme.BuiltIn` in `molstar/lib/mol-theme/color` [S].

### 4.6 Custom per-residue colour theme driven by OrphaFold data

Status: [R] domain colours, a single variant residue and the fallback colour read back; updating the dataset and bumping `version` recoloured without recreating the representation; colours survive representation switches; two viewers held different datasets for the same structure id [N].

`web/src/viewer/residue-data-theme.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Bond, Model, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import type { ColorTheme, LocationColor } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";

export const RESIDUE_DATA_THEME = "orphafold-residue-data";

export interface ResidueColorDataset {
  /** which identifiers the keys use: label_asym_id + label_seq_id, or auth_asym_id + auth_seq_id */
  numbering: "label" | "auth";
  /** key `${asymId}:${seqId}`, value 0xRRGGBB */
  colors: ReadonlyMap<string, number>;
  /** colour for residues without a value */
  fallback: number;
}

const datasets = new Map<string, ResidueColorDataset>();

export function setResidueColorDataset(datasetId: string, dataset: ResidueColorDataset): void {
  datasets.set(datasetId, dataset);
}

export function deleteResidueColorDataset(datasetId: string): void {
  datasets.delete(datasetId);
}

// Only the id and a version live in Mol* state; bumping the version makes Mol* rebuild the colours.
const ResidueDataThemeParams = {
  datasetId: PD.Text("", { isHidden: true }),
  version: PD.Numeric(0, undefined, { isHidden: true }),
};
type ResidueDataThemeParams = typeof ResidueDataThemeParams;

function colorsByResidueIndex(model: Model, dataset: ResidueColorDataset): Uint32Array {
  const { residues, chains, residueAtomSegments, chainAtomSegments } = model.atomicHierarchy;
  const colors = new Uint32Array(residues._rowCount);
  const useAuth = dataset.numbering === "auth";
  for (let residueIndex = 0; residueIndex < residues._rowCount; residueIndex++) {
    const chainIndex = chainAtomSegments.index[residueAtomSegments.offsets[residueIndex]];
    const asymId = useAuth ? chains.auth_asym_id.value(chainIndex) : chains.label_asym_id.value(chainIndex);
    const seqId = useAuth ? residues.auth_seq_id.value(residueIndex) : residues.label_seq_id.value(residueIndex);
    colors[residueIndex] = dataset.colors.get(`${asymId}:${seqId}`) ?? dataset.fallback;
  }
  return colors;
}

export function ResidueDataColorTheme(
  ctx: ThemeDataContext,
  props: PD.Values<ResidueDataThemeParams>,
): ColorTheme<ResidueDataThemeParams> {
  const dataset = datasets.get(props.datasetId);
  const fallback = Color(dataset?.fallback ?? 0x8a8f98);
  const perModel = new Map<Model, Uint32Array>();
  if (dataset && ctx.structure) {
    for (const model of ctx.structure.models) perModel.set(model, colorsByResidueIndex(model, dataset));
  }

  const atomColor = (unit: Unit, element: number): Color => {
    if (!Unit.isAtomic(unit)) return fallback;
    const colors = perModel.get(unit.model);
    return colors ? Color(colors[unit.model.atomicHierarchy.residueAtomSegments.index[element]]) : fallback;
  };
  const color: LocationColor = (location) => {
    if (StructureElement.Location.is(location)) return atomColor(location.unit, location.element);
    if (Bond.isLocation(location)) return atomColor(location.aUnit, location.aUnit.elements[location.aIndex]);
    return fallback;
  };

  return {
    factory: ResidueDataColorTheme,
    granularity: "group",
    preferSmoothing: true,
    color,
    props,
    description: "Per-residue colours supplied by OrphaFold",
  };
}

export const ResidueDataColorThemeProvider: ColorTheme.Provider<ResidueDataThemeParams, typeof RESIDUE_DATA_THEME> = {
  name: RESIDUE_DATA_THEME,
  label: "OrphaFold residue data",
  category: ColorThemeCategory.Misc,
  factory: ResidueDataColorTheme,
  getParams: () => ResidueDataThemeParams,
  defaultValues: PD.getDefaultValues(ResidueDataThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};

/** registry.add throws on a duplicate name, so guard it. */
export function registerResidueDataTheme(plugin: PluginContext): void {
  const registry = plugin.representation.structure.themes.colorThemeRegistry;
  if (!registry.has(ResidueDataColorThemeProvider)) registry.add(ResidueDataColorThemeProvider);
}
```

Usage for the three OrphaFold cases (domains, variant impact, difference values). Same calls as in the browser tests, [T] in this form:

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { ColorScale } from "molstar/lib/mol-util/color/scale";
import { setResidueColorDataset } from "./residue-data-theme";
import { setColorMode } from "./themes";
import type { StructureScene } from "./representations";

export async function colourByDomainsThenDifferences(
  plugin: PluginContext,
  scene: StructureScene,
  differences: Map<string, number>,
): Promise<void> {
  if (!scene.polymer) return;

  // domains or variant impact: categorical colours chosen by the app
  const colors = new Map<string, number>();
  for (let seqId = 136; seqId <= 317; seqId++) colors.set(`A:${seqId}`, 0x1b9e77);
  colors.set("A:274", 0xff0000);
  setResidueColorDataset("stat1", { numbering: "label", colors, fallback: 0x8a8f98 });
  await setColorMode(plugin, [scene.polymer], { kind: "residue-data", datasetId: "stat1", version: 1 });

  // per-residue difference values: diverging scale with a symmetric domain
  const scale = ColorScale.create({ listOrName: "red-white-blue", domain: [-2, 2] });
  const differenceColors = new Map<string, number>();
  for (const [key, value] of differences) differenceColors.set(key, scale.color(value));
  setResidueColorDataset("stat1", { numbering: "label", colors: differenceColors, fallback: 0x8a8f98 });
  await setColorMode(plugin, [scene.polymer], { kind: "residue-data", datasetId: "stat1", version: 2 });
}
```

- `ColorScale` output for -2, -1, 0, 1, 2 on that scale: `#bf2222`, `#df9090`, `#ffffff`, `#99b0f0`, `#3361e1` [D].
- Keep dataset ids unique per viewer instance, because the registry is module-wide. The controller prefixes them (section 5.2).

### 4.7 Select, highlight and focus residues by chain and sequence number

Status: [R] highlight verified by pixel count in screenshots (2 highlight-coloured pixels before, 2,733 while highlighted, 1 after clearing), selection size matched the expected atom count for a mixed `label` and `auth` request, focus moved the camera target and radius, highlight also verified on a superposed (transformed) structure.

`web/src/viewer/selection.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { EmptyLoci } from "molstar/lib/mol-model/loci";
import { Structure, StructureElement } from "molstar/lib/mol-model/structure";
import { StateTree } from "molstar/lib/mol-state";
import type { LoadedStructure } from "./load";

export interface ResidueRange {
  /** label_asym_id, or auth_asym_id when numbering is "auth" */
  chain: string;
  start: number;
  end?: number;
  numbering?: "label" | "auth";
}

/** The structure as displayed, including a superposition transform decorating the structure node. */
export function getStructureData(plugin: PluginContext, loaded: LoadedStructure): Structure | undefined {
  const state = plugin.state.data;
  const ref = StateTree.getDecoratorRoot(state.tree, loaded.structure.ref);
  return state.cells.get(ref)?.obj?.data as Structure | undefined;
}

export function lociForRanges(structure: Structure, ranges: ResidueRange[]): StructureElement.Loci {
  if (ranges.length === 0) return StructureElement.Loci.none(structure);
  return StructureElement.Loci.fromSchema(structure, {
    items: ranges.map((range) =>
      range.numbering === "auth"
        ? { auth_asym_id: range.chain, beg_auth_seq_id: range.start, end_auth_seq_id: range.end ?? range.start }
        : { label_asym_id: range.chain, beg_label_seq_id: range.start, end_label_seq_id: range.end ?? range.start },
    ),
  });
}

export function highlightResidues(plugin: PluginContext, loaded: LoadedStructure, ranges: ResidueRange[]): void {
  const structure = getStructureData(plugin, loaded);
  if (structure) plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: lociForRanges(structure, ranges) });
}

export function clearHighlight(plugin: PluginContext): void {
  plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: EmptyLoci });
}

export function selectResidues(plugin: PluginContext, loaded: LoadedStructure, ranges: ResidueRange[]): void {
  const structure = getStructureData(plugin, loaded);
  if (structure) plugin.managers.interactivity.lociSelects.selectOnly({ loci: lociForRanges(structure, ranges) });
}

export function clearSelection(plugin: PluginContext): void {
  plugin.managers.interactivity.lociSelects.deselectAll();
}

export function focusResidues(
  plugin: PluginContext,
  loaded: LoadedStructure,
  ranges: ResidueRange[],
  options: { durationMs?: number; extraRadius?: number } = {},
): void {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return;
  const loci = lociForRanges(structure, ranges);
  if (StructureElement.Loci.isEmpty(loci)) return;
  const { durationMs = 250, extraRadius = 4 } = options;
  plugin.managers.camera.focusLoci(loci, { durationMs, extraRadius, minRadius: 8 });
}
```

- `StructureElement.SchemaItem` also accepts `label_seq_id`, `auth_seq_id`, `pdbx_PDB_ins_code`, `label_comp_id`, `label_atom_id`, `type_symbol`, `label_entity_id`, `operator_name`, `instance_id` [S]. `Loci.fromSchema` and `StructureElement.Schema` exist since 4.13.0.
- Highlight is transient and is replaced by the next hover. Selection persists until cleared. Both are markers on existing geometry and do not create state nodes [S].

### 4.8 Hover and click events resolved to chain, residue number and residue name

Status: [R] real pointer events from Playwright: hover produced `A LYS 344` and a click produced the same pick with `button: "primary"`; [N] hover text rendered by React.

`web/src/viewer/events.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { Loci } from "molstar/lib/mol-model/loci";
import { Bond, StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { ButtonsType } from "molstar/lib/mol-util/input/input-observer";

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

export interface PickHandlers {
  onHover?: (pick: ResiduePick | undefined) => void;
  onClick?: (pick: ResiduePick | undefined, info: PickInfo) => void;
}

export function lociToResiduePick(plugin: PluginContext, loci: Loci): ResiduePick | undefined {
  const elementLoci = StructureElement.Loci.is(loci) ? loci : Bond.isLoci(loci) ? Bond.toStructureElementLoci(loci) : undefined;
  if (!elementLoci) return undefined;
  const location = StructureElement.Loci.getFirstLocation(elementLoci);
  if (!location) return undefined;
  return {
    structureRef: plugin.helpers.substructureParent.get(elementLoci.structure)?.transform.ref,
    entryId: StructureProperties.unit.model_entry_id(location),
    labelAsymId: StructureProperties.chain.label_asym_id(location),
    authAsymId: StructureProperties.chain.auth_asym_id(location),
    labelSeqId: StructureProperties.residue.label_seq_id(location),
    authSeqId: StructureProperties.residue.auth_seq_id(location),
    insertionCode: StructureProperties.residue.pdbx_PDB_ins_code(location),
    compId: StructureProperties.atom.label_comp_id(location),
    atomName: StructureProperties.atom.label_atom_id(location),
    bFactor: StructureProperties.atom.B_iso_or_equiv(location),
  };
}

/** Returns an unsubscribe function. */
export function subscribePicks(plugin: PluginContext, handlers: PickHandlers): () => void {
  let lastHoverKey = "";
  const hover = plugin.behaviors.interaction.hover.subscribe(({ current }) => {
    const pick = lociToResiduePick(plugin, current.loci);
    const key = pick ? `${pick.structureRef}|${pick.labelAsymId}|${pick.authSeqId}|${pick.insertionCode}` : "";
    if (key === lastHoverKey) return;
    lastHoverKey = key;
    handlers.onHover?.(pick);
  });

  // BehaviorSubject replays its stale initial value on subscribe, which is not a user click
  let isInitialClick = true;
  const click = plugin.behaviors.interaction.click.subscribe(({ current, button, modifiers }) => {
    if (isInitialClick) {
      isInitialClick = false;
      return;
    }
    const { Primary, Secondary } = ButtonsType.Flag;
    const pressed = button === Primary ? "primary" : button === Secondary ? "secondary" : "other";
    handlers.onClick?.(lociToResiduePick(plugin, current.loci), { button: pressed, shift: modifiers.shift });
  });

  return () => {
    hover.unsubscribe();
    click.unsubscribe();
  };
}
```

- Picking granularity defaults to `residue`, so the first atom of the residue (`N`) is reported as `atomName`. Change with `plugin.managers.interactivity.setProps({ granularity: "element" })` [S].
- Mol\*'s own HTML tooltip text for the hovered loci is available from `plugin.behaviors.labels.highlight` [S].
- Hover already triggers Mol\*'s highlight in 3D through the `HighlightLoci` behaviour. Use `onHover` to drive the sequence track and the tooltip.

### 4.9 Ligand and binding-site residues within N angstrom

Status: [R] [N] on 1CBS with ligand `REA` and radius 5: three components created, 20 residues returned (first four `PHE15`, `LEU19`, `VAL24`, `LEU28`), components removed again. The interaction lines were created without error; their chemistry was not inspected. Requires `PluginBehaviors.CustomProps.Interactions` in the spec (4.1).

`web/src/viewer/binding-site.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { InteractionsRepresentationProvider } from "molstar/lib/mol-model-props/computed/representations/interactions";
import { InteractionTypeColorThemeProvider } from "molstar/lib/mol-model-props/computed/themes/interaction-type";
import type { LoadedStructure } from "./load";
import { getStructureData } from "./selection";

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

export interface BindingSite {
  /** state refs of the added components, delete them to hide the site */
  refs: string[];
  residues: BindingSiteResidue[];
}

export async function showBindingSite(
  plugin: PluginContext,
  loaded: LoadedStructure,
  ligand: LigandSelector,
  radius = 5,
): Promise<BindingSite | undefined> {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return undefined;

  const ligandExpression = StructureElement.Schema.toExpression({
    label_comp_id: ligand.compId,
    auth_asym_id: ligand.authAsymId,
    auth_seq_id: ligand.authSeqId,
  });
  const ligandWithSite = MS.struct.modifier.includeSurroundings({ 0: ligandExpression, radius, "as-whole-residues": true });
  const siteOnly = MS.struct.modifier.exceptBy({ 0: ligandWithSite, by: ligandExpression });

  const residues: BindingSiteResidue[] = [];
  const seen = new Set<string>();
  StructureElement.Loci.forEachLocation(StructureElement.Loci.fromExpression(structure, siteOnly), (location) => {
    if (StructureProperties.entity.type(location) === "water") return;
    const residue: BindingSiteResidue = {
      labelAsymId: StructureProperties.chain.label_asym_id(location),
      authAsymId: StructureProperties.chain.auth_asym_id(location),
      labelSeqId: StructureProperties.residue.label_seq_id(location),
      authSeqId: StructureProperties.residue.auth_seq_id(location),
      compId: StructureProperties.atom.label_comp_id(location),
    };
    const residueKey = `${residue.labelAsymId}:${residue.authSeqId}:${residue.compId}`;
    if (seen.has(residueKey)) return;
    seen.add(residueKey);
    residues.push(residue);
  });

  const refs: string[] = [];
  const builder = plugin.builders.structure;
  await plugin.dataTransaction(async () => {
    const key = ligand.compId;
    const ligandComponent = await builder.tryCreateComponentFromExpression(loaded.structure, ligandExpression, `ligand-${key}`);
    if (ligandComponent) {
      refs.push(ligandComponent.ref);
      await builder.representation.addRepresentation(ligandComponent, {
        type: "ball-and-stick",
        color: "element-symbol",
        colorParams: { carbonColor: { name: "element-symbol", params: {} } },
        typeParams: { sizeFactor: 0.3 },
      });
    }
    const siteComponent = await builder.tryCreateComponentFromExpression(loaded.structure, siteOnly, `site-${key}`);
    if (siteComponent) {
      refs.push(siteComponent.ref);
      const sticks = { type: "ball-and-stick", color: "element-symbol", typeParams: { sizeFactor: 0.16 } } as const;
      await builder.representation.addRepresentation(siteComponent, sticks);
    }
    const contactsComponent = await builder.tryCreateComponentFromExpression(loaded.structure, ligandWithSite, `contacts-${key}`);
    if (contactsComponent) {
      refs.push(contactsComponent.ref);
      await builder.representation.addRepresentation(contactsComponent, {
        type: InteractionsRepresentationProvider,
        color: InteractionTypeColorThemeProvider,
      });
    }
  });

  plugin.managers.camera.focusLoci(StructureElement.Loci.fromExpression(structure, ligandWithSite), { extraRadius: 2 });
  return { refs, residues };
}

export async function removeRefs(plugin: PluginContext, refs: string[]): Promise<void> {
  const update = plugin.build();
  for (const ref of refs) update.delete(ref);
  await update.commit();
}
```

### 4.10 Labels

Status: [R] label node created and removed; text rendered next to the residue in the Next.js demo.

`web/src/viewer/labels.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { StructureElement } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import type { LoadedStructure } from "./load";
import { getStructureData, lociForRanges, ResidueRange } from "./selection";

/** Adds a 3D text label anchored to a residue (range). Returns the state ref used to remove it. */
export async function addResidueLabel(
  plugin: PluginContext,
  loaded: LoadedStructure,
  range: ResidueRange,
  text: string,
  options: { textColor?: number; borderColor?: number; textSize?: number } = {},
): Promise<string | undefined> {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return undefined;
  const loci = lociForRanges(structure, [range]);
  if (StructureElement.Loci.isEmpty(loci)) return undefined;

  const label = await plugin.managers.structure.measurement.addLabel(loci, {
    reprTags: "orphafold-label",
    visualParams: {
      customText: text,
      textColor: Color(options.textColor ?? 0x111111),
      borderColor: Color(options.borderColor ?? 0xffffff),
      borderWidth: 0.25,
      textSize: options.textSize ?? 0.6,
      scaleByRadius: false,
    },
  });
  return label?.selection.ref;
}

export async function removeLabel(plugin: PluginContext, labelRef: string): Promise<void> {
  await plugin.build().delete(labelRef).commit();
}
```

### 4.11 Camera: reset, animated focus, settle, reduced motion, two-viewer sync

Status: [R] reset and focus radii read back; a 400 ms focus showed an intermediate radius at 150 ms (animated) and the final radius afterwards; with Chrome's reduced-motion emulation the same call finished within two frames; camera sync verified in both directions with programmatic moves, an animated focus and a real mouse drag (positions identical to three decimals), including two viewers with different scenes (scene radius 103.8 and 91.0: positions equal, each side keeps a valid clipping radius).

`web/src/viewer/camera-sync.ts` (no Mol\* import, safe to import statically from React components)

```ts
/** Plain camera description. Structurally compatible with Mol* `Camera.Snapshot`. This module must stay free of Mol* imports. */
export interface CameraState {
  mode: "perspective" | "orthographic";
  position: ArrayLike<number>;
  target: ArrayLike<number>;
  up: ArrayLike<number>;
  /** clipping and fog radius around the target */
  radius: number;
  /** radius of the viewer's own scene; each camera clamps `radius` to it */
  radiusMax: number;
  fov: number;
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/**
 * True when both cameras already show the same view. Radii count as equal when one side is the other
 * side's radius clamped to its own scene, otherwise two viewers with different scenes would echo forever.
 */
export function camerasInSync(a: CameraState, b: CameraState): boolean {
  const radiiMatch =
    Math.abs(Math.min(a.radius, b.radiusMax) - b.radius) < 1e-6 || Math.abs(Math.min(b.radius, a.radiusMax) - a.radius) < 1e-6;
  return a.mode === b.mode && a.fov === b.fov && radiiMatch && close(a.position, b.position) && close(a.target, b.target) && close(a.up, b.up);
}
```

`web/src/viewer/camera.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import type { Camera } from "molstar/lib/mol-canvas3d/camera";
import { camerasInSync } from "./camera-sync";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionDuration(durationMs = 250): number {
  return prefersReducedMotion() ? 0 : durationMs;
}

/** Frames the whole scene. */
export function resetCamera(plugin: PluginContext, durationMs = motionDuration()): Promise<void> {
  return PluginCommands.Camera.Reset(plugin, { durationMs });
}

/**
 * Camera commands and scene changes are applied on a later animation frame.
 * Await this before reading the camera or taking a screenshot.
 */
export function viewerSettled(plugin: PluginContext, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let frameCount = 0;
    const check = () => {
      frameCount += 1;
      const canvas = plugin.canvas3d;
      const pending = !!canvas && (canvas.commitQueueSize.value > 0 || canvas.camera.transition.inTransition);
      const busy = pending || plugin.behaviors.state.isUpdating.value;
      if ((frameCount >= 2 && !busy) || performance.now() > deadline) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** Mol* has no reduced-motion handling of its own; call again when the media query changes. */
export function applyMotionPreference(plugin: PluginContext, reducedMotion: boolean): void {
  plugin.canvas3d?.setProps({
    cameraResetDurationMs: reducedMotion ? 0 : 250,
    renderer: { enableAnimation: !reducedMotion },
    trackball: { animate: { name: "off", params: {} } },
  });
}

/** Two-way camera lock between two plugin instances. Returns an unsubscribe function. */
export function syncCameras(first: PluginContext, second: PluginContext): () => void {
  const firstCamera = first.canvas3d?.camera;
  const secondCamera = second.canvas3d?.camera;
  if (!firstCamera || !secondCamera) return () => {};

  const copy = (source: Camera, target: Camera, targetPlugin: PluginContext) => {
    // `changed` also fires on anti-aliasing jitter frames, so always compare before writing
    if (camerasInSync(source.state, target.state)) return;
    // radiusMax describes the target's own scene and must not be overwritten
    const { radiusMax, ...view } = source.getSnapshot();
    void radiusMax;
    target.setState(view, 0);
    targetPlugin.canvas3d?.requestDraw();
  };
  const firstSubscription = firstCamera.changed.subscribe(() => copy(firstCamera, secondCamera, second));
  const secondSubscription = secondCamera.changed.subscribe(() => copy(secondCamera, firstCamera, first));
  copy(firstCamera, secondCamera, second);

  return () => {
    firstSubscription.unsubscribe();
    secondSubscription.unsubscribe();
  };
}
```

Reduced motion checklist:

- Mol\* 5.12.0 contains no reference to `prefers-reduced-motion` [S]. Everything below is ours.
- At creation (`createViewerSpec`): click-to-focus `durationMs: 0`, `cameraResetDurationMs: 0`, `renderer.enableAnimation: false`, trackball `animate: off` [R].
- At runtime: `applyMotionPreference` plus `durationMs: 0` on every `focusLoci` and `Camera.Reset` call. The controller does this through its `duration()` helper.
- In React: subscribe to `matchMedia("(prefers-reduced-motion: reduce)")` and pass the result as the `reducedMotion` prop.
- Never enable trackball `spin` or `rock`. The trackball has no inertia by default (`staticMoving: true`) [S].

### 4.12 Canvas theme, PNG screenshot, performance profile

Status: [R] background, highlight and select colours read back and confirmed in screenshot pixels (95% of pixels equal to the dark background colour); outline toggled (3,448 near-black pixels with, 5 without); screenshots at viewport size and at 1600x1200 decoded with the right dimensions; canvas size 1280x960, 960x720, 640x480 for the three profiles at `devicePixelRatio` 2; render loop stop and start.

`web/src/viewer/canvas.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultCanvas3DParams } from "molstar/lib/mol-canvas3d/canvas3d";
import { Color } from "molstar/lib/mol-util/color";

export interface ViewerTheme {
  background: number;
  highlight: number;
  select: number;
  /** dark silhouette lines, keeps pale colours readable on a white canvas */
  outline?: boolean;
}

/** Call whenever the app theme changes; takes effect on the next frame, no reload. */
export function applyViewerTheme(plugin: PluginContext, theme: ViewerTheme): void {
  plugin.canvas3d?.setProps({
    renderer: {
      backgroundColor: Color(theme.background),
      highlightColor: Color(theme.highlight),
      selectColor: Color(theme.select),
    },
    postprocessing: {
      outline: theme.outline
        ? { name: "on", params: { scale: 1, threshold: 0.33, color: Color(0x000000), includeTransparent: true } }
        : { name: "off", params: {} },
    },
  });
}

/** PNG data URL of the current view; without width and height it uses the viewport size. */
export async function screenshotPng(
  plugin: PluginContext,
  options: { width?: number; height?: number; transparent?: boolean } = {},
): Promise<string> {
  const helper = plugin.helpers.viewportScreenshot;
  if (!helper) throw new Error("Viewer is not initialized");
  helper.behaviors.values.next({
    ...helper.values,
    format: { name: "png", params: {} },
    transparent: options.transparent ?? false,
    resolution: options.width && options.height
      ? { name: "custom", params: { width: options.width, height: options.height } }
      : { name: "viewport", params: {} },
  });
  return helper.getImageDataUri();
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export type PerformanceProfile = "quality" | "balanced" | "fast";

export function applyPerformanceProfile(plugin: PluginContext, profile: PerformanceProfile): void {
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // desktop canvas pixels = CSS pixels * devicePixelRatio * pixelScale
  const targetRatio = profile === "fast" ? 1 : profile === "balanced" ? 1.5 : devicePixelRatio;
  const pixelScale = Math.min(1, targetRatio / devicePixelRatio);
  plugin.canvas3dContext?.setProps({ pixelScale });
  plugin.canvas3d?.setProps({
    multiSample: { mode: profile === "fast" ? "off" : "temporal" },
    postprocessing: {
      occlusion: profile === "fast" ? { name: "off", params: {} } : DefaultCanvas3DParams.postprocessing.occlusion,
    },
  });
}

/** Stops the render loop while the viewer is off screen or the tab is hidden. Returns a cleanup function. */
export function pauseWhenHidden(plugin: PluginContext, element: HTMLElement): () => void {
  let onScreen = true;
  const update = () => {
    const shouldRun = onScreen && document.visibilityState === "visible";
    if (shouldRun && !plugin.animationLoop.isAnimating) plugin.animationLoop.start();
    else if (!shouldRun && plugin.animationLoop.isAnimating) plugin.animationLoop.stop();
  };
  const observer = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    update();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", update);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
  };
}
```

- The screenshot helper renders through its own image pass, so the output size is independent of the on-screen canvas [R].
- Theme switching needs no reload and no new plugin. Colours inside the scene (pLDDT, chains) are data colours and stay identical in light and dark mode.

### 4.13 Overlay: load two structures, superpose, colour and toggle each

Status: [R] [N] [D].

`web/src/viewer/superpose.ts`

```ts
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Mat4 } from "molstar/lib/mol-math/linear-algebra";
import { StructureElement } from "molstar/lib/mol-model/structure";
import { alignAndSuperpose } from "molstar/lib/mol-model/structure/structure/util/superposition";
import { tmAlign } from "molstar/lib/mol-model/structure/structure/util/tm-align";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import type { LoadedStructure } from "./load";

export interface ChainRef {
  /** auth_asym_id, or label_asym_id when numbering is "label" */
  chain: string;
  numbering?: "label" | "auth";
}

export interface SuperpositionResult {
  method: "sequence-ca" | "tm-align";
  /** C-alpha RMSD in angstrom over the aligned residue pairs */
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

const SUPERPOSITION_TAG = "orphafold-superposition";

function caLoci(loaded: LoadedStructure, chain: ChainRef): StructureElement.Loci {
  // untransformed coordinates on purpose, so a new transform replaces the old one instead of stacking
  const structure = loaded.structure.cell?.obj?.data;
  if (!structure) throw new Error("Structure is not loaded");
  const chainKey = chain.numbering === "label" ? "label_asym_id" : "auth_asym_id";
  return StructureElement.Loci.fromSchema(structure, { [chainKey]: chain.chain, label_atom_id: "CA" });
}

export function computeSuperposition(
  reference: LoadedStructure,
  referenceChain: ChainRef,
  mobile: LoadedStructure,
  mobileChain: ChainRef,
  method: "sequence-ca" | "tm-align" = "sequence-ca",
): SuperpositionResult {
  const referenceLoci = caLoci(reference, referenceChain);
  const mobileLoci = caLoci(mobile, mobileChain);
  const counts = {
    referenceCaCount: StructureElement.Loci.size(referenceLoci),
    mobileCaCount: StructureElement.Loci.size(mobileLoci),
  };
  if (counts.referenceCaCount < 3 || counts.mobileCaCount < 3) throw new Error("Not enough C-alpha atoms to superpose");
  // alignAndSuperpose only reads the first unit of each loci
  if (referenceLoci.elements.length !== 1 || mobileLoci.elements.length !== 1) {
    throw new Error("Superposition expects exactly one chain per structure");
  }

  if (method === "tm-align") {
    const result = tmAlign(referenceLoci, mobileLoci);
    const { rmsd, alignedLength, tmScoreA, tmScoreB, bTransform } = result;
    const scores = { tmScoreReference: tmScoreA, tmScoreMobile: tmScoreB };
    return { method, rmsd, alignedResidues: alignedLength, ...counts, ...scores, transform: Array.from(bTransform) };
  }
  const [result] = alignAndSuperpose([referenceLoci, mobileLoci]);
  const { rmsd, nAlignedElements, alignmentScore, bTransform } = result;
  return { method, rmsd, alignedResidues: nAlignedElements, ...counts, alignmentScore, transform: Array.from(bTransform) };
}

/** Inserts, or updates, the transform node that decorates the mobile structure. */
export async function applySuperposition(plugin: PluginContext, mobile: LoadedStructure, transform: number[]): Promise<void> {
  const existing = plugin.state.data.selectQ((q) => q.byRef(mobile.structure.ref).subtree().withTag(SUPERPOSITION_TAG));
  const params = {
    transform: { name: "matrix" as const, params: { data: Mat4.fromArray(Mat4(), transform, 0), transpose: false } },
  };
  const update = plugin.build();
  if (existing.length > 0) update.to(existing[0]).update(params);
  else update.to(mobile.structure).insert(StateTransforms.Model.TransformStructureConformation, params, { tags: SUPERPOSITION_TAG });
  await update.commit();
}

export function clearSuperposition(plugin: PluginContext, mobile: LoadedStructure): Promise<void> {
  return applySuperposition(plugin, mobile, Array.from(Mat4.identity()));
}
```

Measured on STAT1, AlphaFold DB model chain A as reference:

| Mobile | Method | RMSD | Aligned pairs | Other |
| --- | --- | --- | --- | --- |
| 1YVL chain A (652 C-alpha) | `sequence-ca` | 3.180 A | 652 | identical in Node, the esbuild page and the Next.js app |
| 1YVL chain A | `tm-align` | 3.271 A | 652 | TM-score 0.795 (by reference length 750), 0.907 (by mobile) |
| 1BF5 chain A (545 C-alpha) | `sequence-ca` | 1.850 A | 545 | [D] |
| 1BF5 chain A | `tm-align` | 1.863 A | 545 | TM-score 0.705 / 0.964 [D] |

- `sequence-ca` runs Mol\*'s pairwise alignment on the two entity sequences (affine gaps, open -11, extend -1, BLOSUM62 for protein entities) and then one least-squares fit over all aligned C-alpha pairs [S]. There is no iterative outlier rejection, so the value is usually higher than tools that reject outliers, PyMOL `align` for example. State the method next to the number.
- `tmAlign` is in core since 5.5.0 [S]. `sequenceIdentity` in its result came back as 0 [D]; the structure-level wrapper supplies no sequences.
- Per-structure colour: `setColorMode(plugin, [sceneA.polymer], { kind: "uniform", color })` per scene [R]. Per-structure visibility: `setStructureVisibility` [R]. Per-structure opacity: `setRepresentationAlpha` [R].
- Adding the second structure does not move the camera when `manualReset` is on [R].

### 4.14 Split view

Two `MolecularViewer` instances, one structure each, linked with `handle.syncCameraWith(other)` (component level, [N]) or `syncCameras(pluginA, pluginB)` (plugin level, [R]). Both use `camerasInSync` from 4.11. Wait for `settled()` on both viewers before linking. Hover and selection are shared through OrphaFold state: `onHover` of one viewer calls `highlight` on the other.

### 4.15 Performance levers

| Lever | API | Default | Status |
| --- | --- | --- | --- |
| Render resolution | `plugin.canvas3dContext.setProps({ pixelScale })` | 1 (native device pixels on desktop) | [R] |
| Resolution mode | `PluginConfig.General.ResolutionMode`: `auto`, `scaled`, `native` | `auto` (CSS pixels on mobile browsers) | [S] |
| Multisampling | `canvas3d.setProps({ multiSample: { mode } })` | `temporal` | [R] |
| Ambient occlusion | `postprocessing.occlusion` | `on` | [R] |
| Transparency algorithm | `PluginConfig.General.Transparency`: `blended`, `wboit`, `dpoit` | `wboit` | [S] |
| Picking buffer | `PluginConfig.General.PickScale` | 0.25 | [S] |
| Geometry detail | representation `typeParams.quality`, `auto` scales with atom count | `auto` | [S] |
| Representation choice | cartoon for polymers; `gaussian-surface` instead of `molecular-surface` for large complexes; Mol\*'s own `auto` preset switches to cartoon-only at 5,000 polymer residues and to coarse surfaces at 30,000 | | [S] |
| State batching | `plugin.dataTransaction(fn)`, one `plugin.build()` with many updates and a single `commit()` | | [R] |
| Recolouring | change theme params or bump the dataset `version`; do not rebuild representations | | [R] |
| Transfer size | BinaryCIF plus HTTP compression (84 kB instead of 153 kB for one AlphaFold DB model) | | [H] |
| Idle viewers | `plugin.animationLoop.stop()` and `.start()` (`pauseWhenHidden`) | loop always running | [R] stop and start; the observer wiring is [T] |
| Viewer count | one WebGL context per plugin; `dispose()` releases it | | [R] 24 cycles |
| React churn | dedupe hover picks per residue before calling `setState` | | [R] |

No frame-rate or load-time numbers are given: all runtime checks used software WebGL.

### 4.16 Checks to keep as Playwright tests

`web/` already has `playwright` in `devDependencies`. The assertions below are the ones used for this document and are cheap to re-run after a Mol\* upgrade. Chrome flags that gave WebGL2 in headless mode: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.

- After mount in strict mode: exactly one `canvas` inside the container; after `dispose()`: zero children.
- `load` of `AF-P42224-F1` then `plddt`: theme name `plddt-confidence`; residue 1 `#ffdb13`, residue 150 `#0053d6`.
- `setColorMode(id, { kind: "plddt" })` on an `experimental` structure rejects.
- `superpose` 1YVL chain A onto AF-P42224-F1 chain A: RMSD 3.180 within 0.001, 652 pairs.
- `focus` on residue 274 with duration 0, then `settled()`: camera radius 9.93; `resetCamera` with the overlay loaded: radius about 104.
- Two linked viewers: equal `position` and `target` after a focus on either side and after a mouse drag.
- `screenshot({ width: 800, height: 600 })`: `image/png` blob with the same byte count on repeated runs; a 1600x1200 request decodes to 1600x1200.
- Pointer hover over the structure calls `onHover` with a chain, residue number and residue name; the first `onClick` call comes from a real click.

## 5. `MolecularViewer` handle

### 5.1 Interface

`web/src/viewer/types.ts`

```ts
import type { Ref } from "react";
import type { StructureSource } from "./load";
import type { RepresentationKind } from "./representations";
import type { ColorMode } from "./themes";
import type { ResidueColorDataset } from "./residue-data-theme";
import type { ResidueRange } from "./selection";
import type { PickInfo, ResiduePick } from "./events";
import type { BindingSiteResidue, LigandSelector } from "./binding-site";
import type { SuperpositionResult } from "./superpose";
import type { PerformanceProfile, ViewerTheme } from "./canvas";
import type { CameraState } from "./camera-sync";

export type { CameraState };

/** Provenance class. Drives the UI badge and which colour modes are legal. */
export type StructureOrigin = "experimental" | "predicted-external" | "predicted-orphafold";

export interface StructureDescriptor {
  /** caller-chosen stable id, e.g. "pdb:1YVL", "afdb:AF-P42224-F1", "orphafold:run_123" */
  id: string;
  source: StructureSource;
  origin: StructureOrigin;
  assemblyId?: string;
  representation?: RepresentationKind;
  colorMode?: ColorMode;
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
  setColorMode(id: string, mode: ColorMode): Promise<void>;
  /** registers or replaces per-residue colours (domains, variant impact, difference values) and shows them */
  setResidueColors(id: string, dataset: ResidueColorDataset): Promise<void>;
  setVisibility(id: string, visible: boolean): void;
  setOpacity(id: string, alpha: number): Promise<void>;

  /** null clears */
  highlight(id: string, ranges: ResidueRange[] | null): void;
  /** null clears */
  select(id: string, ranges: ResidueRange[] | null): void;
  focus(id: string, ranges: ResidueRange[], options?: { durationMs?: number; extraRadius?: number }): void;

  showBindingSite(id: string, ligand: LigandSelector, radius?: number): Promise<BindingSiteResidue[]>;
  hideBindingSite(id: string): Promise<void>;
  addLabel(id: string, range: ResidueRange, text: string): Promise<string | undefined>;
  removeLabel(labelId: string): Promise<void>;

  /** overlay: moves `mobileId` onto the reference and returns RMSD and aligned residue count */
  superpose(mobileId: string, options: SuperposeOptions): Promise<SuperpositionResult>;
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
  screenshot(options?: { width?: number; height?: number; transparent?: boolean }): Promise<Blob>;
}

export interface MolecularViewerProps {
  ref?: Ref<MolecularViewerHandle>;
  theme: ViewerTheme;
  reducedMotion?: boolean;
  className?: string;
  ariaLabel: string;
  onHover?: (pick: ResiduePick | undefined) => void;
  onClick?: (pick: ResiduePick | undefined, info: PickInfo) => void;
  onError?: (error: Error) => void;
}
```

### 5.2 Controller behind the handle

Status: [N]. Every method was called through the React handle in `next dev` and in the production build.

`web/src/viewer/controller.ts`

```ts
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
  const unsubscribePicks = subscribePicks(plugin, options.handlers);

  const entries = new Map<string, Entry>();
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
      const created: Entry = { descriptor, loaded, scene, bindingSiteRefs: [], datasetVersion: 0 };
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

    highlight(id, ranges) {
      if (ranges) highlightResidues(plugin, entry(id).loaded, ranges);
      else clearHighlight(plugin);
    },
    select(id, ranges) {
      if (ranges) selectResidues(plugin, entry(id).loaded, ranges);
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
      const site = await showBindingSite(plugin, target.loaded, ligand, radius);
      target.bindingSiteRefs = site?.refs ?? [];
      return site?.residues ?? [];
    }),
    hideBindingSite: (id) => serialized(async () => {
      const target = entry(id);
      await removeRefs(plugin, target.bindingSiteRefs);
      target.bindingSiteRefs = [];
    }),
    addLabel: (id, range, text) => serialized(() => addResidueLabel(plugin, entry(id).loaded, range, text)),
    removeLabel: (labelId) => serialized(() => removeLabel(plugin, labelId)),

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
```

- `serialized` keeps state updates from separate React effects from interleaving. Synchronous methods (`highlight`, `select`, `focus`, `setVisibility`, camera calls) bypass the queue.
- `assertColorModeAllowed` is the provenance gate from gotcha 6. `load` defaults to chain colouring for `experimental` and pLDDT for predicted origins.
- `load` resets the camera for the first structure only, so adding an overlay never moves the view. Loading an id that already exists replaces it.
- `setCamera` with duration 0 writes the camera directly, which keeps linked viewers from observing a stale state. `onCameraChange` drops the repeated jitter events from gotcha 19.

### 5.3 Consumer example

Status: [N] rendered in `next dev` with strict mode: "3.18 A over 652 C-alpha pairs (sequence-ca)", two canvases, cameras linked.

`web/src/components/CompareExample.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { MolecularViewer } from "./MolecularViewer";
import type { MolecularViewerHandle } from "../viewer/types";
import type { ResiduePick } from "../viewer/events";

const LIGHT = { background: 0xffffff, highlight: 0xff6699, select: 0x33ff19, outline: true };

export function CompareExample({ predictedUrl, experimentalUrl }: { predictedUrl: string; experimentalUrl: string }) {
  const overlay = useRef<MolecularViewerHandle>(null);
  const reference = useRef<MolecularViewerHandle>(null);
  const [hovered, setHovered] = useState<ResiduePick>();
  const [rmsd, setRmsd] = useState<string>();

  useEffect(() => {
    const left = overlay.current;
    const right = reference.current;
    if (!left || !right) return;
    let cancelled = false;
    let unlink = () => {};
    (async () => {
      const predicted = { kind: "url", url: predictedUrl, format: "mmcif", isBinary: true } as const;
      const experimental = { kind: "url", url: experimentalUrl, format: "mmcif", isBinary: true } as const;
      await left.load({ id: "predicted", origin: "predicted-external", source: predicted });
      await left.load({ id: "experimental", origin: "experimental", source: experimental });
      const result = await left.superpose("experimental", { referenceId: "predicted", referenceChain: "A", mobileChain: "A" });
      await right.load({ id: "predicted", origin: "predicted-external", source: predicted });
      await Promise.all([left.settled(), right.settled()]);
      if (cancelled) return;
      setRmsd(`${result.rmsd.toFixed(2)} A over ${result.alignedResidues} C-alpha pairs (${result.method})`);
      unlink = left.syncCameraWith(right);
    })().catch(console.error);
    return () => {
      cancelled = true;
      unlink();
    };
  }, [predictedUrl, experimentalUrl]);

  return (
    <section>
      <p>{rmsd ?? "Superposing"}</p>
      <p>{hovered ? `${hovered.authAsymId} ${hovered.compId} ${hovered.authSeqId}` : "Hover a residue"}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, height: 420 }}>
        <MolecularViewer ref={overlay} theme={LIGHT} ariaLabel="Predicted and experimental overlay" onHover={setHovered} />
        <MolecularViewer ref={reference} theme={LIGHT} ariaLabel="Predicted model" />
      </div>
    </section>
  );
}
```

## 6. Alternatives

Versions and licences from the npm registry and GitHub on 2026-10-03.

| Library | Version, published | Licence | Assessment |
| --- | --- | --- | --- |
| `molstar` | 5.12.0, 2026-09-28 | MIT | Primary and only 3D engine. Nine releases in 2026 so far, repository pushed 2026-10-03. |
| `pdbe-molstar` | 3.12.0, 2026-04-24 | Apache-2.0 | PDBe's wrapper with its own helper API. Pins `molstar` 5.8.0 exactly and adds `lit` and `d3-selection`, so it would bundle a second, older Mol\*. Do not use. |
| `@rcsb/rcsb-molstar` | 2.14.7, 2026-09-22 | MIT | RCSB's application-level viewer on `molstar ^5.9.0` with `react` and `react-dom` as direct dependencies. An application to embed, with its own UI. Do not use. |
| `ngl` | 2.5.0, 2026-09-03 | MIT | Previous release was 2.4.0 on 2024-09-26. Depends on `molstar ^4.1.0` and `three` itself. Adds nothing OrphaFold needs beyond Mol\*. Do not add. |
| `3dmol` | 2.5.5, 2026-05-22 | BSD-3-Clause | Actively released (2.5.4 in 2026-01), no runtime dependencies in npm metadata. A second renderer would mean a second selection model, a second colour implementation and a second place to enforce provenance rules. Do not add. |
| `@rcsb/rcsb-saguaro` | 3.3.0, 2026-07-02 | MIT | 1D feature viewer with peer `react ^19`, built on `d3` and `rxjs`. Not run here. `ux-research.md` prefers Nightingale for the shared-axis sequence dock. |
| `@rcsb/rcsb-saguaro-3d` | 4.3.1, 2026-08-26 | MIT | Depends on `@rcsb/rcsb-molstar`, `@rcsb/rcsb-saguaro-app` and `molstar ^5.9.0`. Do not use. |
| `@nightingale-elements/*` | 5.11.0 (2026-09-17), `nightingale-track` 5.11.1 (2026-10-01) | Repository `LICENSE` is MIT; several packages declare ISC in npm metadata | Web components on `lit` 3 and `d3` 7. `nightingale-manager` propagates `display-start`, `display-end`, `highlight`, `length` to its tracks and listens for `change` events. Recommended for sequence tracks next to Mol\*, as `ux-research.md` also concludes. |

Use alongside Mol\*: Nightingale only. Link it through OrphaFold's own store: track `change` events call `viewer.highlight` / `viewer.select`, and `onHover` / `onClick` from the viewer set the track `highlight` attribute. Neither library should talk to the other directly.

## 7. Sources

- npm registry metadata for `molstar`, `ngl`, `3dmol`, `pdbe-molstar`, `@rcsb/rcsb-saguaro`, `@rcsb/rcsb-saguaro-3d`, `@rcsb/rcsb-molstar`, `@nightingale-elements/*` (`npm view`, 2026-10-03): https://www.npmjs.com/package/molstar
- Mol\* 5.12.0 package source, read in `node_modules/molstar/lib` (paths cited in the recipes)
- Mol\* changelog: https://github.com/molstar/molstar/blob/master/CHANGELOG.md (5.0.0 async rename and explicit import paths, 5.5.0 TM-align, 5.10.0 `Camera.changed`, 4.13.0 `StructureElement.Schema`, 4.10.0 React 19 allowed, 4.4.1 B-factor fallback in the pLDDT theme)
- Mol\* docs, plugin instance: https://molstar.org/docs/plugin/instance/ (uses `initViewerAsync`)
- Mol\* docs, custom library: https://molstar.org/docs/plugin/custom-library/ (still shows the removed `initViewer`)
- AlphaFold DB API: https://alphafold.ebi.ac.uk/api/prediction/P42224 and https://alphafold.ebi.ac.uk/files/AF-P42224-F1-model_v6.bcif
- RCSB files: https://models.rcsb.org/1yvl.bcif , https://files.rcsb.org/download/1YVL.cif
- PDBe files: https://www.ebi.ac.uk/pdbe/entry-files/1yvl.bcif
- GitHub repository metadata through `gh api` (licence, last push): https://github.com/molstar/molstar , https://github.com/ebi-webcomponents/nightingale , https://github.com/rcsb/rcsb-saguaro , https://github.com/nglviewer/ngl , https://github.com/3dmol/3Dmol.js , https://github.com/molstar/pdbe-molstar
- Nightingale package READMEs (`npm view @nightingale-elements/nightingale-manager readme`) and paper: https://academic.oup.com/bioinformaticsadvances/article/3/1/vbad064/7178007

## 8. Not verified

- Performance: no frame rates, load times or memory figures. Everything ran on software WebGL2 in headless Chrome. The levers in 4.15 are API-verified; their effect size on real GPUs is unmeasured.
- Browsers other than Chrome 154 (Safari, Firefox, mobile, WebGL1 fallback), touch gestures and keyboard camera bindings.
- Structures above roughly 11,000 atoms, biological assemblies (`assemblyId`), multi-model files, nucleic-acid-only and glycan-heavy entries.
- OrphaFold-generated prediction files (Boltz-2 or others): whether they carry `ma_qa_metric_local`, and whether the B-factor column holds pLDDT on a 0 to 100 scale. Until confirmed, colour those through `orphafold-residue-data` from the model's own confidence output.
- Runtime behaviour inside the real `web/` app. Its React is 19.2.8; runtime tests used 19.3.0 in a scratch Next.js 16.3.8 app. Type-checking against `web/node_modules` passed.
- Nightingale and Saguaro were assessed from metadata and READMEs. Neither was run, and React 19 custom-element integration is untested.
- Compressed files (`.cif.gz`, `.bcif.gz`) through `builders.data.download`.
- WebGL context loss and restore after a GPU reset. Mol\* registers handlers for both events [S].
- Correctness of the non-covalent interaction lines in 4.9 and label legibility across zoom levels.
- `pdbe-molstar`, `rcsb-molstar`, NGL and 3Dmol.js APIs were not exercised; the table in section 6 rests on package metadata.
- AlphaFold DB licence terms and rate limits were not checked here; see `data-apis.md`.
