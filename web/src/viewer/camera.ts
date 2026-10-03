import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import type { Camera } from "molstar/lib/mol-canvas3d/camera";
import { camerasInSync } from "./camera-sync";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionDuration(durationMs = 250): number {
  return prefersReducedMotion() ? 0 : durationMs;
}

/** Frames the whole scene. */
export function resetCamera(plugin: PluginContext, durationMs = motionDuration()): Promise<void> {
  return PluginCommands.Camera.Reset(plugin, { durationMs });
}

/**
 * Camera commands and scene changes are applied on a later animation frame.
 * Await this before reading the camera or taking a screenshot.
 */
export function viewerSettled(plugin: PluginContext, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let frameCount = 0;
    const check = () => {
      frameCount += 1;
      const canvas = plugin.canvas3d;
      const pending = !!canvas && (canvas.commitQueueSize.value > 0 || canvas.camera.transition.inTransition);
      const busy = pending || plugin.behaviors.state.isUpdating.value;
      if ((frameCount >= 2 && !busy) || performance.now() > deadline) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** Mol* has no reduced-motion handling of its own; call again when the media query changes. */
export function applyMotionPreference(plugin: PluginContext, reducedMotion: boolean): void {
  plugin.canvas3d?.setProps({
    cameraResetDurationMs: reducedMotion ? 0 : 250,
    renderer: { enableAnimation: !reducedMotion },
    trackball: { animate: { name: "off", params: {} } },
  });
}

/** Two-way camera lock between two plugin instances. Returns an unsubscribe function. */
export function syncCameras(first: PluginContext, second: PluginContext): () => void {
  const firstCamera = first.canvas3d?.camera;
  const secondCamera = second.canvas3d?.camera;
  if (!firstCamera || !secondCamera) return () => {};

  const copy = (source: Camera, target: Camera, targetPlugin: PluginContext) => {
    // `changed` also fires on anti-aliasing jitter frames, so always compare before writing
    if (camerasInSync(source.state, target.state)) return;
    // radiusMax describes the target's own scene and must not be overwritten
    const { radiusMax, ...view } = source.getSnapshot();
    void radiusMax;
    target.setState(view, 0);
    targetPlugin.canvas3d?.requestDraw();
  };
  const firstSubscription = firstCamera.changed.subscribe(() => copy(firstCamera, secondCamera, second));
  const secondSubscription = secondCamera.changed.subscribe(() => copy(secondCamera, firstCamera, first));
  copy(firstCamera, secondCamera, second);

  return () => {
    firstSubscription.unsubscribe();
    secondSubscription.unsubscribe();
  };
}
