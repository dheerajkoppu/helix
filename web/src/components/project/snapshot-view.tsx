"use client";

import { useQuery } from "@tanstack/react-query";
import { GitForkIcon, LinkIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ButtonLink } from "@/components/data/button-link";
import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { LineageLine } from "@/components/project/lineage";
import { ProjectBody } from "@/components/project/project-body";
import { ExportMenu, copyLink } from "@/components/project/project-workspace";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/client";
import { formatTimestamp } from "@/lib/format";
import { isSnapshotId, routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { projectKeys, projectsApi } from "@/lib/state/projects";

const DESCRIPTION = "A frozen copy of a project. This link never changes.";

export function SnapshotView({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const wellFormed = isSnapshotId(snapshotId);
  const query = useQuery({
    queryKey: projectKeys.snapshot(snapshotId),
    queryFn: ({ signal }) => projectsApi.snapshot(snapshotId, signal),
    enabled: wellFormed,
    staleTime: Infinity,
  });
  const snapshot = query.data;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const advanced = useAdvancedMode();

  async function fork() {
    setForking(true);
    try {
      const created = await projectsApi.forkSnapshot(snapshotId);
      toast.success("Fork created", {
        description: `${created.title} is now in your projects, linked to this snapshot.`,
      });
      router.push(routes.project(created.id));
    } catch (error) {
      toast.error("Fork failed", {
        description: isApiError(error)
          ? error.message
          : "The snapshot could not be forked.",
      });
      setForking(false);
    }
  }

  if (!snapshot)
    return (
      <Page>
        <PageHeader
          kind="Snapshot"
          title="Shared research snapshot"
          id={<MonoId value={snapshotId} />}
          description={DESCRIPTION}
        />
        <PageBody className="py-5">
          <Plate className={wellFormed && query.isPending ? undefined : "h-72"}>
            {!wellFormed ? (
              <EmptyState
                title="Not a snapshot identifier"
                description="Check that the link was copied in full."
                actions={<TextLink href={routes.projects()}>Projects</TextLink>}
              />
            ) : query.isPending ? (
              <RowsSkeleton rows={8} />
            ) : isApiError(query.error) && query.error.isNotFound ? (
              <EmptyState
                title={
                  query.error.code === "snapshot_withdrawn"
                    ? "This snapshot was withdrawn by its owner"
                    : "No snapshot with this identifier"
                }
                description="Check that the link was copied in full."
                actions={<TextLink href={routes.projects()}>Projects</TextLink>}
              />
            ) : (
              <QueryErrorState
                error={query.error}
                subject={`snapshot ${snapshotId}`}
                onRetry={() => void query.refetch()}
                retrying={query.isFetching}
              />
            )}
          </Plate>
        </PageBody>
      </Page>
    );

  const selected =
    selectedItemId ??
    (advanced
      ? (snapshot.trail.active_item_id ??
        snapshot.trail.nodes[0]?.item_id ??
        null)
      : null);

  return (
    <Page>
      <PageHeader
        kind="Snapshot"
        title={snapshot.title}
        id={advanced ? <MonoId value={snapshot.id} /> : undefined}
        description={snapshot.description ?? DESCRIPTION}
        meta={
          !advanced ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground">
                <LockIcon aria-hidden className="size-3" />
                Read only
              </span>
              <span aria-hidden>·</span>
              <span>
                published{" "}
                <span className="tabular font-mono">
                  {formatTimestamp(snapshot.created_at)}
                </span>
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono">{snapshot.license}</span>
              {snapshot.withdrawn ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-warning">withdrawn</span>
                </>
              ) : null}
            </p>
          ) : (
          <div className="flex flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground">
                <LockIcon aria-hidden className="size-3" />
                Read only
              </span>
              <span aria-hidden>·</span>
              <span>
                snapshot{" "}
                <span className="tabular font-mono">
                  #{snapshot.sequence_number}
                </span>{" "}
                published{" "}
                <span className="tabular font-mono">
                  {formatTimestamp(snapshot.created_at)}
                </span>
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono">{snapshot.license}</span>
              {snapshot.message ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-foreground">{snapshot.message}</span>
                </>
              ) : null}
              {snapshot.withdrawn ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-warning">
                    withdrawn: visible to its owner only
                  </span>
                </>
              ) : null}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>Content SHA-256</span>
              <MonoId value={snapshot.content_sha256}>
                {snapshot.content_sha256.slice(0, 16)}…
              </MonoId>
              {snapshot.parent_snapshot_id ? (
                <>
                  <span aria-hidden>·</span>
                  <span>previous</span>
                  <TextLink
                    href={routes.snapshot(snapshot.parent_snapshot_id)}
                    className="font-mono"
                  >
                    {snapshot.parent_snapshot_id}
                  </TextLink>
                </>
              ) : null}
              <span aria-hidden>·</span>
              {snapshot.project_available ? (
                <span>
                  {snapshot.is_head ? "current head of" : "an earlier state of"}{" "}
                  <TextLink href={routes.project(snapshot.project_id)}>
                    the working project
                  </TextLink>
                </span>
              ) : (
                <span>the working project is private</span>
              )}
            </p>
            <LineageLine
              lineage={snapshot.lineage}
              projectId={snapshot.project_id}
            />
          </div>
          )
        }
        actions={
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
            <Button onClick={() => void fork()} disabled={forking}>
              <GitForkIcon data-icon="inline-start" />
              {forking ? "Forking" : "Fork Research"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void copyLink(snapshot.share_path, "Share link")}
            >
              <LinkIcon data-icon="inline-start" />
              Copy link
            </Button>
            <ExportMenu
              basePath={`/snapshots/${snapshot.id}`}
              name={snapshot.id}
            />
            {snapshot.is_owner ? (
              <ButtonLink href={routes.project(snapshot.project_id)}>
                Open project
              </ButtonLink>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <ProjectBody
          items={snapshot.items}
          trail={snapshot.trail}
          selectedItemId={selected}
          onSelect={setSelectedItemId}
        />
      </PageBody>
    </Page>
  );
}
