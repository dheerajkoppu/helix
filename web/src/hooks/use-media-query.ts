"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Server render and first client render return `serverValue`, then the real match. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Workspace zones sit side by side from 1024px. Below that, Ledger and Inspector become sheets. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)", true);

export const usePrefersReducedMotion = () =>
  useMediaQuery("(prefers-reduced-motion: reduce)");

const subscribeNever = () => () => {};

/** True on Apple platforms, where the primary modifier is Cmd. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () =>
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}
