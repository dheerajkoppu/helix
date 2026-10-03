"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { KeyHint } from "@/components/data/key-hint";
import { SectionHeader } from "@/components/data/section-header";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import type { SequenceVariant } from "@/components/sequence";
import { EmptyState } from "@/components/states/empty-state";
import { RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  StructureViewport,
  domainColoring,
  useCameraLink,
  variantImpactColoring,
  type MolecularViewerHandle,
  type ViewportBindingSiteResidue,
  type ViewportLigand,
  type ViewportResidueSet,
  type ViewportScene,
  type ViewportStructure,
} from "@/components/viewer";
import {
  WorkspaceFrame,
  WorkspaceZones,
  Zone,
  useAxisDock,
  useWorkspaceSubject,
  type AxisDockData,
} from "@/components/workspace";
import { useWorkspaceHover } from "@/lib/state/hover";
import { describeRanges, useWorkspaceSelection } from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";

import { ACCESSION, GENE, PDB_ID, fetchViewerDemoData } from "./data";

/** ClinVar VCV000011348, quoted in docs/research/variant-effect.md section 2. */
const VARIANT: SequenceVariant = {
  id: "BTK-p.Arg28His",
  position: 28,
  reference: "R",
  alternate: "H",
  label: "p.Arg28His",
  consequence: "missense",
  significance: "pathogenic",
  reviewStars: 2,
  group: "clinical",
  sourceId: "VCV000011348",
};

/** Inositol 1,3,4,5-tetrakisphosphate, the component named in the title of PDB 1B55. */
const LIGAND_COMP_ID = "4IP";

type View = "single" | "overlay" | "split";
const VIEWS: Array<[View, string]> = [
  ["single", "Single"],
  ["overlay", "Overlay"],
  ["split", "Split"],
];

