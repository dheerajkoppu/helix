"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { ExternalLink } from "@/components/data/external-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { RunJobButton } from "@/components/jobs/run-job";
import { EmptyState } from "@/components/states/empty-state";
import type { Schema } from "@/lib/api/types";
import { setWorkspaceHover } from "@/lib/state/hover";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  STRUCTURE_ORIGIN_META,
  STRUCTURE_ORIGIN_ORDER,
  type StructureOrigin,
} from "@/lib/structure-origin";
import {
  structureDetail,
  type ApiStructureDescriptor,
  type ProteinResponse,
  type StructureLedger,
} from "@/lib/workspace-data";

import { toEvidenceItem } from "./evidence";

type Feature = Schema<"Feature">;

export interface StructureRow {
  id: string;
  origin: StructureOrigin;
  descriptor: ApiStructureDescriptor;
  method: string;
  span: string | null;
  fraction: number | null;
  ligands: number;
  recommended: boolean;
}

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

function coverageSpan(descriptor: ApiStructureDescriptor): string | null {
  const ranges = descriptor.coverage?.ranges ?? [];
  if (ranges.length === 0) return null;
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  return `${start}-${end}`;
}

export function structureRows(ledger: StructureLedger): StructureRow[] {
  const recommended = ledger.recommended?.structure_id ?? null;
  const row = (
    descriptor: ApiStructureDescriptor,
    ligands: number,
  ): StructureRow => ({
    id: descriptor.id,
    origin: descriptor.origin,
    descriptor,
    method: structureDetail(descriptor).replace(/\s[\d.]+\sÅ$/, ""),
    span: coverageSpan(descriptor),
    fraction: descriptor.coverage?.fraction ?? null,
    ligands,
    recommended: descriptor.id === recommended,
  });
  return [
    ...ledger.experimental.map((entry) =>
      row(
        entry.structure,
        entry.ligands.filter((ligand) => !ligand.common_additive).length,
      ),
    ),
    ...ledger.predicted_external.map((entry) => row(entry, 0)),
    ...ledger.predicted_orphafold.map((entry) => row(entry, 0)),
  ];
}

