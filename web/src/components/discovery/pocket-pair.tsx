"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import {
  StructureViewport,
  type ViewportResidueSet,
  type ViewportStructure,
} from "@/components/viewer";
import { DISCOVERY_WORDS } from "@/lib/plain-language";
import {
  useViewportStructure,
  type CandidateStructure,
} from "@/lib/workspace-data";

export interface PocketPairProps {
  /** the subject protein the page is about */
  accession: string;
  /** the candidate's structural bridge */
  structure: CandidateStructure | null | undefined;
  /** label for the subject pane */
  subjectLabel: string;
  /** label for the analogue pane */
  analogueLabel: string;
}

/**
 * The two pockets of a structural bridge, with the shared residues drawn on each. The subject's
 * structure is pane A; the protein it resembles is pane B, superposed. Nothing is drawn when a
 * structure is missing: the panel says which one did not resolve.
 */
export function PocketPair({
  accession,
  structure,
  subjectLabel,
  analogueLabel,
}: PocketPairProps) {
  const similar = structure?.similar_to ?? null;
  const subject = useViewportStructure(
    structure?.structure_id ?? null,
    accession,
    {
      slot: "A",
    },
  );
  const analogue = useViewportStructure(
    similar?.structure_id ?? null,
    similar?.accession ?? null,
    { slot: "B" },
  );

  const structures = useMemo<ViewportStructure[]>(() => {
    const list: ViewportStructure[] = [];
    if (subject.structure)
      list.push({ ...subject.structure, label: subjectLabel });
    if (analogue.structure)
      list.push({ ...analogue.structure, label: analogueLabel });
    return list;
  }, [subject.structure, analogue.structure, subjectLabel, analogueLabel]);

  const residueSets = useMemo<ViewportResidueSet[]>(() => {
    const sets: ViewportResidueSet[] = [];
    const own = structure?.residues ?? [];
    if (own.length > 0 && subject.structure)
      sets.push({
        id: "subject-pocket",
        label: `${subjectLabel}: ${DISCOVERY_WORDS.sharedResidues.toLowerCase()}`,
        positions: own,
        structureId: subject.structure.id,
      });
    const other = similar?.residues ?? [];
    if (other.length > 0 && analogue.structure)
      sets.push({
        id: "analogue-pocket",
        label: `${analogueLabel}: ${DISCOVERY_WORDS.sharedResidues.toLowerCase()}`,
        positions: other,
        structureId: analogue.structure.id,
      });
    return sets;
  }, [
    structure,
    similar,
    subject.structure,
    analogue.structure,
    subjectLabel,
    analogueLabel,
  ]);

  if (subject.error)
    return (
      <QueryErrorState
        error={subject.error}
        subject={`structure ${structure?.structure_id ?? ""}`}
      />
    );
  if (structures.length === 0)
    return subject.isPending || analogue.isPending ? (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {DISCOVERY_WORDS.loading}
      </div>
    ) : (
      <EmptyState
        title="No structure to show"
        description="This bridge did not name a structure that resolved."
        searched={["RCSB PDB", "AlphaFold DB"]}
      />
    );

  return (
    <StructureViewport
      ariaLabel={`${subjectLabel} and ${analogueLabel} pockets`}
      accession={accession}
      structures={structures}
      residueSets={residueSets}
      superposition="sequence-ca"
    />
  );
}
