"use client";

import { useRouter } from "next/navigation";
import { cn } from "cn";
import { useMemo, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { Unknown } from "@/components/data/definition-list";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import {
  HypothesisEditor,
  STATUS_LABELS,
  StatusControl,
  type HypothesisDraft,
} from "@/components/project/hypothesis-editor";
import { ItemInspector } from "@/components/project/item-inspector";
import { KIND_META, KIND_ORDER, KindMark } from "@/components/project/kinds";
import {
  ResearchTrail,
  TrailLegend,
} from "@/components/project/research-trail";
import { PageSection, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/data/text-link";
import { EVIDENCE_DISPLAY_ORDER, isEvidenceClass } from "@/lib/evidence";
import { formatTimestamp } from "@/lib/format";
import {
  PROJECT_WORDS,
  plainDate,
  plainIdeaState,
  plainSavedLabel,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import type {
  HypothesisStatus,
  ItemKind,
  ProjectItem,
  Trail,
} from "@/lib/state/projects";

export interface ProjectActions {
  setActive: (itemId: string) => Promise<void>;
  removeItem: (item: ProjectItem) => Promise<void>;
  saveNote: (item: ProjectItem, note: string | null) => Promise<void>;
  addNote: (parent: ProjectItem | null, text: string) => Promise<void>;
  addHypothesis: (
    draft: HypothesisDraft,
    parentItemId: string | null,
  ) => Promise<void>;
  updateHypothesis: (
    item: ProjectItem,
    draft: Partial<HypothesisDraft>,
  ) => Promise<void>;
}

export interface ProjectBodyProps {
  items: ProjectItem[];
  trail: Trail;
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
  /** omitted for a frozen snapshot or a project the caller does not own */
  actions?: ProjectActions;
}

const LEDGER_MAX_HEIGHT = 420;

function evidenceCell(item: ProjectItem) {
  if (item.kind === "hypothesis")
    return (
      <EvidenceBadge evidenceClass="helix_hypothesis" size="compact" />
    );
  const counts = new Map<string, number>();
  for (const record of item.evidence)
    if (isEvidenceClass(record.evidence_class))
      counts.set(
        record.evidence_class,
        (counts.get(record.evidence_class) ?? 0) + 1,
      );
  if (!counts.size) return <Unknown reason="None attached" />;
  return (
    <span className="flex items-center gap-2">
      {EVIDENCE_DISPLAY_ORDER.filter((entry) => counts.has(entry)).map(
        (entry) => (
          <EvidenceBadge
            key={entry}
            evidenceClass={entry}
            size="compact"
            detail={counts.get(entry)}
          />
        ),
      )}
    </span>
  );
}

/** Trail, hypotheses, ledger and notes of a project or of a frozen snapshot. */
export function ProjectBody({
  items,
  trail,
  selectedItemId,
  onSelect,
  actions,
}: ProjectBodyProps) {
  const router = useRouter();
  const readOnly = !actions;
  const [editing, setEditing] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const advanced = useAdvancedMode();
  const [hypothesisOpen, setHypothesisOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const byId = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const selected = selectedItemId ? (byId.get(selectedItemId) ?? null) : null;
  const hypotheses = items.filter((item) => item.hypothesis);
  const notes = items.filter((item) => item.kind === "note");
  const supportCandidates = items.filter(
    (item) => item.kind !== "note" && item.kind !== "screenshot",
  );
  const ledgerRows = items.filter((item) => item.kind !== "note");
  const kindsPresent = new Set(ledgerRows.map((item) => item.kind));

  const columns = useMemo<DataTableColumn<ProjectItem>[]>(
    () => [
      {
        id: "label",
        header: "Item",
        accessor: (item) => item.label,
        width: "minmax(10rem,1.4fr)",
        cell: (item) => (
          <span className="truncate text-foreground">{item.label}</span>
        ),
      },
      {
        id: "ref",
        header: "Identifier",
        accessor: (item) => item.ref,
        mono: true,
        width: "minmax(8rem,1fr)",
        cell: (item) =>
          item.ref ? (
            <span className="truncate">{item.ref}</span>
          ) : item.hypothesis ? (
            <span className="truncate">{item.hypothesis.record.id}</span>
          ) : (
            <Unknown reason="None" />
          ),
      },
      {
        id: "evidence",
        header: "Evidence carried",
        width: 168,
        sortable: false,
        cell: evidenceCell,
      },
      {
        id: "origin",
        header: "Saved from",
        accessor: (item) => item.origin.route,
        mono: true,
        width: "minmax(8rem,1fr)",
        cell: (item) =>
          item.origin.route ? (
            <span className="truncate">{item.origin.route}</span>
          ) : (
            <Unknown reason="Not recorded" />
          ),
      },
      {
        id: "added",
        header: "Added",
        accessor: (item) => item.origin.created_at ?? item.created_at,
        mono: true,
        width: 176,
        cell: (item) =>
          formatTimestamp(item.origin.created_at ?? item.created_at),
      },
    ],
    [],
  );

  const ledgerHeight = Math.min(
    LEDGER_MAX_HEIGHT,
    28 * (ledgerRows.length + kindsPresent.size + 1) + 2,
  );

  return (
    <>
      <PageSection
        title={advanced ? "Research trail" : PROJECT_WORDS.savedItems}
        count={trail.nodes.length}
      >
        {trail.nodes.length ? (
          <Plate
            className={cn(
              "grid",
              selected && "lg:grid-cols-[minmax(0,1fr)_20rem]",
            )}
          >
            <div className="flex min-w-0 flex-col">
              <ResearchTrail
                trail={trail}
                items={items}
                selectedItemId={selectedItemId}
                onSelect={onSelect}
                showAttachPoint={!readOnly}
                className="max-h-[34rem] min-h-40 flex-1"
              />
              {advanced ? <TrailLegend showAttachPoint={!readOnly} /> : null}
            </div>
            <div
              hidden={!selected}
              className="scroll-thin max-h-[34rem] min-w-0 overflow-y-auto border-t border-border lg:border-t-0 lg:border-l"
            >
              <ItemInspector
                item={selected}
                items={items}
                activeItemId={trail.active_item_id}
                readOnly={readOnly}
                onSelect={onSelect}
                onSetActive={
                  actions
                    ? (itemId) => void actions.setActive(itemId)
                    : undefined
                }
                onRemove={
                  actions ? (item) => void actions.removeItem(item) : undefined
                }
                onSaveNote={actions?.saveNote}
                onAddNote={
                  actions
                    ? (parent, text) => actions.addNote(parent, text)
                    : undefined
                }
              />
            </div>
          </Plate>
        ) : (
          <Plate className="h-56">
            <EmptyState
              title={advanced ? "No steps yet" : PROJECT_WORDS.nothingSaved}
              description={readOnly ? undefined : PROJECT_WORDS.noneHint}
              actions={
                readOnly ? undefined : <TextLink href="/explore">Explore</TextLink>
              }
            />
          </Plate>
        )}
      </PageSection>

      <PageSection
        title={advanced ? "Hypotheses" : PROJECT_WORDS.ideas}
        count={hypotheses.length}
        actions={
          actions && !advanced && !hypothesisOpen ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHypothesisOpen(true)}
            >
              {PROJECT_WORDS.newIdea}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          {hypotheses.map((item) => {
            const hypothesis = item.hypothesis;
            if (!hypothesis) return null;
            if (editing === item.id && actions)
              return (
                <HypothesisEditor
                  key={item.id}
                  candidates={supportCandidates.filter(
                    (entry) => entry.id !== item.id,
                  )}
                  initial={{
                    statement: hypothesis.statement,
                    status: hypothesis.status,
                    supporting_item_ids: hypothesis.supporting_item_ids,
                  }}
                  submitLabel={advanced ? "Save hypothesis" : PROJECT_WORDS.saveIdea}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (draft) => {
                    await actions.updateHypothesis(item, draft);
                    setEditing(null);
                  }}
                />
              );
            return (
              <article
                key={item.id}
                className="flex flex-col gap-2 border border-dotted border-ev-hypothesis p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {advanced ? (
                    <EvidenceBadge
                      evidenceClass="helix_hypothesis"
                      detail={hypothesis.record.id}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {PROJECT_WORDS.ideaCaveat}
                    </span>
                  )}
                  {actions ? (
                    <StatusControl
                      value={hypothesis.status}
                      onChange={(status: HypothesisStatus) =>
                        void actions.updateHypothesis(item, { status })
                      }
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {advanced
                        ? `Status: ${STATUS_LABELS[hypothesis.status]}`
                        : plainIdeaState(hypothesis.status)}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelect(item.id)}
                    >
                      {advanced ? "Show in trail" : PROJECT_WORDS.showSaved}
                    </Button>
                    {actions ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(item.id)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </span>
                </div>
                <p className="max-w-[72ch] text-base text-foreground">
                  {hypothesis.statement}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    {advanced ? "Rests on" : PROJECT_WORDS.ideaRestsOn}
                  </span>
                  {hypothesis.supporting_item_ids.map((identifier) => {
                    const supporting = byId.get(identifier);
                    return supporting ? (
                      <button
                        key={identifier}
                        type="button"
                        onClick={() => onSelect(identifier)}
                        className="flex min-w-0 items-center gap-1.5 rounded-xs underline decoration-border-strong underline-offset-[3px] outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        {advanced ? <KindMark item={supporting} /> : null}
                        <span className="truncate">
                          {advanced
                            ? supporting.label
                            : plainSavedLabel(supporting.label)}
                        </span>
                      </button>
                    ) : null;
                  })}
                </div>
              </article>
            );
          })}
          {actions && !advanced && !hypothesisOpen ? (
            hypotheses.length ? null : (
              <p className="text-sm text-muted-foreground">
                {PROJECT_WORDS.noIdeas}
              </p>
            )
          ) : actions ? (
            <HypothesisEditor
              key={`new-${selected?.id ?? "none"}`}
              candidates={supportCandidates}
              suggestedSupport={
                selected &&
                selected.kind !== "note" &&
                selected.kind !== "hypothesis"
                  ? [selected.id]
                  : []
              }
              submitLabel={
                advanced ? "Record hypothesis" : PROJECT_WORDS.saveIdea
              }
              onSubmit={(draft) =>
                actions.addHypothesis(
                  draft,
                  draft.supporting_item_ids[
                    draft.supporting_item_ids.length - 1
                  ] ?? null,
                )
              }
            />
          ) : hypotheses.length ? null : (
            <p className="text-sm text-muted-foreground">
              {advanced ? "None recorded." : PROJECT_WORDS.noIdeas}
            </p>
          )}
        </div>
      </PageSection>

      {advanced ? (
      <PageSection
        title="Items"
        count={ledgerRows.length}
      >
        {ledgerRows.length ? (
          <Plate style={{ height: ledgerHeight }}>
            <DataTable
              label="Project items"
              columns={columns}
              data={ledgerRows}
              getRowId={(item) => item.id}
              selectedRowId={selectedItemId}
              onRowSelect={(item) => onSelect(item.id)}
              onRowActivate={(item) =>
                item.href ? router.push(item.href) : undefined
              }
              groupBy={(item) => item.kind}
              groupOrder={KIND_ORDER}
              groupLabel={(group) => (
                <span className="uppercase">{KIND_META[group as ItemKind].plural}</span>
              )}
            />
          </Plate>
        ) : (
          <p className="text-xs text-muted-foreground">No items saved.</p>
        )}
      </PageSection>
      ) : null}

      <PageSection title={PROJECT_WORDS.notes} count={notes.length}>
        <div className="flex flex-col">
          {notes.map((note) => {
            const parent = note.parent_item_id
              ? byId.get(note.parent_item_id)
              : null;
            return (
              <article
                key={note.id}
                className="flex flex-col gap-1 border-b border-border-subtle py-2.5 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium text-foreground">
                    {note.label}
                  </span>
                  {parent ? (
                    <button
                      type="button"
                      onClick={() => onSelect(parent.id)}
                      className="flex items-center gap-1.5 rounded-xs text-muted-foreground underline decoration-border-strong underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      on {advanced ? <KindMark item={parent} /> : null}{" "}
                      {advanced ? parent.label : plainSavedLabel(parent.label)}
                    </button>
                  ) : null}
                  <span
                    className={cn(
                      "tabular ml-auto text-2xs text-subtle-foreground",
                      advanced && "font-mono",
                    )}
                  >
                    {advanced
                      ? formatTimestamp(note.created_at)
                      : plainDate(note.created_at)}
                  </span>
                  {actions ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void actions.removeItem(note)}
                    >
                      {PROJECT_WORDS.remove}
                    </Button>
                  ) : null}
                </div>
                {note.note ? (
                  <p className="max-w-[72ch] text-sm whitespace-pre-wrap text-foreground">
                    {note.note}
                  </p>
                ) : null}
              </article>
            );
          })}
          {!notes.length && readOnly ? (
            <p className="text-xs text-muted-foreground">No notes recorded.</p>
          ) : null}
          {actions && !advanced && !noteOpen ? (
            <Button
              variant="outline"
              size="sm"
              className={cn("self-start", notes.length > 0 && "mt-3")}
              onClick={() => setNoteOpen(true)}
            >
              {PROJECT_WORDS.addNote}
            </Button>
          ) : actions ? (
            <form
              className="flex flex-col gap-2 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                const text = newNote.trim();
                if (!text) return;
                void actions
                  .addNote(
                    selected && selected.kind !== "note" ? selected : null,
                    text,
                  )
                  .then(() => setNewNote(""));
              }}
            >
              <textarea
                aria-label="New note"
                value={newNote}
                maxLength={20000}
                placeholder={
                  !advanced
                    ? PROJECT_WORDS.writeNote
                    : selected && selected.kind !== "note"
                      ? `Note on ${selected.label}`
                      : "Note on the project"
                }
                onChange={(event) => setNewNote(event.target.value)}
                className="min-h-16 w-full max-w-[72ch] resize-y rounded-md border border-input bg-input/20 px-2 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <Button
                type="submit"
                variant="outline"
                className="self-start"
                disabled={!newNote.trim()}
              >
                {PROJECT_WORDS.addNote}
              </Button>
            </form>
          ) : null}
        </div>
      </PageSection>
    </>
  );
}
