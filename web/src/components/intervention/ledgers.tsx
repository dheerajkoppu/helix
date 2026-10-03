"use client";

import { useState } from "react";
import { cn } from "cn";

import {
  compoundName,
  measuredValue,
  toEvidenceItem,
  type ApiEvidence,
  type Treatment,
} from "@/components/compound/format";
import { SectionHeader } from "@/components/data/section-header";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { LearnTerm } from "@/components/science/learn-term";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import type { SourceStatus } from "@/lib/api/types";
import { useAdvancedMode } from "@/lib/state/preferences";
import type { InteractionsResponse } from "@/lib/workspace-data";

import { Fold } from "./fold";
import type {
  ComparisonRow,
  MechanismClass,
  PredictedPocket,
  Selected,
  SourcesDown,
} from "./model";

export type CuratedPartner =
  InteractionsResponse["curated"]["partners"][number];
export type StringPartner =
  InteractionsResponse["string_physical"]["partners"][number];

interface SectionState {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** the source of this section did not answer: its absence is not an empty result */
  down?: SourceStatus | null;
}

interface LedgerSectionProps<Item> extends SectionState {
  title: React.ReactNode;
  /** one to three words: the closed row of the simple view */
  short: string;
  advanced: boolean;
  description?: React.ReactNode;
  subject: string;
  items: Item[];
  /** rows shown before "Show all" */
  initial?: number;
  empty: React.ReactNode;
  children: (item: Item) => React.ReactNode;
}

function LedgerSection<Item>({
  title,
  short,
  advanced,
  description,
  subject,
  items,
  initial = 5,
  empty,
  loading,
  error,
  onRetry,
  down,
  children,
}: LedgerSectionProps<Item>) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, initial);
  const unavailable = Boolean(error) || Boolean(down && items.length === 0);
  const body = loading ? (
    <RowsSkeleton rows={3} />
  ) : error ? (
    <QueryErrorState
      error={error}
      subject={subject}
      onRetry={onRetry}
      size="inline"
    />
  ) : down && items.length === 0 ? (
    <SourceUnavailable
      source={down.name ?? down.source}
      message={down.message}
      onRetry={onRetry}
    />
  ) : items.length === 0 ? (
    empty
  ) : (
    <>
      <ul>{shown.map((item) => children(item))}</ul>
      {items.length > initial ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-7 w-full cursor-pointer items-center border-b border-border-subtle px-3 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? `Show first ${initial}` : `Show all ${items.length}`}
        </button>
      ) : null}
    </>
  );

  if (!advanced)
    return (
      <Fold
        title={short}
        count={loading || unavailable ? null : items.length}
        trailing={
          unavailable ? (
            <span className="text-2xs text-muted-foreground">Unavailable</span>
          ) : null
        }
      >
        <div className="border-t border-border-subtle">{body}</div>
      </Fold>
    );

  return (
    <section>
      <SectionHeader
        title={title}
        count={loading || unavailable ? null : items.length}
        description={description}
      />
      {body}
    </section>
  );
}

