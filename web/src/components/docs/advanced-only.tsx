"use client";

import { useAdvancedMode } from "@/lib/state/preferences";

/** Renders its children only in Advanced mode, so a server page can gate detail. */
export function AdvancedOnly({ children }: { children: React.ReactNode }) {
  const advanced = useAdvancedMode();
  return advanced ? <>{children}</> : null;
}
