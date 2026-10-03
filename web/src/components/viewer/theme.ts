import type { ColorMode, Representation } from "@/lib/state/selection";

import type { RepresentationKind, ViewerColorMode, ViewerTheme } from "./types";

/**
 * Canvas themes. Hover and selection are neutral ink: Mol*'s default pink highlight reads as the
 * variant magenta. The dark canvas is pure black so the very-high pLDDT blue keeps 3:1 contrast;
 * the light canvas turns outlines on because the cyan and yellow bands vanish on white.
 */
export const VIEWER_THEMES: Record<"light" | "dark", ViewerTheme> = {
  light: {
    background: 0xffffff,
    highlight: 0x15171a,
    select: 0x15171a,
    outline: true,
  },
  dark: {
    background: 0x000000,
    highlight: 0xedeff0,
    select: 0xedeff0,
    outline: false,
  },
};

export function viewerThemeFor(resolvedTheme: string | undefined): ViewerTheme {
  return resolvedTheme === "dark" ? VIEWER_THEMES.dark : VIEWER_THEMES.light;
}

const REPRESENTATION_KIND: Record<Representation, RepresentationKind> = {
  cartoon: "cartoon",
  surface: "molecular-surface",
  "ball-and-stick": "ball-and-stick",
};

/** Maps the URL-facing representation onto the viewer's. */
export const toRepresentationKind = (
  representation: Representation,
): RepresentationKind => REPRESENTATION_KIND[representation];

/**
 * Maps the workspace colour mode onto a viewer colour mode. Modes that colour by app data
 * (domain, alphamissense, reference-variant) return null: the caller supplies a residue dataset
 * through `setResidueColors` instead.
 */
export function toViewerColorMode(
  colorMode: ColorMode,
): ViewerColorMode | null {
  switch (colorMode) {
    case "confidence":
      return { kind: "plddt" };
    case "chain":
      return { kind: "chain" };
    case "secondary-structure":
      return { kind: "secondary-structure" };
    default:
      return null;
  }
}
