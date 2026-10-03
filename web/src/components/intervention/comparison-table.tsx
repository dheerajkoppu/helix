"use client";

import { ArrowDownIcon } from "lucide-react";
import { cn } from "cn";

import { CompoundDepiction } from "@/components/compound/depiction";
import {
  databaseName,
  measuredAmount,
  measuredBasis,
  measuredValue,
  phaseLabel,
  toEvidenceItem,
} from "@/components/compound/format";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceChip } from "@/components/evidence/source-chip";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LearnTerm } from "@/components/science/learn-term";
import { EmptyState } from "@/components/states/empty-state";
import {
  OPTIONS_WORDS,
  plainConcentration,
  plainDrugKind,
  plainDrugStage,
  plainLabTests,
  plainSeenIn3d,
} from "@/lib/plain-language";
import { formatMetricValue } from "@/lib/science/metrics";

import {
  TIER_META,
  pocketOverlap,
  type ComparisonRow,
  type ComparisonSort,
  type PredictedPocket,
} from "./model";

const formatMicromolar = (micromolar: number): string => {
  if (micromolar < 0.001) return `${(micromolar * 1e6).toPrecision(2)} pM`;
  if (micromolar < 1) return `${(micromolar * 1000).toPrecision(2)} nM`;
  if (micromolar < 1000) return `${micromolar.toPrecision(2)} µM`;
  return `${(micromolar / 1000).toPrecision(2)} mM`;
};

/** Tier A is a solid frame, a prediction a dashed one; the two never share a treatment. */
export function TierMark({ tier }: { tier: ComparisonRow["tier"] }) {
  const meta = TIER_META[tier];
  return (
    <span
      title={`Tier ${meta.code}: ${meta.label}. ${meta.description}`}
      className={cn(
        "inline-flex size-[18px] items-center justify-center rounded-xs border font-mono text-[0.625rem] font-semibold",
        tier === "A_experimental"
          ? "border-border-strong text-foreground"
          : "border-dashed border-border-strong text-muted-foreground",
      )}
    >
      {meta.code}
      <span className="sr-only">
        Tier {meta.code}: {meta.label}
      </span>
    </span>
  );
}

const Quiet = ({ children }: { children: React.ReactNode }) => (
  <span className="text-subtle-foreground">{children}</span>
);

function notRun(row: ComparisonRow): React.ReactNode {
  if (!row.eligible && row.smallMolecule !== true)
    return (
      <Quiet>
        {row.smallMolecule === false ? "Not applicable" : "Not offered"}
      </Quiet>
    );
  const latest = row.runs[0];
  if (latest && !latest.result)
    return (
      <Quiet>
        {latest.status === "failed"
          ? `Run failed${latest.error ? `: ${latest.error.code}` : ""}`
          : `Run ${latest.status}`}
      </Quiet>
    );
  return <Quiet>Not run</Quiet>;
}

interface Column {
  id: string;
  header: React.ReactNode;
  width: number;
  sort?: ComparisonSort;
  sticky?: number;
}

const COLUMNS: Column[] = [
  { id: "tier", header: "Tier", width: 52, sort: "tier", sticky: 0 },
  { id: "compound", header: "Compound", width: 244, sticky: 52 },
  { id: "modality", header: "Modality", width: 112 },
  {
    id: "measured",
    header: "Measured affinity",
    width: 196,
    sort: "measured",
  },
  { id: "region", header: "Binding region", width: 196 },
  { id: "pose", header: "Predicted pose", width: 120 },
  {
    id: "predicted",
    header: "Predicted affinity",
    width: 188,
    sort: "predicted",
  },
  { id: "model", header: "Model", width: 112 },
  { id: "confidence", header: "Confidence", width: 168 },
  { id: "experimental", header: "Experimental evidence", width: 196 },
  { id: "source", header: "Source", width: 208 },
];

const SIMPLE_COLUMNS: Column[] = [
  { id: "compound", header: OPTIONS_WORDS.name, width: 230 },
  { id: "kind", header: OPTIONS_WORDS.kind, width: 150 },
  { id: "stage", header: OPTIONS_WORDS.stage, width: 140 },
  {
    id: "measured",
    header: OPTIONS_WORDS.strength,
    width: 170,
    sort: "measured",
  },
  { id: "structures", header: OPTIONS_WORDS.seenIn3d, width: 150 },
  {
    id: "predicted",
    header: OPTIONS_WORDS.predicted,
    width: 170,
    sort: "predicted",
  },
  { id: "evidence", header: OPTIONS_WORDS.source, width: 150 },
];

