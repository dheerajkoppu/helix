"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { RunJobButton } from "@/components/jobs/run-job";
import {
  ModelResultStrip,
  type ModelResultMetric,
} from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StructureViewport } from "@/components/viewer";
import { Zone } from "@/components/workspace";
import { plainNotCovered } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  canonicalModel,
  findLedgerStructure,
  structureDetail,
  useProteinColorings,
  useViewportStructure,
  type ApiStructureDescriptor,
  type StructureLedger,
  type ViewportStructureResult,
} from "@/lib/workspace-data";

const within = (
  ranges: Array<{ start: number; end: number }>,
  position: number,
) => ranges.some((range) => position >= range.start && position <= range.end);

/** Whether a structure has coordinates for a UniProt position. Null when the ledger does not say. */
export function coversPosition(
  ledger: StructureLedger | null,
  structureId: string | null,
  position: number,
): boolean | null {
  if (!ledger || !structureId) return null;
  const experimental = ledger.experimental.find(
    (row) => row.structure.id === structureId,
  );
  if (experimental)
    return experimental.chains.some((chain) =>
      chain.observed_regions.length > 0
        ? within(chain.observed_regions, position)
        : position >= chain.unp_start && position <= chain.unp_end,
    );
  const descriptor = findLedgerStructure(ledger, structureId);
  if (!descriptor?.coverage) return null;
  return within(descriptor.coverage.ranges, position);
}

interface StructureChoice {
  descriptor: ApiStructureDescriptor;
  note: string | null;
}

/** The recommended structure, the AlphaFold DB model, OrphaFold models and the best-ranked experimental entries. */
function structureChoices(
  ledger: StructureLedger,
  position: number | null,
): StructureChoice[] {
  const choices = new Map<string, StructureChoice>();
  const add = (
    descriptor: ApiStructureDescriptor | null,
    note: string | null,
  ) => {
    if (descriptor && !choices.has(descriptor.id))
      choices.set(descriptor.id, { descriptor, note });
  };
  add(
    findLedgerStructure(ledger, ledger.recommended?.structure_id),
    "recommended",
  );
  add(canonicalModel(ledger), null);
  ledger.predicted_orphafold.slice(0, 3).forEach((entry) => add(entry, null));
  const ranked = [...ledger.experimental].sort(
    (left, right) => (left.sifts_rank ?? 1e9) - (right.sifts_rank ?? 1e9),
  );
  const covering =
    position === null
      ? []
      : ranked.filter((row) =>
          coversPosition(ledger, row.structure.id, position),
        );
  covering
    .slice(0, 5)
    .forEach((row) => add(row.structure, `resolves residue ${position}`));
  ranked.slice(0, 5).forEach((row) => add(row.structure, null));
  return [...choices.values()];
}

export interface ShownStructure {
  shownId: string | null;
  shown: ViewportStructureResult;
}

/** The structure a page shows: the one in the selection, else the ledger's recommendation. */
export function useShownStructure(
  accession: string | null | undefined,
  ledger: StructureLedger | null,
): ShownStructure {
  const selected = useWorkspaceSelection((state) => state.structureId);
  const shownId =
    selected ??
    ledger?.recommended?.structure_id ??
    canonicalModel(ledger)?.id ??
    null;
  const descriptor = findLedgerStructure(ledger, shownId);
  const shown = useViewportStructure(descriptor ?? shownId, accession);
  return { shownId, shown };
}

export interface StructureResultStripProps {
  descriptor: ApiStructureDescriptor | null;
  /** shown first, before the model's own numbers: pLDDT at the selected residue */
  lead?: ModelResultMetric[];
  className?: string;
}

/** Model, version and confidence of a predicted structure. Renders nothing for an experimental entry. */
export function StructureResultStrip({
  descriptor,
  lead = [],
  className,
}: StructureResultStripProps) {
  if (!descriptor || descriptor.origin === "experimental") return null;
  const mean = descriptor.confidence?.plddt_mean ?? null;
  const residues = descriptor.coverage?.covered_residues ?? null;
  return (
    <ModelResultStrip
      model={
        descriptor.provider_name ??
        descriptor.model_name ??
        descriptor.provider ??
        "Predicted model"
      }
      version={descriptor.model_version}
      origin={descriptor.origin}
      metrics={[
        ...lead,
        {
          label: "Mean pLDDT",
          value: mean,
          explainer: "plddt",
          missingReason: "Not reported",
        },
        ...(residues !== null
          ? [{ label: "Residues", value: residues, unit: "aa" }]
          : []),
      ]}
      className={className}
    />
  );
}

export interface StructureInstrumentProps {
  accession: string | null;
  /** "BTK", for labels */
  subject: string;
  ledger: StructureLedger | null;
  ledgerSettled: boolean;
  structure: ShownStructure;
  /** the selected residue, in UniProt numbering */
  position: number | null;
  /** "Arg28", for the coverage notice */
  residueLabel?: string | null;
  /** the variant drawn as ball-and-stick with a label */
  variant?: { position: number; label: string } | null;
  /** fixed block above the viewport: a record header, onward routes */
  top?: React.ReactNode;
  /** fixed block under the viewport: the model result strip */
  bottom?: React.ReactNode;
  footer?: React.ReactNode;
  /** zone title, default "3D" */
  title?: React.ReactNode;
  /** simple mode: one short line after the title. The origin tag stays in the viewport corner. */
  caption?: React.ReactNode;
  /** header controls placed before the structure menu */
  actions?: React.ReactNode;
}