function SwitchRow({
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-7 items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-xs">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground">{label}</span>
        {detail ? (
          <span className="text-2xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}

function Demo() {
  const params = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const requested = params.get("view");
    return requested === "overlay" || requested === "split"
      ? requested
      : "single";
  });
  const [primary, setPrimary] = useState<"afdb" | "pdb">(() =>
    params.get("primary") === "pdb" ? "pdb" : "afdb",
  );
  const [showVariant, setShowVariant] = useState(
    () => params.get("variant") !== "0",
  );
  const [showSite, setShowSite] = useState(() => params.get("site") === "1");
  const [showAnnotated, setShowAnnotated] = useState(
    () => params.get("sets") === "1",
  );
  const [locked, setLocked] = useState(true);
  const [scenes, setScenes] = useState<Record<string, ViewportScene>>({});
  const [site, setSite] = useState<ViewportBindingSiteResidue[]>([]);
  const [figure, setFigure] = useState<{ url: string; name: string } | null>(
    null,
  );

  const left = useRef<MolecularViewerHandle>(null);
  const right = useRef<MolecularViewerHandle>(null);

  const demo = useQuery({
    queryKey: ["dev", "viewer", ACCESSION],
    queryFn: fetchViewerDemoData,
    staleTime: Infinity,
    retry: false,
  });
  const data = demo.data;

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const hover = useWorkspaceHover();

  const predicted = useMemo<ViewportStructure | null>(() => {
    const model = data?.model;
    if (!model) return null;
    return {
      id: `afdb:${model.entryId}`,
      origin: "predicted_external",
      source: {
        kind: "url",
        url: model.bcifUrl,
        format: "mmcif",
        isBinary: true,
      },
      detail: `AlphaFold DB v${model.version}`,
      modelVersion: `${model.created ? `model created ${model.created}, ` : ""}mean pLDDT ${model.meanPlddt.toFixed(1)}`,
      chain: "A",
    };
  }, [data]);

  const experimental = useMemo<ViewportStructure>(() => {
    const { method, resolution, residueMap } = data?.experimental ?? {};
    const quality =
      method === "X-RAY DIFFRACTION" && resolution
        ? `X-ray ${resolution.toFixed(2)} Å`
        : undefined;
    return {
      id: `pdb:${PDB_ID}`,
      origin: "experimental",
      source: {
        kind: "url",
        url: `https://models.rcsb.org/${PDB_ID.toLowerCase()}.bcif`,
        format: "mmcif",
        isBinary: true,
      },
      detail: quality,
      modelVersion: "RCSB PDB",
      chain: "A",
      // 1B55 chain A: label_seq_id 1 is UniProt residue 2
      residueMap: residueMap ?? undefined,
    };
  }, [data]);

  const single = useMemo(
    () => [primary === "afdb" && predicted ? predicted : experimental],
    [primary, predicted, experimental],
  );
  const overlay = useMemo(
    () => (predicted ? [predicted, experimental] : [experimental]),
    [predicted, experimental],
  );
  const splitLeft = useMemo(
    () => (predicted ? [{ ...predicted, slot: "A" }] : []),
    [predicted],
  );
  const splitRight = useMemo(
    () =>
      predicted
        ? [
            { ...predicted, frameOnly: true },
            { ...experimental, slot: "B" },
          ]
        : [experimental],
    [predicted, experimental],
  );

  const colorings = useMemo(
    () => ({
      domain: data?.domains.length
        ? domainColoring(data.domains, "UniProt")
        : undefined,
      alphamissense: data?.alphaMissense
        ? variantImpactColoring(data.alphaMissense, "AlphaMissense mean")
        : undefined,
    }),
    [data],
  );
  const variant = useMemo(
    () =>
      showVariant ? { position: VARIANT.position, label: VARIANT.label } : null,
    [showVariant],
  );
  const residueSets = useMemo<ViewportResidueSet[] | undefined>(
    () =>
      showAnnotated
        ? data?.bindingSites.map((entry) => ({
            id: entry.ligand,
            label: `UniProt binding site: ${entry.ligand}`,
            positions: entry.positions,
          }))
        : undefined,
    [showAnnotated, data],
  );

  const experimentalScene = Object.values(scenes).find(
    (scene) => scene.summaries[experimental.id],
  );
  const boundComponents =
    experimentalScene?.summaries[experimental.id]?.ligands ?? [];
  const ligandRecord = boundComponents.find(
    (entry) => entry.compId === LIGAND_COMP_ID,
  );
  const ligand = useMemo<ViewportLigand | null>(
    () =>
      showSite && ligandRecord
        ? { structureId: experimental.id, ...ligandRecord, radius: 5 }
        : null,
    [showSite, ligandRecord, experimental.id],
  );

  useCameraLink(
    left,
    right,
    view === "split" && locked && Boolean(scenes.left && scenes.right),
  );

  useEffect(
    () => () => {
      if (figure) URL.revokeObjectURL(figure.url);
    },
    [figure],
  );

  const changeView = (next: View) => {
    setScenes({});
    setSite([]);
    setView(next);
  };

  const shown =
    view === "single"
      ? single
      : view === "overlay"
        ? overlay
        : [...splitLeft, experimental];

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
      source: "ClinVar",
      sourceId: VARIANT.sourceId,
      evidenceClass: "clinical_database",
    },
    structure: {
      id: shown[0].id,
      label: shown[0].id.slice(shown[0].id.indexOf(":") + 1),
      origin: shown[0].origin,
    },
  });

  const dock = useMemo<AxisDockData | null>(
    () =>
      data?.sequence
        ? {
            accession: ACCESSION,
            sequence: data.sequence,
            tracks: data.tracks,
            variants: [VARIANT],
          }
        : null,
    [data],
  );
  useAxisDock(dock, { loadingAccession: demo.isPending ? ACCESSION : null });
  useReportSources("dev-viewer", data?.sources);

  const common = {
    accession: ACCESSION,
    colorings,
    domains: data?.domains,
    variant,
    residueSets,
    ligand,
    linkedCamera: view === "split" && locked,
    onBindingSite: setSite,
    onExport: (blob: Blob, name: string) =>
      setFigure({ url: URL.createObjectURL(blob), name }),
  };
  const overlayScene =
    scenes.main?.superposition ?? scenes.right?.superposition;
  const selection = describeRanges(ranges, data?.sequence);
  const select = useWorkspaceSelection.getState();

  return (
    <WorkspaceZones
      layoutId="dev-viewer"
      ledgerLabel="Scene"
      ledger={
        <Zone
          zone="ledger"
          title="Scene"
          footer={<KeyHint keys="Escape" label="Clear selection" />}
        >
          <SectionHeader title="View" />
          <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-2">
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="View"
              value={[view]}
              onValueChange={(value) => {
                if (value.length) changeView(value[0] as View);
              }}
            >
              {VIEWS.map(([value, label]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  data-view={value}
                  disabled={value !== "single" && !predicted}
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {view === "single" ? (
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                aria-label="Structure"
                value={[primary]}
                onValueChange={(value) => {
                  if (!value.length) return;
                  setScenes({});
                  setPrimary(value[0] as "afdb" | "pdb");
                }}
              >
                <ToggleGroupItem value="afdb" disabled={!predicted}>
                  AlphaFold DB model
                </ToggleGroupItem>
                <ToggleGroupItem value="pdb">PDB {PDB_ID}</ToggleGroupItem>
              </ToggleGroup>
            ) : null}
          </div>

          <SectionHeader title="Highlights" />
          <SwitchRow
            label={`Variant site ${VARIANT.label}`}
            detail="Ball-and-stick with a label. ClinVar VCV000011348."
            checked={showVariant}
            onChange={setShowVariant}
          />
          <SwitchRow
            label={`${LIGAND_COMP_ID} and residues within 5 Å`}
            detail={
              ligandRecord
                ? `Contact shell computed by Mol* on ${PDB_ID}.`
                : `Needs ${PDB_ID} in the scene.`
            }
            checked={showSite}
            onChange={(checked) => {
              setSite([]);
              setShowSite(checked);
            }}
          />
          <SwitchRow
            label="Annotated binding residues"
            detail="Residue sets supplied by the page from UniProt binding-site features."
            checked={showAnnotated}
            onChange={setShowAnnotated}
            disabled={!data?.bindingSites.length}
          />
          {view === "split" ? (
            <SwitchRow
              label="Lock cameras"
              detail="Both panes share one camera."
              checked={locked}
              onChange={setLocked}
            />
          ) : null}

          <SectionHeader title="Selection" />
          <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-3 py-2">
            <Button
              size="sm"
              variant="outline"
              data-action="select-variant"
              onClick={() => select.selectResidue(VARIANT.position)}
            >
              Select Arg28
            </Button>
            {data?.domains.map((domain) => (
              <Button
                key={domain.id}
                size="sm"
                variant="outline"
                onClick={() =>
                  select.selectRange({ start: domain.start, end: domain.end })
                }
              >
                {domain.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => select.clear()}>
              Clear
            </Button>
          </div>

          <SectionHeader title="Sources" count={data?.sources.length} />
          {demo.isPending ? (
            <RowsSkeleton rows={4} />
          ) : (
            <DefinitionList>
              {data?.sources.map((source) => (
                <DefinitionRow key={source.source} term={source.name}>
                  {source.state === "ok"
                    ? `answered${source.release ? `, ${source.release}` : ""}`
                    : `unavailable: ${source.message ?? "no answer"}`}
                </DefinitionRow>
              ))}
            </DefinitionList>
          )}
        </Zone>
      }
      instrument={
        <Zone
          zone="instrument"
          title="3D"
          scroll={false}
          detail={
            <>
              {shown.map((structure) => (
                <StructureOriginTag
                  key={structure.id}
                  origin={structure.origin}
                  detail={structure.id}
                  size="compact"
                />
              ))}
            </>
          }
        >
          {demo.isPending ? (
            <div className="flex h-full items-center justify-center bg-canvas text-xs text-muted-foreground">
              Resolving the AlphaFold DB model for {ACCESSION}
            </div>
          ) : view === "split" ? (
            <div className="grid h-full grid-cols-1 grid-rows-2 divide-y divide-border md:grid-cols-2 md:grid-rows-1 md:divide-x md:divide-y-0">
              <StructureViewport
                key="left"
                {...common}
                ariaLabel={`${GENE} predicted model, pane A`}
                structures={splitLeft}
                viewerRef={left}
                onSceneReady={(scene) =>
                  setScenes((current) => ({ ...current, left: scene }))
                }
              />
              <StructureViewport
                key="right"
                {...common}
                ariaLabel={`${GENE} experimental structure, pane B`}
                structures={splitRight}
                viewerRef={right}
                toolbar={false}
                onSceneReady={(scene) =>
                  setScenes((current) => ({ ...current, right: scene }))
                }
              />
            </div>
          ) : (
            <StructureViewport
              key="main"
              {...common}
              ariaLabel={`${GENE} structure`}
              structures={view === "overlay" ? overlay : single}
              viewerRef={left}
              onSceneReady={(scene) => setScenes({ main: scene })}
            />
          )}
        </Zone>
      }
      inspector={
        <Zone zone="inspector" title="Readouts">
          <SectionHeader title="Selection and hover" />
          <DefinitionList>
            <DefinitionRow term="Selected" mono>
              {selection ?? "None"}
            </DefinitionRow>
            <DefinitionRow term="Hover" mono>
              {hover
                ? `${data?.sequence?.[hover.position - 1] ?? ""}${hover.position} from ${hover.origin}`
                : "None"}
            </DefinitionRow>
            <DefinitionRow term="Numbering">
              UniProt canonical, {ACCESSION}
            </DefinitionRow>
          </DefinitionList>

          <SectionHeader title="Structures in the scene" />
          <DefinitionList>
            {shown.map((structure) => {
              const summary = Object.values(scenes).find(
                (scene) => scene.summaries[structure.id],
              )?.summaries[structure.id];
              return (
                <DefinitionRow key={structure.id} term={structure.id} mono>
                  {summary
                    ? `${summary.residueCount} residues, chains ${summary.chains.map((chain) => chain.authAsymId).join(" ")}`
                    : "Loading"}
                </DefinitionRow>
              );
            })}
          </DefinitionList>

          <SectionHeader title="Superposition" />
          {overlayScene ? (
            <DefinitionList>
              <DefinitionRow term="Cα RMSD" mono>
                {overlayScene.rmsd.toFixed(3)} Å
              </DefinitionRow>
              <DefinitionRow term="Aligned pairs" mono>
                {overlayScene.alignedResidues}
              </DefinitionRow>
              <DefinitionRow term="Method">
                {overlayScene.method === "tm-align"
                  ? "TM-align (Mol*)"
                  : "Sequence-aligned Cα least-squares fit (Mol*)"}
              </DefinitionRow>
            </DefinitionList>
          ) : (
            <EmptyState
              size="inline"
              title="No superposition"
              description="Overlay and Split superpose 1B55 chain A on the AlphaFold DB model."
            />
          )}

          <SectionHeader
            title={`Residues within 5 Å of ${LIGAND_COMP_ID}`}
            count={site.length}
          />
          {site.length > 0 ? (
            <div className="flex flex-wrap gap-1 border-b border-border-subtle px-3 py-2">
              {site.map((residue) => (
                <Button
                  key={`${residue.labelAsymId}:${residue.authSeqId}`}
                  size="xs"
                  variant="outline"
                  className="font-mono"
                  disabled={residue.position === null}
                  onClick={() =>
                    residue.position !== null
                      ? select.selectResidue(residue.position)
                      : undefined
                  }
                >
                  {residue.compId}
                  {residue.position ?? residue.authSeqId}
                  {residue.authAsymId !== "A" ? ` ${residue.authAsymId}` : ""}
                </Button>
              ))}
            </div>
          ) : (
            <EmptyState
              size="inline"
              title="Contact shell not shown"
              description={`Turn on "${LIGAND_COMP_ID} and residues within 5 Å" with ${PDB_ID} in the scene.`}
            />
          )}

          <SectionHeader title="Last exported figure" />
          {figure ? (
            <figure className="flex flex-col gap-1 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-slot="exported-figure"
                src={figure.url}
                alt={`Exported figure ${figure.name}`}
                className="w-full border border-border"
              />
              <figcaption className="font-mono text-2xs break-all text-muted-foreground">
                {figure.name}
              </figcaption>
            </figure>
          ) : (
            <EmptyState
              size="inline"
              title="No figure exported yet"
              description="The camera button in the toolbar saves a PNG with the origin tag, legend, model version and research-use line."
            />
          )}
        </Zone>
      }
    />
  );
}

/** Exercises the Mol* viewport: every representation, colour mode, highlight, overlay and split. */
export function ViewerDemo() {
  return (
    <WorkspaceFrame stage="protein">
      <Demo />
    </WorkspaceFrame>
  );
}
