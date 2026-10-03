"use client";

import { useTheme } from "next-themes";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import {
  VIEWER_WORDS,
  plainConfidence,
  plainOrigin,
  plainRole,
  plainStructureLine,
} from "@/lib/plain-language";
import { normalizePlddt, plddtBand } from "@/lib/science/plddt";
import { useAdvancedMode } from "@/lib/state/preferences";
import { STRUCTURE_ORIGIN_META } from "@/lib/structure-origin";
// camera-sync has no Mol* import, so this static import keeps Mol* out of the component chunk
import { camerasInSync } from "@/viewer/camera-sync";
import type { ViewerController } from "@/viewer/controller";

import { viewerThemeFor } from "./theme";
import type {
  CameraState,
  MolecularViewerHandle,
  MolecularViewerProps,
  ResiduePick,
  StructureDescriptor,
  StructureSummary,
} from "./types";

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

interface SceneEntry {
  descriptor: StructureDescriptor;
  summary: StructureSummary | undefined;
}

interface Failure {
  /** null when the viewer itself could not start */
  descriptor: StructureDescriptor | null;
  message: string;
}

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export const shortStructureId = (id: string) =>
  id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;

/** "ARG" to "Arg": component ids are printed the way residues are written in HGVS. */
export const residueName = (compId: string) =>
  compId.length === 3
    ? compId[0].toUpperCase() + compId.slice(1).toLowerCase()
    : compId;

