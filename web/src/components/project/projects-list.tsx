"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { GitForkIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { TextLink } from "@/components/data/text-link";
import { KIND_META, KIND_ORDER } from "@/components/project/kinds";
import { PageSection, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/client";
import { formatTimestamp } from "@/lib/format";
import { routes } from "@/lib/ids";
import {
  PROJECT_WORDS,
  plainAccess,
  plainDate,
  plainSavedCount,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  projectKeys,
  projectsApi,
  useProjects,
  type ProjectSummary,
} from "@/lib/state/projects";

type Scope = "mine" | "public";

const SCOPES: { id: Scope; label: string; plain: string }[] = [
  { id: "mine", label: "This workspace", plain: PROJECT_WORDS.yours },
  { id: "public", label: "Public", plain: PROJECT_WORDS.shared },
];

function contents(project: ProjectSummary): string {
  const parts = KIND_ORDER.filter((kind) => project.item_counts[kind]).map(
    (kind) => `${project.item_counts[kind]} ${KIND_META[kind].code}`,
  );
  return parts.length ? parts.join("  ") : "empty";
}

function ProjectRow({
  project,
  scope,
}: {
  project: ProjectSummary;
  scope: Scope;
}) {
  const advanced = useAdvancedMode();
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <Link
        href={routes.project(project.id)}
        className="grid gap-x-4 gap-y-0.5 px-3 py-2 outline-none hover:bg-accent focus-visible:bg-accent md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7rem_10rem] md:items-baseline"
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {project.title}
            </span>
            {project.lineage.forked_from_project_id ? (
              <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
                <GitForkIcon aria-hidden className="size-3" />
                fork
                {project.lineage.forked_from_title
                  ? ` of ${project.lineage.forked_from_title}`
                  : ""}
              </span>
            ) : null}
          </span>
          {project.description ? (
            <span className="truncate text-xs text-muted-foreground">
              {project.description}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "truncate text-muted-foreground",
            advanced ? "font-mono text-2xs" : "text-xs",
          )}
        >
          {advanced ? contents(project) : plainSavedCount(project.item_count)}
        </span>
        <span className="text-xs text-muted-foreground">
          {!advanced
            ? scope === "mine"
              ? plainAccess(project.visibility)
              : project.is_owner
                ? PROJECT_WORDS.yours
                : PROJECT_WORDS.readOnly
            : scope === "mine"
              ? project.head_snapshot_id
                ? `${project.visibility}, published`
                : project.visibility
              : project.is_owner
                ? "yours"
                : "read only"}
        </span>
        <span
          className={cn(
            "tabular text-subtle-foreground md:text-right",
            advanced ? "font-mono text-2xs" : "text-xs",
          )}
        >
          {advanced
            ? formatTimestamp(project.updated_at)
            : plainDate(project.updated_at)}
        </span>
      </Link>
    </li>
  );
}

export function ProjectsList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const revision = useProjects((state) => state.revision);
  const [scope, setScope] = useState<Scope>("mine");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const advanced = useAdvancedMode();
  const query = useQuery({
    queryKey: projectKeys.list(scope),
    queryFn: ({ signal }) => projectsApi.list(scope, signal),
    staleTime: 0,
  });

  useEffect(() => {
    if (revision > 0)
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
  }, [revision, queryClient]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const project = await projectsApi.create({ title: title.trim() });
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
      router.push(routes.project(project.id));
    } catch (error) {
      toast.error(advanced ? "Project not created" : PROJECT_WORDS.notSaved, {
        description: advanced
          ? isApiError(error)
            ? error.message
            : "The project could not be saved."
          : undefined,
      });
      setCreating(false);
    }
  }

  const projects = query.data?.items ?? [];

  return (
    <PageSection
      title={
        <span
          role="tablist"
          aria-label="Which projects"
          className="flex items-center gap-4"
        >
          {SCOPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={scope === entry.id}
              onClick={() => setScope(entry.id)}
              className={cn(
                "border-b-2 border-transparent pb-0.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                scope === entry.id
                  ? "border-foreground font-medium text-foreground"
                  : "font-normal text-muted-foreground hover:text-foreground",
              )}
            >
              {advanced ? entry.label : entry.plain}
              {scope === entry.id && query.data ? (
                <span className="tabular ml-2 font-mono text-xs font-normal text-subtle-foreground">
                  {query.data.total}
                </span>
              ) : null}
            </button>
          ))}
        </span>
      }
      actions={
        <form onSubmit={create} className="flex items-center gap-2">
          <Input
            aria-label="Title of a new project"
            placeholder={advanced ? "Project title" : PROJECT_WORDS.projectName}
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
            className="w-56 max-w-full min-w-0"
          />
          <Button type="submit" disabled={!title.trim() || creating}>
            {creating ? PROJECT_WORDS.saving : PROJECT_WORDS.newProject}
          </Button>
        </form>
      }
    >
      <Plate
        className={projects.length || query.isPending ? undefined : "h-56"}
      >
        {query.isPending ? (
          <RowsSkeleton rows={5} />
        ) : query.isError ? (
          <QueryErrorState
            error={query.error}
            subject="projects"
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : projects.length ? (
          <>
            <div className="hidden h-7 items-center gap-x-4 border-b border-border bg-muted px-3 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7rem_10rem]">
              <span>{PROJECT_WORDS.project}</span>
              <span>{advanced ? "Trail" : PROJECT_WORDS.saved}</span>
              <span>
                {advanced
                  ? scope === "mine"
                    ? "Visibility"
                    : "Access"
                  : PROJECT_WORDS.whoSees}
              </span>
              <span className="text-right">
                {advanced ? "Updated" : PROJECT_WORDS.changed}
              </span>
            </div>
            <ul>
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} scope={scope} />
              ))}
            </ul>
          </>
        ) : scope === "mine" ? (
          <EmptyState
            title={PROJECT_WORDS.none}
            description={
              advanced
                ? "Name one above, or use Add to project on any page."
                : PROJECT_WORDS.noneHint
            }
            actions={<TextLink href={routes.explore()}>Explore</TextLink>}
          />
        ) : (
          <EmptyState
            title={advanced ? "No public projects" : PROJECT_WORDS.noneShared}
          />
        )}
      </Plate>
    </PageSection>
  );
}
