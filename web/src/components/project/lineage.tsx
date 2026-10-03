import { GitForkIcon } from "lucide-react";

import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { routes } from "@/lib/ids";
import type { Lineage } from "@/lib/state/projects";

/** Where a project came from: the project and snapshot it was forked from, and its root. */
export function LineageLine({
  lineage,
  projectId,
}: {
  lineage: Lineage;
  projectId: string;
}) {
  const isFork = Boolean(lineage.forked_from_project_id);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <GitForkIcon aria-hidden className="size-3.5 shrink-0" />
      {isFork ? (
        <>
          <span>Forked from</span>
          {lineage.forked_from_snapshot_id ? (
            <TextLink href={routes.snapshot(lineage.forked_from_snapshot_id)}>
              {lineage.forked_from_title ?? "a shared snapshot"}
            </TextLink>
          ) : (
            <TextLink
              href={routes.project(lineage.forked_from_project_id as string)}
            >
              {lineage.forked_from_title ?? "a project"}
            </TextLink>
          )}
          {lineage.forked_from_snapshot_id ? (
            <MonoId value={lineage.forked_from_snapshot_id} />
          ) : (
            <span>(working state, no snapshot)</span>
          )}
          <span aria-hidden>·</span>
          <span>
            fork depth{" "}
            <span className="tabular font-mono text-foreground">
              {lineage.fork_depth}
            </span>
          </span>
          {lineage.root_project_id !== lineage.forked_from_project_id ? (
            <>
              <span aria-hidden>·</span>
              <span>root</span>
              <MonoId value={lineage.root_project_id} />
            </>
          ) : null}
        </>
      ) : (
        <span>
          Original project
          {lineage.root_project_id !== projectId ? null : ", not a fork"}
        </span>
      )}
      <span aria-hidden>·</span>
      <span>
        <span className="tabular font-mono text-foreground">
          {lineage.fork_count}
        </span>{" "}
        {lineage.fork_count === 1 ? "fork" : "forks"} in this lineage
      </span>
    </p>
  );
}
