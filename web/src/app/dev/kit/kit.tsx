"use client";

import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "cn";
import { toast } from "sonner";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { KeyHint } from "@/components/data/key-hint";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import {
  ClaimLabel,
  EvidenceBadge,
} from "@/components/evidence/evidence-badge";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceChip } from "@/components/evidence/source-chip";
import { SourceStatusList } from "@/components/evidence/source-status-list";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LearnTerm } from "@/components/science/learn-term";
import {
  AlphaMissenseLegend,
  ClinicalSignificanceChip,
  ClinicalSignificanceLegend,
  PlddtLegend,
  ReferenceVariantLegend,
} from "@/components/science/legends";
import { MetricReadout } from "@/components/science/metric-readout";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { Swatch } from "@/components/science/swatch";
import { SequenceAxisDock, type SequenceVariant } from "@/components/sequence";
import { EmptyState } from "@/components/states/empty-state";
import { RowsSkeleton } from "@/components/states/query-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MolecularViewer,
  type MolecularViewerHandle,
} from "@/components/viewer";
import { Zone } from "@/components/workspace/zone";
import { EVIDENCE_CLASSES, EVIDENCE_META } from "@/lib/evidence";
import {
  GLOSSARY,
  GLOSSARY_TERM_IDS,
  type GlossaryTermId,
} from "@/lib/glossary";
import { ALPHAMISSENSE_CLASSES } from "@/lib/science/alphamissense";
import { PLDDT_BANDS } from "@/lib/science/plddt";
import { usePreferences } from "@/lib/state/preferences";
import { type ResidueRange } from "@/lib/state/selection";
import {
  STRUCTURE_ORIGINS,
  STRUCTURE_ORIGIN_META,
  STRUCTURE_ORIGIN_ORDER,
} from "@/lib/structure-origin";

import {
  KIT_BOLTZ_EXAMPLE,
  KIT_BTK,
  KIT_EVIDENCE,
  KIT_SOURCES,
  KIT_STRUCTURES,
  type KitStructureRow,
} from "./fixtures";
import { fetchLiveProtein } from "../live-fixture";

/* ---------------------------------------------------------------- frame */

function ThemePane({
  theme,
  className,
  children,
}: {
  theme: "light" | "dark";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        theme === "dark" ? "dark" : "theme-light",
        "min-w-0 bg-background p-4 text-foreground",
        className,
      )}
    >
      <p className="mb-3 font-mono text-2xs tracking-[0.08em] text-subtle-foreground uppercase">
        {theme}
      </p>
      {children}
    </div>
  );
}

interface SpecimenProps {
  name: string;
  /** import path, printed so builders can copy it */
  path?: string;
  note?: React.ReactNode;
  /** stack the two theme panes instead of placing them side by side */
  wide?: boolean;
  children: React.ReactNode;
}

/** One inventory row: what the component is called, where it lives, and how it looks in both themes. */
function Specimen({ name, path, note, wide = false, children }: SpecimenProps) {
  return (
    <div className="grid border-b border-border lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1 border-border bg-sunken px-4 py-3 lg:border-r">
        <h3 className="text-sm font-medium text-foreground">{name}</h3>
        {path ? (
          <code className="font-mono text-2xs break-words text-muted-foreground">
            {path}
          </code>
        ) : null}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <div
        className={cn(
          "grid min-w-0 divide-border",
          wide
            ? "divide-y"
            : "divide-y xl:grid-cols-2 xl:divide-x xl:divide-y-0",
        )}
      >
        <ThemePane theme="light">{children}</ThemePane>
        <ThemePane theme="dark">{children}</ThemePane>
      </div>
    </div>
  );
}

