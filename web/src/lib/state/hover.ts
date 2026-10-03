import { useSyncExternalStore } from "react";

export type HoverOrigin = "axis" | "viewport" | "ledger" | "heatmap";

/** Transient pointer state shared by the axis dock, the 3D viewport and tables. Never enters the URL. */
export type WorkspaceHover = {
  accession: string;
  /** UniProt canonical position */
  position: number;
  origin: HoverOrigin;
} | null;

type Listener = (hover: WorkspaceHover) => void;

let current: WorkspaceHover = null;
let pending: WorkspaceHover | undefined;
let frame: number | null = null;
const listeners = new Set<Listener>();

function flush() {
  frame = null;
  if (pending === undefined) return;
  const next = pending;
  pending = undefined;
  if (
    next?.position === current?.position &&
    next?.accession === current?.accession &&
    next?.origin === current?.origin
  ) {
    return;
  }
  current = next;
  listeners.forEach((listener) => listener(current));
}

/** Publishes a hover. Updates are coalesced to one per animation frame. */
export function setWorkspaceHover(hover: WorkspaceHover): void {
  pending = hover;
  if (typeof window === "undefined") return;
  frame ??= window.requestAnimationFrame(flush);
}

export const clearWorkspaceHover = () => setWorkspaceHover(null);

export const getWorkspaceHover = (): WorkspaceHover => current;

/** Imperative subscription for canvas and Mol* code that must not re-render React. Returns unsubscribe. */
export function subscribeWorkspaceHover(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = (): WorkspaceHover => null;

/** React binding. Prefer `subscribeWorkspaceHover` inside anything that draws per frame. */
export function useWorkspaceHover(): WorkspaceHover {
  return useSyncExternalStore(
    subscribeWorkspaceHover,
    getWorkspaceHover,
    getServerSnapshot,
  );
}