const STRUCTURE_COLUMNS: DataTableColumn<StructureRow>[] = [
  {
    id: "origin",
    header: "Class",
    width: 52,
    sortable: false,
    cell: (row) => <StructureOriginTag origin={row.origin} size="compact" />,
  },
  {
    id: "id",
    header: "Structure",
    accessor: (row) => row.id,
    cell: (row) => (
      <span
        className="flex min-w-0 items-baseline gap-1.5"
        title={[
          row.descriptor.title,
          row.span ? `residues ${row.span}` : null,
          row.ligands > 0 ? `${row.ligands} bound components` : null,
          row.recommended ? "shown by default" : null,
        ]
          .filter(Boolean)
          .join("; ")}
      >
        <span className="font-mono">{shortId(row.id)}</span>
        <span className="truncate text-muted-foreground">
          {[row.method, row.ligands > 0 ? `${row.ligands} lig` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    ),
  },
  {
    id: "quality",
    header: "Quality",
    align: "right",
    width: 88,
    accessor: (row) =>
      row.descriptor.resolution ?? row.descriptor.confidence?.plddt_mean,
    cell: (row) =>
      row.descriptor.resolution !== null &&
      row.descriptor.resolution !== undefined
        ? `${row.descriptor.resolution.toFixed(2)} Å`
        : typeof row.descriptor.confidence?.plddt_mean === "number"
          ? `pLDDT ${row.descriptor.confidence.plddt_mean.toFixed(1)}`
          : null,
  },
  {
    id: "coverage",
    header: "Range",
    align: "right",
    width: 76,
    accessor: (row) => row.fraction,
    cell: (row) => row.span,
  },
];

export interface StructureTableProps {
  accession: string;
  gene: string | null;
  ledger: StructureLedger;
  /** canonical sequence length; the ledger does not always carry it */
  sequenceLength: number | null;
  activeId: string | null;
  onSelect: (structureId: string) => void;
}

/** Structures grouped by origin. Empty classes are stated under the table, never left out. */
export function StructureTable({
  accession,
  gene,
  ledger,
  sequenceLength,
  activeId,
  onSelect,
}: StructureTableProps) {
  const length = sequenceLength ?? ledger.sequence_length ?? 0;
  const rows = useMemo(() => structureRows(ledger), [ledger]);
  const isoforms = ledger.isoform_models;
  const others = ledger.other_external_models;
  const providers = [...new Set(others.map((model) => model.provider))];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <DataTable
          label={`Structures of ${gene ?? accession}`}
          columns={STRUCTURE_COLUMNS}
          data={rows}
          getRowId={(row) => row.id}
          selectedRowId={activeId}
          onRowSelect={(row) => onSelect(row.id)}
          groupBy={(row) => row.origin}
          groupOrder={STRUCTURE_ORIGIN_ORDER}
          groupLabel={(group) =>
            STRUCTURE_ORIGIN_META[group as StructureOrigin].label
          }
          empty={
            <EmptyState
              title="No structure found"
              description={
                length > 2700
                  ? `AlphaFold DB holds no single model for proteins over 2,700 residues; this one has ${length}.`
                  : "No experimental entry and no existing predicted model."
              }
              searched={["RCSB PDB", "PDBe SIFTS", "AlphaFold DB"]}
              actions={
                <RunJobButton
                  kind="structure_prediction"
                  params={{ uniprot_accession: accession, gene_symbol: gene }}
                  label="Predict structure"
                  size="sm"
                />
              }
            />
          }
        />
      </div>
      <ul className="shrink-0 border-t border-border-subtle px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
        {ledger.experimental.length === 0 ? (
          <li>
            <span className="text-foreground">No experimental structure.</span>{" "}
            RCSB PDB and PDBe SIFTS list no entry for {accession}.
          </li>
        ) : null}
        {rows.length > 0 && ledger.predicted_external.length === 0 ? (
          <li>
            <span className="text-foreground">No AlphaFold DB model.</span>{" "}
            {length > 2700
              ? `The sequence has ${length} residues, over the 2,700-residue limit of its single models.`
              : "No source found."}
          </li>
        ) : null}
        {rows.length > 0 && ledger.predicted_orphafold.length === 0 ? (
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>No OrphaFold prediction.</span>
            <RunJobButton
              kind="structure_prediction"
              params={{ uniprot_accession: accession, gene_symbol: gene }}
              label="Predict"
              variant="ghost"
              size="xs"
            />
          </li>
        ) : null}
        {isoforms.length > 0 ? (
          <li>
            {isoforms.length} isoform{" "}
            {isoforms.length === 1 ? "model" : "models"}, isoform numbering,
            not loaded:{" "}
            {isoforms.map((model, index) => (
              <span key={model.id}>
                {index > 0 ? ", " : null}
                {model.source_url ? (
                  <ExternalLink href={model.source_url} className="font-mono">
                    {model.source_id}
                  </ExternalLink>
                ) : (
                  <span className="font-mono">{model.source_id}</span>
                )}
              </span>
            ))}
          </li>
        ) : null}
        {others.length > 0 ? (
          <li>
            {others.length} further {others.length === 1 ? "model" : "models"}{" "}
            via 3D-Beacons ({providers.join(", ")}), not loaded.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

const FEATURE_TRACKS = [
  "domains",
  "regions",
  "motifs",
  "zinc_fingers",
  "active_sites",
  "binding_sites",
  "modified_residues",
];

export interface FeatureRow {
  id: string;
  group: string;
  label: string;
  start: number;
  end: number;
  feature: Feature;
}

export function featureRows(protein: ProteinResponse): FeatureRow[] {
  const hasDomains = protein.tracks.some(
    (track) => track.id === "domains" && track.features.length > 0,
  );
  const wanted = hasDomains
    ? FEATURE_TRACKS
    : ["interpro_domains", ...FEATURE_TRACKS];
  const rows: FeatureRow[] = [];
  for (const trackId of wanted) {
    const track = protein.tracks.find((entry) => entry.id === trackId);
    track?.features.forEach((feature, index) => {
      if (typeof feature.start !== "number" || typeof feature.end !== "number")
        return;
      rows.push({
        id: `${track.id}:${index}`,
        group: track.label,
        label:
          [feature.description, feature.ligand?.name]
            .filter(Boolean)
            .join(", ") || feature.type,
        start: feature.start,
        end: feature.end,
        feature,
      });
    });
  }
  return rows;
}

const FEATURE_COLUMNS: DataTableColumn<FeatureRow>[] = [
  {
    id: "evidence",
    header: "Ev.",
    width: 58,
    sortable: false,
    cell: (row) =>
      row.feature.evidence[0] ? (
        <span onClick={(event) => event.stopPropagation()}>
          <EvidencePopover
            evidence={toEvidenceItem(
              row.feature.evidence[0],
              `${row.feature.type}: ${row.label}`,
            )}
            size="compact"
            detail={null}
          />
        </span>
      ) : null,
  },
  {
    id: "label",
    header: "Feature",
    accessor: (row) => row.label,
    cell: (row) => <span className="truncate">{row.label}</span>,
  },
  {
    id: "range",
    header: "Range",
    align: "right",
    width: 76,
    accessor: (row) => row.start,
    cell: (row) =>
      row.start === row.end ? String(row.start) : `${row.start}-${row.end}`,
  },
];

/** Domains and functional sites as selectable rows: a row selects its residues everywhere. */
export function FeatureTable({
  accession,
  protein,
}: {
  accession: string;
  protein: ProteinResponse;
}) {
  const rows = useMemo(() => featureRows(protein), [protein]);
  const groups = useMemo(
    () => [...new Set(rows.map((row) => row.group))],
    [rows],
  );
  const ranges = useWorkspaceSelection((state) => state.ranges);
  const selectRange = useWorkspaceSelection((state) => state.selectRange);
  const selected =
    ranges.length === 1
      ? (rows.find(
          (row) => row.start === ranges[0].start && row.end === ranges[0].end,
        )?.id ?? null)
      : null;

  return (
    <DataTable
      label={`Annotated features of ${accession}`}
      columns={FEATURE_COLUMNS}
      data={rows}
      getRowId={(row) => row.id}
      selectedRowId={selected}
      onRowSelect={(row) => selectRange({ start: row.start, end: row.end })}
      onRowHover={(row) =>
        setWorkspaceHover(
          row ? { accession, position: row.start, origin: "ledger" } : null,
        )
      }
      groupBy={(row) => row.group}
      groupOrder={groups}
      empty={
        <EmptyState
          title="No domain or site annotated"
          searched={["UniProtKB", "InterPro"]}
        />
      }
    />
  );
}
