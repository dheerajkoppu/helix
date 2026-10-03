"use client";

import { useImperativeHandle, useMemo, useState } from "react";
import { cn } from "cn";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { Spinner } from "@/components/ui/spinner";

import type {
  MolecularViewerHandle,
  MolecularViewerProps,
  StructureDescriptor,
} from "./types";

const NOT_READY = "The 3D viewer is not available yet.";

/**
 * Placeholder for the Mol* viewer. It keeps the exported name, props and handle shape so pages
 * compile and lay out correctly. It draws no coordinates: it only records which structures were
 * requested and says the viewer is loading. The Mol* specialist replaces this file.
 */
export function MolecularViewer({
  ref,
  className,
  ariaLabel,
}: MolecularViewerProps) {
  const [requested, setRequested] = useState<StructureDescriptor[]>([]);

  const handle = useMemo<MolecularViewerHandle>(() => {
    const unavailable = () => Promise.reject(new Error(NOT_READY));
    const self: MolecularViewerHandle = {
      ready: Promise.resolve(),
      load: async (descriptor) => {
        setRequested((current) => [
          ...current.filter((entry) => entry.id !== descriptor.id),
          descriptor,
        ]);
      },
      remove: async (id) =>
        setRequested((current) => current.filter((entry) => entry.id !== id)),
      clear: async () => setRequested([]),
      list: () => [],
      setRepresentation: async () => {},
      setColorMode: async () => {},
      setResidueColors: async () => {},
      setVisibility: () => {},
      setOpacity: async () => {},
      highlight: () => {},
      select: () => {},
      focus: () => {},
      showBindingSite: unavailable,
      hideBindingSite: async () => {},
      addLabel: async () => undefined,
      removeLabel: async () => {},
      superpose: unavailable,
      clearSuperposition: async () => {},
      resetCamera: () => {},
      getCamera: () => undefined,
      setCamera: () => {},
      onCameraChange: () => () => {},
      syncCameraWith: () => () => {},
      settled: async () => {},
      setTheme: () => {},
      setReducedMotion: () => {},
      setPerformanceProfile: () => {},
      screenshot: unavailable,
    };
    return self;
  }, []);

  useImperativeHandle(ref, () => handle, [handle]);

  return (
    <div
      data-slot="molecular-viewer"
      role="img"
      aria-label={`${ariaLabel}. The 3D viewer is loading.`}
      className={cn(
        "relative flex size-full min-h-40 items-center justify-center bg-canvas",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading 3D viewer
      </div>
      {requested.length > 0 ? (
        <ul className="absolute bottom-2 left-2 flex flex-col gap-1">
          {requested.map((descriptor) => (
            <li key={descriptor.id}>
              <StructureOriginTag
                origin={descriptor.origin}
                detail={descriptor.id}
                caption
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
