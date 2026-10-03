"use client";

import { useQuery } from "@tanstack/react-query";

import { apiQuery } from "@/lib/api/query";
import { formatCount } from "@/lib/format";

/** The gene count is the loaded catalog's own; without the API the line makes no numeric claim. */
export function MissionLine() {
  const meta = useQuery(apiQuery("/meta"));
  const catalog = meta.data?.data.catalog;
  const genes = catalog?.state === "ready" ? catalog.counts.genes : null;
  return (
    <p className="mb-3 text-sm text-foreground">
      {genes
        ? `${formatCount(genes)} immune-disease genes. One open research workspace.`
        : "Inborn errors of immunity first. One open research workspace."}
    </p>
  );
}
