"use client";

import { toast } from "sonner";
import { create } from "zustand";

import { API_BASE_URL, apiFetch } from "@/lib/api/client";
import { useShell } from "@/lib/state/shell";
import type { StructureOrigin } from "@/lib/structure-origin";

/** Mirrors api/orphafold/schemas/jobs.py and providers/base.py. */
export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type StageStatus = string;

export const JOB_STATUSES: JobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

export interface StageProgress {
  completed: number;
  total: number | null;
  unit: string | null;
}

export interface JobStage {
  id: string;
  label: string;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  detail: string | null;
  progress: StageProgress | null;
}

export interface JobArtifact {
  id: string;
  name: string;
  role: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  url: string;
  structure_origin: StructureOrigin | null;
  sample_index: number | null;
  created_at: string;
}

export interface JobSubject {
  type: string;
  id: string;
  label: string | null;
  curie: string | null;
  href: string | null;
}

export interface JobOut {
  id: string;
  kind: string;
  title: string | null;
  status: JobStatus;
  provider_id: string | null;
  subject: JobSubject | null;
  params: Record<string, unknown>;
  stages: JobStage[];
  current_stage: string | null;
  result: Record<string, unknown> | null;
  error: {
    code: string;
    message: string;
    detail: Record<string, unknown> | null;
  } | null;
  artifacts: JobArtifact[];
  cancel_requested: boolean;
  attempts: number;
  actor_id: string | null;
  project_id: string | null;
  parent_job_id: string | null;
  manifest_sha256: string | null;
  manifest_url: string | null;
  events_url: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobPage {
  items: JobOut[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface JobEvent {
  id: number;
  job_id: string;
  type: string;
  stage_id: string | null;
  level: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
  at: string;
}

export interface JobKind {
  kind: string;
  title: string;
  description: string | null;
  params_schema: {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  result_schema: Record<string, unknown> | null;
  restartable: boolean;
  providers: string[];
}

export interface ProviderCitation {
  text: string | null;
  title: string | null;
  year: number | null;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  url: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: string;
  model_name: string | null;
  model_version: string | null;
  license: string | null;
  license_url: string | null;
  commercial_use: boolean | null;
  capabilities: string[];
  execution_mode: string;
  performs_inference: boolean;
  structure_origin: StructureOrigin | null;
  max_residues: number | null;
  requires_api_key: boolean;
  requires_gpu: boolean;
  availability: {
    available: boolean;
    reason: string | null;
    checked_at: string | null;
  };
  limitations: string[];
  citation: ProviderCitation[];
  attribution: string | null;
  homepage: string | null;
  job_kinds: string[];
}

export interface ModelsOut {
  providers: ProviderInfo[];
}

export const isTerminal = (status: JobStatus) =>
  status === "succeeded" || status === "failed" || status === "cancelled";

/** Artifact and manifest URLs come back as API paths that already carry /api/v1. */
export const jobFileUrl = (path: string) =>
  path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

export interface RunJobRequest {
  /** a registered job kind; omitted lets the reader choose */
  kind?: string;
  params?: Record<string, unknown>;
}

interface JobsState {
  /** queued and running jobs of this workspace, as last reported by the API */
  active: JobOut[];
  /** bumped whenever a watched job reaches a terminal status, so lists can refetch */
  revision: number;
  dialog: RunJobRequest | null;
  /** counts dialog openings, so each one starts from a fresh form */
  dialogSerial: number;
  openDialog: (request: RunJobRequest) => void;
  closeDialog: () => void;
}

export const useJobs = create<JobsState>()((set) => ({
  active: [],
  revision: 0,
  dialog: null,
  dialogSerial: 0,
  openDialog: (dialog) =>
    set((state) => ({ dialog, dialogSerial: state.dialogSerial + 1 })),
  closeDialog: () => set({ dialog: null }),
}));

const ACTIVE_INTERVAL_MS = 2000;
const IDLE_INTERVAL_MS = 15000;

const watched = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let polling = false;

/** Client-side navigation when the Next router is reachable, a document load otherwise. */
export function navigateTo(href: string): void {
  const router = (
    window as unknown as {
      next?: { router?: { push?: (href: string) => void } };
    }
  ).next?.router;
  if (router?.push) router.push(href);
  else window.location.assign(href);
}

async function announce(jobId: string, fallbackTitle: string): Promise<void> {
  let job: JobOut;
  try {
    job = await apiFetch<JobOut>(`/jobs/${jobId}`);
  } catch {
    return;
  }
  if (!isTerminal(job.status)) {
    watched.set(job.id, job.title ?? fallbackTitle);
    return;
  }
  useJobs.setState((state) => ({ revision: state.revision + 1 }));
  const title = job.title ?? fallbackTitle;
  const action = {
    label: "Open",
    onClick: () => navigateTo(`/jobs/${job.id}`),
  };
  if (job.status === "succeeded")
    toast.success(`Job finished: ${title}`, { action });
  else if (job.status === "failed")
    toast.error(`Job failed: ${title}`, {
      description: job.error?.message,
      action,
    });
  else toast(`Job cancelled: ${title}`, { action });
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  let next = IDLE_INTERVAL_MS;
  try {
    const page = await apiFetch<JobPage>("/jobs", {
      query: { status: ["queued", "running"], limit: 100 },
    });
    const active = page.items;
    useJobs.setState({ active });
    useShell.getState().setJobs({
      running: active.filter((job) => job.status === "running").length,
      queued: active.filter((job) => job.status === "queued").length,
    });
    const activeIds = new Set(active.map((job) => job.id));
    for (const [jobId, title] of [...watched]) {
      if (activeIds.has(jobId)) continue;
      watched.delete(jobId);
      void announce(jobId, title);
    }
    for (const job of active) watched.set(job.id, job.title ?? job.kind);
    if (active.length > 0) next = ACTIVE_INTERVAL_MS;
  } catch {
    useShell.getState().setJobs(null);
  } finally {
    polling = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void poll(), next);
  }
}

/**
 * One poller per browser tab, independent of the page being shown. It publishes the running and
 * queued counts to the top bar and announces every job that leaves the active set.
 */
export function startJobWatcher(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void poll();
}

/** Call after submitting a job so its completion is announced even when it finishes between polls. */
export function trackJob(job: JobOut): void {
  if (!isTerminal(job.status)) watched.set(job.id, job.title ?? job.kind);
  startJobWatcher();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void poll(), 300);
}
