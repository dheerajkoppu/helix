"use client";

import { cn } from "cn";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";

import { MonoId } from "@/components/data/mono-id";
import { KindMark } from "@/components/project/kinds";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api/client";
import { routes } from "@/lib/ids";
import {
  PROJECT_WORDS,
  plainSavedCount,
  plainSavedKind,
  plainSavedLabel,
  plainSavedTo,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  getLastProjectId,
  projectsApi,
  setLastProjectId,
  useProjects,
  type ProjectItemDraft,
  type ProjectSummary,
} from "@/lib/state/projects";

export type { ProjectItemDraft } from "@/lib/state/projects";

const NEW_PROJECT = "__new__";
const HOST_ID = "helix-add-to-project";

/** The dialog mounts itself on first use, so no layout has to render a host. */
function ensureHost(): void {
  if (typeof document === "undefined" || document.getElementById(HOST_ID))
    return;
  const container = document.createElement("div");
  container.id = HOST_ID;
  document.body.appendChild(container);
  createRoot(container).render(<AddToProjectDialog />);
}

/** Opens the Add to project dialog for one item. Callable from any event handler. */
export function openAddToProject(draft: ProjectItemDraft): void {
  ensureHost();
  useProjects.getState().openAdd(draft);
}

/** The view the reader is on, so the trail node can reopen it exactly. */
function currentView(): { route: string; url_state: Record<string, string> } {
  const url_state: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    url_state[key] = value;
  });
  return {
    route: `${window.location.pathname}${window.location.search}`,
    url_state,
  };
}

