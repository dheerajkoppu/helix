"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { useMemo, useRef } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { KeyHint } from "@/components/data/key-hint";
import { SectionHeader } from "@/components/data/section-header";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LearnTerm } from "@/components/science/learn-term";
import { PlddtLegend } from "@/components/science/legends";
import { MetricReadout } from "@/components/science/metric-readout";
import type { SequenceVariant } from "@/components/sequence";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MolecularViewer,
  type MolecularViewerHandle,
} from "@/components/viewer";
import {
  SubjectBarActions,
  WorkspaceFrame,
  WorkspaceZones,
  Zone,
  useAxisDock,
  useWorkspaceSubject,
  type AxisDockData,
} from "@/components/workspace";
import type { EvidenceItem } from "@/lib/evidence";
import { aminoAcidName, toThreeLetter } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import {
  resolveColorMode,
  useWorkspaceSelection,
  type ColorMode,
} from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";
import {
  STRUCTURE_ORIGIN_META,
  STRUCTURE_ORIGIN_ORDER,
  parseStructureId,
} from "@/lib/structure-origin";

import { KIT_STRUCTURES, type KitStructureRow } from "../kit/fixtures";
import { fetchLiveProtein } from "../live-fixture";

/** STAT1. Structure rows and the variant record are quoted in docs/research/ux-research.md. */
const ACCESSION = "P42224";
const GENE = "STAT1";

const VARIANT: SequenceVariant = {
  id: "STAT1-p.Asp165Gly",
  position: 165,
  reference: "D",
  alternate: "G",
  label: "p.Asp165Gly",
  consequence: "missense",
  significance: null,
  group: "clinical",
  sourceId: "VAR_065934",
};

const VARIANT_EVIDENCE: EvidenceItem = {
  evidenceClass: "experimental",
  statement: "In IMD31C; gain of function.",
  source: {
    database: "UniProt",
    recordId: "VAR_065934",
    release: "2026_03",
    retrievedAt: "2026-10-03",
    url: `https://www.uniprot.org/uniprotkb/${ACCESSION}`,
    license: "CC BY 4.0",
  },
  method: "ECO:0000269, PubMed:21727188",
};

const COLUMNS: DataTableColumn<KitStructureRow>[] = [
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
      <span className="flex items-baseline gap-2">
        <span className="font-mono">{row.id}</span>
        <span className="truncate text-muted-foreground">{row.method}</span>
      </span>
    ),
  },
  {
    id: "quality",
    header: "Res. / pLDDT",
    align: "right",
    width: 116,
    accessor: (row) => row.resolution ?? row.meanPlddt,
    cell: (row) =>
      row.resolution !== null
        ? `${row.resolution.toFixed(2)} Å`
        : (row.meanPlddt?.toFixed(1) ?? null),
  },
];

const COLOR_OPTIONS: Array<[ColorMode, string]> = [
  ["confidence", "Confidence"],
  ["chain", "Chain"],
  ["domain", "Domain"],
];

