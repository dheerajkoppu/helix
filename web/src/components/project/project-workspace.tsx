"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  DownloadIcon,
  GitForkIcon,
  LinkIcon,
  SettingsIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { LineageLine } from "@/components/project/lineage";
import {
  ProjectBody,
  type ProjectActions,
} from "@/components/project/project-body";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Plate,
} from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api/client";
import { formatTimestamp } from "@/lib/format";
import {
  PROJECT_WORDS,
  plainAccess,
  plainDate,
  plainSavedCount,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { routes } from "@/lib/ids";
import {
  downloadExport,
  projectKeys,
  projectsApi,
  setLastProjectId,
  useProjects,
  type ExportFormat,
  type ProjectDetail,
  type ProjectVisibility,
} from "@/lib/state/projects";

const VISIBILITY: Record<ProjectVisibility, { label: string; detail: string }> =
  {
    private: {
      label: "Private",
      detail: "Only this workspace can open the project.",
    },
    unlisted: {
      label: "Unlisted",
      detail: "Anyone with the project link can read and fork it.",
    },
    public: {
      label: "Public",
      detail: "Listed under public projects; anyone can read and fork it.",
    },
  };

const EXPORTS: {
  format: ExportFormat;
  label: string;
  detail: string;
  plain: string;
}[] = [
  {
    format: "md",
    label: "Research report",
    detail: "Markdown",
    plain: PROJECT_WORDS.report,
  },
  {
    format: "json",
    label: "Project document",
    detail: "project.json",
    plain: PROJECT_WORDS.dataFile,
  },
  {
    format: "zip",
    label: "Full export",
    detail: "zip: manifest, items, citations, run manifests",
    plain: PROJECT_WORDS.everything,
  },
];

function describe(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function absoluteUrl(path: string): string {
  return typeof window === "undefined"
    ? path
    : `${window.location.origin}${path}`;
}

export async function copyLink(path: string, what: string) {
  try {
    await navigator.clipboard.writeText(absoluteUrl(path));
    toast.success(`${what} copied`, { description: absoluteUrl(path) });
  } catch {
    toast(`${what}: ${absoluteUrl(path)}`);
  }
}

export function ExportMenu({
  basePath,
  name,
}: {
  basePath: string;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const advanced = useAdvancedMode();
  async function run(format: ExportFormat) {
    setBusy(true);
    try {
      const filename = await downloadExport(
        `${basePath}/export.${format}`,
        `${name}.${format}`,
      );
      toast.success("Export saved", { description: filename });
    } catch (error) {
      toast.error("Export failed", {
        description: describe(error, "The export could not be built."),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" disabled={busy} />}
      >
        <DownloadIcon data-icon="inline-start" />
        {advanced ? (busy ? "Exporting" : "Export") : PROJECT_WORDS.download}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={advanced ? "w-72" : "w-44"}
      >
        {EXPORTS.map((entry) => (
          <DropdownMenuItem
            key={entry.format}
            onClick={() => void run(entry.format)}
          >
            <span className="flex-1">
              {advanced ? entry.label : entry.plain}
            </span>
            {advanced ? (
              <span className="font-mono text-2xs text-muted-foreground">
                {entry.detail}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const revision = useProjects((state) => state.revision);
  const query = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: ({ signal }) => projectsApi.get(projectId, signal),
    staleTime: 0,
  });
  const project = query.data;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const advanced = useAdvancedMode();

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("item");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount
    if (requested) setSelectedItemId(requested);
  }, []);

  useEffect(() => {
    if (revision > 0)
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
  }, [revision, projectId, queryClient]);

  useEffect(() => {
    if (project?.is_owner) setLastProjectId(project.id);
  }, [project?.id, project?.is_owner]);

  const selected =
    selectedItemId && project?.items.some((item) => item.id === selectedItemId)
      ? selectedItemId
      : advanced
        ? (project?.trail.active_item_id ??
          project?.trail.nodes[0]?.item_id ??
          null)
        : null;

  const select = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    const url = new URL(window.location.href);
    url.searchParams.set("item", itemId);
    window.history.replaceState(null, "", url);
  }, []);

  const refresh = useCallback(
    async (next?: ProjectDetail) => {
      if (next) queryClient.setQueryData(projectKeys.detail(projectId), next);
      else
        await queryClient.invalidateQueries({
          queryKey: projectKeys.detail(projectId),
        });
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    },
    [projectId, queryClient],
  );

  const actions = useMemo<ProjectActions | undefined>(() => {
    if (!project?.is_owner) return undefined;
    const guard = async (work: () => Promise<unknown>, failure: string) => {
      try {
        await work();
        await refresh();
      } catch (error) {
        toast.error(failure, {
          description: describe(error, "The change was not saved."),
        });
      }
    };
    return {
      setActive: (itemId) =>
        guard(async () => {
          await projectsApi.update(projectId, { active_item_id: itemId });
          if (advanced)
            toast("Attach point moved", {
              description: "The next saved item follows this node.",
            });
          else toast(PROJECT_WORDS.continuing);
        }, advanced ? "Attach point not moved" : PROJECT_WORDS.notSaved),
      removeItem: (item) =>
        guard(async () => {
          await projectsApi.removeItem(projectId, item.id);
          if (advanced)
            toast(`Removed ${item.label}`, {
              description: "Its steps now follow the item before it.",
            });
          else toast(PROJECT_WORDS.removed);
        }, advanced ? "Not removed" : PROJECT_WORDS.notSaved),
      saveNote: (item, note) =>
        guard(
          () => projectsApi.updateItem(projectId, item.id, { note }),
          "Note not saved",
        ),
      addNote: (parent, text) =>
        guard(
          () =>
            projectsApi.addItem(projectId, {
              kind: "note",
              label: text.split("\n", 1)[0].slice(0, 80),
              note: text,
              parent_item_id: parent?.id ?? null,
              attach_to_active: false,
              origin: {
                route: `${routes.project(projectId)}${parent ? `?item=${parent.id}` : ""}`,
              },
            }),
          "Note not added",
        ),
      addHypothesis: (draft, parentItemId) =>
        guard(async () => {
          const created = await projectsApi.addHypothesis(projectId, {
            ...draft,
            parent_item_id: parentItemId,
          });
          setSelectedItemId(created.id);
          if (advanced)
            toast.success("Hypothesis recorded", {
              description: `Rests on ${draft.supporting_item_ids.length} saved ${draft.supporting_item_ids.length === 1 ? "item" : "items"}.`,
            });
          else toast.success(PROJECT_WORDS.ideaSaved);
        }, advanced ? "Hypothesis not recorded" : PROJECT_WORDS.notSaved),
      updateHypothesis: (item, draft) =>
        guard(
          () =>
            projectsApi.updateItem(projectId, item.id, { hypothesis: draft }),
          "Hypothesis not saved",
        ),
    };
  }, [project?.is_owner, projectId, refresh, advanced]);

  async function fork() {
    setForking(true);
    try {
      const created = await projectsApi.fork(projectId);
      toast.success("Fork created", {
        description: `${created.title} is now in your projects.`,
      });
      router.push(routes.project(created.id));
    } catch (error) {
      toast.error("Fork failed", {
        description: describe(error, "The project could not be forked."),
      });
    } finally {
      setForking(false);
    }
  }

  if (query.isPending)
    return (
      <Page>
        <PageHeader
          kind="Project"
          title="Research project"
          id={<MonoId value={projectId} />}
        />
        <PageBody className="py-5">
          <Plate>
            <RowsSkeleton rows={8} />
          </Plate>
        </PageBody>
      </Page>
    );

  if (!project)
    return (
      <Page>
        <PageHeader
          kind="Project"
          title="Research project"
          id={<MonoId value={projectId} />}
        />
        <PageBody className="py-5">
          <Plate className="h-72">
            {isApiError(query.error) && query.error.isNotFound ? (
              <EmptyState
                title="Project not found"
                description="It was deleted, or is private to another workspace."
                actions={
                  <TextLink href={routes.projects()}>All projects</TextLink>
                }
              />
            ) : (
              <QueryErrorState
                error={query.error}
                subject={`project ${projectId}`}
                onRetry={() => void query.refetch()}
                retrying={query.isFetching}
              />
            )}
          </Plate>
        </PageBody>
      </Page>
    );

  const head = project.snapshots.find(
    (snapshot) => snapshot.id === project.head_snapshot_id,
  );

  return (
    <Page>
      <PageHeader
        kind="Project"
        title={project.title}
        id={advanced ? <MonoId value={project.id} /> : undefined}
        description={project.description ?? undefined}
        meta={
          !advanced ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="text-foreground">
                {plainSavedCount(project.item_count)}
              </span>
              <span aria-hidden>·</span>
              <span>
                {PROJECT_WORDS.whoSees}: {plainAccess(project.visibility)}
              </span>
              {project.is_owner ? null : (
                <>
                  <span aria-hidden>·</span>
                  <span>{PROJECT_WORDS.readOnly}</span>
                </>
              )}
            </p>
          ) : (
          <div className="flex flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="text-foreground">
                {VISIBILITY[project.visibility].label}
              </span>
              <span aria-hidden>·</span>
              <span>
                {project.is_owner
                  ? "owned by this workspace"
                  : "read only: owned by another workspace"}
              </span>
              <span aria-hidden>·</span>
              <span>
                updated{" "}
                <span className="tabular font-mono">
                  {formatTimestamp(project.updated_at)}
                </span>
              </span>
              <span aria-hidden>·</span>
              {head ? (
                <span className="flex items-center gap-1.5">
                  {project.unpublished_changes
                    ? "changed since snapshot"
                    : "published as"}
                  <TextLink href={head.share_path} className="font-mono">
                    {head.id}
                  </TextLink>
                </span>
              ) : (
                <span>not published</span>
              )}
            </p>
            <LineageLine lineage={project.lineage} projectId={project.id} />
          </div>
          )
        }
        actions={
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
            {project.is_owner ? (
              <Button onClick={() => setPublishOpen(true)}>
                {advanced ? "Publish" : PROJECT_WORDS.share}
              </Button>
            ) : null}
            {head ? (
              <Button
                variant="outline"
                onClick={() => void copyLink(head.share_path, "Share link")}
              >
                <LinkIcon data-icon="inline-start" />
                {advanced ? "Share link" : PROJECT_WORDS.copyLink}
              </Button>
            ) : null}
            {advanced || !project.is_owner ? (
              <Button
                variant={project.is_owner ? "outline" : "default"}
                onClick={() => void fork()}
                disabled={forking}
              >
                <GitForkIcon data-icon="inline-start" />
                {advanced
                  ? forking
                    ? "Forking"
                    : "Fork Research"
                  : PROJECT_WORDS.makeCopy}
              </Button>
            ) : null}
            <ExportMenu
              basePath={`/projects/${project.id}`}
              name={project.id}
            />
            {project.is_owner ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={PROJECT_WORDS.settings}
                title={PROJECT_WORDS.settings}
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <ProjectBody
          items={project.items}
          trail={project.trail}
          selectedItemId={selected}
          onSelect={select}
          actions={actions}
        />

        {advanced || project.snapshots.length ? (
        <PageSection
          title={advanced ? "Snapshots" : PROJECT_WORDS.sharedCopies}
          count={project.snapshots.length}
        >
          {project.snapshots.length ? (
            <ul className="border border-border">
              {project.snapshots.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-1 text-xs last:border-b-0"
                >
                  <span className="tabular w-8 font-mono text-muted-foreground">
                    #{snapshot.sequence_number}
                  </span>
                  <TextLink
                    href={snapshot.share_path}
                    className={advanced ? "font-mono" : undefined}
                  >
                    {advanced ? snapshot.id : PROJECT_WORDS.open}
                  </TextLink>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {snapshot.message ?? (advanced ? "No message" : "")}
                  </span>
                  {advanced && snapshot.id === project.head_snapshot_id ? (
                    <span className="text-2xs tracking-[0.04em] text-foreground uppercase">
                      head
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "tabular text-2xs text-subtle-foreground",
                      advanced && "font-mono",
                    )}
                  >
                    {advanced
                      ? formatTimestamp(snapshot.created_at)
                      : plainDate(snapshot.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void copyLink(snapshot.share_path, "Share link")
                    }
                  >
                    {PROJECT_WORDS.copyLink}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not published yet.
            </p>
          )}
        </PageSection>
        ) : null}
      </PageBody>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        project={project}
        onPublished={() => void refresh()}
      />
      <SettingsDialog
        key={`${project.id}-${project.updated_at}`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
        onSaved={(next) => void refresh(next)}
        onDeleted={() => {
          setLastProjectId(null);
          void queryClient.invalidateQueries({
            queryKey: ["projects", "list"],
          });
          router.push(routes.projects());
        }}
      />
    </Page>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  project,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  onPublished: () => void;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const advanced = useAdvancedMode();
  const unchanged =
    Boolean(project.head_snapshot_id) && !project.unpublished_changes;

  async function publish() {
    setSaving(true);
    try {
      const snapshot = await projectsApi.publish(
        project.id,
        message.trim() || null,
      );
      onPublished();
      onOpenChange(false);
      setMessage("");
      toast.success(
        !advanced
          ? PROJECT_WORDS.linkReady
          : unchanged
            ? "Already published"
            : `Snapshot #${snapshot.sequence_number} published`,
        {
          description: absoluteUrl(snapshot.share_path),
          action: {
            label: PROJECT_WORDS.copyLink,
            onClick: () => void copyLink(snapshot.share_path, "Share link"),
          },
        },
      );
    } catch (error) {
      toast.error(advanced ? "Not published" : PROJECT_WORDS.notSaved, {
        description: advanced
          ? describe(error, "The snapshot could not be created.")
          : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {advanced ? "Publish a snapshot" : PROJECT_WORDS.shareTitle}
          </DialogTitle>
          <DialogDescription>
            {advanced
              ? "Freezes the trail, items, notes and hypotheses as they are now. Anyone with the link can read and fork the snapshot; later edits to the project do not change it."
              : PROJECT_WORDS.shareLine}
          </DialogDescription>
        </DialogHeader>
        <dl
          hidden={!advanced}
          className={cn(
            "grid-cols-[7rem_minmax(0,1fr)] gap-y-1 border-y border-border-subtle py-2 text-xs",
            advanced && "grid",
          )}
        >
          <dt className="text-muted-foreground">Contents</dt>
          <dd className="tabular font-mono">
            {project.item_count} items, {project.item_counts.hypothesis ?? 0}{" "}
            hypotheses
          </dd>
          <dt className="text-muted-foreground">License</dt>
          <dd className="font-mono">{project.license}</dd>
          <dt className="text-muted-foreground">Previous</dt>
          <dd className="truncate font-mono">
            {project.head_snapshot_id ?? "None"}
          </dd>
        </dl>
        {unchanged ? (
          advanced ? (
            <p className="text-xs text-muted-foreground">
              Nothing changed since the last snapshot. Publishing returns the
              same link.
            </p>
          ) : null
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {advanced ? "Message (optional)" : PROJECT_WORDS.note}
            </span>
            <Input
              value={message}
              maxLength={1000}
              placeholder={
                advanced ? "What this snapshot records" : PROJECT_WORDS.shareNote
              }
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {PROJECT_WORDS.cancel}
          </Button>
          <Button onClick={() => void publish()} disabled={saving}>
            {!advanced
              ? saving
                ? PROJECT_WORDS.saving
                : PROJECT_WORDS.getLink
              : saving
                ? "Publishing"
                : unchanged
                  ? "Get share link"
                  : "Publish snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  project,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  onSaved: (project: ProjectDetail) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [visibility, setVisibility] = useState<ProjectVisibility>(
    project.visibility,
  );
  const [saving, setSaving] = useState(false);
  const advanced = useAdvancedMode();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const next = await projectsApi.update(project.id, {
        title: title.trim() || project.title,
        description: description.trim() || null,
        visibility,
      });
      onSaved(next);
      onOpenChange(false);
      toast("Project saved");
    } catch (error) {
      toast.error("Not saved", {
        description: describe(error, "The project was not changed."),
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await projectsApi.remove(project.id);
      toast(`Deleted ${project.title}`, {
        description: "Published snapshots stay readable.",
      });
      onDeleted();
    } catch (error) {
      toast.error("Not deleted", {
        description: describe(error, "The project was not deleted."),
      });
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{PROJECT_WORDS.settings}</DialogTitle>
          <DialogDescription className={advanced ? undefined : "sr-only"}>
            Title, description and who can open the working project.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {advanced ? "Title" : PROJECT_WORDS.name}
          </span>
          <Input
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {advanced ? "Description" : PROJECT_WORDS.about}
          </span>
          <Textarea
            value={description}
            maxLength={5000}
            placeholder={
              advanced
                ? "The question this investigation asks"
                : PROJECT_WORDS.aboutHint
            }
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {advanced ? "Visibility" : PROJECT_WORDS.whoSees}
          </legend>
          <div
            role="radiogroup"
            aria-label="Visibility"
            className="border border-border"
          >
            {(Object.keys(VISIBILITY) as ProjectVisibility[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={visibility === value}
                onClick={() => setVisibility(value)}
                className={cn(
                  "relative flex min-h-7 w-full items-baseline gap-2 border-b border-border-subtle px-2 py-1 text-left text-xs outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent",
                  visibility === value && "bg-active",
                )}
              >
                {visibility === value ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
                  />
                ) : null}
                {advanced ? (
                  <>
                    <span className="w-16 shrink-0 font-medium text-foreground">
                      {VISIBILITY[value].label}
                    </span>
                    <span className="text-muted-foreground">
                      {VISIBILITY[value].detail}
                    </span>
                  </>
                ) : (
                  <span className="font-medium text-foreground">
                    {plainAccess(value)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <DialogFooter className="sm:justify-between">
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={() => void remove()}
                disabled={saving}
              >
                Delete project
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={saving}
              >
                Keep
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              Delete
            </Button>
          )}
          <span className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              Save
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
