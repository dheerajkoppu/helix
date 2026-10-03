"use client";

import { XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  useBindingJobs,
  useModelProviders,
} from "@/components/compound/queries";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LiteraturePanel } from "@/components/literature/literature-panel";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  StructureViewport,
  defaultResidueMap,
  mapRanges,
  type MolecularViewerHandle,
  type ViewportLigand,
  type ViewportResidueSet,
  type ViewportScene,
} from "@/components/viewer";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
} from "@/components/workspace";
import { routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";
import { useWorkspaceSubjectStore } from "@/lib/state/subject";
import {
  mergeSources,
  useCompounds,
  useDisease,
  useGene,
  useInteractions,
  usePockets,
  useProteinAxis,
  useProteinColorings,
  useSubjectBundle,
  useTreatments,
  useViewportStructure,
  type ApiStructureDescriptor,
} from "@/lib/workspace-data";

import { ComparisonTable, TierMark } from "./comparison-table";
import { InterventionInspector } from "./inspector";
import { InterventionLedger } from "./ledgers";
import {
  bindingRuns,
  comparisonRows,
  mechanismClasses,
  sortRows,
  sourceDown,
  type BindingRun,
  type ComparisonSort,
  type Selected,
  type SourcesDown,
} from "./model";

type View = "structure" | "table";
type Focus =
  { kind: "pdb"; pdbId: string } | { kind: "pose"; jobId: string } | null;

interface Scene {
  structure: ApiStructureDescriptor | string | null;
  ligand: ViewportLigand | null;
  residueSets: ViewportResidueSet[];
  /** what is highlighted, for the zone header */
  caption: string | null;
}

const SORT_NOTE: Record<ComparisonSort, string> = {
  tier: "Order: evidence tier, then clinical stage, measured affinity and number of structures.",
  measured:
    "Order: median pChEMBL of the qualifying measured rows, highest first. Rows without a measurement follow.",
  predicted:
    "Sorted by a predicted value. Ranking is only meaningful among compounds already known to bind this target.",
};

export function InterventionStage({ accession }: { accession: string }) {
  const searchParams = useSearchParams();
  const advanced = useAdvancedMode();
  // Until the reader picks one: the table in the simple view, 3D in Advanced
  const [chosenView, setView] = useState<View | null>(
    searchParams.get("view") === "table" ? "table" : null,
  );
  const view: View = chosenView ?? (advanced ? "structure" : "table");
  const [selected, setSelected] = useState<Selected>(() => {
    const compound = searchParams.get("compound");
    return compound ? { kind: "compound", id: compound } : null;
  });
  const [focus, setFocus] = useState<Focus>(null);
  const [sort, setSort] = useState<ComparisonSort>("tier");
  const [constraintId, setConstraintId] = useState("none");
  const [panel, setPanel] = useState<"detail" | "literature">("detail");

  const axis = useProteinAxis(accession);
  const symbol = axis.protein?.gene?.id;
  const gene = useGene(symbol);
  const chainDisease = useWorkspaceSubjectStore(
    (state) => state.chain.disease?.id,
  );
  const geneDiseases = gene.data?.data.diseases ?? [];
  const diseaseId =
    geneDiseases.find((entry) => entry.id === chainDisease)?.id ??
    geneDiseases[0]?.id;
  const disease = useDisease(diseaseId);
  const compounds = useCompounds(accession);
  const treatments = useTreatments(symbol);
  const pockets = usePockets(accession);
  const interactions = useInteractions(accession);
  const jobs = useBindingJobs();
  const models = useModelProviders();
  const { colorings, domains } = useProteinColorings(accession);

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const selectedStructure = useWorkspaceSelection((state) => state.structureId);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const position =
    ranges.length === 1 && ranges[0].start === ranges[0].end
      ? ranges[0].start
      : null;

  const compoundData = compounds.data?.data ?? null;
  const pocketData = pockets.data?.data ?? null;
  const pocketList = useMemo(() => pocketData?.pockets ?? [], [pocketData]);
  const targetTreatments = useMemo(
    () => treatments.data?.data.treatments ?? [],
    [treatments.data],
  );
  const diseaseTreatments = useMemo(
    () => disease.data?.data.treatments ?? [],
    [disease.data],
  );
  const runs = useMemo(
    () => bindingRuns(jobs.data?.data.items ?? [], accession),
    [jobs.data, accession],
  );
  const rows = useMemo(
    () => comparisonRows(compoundData?.compounds ?? [], targetTreatments, runs),
    [compoundData, targetTreatments, runs],
  );
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const classes = useMemo(
    () => mechanismClasses([...targetTreatments, ...diseaseTreatments]),
    [targetTreatments, diseaseTreatments],
  );
  const curated = interactions.data?.data.curated.partners ?? [];
  const physical = interactions.data?.data.string_physical.partners ?? [];
  const provider = models.data
    ? (models.data.data.providers.find((entry) =>
        entry.job_kinds.includes("binding_prediction"),
      ) ?? null)
    : undefined;

  const row =
    selected?.kind === "compound"
      ? (rows.find(
          (candidate) =>
            candidate.id === selected.id ||
            candidate.compound?.chembl_id === selected.id,
        ) ?? null)
      : null;
  const pocket =
    selected?.kind === "pocket"
      ? (pocketList.find((entry) => entry.id === selected.id) ?? null)
      : null;
  const treatment =
    selected?.kind === "treatment"
      ? (diseaseTreatments.find((entry) => entry.drug_id === selected.id) ??
        null)
      : null;
  const curatedPartner =
    selected?.kind === "partner"
      ? (curated.find((entry) => entry.partner_id === selected.id) ?? null)
      : null;
  const physicalPartner =
    selected?.kind === "partner"
      ? (physical.find((entry) => entry.string_id === selected.id) ?? null)
      : null;
  const mechanismClass =
    selected?.kind === "class"
      ? (classes.find((entry) => entry.id === selected.id) ?? null)
      : null;

  const fallbackStructure =
    selectedStructure ??
    axis.ledger?.recommended?.structure_id ??
    pocketData?.structure_id ??
    null;

  const scene = useMemo<Scene>(() => {
    if (pocket && pocketData)
      return {
        structure: pocketData.structure_id,
        ligand: null,
        residueSets: [
          {
            id: pocket.id,
            label: `Predicted pocket ${pocket.rank}`,
            positions: pocket.positions,
          },
        ],
        caption: `predicted pocket ${pocket.rank}, ${pocket.positions.length} residues`,
      };
    if (row) {
      const coCrystal = row.compound?.co_crystal ?? null;
      const run =
        focus?.kind === "pose"
          ? row.runs.find((entry) => entry.jobId === focus.jobId)
          : !coCrystal
            ? row.pose
            : null;
      if (run?.result) {
        const { structure, ligand, pocket_constraint } = run.result;
        return {
          structure,
          ligand: {
            structureId: structure.id,
            compId: ligand.ccd ?? "LIG",
            authAsymId: ligand.entity_id,
          },
          residueSets: pocket_constraint
            ? [
                {
                  id: "constraint",
                  label: "Pocket constraint of the run",
                  positions: pocket_constraint.uniprot_positions,
                },
              ]
            : [],
          caption: `predicted pose of ${row.name}`,
        };
      }
      if (coCrystal && coCrystal.pdb_ids.length > 0) {
        const pdbId = (
          focus?.kind === "pdb" && coCrystal.pdb_ids.includes(focus.pdbId)
            ? focus.pdbId
            : coCrystal.pdb_ids[0]
        ).toUpperCase();
        const structureId = `pdb:${pdbId}`;
        return {
          structure: structureId,
          ligand: { structureId, compId: coCrystal.ccd_id },
          residueSets: [
            {
              id: "observed-site",
              label: `Residues in contact with ${coCrystal.ccd_id}`,
              positions: coCrystal.binding_positions,
              structureId,
            },
          ],
          caption: `ligand ${coCrystal.ccd_id} and its observed site`,
        };
      }
    }
    return {
      structure: fallbackStructure,
      ligand: null,
      residueSets: [],
      caption: null,
    };
  }, [pocket, pocketData, row, focus, fallbackStructure]);

  const shown = useViewportStructure(scene.structure, accession);
  const structures = useMemo(
    () => (shown.structure ? [shown.structure] : []),
    [shown.structure],
  );

  const viewer = useRef<MolecularViewerHandle>(null);
  const [ready, setReady] = useState<ViewportScene | null>(null);
  const pocketPositions = pocket?.positions;
  // A pocket is a few residues of a whole model: bring the camera to it.
  useEffect(() => {
    const structure = shown.structure;
    const summary = structure ? ready?.summaries[structure.id] : undefined;
    if (!structure || !summary || !pocketPositions || view !== "structure")
      return;
    const chain =
      summary.chains.find((entry) => entry.labelAsymId === structure.chain) ??
      summary.chains[0];
    if (!chain) return;
    const ranges = mapRanges(
      structure.residueMap ?? defaultResidueMap(structure.origin),
      chain,
      pocketPositions.map((start) => ({ start, end: start })),
    );
    if (ranges.length > 0)
      viewer.current?.focus(structure.id, ranges, { extraRadius: 6 });
  }, [shown.structure, ready, pocketPositions, view]);

  useSubjectBundle({
    gene: gene.data?.data,
    protein: axis.protein ?? accession,
    structure: shown.descriptor ?? undefined,
  });

  const sources = useMemo(
    () =>
      mergeSources(
        axis.sources,
        compounds.data?.sources,
        treatments.data?.sources,
        pockets.data?.sources,
        interactions.data?.sources,
      ),
    [
      axis.sources,
      compounds.data,
      treatments.data,
      pockets.data,
      interactions.data,
    ],
  );
  useReportSources("intervention", sources);
  const down = useMemo<SourcesDown>(
    () => ({
      chembl: sourceDown(compounds.data?.sources, "chembl"),
      pdb: sourceDown(compounds.data?.sources, "pdbe", "rcsb_pdb"),
      openTargets: sourceDown(treatments.data?.sources, "open_targets"),
      pockets: sourceDown(pockets.data?.sources, "prankweb"),
      intact: sourceDown(interactions.data?.sources, "intact"),
      string: sourceDown(interactions.data?.sources, "string"),
    }),
    [compounds.data, treatments.data, pockets.data, interactions.data],
  );

  const select = (next: Selected) => {
    setSelected(next);
    setFocus(null);
    setPanel("detail");
    if (next?.kind === "pocket") setView("structure");
  };
  const showPose = (run: BindingRun) => {
    setFocus({ kind: "pose", jobId: run.jobId });
    setView("structure");
  };

  const predictedRows = rows.filter((entry) => entry.pose?.result?.affinity);
  const inspectorTitle =
    row?.name ??
    treatment?.name ??
    (pocket ? `Pocket ${pocket.rank}` : null) ??
    curatedPartner?.partner_symbol ??
    physicalPartner?.partner_symbol ??
    mechanismClass?.mechanism ??
    "Overview";
  const proteinLabel = symbol ?? accession;
  const hasSelection = Boolean(
    row ??
      treatment ??
      pocket ??
      curatedPartner ??
      physicalPartner ??
      mechanismClass,
  );
  const sourceGap = down.chembl ?? down.pdb ?? down.openTargets;

  return (
    <>
      <SubjectBarActions>
        <AddToProjectButton
          size="sm"
          variant="ghost"
          item={{
            kind: "protein",
            ref: accession,
            label: `${proteinLabel} intervention evidence`,
            origin: {
              route: routes.interventions(accession),
              note: "Explore intervention",
            },
            data: compoundData ? { counts: compoundData.counts } : undefined,
          }}
        />
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="intervention"
        ledgerLabel="Evidence"
        inspectorLabel="Detail"
        ledger={
          <Zone
            zone="ledger"
            title="Evidence"
            detail={
              advanced ? (
                <span className="text-2xs text-muted-foreground">
                  strongest first
                </span>
              ) : null
            }
          >
            <InterventionLedger
              gene={symbol ?? null}
              diseaseName={disease.data?.data.name ?? null}
              rows={sorted}
              compounds={{
                loading: compounds.isPending,
                error: compounds.error,
                onRetry: () => void compounds.refetch(),
              }}
              treatments={{
                loading: !symbol ? axis.isPending : treatments.isPending,
                error: treatments.error,
                onRetry: () => void treatments.refetch(),
              }}
              diseaseTreatments={diseaseTreatments}
              pockets={pocketList}
              pocketState={{
                loading: pockets.isPending,
                error: pockets.error,
                onRetry: () => void pockets.refetch(),
                pending: pocketData?.status === "pending",
                detail: pocketData?.status_detail ?? null,
              }}
              position={position}
              curated={curated}
              physical={physical}
              interactions={{
                loading: interactions.isPending,
                error: interactions.error,
                onRetry: () => void interactions.refetch(),
              }}
              classes={classes}
              down={down}
              selected={selected}
              onSelect={select}
            />
          </Zone>
        }
        instrument={
          <Zone
            zone="instrument"
            title={
              view === "structure"
                ? "3D"
                : advanced
                  ? "Compound comparison"
                  : "Compounds"
            }
            count={
              view === "table" && !compounds.isPending ? rows.length : null
            }
            scroll={false}
            detail={
              view === "structure" ? (
                shown.structure ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <StructureOriginTag
                      origin={shown.structure.origin}
                      detail={shown.structure.id}
                      size="compact"
                      caption={
                        advanced && shown.structure.origin !== "experimental"
                      }
                    />
                    {scene.caption ? (
                      <span className="truncate text-2xs text-muted-foreground">
                        {scene.caption}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-2xs text-muted-foreground">
                    No structure loaded
                  </span>
                )
              ) : null
            }
            actions={
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                value={[view]}
                onValueChange={(value) =>
                  value.length ? setView(value[0] as View) : null
                }
              >
                <ToggleGroupItem value="table">Table</ToggleGroupItem>
                <ToggleGroupItem value="structure">3D</ToggleGroupItem>
              </ToggleGroup>
            }
            toolbar={
              view === "table" && (advanced || sort === "predicted") ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {SORT_NOTE[sort]}
                  {advanced && predictedRows.length > 1
                    ? " Predicted values rank compounds against each other. They are not measurements and do not estimate activity in a patient."
                    : ""}
                </span>
              ) : undefined
            }
            footer={
              <span>
                {advanced
                  ? "Exploratory. Predicted pockets, poses and affinities are computational hypotheses, not measurements."
                  : "Predictions are hypotheses, not measurements."}
              </span>
            }
          >
            {view === "table" ? (
              compounds.isPending ? (
                <div>
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {advanced
                      ? "ChEMBL and PDBe are answering. The first request for a protein can take up to 45 seconds."
                      : "Reading ChEMBL and PDBe. The first load can take 45 s."}
                  </p>
                  <RowsSkeleton rows={8} />
                </div>
              ) : compounds.isError && rows.length === 0 ? (
                <QueryErrorState
                  error={compounds.error}
                  subject={`compounds for ${accession}`}
                  onRetry={() => void compounds.refetch()}
                />
              ) : rows.length === 0 && sourceGap ? (
                <SourceUnavailable
                  size="zone"
                  source={sourceGap.name ?? "A compound source"}
                  message={sourceGap.message}
                  onRetry={() => void compounds.refetch()}
                />
              ) : (
                <ComparisonTable
                  label={`Compounds compared against ${proteinLabel}`}
                  simple={!advanced}
                  rows={sorted}
                  pockets={pocketList}
                  chemblDown={down.chembl !== null}
                  sort={sort}
                  onSort={setSort}
                  selectedId={row?.id ?? null}
                  onSelect={(entry) =>
                    select({ kind: "compound", id: entry.id })
                  }
                  onShowPose={(entry) => {
                    setSelected({ kind: "compound", id: entry.id });
                    if (entry.pose) showPose(entry.pose);
                  }}
                />
              )
            ) : shown.structure ? (
              <StructureViewport
                ariaLabel={`${proteinLabel} structure ${shown.structure.id}`}
                accession={accession}
                structures={structures}
                colorings={colorings}
                domains={domains}
                residueSets={scene.residueSets}
                ligand={scene.ligand}
                viewerRef={viewer}
                onSceneReady={setReady}
              />
            ) : shown.error ? (
              <QueryErrorState
                error={shown.error}
                subject={`structure ${typeof scene.structure === "string" ? scene.structure : ""}`}
              />
            ) : scene.structure || axis.isPending ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Resolving a structure for {accession}
              </div>
            ) : (
              <EmptyState
                title="No structure to show"
                description="No experimental entry or AlphaFold DB model found."
                searched={["RCSB PDB", "AlphaFold DB"]}
              />
            )}
          </Zone>
        }
        inspector={
          !advanced && !hasSelection ? undefined : (
          <Zone
            zone="inspector"
            title={<span className="truncate">{inspectorTitle}</span>}
            detail={row && advanced ? <TierMark tier={row.tier} /> : null}
            scroll={panel === "detail"}
            actions={
              <>
                <ToggleGroup
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={[panel]}
                  onValueChange={(value) =>
                    value.length
                      ? setPanel(value[0] as "detail" | "literature")
                      : null
                  }
                >
                  <ToggleGroupItem value="detail">Detail</ToggleGroupItem>
                  <ToggleGroupItem value="literature">Papers</ToggleGroupItem>
                </ToggleGroup>
                {advanced ? null : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close the detail"
                    onClick={() => select(null)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )}
              </>
            }
          >
            {panel === "literature" ? (
              <LiteraturePanel
                context={{
                  gene: symbol,
                  accession,
                  residue: position,
                }}
              />
            ) : (
              <InterventionInspector
                advanced={advanced}
                shownStructureId={
                  view === "structure" ? (shown.structure?.id ?? null) : null
                }
                accession={accession}
                selected={selected}
                rows={rows}
                row={row}
                treatment={treatment}
                pocket={pocket}
                pocketsResponse={pocketData}
                curated={curatedPartner}
                physical={physicalPartner}
                mechanismClass={mechanismClass}
                compounds={compoundData}
                down={down}
                provider={provider}
                position={position}
                constraintId={constraintId}
                onConstraint={setConstraintId}
                onResidue={selectResidue}
                onSelect={select}
                onShowStructure={(pdbId) => {
                  setFocus({ kind: "pdb", pdbId });
                  setView("structure");
                }}
                onShowPose={showPose}
              />
            )}
          </Zone>
          )
        }
      />
    </>
  );
}