/** The 3D zone of the gene and variant stages: origin tag, structure choice, coverage notice, viewport. */
export function StructureInstrument({
  accession,
  subject,
  ledger,
  ledgerSettled,
  structure,
  position,
  residueLabel,
  variant,
  top,
  bottom,
  footer,
  title = "3D",
  caption,
  actions,
}: StructureInstrumentProps) {
  const advanced = useAdvancedMode();
  const { shownId, shown } = structure;
  const setStructure = useWorkspaceSelection((state) => state.setStructure);
  const { colorings, domains } = useProteinColorings(accession);
  const choices = useMemo(
    () => (ledger ? structureChoices(ledger, position) : []),
    [ledger, position],
  );
  const descriptor = shown.descriptor;
  const covered =
    position === null ? null : coversPosition(ledger, shownId, position);
  const fallback =
    covered === false
      ? (choices.find(
          (choice) =>
            choice.descriptor.id !== shownId &&
            coversPosition(ledger, choice.descriptor.id, position ?? 0),
        ) ?? null)
      : null;

  return (
    <Zone
      zone="instrument"
      title={title}
      scroll={false}
      detail={
        !advanced ? (
          caption
        ) : descriptor ? (
          <StructureOriginTag
            origin={descriptor.origin}
            detail={`${descriptor.source_id ?? descriptor.id} · ${structureDetail(descriptor)}`}
            size="compact"
            caption={descriptor.origin !== "experimental"}
          />
        ) : (
          <span className="text-2xs text-muted-foreground">
            {ledgerSettled && !shownId ? "No structure" : "Resolving structure"}
          </span>
        )
      }
      actions={
        <>
          {actions}
          {choices.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm">
                  Structure
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              className="w-[26rem] max-w-[calc(100vw-1.5rem)]"
            >
              <DropdownMenuRadioGroup
                value={shownId ?? ""}
                onValueChange={(value) => setStructure(String(value))}
              >
                {choices.map(({ descriptor: choice, note }) => (
                  <DropdownMenuRadioItem key={choice.id} value={choice.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <StructureOriginTag
                        origin={choice.origin}
                        size="compact"
                        detail={choice.source_id ?? choice.id}
                      />
                      <span className="truncate text-muted-foreground">
                        {structureDetail(choice)}
                      </span>
                      {note ? (
                        <span className="shrink-0 text-2xs text-subtle-foreground">
                          {advanced
                            ? note
                            : note === "recommended"
                              ? "Suggested"
                              : `Shows position ${position}`}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {advanced && ledger?.recommended ? (
                <p className="border-t border-border-subtle px-2 py-1.5 text-2xs text-muted-foreground">
                  {ledger.recommended.reason}
                </p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          ) : null}
        </>
      }
      footer={footer}
    >
      <div className="flex h-full min-h-0 flex-col">
        {top}
        {covered === false && descriptor ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-sunken px-3 py-1.5 text-xs">
            <span className="text-foreground">
              {advanced ? (
                <>
                  {residueLabel ?? `Residue ${position}`} has no coordinates in{" "}
                  <span className="font-mono">
                    {descriptor.source_id ?? descriptor.id}
                  </span>
                  .
                </>
              ) : (
                plainNotCovered(position ?? 0)
              )}
            </span>
            {fallback ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStructure(fallback.descriptor.id)}
              >
                {advanced
                  ? `Show ${fallback.descriptor.source_id ?? fallback.descriptor.id}`
                  : "Show one that does"}
              </Button>
            ) : (
              <span className="text-muted-foreground">
                {advanced
                  ? "No listed structure resolves it."
                  : "No structure covers it."}
              </span>
            )}
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">
          {shown.structure ? (
            <StructureViewport
              ariaLabel={`${subject} structure ${shownId ?? ""}`}
              accession={accession}
              structures={[shown.structure]}
              colorings={colorings}
              domains={domains}
              variant={variant}
            />
          ) : shown.error ? (
            <QueryErrorState
              error={shown.error}
              subject={`structure ${shownId}`}
            />
          ) : ledgerSettled && !shownId ? (
            <EmptyState
              title={`No structure for ${subject}`}
              description={
                advanced
                  ? "Neither an experimental entry nor an AlphaFold DB model was found for this accession. A structure can be predicted; the result is a prediction and is labelled as one."
                  : undefined
              }
              searched={["PDBe SIFTS", "AlphaFold DB"]}
              actions={
                accession ? (
                  <RunJobButton
                    kind="structure_prediction"
                    params={{ uniprot_accession: accession }}
                    label="Predict a structure"
                    size="sm"
                  />
                ) : null
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Skeleton className="h-3 w-40 rounded-xs" />
            </div>
          )}
        </div>
        {bottom}
      </div>
    </Zone>
  );
}
