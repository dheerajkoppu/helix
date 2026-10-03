"use client";

import { useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  KIND_META,
  KindMark,
  structureOriginOf,
} from "@/components/project/kinds";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAdvancedMode } from "@/lib/state/preferences";
import { EVIDENCE_DISPLAY_ORDER, isEvidenceClass } from "@/lib/evidence";
import { formatTimestamp } from "@/lib/format";
import {
  PROJECT_WORDS,
  plainDate,
  plainSavedKind,
  plainSavedLabel,
} from "@/lib/plain-language";
import type { ProjectItem } from "@/lib/state/projects";

export interface ItemInspectorProps {
  item: ProjectItem | null;
  items: ProjectItem[];
  activeItemId: string | null;
  readOnly: boolean;
  onSelect: (itemId: string) => void;
  onSetActive?: (itemId: string) => void;
  onRemove?: (item: ProjectItem) => void;
  onSaveNote?: (item: ProjectItem, note: string | null) => Promise<void>;
  onAddNote?: (parent: ProjectItem, text: string) => Promise<void>;
}

function ItemLink({
  item,
  onSelect,
}: {
  item: ProjectItem;
  onSelect: (itemId: string) => void;
}) {
  const plain = !useAdvancedMode();
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className="flex max-w-full min-w-0 items-center gap-1.5 rounded-xs text-left underline decoration-border-strong underline-offset-[3px] outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <KindMark item={item} className="no-underline" />
      <span className="truncate">{plain ? plainSavedLabel(item.label) : item.label}</span>
    </button>
  );
}

function evidenceDatabase(record: Record<string, unknown>): string | null {
  const source = record.source as Record<string, unknown> | null | undefined;
  return source && typeof source.database === "string" ? source.database : null;
}

function evidenceSummary(record: Record<string, unknown>): string {
  const source = record.source as Record<string, unknown> | null | undefined;
  if (source && typeof source.database === "string") {
    const release =
      typeof source.release === "string" ? `, ${source.release}` : "";
    return `${source.database}:${String(source.record_id ?? "")}${release}`;
  }
  if (typeof record.generated_by === "string") return record.generated_by;
  if (typeof record.id === "string") return record.id;
  return "No source record";
}

/** Provenance of one trail node: what it is, where it was saved from, what it rests on. */
export function ItemInspector({
  item,
  items,
  activeItemId,
  readOnly,
  onSelect,
  onSetActive,
  onRemove,
  onSaveNote,
  onAddNote,
}: ItemInspectorProps) {
  if (!item)
    return (
      <EmptyState title={PROJECT_WORDS.pickItem} />
    );
  return (
    <ItemInspectorBody
      key={item.id}
      item={item}
      items={items}
      activeItemId={activeItemId}
      readOnly={readOnly}
      onSelect={onSelect}
      onSetActive={onSetActive}
      onRemove={onRemove}
      onSaveNote={onSaveNote}
      onAddNote={onAddNote}
    />
  );
}

