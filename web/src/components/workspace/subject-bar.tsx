"use client";

import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";

import { EvidenceGlyph } from "@/components/evidence/glyphs";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { KeyHint } from "@/components/data/key-hint";
import { EVIDENCE_META } from "@/lib/evidence";
import {
  SUBJECT_KINDS,
  useWorkspaceSubjectStore,
  type SubjectKind,
  type SubjectRef,
} from "@/lib/state/subject";

const KIND_LABEL: Record<SubjectKind, string> = {
  disease: "disease",
  gene: "gene",
  protein: "protein",
  variant: "variant",
  structure: "structure",
};

/** Display order follows the journey: disease, gene, variant, protein, structure. */
const ORDER: SubjectKind[] = [
  "disease",
  "gene",
  "variant",
  "protein",
  "structure",
];

function SubjectChip({
  kind,
  subject,
}: {
  kind: SubjectKind;
  subject: SubjectRef;
}) {
  const body = (
    <>
      <span className="text-subtle-foreground">{KIND_LABEL[kind]}</span>
      <span
        className="max-w-56 truncate font-medium text-foreground"
        translate="no"
      >
        {subject.label}
      </span>
      {subject.origin ? (
        <StructureOriginTag origin={subject.origin} size="compact" />
      ) : null}
      {subject.evidenceClass ? (
        <EvidenceGlyph
          evidenceClass={subject.evidenceClass}
          className={EVIDENCE_META[subject.evidenceClass].textClass}
        />
      ) : null}
      {subject.sourceId ? (
        <span
          className="font-mono tracking-[-0.01em] text-muted-foreground"
          translate="no"
        >
          {subject.sourceId}
        </span>
      ) : null}
    </>
  );
  const classes =
    "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs border border-border bg-background px-1.5 text-2xs whitespace-nowrap";
  if (!subject.href) return <span className={classes}>{body}</span>;
  return (
    <a
      href={subject.href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${subject.sourceId ?? subject.label}${subject.source ? ` at ${subject.source}` : ""}`}
      className={cn(classes, "hover:border-border-strong hover:bg-accent")}
    >
      {body}
      <ArrowUpRightIcon
        className="size-2.5 text-subtle-foreground"
        aria-hidden
      />
      <span className="sr-only"> (opens the source record in a new tab)</span>
    </a>
  );
}

const ActionsContext = createContext<HTMLElement | null>(null);

/** Renders its children at the right end of the subject bar: "Add to project", "Export", "Share". */
export function SubjectBarActions({ children }: { children: React.ReactNode }) {
  const target = useContext(ActionsContext);
  return target ? createPortal(children, target) : null;
}

export interface SubjectBarProps {
  /** pages reach the actions slot through SubjectBarActions, which must render below this bar */
  children?: React.ReactNode;
  /** the stage rail; in simple mode it shares one row with the page actions */
  rail?: React.ReactNode;
  /** no chip row: the page actions sit at the end of the stage rail */
  simple?: boolean;
  className?: string;
}

/**
 * The entity chain as source-ID chips: label, class marker, source identifier, link to the source
 * record. It accumulates as the user moves through the stages. Scrolls on one line on phones.
 */
export function SubjectBar({
  children,
  rail,
  simple = false,
  className,
}: SubjectBarProps) {
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const [actionsElement, setActionsElement] = useState<HTMLElement | null>(
    null,
  );
  const present = ORDER.filter(
    (kind) => SUBJECT_KINDS.includes(kind) && chain[kind],
  );

  if (simple)
    return (
      <ActionsContext.Provider value={actionsElement}>
        <div
          className={cn(
            "flex shrink-0 items-stretch border-b border-border-strong/70 bg-background",
            className,
          )}
        >
          <div className="min-w-0 flex-1">{rail}</div>
          <div
            ref={setActionsElement}
            className="flex shrink-0 items-center gap-1 px-2 empty:hidden"
          />
        </div>
        {children}
      </ActionsContext.Provider>
    );

  return (
    <ActionsContext.Provider value={actionsElement}>
      {rail}
      <div
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 border-b border-border bg-sunken pl-3",
          className,
        )}
      >
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-3">
          {present.length === 0 ? (
            <p className="flex items-center gap-2 text-2xs whitespace-nowrap text-muted-foreground">
              No subject in context.
              <KeyHint
                keys="mod+k"
                label="Search a disease, gene, protein or variant"
              />
            </p>
          ) : (
            present.map((kind, index) => {
              const subject = chain[kind];
              if (!subject) return null;
              return (
                <span key={kind} className="flex shrink-0 items-center gap-1">
                  {index > 0 ? (
                    <ChevronRightIcon
                      className="size-3 text-disabled-foreground"
                      aria-hidden
                    />
                  ) : null}
                  <SubjectChip kind={kind} subject={subject} />
                </span>
              );
            })
          )}
        </div>
        <div
          ref={setActionsElement}
          className="flex shrink-0 items-center gap-1 pr-2 empty:hidden"
        />
      </div>
      {children}
    </ActionsContext.Provider>
  );
}
