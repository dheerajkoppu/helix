"use client";

import { cn } from "cn";
import { useState } from "react";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { KindMark } from "@/components/project/kinds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  HYPOTHESIS_STATUSES,
  type HypothesisStatus,
  type ProjectItem,
} from "@/lib/state/projects";

export const STATUS_LABELS: Record<HypothesisStatus, string> = {
  draft: "Draft",
  open: "Open",
  supported: "Supported",
  contradicted: "Contradicted",
  retired: "Retired",
};

export interface HypothesisDraft {
  statement: string;
  status: HypothesisStatus;
  supporting_item_ids: string[];
}

export function StatusControl({
  value,
  onChange,
  disabled,
}: {
  value: HypothesisStatus;
  onChange: (status: HypothesisStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Hypothesis status"
      className="inline-flex border border-border-strong"
    >
      {HYPOTHESIS_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={value === status}
          disabled={disabled}
          onClick={() => onChange(status)}
          className={cn(
            "h-6 border-r border-border-subtle px-2 text-2xs text-muted-foreground outline-none last:border-r-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
            value === status && "bg-active font-medium text-foreground",
          )}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

export interface HypothesisEditorProps {
  /** items a hypothesis may rest on */
  candidates: ProjectItem[];
  initial?: HypothesisDraft;
  /** preselected support for a new hypothesis, e.g. the selected trail node */
  suggestedSupport?: string[];
  submitLabel: string;
  onSubmit: (draft: HypothesisDraft) => Promise<void>;
  onCancel?: () => void;
}

/**
 * A hypothesis is a statement authored in OrphaFold. It cannot be saved without at least one
 * supporting item, and it is always shown with the HYP evidence badge.
 */
export function HypothesisEditor({
  candidates,
  initial,
  suggestedSupport = [],
  submitLabel,
  onSubmit,
  onCancel,
}: HypothesisEditorProps) {
  const [statement, setStatement] = useState(initial?.statement ?? "");
  const [status, setStatus] = useState<HypothesisStatus>(
    initial?.status ?? "draft",
  );
  const [support, setSupport] = useState<string[]>(
    initial?.supporting_item_ids ?? suggestedSupport,
  );
  const [saving, setSaving] = useState(false);
  const ready = statement.trim().length > 0 && support.length > 0;

  function toggle(itemId: string, checked: boolean) {
    setSupport((current) =>
      checked
        ? [...current.filter((entry) => entry !== itemId), itemId]
        : current.filter((entry) => entry !== itemId),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        statement: statement.trim(),
        status,
        supporting_item_ids: support,
      });
      if (!initial) {
        setStatement("");
        setSupport([]);
        setStatus("draft");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-x-6 gap-y-3 border border-dotted border-ev-hypothesis p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceBadge evidenceClass="orphafold_hypothesis" />
          <span className="text-2xs text-muted-foreground">
            Authored in OrphaFold. It records what the linked items suggest, not
            an established finding.
          </span>
        </div>
        <Textarea
          aria-label="Hypothesis statement"
          value={statement}
          maxLength={4000}
          placeholder="State the hypothesis in one or two sentences"
          className="min-h-20 text-sm"
          onChange={(event) => setStatement(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <StatusControl
            value={status}
            onChange={setStatus}
            disabled={saving}
          />
          <span className="ml-auto flex items-center gap-2">
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={!ready || saving}>
              {saving ? "Saving" : submitLabel}
            </Button>
          </span>
        </div>
        {!support.length ? (
          <p className="text-2xs text-muted-foreground">
            Link at least one supporting item to save. A hypothesis without
            support cannot be recorded.
          </p>
        ) : null}
      </div>

      <fieldset className="flex min-w-0 flex-col" disabled={saving}>
        <legend className="mb-1 flex w-full items-baseline justify-between text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          Supporting items
          <span className="tabular font-mono font-normal text-subtle-foreground normal-case">
            {support.length} linked
          </span>
        </legend>
        {candidates.length ? (
          <ul className="scroll-thin max-h-44 overflow-y-auto border border-border">
            {candidates.map((item) => {
              const id = `support-${initial ? "edit" : "new"}-${item.id}`;
              return (
                <li
                  key={item.id}
                  className="flex h-7 items-center gap-2 border-b border-border-subtle px-2 last:border-b-0"
                >
                  <Checkbox
                    id={id}
                    checked={support.includes(item.id)}
                    onCheckedChange={(checked) =>
                      toggle(item.id, checked === true)
                    }
                  />
                  <label
                    htmlFor={id}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs"
                  >
                    <KindMark item={item} />
                    <span className="truncate text-foreground">
                      {item.label}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border border-border px-2 py-1.5 text-xs text-muted-foreground">
            Save a gene, variant, structure, paper or run to the project first.
            A hypothesis rests on saved items.
          </p>
        )}
      </fieldset>
    </form>
  );
}
