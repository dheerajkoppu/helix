/**
 * Numeric colours for the WebGL scene. Token colours are read from the design tokens at run time
 * so the scene and the chrome never drift apart; only the categorical domain scale and the Mol*
 * secondary-structure table are defined here.
 */
import { useSyncExternalStore } from "react";

import { PLDDT_NO_SCORE } from "@/lib/science/plddt";

/** Categorical scale for annotated regions (Okabe-Ito order, without the pink that reads as "variant"). */
export const DOMAIN_COLORS = [
  0x0072b2, 0xe69f00, 0x009e73, 0xd55e00, 0x56b4e9, 0xf0e442,
] as const;

/** Colour for residues the active colour mode has no value for. */
export const NO_VALUE_COLOR = PLDDT_NO_SCORE.color;

/** `SecondaryStructureColors` of molstar 5.12.0, applied with saturation and lightness 0. */
export const SECONDARY_STRUCTURE_COLORS = [
  { label: "Alpha helix", color: 0xff0080 },
  { label: "3-10 helix", color: 0xa00080 },
  { label: "Pi helix", color: 0x600080 },
  { label: "Strand", color: 0xffc800 },
  { label: "Turn", color: 0x6080ff },
  { label: "Bend", color: 0x66d8c9 },
  { label: "Coil", color: 0xffffff },
] as const;

export const colorToHex = (color: number) =>
  `#${color.toString(16).padStart(6, "0")}`;

export const hexToColor = (hex: string) =>
  parseInt(hex.replace("#", ""), 16);

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour, oklch() included, to 0xRRGGBB. */
export function cssColor(value: string, fallback: number): number {
  if (typeof document === "undefined" || !value) return fallback;
  probe ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = probe.getImageData(0, 0, 1, 1).data;
  return alpha === 0 ? fallback : (red << 16) | (green << 8) | blue;
}

export function tokenColor(token: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return cssColor(value, fallback);
}

export interface ViewerPalette {
  /** chain 1 to 3 tokens, then the categorical scale */
  chains: number[];
  reference: number;
  variant: number;
}

/** Resolve again when the app theme changes: reference, variant and chain tokens step per theme. */
export function readViewerPalette(): ViewerPalette {
  return {
    chains: [
      tokenColor("--sci-chain-1", DOMAIN_COLORS[0]),
      tokenColor("--sci-chain-2", DOMAIN_COLORS[3]),
      tokenColor("--sci-chain-3", DOMAIN_COLORS[2]),
      ...DOMAIN_COLORS,
    ],
    reference: tokenColor("--sci-reference", NO_VALUE_COLOR),
    variant: tokenColor("--sci-variant", DOMAIN_COLORS[3]),
  };
}

function subscribeRootTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  return () => observer.disconnect();
}

let cached: { key: string; palette: ViewerPalette } | null = null;

function paletteSnapshot(): ViewerPalette {
  const root = document.documentElement;
  const key = `${root.className}|${root.getAttribute("data-theme") ?? ""}`;
  if (cached?.key !== key) cached = { key, palette: readViewerPalette() };
  return cached.palette;
}

const serverPalette = () => null;

/** The palette for the theme the document shows right now; null during server rendering. */
export function useViewerPalette(): ViewerPalette | null {
  return useSyncExternalStore(
    subscribeRootTheme,
    paletteSnapshot,
    serverPalette,
  );
}