function Group({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-10">
      <div className="border-b border-border-strong/70 px-4 pt-8 pb-3 md:px-6">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

const GROUPS = [
  ["tokens", "Tokens"],
  ["science", "Scientific colour"],
  ["type", "Type"],
  ["controls", "Controls"],
  ["evidence", "Evidence"],
  ["metrics", "Metrics and terms"],
  ["states", "States"],
  ["data", "Data"],
  ["workspace", "Workspace"],
] as const;

/* ---------------------------------------------------------------- tokens */

const SURFACES = [
  ["bg-background", "Working surface"],
  ["bg-sunken", "Frame, gutters, bars"],
  ["bg-muted", "Table header, inset"],
  ["bg-accent", "Hover"],
  ["bg-active", "Selected, pressed"],
  ["bg-popover", "Popover, menu"],
  ["bg-canvas", "3D canvas ground"],
] as const;

const INKS = [
  ["text-foreground", "Primary text"],
  ["text-muted-foreground", "Secondary text"],
  ["text-subtle-foreground", "Tertiary text, placeholders"],
  ["text-disabled-foreground", "Disabled"],
  ["text-destructive", "Destructive"],
  ["text-warning", "Warning, source unavailable"],
] as const;

const RULES = [
  ["border-border-subtle", "Row divider"],
  ["border-border", "Panel edge"],
  ["border-border-strong", "Input edge, swatch ring, axis"],
] as const;

function TokenTable() {
  return (
    <div className="grid gap-5 text-xs sm:grid-cols-3">
      <div>
        <p className="mb-2 font-medium">Surface</p>
        <ul className="flex flex-col gap-1.5">
          {SURFACES.map(([utility, role]) => (
            <li key={utility} className="flex items-center gap-2">
              <span
                className={cn("size-6 shrink-0 border border-border", utility)}
              />
              <span className="min-w-0">
                <code className="block font-mono text-2xs">{utility}</code>
                <span className="text-muted-foreground">{role}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 font-medium">Ink</p>
        <ul className="flex flex-col gap-1.5">
          {INKS.map(([utility, role]) => (
            <li key={utility} className="flex items-baseline gap-2">
              <span
                className={cn("w-6 shrink-0 text-base font-semibold", utility)}
              >
                Aa
              </span>
              <span className="min-w-0">
                <code className="block font-mono text-2xs">{utility}</code>
                <span className="text-muted-foreground">{role}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 font-medium">Rule</p>
        <ul className="flex flex-col gap-3">
          {RULES.map(([utility, role]) => (
            <li key={utility}>
              <span className={cn("mb-1 block border-t", utility)} />
              <code className="block font-mono text-2xs">{utility}</code>
              <span className="text-muted-foreground">{role}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 mb-2 font-medium">Radius</p>
        <div className="flex items-end gap-2 font-mono text-2xs text-muted-foreground">
          <span className="flex flex-col items-center gap-1">
            <span className="size-6 rounded-xs border border-border-strong" />2
          </span>
          <span className="flex flex-col items-center gap-1">
            <span className="size-6 rounded-md border border-border-strong" />4
          </span>
          <span className="flex flex-col items-center gap-1">
            <span className="size-6 rounded-xl border border-border-strong" />6
          </span>
          <span className="flex flex-col items-center gap-1">
            <span className="size-6 rounded-2xl border border-border-strong" />8
          </span>
        </div>
      </div>
    </div>
  );
}

const CHAINS = [
  ["bg-chain-1", "A"],
  ["bg-chain-2", "B"],
  ["bg-chain-3", "C"],
] as const;

function ScaleTable() {
  return (
    <div className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2">
      <div>
        <p className="mb-1.5 font-medium">pLDDT bands</p>
        <ul>
          {PLDDT_BANDS.map((band) => (
            <li
              key={band.id}
              className="grid h-6 grid-cols-[1rem_4.5rem_minmax(0,1fr)_auto] items-center gap-2"
            >
              <Swatch
                swatchClass={band.swatchClass}
                code={band.code}
                onFill={band.onFill}
              />
              <span>{band.label}</span>
              <code className="truncate font-mono text-2xs text-muted-foreground">
                {band.swatchClass}
              </code>
              <code className="font-mono text-2xs text-subtle-foreground">
                {band.hex}
              </code>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 font-medium">AlphaMissense classes (predicted)</p>
        <ul>
          {ALPHAMISSENSE_CLASSES.map((entry) => (
            <li
              key={entry.id}
              className="grid h-6 grid-cols-[1rem_6.5rem_minmax(0,1fr)_auto] items-center gap-2"
            >
              <Swatch swatchClass={entry.swatchClass} />
              <span>{entry.label}</span>
              <code className="truncate font-mono text-2xs text-muted-foreground">
                {entry.swatchClass}
              </code>
              <code className="font-mono text-2xs text-subtle-foreground">
                {entry.hex}
              </code>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 font-medium">Evidence class tokens</p>
        <ul>
          {EVIDENCE_CLASSES.map((id) => (
            <li
              key={id}
              className="grid h-6 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2"
            >
              <EvidenceBadge evidenceClass={id} size="compact" />
              <code className="truncate font-mono text-2xs text-muted-foreground">
                {EVIDENCE_META[id].textClass}
              </code>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 font-medium">Structure origin tokens</p>
        <ul>
          {STRUCTURE_ORIGINS.map((id) => (
            <li
              key={id}
              className="grid h-6 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2"
            >
              <StructureOriginTag origin={id} size="compact" />
              <code className="truncate font-mono text-2xs text-muted-foreground">
                {STRUCTURE_ORIGIN_META[id].textClass}
              </code>
            </li>
          ))}
        </ul>
        <p className="mt-3 mb-1.5 font-medium">
          Chains (letter always printed)
        </p>
        <div className="flex items-center gap-2">
          {CHAINS.map(([utility, letter]) => (
            <span key={utility} className="flex items-center gap-1.5">
              <Swatch swatchClass={utility} code={letter} onFill="white" />
              <code className="font-mono text-2xs text-muted-foreground">
                {utility}
              </code>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const TYPE_SCALE = [
  ["text-2xs", "11 / 16", "Column headers, badges, axis ticks, legends"],
  ["text-xs", "12 / 16", "Table cells, controls, metadata, identifiers"],
  ["text-sm", "13 / 20", "Body default, panel content"],
  ["text-base", "14 / 20", "Long-form explanation, hypothesis text"],
  ["text-lg", "16 / 24", "Panel titles"],
  ["text-xl", "18 / 24", "Page section titles"],
  ["text-2xl", "22 / 28", "Entity title: gene symbol, disease name"],
  ["text-3xl", "28 / 32", "Rare single headline number"],
] as const;

/* ---------------------------------------------------------------- data specimens */

const STRUCTURE_COLUMNS: DataTableColumn<KitStructureRow>[] = [
  {
    id: "origin",
    header: "Class",
    width: 56,
    sortable: false,
    cell: (row) => <StructureOriginTag origin={row.origin} size="compact" />,
  },
  {
    id: "id",
    header: "Structure",
    accessor: (row) => row.id,
    mono: true,
    width: "minmax(9rem,1.2fr)",
  },
  { id: "method", header: "Method", accessor: (row) => row.method },
  {
    id: "resolution",
    header: "Res. Å",
    accessor: (row) => row.resolution,
    align: "right",
    width: 72,
    cell: (row) =>
      row.resolution?.toFixed(2) ?? (
        <span className="text-subtle-foreground">n/a</span>
      ),
  },
  {
    id: "plddt",
    header: "Mean pLDDT",
    accessor: (row) => row.meanPlddt,
    align: "right",
    width: 112,
    cell: (row) =>
      row.meanPlddt?.toFixed(1) ?? (
        <span className="text-subtle-foreground">n/a</span>
      ),
  },
];

interface GlossaryRow {
  id: GlossaryTermId;
  term: string;
  category: string;
  definition: string;
}

const GLOSSARY_ROWS: GlossaryRow[] = GLOSSARY_TERM_IDS.map((id) => ({
  id,
  term: GLOSSARY[id].term,
  category: GLOSSARY[id].category,
  definition: GLOSSARY[id].definition,
}));

const GLOSSARY_COLUMNS: DataTableColumn<GlossaryRow>[] = [
  {
    id: "term",
    header: "Term",
    accessor: (row) => row.term,
    width: "minmax(10rem,14rem)",
    cell: (row) => <span className="font-medium">{row.term}</span>,
  },
  {
    id: "category",
    header: "Category",
    accessor: (row) => row.category,
    width: 96,
  },
  {
    id: "definition",
    header: "Definition",
    accessor: (row) => row.definition,
    sortable: false,
    width: "minmax(16rem,3fr)",
  },
];

function StructuresTable() {
  const [selected, setSelected] = useState<string | null>("afdb:AF-P42224-F1");
  return (
    <div className="h-52 border border-border">
      <DataTable
        label="Structures of STAT1"
        columns={STRUCTURE_COLUMNS}
        data={KIT_STRUCTURES}
        getRowId={(row) => row.id}
        selectedRowId={selected}
        onRowSelect={(row) => setSelected(row.id)}
        onRowActivate={(row) => toast(`Open ${row.id}`)}
        groupBy={(row) => row.origin}
        groupOrder={STRUCTURE_ORIGIN_ORDER}
        groupLabel={(group) =>
          STRUCTURE_ORIGIN_META[group as keyof typeof STRUCTURE_ORIGIN_META]
            .label
        }
        defaultSort={{ id: "resolution" }}
      />
    </div>
  );
}

function GlossaryTable() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="h-64 border border-border">
      <DataTable
        label="Glossary"
        columns={GLOSSARY_COLUMNS}
        data={GLOSSARY_ROWS}
        getRowId={(row) => row.id}
        selectedRowId={selected}
        onRowSelect={(row) => setSelected(row.id)}
        defaultSort={{ id: "term" }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- live axis specimen */

const AXIS_VARIANTS: SequenceVariant[] = [
  {
    id: KIT_BTK.variantId,
    position: 28,
    reference: "R",
    alternate: "H",
    label: KIT_BTK.variantLabel,
    consequence: "missense",
    significance: "pathogenic",
    reviewStars: 2,
    group: "clinical",
    sourceId: KIT_BTK.clinvarAccession,
  },
];

function AxisSpecimen() {
  const query = useQuery({
    queryKey: ["kit", "axis", KIT_BTK.accession],
    queryFn: () => fetchLiveProtein(KIT_BTK.accession),
    staleTime: Infinity,
    retry: false,
  });
  const [selection, setSelection] = useState<ResidueRange[]>([
    { start: 28, end: 28 },
  ]);
  const [hover, setHover] = useState<number | null>(null);
  const [variantId, setVariantId] = useState<string | null>(KIT_BTK.variantId);

  if (query.isPending) return <RowsSkeleton rows={4} />;
  if (query.isError) {
    return (
      <SourceUnavailable
        source="UniProt"
        message={
          query.error instanceof Error ? query.error.message : "request failed"
        }
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="h-36 border border-border">
        <SequenceAxisDock
          accession={KIT_BTK.accession}
          sequence={query.data.sequence}
          tracks={query.data.tracks}
          variants={AXIS_VARIANTS}
          selection={selection}
          selectedVariantId={variantId}
          hoverPosition={hover}
          onSelect={(ranges) => setSelection(ranges)}
          onSelectVariant={(variant) => {
            setVariantId(variant.id);
            setSelection([{ start: variant.position, end: variant.position }]);
          }}
          onHover={setHover}
        />
      </div>
      <p className="font-mono text-2xs text-muted-foreground">
        sel{" "}
        {selection
          .map((range) =>
            range.start === range.end
              ? range.start
              : `${range.start}-${range.end}`,
          )
          .join(", ") || "none"}
        {" · "}hover {hover ?? "none"}
        {" · "}
        {KIT_BTK.accession} canonical 1-{query.data.sequence.length}
      </p>
    </div>
  );
}

function ViewerSpecimen() {
  const viewer = useRef<MolecularViewerHandle>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-44 border border-border">
        <MolecularViewer
          ref={viewer}
          ariaLabel="STAT1, AlphaFold DB model AF-P42224-F1"
        />
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void viewer.current?.load({
              id: "afdb:AF-P42224-F1",
              origin: "predicted_external",
              source: {
                kind: "url",
                url: "https://alphafold.ebi.ac.uk/files/AF-P42224-F1-model_v6.bcif",
                format: "mmcif",
                isBinary: true,
              },
            })
          }
        >
          Call load() on the handle
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

function ControlsSpecimen() {
  const [mode, setMode] = useState<string[]>(["confidence"]);
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button>Run prediction</Button>
        <Button variant="outline">
          <DownloadIcon data-icon="inline-start" /> Export
        </Button>
        <Button variant="secondary">Add to project</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Cancel job</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg">Large 32</Button>
        <Button>Default 28</Button>
        <Button size="sm">Small 24</Button>
        <Button size="icon" variant="outline" aria-label="Add">
          <PlusIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Reset view">
          <RotateCcwIcon />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter variants"
          className="w-48"
          aria-label="Filter variants"
        />
        <ToggleGroup
          value={mode}
          onValueChange={(value) =>
            value.length ? setMode(value as string[]) : null
          }
          variant="outline"
          spacing={0}
        >
          <ToggleGroupItem value="confidence">Confidence</ToggleGroupItem>
          <ToggleGroupItem value="chain">Chain</ToggleGroupItem>
          <ToggleGroupItem value="domain">Domain</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Tabs defaultValue="split">
          <TabsList variant="line">
            <TabsTrigger value="split">Split</TabsTrigger>
            <TabsTrigger value="overlay">Overlay</TabsTrigger>
            <TabsTrigger value="difference">Difference</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2">
          <Switch defaultChecked /> Lock cameras
        </label>
        <label className="flex items-center gap-2">
          <Checkbox defaultChecked /> Pathogenic only
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <KeyHint keys="mod+k" label="Search" />
        <KeyHint keys="g p" label="Protein stage" />
        <KeyHint keys="?" label="Shortcuts" />
        <KeyHint keys="enter" label="Open" />
      </div>
    </div>
  );
}

function LearnSpecimen() {
  const learnMode = usePreferences((state) => state.learnMode);
  const setLearnMode = usePreferences((state) => state.setLearnMode);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={learnMode} onCheckedChange={setLearnMode} /> Learn Mode{" "}
        {learnMode ? "on" : "off"}
      </label>
      <p className="max-w-[60ch]">
        A <LearnTerm term="missense-mutation">missense mutation</LearnTerm>{" "}
        changes one <LearnTerm term="residue">residue</LearnTerm> in a{" "}
        <LearnTerm term="protein-domain">protein domain</LearnTerm>. Model
        confidence at that residue is reported as{" "}
        <LearnTerm term="plddt">pLDDT</LearnTerm>, and a{" "}
        <LearnTerm term="ligand">ligand</LearnTerm> pose is read together with
        its <LearnTerm term="binding-affinity">binding affinity</LearnTerm> and{" "}
        <LearnTerm term="iptm">ipTM</LearnTerm>.
      </p>
    </div>
  );
}

export function Kit() {

  return (
    <div>
      <nav
        aria-label="Kit sections"
        className="no-scrollbar sticky top-0 z-30 flex h-9 items-center gap-1 overflow-x-auto border-b border-border bg-background px-4 md:px-6"
      >
        {GROUPS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <Group
        id="tokens"
        title="Tokens"
        description="Neutral chrome only: one working surface, a sunken frame, three weights of rule. Every value is a CSS variable in globals.css and has a light and a dark definition."
      >
        <Specimen
          name="Surfaces, ink, rules"
          path="src/app/globals.css"
          note="Use the utility, never a raw colour."
        >
          <TokenTable />
        </Specimen>
      </Group>

      <Group
        id="science"
        title="Scientific colour"
        description="The only saturated colour in the product. Canonical scales are identical in both themes. Each one is reserved for one meaning and always carries a second, non-colour channel."
      >
        <Specimen
          name="Scales and class tokens"
          path="@/lib/science/*, @/lib/evidence, @/lib/structure-origin"
        >
          <ScaleTable />
        </Specimen>
        <Specimen
          name="PlddtLegend"
          path="@/components/science/legends"
          note="Required wherever pLDDT colours appear."
        >
          <div className="flex flex-col gap-4">
            <PlddtLegend />
            <PlddtLegend orientation="vertical" />
          </div>
        </Specimen>
        <Specimen
          name="AlphaMissenseLegend"
          path="@/components/science/legends"
          note="Always labelled as predicted."
        >
          <AlphaMissenseLegend />
        </Specimen>
        <Specimen
          name="ClinicalSignificanceChip"
          path="@/components/science/legends"
          note="Database classifications only. Hatched swatch marks the likely and conflicting classes."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <ClinicalSignificanceChip
                significance="pathogenic"
                reviewStars={2}
              />
              <ClinicalSignificanceChip
                significance="likely_pathogenic"
                reviewStars={1}
              />
              <ClinicalSignificanceChip significance="uncertain" long />
            </div>
            <ClinicalSignificanceLegend orientation="vertical" />
            <ReferenceVariantLegend />
          </div>
        </Specimen>
      </Group>

      <Group
        id="type"
        title="Type"
        description="IBM Plex Sans for everything, IBM Plex Mono for sequences, HGVS, accessions, coordinates and numeric columns. Weights 400, 500 and 600. Minimum size 11px. Ligatures are off so notation is never rewritten."
      >
        <Specimen name="Scale" path="text-2xs … text-3xl">
          <ul>
            {TYPE_SCALE.map(([utility, metrics, use]) => (
              <li
                key={utility}
                className="grid grid-cols-[4rem_3.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border-subtle py-1.5 last:border-b-0"
              >
                <code className="font-mono text-2xs text-muted-foreground">
                  {utility}
                </code>
                <span className="tabular font-mono text-2xs text-subtle-foreground">
                  {metrics}
                </span>
                <span className={cn(utility, "truncate")}>{use}</span>
              </li>
            ))}
          </ul>
        </Specimen>
        <Specimen
          name="Identifiers"
          path="font-mono, MonoId"
          note="I, l and 1 stay distinct. Digits are tabular."
        >
          <div className="flex flex-col gap-1.5 font-mono text-xs">
            <span>IL2RG Il2rg IKBKG 0O 1lI</span>
            <span>P0DTC2 O00522 p.Leu858Arg c.2573T&gt;G -&gt; &gt;= !=</span>
            <span className="font-sans text-sm">
              Greek in running text is set in Plex Sans: α β Δ ΔΔG Å µM
            </span>
          </div>
        </Specimen>
      </Group>

      <Group
        id="controls"
        title="Controls"
        description="shadcn/ui on Base UI, Mira density: 28px controls, 12px control text, 4px radius. Primary actions are ink on paper. Colour never marks an ordinary action."
      >
        <Specimen
          name="Buttons, inputs, toggles, keys"
          path="@/components/ui/*, @/components/data/key-hint"
        >
          <ControlsSpecimen />
        </Specimen>
      </Group>

      <Group
        id="evidence"
        title="Evidence"
        description="Every scientific statement carries one of six classes. The class is carried by a text code, a glyph shape, a border style and the glyph fill. Hue is a fifth, redundant channel. Clicking a badge shows the source record."
      >
        <Specimen
          name="EvidenceBadge"
          path="@/components/evidence/evidence-badge"
          note="compact for table cells, standard for inspector rows."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {EVIDENCE_CLASSES.map((id) => (
                <EvidenceBadge key={id} evidenceClass={id} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {EVIDENCE_CLASSES.map((id) => (
                <EvidenceBadge key={id} evidenceClass={id} size="compact" />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <EvidenceBadge
                evidenceClass="experimental"
                detail="PubMed:10196129"
              />
              <EvidenceBadge
                evidenceClass="clinical_database"
                detail="VCV000011348 2/4"
              />
              <EvidenceBadge
                evidenceClass="computational_prediction"
                detail="FoldX v5.0"
              />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="EvidencePopover"
          path="@/components/evidence/evidence-popover"
          note="The default way to cite. Shows source, record ID, release, retrieval date and a link. Missing fields read Unknown."
        >
          <ul className="flex flex-col">
            {KIT_EVIDENCE.map((item) => (
              <li
                key={item.evidenceClass}
                className="flex min-h-7 items-baseline gap-2 border-b border-border-subtle py-1.5 text-xs last:border-b-0"
              >
                <EvidencePopover
                  evidence={item}
                  size="compact"
                  className="w-12 shrink-0"
                />
                <span className="min-w-0">{item.statement}</span>
              </li>
            ))}
          </ul>
        </Specimen>
        <Specimen
          name="ClaimLabel"
          path="@/components/evidence/evidence-badge"
          note="The four-label reading for comparison and mechanism views."
        >
          <div className="flex flex-col gap-1.5">
            <ClaimLabel evidenceClass="experimental" />
            <ClaimLabel evidenceClass="curated_database" />
            <ClaimLabel evidenceClass="computational_prediction" />
            <ClaimLabel evidenceClass="helix_hypothesis" />
          </div>
        </Specimen>
        <Specimen
          name="StructureOriginTag"
          path="@/components/evidence/structure-origin-tag"
          note="On every structure, in every row, and in the viewport corner."
        >
          <div className="flex flex-col gap-2">
            <StructureOriginTag
              origin="experimental"
              detail="1BF5 X-ray 2.9 Å"
            />
            <StructureOriginTag
              origin="predicted_external"
              detail="AlphaFold DB v6"
              caption
            />
            <StructureOriginTag
              origin="predicted_internal"
              detail="Boltz-2"
              caption
            />
            <div className="flex items-center gap-4 pt-1">
              {STRUCTURE_ORIGINS.map((id) => (
                <StructureOriginTag key={id} origin={id} size="compact" />
              ))}
            </div>
          </div>
        </Specimen>
        <Specimen
          name="SourceChip"
          path="@/components/evidence/source-chip"
          note="Source in sans, identifier in mono. Square, never a pill."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceChip
              source="UniProt"
              id={KIT_BTK.accession}
              href={`https://www.uniprot.org/uniprotkb/${KIT_BTK.accession}`}
            />
            <SourceChip
              source="ClinVar"
              id={KIT_BTK.clinvarAccession}
              href="https://www.ncbi.nlm.nih.gov/clinvar/variation/11348/"
            />
            <SourceChip label="BTK" source="UniProt" id="VAR_006220" />
            <SourceChip
              source="AlphaFold DB"
              id="AF-Q06187-F1"
              marker={
                <StructureOriginTag
                  origin="predicted_external"
                  size="compact"
                />
              }
              href="https://alphafold.ebi.ac.uk/entry/Q06187"
            />
          </div>
        </Specimen>
        <Specimen
          name="SourceStatusList"
          path="@/components/evidence/source-status-list"
          note="Which sources answered, had no record, or are down. Publish to the status line with useReportSources."
        >
          <div className="border border-border">
            <SourceStatusList sources={KIT_SOURCES} />
          </div>
        </Specimen>
      </Group>

      <Group
        id="metrics"
        title="Metrics and terms"
        description="A technical number is always shown with its reading and an inline explainer. Values are never animated and never coloured; a swatch beside the value carries the band."
      >
        <Specimen
          name="ModelResultStrip"
          path="@/components/science/model-result-strip"
          note="The one way a model's output is shown: model, version, origin, two or three numbers with units, run time. Values here are the cached BTK p.Arg28His comparison and the AlphaFold DB model of BTK."
          wide
        >
          <div className="flex flex-col gap-4">
            <ModelResultStrip
              frame="box"
              model="ESMFold v1"
              version="esmfold_v1"
              origin="predicted_internal"
              metrics={[
                { label: "Cα RMSD", value: "0.069", unit: "Å" },
                { label: "pLDDT at Arg28", value: 88, explainer: "plddt" },
                { label: "Contacts gained", value: 1 },
              ]}
              runtime="cached"
              href="/compare/BTK/p.Arg28His"
              hrefLabel="Open comparison"
            />
            <ModelResultStrip
              frame="box"
              model="AlphaFold DB"
              version="v6"
              origin="predicted_external"
              metrics={[
                { label: "Mean pLDDT", value: 87.3, explainer: "plddt" },
                {
                  label: "PAE",
                  value: null,
                  unit: "Å",
                  explainer: "pae",
                  missingReason: "Not loaded",
                },
              ]}
            />
          </div>
        </Specimen>
        <Specimen
          name="MetricReadout"
          path="@/components/science/metric-readout"
          note="Advanced mode prints full precision."
        >
          <div className="flex flex-col gap-2">
            <MetricReadout
              metric="plddt"
              value={KIT_BTK.residuePlddt}
              label="pLDDT at Arg28"
              producedBy="AlphaFold DB, AF-Q06187-F1"
            />
            <MetricReadout
              metric="alphamissense"
              value={KIT_BTK.alphaMissense}
              producedBy="AlphaMissense via AlphaFold DB"
            />
            <MetricReadout
              metric="ddg"
              value={KIT_BTK.foldxDdg}
              producedBy="FoldX v5.0 via ProtVar"
            />
            <MetricReadout
              metric="pae"
              value={null}
              missingReason="Not provided by this model"
            />
            <MetricReadout
              metric="iptm"
              value={null}
              missingReason="n/a (single chain)"
            />
            <p className="pt-2 text-2xs text-subtle-foreground">
              Format example from the Boltz documentation, not a result:
            </p>
            <MetricReadout metric="ptm" value={KIT_BOLTZ_EXAMPLE.ptm} />
            <MetricReadout metric="iptm" value={KIT_BOLTZ_EXAMPLE.iptm} />
            <MetricReadout
              metric="affinity"
              value={KIT_BOLTZ_EXAMPLE.affinity}
            />
            <MetricReadout
              metric="binder_probability"
              value={KIT_BOLTZ_EXAMPLE.binderProbability}
            />
          </div>
        </Specimen>
        <Specimen
          name="MetricReadout, stacked"
          path='layout="stack"'
          note="For inspector headers."
        >
          <div className="grid grid-cols-2 gap-4">
            <MetricReadout
              metric="plddt"
              value={KIT_BTK.residuePlddt}
              layout="stack"
              terse
            />
            <MetricReadout
              metric="ddg"
              value={KIT_BTK.foldxDdg}
              layout="stack"
              terse
            />
          </div>
        </Specimen>
        <Specimen
          name="LearnTerm"
          path="@/components/science/learn-term"
          note="Plain text until Learn Mode is on. Definitions live in @/lib/glossary."
        >
          <LearnSpecimen />
        </Specimen>
      </Group>

      <Group
        id="states"
        title="States"
        description="An absence is a result. Say what is absent, which sources were searched, and offer the next step. One failing source never blanks a page. No illustrations."
      >
        <Specimen name="EmptyState" path="@/components/states/empty-state">
          <div className="flex flex-col gap-3">
            <div className="h-36 border border-border">
              <EmptyState
                title="No experimental structure"
                description="No entry in the Protein Data Bank covers this protein. A predicted structure is available."
                searched={["RCSB PDB", "PDBe"]}
                actions={<Button size="sm">Show the AlphaFold DB model</Button>}
              />
            </div>
            <div className="border border-border">
              <EmptyState
                size="inline"
                title="No compounds retrieved"
                searched={["ChEMBL", "Open Targets"]}
              />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="SourceUnavailable"
          path="@/components/states/source-unavailable"
          note="Row-level. A 404 that means no record is an EmptyState instead."
        >
          <div className="border border-border">
            <SourceUnavailable
              source="RCSB PDB"
              message="timeout after 30 s"
              cachedAt="2026-10-01"
              onRetry={() => toast("Retry requested")}
            />
          </div>
        </Specimen>
        <Specimen
          name="RowsSkeleton"
          path="@/components/states/query-state"
          note="Appears after 200ms. Matches the 28px row rhythm. QueryErrorState maps API errors onto the two states above."
        >
          <div className="border border-border">
            <RowsSkeleton rows={4} />
          </div>
        </Specimen>
        <Specimen
          name="toast"
          path='import { toast } from "sonner"'
          note="For events that finish out of view: a job completing, a copy, an export."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast("Copied Q06187")}
            >
              Plain
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.success("Structure exported", {
                  description: "AF-Q06187-F1 as mmCIF",
                  action: { label: "Open", onClick: () => {} },
                })
              }
            >
              With action
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.error("Export failed", {
                  description: "The API did not answer.",
                })
              }
            >
              Error
            </Button>
          </div>
        </Specimen>
      </Group>

      <Group
        id="data"
        title="Data"
        description="Tables with 28px rows and hairline rules, monospace identifiers, right-aligned numbers. Summary numbers sit inline in headers. There are no cards and no stat tiles."
      >
        <Specimen
          name="DataTable"
          path="@/components/data/data-table"
          wide
          note="TanStack Table and Virtual. Click a header to sort. Focus the body and use j, k, arrows and Enter. Groups are never interleaved by sorting."
        >
          <StructuresTable />
        </Specimen>
        <Specimen
          name="DataTable, long"
          path="@/components/data/data-table"
          wide
          note="Virtualised. The rows are this app's glossary."
        >
          <GlossaryTable />
        </Specimen>
        <Specimen
          name="SectionHeader, DefinitionList"
          path="@/components/data/section-header, definition-list"
          note="Sections are separated by a header, never by a card. Empty values read Unknown."
        >
          <div className="border border-border">
            <SectionHeader
              title="Variant"
              count={1}
              actions={
                <Button size="xs" variant="ghost">
                  Copy
                </Button>
              }
            />
            <DefinitionList>
              <DefinitionRow term="Gene">{KIT_BTK.gene}</DefinitionRow>
              <DefinitionRow term="Protein change" mono>
                {KIT_BTK.variantLabel}
              </DefinitionRow>
              <DefinitionRow term="UniProt">
                <MonoId value={KIT_BTK.accession} />
              </DefinitionRow>
              <DefinitionRow term="Classification">
                <ClinicalSignificanceChip
                  significance="pathogenic"
                  reviewStars={2}
                  long
                />
              </DefinitionRow>
              <DefinitionRow term="Functional assay">{null}</DefinitionRow>
            </DefinitionList>
          </div>
        </Specimen>
        <Specimen
          name="MonoId, ExternalLink, TextLink"
          path="@/components/data/*"
        >
          <div className="flex flex-col gap-2 text-sm">
            <MonoId value="AF-Q06187-F1" />
            <ExternalLink
              href={`https://www.uniprot.org/uniprotkb/${KIT_BTK.accession}`}
            >
              Open at UniProt
            </ExternalLink>
            <TextLink href="/about">Methodology and limitations</TextLink>
          </div>
        </Specimen>
      </Group>

      <Group
        id="workspace"
        title="Workspace"
        description="Stage rail, subject bar, three zones over the sequence axis, status line. The frame itself is live on any workspace route; these are its parts."
      >
        <Specimen
          name="Zone"
          path="@/components/workspace"
          wide
          note="Ledger, Instrument, Inspector. Divided by rules, sharing one surface."
        >
          <div className="grid h-56 border border-border md:grid-cols-[16rem_minmax(0,1fr)_16rem] md:divide-x md:divide-border">
            <Zone
              zone="ledger"
              title="Structures"
              count={KIT_STRUCTURES.length}
              footer={<KeyHint keys="l" label="Hide" />}
            >
              <EmptyState
                size="inline"
                title="Ledger"
                description="The dense table for the stage."
              />
            </Zone>
            <Zone
              zone="instrument"
              title="3D"
              detail={
                <StructureOriginTag
                  origin="predicted_external"
                  detail="AF-P42224-F1"
                  size="compact"
                />
              }
              footer={<PlddtLegend showRanges={false} wrap={false} />}
              scroll={false}
              className="hidden md:flex"
            >
              <EmptyState
                title="Instrument"
                description="The 3D viewport or the stage's primary plot."
              />
            </Zone>
            <Zone
              zone="inspector"
              title="Asp165"
              footer={<KeyHint keys="i" label="Hide" />}
              className="hidden md:flex"
            >
              <EmptyState
                size="inline"
                title="Inspector"
                description="Evidence for the current selection."
              />
            </Zone>
          </div>
        </Specimen>
        <Specimen
          name="MolecularViewer"
          path="@/components/viewer"
          note="Reserved contract. The placeholder draws no coordinates and says the viewer is loading."
        >
          <ViewerSpecimen />
        </Specimen>
        <Specimen
          name="SequenceAxisDock"
          path="@/components/sequence"
          wide
          note="Reserved contract with a working lightweight axis. This specimen loads BTK from UniProt and AlphaFold DB in your browser; product pages use the Helix API."
        >
          <AxisSpecimen />
        </Specimen>
      </Group>
    </div>
  );
}
