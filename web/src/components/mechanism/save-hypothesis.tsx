"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
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
  getLastProjectId,
  projectsApi,
  setLastProjectId,
  type ProjectSummary,
} from "@/lib/state/projects";

import {
  plural,
  raises,
  type MechanismCandidate,
  type MechanismsResponse,
} from "./data";

const NEW_PROJECT = "__new__";

export interface SaveHypothesisProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MechanismsResponse;
  candidate: MechanismCandidate;
}

/**
 * Saves a candidate as an Helix hypothesis. The variant is added to the project with the
 * records that raise the candidate, and the hypothesis rests on that item, so its `derived_from`
 * lists the item and every evidence ID.
 */
export function SaveHypothesis({
  open,
  onOpenChange,
  data,
  candidate,
}: SaveHypothesisProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [choice, setChoice] = useState(NEW_PROJECT);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [saving, setSaving] = useState(false);

  const variantLabel = `${data.gene.id} ${data.protein_change ?? data.variant_id}`;
  const supporting = candidate.observations.filter(raises);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the dialog opens
    setStatement(candidate.claim);
    setTitle(`${variantLabel} investigation`);
    projectsApi
      .list("mine", controller.signal)
      .then((page) => {
        setProjects(page.items);
        const last = getLastProjectId();
        const preferred =
          page.items.find((project) => project.id === last) ?? page.items[0];
        setChoice(preferred ? preferred.id : NEW_PROJECT);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setProjects([]);
        setChoice(NEW_PROJECT);
      });
    return () => controller.abort();
  }, [open, candidate.claim, variantLabel]);

  async function save() {
    if (saving || !statement.trim()) return;
    setSaving(true);
    try {
      let projectId = choice;
      if (choice === NEW_PROJECT) {
        const created = await projectsApi.create({
          title: title.trim() || "Untitled project",
        });
        projectId = created.id;
      }
      const route = `${window.location.pathname}${window.location.search}`;
      const item = await projectsApi.addItem(projectId, {
        kind: "variant",
        ref: data.variant_id,
        label: variantLabel,
        note: `Records that raise the candidate "${candidate.label}".`,
        origin: { route, note: "Mechanism workspace" },
        evidence: supporting.map((observation) => observation.evidence),
        data: {
          mechanism: {
            category: candidate.category,
            support: candidate.support,
            rules: supporting.map((observation) => observation.rule),
            observations: supporting.map((observation) => ({
              id: observation.id,
              summary: observation.summary,
              evidence_id: observation.evidence.id,
            })),
          },
        },
      });
      const hypothesis = await projectsApi.addHypothesis(projectId, {
        statement: statement.trim(),
        supporting_item_ids: [item.id],
        status: "draft",
        parent_item_id: item.id,
      });
      setLastProjectId(projectId);
      onOpenChange(false);
      const href = `${routes.project(projectId)}?item=${hypothesis.id}`;
      toast.success("Hypothesis saved as a draft", {
        description: `Derived from ${plural(hypothesis.hypothesis?.derived_from.length ?? supporting.length, "record")}.`,
        action: { label: "Open project", onClick: () => router.push(href) },
      });
    } catch (error) {
      toast.error("Hypothesis not saved", {
        description: isApiError(error)
          ? error.message
          : "The project could not be written.",
      });
    } finally {
      setSaving(false);
    }
  }

  const creating = choice === NEW_PROJECT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 rounded-lg sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Save as hypothesis</DialogTitle>
          <DialogDescription>
            Stored as an Helix hypothesis, apart from the evidence it rests
            on. It starts as a draft.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Statement
            <EvidenceBadge
              evidenceClass="helix_hypothesis"
              size="compact"
            />
          </span>
          <Textarea
            value={statement}
            maxLength={4000}
            onChange={(event) => setStatement(event.target.value)}
            className="min-h-16"
          />
        </label>

        <div className="border-y border-border-subtle py-2 text-xs">
          <p className="text-muted-foreground">
            Derived from {plural(supporting.length, "record")} on {variantLabel}
          </p>
          <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto">
            {supporting.map((observation) => (
              <li
                key={observation.id}
                className="flex min-w-0 items-baseline gap-2"
              >
                <EvidenceBadge
                  evidenceClass={observation.evidence_class}
                  size="compact"
                  className="shrink-0"
                />
                <span className="min-w-0 truncate">{observation.summary}</span>
              </li>
            ))}
          </ul>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-1" disabled={saving}>
          <legend className="mb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Project
          </legend>
          <div
            role="radiogroup"
            aria-label="Project"
            className="scroll-thin max-h-36 overflow-y-auto border border-border"
          >
            {projects === null ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Loading projects of this workspace
              </p>
            ) : null}
            {[
              ...(projects ?? []).map((project) => ({
                id: project.id,
                title: project.title,
                detail: plural(project.item_count, "item"),
              })),
              {
                id: NEW_PROJECT,
                title: "New project",
                detail: "start a trail",
              },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={choice === option.id}
                onClick={() => setChoice(option.id)}
                className={cn(
                  "relative flex h-7 w-full items-center gap-2 border-b border-border-subtle px-2 text-left text-xs outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent",
                  choice === option.id && "bg-active",
                )}
              >
                {choice === option.id ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {option.title}
                </span>
                <span className="tabular shrink-0 font-mono text-2xs text-subtle-foreground">
                  {option.detail}
                </span>
              </button>
            ))}
          </div>
          {creating ? (
            <Input
              aria-label="Title of the new project"
              placeholder="Project title"
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1"
            />
          ) : null}
        </fieldset>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || projects === null || !statement.trim()}
          >
            {saving ? "Saving" : "Save hypothesis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