function LedgerRow({
  selected,
  onSelect,
  evidence,
  evidenceDetail,
  label,
  note,
  value,
  title,
  dataId,
}: {
  dataId?: string;
  selected: boolean;
  onSelect: () => void;
  evidence?: ApiEvidence | null;
  evidenceDetail?: string;
  label: React.ReactNode;
  note?: React.ReactNode;
  value?: React.ReactNode;
  title?: string;
}) {
  const item = toEvidenceItem(evidence);
  return (
    <li
      aria-current={selected || undefined}
      className={cn(
        "flex min-h-7 items-center gap-2 border-b border-border-subtle pr-3 pl-3 text-xs",
        selected
          ? "bg-active shadow-[inset_2px_0_0_var(--foreground)]"
          : "hover:bg-accent",
      )}
    >
      {item ? (
        <EvidencePopover
          evidence={item}
          size="compact"
          detail={evidenceDetail}
          className="shrink-0"
        />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        title={title}
        data-ledger-id={dataId}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-xs text-left"
      >
        <span className="min-w-16 flex-1 truncate text-foreground">{label}</span>
        {note ? (
          <span className="min-w-0 shrink-[99] truncate text-2xs text-muted-foreground">
            {note}
          </span>
        ) : null}
        {value ? (
          <span className="tabular shrink-0 pl-1 font-mono text-2xs text-foreground">
            {value}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const isSelected = (selected: Selected, kind: string, id: string) =>
  selected?.kind === kind && selected.id === id;

const findEvidence = (row: ComparisonRow, kind: string) =>
  row.compound?.evidence.find((record) =>
    kind === "bioactivity"
      ? record.predicate === "measured_activity"
      : record.predicate === "co_crystallised_with",
  ) ?? null;

export interface InterventionLedgerProps {
  gene: string | null;
  diseaseName: string | null;
  rows: ComparisonRow[];
  compounds: SectionState;
  treatments: SectionState;
  diseaseTreatments: Treatment[];
  pockets: PredictedPocket[];
  pocketState: SectionState & { pending: boolean; detail: string | null };
  /** UniProt position in the workspace selection, to mark the pockets that contain it */
  position: number | null;
  curated: CuratedPartner[];
  physical: StringPartner[];
  interactions: SectionState;
  classes: MechanismClass[];
  down: SourcesDown;
  selected: Selected;
  onSelect: (selected: Selected) => void;
}

/** Every evidence list of the stage as one scrolling ledger, strongest evidence first. */
export function InterventionLedger({
  gene,
  diseaseName,
  rows,
  compounds,
  treatments,
  diseaseTreatments,
  pockets,
  pocketState,
  position,
  curated,
  physical,
  interactions,
  classes,
  down,
  selected,
  onSelect,
}: InterventionLedgerProps) {
  const clinical = rows.filter((row) => row.treatment !== null);
  const measured = rows
    .filter((row) => row.compound?.measured_affinity)
    .sort(
      (left, right) =>
        (right.compound?.measured_affinity?.median_pchembl ?? 0) -
        (left.compound?.measured_affinity?.median_pchembl ?? 0),
    );
  const observed = rows
    .filter((row) => row.compound?.co_crystal)
    .sort(
      (left, right) =>
        (right.compound?.co_crystal?.pdb_entry_count ?? 0) -
        (left.compound?.co_crystal?.pdb_entry_count ?? 0),
    );
  const target = gene ?? "this protein";
  const advanced = useAdvancedMode();

  return (
    <div>
      <LedgerSection
        title="Drugs and clinical candidates"
        short="Drugs"
        advanced={advanced}
        description={`Recorded mechanism acts on the ${target} product.`}
        subject={`drugs acting on ${target}`}
        items={clinical}
        empty={
          <EmptyState
            size="inline"
            title={`No drug or clinical candidate recorded for ${target}`}
            searched={["Open Targets"]}
          />
        }
        {...treatments}
        down={down.openTargets}
      >
        {(row) => (
          <LedgerRow
            key={row.id}
            selected={isSelected(selected, "compound", row.id)}
            onSelect={() => onSelect({ kind: "compound", id: row.id })}
            evidence={row.treatment?.evidence}
            label={row.name}
            note={row.modality}
            value={row.treatment?.clinical_stage_label ?? "Stage unknown"}
            title={row.name}
          />
        )}
      </LedgerSection>

      {diseaseTreatments.length > 0 ? (
        <LedgerSection
          title="Indicated for the disease"
        short="Disease drugs"
        advanced={advanced}
          description={`Records naming ${diseaseName ?? "the disease"} as an indication. They do not act on ${target}.`}
          subject="disease indications"
          items={diseaseTreatments}
          empty={null}
        >
          {(treatment) => (
            <LedgerRow
              key={treatment.drug_id}
              selected={isSelected(selected, "treatment", treatment.drug_id)}
              onSelect={() =>
                onSelect({ kind: "treatment", id: treatment.drug_id })
              }
              evidence={treatment.evidence}
              label={treatment.name}
              note={
                treatment.modality === "Unknown"
                  ? "Unknown modality"
                  : (treatment.modality ?? undefined)
              }
              value={treatment.clinical_stage_label ?? "Stage unknown"}
              title={treatment.name ?? undefined}
            />
          )}
        </LedgerSection>
      ) : null}

      <LedgerSection
        title="Measured ligands"
        short="Measured ligands"
        advanced={advanced}
        description={
          <>
            <LearnTerm term="binding-affinity">Affinity</LearnTerm> measured
            against this target (ChEMBL). The median-pChEMBL row is printed.
          </>
        }
        subject="measured ligands"
        items={measured}
        empty={
          <EmptyState
            size="inline"
            title="No measured affinity for this target"
            searched={["ChEMBL"]}
          />
        }
        {...compounds}
        down={down.chembl}
      >
        {(row) => (
          <LedgerRow
            key={row.id}
            selected={isSelected(selected, "compound", row.id)}
            onSelect={() => onSelect({ kind: "compound", id: row.id })}
            evidence={findEvidence(row, "bioactivity")}
            label={row.name}
            note={`${row.compound!.measured_affinity!.assay_count} ${
              row.compound!.measured_affinity!.assay_count === 1
                ? "assay"
                : "assays"
            }`}
            value={measuredValue(row.compound!.measured_affinity!)}
            title={row.name}
          />
        )}
      </LedgerSection>

      <LedgerSection
        title="Ligands in experimental structures"
        short="Bound in structures"
        advanced={advanced}
        description={
          <>
            <LearnTerm term="ligand">Ligands</LearnTerm> bound in PDB entries,
            solvent left out.
          </>
        }
        subject="ligands in experimental structures"
        items={observed}
        empty={
          <EmptyState
            size="inline"
            title="No PDB entry of this protein contains a bound ligand"
            searched={["PDBe"]}
          />
        }
        {...compounds}
        down={down.pdb}
      >
        {(row) => {
          const coCrystal = row.compound!.co_crystal!;
          return (
            <LedgerRow
              key={row.id}
              selected={isSelected(selected, "compound", row.id)}
              onSelect={() => onSelect({ kind: "compound", id: row.id })}
              evidence={findEvidence(row, "co_crystal")}
              label={
                row.compound?.name ?? (
                  <span className="font-mono">{coCrystal.ccd_id}</span>
                )
              }
              note={
                row.compound?.name ? (
                  <span className="font-mono">{coCrystal.ccd_id}</span>
                ) : (
                  (coCrystal.name ?? undefined)
                )
              }
              value={
                coCrystal.pdb_entry_count === 1
                  ? coCrystal.pdb_ids[0]?.toUpperCase()
                  : `${coCrystal.pdb_entry_count} entries`
              }
              title={coCrystal.name ?? compoundName(row.compound!)}
            />
          );
        }}
      </LedgerSection>

      <LedgerSection
        title="Predicted pockets"
        short="Predicted pockets"
        advanced={advanced}
        description={
          pocketState.pending
            ? (pocketState.detail ?? "PrankWeb is computing the prediction.")
            : "P2Rank on the AlphaFold DB model. Calibrated probability, 0 to 1."
        }
        subject="predicted pockets"
        items={pockets}
        initial={6}
        empty={
          pocketState.pending ? (
            <RowsSkeleton rows={3} />
          ) : (
            <EmptyState
              size="inline"
              title="No pocket predicted"
              searched={["PrankWeb (P2Rank)"]}
            />
          )
        }
        loading={pocketState.loading}
        down={down.pockets}
        error={pocketState.error}
        onRetry={pocketState.onRetry}
      >
        {(pocket) => (
          <LedgerRow
            key={pocket.id}
            dataId={`pocket:${pocket.id}`}
            selected={isSelected(selected, "pocket", pocket.id)}
            onSelect={() => onSelect({ kind: "pocket", id: pocket.id })}
            evidence={pocket.evidence}
            label={`Pocket ${pocket.rank}`}
            note={
              position !== null && pocket.positions.includes(position)
                ? `contains residue ${position}`
                : `${pocket.positions.length} residues`
            }
            value={
              pocket.probability !== null
                ? `p ${pocket.probability.toFixed(2)}`
                : "p unknown"
            }
          />
        )}
      </LedgerSection>

      <LedgerSection
        title="Interaction partners"
        short="Partners"
        advanced={advanced}
        description="Curated by IntAct from published experiments."
        subject="interaction partners"
        items={curated}
        empty={
          <EmptyState
            size="inline"
            title="No curated interaction"
            searched={["IntAct"]}
          />
        }
        {...interactions}
        down={down.intact}
      >
        {(partner) => (
          <LedgerRow
            key={partner.partner_id}
            selected={isSelected(selected, "partner", partner.partner_id)}
            onSelect={() =>
              onSelect({ kind: "partner", id: partner.partner_id })
            }
            evidence={partner.evidence}
            label={partner.partner_symbol ?? partner.partner_id}
            note={`${partner.evidence_count} ${
              partner.evidence_count === 1 ? "record" : "records"
            }`}
            value={
              partner.mi_score !== null && partner.mi_score !== undefined
                ? `MI ${partner.mi_score.toFixed(2)}`
                : undefined
            }
          />
        )}
      </LedgerSection>

      {physical.length > 0 || down.string ? (
        <LedgerSection
          title="Physical associations"
        short="Associations"
        advanced={advanced}
          down={down.string}
          description="STRING physical subnetwork, combined confidence."
          subject="STRING partners"
          items={physical}
          empty={null}
        >
          {(partner) => (
            <LedgerRow
              key={partner.string_id}
              selected={isSelected(selected, "partner", partner.string_id)}
              onSelect={() =>
                onSelect({ kind: "partner", id: partner.string_id })
              }
              evidence={partner.evidence}
              label={partner.partner_symbol ?? partner.string_id}
              note={partner.also_in_intact ? "also in IntAct" : undefined}
              value={
                partner.score !== null && partner.score !== undefined
                  ? `score ${partner.score.toFixed(3)}`
                  : undefined
              }
            />
          )}
        </LedgerSection>
      ) : null}

      <LedgerSection
        title="Mechanism classes"
        short="Mechanisms"
        advanced={advanced}
        description="Mechanisms as the clinical records word them."
        subject="mechanism classes"
        items={classes}
        empty={
          <EmptyState
            size="inline"
            title="No sourced mechanism of action"
            description="No clinical record states a mechanism for this target or its disease."
            searched={["Open Targets", "ChEMBL"]}
          />
        }
        {...treatments}
        down={down.openTargets}
      >
        {(entry) => (
          <LedgerRow
            key={entry.id}
            selected={isSelected(selected, "class", entry.id)}
            onSelect={() => onSelect({ kind: "class", id: entry.id })}
            evidence={entry.drugs[0]?.evidence}
            label={entry.mechanism}
            note={entry.modalities.join(", ")}
            value={`${entry.drugs.length} ${
              entry.drugs.length === 1 ? "record" : "records"
            }`}
            title={entry.mechanism}
          />
        )}
      </LedgerSection>
    </div>
  );
}
