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
    // Mol* outlines marked residues in green and pink by default; both read as data colours here
    marking: {
      highlightEdgeColor: Color(theme.highlight),
      selectEdgeColor: Color(theme.select),
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