function ItemInspectorBody({
  item,
  items,
  activeItemId,
  readOnly,
  onSelect,
  onSetActive,
  onRemove,
  onSaveNote,
  onAddNote,
}: ItemInspectorProps & { item: ProjectItem }) {
  const advanced = useAdvancedMode();
  const [note, setNote] = useState(item.note ?? "");
  const [annotation, setAnnotation] = useState("");
  const [busy, setBusy] = useState(false);

  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const parent = item.parent_item_id ? byId.get(item.parent_item_id) : null;
  const steps = items.filter(
    (entry) => entry.parent_item_id === item.id && entry.kind !== "note",
  );
  const notes = items.filter(
    (entry) => entry.parent_item_id === item.id && entry.kind === "note",
  );
  const supportsHypotheses = items.filter((entry) =>
    entry.hypothesis?.supporting_item_ids.includes(item.id),
  );
  const origin = structureOriginOf(item.kind === "structure" ? item.ref : null);
  const urlState = Object.entries(item.origin.url_state);
  const isActive = activeItemId === item.id;
  const classCounts = new Map<string, number>();
  for (const record of item.evidence) {
    const key = isEvidenceClass(record.evidence_class)
      ? record.evidence_class
      : "unclassified";
    classCounts.set(key, (classCounts.get(key) ?? 0) + 1);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          {advanced ? <KindMark item={item} /> : null}
          <span className="text-2xs tracking-[0.04em] text-muted-foreground uppercase">
            {advanced ? KIND_META[item.kind].label : plainSavedKind(item.kind)}
          </span>
          {advanced && isActive && !readOnly ? (
            <span className="ml-auto text-2xs text-muted-foreground">
              attach point
            </span>
          ) : null}
        </div>
        <p className="text-base font-medium break-words text-foreground">
          {advanced ? item.label : plainSavedLabel(item.label)}
        </p>
        {advanced && item.ref ? (
          <MonoId value={item.ref} className="text-xs" />
        ) : null}
        {origin ? <StructureOriginTag origin={origin} caption /> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.href ? (
            <ButtonLink href={item.href} variant="default" size="sm">
              {advanced ? "Reopen view" : PROJECT_WORDS.open}
            </ButtonLink>
          ) : null}
          {!readOnly && onSetActive && !isActive && item.kind !== "note" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onSetActive(item.id)}
            >
              {PROJECT_WORDS.continueHere}
            </Button>
          ) : null}
          {!readOnly && onRemove ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onRemove(item)}
            >
              {PROJECT_WORDS.remove}
            </Button>
          ) : null}
        </div>
      </div>

      {item.hypothesis ? (
        <>
          <SectionHeader title={advanced ? "Hypothesis" : PROJECT_WORDS.ideas} />
          <div className="flex flex-col gap-2 px-3 py-2.5">
            {advanced ? (
              <EvidenceBadge
                evidenceClass="orphafold_hypothesis"
                detail={`status: ${item.hypothesis.status}`}
                className="self-start"
              />
            ) : null}
            <p className="text-sm text-foreground">
              {item.hypothesis.statement}
            </p>
            {advanced ? (
              <p className="text-2xs text-muted-foreground">
                Authored in OrphaFold (
                {item.hypothesis.record.authoring?.method === "llm_assisted"
                  ? "assistant-drafted"
                  : "written by a person"}
                ). It rests on:
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {PROJECT_WORDS.ideaCaveat} {PROJECT_WORDS.ideaRestsOn}:
              </p>
            )}
            <ul className="flex flex-col gap-1 text-xs">
              {item.hypothesis.supporting_item_ids.map((identifier) => {
                const supporting = byId.get(identifier);
                return supporting ? (
                  <li key={identifier} className="min-w-0">
                    <ItemLink item={supporting} onSelect={onSelect} />
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        </>
      ) : null}

      {advanced ? <SectionHeader title="Provenance" /> : null}
      <DefinitionList termWidth="6.5rem">
        {advanced ? (
        <DefinitionRow term="Saved from" mono>
          {item.origin.route ?? <Unknown reason="Not recorded" />}
        </DefinitionRow>
        ) : null}
        {advanced ? (
        <DefinitionRow term="View state" mono>
          {urlState.length ? (
            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
              {urlState.map(([key, value]) => (
                <span key={key}>
                  <span className="text-muted-foreground">{key}=</span>
                  {value}
                </span>
              ))}
            </span>
          ) : (
            <Unknown reason="Default view" />
          )}
        </DefinitionRow>
        ) : null}
        {advanced ? (
          <DefinitionRow term="Added" mono>
            {formatTimestamp(item.origin.created_at ?? item.created_at)}
          </DefinitionRow>
        ) : (
          <DefinitionRow term={PROJECT_WORDS.saved}>
            {plainDate(item.origin.created_at ?? item.created_at)}
          </DefinitionRow>
        )}
        {advanced || parent ? (
          <DefinitionRow term={advanced ? "Follows" : PROJECT_WORDS.comesAfter}>
            {parent ? (
              <ItemLink item={parent} onSelect={onSelect} />
            ) : (
              <Unknown reason="Start of a trail" />
            )}
          </DefinitionRow>
        ) : null}
        {steps.length ? (
          <DefinitionRow term={advanced ? "Led to" : PROJECT_WORDS.leadsTo}>
            <span className="flex flex-col gap-1">
              {steps.map((step) => (
                <ItemLink key={step.id} item={step} onSelect={onSelect} />
              ))}
            </span>
          </DefinitionRow>
        ) : null}
        {supportsHypotheses.length ? (
          <DefinitionRow term={advanced ? "Supports" : PROJECT_WORDS.backs}>
            <span className="flex flex-col gap-1">
              {supportsHypotheses.map((hypothesis) => (
                <ItemLink
                  key={hypothesis.id}
                  item={hypothesis}
                  onSelect={onSelect}
                />
              ))}
            </span>
          </DefinitionRow>
        ) : null}
        {advanced && item.origin.note ? (
          <DefinitionRow term="Origin note">{item.origin.note}</DefinitionRow>
        ) : null}
        {advanced && item.origin.forked_from_item_id ? (
          <DefinitionRow term="Copied from" mono>
            {item.origin.forked_from_item_id}
          </DefinitionRow>
        ) : null}
        {advanced ? (
          <DefinitionRow term="Item ID" mono>
            <MonoId value={item.id} />
          </DefinitionRow>
        ) : null}
      </DefinitionList>

      {item.kind !== "hypothesis" && item.kind !== "note" ? (
        <>
          <SectionHeader
            title={advanced ? "Evidence carried" : PROJECT_WORDS.sources}
            count={item.evidence.length}
          />
          {item.evidence.length ? (
            <ul className="flex flex-col">
              {item.evidence.slice(0, 12).map((record, index) => (
                <li
                  key={typeof record.id === "string" ? record.id : index}
                  className="flex min-h-7 items-center gap-2 border-b border-border-subtle px-3 py-1 text-xs last:border-b-0"
                >
                  {isEvidenceClass(record.evidence_class) ? (
                    <EvidenceBadge
                      evidenceClass={record.evidence_class}
                      size="compact"
                      source={evidenceDatabase(record)}
                      detail={advanced ? undefined : evidenceSummary(record)}
                    />
                  ) : (
                    <Unknown reason="Unclassified" />
                  )}
                  {advanced ? (
                    <span className="min-w-0 truncate font-mono text-muted-foreground">
                      {evidenceSummary(record)}
                    </span>
                  ) : null}
                </li>
              ))}
              {advanced && item.evidence.length > 12 ? (
                <li className="px-3 py-1 text-2xs text-muted-foreground">
                  {item.evidence.length - 12} more in the export (
                  {EVIDENCE_DISPLAY_ORDER.filter((entry) =>
                    classCounts.has(entry),
                  )
                    .map((entry) => `${classCounts.get(entry)} ${entry}`)
                    .join(", ")}
                  )
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {advanced
                ? "None attached. Reopen the view for its sources."
                : PROJECT_WORDS.noSources}
            </p>
          )}
        </>
      ) : null}

      <SectionHeader
        title={item.kind === "note" ? "Note" : PROJECT_WORDS.notes}
        count={
          item.kind === "note" ? undefined : notes.length + (item.note ? 1 : 0)
        }
      />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {readOnly || !onSaveNote ? (
          item.note ? (
            <p className="text-sm whitespace-pre-wrap text-foreground">
              {item.note}
            </p>
          ) : notes.length ? null : (
            <Unknown reason="No note" className="text-xs" />
          )
        ) : (
          <>
            <Textarea
              aria-label={`Note on ${item.label}`}
              value={note}
              maxLength={20000}
              placeholder={advanced ? "Note on this item" : PROJECT_WORDS.writeNote}
              onChange={(event) => setNote(event.target.value)}
            />
            {(item.note ?? "") !== note ? (
              <Button
                size="sm"
                className="self-start"
                disabled={busy}
                onClick={() => run(() => onSaveNote(item, note.trim() || null))}
              >
                {PROJECT_WORDS.saveNote}
              </Button>
            ) : null}
          </>
        )}
        {notes.map((entry) => (
          <button
            type="button"
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            className="border-l-2 border-border-strong pl-2 text-left text-xs outline-none hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="block font-medium text-foreground">
              {entry.label}
            </span>
            {entry.note ? (
              <span className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                {entry.note}
              </span>
            ) : null}
          </button>
        ))}
        {advanced && !readOnly && onAddNote && item.kind !== "note" ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const text = annotation.trim();
              if (!text) return;
              void run(async () => {
                await onAddNote(item, text);
                setAnnotation("");
              });
            }}
          >
            <Textarea
              aria-label={`New note attached to ${item.label}`}
              value={annotation}
              maxLength={20000}
              placeholder="Add a note"
              className="min-h-10"
              onChange={(event) => setAnnotation(event.target.value)}
            />
            {annotation.trim() ? (
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy}
              >
                Attach note
              </Button>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}
