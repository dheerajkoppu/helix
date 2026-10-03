/** Plain camera description. Structurally compatible with Mol* `Camera.Snapshot`. This module must stay free of Mol* imports. */
export interface CameraState {
  mode: "perspective" | "orthographic";
  position: ArrayLike<number>;
  target: ArrayLike<number>;
  up: ArrayLike<number>;
  /** clipping and fog radius around the target */
  radius: number;
  /** radius of the viewer's own scene; each camera clamps `radius` to it */
  radiusMax: number;
  fov: number;
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/**
 * True when both cameras already show the same view. Radii count as equal when one side is the other
 * side's radius clamped to its own scene, otherwise two viewers with different scenes would echo forever.
 */
export function camerasInSync(a: CameraState, b: CameraState): boolean {
  const radiiMatch =
    Math.abs(Math.min(a.radius, b.radiusMax) - b.radius) < 1e-6 || Math.abs(Math.min(b.radius, a.radiusMax) - a.radius) < 1e-6;
  return a.mode === b.mode && a.fov === b.fov && radiiMatch && close(a.position, b.position) && close(a.target, b.target) && close(a.up, b.up);
}
