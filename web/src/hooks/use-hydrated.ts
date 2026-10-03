"use client";

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/** False on the server and during hydration, true afterwards. Gate browser-only layout on it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