function DefaultHoverReadout({
  pick,
  entry,
}: {
  pick: ResiduePick;
  entry: SceneEntry | undefined;
}) {
  const advanced = useAdvancedMode();
  const predicted = entry && entry.descriptor.origin !== "experimental";
  const plddt = predicted
    ? normalizePlddt(pick.bFactor, entry.descriptor.plddtScale ?? "0-100")
    : null;
  if (!advanced) {
    return (
      <>
        <span className="font-medium text-foreground">
          {residueName(pick.compId)}
          {predicted ? pick.labelSeqId : pick.authSeqId}
        </span>
        {plddt !== null ? (
          <span className="font-sans" title={plddt.toFixed(1)}>
            {plainConfidence(plddt)}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <span className="font-medium text-foreground">
        {residueName(pick.compId)}
        {predicted ? pick.labelSeqId : pick.authSeqId}
      </span>
      <span>chain {pick.authAsymId}</span>
      {predicted ? null : <span>author numbering</span>}
      {plddt !== null ? (
        <span>
          pLDDT {plddt.toFixed(1)} {plddtBand(plddt).label.toLowerCase()}
        </span>
      ) : null}
    </>
  );
}

/**
 * The Mol* viewport. It owns the canvas, the non-removable structure-origin tags, the hover
 * readout and the loading, empty and error states. Everything else is driven through the
 * `MolecularViewerHandle` ref. `StructureViewport` adds the toolbar, the legend and the binding
 * to the workspace selection and hover channel.
 */
export function MolecularViewer(props: MolecularViewerProps) {
  const {
    ref,
    theme,
    reducedMotion,
    className,
    ariaLabel,
    hoverReadout,
    description,
    slots,
    frameOnly,
    children,
  } = props;
  const { resolvedTheme } = useTheme();
  const advanced = useAdvancedMode();
  const systemReducedMotion = usePrefersReducedMotion();
  const activeTheme = useMemo(
    () => theme ?? viewerThemeFor(resolvedTheme),
    [theme, resolvedTheme],
  );
  const activeReducedMotion = reducedMotion ?? systemReducedMotion;

  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);
  const readyRef = useRef<Deferred<ViewerController> | null>(null);
  if (readyRef.current === null)
    readyRef.current = createDeferred<ViewerController>();

  const [entries, setEntries] = useState<SceneEntry[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [hover, setHover] = useState<ResiduePick>();

  const latest = useRef({ props, activeTheme, activeReducedMotion });
  useEffect(() => {
    latest.current = { props, activeTheme, activeReducedMotion };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let controller: ViewerController | undefined;

    (async () => {
      // keeps the ~3 MB Mol* chunk out of the server bundle and the initial page load
      const { createViewerController } = await import("@/viewer/controller");
      if (cancelled) return;
      const created = await createViewerController(container, {
        theme: latest.current.activeTheme,
        reducedMotion: latest.current.activeReducedMotion,
        handlers: {
          onHover: (pick) => {
            setHover(pick);
            latest.current.props.onHover?.(pick);
          },
          onClick: (pick, info) => latest.current.props.onClick?.(pick, info),
        },
      });
      // strict mode: the first effect run was cleaned up while Mol* was still initializing
      if (cancelled) {
        created.dispose();
        return;
      }
      controller = created;
      controllerRef.current = created;
      setStarted(true);
      readyRef.current?.resolve(created);
    })().catch((error: unknown) => {
      if (cancelled) return;
      const wrapped = toError(error);
      readyRef.current?.reject(wrapped);
      setFailure({ descriptor: null, message: wrapped.message });
      latest.current.props.onError?.(wrapped);
    });

    return () => {
      cancelled = true;
      setEntries([]);
      setPending([]);
      setHover(undefined);
      if (!controller) return;
      controller.dispose();
      controllerRef.current = null;
      setStarted(false);
      readyRef.current = createDeferred<ViewerController>();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setTheme(activeTheme);
  }, [activeTheme, started]);

  useEffect(() => {
    controllerRef.current?.setReducedMotion(activeReducedMotion);
  }, [activeReducedMotion, started]);

  const handle = useMemo((): MolecularViewerHandle => {
    const whenReady = () => readyRef.current!.promise;
    const current = () => controllerRef.current;
    const forget = (id: string) =>
      setEntries((list) => list.filter((entry) => entry.descriptor.id !== id));

    const self: MolecularViewerHandle = {
      get ready() {
        return whenReady().then(() => undefined);
      },
      async load(descriptor) {
        setPending((list) => [...list, descriptor.id]);
        setFailure((value) =>
          value?.descriptor?.id === descriptor.id ? null : value,
        );
        try {
          const controller = await whenReady();
          await controller.load(descriptor);
          // a strict-mode remount disposed this controller while the file was downloading
          if (controllerRef.current !== controller) return;
          const summary = controller.describe(descriptor.id);
          setEntries((list) => [
            ...list.filter((entry) => entry.descriptor.id !== descriptor.id),
            { descriptor, summary },
          ]);
        } catch (error) {
          const wrapped = toError(error);
          forget(descriptor.id);
          setFailure({ descriptor, message: wrapped.message });
          latest.current.props.onError?.(wrapped);
          throw wrapped;
        } finally {
          setPending((list) => {
            const index = list.indexOf(descriptor.id);
            return index < 0 ? list : list.filter((_, at) => at !== index);
          });
        }
      },
      async remove(id) {
        await (await whenReady()).remove(id);
        forget(id);
      },
      async clear() {
        await (await whenReady()).clear();
        setEntries([]);
      },
      list: () => current()?.list() ?? [],
      setRepresentation: async (id, kind) =>
        (await whenReady()).setRepresentation(id, kind),
      setColorMode: async (id, mode) =>
        (await whenReady()).setColorMode(id, mode),
      setResidueColors: async (id, dataset) =>
        (await whenReady()).setResidueColors(id, dataset),
      setVisibility: (id, visible) => current()?.setVisibility(id, visible),
      setOpacity: async (id, alpha) =>
        (await whenReady()).setOpacity(id, alpha),
      highlight: (id, ranges, options) =>
        current()?.highlight(id, ranges, options),
      select: (id, ranges, options) => current()?.select(id, ranges, options),
      focus: (id, ranges, options) => current()?.focus(id, ranges, options),
      showBindingSite: async (id, ligand, radius) =>
        (await whenReady()).showBindingSite(id, ligand, radius),
      hideBindingSite: async (id) => (await whenReady()).hideBindingSite(id),
      showResidueSet: async (id, setId, ranges, options) =>
        (await whenReady()).showResidueSet(id, setId, ranges, options),
      hideResidueSet: async (id, setId) =>
        (await whenReady()).hideResidueSet(id, setId),
      describe: (id) => current()?.describe(id),
      addLabel: async (id, range, text, options) =>
        (await whenReady()).addLabel(id, range, text, options),
      removeLabel: async (labelId) => (await whenReady()).removeLabel(labelId),
      superpose: async (mobileId, options) =>
        (await whenReady()).superpose(mobileId, options),
      clearSuperposition: async (mobileId) =>
        (await whenReady()).clearSuperposition(mobileId),
      resetCamera: (durationMs) => current()?.resetCamera(durationMs),
      getCamera: () => current()?.getCamera(),
      setCamera: (state, durationMs) => current()?.setCamera(state, durationMs),
      onCameraChange: (listener) =>
        current()?.onCameraChange(listener) ?? (() => {}),
      syncCameraWith(other) {
        const controller = current();
        if (!controller) return () => {};
        const copy = (
          state: CameraState,
          read: () => CameraState | undefined,
          write: (next: CameraState) => void,
        ) => {
          const existing = read();
          if (!existing || !camerasInSync(state, existing)) write(state);
        };
        const toOther = (state: CameraState) =>
          copy(
            state,
            () => other.getCamera(),
            (next) => other.setCamera(next, 0),
          );
        const toSelf = (state: CameraState) =>
          copy(
            state,
            () => controller.getCamera(),
            (next) => controller.setCamera(next, 0),
          );
        const unlinkSelf = controller.onCameraChange(toOther);
        const unlinkOther = other.onCameraChange(toSelf);
        const initial = controller.getCamera();
        if (initial) toOther(initial);
        return () => {
          unlinkSelf();
          unlinkOther();
        };
      },
      settled: async () => (await whenReady()).settled(),
      setTheme: (next) => current()?.setTheme(next),
      setReducedMotion: (reduced) => current()?.setReducedMotion(reduced),
      setPerformanceProfile: (profile) =>
        current()?.setPerformanceProfile(profile),
      screenshot: async (options) => (await whenReady()).screenshot(options),
    };
    return self;
  }, []);

  useImperativeHandle(ref, () => handle, [handle]);

  const shown = entries.filter(
    (entry) => !frameOnly?.includes(entry.descriptor.id),
  );
  const generated = shown.length
    ? shown
        .map((entry) => {
          const meta = STRUCTURE_ORIGIN_META[entry.descriptor.origin];
          const residues = entry.summary
            ? `, ${entry.summary.residueCount} residues`
            : "";
          return `${entry.descriptor.id}, ${meta.label.toLowerCase()}, ${meta.caption}${residues}`;
        })
        .join("; ")
    : failure
      ? "No structure is shown because loading failed"
      : "No structure loaded";
  const hoverEntry = entries.find(
    (entry) => entry.descriptor.id === hover?.structureId,
  );
  const loading = pending.length > 0 || (!started && !failure);
  const loadingStep = !advanced
    ? pending.length > 0
      ? VIEWER_WORDS.loading
      : VIEWER_WORDS.starting
    : pending.length > 0
      ? `Loading ${pending.map(shortStructureId).join(", ")}`
      : "Starting the 3D viewer";

  return (
    <div
      data-slot="molecular-viewer"
      className={cn(
        "relative size-full min-h-40 overflow-hidden bg-canvas",
        className,
      )}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label={`${ariaLabel}. ${description ?? generated}.`}
        className="absolute inset-0"
      />
      <p className="sr-only" aria-live="polite">
        {description ?? generated}
      </p>

      <div className="pointer-events-none absolute top-2 right-2 left-2 flex flex-col items-start gap-1">
        {shown.length > 0 ? (
          <ul
            data-slot="viewer-origin-tags"
            className="flex max-w-full flex-col items-start gap-1"
          >
            {shown.map((entry, index) => (
              <li
                key={entry.descriptor.id}
                title={entry.descriptor.id}
                className="flex max-w-full items-center gap-1.5 overflow-hidden border border-border-subtle bg-background/85 px-1.5 py-1 whitespace-nowrap"
              >
                {(slots?.[entry.descriptor.id] ?? shown.length > 1) ? (
                  <span className="font-mono text-2xs font-semibold text-foreground">
                    {slots?.[entry.descriptor.id] ??
                      String.fromCharCode(65 + index)}
                  </span>
                ) : null}
                <StructureOriginTag
                  origin={entry.descriptor.origin}
                  detail={
                    entry.descriptor.label ??
                    shortStructureId(entry.descriptor.id)
                  }
                  caption={advanced}
                  plainLabel={
                    entry.descriptor.label
                      ? `${plainRole(entry.descriptor.label)} · ${plainOrigin(entry.descriptor.origin)}`
                      : plainStructureLine(
                          entry.descriptor.origin,
                          entry.descriptor.detail,
                        )
                  }
                />
                {advanced && entry.descriptor.detail ? (
                  <span className="text-2xs text-muted-foreground">
                    {entry.descriptor.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {hover ? (
          <div
            data-slot="viewer-hover-readout"
            className="tabular flex max-w-full items-center gap-2 overflow-hidden border border-border-subtle bg-background/85 px-1.5 py-1 font-mono text-2xs whitespace-nowrap text-muted-foreground"
          >
            {hoverReadout ? (
              hoverReadout(hover)
            ) : (
              <DefaultHoverReadout pick={hover} entry={hoverEntry} />
            )}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div
          role="status"
          className={cn(
            "pointer-events-none absolute flex items-center gap-2 text-xs text-muted-foreground",
            shown.length > 0
              ? "right-2 bottom-2 border border-border-subtle bg-background/85 px-1.5 py-1"
              : "inset-0 justify-center",
          )}
        >
          <Spinner className="size-3.5" />
          {loadingStep}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className={cn(
            "absolute flex flex-col gap-1 text-xs",
            shown.length > 0
              ? "right-2 bottom-2 max-w-72 border border-border bg-background px-2 py-1.5"
              : "inset-0 items-center justify-center p-6 text-center",
          )}
        >
          <p className="font-medium text-foreground">
            {failure.descriptor
              ? `Could not load ${failure.descriptor.id}`
              : "The 3D viewer could not start"}
          </p>
          <p className="max-w-sm text-muted-foreground">{failure.message}</p>
          {failure.descriptor ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-1 self-center"
              onClick={() => {
                if (failure.descriptor)
                  void handle.load(failure.descriptor).catch(() => {});
              }}
            >
              Retry
            </Button>
          ) : (
            <p className="max-w-sm text-subtle-foreground">
              WebGL is required. The structure file can still be downloaded.
            </p>
          )}
        </div>
      ) : null}

      {!loading && !failure && shown.length === 0 ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {advanced ? "No structure loaded" : VIEWER_WORDS.empty}
        </p>
      ) : null}

      {children}
    </div>
  );
}