function AddToProjectDialog() {
  const draft = useProjects((state) => state.draft);
  const open = useProjects((state) => state.addOpen);
  const closeAdd = useProjects((state) => state.closeAdd);
  const touch = useProjects((state) => state.touch);
  const advanced = useAdvancedMode();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(NEW_PROJECT);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const page = await projectsApi.list("mine", signal);
      setProjects(page.items);
      const last = getLastProjectId();
      const preferred =
        page.items.find((project) => project.id === last) ?? page.items[0];
      setChoice(preferred ? preferred.id : NEW_PROJECT);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setProjects([]);
      setChoice(NEW_PROJECT);
      setLoadError(
        isApiError(error) ? error.message : "Projects could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the dialog opens
    setNote("");
    setTitle(
      draft
        ? advanced
          ? `${draft.label} investigation`
          : plainSavedLabel(draft.label)
        : "",
    );
    void load(controller.signal);
    return () => controller.abort();
  }, [open, draft, load, advanced]);

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      let projectId = choice;
      let projectTitle =
        projects?.find((project) => project.id === choice)?.title ?? "";
      if (choice === NEW_PROJECT) {
        const created = await projectsApi.create({
          title: title.trim() || "Untitled project",
        });
        projectId = created.id;
        projectTitle = created.title;
      }
      const view = currentView();
      const item = await projectsApi.addItem(projectId, {
        kind: draft.kind,
        ref: draft.ref,
        label: draft.label,
        note: note.trim() || null,
        origin: {
          route: draft.origin?.route ?? view.route,
          url_state: view.url_state,
          note: draft.origin?.note ?? null,
        },
        evidence: draft.evidence ?? [],
        data: draft.data ?? {},
      });
      setLastProjectId(projectId);
      touch();
      closeAdd();
      const href = `${routes.project(projectId)}?item=${item.id}`;
      toast.success(
        advanced
          ? `Added ${draft.label} to ${projectTitle}`
          : plainSavedTo(projectTitle),
        {
        description: advanced
          ? item.parent_item_id
            ? "Attached after the active trail node."
            : "Started a new trail."
          : undefined,
        action: {
          label: advanced ? "Open trail" : PROJECT_WORDS.openProject,
          // The dialog lives in its own root, outside the app router
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick: () => window.location.assign(href),
        },
        },
      );
    } catch (error) {
      toast.error(advanced ? "Not added" : PROJECT_WORDS.notSaved, {
        description: advanced
          ? isApiError(error)
            ? error.message
            : "The item could not be saved."
          : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const creating = choice === NEW_PROJECT;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : closeAdd())}>
      <DialogContent className="gap-3 rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {advanced ? "Add to project" : PROJECT_WORDS.save}
          </DialogTitle>
          <DialogDescription className={advanced ? undefined : "sr-only"}>
            The item is attached after the project&apos;s active trail node,
            with the view it was saved from.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="flex min-w-0 items-center gap-2 border-y border-border-subtle py-2">
            {advanced ? <KindMark item={draft} /> : null}
            <span
              className={cn(
                "truncate font-medium text-foreground",
                advanced ? "text-xs" : "text-sm",
              )}
            >
              {advanced ? draft.label : plainSavedLabel(draft.label)}
            </span>
            {advanced ? (
              <MonoId
                value={draft.ref}
                copyable={false}
                className="ml-auto max-w-[45%] truncate text-muted-foreground"
              />
            ) : (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {plainSavedKind(draft.kind)}
              </span>
            )}
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-1" disabled={saving}>
          <legend className="mb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {PROJECT_WORDS.project}
          </legend>
          <div
            role="radiogroup"
            aria-label="Project"
            className="scroll-thin max-h-44 overflow-y-auto border border-border"
          >
            {projects === null ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {advanced
                  ? "Loading projects of this workspace"
                  : PROJECT_WORDS.loading}
              </p>
            ) : null}
            {(projects ?? []).map((project) => (
              <ProjectChoice
                key={project.id}
                selected={choice === project.id}
                onSelect={() => setChoice(project.id)}
                title={project.title}
                detail={
                  advanced
                    ? `${project.item_count} ${project.item_count === 1 ? "item" : "items"}`
                    : plainSavedCount(project.item_count)
                }
                plain={!advanced}
              />
            ))}
            <ProjectChoice
              selected={creating}
              onSelect={() => setChoice(NEW_PROJECT)}
              title={PROJECT_WORDS.newProject}
              detail={advanced ? "start a trail" : ""}
              plain={!advanced}
            />
          </div>
          {loadError && advanced ? (
            <p className="text-xs text-muted-foreground">
              {loadError} A new project can still be created.
            </p>
          ) : null}
          {creating ? (
            <Input
              aria-label="Title of the new project"
              placeholder={advanced ? "Project title" : PROJECT_WORDS.projectName}
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1"
            />
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {PROJECT_WORDS.note}
          </span>
          <Textarea
            value={note}
            maxLength={2000}
            placeholder={
              advanced
                ? "Why this matters to the investigation"
                : PROJECT_WORDS.noteHint
            }
            onChange={(event) => setNote(event.target.value)}
            className="min-h-14"
          />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={closeAdd} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !draft || projects === null}
          >
            {advanced
              ? saving
                ? "Adding"
                : creating
                  ? "Create and add"
                  : "Add"
              : saving
                ? PROJECT_WORDS.saving
                : PROJECT_WORDS.saveButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectChoice({
  selected,
  onSelect,
  title,
  detail,
  plain = false,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  /** everyday wording: no monospace */
  plain?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "relative flex h-7 w-full items-center gap-2 border-b border-border-subtle px-2 text-left text-xs outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent",
        selected && "bg-active",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      <span
        className={cn(
          "tabular shrink-0 text-2xs text-subtle-foreground",
          !plain && "font-mono",
        )}
      >
        {detail}
      </span>
    </button>
  );
}

export interface AddToProjectButtonProps {
  item: ProjectItemDraft;
  /** default "Add to project" */
  label?: string;
  variant?: "outline" | "ghost" | "default";
  size?: "default" | "sm" | "icon" | "icon-sm";
  className?: string;
}

/** Quick add from anywhere: choose or create a project, attach after its active trail node. */
export function AddToProjectButton({
  item,
  label = "Add to project",
  variant = "outline",
  size = "default",
  className,
}: AddToProjectButtonProps) {
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      aria-label={iconOnly ? `${label}: ${item.label}` : undefined}
      title={iconOnly ? label : undefined}
      onClick={() => openAddToProject(item)}
    >
      <FolderPlusIcon data-icon="inline-start" />
      {iconOnly ? null : label}
    </Button>
  );
}
