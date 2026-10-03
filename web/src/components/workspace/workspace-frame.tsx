"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { cn } from "cn";

import { AxisDockSlot } from "@/components/workspace/axis-dock";
import { SelectionUrlSync } from "@/components/workspace/selection-url-sync";
import { StageRail } from "@/components/workspace/stage-rail";
import { SubjectBar } from "@/components/workspace/subject-bar";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { withSelection } from "@/lib/state/selection-url";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  STAGES,
  resolveStage,
  stageFromPathname,
  useWorkspaceSubjectStore,
  type StageId,
  type SubjectChain,
} from "@/lib/state/subject";

const OPEN_LAYER =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"], [data-slot="hover-card-content"]';

function StageHotkeys({ stage }: { stage: StageId | null }) {
  const router = useRouter();

  const open = (target: StageId) => {
    const { href } = resolveStage(
      target,
      useWorkspaceSubjectStore.getState().chain,
    );
    if (href)
      router.push(withSelection(href, useWorkspaceSelection.getState()));
  };

  const step = (direction: 1 | -1) => {
    const chain = useWorkspaceSubjectStore.getState().chain;
    const start = STAGES.findIndex((entry) => entry.id === stage);
    for (
      let index = start + direction;
      index >= 0 && index < STAGES.length;
      index += direction
    ) {
      if (resolveStage(STAGES[index].id, chain).href)
        return open(STAGES[index].id);
    }
  };

  useHotkeys({
    "g d": () => open("disease"),
    "g g": () => open("gene"),
    "g p": () => open("protein"),
    "g c": () => open("compare"),
    "g m": () => open("mechanism"),
    "g i": () => open("intervention"),
    "[": () => step(-1),
    "]": () => step(1),
    Escape: () => {
      // Esc closes the top layer first; only a bare workspace clears the selection.
      if (document.querySelector(OPEN_LAYER)) return;
      useWorkspaceSelection.getState().clear();
    },
  });

  return null;
}

export interface WorkspaceFrameProps {
  /** overrides the stage derived from the pathname */
  stage?: StageId | null;
  /** false removes the sequence axis dock for routes that never have a protein */
  dock?: boolean;
  className?: string;
  /** the stage content: normally a single <WorkspaceZones /> */
  children: React.ReactNode;
}

/**
 * Frame for the staged journey, mounted once by the (workspace) route-group layout so it persists
 * across disease, gene, protein, variant and compare routes:
 *
 *   StageRail      36px   six stages on an axis, with the entity that fills each
 *   SubjectBar     32px   source-ID chips for the entity chain
 *   children       fill   WorkspaceZones: Ledger | Instrument | Inspector
 *   AxisDockSlot   dock   the persistent sequence axis
 */
export function WorkspaceFrame({
  stage,
  dock = true,
  className,
  children,
}: WorkspaceFrameProps) {
  const pathname = usePathname();
  const current = stage === undefined ? stageFromPathname(pathname) : stage;

  return (
    <div
      data-slot="workspace-frame"
      data-stage={current ?? undefined}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <Suspense fallback={null}>
        <SelectionUrlSync />
      </Suspense>
      <StageHotkeys stage={current} />
      <StageRail current={current} />
      <SubjectBar>
        <div className="min-h-0 flex-1">{children}</div>
        {dock ? <AxisDockSlot stage={current} /> : null}
      </SubjectBar>
    </div>
  );
}

/**
 * Declares the entities the current page is about. Every workspace page calls this once with every
 * link it knows; the stage rail, subject bar and axis dock follow. Pass `null` for a link to clear it.
 * A declared protein also binds the residue numbering of the shared selection.
 */
export function useWorkspaceSubject(links: SubjectChain): void {
  const serialized = JSON.stringify(links);
  useEffect(() => {
    useWorkspaceSubjectStore
      .getState()
      .declare(JSON.parse(serialized) as SubjectChain);
    const protein = useWorkspaceSubjectStore.getState().chain.protein;
    useWorkspaceSelection.getState().bindAccession(protein?.id ?? null);
  }, [serialized]);
}