const widthOf = (columns: Column[]) =>
  columns.reduce((total, column) => total + column.width, 0);

export interface ComparisonTableProps {
  label: string;
  rows: ComparisonRow[];
  pockets: PredictedPocket[];
  /** ChEMBL did not answer: a missing measurement is then unknown, not absent */
  chemblDown: boolean;
  sort: ComparisonSort;
  onSort: (sort: ComparisonSort) => void;
  selectedId: string | null;
  onSelect: (row: ComparisonRow) => void;
  onShowPose: (row: ComparisonRow) => void;
  /** the short table of the simple view: compound, stage, measured, structures, evidence */
  simple?: boolean;
}

/**
 * The compound comparison. Measured and predicted affinity are separate columns with their units
 * printed in every cell; a prediction carries its model in the same row.
 */
export function ComparisonTable({
  label,
  rows,
  pockets,
  chemblDown,
  sort,
  onSort,
  selectedId,
  onSelect,
  onShowPose,
  simple = false,
}: ComparisonTableProps) {
  if (rows.length === 0)
    return (
      <EmptyState
        title={
          simple ? OPTIONS_WORDS.empty : "No compound recorded for this protein"
        }
        description={
          simple
            ? undefined
            : "No compound has a ChEMBL mechanism or measured activity against this protein, no PDB entry of it contains a bound ligand, and Open Targets lists no drug acting on it. Pocket geometry is still available in the ledger."
        }
        searched={["ChEMBL", "PDBe", "Open Targets"]}
      />
    );

  const anyPrediction = rows.some((row) => row.pose?.result);
  const columns = simple
    ? SIMPLE_COLUMNS.filter(
        (column) => column.id !== "predicted" || anyPrediction,
      )
    : COLUMNS;

  return (
    <div className="scroll-thin size-full overflow-auto">
      <table
        aria-label={label}
        style={
          simple
            ? { minWidth: widthOf(columns), width: "100%" }
            : { width: widthOf(columns) }
        }
        className="table-fixed border-separate border-spacing-0 text-xs"
      >
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={
                simple && column.id === "compound"
                  ? undefined
                  : { width: column.width }
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={
                  column.sort && column.sort === sort ? "descending" : undefined
                }
                style={
                  column.sticky !== undefined
                    ? { left: column.sticky }
                    : undefined
                }
                className={cn(
                  "sticky top-0 z-10 border-b border-border bg-background text-left font-medium whitespace-nowrap text-muted-foreground",
                  simple ? "h-9 px-3 text-xs" : "h-7 px-2 text-2xs",
                  column.sticky !== undefined && "z-20",
                  column.id === "compound" &&
                    !simple &&
                    "border-r border-border-subtle",
                )}
              >
                {column.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(column.sort!)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-xs hover:text-foreground",
                      column.sort === sort && "text-foreground",
                    )}
                  >
                    {column.header}
                    {column.sort === sort ? (
                      <ArrowDownIcon className="size-3" aria-hidden />
                    ) : null}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            simple ? (
              <SimpleRow
                key={row.id}
                row={row}
                chemblDown={chemblDown}
                predicted={anyPrediction}
                selected={row.id === selectedId}
                onSelect={onSelect}
                onShowPose={onShowPose}
              />
            ) : (
              <Row
                key={row.id}
                row={row}
                pockets={pockets}
                chemblDown={chemblDown}
                selected={row.id === selectedId}
                onSelect={onSelect}
                onShowPose={onShowPose}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

const CELL = "border-b border-border-subtle px-2 py-1.5 align-top";
const SIMPLE_CELL = "border-b border-border-subtle px-3 py-2 align-middle";

function SimpleRow({
  row,
  chemblDown,
  predicted,
  selected,
  onSelect,
  onShowPose,
}: {
  row: ComparisonRow;
  chemblDown: boolean;
  /** the predicted-affinity column is drawn */
  predicted: boolean;
  selected: boolean;
  onSelect: (row: ComparisonRow) => void;
  onShowPose: (row: ComparisonRow) => void;
}) {
  const { compound, treatment, pose } = row;
  const measured = compound?.measured_affinity ?? null;
  const coCrystal = compound?.co_crystal ?? null;
  const result = pose?.result ?? null;
  const affinity = result?.affinity ?? null;
  const status =
    plainDrugStage(compound?.max_phase, compound?.first_approval) ??
    treatment?.clinical_stage_label ??
    null;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const badges = [
    ...(compound?.evidence ?? []).map((record) => toEvidenceItem(record)),
    ...(!compound && treatment ? [toEvidenceItem(treatment.evidence)] : []),
  ].filter((item) => item !== null);
  // the badge prints the database, so one badge per database
  const databases = new Set<string>();
  const distinct = badges.filter((item) => {
    const key = item.source?.database ?? item.evidenceClass;
    if (databases.has(key)) return false;
    databases.add(key);
    return true;
  });

  return (
    <tr
      aria-selected={selected}
      onClick={() => onSelect(row)}
      className={cn(
        "cursor-pointer",
        selected
          ? "bg-active shadow-[inset_2px_0_0_var(--foreground)]"
          : "hover:bg-accent",
      )}
    >
      <td className={SIMPLE_CELL}>
        <div className="flex items-center gap-3">
          <CompoundDepiction
            depictionUrl={compound?.depiction_url}
            name={row.name}
            absentLabel={
              row.smallMolecule === false
                ? plainDrugKind(row.modality)
                : OPTIONS_WORDS.noDrawing
            }
            className="h-12 w-16 shrink-0"
          />
          <button
            type="button"
            onClick={(event) => {
              stop(event);
              onSelect(row);
            }}
            className="min-w-0 cursor-pointer truncate rounded-xs text-left text-sm font-medium text-foreground hover:underline"
            title={row.name}
          >
            {row.name}
          </button>
        </div>
      </td>
      <td className={SIMPLE_CELL}>
        {plainDrugKind(row.modality)}
        {row.tier === "C_predicted" ? (
          <span className="block text-2xs text-muted-foreground">
            {OPTIONS_WORDS.predictionOnly}
          </span>
        ) : null}
      </td>
      <td className={SIMPLE_CELL}>
        {status ?? <Quiet>{OPTIONS_WORDS.noStage}</Quiet>}
      </td>
      <td className={SIMPLE_CELL}>
        {measured ? (
          <>
            <span
              className="tabular font-mono text-sm text-foreground"
              title={`${measuredValue(measured)} (${plainConcentration(measured.representative.units)})`}
            >
              {measuredAmount(measured)}
            </span>
            <span className="block text-2xs text-muted-foreground">
              {plainLabTests(measured.assay_count)}
            </span>
          </>
        ) : (
          <Quiet>
            {chemblDown ? OPTIONS_WORDS.sourceDown : OPTIONS_WORDS.none}
          </Quiet>
        )}
      </td>
      <td className={SIMPLE_CELL}>
        {coCrystal ? (
          <span
            className="text-foreground"
            title={coCrystal.pdb_ids
              .map((id) => id.toUpperCase())
              .join(", ")}
          >
            {plainSeenIn3d(coCrystal.pdb_entry_count)}
          </span>
        ) : (
          <Quiet>{OPTIONS_WORDS.no}</Quiet>
        )}
      </td>
      {predicted ? (
        <td className={SIMPLE_CELL}>
          {affinity ? (
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                onShowPose(row);
              }}
              className="flex cursor-pointer flex-col items-start rounded-xs text-left hover:underline"
            >
              <span className="tabular font-mono text-sm text-foreground">
                {formatMetricValue("affinity", affinity.affinity_pred_value)}
              </span>
              <span
                className="text-2xs text-muted-foreground"
                title="log10(IC50 / µM), predicted"
              >
                {OPTIONS_WORDS.predictedNote}
              </span>
            </button>
          ) : result ? (
            <Quiet>{OPTIONS_WORDS.noValue}</Quiet>
          ) : (
            notRun(row)
          )}
        </td>
      ) : null}
      <td className={SIMPLE_CELL} onClick={stop}>
        <div className="flex flex-wrap items-center gap-1.5">
          {distinct.map((item) => (
            <EvidencePopover
              key={item.evidenceClass}
              evidence={item}
              size="compact"
            />
          ))}
          {pose?.result ? (
            <StructureOriginTag origin="predicted_orphafold" size="compact" />
          ) : null}
          {distinct.length === 0 && !pose?.result ? (
            <Quiet>{OPTIONS_WORDS.none}</Quiet>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function Row({
  row,
  pockets,
  chemblDown,
  selected,
  onSelect,
  onShowPose,
}: {
  row: ComparisonRow;
  pockets: PredictedPocket[];
  chemblDown: boolean;
  selected: boolean;
  onSelect: (row: ComparisonRow) => void;
  onShowPose: (row: ComparisonRow) => void;
}) {
  const { compound, treatment, pose } = row;
  const measured = compound?.measured_affinity ?? null;
  const coCrystal = compound?.co_crystal ?? null;
  const overlap = pocketOverlap(coCrystal?.binding_positions, pockets);
  const result = pose?.result ?? null;
  const affinity = result?.affinity ?? null;
  const status =
    phaseLabel(compound?.max_phase, compound?.first_approval) ??
    treatment?.clinical_stage_label ??
    (coCrystal ? "PDB ligand only" : null);
  const surface = selected
    ? "bg-active"
    : "bg-background group-hover:bg-accent";
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <tr
      aria-selected={selected}
      onClick={() => onSelect(row)}
      className={cn("group cursor-default", selected && "bg-active")}
    >
      <td
        className={cn(
          CELL,
          "sticky left-0 z-[1]",
          surface,
          selected && "shadow-[inset_2px_0_0_var(--foreground)]",
        )}
      >
        <TierMark tier={row.tier} />
      </td>
      <td
        style={{ left: 52 }}
        className={cn(
          CELL,
          "sticky z-[1] border-r border-r-border-subtle",
          surface,
        )}
      >
        <div className="flex gap-2">
          <CompoundDepiction
            depictionUrl={compound?.depiction_url}
            name={row.name}
            absentLabel={
              row.smallMolecule === false ? row.modality : "No 2D structure"
            }
            className="h-14 w-[76px] shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                onSelect(row);
              }}
              className="truncate rounded-xs text-left font-medium text-foreground hover:underline"
              title={row.name}
            >
              {row.name}
            </button>
            <span
              className="truncate font-mono text-2xs text-muted-foreground"
              translate="no"
            >
              {compound?.chembl_id ??
                coCrystal?.ccd_id ??
                treatment?.drug_id ??
                row.id}
            </span>
            <span className="text-2xs text-muted-foreground">
              {status ?? <Quiet>No clinical record</Quiet>}
            </span>
          </div>
        </div>
      </td>
      <td className={CELL}>
        <span className="text-foreground">{row.modality}</span>
        {compound?.molecular_weight ? (
          <span className="tabular block font-mono text-2xs text-muted-foreground">
            {compound.molecular_weight.toFixed(1)} Da
          </span>
        ) : null}
      </td>
      <td className={CELL}>
        {measured ? (
          <>
            <span className="tabular font-mono text-foreground">
              {measuredValue(measured)}
            </span>
            <span className="block text-2xs text-muted-foreground">
              {measuredBasis(measured)}
            </span>
          </>
        ) : (
          <Quiet>
            {chemblDown
              ? "ChEMBL did not answer"
              : "None in ChEMBL for this target"}
          </Quiet>
        )}
      </td>
      <td className={CELL}>
        {coCrystal ? (
          <>
            <span className="text-foreground">
              Observed site, {coCrystal.binding_positions.length} residues
            </span>
            <span className="block text-2xs text-muted-foreground">
              {overlap
                ? `${overlap.shared} of them in predicted ${overlap.pocket.name.replace("pocket", "pocket ")}`
                : pockets.length > 0
                  ? "outside every predicted pocket"
                  : null}
            </span>
          </>
        ) : result?.pocket_constraint ? (
          <span className="text-muted-foreground">
            Pose constrained to{" "}
            {result.pocket_constraint.uniprot_positions.length} residues
          </span>
        ) : (
          <Quiet>No observed site</Quiet>
        )}
      </td>
      <td className={CELL}>
        {result ? (
          <button
            type="button"
            onClick={(event) => {
              stop(event);
              onShowPose(row);
            }}
            className="flex flex-col items-start gap-0.5 rounded-xs text-left hover:underline"
          >
            <StructureOriginTag origin="predicted_orphafold" size="compact" />
            <span className="text-2xs text-muted-foreground">Show in 3D</span>
          </button>
        ) : (
          notRun(row)
        )}
      </td>
      <td className={CELL}>
        {affinity ? (
          <>
            <span className="tabular font-mono text-foreground">
              {formatMetricValue("affinity", affinity.affinity_pred_value)}{" "}
              log10(IC50 / µM)
            </span>
            <span className="tabular block font-mono text-2xs text-muted-foreground">
              ≈ {formatMicromolar(affinity.derived.approx_ic50_um)} · P(binder){" "}
              {affinity.affinity_probability_binary.toFixed(2)}
            </span>
          </>
        ) : result ? (
          <Quiet>
            {result.affinity_status === "not_requested"
              ? "Not requested in this run"
              : "Model wrote no affinity"}
          </Quiet>
        ) : (
          notRun(row)
        )}
      </td>
      <td className={CELL}>
        {result ? (
          <>
            <span className="text-foreground">
              {[result.structure.model_name, result.structure.model_version]
                .filter(Boolean)
                .join(" ") ||
                pose?.providerId ||
                "Unknown model"}
            </span>
            {result.caveats.length > 0 ? (
              <span className="block text-2xs text-muted-foreground">
                {result.caveats.length}{" "}
                {result.caveats.length === 1 ? "caveat" : "caveats"} apply
              </span>
            ) : null}
          </>
        ) : (
          notRun(row)
        )}
      </td>
      <td className={CELL}>
        {result ? (
          <>
            <span className="tabular font-mono text-foreground">
              <LearnTerm term="iptm">ligand ipTM</LearnTerm>{" "}
              {result.pose_confidence.ligand_iptm?.toFixed(2) ?? "Unknown"}
            </span>
            <span className="tabular block font-mono text-2xs text-muted-foreground">
              complex pLDDT{" "}
              {result.pose_confidence.complex_plddt?.toFixed(2) ?? "Unknown"} (0
              to 1)
            </span>
          </>
        ) : (
          notRun(row)
        )}
      </td>
      <td className={CELL} onClick={stop}>
        <div className="flex flex-col items-start gap-1">
          {(compound?.evidence ?? []).slice(0, 3).map((record) => {
            const item = toEvidenceItem(record);
            if (!item) return null;
            return (
              <EvidencePopover
                key={record.id}
                evidence={item}
                size="compact"
                detail={
                  record.predicate === "co_crystallised_with" && coCrystal
                    ? `PDB ${coCrystal.pdb_ids[0]?.toUpperCase()}${
                        coCrystal.pdb_entry_count > 1
                          ? ` +${coCrystal.pdb_entry_count - 1}`
                          : ""
                      }`
                    : (record.predicate?.replaceAll("_", " ") ??
                      databaseName(record.source?.database ?? ""))
                }
              />
            );
          })}
          {!compound && treatment ? (
            <EvidencePopover
              evidence={
                toEvidenceItem(treatment.evidence) ?? {
                  evidenceClass: "curated_database",
                  source: null,
                }
              }
              size="compact"
              detail={treatment.clinical_stage_label ?? "clinical record"}
            />
          ) : null}
          {!compound && !treatment ? <Quiet>None found</Quiet> : null}
        </div>
      </td>
      <td className={CELL} onClick={stop}>
        <div className="flex flex-col items-start gap-1">
          {compound?.chembl_id ? (
            <SourceChip
              source="ChEMBL"
              id={compound.chembl_id}
              href={`https://www.ebi.ac.uk/chembl/explore/compound/${compound.chembl_id}`}
            />
          ) : null}
          {coCrystal ? (
            <SourceChip
              source="PDBe"
              id={coCrystal.ccd_id}
              href={`https://www.ebi.ac.uk/pdbe-srv/pdbechem/chemicalCompound/show/${coCrystal.ccd_id}`}
            />
          ) : null}
          {treatment ? (
            <SourceChip
              source="Open Targets"
              id={treatment.drug_id}
              href={treatment.source_url}
            />
          ) : null}
          {pose ? (
            <SourceChip
              source="OrphaFold job"
              id={pose.jobId.slice(0, 8)}
              href={null}
            />
          ) : null}
        </div>
      </td>
    </tr>
  );
}
