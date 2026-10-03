"use client";

import { create } from "zustand";

import { ApiError, apiFetch, apiUrl, type QueryParams } from "@/lib/api/client";
import type { EvidenceClass } from "@/lib/evidence";
import { WORKSPACE_HEADER, getWorkspaceId } from "@/lib/workspace-identity";

/** Mirrors api/orphafold/schemas/projects.py. Replace with Schema<"..."> once `make types` has run. */
export const ITEM_KINDS = [
  "disease",
  "gene",
  "variant",
  "protein",
  "structure",
  "residue",
  "compound",
  "paper",
  "job",
  "note",
  "hypothesis",
  "screenshot",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ProjectVisibility = "private" | "unlisted" | "public";
export const HYPOTHESIS_STATUSES = [
  "draft",
  "open",
  "supported",
  "contradicted",
  "retired",
] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export interface ActorRef {
  actor_id: string;
  kind: "anonymous" | "account" | "system";
}

export interface ItemOrigin {
  route: string | null;
  url_state: Record<string, string>;
  note: string | null;
  parent_item_id: string | null;
  created_at: string | null;
  forked_from_item_id: string | null;
}

export interface HypothesisRecord {
  id: string;
  evidence_class: EvidenceClass;
  statement: string | null;
  derived_from: string[];
  created_by: ActorRef;
  authoring: { method: "human" | "llm_assisted"; model: string | null } | null;
}

export interface Hypothesis {
  statement: string;
  status: HypothesisStatus;
  supporting_item_ids: string[];
  derived_from: string[];
  record: HypothesisRecord;
}

export interface ProjectItem {
  id: string;
  project_id: string;
  kind: ItemKind;
  ref: string | null;
  label: string;
  note: string | null;
  origin: ItemOrigin;
  parent_item_id: string | null;
  position: number;
  href: string | null;
  evidence: Record<string, unknown>[];
  evidence_class: EvidenceClass | null;
  data: Record<string, unknown>;
  hypothesis: Hypothesis | null;
  created_at: string;
  updated_at: string;
}

export interface TrailNode {
  item_id: string;
  kind: ItemKind;
  label: string;
  ref: string | null;
  parent_item_id: string | null;
  depth: number;
  order: number;
  href: string | null;
  created_at: string;
}

export interface TrailEdge {
  source: string;
  target: string;
  relation: "led_to" | "supports";
}

export interface Trail {
  nodes: TrailNode[];
  edges: TrailEdge[];
  roots: string[];
  active_item_id: string | null;
}

export interface Lineage {
  forked_from_project_id: string | null;
  forked_from_snapshot_id: string | null;
  forked_from_title: string | null;
  root_project_id: string;
  fork_depth: number;
  fork_count: number;
}

export interface SnapshotSummary {
  id: string;
  project_id: string;
  sequence_number: number;
  parent_snapshot_id: string | null;
  message: string | null;
  content_sha256: string;
  withdrawn: boolean;
  share_path: string;
  created_by: ActorRef | null;
  created_at: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: ProjectVisibility;
  license: string;
  is_owner: boolean;
  owner: ActorRef;
  head_snapshot_id: string | null;
  share_path: string | null;
  lineage: Lineage;
  active_item_id: string | null;
  item_count: number;
  item_counts: Partial<Record<ItemKind, number>>;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  items: ProjectItem[];
  trail: Trail;
  snapshots: SnapshotSummary[];
  unpublished_changes: boolean;
}

export interface Snapshot extends SnapshotSummary {
  title: string;
  description: string | null;
  license: string;
  lineage: Lineage;
  items: ProjectItem[];
  trail: Trail;
  document: Record<string, unknown>;
  project_visibility: ProjectVisibility;
  project_available: boolean;
  is_owner: boolean;
  is_head: boolean;
}

export interface ProjectPage {
  items: ProjectSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** What any page hands to AddToProjectButton or openAddToProject. */
export interface ProjectItemDraft {
  kind: ItemKind;
  /** entity ID in the binding scheme: HGNC symbol, UniProt accession, variant ID, structure ID */
  ref: string;
  label: string;
  origin?: { route: string; note?: string };
  evidence?: unknown[];
  data?: Record<string, unknown>;
}

export interface ItemCreateBody {
  kind: ItemKind;
  ref?: string | null;
  label: string;
  note?: string | null;
  origin?: {
    route?: string | null;
    url_state?: Record<string, string>;
    note?: string | null;
  };
  evidence?: unknown[];
  data?: Record<string, unknown>;
  parent_item_id?: string | null;
  attach_to_active?: boolean;
}

export const projectKeys = {
  list: (scope: "mine" | "public") => ["projects", "list", scope] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  snapshot: (snapshotId: string) =>
    ["projects", "snapshot", snapshotId] as const,
};

const json = (method: "POST" | "PATCH", body?: unknown) => ({ method, body });

export const projectsApi = {
  list: (scope: "mine" | "public", signal?: AbortSignal) =>
    apiFetch<ProjectPage>("/projects", {
      query: { scope, limit: 200 },
      signal,
    }),
  get: (projectId: string, signal?: AbortSignal) =>
    apiFetch<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`, {
      signal,
    }),
  create: (body: {
    title: string;
    description?: string | null;
    visibility?: ProjectVisibility;
  }) => apiFetch<ProjectDetail>("/projects", json("POST", body)),
  update: (
    projectId: string,
    body: Partial<{
      title: string;
      description: string | null;
      visibility: ProjectVisibility;
      license: string;
      active_item_id: string | null;
    }>,
  ) => apiFetch<ProjectDetail>(`/projects/${projectId}`, json("PATCH", body)),
  remove: (projectId: string) =>
    apiFetch<null>(`/projects/${projectId}`, { method: "DELETE" }),
  addItem: (projectId: string, body: ItemCreateBody) =>
    apiFetch<ProjectItem>(`/projects/${projectId}/items`, json("POST", body)),
  updateItem: (
    projectId: string,
    itemId: string,
    body: {
      label?: string;
      note?: string | null;
      parent_item_id?: string;
      detach?: boolean;
      hypothesis?: Partial<{
        statement: string;
        status: HypothesisStatus;
        supporting_item_ids: string[];
      }>;
    },
  ) =>
    apiFetch<ProjectItem>(
      `/projects/${projectId}/items/${itemId}`,
      json("PATCH", body),
    ),
  removeItem: (projectId: string, itemId: string) =>
    apiFetch<null>(`/projects/${projectId}/items/${itemId}`, {
      method: "DELETE",
    }),
  addHypothesis: (
    projectId: string,
    body: {
      statement: string;
      supporting_item_ids: string[];
      status: HypothesisStatus;
      parent_item_id?: string | null;
    },
  ) =>
    apiFetch<ProjectItem>(
      `/projects/${projectId}/hypotheses`,
      json("POST", body),
    ),
  publish: (projectId: string, message: string | null) =>
    apiFetch<SnapshotSummary>(
      `/projects/${projectId}/publish`,
      json("POST", { message }),
    ),
  fork: (projectId: string) =>
    apiFetch<ProjectDetail>(`/projects/${projectId}/fork`, json("POST", {})),
  snapshot: (snapshotId: string, signal?: AbortSignal) =>
    apiFetch<Snapshot>(`/snapshots/${encodeURIComponent(snapshotId)}`, {
      signal,
    }),
  forkSnapshot: (snapshotId: string) =>
    apiFetch<ProjectDetail>(`/snapshots/${snapshotId}/fork`, json("POST", {})),
};

export type ExportFormat = "json" | "md" | "zip";

/**
 * Saves an export to disk. The request carries the workspace header, which a plain link cannot,
 * so a private project exports too.
 */
export async function downloadExport(
  path: string,
  fallbackName: string,
  query?: QueryParams,
): Promise<string> {
  const headers: Record<string, string> = {};
  const workspaceId = getWorkspaceId();
  if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
  let response: Response;
  try {
    response = await fetch(apiUrl(path, query), { headers });
  } catch {
    throw new ApiError({
      status: 0,
      code: "api_unreachable",
      message: "The OrphaFold API did not answer.",
    });
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
      code?: string;
    } | null;
    throw new ApiError({
      status: response.status,
      code: problem?.code ?? `http_${response.status}`,
      message: problem?.detail ?? `The API returned HTTP ${response.status}.`,
    });
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

const LAST_PROJECT_KEY = "orphafold.project.last";

export function getLastProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(projectId: string | null): void {
  try {
    if (projectId) window.localStorage.setItem(LAST_PROJECT_KEY, projectId);
    else window.localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // storage blocked: the dialog falls back to the most recently updated project
  }
}

interface ProjectsState {
  /** the item waiting in the Add to project dialog */
  draft: ProjectItemDraft | null;
  addOpen: boolean;
  openAdd: (draft: ProjectItemDraft) => void;
  closeAdd: () => void;
  /** bumped after every write so open project views refetch */
  revision: number;
  touch: () => void;
}

export const useProjects = create<ProjectsState>()((set) => ({
  draft: null,
  addOpen: false,
  openAdd: (draft) => set({ draft, addOpen: true }),
  closeAdd: () => set({ addOpen: false }),
  revision: 0,
  touch: () => set((state) => ({ revision: state.revision + 1 })),
}));
