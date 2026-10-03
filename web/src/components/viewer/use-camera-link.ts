"use client";

import { useEffect, type RefObject } from "react";

import type { MolecularViewerHandle } from "./types";

/**
 * Split view: locks the cameras of two viewers together. Turn `enabled` on once both scenes are
 * loaded and share a frame of reference (the comparand superposed on the reference).
 */
export function useCameraLink(
  first: RefObject<MolecularViewerHandle | null>,
  second: RefObject<MolecularViewerHandle | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const source = first.current;
    const target = second.current;
    if (!enabled || !source || !target) return;
    let cancelled = false;
    let unlink = () => {};
    void Promise.all([source.settled(), target.settled()])
      .then(() => {
        if (!cancelled) unlink = source.syncCameraWith(target);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlink();
    };
  }, [first, second, enabled]);
}
