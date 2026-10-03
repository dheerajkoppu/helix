"use client";

import { useEffect, useRef } from "react";
import { tinykeys } from "tinykeys";

import { usePreferences } from "@/lib/state/preferences";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

export interface HotkeyOptions {
  /** default true */
  enabled?: boolean;
  /**
   * Bindings without a modifier are single-character shortcuts. They follow the user's preference
   * (WCAG 2.1.4) and never fire while typing. Set false for bindings that all carry a modifier.
   */
  singleKey?: boolean;
  /** element to listen on; defaults to window. Pass a zone element for zone-scoped keys. */
  target?: HTMLElement | null;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[data-hotkeys='off']")) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Keyboard bindings in tinykeys syntax: "$mod+k", "g p" (sequence), "Shift+?", "[".
 * Handlers always see the latest closure. Returns nothing; unbinding is automatic.
 */
export function useHotkeys(
  bindings: HotkeyMap,
  options: HotkeyOptions = {},
): void {
  const { enabled = true, singleKey = true, target } = options;
  const singleKeyAllowed = usePreferences((state) => state.singleKeyShortcuts);
  const latest = useRef(bindings);

  useEffect(() => {
    latest.current = bindings;
  });

  const active = enabled && (!singleKey || singleKeyAllowed);
  const keys = Object.keys(bindings).join("\n");

  useEffect(() => {
    if (!active) return;
    const element = target === undefined ? window : target;
    if (!element) return;
    const stable: HotkeyMap = {};
    for (const key of keys.split("\n")) {
      stable[key] = (event) => latest.current[key]?.(event);
    }
    return tinykeys(element, stable, {
      ignore: (event) => (singleKey ? isEditable(event.target) : false),
    });
  }, [active, keys, singleKey, target]);
}