function Reference() {
  const viewer = useRef<MolecularViewerHandle>(null);
  const protein = useQuery({
    queryKey: ["dev", "live-protein", ACCESSION],
    queryFn: () => fetchLiveProtein(ACCESSION),
    staleTime: Infinity,
    retry: false,
  });

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const structureId = useWorkspaceSelection((state) => state.structureId);
  const colorMode = useWorkspaceSelection((state) => state.colorMode);
  const setStructure = useWorkspaceSelection((state) => state.setStructure);
  const setColorMode = useWorkspaceSelection((state) => state.setColorMode);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);

  const activeStructure =
    KIT_STRUCTURES.find((row) => row.id === structureId) ?? null;
  const parsedStructure = structureId ? parseStructureId(structureId) : null;

  // 1. Declare the entity chain. The rail, the subject bar and the dock follow it.
  useWorkspaceSubject({
    gene: { id: GENE, label: GENE },
    protein: {
      id: ACCESSION,
      label: ACCESSION,
      source: "UniProt",
      sourceId: `UniProtKB:${ACCESSION}`,
      href: `https://www.uniprot.org/uniprotkb/${ACCESSION}`,
    },
    variant: {
      id: VARIANT.id,
      label: VARIANT.label,
      source: "UniProt",
      sourceId: VARIANT.sourceId,
      evidenceClass: "experimental",
    },
    structure: parsedStructure
      ? {
          id: structureId ?? "",
          label: parsedStructure.id,
          origin: parsedStructure.origin,
        }
      : null,
  });

  // 2. Feed the persistent sequence axis.
  const dock = useMemo<AxisDockData | null>(
    () =>
      protein.data
        ? {
            accession: ACCESSION,
            sequence: protein.data.sequence,
            tracks: protein.data.tracks,
            variants: [VARIANT],
          }
        : null,
    [protein.data],
  );
  useAxisDock(dock, { loadingAccession: protein.isPending ? ACCESSION : null });

  // 3. Publish source status to the status line.
  const sources = useMemo(
    () =>
      protein.data
        ? [
            {
              source: "uniprot",
              name: "UniProt",
              state: "ok" as const,
              release: protein.data.uniprotRelease,
            },
            {
              source: "afdb",
              name: "AlphaFold DB",
              state: protein.data.plddt
                ? ("ok" as const)
                : ("unavailable" as const),
              release: "v6",
            },
          ]
        : undefined,
    [protein.data],
  );
  useReportSources("dev-frame", sources);

  const position =
    ranges.length === 1 && ranges[0].start === ranges[0].end
      ? ranges[0].start
      : null;
  const residue =
    position && protein.data ? protein.data.sequence[position - 1] : null;
  const domain = position
    ? protein.data?.tracks[0]?.features?.find(
        (feature) => position >= feature.start && position <= feature.end,
      )
    : undefined;
  const resolvedColor = resolveColorMode(
    colorMode,
    activeStructure?.origin ?? null,
  );

  return (
    <>
      <SubjectBarActions>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectResidue(VARIANT.position)}
        >
          Select Asp165
        </Button>
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="dev-frame"
        ledgerLabel="Structures"
        ledger={
          <Zone
            zone="ledger"
            title="Structures"
            count={KIT_STRUCTURES.length}
            scroll={false}
            footer={<KeyHint keys="enter" label="Set as active structure" />}
          >
            <DataTable
              label={`Structures of ${GENE}`}
              columns={COLUMNS}
              data={KIT_STRUCTURES}
              getRowId={(row) => row.id}
              selectedRowId={structureId}
              onRowSelect={(row) => setStructure(row.id, "A")}
              groupBy={(row) => row.origin}
              groupOrder={STRUCTURE_ORIGIN_ORDER}
              groupLabel={(group) =>
                STRUCTURE_ORIGIN_META[
                  group as keyof typeof STRUCTURE_ORIGIN_META
                ].label
              }
              empty={
                <EmptyState
                  title="No structures"
                  searched={["RCSB PDB", "AlphaFold DB"]}
                />
              }
            />
          </Zone>
        }
        instrument={
          <Zone
            zone="instrument"
            title="3D"
            scroll={false}
            detail={
              activeStructure ? (
                <StructureOriginTag
                  origin={activeStructure.origin}
                  detail={activeStructure.id}
                  size="compact"
                  caption
                />
              ) : (
                <span className="text-2xs text-muted-foreground">
                  No structure chosen
                </span>
              )
            }
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset camera"
                onClick={() => viewer.current?.resetCamera()}
              >
                <RotateCcwIcon />
              </Button>
            }
            toolbar={
              <>
                <span className="text-2xs text-muted-foreground">Colour</span>
                <ToggleGroup
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={[resolvedColor]}
                  onValueChange={(value) =>
                    value.length ? setColorMode(value[0] as ColorMode) : null
                  }
                >
                  {COLOR_OPTIONS.map(([value, label]) => (
                    <ToggleGroupItem
                      key={value}
                      value={value}
                      disabled={
                        value === "confidence" &&
                        activeStructure?.origin === "experimental"
                      }
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </>
            }
            footer={
              resolvedColor === "confidence" ? (
                <PlddtLegend showRanges={false} wrap={false} />
              ) : (
                <span>Chains are labelled by letter.</span>
              )
            }
          >
            <MolecularViewer
              ref={viewer}
              ariaLabel={`${GENE} structure ${activeStructure?.id ?? "not chosen"}`}
            />
          </Zone>
        }
        inspector={
          <Zone
            zone="inspector"
            title={
              residue && position
                ? `${toThreeLetter(residue)}${position}`
                : "Residue"
            }
            detail={
              residue ? (
                <span className="text-2xs text-muted-foreground">
                  {aminoAcidName(residue)}
                </span>
              ) : null
            }
          >
            {protein.isPending ? (
              <RowsSkeleton rows={5} />
            ) : protein.isError ? (
              <QueryErrorState
                error={protein.error}
                subject={`${ACCESSION} from UniProt`}
                onRetry={() => void protein.refetch()}
              />
            ) : !position || !residue ? (
              <EmptyState
                title="No residue selected"
                description="Click a residue on the sequence axis, or use the button in the subject bar."
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectResidue(VARIANT.position)}
                  >
                    Select Asp165
                  </Button>
                }
              />
            ) : (
              <div
                onMouseEnter={() =>
                  setWorkspaceHover({
                    accession: ACCESSION,
                    position,
                    origin: "ledger",
                  })
                }
                onMouseLeave={() => setWorkspaceHover(null)}
              >
                <div className="border-b border-border-subtle px-3 py-3">
                  <MetricReadout
                    metric="plddt"
                    value={protein.data.plddt?.[position - 1]}
                    missingReason="AlphaFold DB did not answer"
                    label={
                      <>
                        <LearnTerm term="plddt">pLDDT</LearnTerm> at{" "}
                        {toThreeLetter(residue)}
                        {position}
                      </>
                    }
                    producedBy="AlphaFold DB v6, AF-P42224-F1"
                  />
                </div>
                <SectionHeader title="Position" />
                <DefinitionList>
                  <DefinitionRow term="Residue" mono>
                    {residue} {position}
                  </DefinitionRow>
                  <DefinitionRow term="Numbering">
                    UniProt canonical, {ACCESSION}
                  </DefinitionRow>
                  <DefinitionRow
                    term={<LearnTerm term="protein-domain">Domain</LearnTerm>}
                  >
                    {domain
                      ? `${domain.label} (${domain.start}-${domain.end})`
                      : "None annotated at this position"}
                  </DefinitionRow>
                </DefinitionList>
                <SectionHeader
                  title="Evidence"
                  count={position === VARIANT.position ? 1 : 0}
                />
                {position === VARIANT.position ? (
                  <div className="flex items-baseline gap-2 px-3 py-2 text-xs">
                    <EvidencePopover
                      evidence={VARIANT_EVIDENCE}
                      size="compact"
                      className="shrink-0"
                    />
                    <span>
                      <span className="font-mono">{VARIANT.label}</span>:{" "}
                      {VARIANT_EVIDENCE.statement}
                    </span>
                  </div>
                ) : (
                  <EmptyState
                    size="inline"
                    title="No evidence rows loaded for this residue"
                    description="This reference page carries one record, at residue 165."
                  />
                )}
              </div>
            )}
          </Zone>
        }
      />
    </>
  );
}

/**
 * Reference stage for page builders: the smallest complete workspace page. Copy its three calls
 * (useWorkspaceSubject, useAxisDock, useReportSources) and its WorkspaceZones structure.
 */
export function FrameDemo() {
  return (
    <WorkspaceFrame stage="protein">
      <Reference />
    </WorkspaceFrame>
  );
}
