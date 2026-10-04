"use client";

import { ArrowRightIcon, DownloadIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "cn";

import { ButtonLink } from "@/components/data/button-link";
import { KeyHint } from "@/components/data/key-hint";
import { TextLink } from "@/components/data/text-link";
import { RunJobButton } from "@/components/jobs/run-job";
import { LiteraturePanel } from "@/components/literature/literature-panel";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StructureViewport, type ViewportLigand } from "@/components/viewer";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
} from "@/components/workspace";
import { apiDownloadUrl } from "@/lib/api/client";
import { formatProteinChange, routes, toThreeLetter } from "@/lib/ids";
import {
  GROUP_LINKS,
  PROTEIN_WORDS,
  plainSelection,
  plainUnit,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { withSelection } from "@/lib/state/selection-url";
import { useReportSources } from "@/lib/state/shell";
import {
  canonicalModel,
  findLedgerStructure,
  mergeSources,
  structureDetail,
  useGene,
  useProteinAxis,
  useProteinColorings,
  useStructureLedger,
  useSubjectBundle,
  useViewportStructure,
} from "@/lib/workspace-data";

import { ConfidencePanel } from "./confidence-panel";
import { LigandPanel } from "./ligand-panel";
import { ProteinSummary } from "./protein-summary";
import {
  ProteinOverview,
  RangeInspector,
  ResidueInspector,
} from "./selection-inspector";
import { FeatureTable, StructureTable, featureRows } from "./structure-ledger";

type LedgerView = "structures" | "features";
type InspectorView = "selection" | "confidence" | "ligands" | "literature";

const INSPECTOR_VIEWS: Array<[InspectorView, string]> = [
  ["selection", "Selection"],
  ["confidence", "Confidence"],
  ["ligands", "Ligands"],
  ["literature", "Literature"],
];

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

/** Stage 3: one protein, its structures and the residue in focus. */
export function ProteinWorkspace({ accession }: { accession: string }) {
  const axis = useProteinAxis(accession);
  const ledgerQuery = useStructureLedger(accession);
  const protein = axis.protein;
  const ledger = axis.ledger;
  const geneSymbol = protein?.gene?.id ?? null;
  const gene = useGene(geneSymbol);

  const structureId = useWorkspaceSelection((state) => state.structureId);
  const ranges = useWorkspaceSelection((state) => state.ranges);
  const selectedVariant = useWorkspaceSelection((state) => state.variant);
  const setStructure = useWorkspaceSelection((state) => state.setStructure);
  const clearSelection = useWorkspaceSelection((state) => state.clear);
  const snapshot = useWorkspaceSelection();
  const simple = !useAdvancedMode();

  const [ledgerView, setLedgerView] = useState<LedgerView>("structures");
  const [chosenView, setInspectorView] = useState<InspectorView>("selection");
  const inspectorView = simple ? "selection" : chosenView;
  const [ligand, setLigand] = useState<ViewportLigand | null>(null);

  const activeId = structureId ?? ledger?.recommended?.structure_id ?? null;
  const ledgerRow = findLedgerStructure(ledger, activeId);
  const shown = useViewportStructure(ledgerRow ?? activeId, accession);
  const active = shown.descriptor;
  const { colorings, domains } = useProteinColorings(accession);

  useSubjectBundle({
    gene: gene.data?.data,
    protein: protein ?? accession,
    structure: active ?? undefined,
  });
  const sources = useMemo(
    () => mergeSources(axis.sources, shown.sources),
    [axis.sources, shown.sources],
  );
  useReportSources("protein-page", sources);

  const sequence = protein?.sequence.value ?? null;
  const range = ranges.length === 1 ? ranges[0] : null;
  const position = range && range.start === range.end ? range.start : null;
  const variants = axis.variants ? (axis.data?.variants ?? null) : null;
  const plddtTrack = axis.data?.tracks.find((track) => track.id === "plddt");
  const canonical = canonicalModel(ledger);

  const viewportVariant = useMemo(
    () =>
      selectedVariant
        ? {
            position: selectedVariant.position,
            label: formatProteinChange(selectedVariant),
          }
        : null,
    [selectedVariant],
  );
  const structures = useMemo(
    () => (shown.structure ? [shown.structure] : []),
    [shown.structure],
  );
  const matchedFeature = useMemo(
    () =>
      protein && range && position === null
        ? featureRows(protein).find(
            (row) => row.start === range.start && row.end === range.end,
          )
        : undefined,
    [protein, range, position],
  );

  const noStructure =
    ledger !== null &&
    activeId === null &&
    ledger.experimental.length +
      ledger.predicted_external.length +
      ledger.predicted_internal.length ===
      0;
  const label = geneSymbol ?? accession;
  const length = sequence?.length ?? ledger?.sequence_length ?? 0;
  const residueName =
    position !== null && sequence?.[position - 1]
      ? `${toThreeLetter(sequence[position - 1]) ?? sequence[position - 1]}${position}`
      : null;
  const inspectorTitle =
    inspectorView === "confidence"
      ? "Confidence"
      : inspectorView === "ligands"
        ? "Ligands"
        : inspectorView === "literature"
          ? "Literature"
          : simple
            ? (matchedFeature?.label ??
              plainSelection(ranges, sequence) ??
              label)
            : (residueName ??
              matchedFeature?.label ??
              (range
                ? `${range.start}-${range.end}`
                : ranges.length > 1
                  ? `${ranges.length} ranges`
                  : label));

  const compareHref =
    selectedVariant && geneSymbol && viewportVariant
      ? withSelection(
          routes.compare(geneSymbol, viewportVariant.label),
          snapshot,
        )
      : null;

  const numbering = !shown.structure
    ? null
    : shown.structure.origin === "experimental"
      ? shown.structure.residueMap?.segments
        ? `SIFTS residue map applied: chain ${shown.structure.chain ?? "A"}, ${shown.structure.residueMap.segments.length} ${shown.structure.residueMap.segments.length === 1 ? "segment" : "segments"} to UniProt ${accession}`
        : "No SIFTS map for this entry: author numbering is read as UniProt numbering"
      : `Residue numbers are UniProt ${accession} positions`;

  return (
    <>
      <SubjectBarActions>
        <a
          href={apiDownloadUrl(
            `/proteins/${encodeURIComponent(accession)}/fasta`,
          )}
          download={`${accession}.fasta`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <DownloadIcon data-icon="inline-start" />
          {simple ? PROTEIN_WORDS.download : "FASTA"}
        </a>
        <AddToProjectButton
          size="sm"
          variant="ghost"
          label={simple ? undefined : "Add protein"}
          item={{
            kind: "protein",
            ref: accession,
            label: protein?.names.recommended
              ? `${label} · ${protein.names.recommended}`
              : accession,
            origin: { route: routes.protein(accession) },
            data: { accession, gene: geneSymbol },
          }}
        />
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="protein"
        ledgerLabel={simple ? "Protein" : "Structures"}
        inspectorLabel="Inspector"
        ledger={
          simple ? (
            <Zone zone="ledger" title={label}>
              <ProteinSummary
                accession={accession}
                gene={geneSymbol}
                protein={protein}
                ledger={ledger}
                active={active}
                activeId={activeId}
                loadError={axis.error}
                onStructure={(id) => setStructure(id)}
              />
            </Zone>
          ) : (
            <Zone
              zone="ledger"
              title={ledgerView === "structures" ? "Structures" : "Features"}
              count={
                ledgerView === "structures"
                  ? ledger
                    ? ledger.experimental.length +
                      ledger.predicted_external.length +
                      ledger.predicted_internal.length
                    : null
                  : protein
                    ? featureRows(protein).length
                    : null
              }
              scroll={false}
              actions={
                <ToggleGroup
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={[ledgerView]}
                  onValueChange={(value) =>
                    value.length ? setLedgerView(value[0] as LedgerView) : null
                  }
                >
                  <ToggleGroupItem value="structures">
                    Structures
                  </ToggleGroupItem>
                  <ToggleGroupItem value="features">Features</ToggleGroupItem>
                </ToggleGroup>
              }
              footer={
                <KeyHint
                  keys="enter"
                  label={
                    ledgerView === "structures"
                      ? "Set as active structure"
                      : "Select residues"
                  }
                />
              }
            >
              {ledgerView === "structures" ? (
                ledger ? (
                  <StructureTable
                    accession={accession}
                    gene={geneSymbol}
                    ledger={ledger}
                    sequenceLength={sequence?.length ?? null}
                    activeId={activeId}
                    onSelect={(id) => setStructure(id)}
                  />
                ) : ledgerQuery.isError ? (
                  <QueryErrorState
                    error={ledgerQuery.error}
                    subject={`structures of ${accession}`}
                    onRetry={() => void ledgerQuery.refetch()}
                  />
                ) : (
                  <RowsSkeleton rows={10} />
                )
              ) : protein ? (
                <FeatureTable accession={accession} protein={protein} />
              ) : axis.error ? (
                <QueryErrorState
                  error={axis.error}
                  subject={`${accession} from UniProt`}
                />
              ) : (
                <RowsSkeleton rows={10} />
              )}
            </Zone>
          )
        }
        instrument={
          <Zone
            zone="instrument"
            title={simple ? "Structure" : "3D"}
            scroll={false}
            detail={
              simple ? null : active ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {active.title}
                </span>
              ) : (
                <span className="text-2xs text-muted-foreground">
                  {noStructure ? "No structure" : "Resolving structure"}
                </span>
              )
            }
            actions={
              simple ? (
                compareHref ? (
                  <ButtonLink
                    href={compareHref}
                    variant="default"
                    size="sm"
                    data-action="compare-variant"
                  >
                    {GROUP_LINKS.compare}
                    <ArrowRightIcon data-icon="inline-end" />
                  </ButtonLink>
                ) : geneSymbol ? (
                  // Compare is not a step of its own in simple mode: it is reached from here.
                  <TextLink
                    href={withSelection(routes.gene(geneSymbol), snapshot)}
                    className="text-xs text-muted-foreground"
                    data-action="compare-variant"
                  >
                    {GROUP_LINKS.compare}: {GROUP_LINKS.pickMutation}
                  </TextLink>
                ) : null
              ) : active ? (
                <AddToProjectButton
                  size="sm"
                  variant="ghost"
                  label="Add structure"
                  item={{
                    kind: "structure",
                    ref: active.id,
                    label: `${label} ${shortId(active.id)}`,
                    origin: {
                      route: `${routes.protein(accession)}?s=${encodeURIComponent(active.id)}`,
                    },
                    data: {
                      accession,
                      origin: active.origin,
                      detail: structureDetail(active),
                    },
                  }}
                />
              ) : null
            }
            footer={
              simple ? undefined : (
                <span className="truncate">
                  {ledger && ledger.experimental.length === 0 && active
                    ? `No experimental structure for ${accession}; the model shown is a prediction. `
                    : null}
                  {numbering}
                </span>
              )
            }
          >
            {noStructure ? (
              <EmptyState
                title={`No structure for ${label}`}
                description={
                  simple
                    ? "No lab or predicted structure found."
                    : length > 2700
                      ? `No experimental entry exists, and AlphaFold DB holds no single model for proteins over 2,700 residues (this one has ${length}). A prediction job can be run on the sequence or on a residue window.`
                      : "No experimental entry and no existing predicted model were found. A prediction job can be run on the sequence."
                }
                searched={["RCSB PDB", "PDBe SIFTS", "AlphaFold DB"]}
                actions={
                  <RunJobButton
                    kind="structure_prediction"
                    params={{
                      uniprot_accession: accession,
                      gene_symbol: geneSymbol,
                    }}
                    label="Predict structure"
                    size="sm"
                    variant={simple ? "default" : "outline"}
                  />
                }
              />
            ) : shown.error ? (
              <QueryErrorState
                error={shown.error}
                subject={`structure ${activeId ?? ""}`}
              />
            ) : ledgerQuery.isError && !activeId ? (
              <QueryErrorState
                error={ledgerQuery.error}
                subject={`structures of ${accession}`}
                onRetry={() => void ledgerQuery.refetch()}
              />
            ) : (
              <div className="flex size-full min-h-0 flex-col">
                <div className="relative min-h-0 flex-1">
                  <StructureViewport
                    ariaLabel={`${label} structure`}
                    accession={accession}
                    structures={structures}
                    colorings={colorings}
                    domains={domains}
                    variant={viewportVariant}
                    ligand={ligand?.structureId === activeId ? ligand : null}
                  />
                </div>
                {simple && active && active.origin !== "experimental" ? (
                  <ModelResultStrip
                    model={
                      (active.origin === "predicted_external"
                        ? (active.provider_name ?? active.model_name)
                        : (active.model_name ?? active.provider_name)) ??
                      "Unknown model"
                    }
                    version={active.model_version}
                    origin={active.origin}
                    metrics={[
                      {
                        label: "Mean pLDDT",
                        value: active.confidence?.plddt_mean,
                        explainer: "plddt",
                        missingReason: "Not reported",
                      },
                      ...(typeof active.confidence?.ptm === "number"
                        ? [
                            {
                              label: "pTM",
                              value: active.confidence.ptm,
                              explainer: "ptm",
                            },
                          ]
                        : []),
                      {
                        label: PROTEIN_WORDS.shown,
                        value: active.coverage?.covered_residues,
                        unit: length
                          ? `of ${length} ${plainUnit("aa")}`
                          : plainUnit("aa"),
                        missingReason: "Not reported",
                      },
                    ]}
                    className="shrink-0"
                  />
                ) : null}
              </div>
            )}
          </Zone>
        }
        inspector={
          simple && ranges.length === 0 ? undefined : (
            <Zone
              zone="inspector"
              title={inspectorTitle}
              scroll={inspectorView !== "literature"}
              actions={
                simple ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear selection"
                    title="Clear selection"
                    onClick={clearSelection}
                  >
                    <XIcon />
                  </Button>
                ) : undefined
              }
              toolbar={
                simple ? undefined : (
                  <ToggleGroup
                    size="sm"
                    variant="outline"
                    spacing={0}
                    value={[inspectorView]}
                    onValueChange={(value) =>
                      value.length
                        ? setInspectorView(value[0] as InspectorView)
                        : null
                    }
                  >
                    {INSPECTOR_VIEWS.map(([value, text]) => (
                      <ToggleGroupItem key={value} value={value}>
                        {text}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )
              }
            >
              {inspectorView === "confidence" ? (
                <ConfidencePanel
                  accession={accession}
                  sequence={sequence}
                  active={active}
                  ledger={ledger}
                  canonical={canonical}
                  position={position}
                />
              ) : inspectorView === "ligands" ? (
                <LigandPanel
                  accession={accession}
                  active={active}
                  ledger={ledger}
                  ligand={ligand}
                  onLigand={setLigand}
                  onStructure={(id) => setStructure(id)}
                />
              ) : inspectorView === "literature" ? (
                <LiteraturePanel
                  context={{
                    gene: geneSymbol ?? undefined,
                    accession,
                    residue: position ?? undefined,
                  }}
                />
              ) : axis.error ? (
                <QueryErrorState
                  error={axis.error}
                  subject={`${accession} from UniProt`}
                />
              ) : !protein ? (
                <RowsSkeleton rows={8} />
              ) : position !== null ? (
                <ResidueInspector
                  key={position}
                  accession={accession}
                  gene={geneSymbol}
                  position={position}
                  variants={variants}
                  active={active}
                  simple={simple}
                />
              ) : range ? (
                <RangeInspector
                  accession={accession}
                  gene={geneSymbol}
                  range={range}
                  protein={protein}
                  ledger={ledger}
                  variants={variants}
                  plddt={plddtTrack?.values ?? null}
                  plddtSource={
                    canonical
                      ? `${structureDetail(canonical)}, ${shortId(canonical.id)}`
                      : null
                  }
                  onStructure={(id) => setStructure(id)}
                  simple={simple}
                />
              ) : ranges.length > 1 ? (
                <EmptyState
                  title={`${ranges.length} ranges selected`}
                  description="Select one residue or one range to inspect it. Esc clears the selection."
                />
              ) : (
                <ProteinOverview protein={protein} ledger={ledger} />
              )}
            </Zone>
          )
        }
      />
    </>
  );
}
