/**
 * Anonymous workspace identity. The client generates the ID once, keeps it in localStorage and sends it
 * as the X-OrphaFold-Workspace header. The server creates an actor row on first write, and an account
 * can later claim that actor.
 */
export const WORKSPACE_HEADER = "X-OrphaFold-Workspace";
export const WORKSPACE_STORAGE_KEY = "orphafold.workspace";

const WORKSPACE_ID_PATTERN = /^ofw_[0-9a-f]{32}$/;

let memoryFallback: string | null = null;

function generateWorkspaceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ofw_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Returns null during server rendering. Never throws when storage is blocked. */
export function getWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (stored && WORKSPACE_ID_PATTERN.test(stored)) return stored;
    const created = generateWorkspaceId();
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, created);
    return created;
  } catch {
    memoryFallback ??= generateWorkspaceId();
    return memoryFallback;
  }
}

/** Replaces the stored identity, for example after importing a workspace on another device. */
export function setWorkspaceId(workspaceId: string): boolean {
  if (typeof window === "undefined" || !WORKSPACE_ID_PATTERN.test(workspaceId))
    return false;
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    return true;
  } catch {
    memoryFallback = workspaceId;
    return true;
  }
}
