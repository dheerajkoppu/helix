"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiQuery } from "@/lib/api/query";
import type { Schema } from "@/lib/api/types";
import { useJobs, type JobPage, type ModelsOut } from "@/lib/state/jobs";

export type CompoundAnalogsResponse = Schema<"CompoundAnalogsResponse">;

/** ChEMBL similarity neighbours of a compound. Slow when cold (a few seconds). */
export function useCompoundAnalogs(
  compoundId: string | null | undefined,
  options: { threshold?: number; limit?: number } = {},
) {
  return useQuery({
    ...apiQuery<CompoundAnalogsResponse>(
      `/compounds/${encodeURIComponent(compoundId ?? "")}/analogs`,
      { threshold: options.threshold, limit: options.limit },
    ),
    staleTime: 30 * 60 * 1000,
    enabled: Boolean(compoundId),
  });
}

/** Registered model providers with their live availability. */
export function useModelProviders() {
  return useQuery({ ...apiQuery<ModelsOut>("/models"), staleTime: 60 * 1000 });
}

/** Binding prediction jobs of this workspace; refetched when a watched job finishes. */
export function useBindingJobs() {
  const revision = useJobs((state) => state.revision);
  const query = useQuery({
    ...apiQuery<JobPage>("/jobs", { kind: "binding_prediction", limit: 100 }),
    staleTime: 15 * 1000,
  });
  const { refetch } = query;
  useEffect(() => {
    if (revision > 0) void refetch();
  }, [revision, refetch]);
  return query;
}
