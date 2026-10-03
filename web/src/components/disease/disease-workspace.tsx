"use client";

import { ArrowRightIcon, XIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { KeyHint } from "@/components/data/key-hint";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceStatusList } from "@/components/evidence/source-status-list";
import { LiteraturePanel } from "@/components/literature/literature-panel";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  StructureInstrument,
  StructureResultStrip,
  useShownStructure,
} from "@/components/variant/structure-pane";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
} from "@/components/workspace";
import { isApiError } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { withSelection } from "@/lib/state/selection-url";
import { useReportSources } from "@/lib/state/shell";
import {
  useDisease,
  useStructureLedger,
  useSubjectBundle,
  type DiseaseResponse,
} from "@/lib/workspace-data";

import { DiseaseRecord } from "./disease-record";
import { DiseaseSummary } from "./disease-summary";
import { apiEvidence, recordEvidence } from "./evidence";

type Phenotype = Schema<"DiseasePhenotype">;
type StatusItem = Schema<"ResearchStatusItem">;
type Panel = "record" | "literature";

const COUNT_GROUP = "Reported as a count of patients";
const NO_FREQUENCY = "Frequency not stated";
const COUNT_PATTERN = /^\d+\s*\/\s*\d+$/;

/** Orphanet bands keep the source's wording; HPO cohort counts and blanks get their own groups. */
function frequencyGroup(phenotype: Phenotype): string {
  const { frequency } = phenotype;
  if (!frequency) return NO_FREQUENCY;
  return COUNT_PATTERN.test(frequency) ? COUNT_GROUP : frequency;
}

/** Ordering key only, never shown: the upper bound a band names, or the counted fraction. */
function frequencyRank(frequency: string | null): number {
  if (!frequency) return -1;
  const count = /^(\d+)\s*\/\s*(\d+)$/.exec(frequency);
  if (count) return Number(count[2]) ? Number(count[1]) / Number(count[2]) : 0;
  const bounds = frequency.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return bounds.length ? Math.max(...bounds) / 100 : 0;
}

function frequencyCell(phenotype: Phenotype): React.ReactNode {
  const { frequency } = phenotype;
  if (!frequency) return <Unknown reason="n/s" />;
  if (COUNT_PATTERN.test(frequency)) return frequency;
  return /\(([^)]+)\)/.exec(frequency)?.[1] ?? frequency;
}

const PHENOTYPE_COLUMNS: DataTableColumn<Phenotype>[] = [
  {
    id: "label",
    header: "Phenotype",
    accessor: (row) => row.label ?? row.hpo_id,
    cell: (row) => (
      <span className="truncate" title={row.label ?? row.hpo_id}>
        {row.label ?? <span className="font-mono">{row.hpo_id}</span>}
      </span>
    ),
  },
  {
    id: "frequency",
    header: "Freq.",
    align: "right",
    mono: true,
    width: 64,
    accessor: (row) => frequencyRank(row.frequency),
    cell: frequencyCell,
  },
  {
    id: "source",
    header: "Src",
    width: 60,
    sortable: false,
    cell: (row) => {
      const evidence = phenotypeEvidence(row);
      return evidence ? (
        <span onClick={(event) => event.stopPropagation()}>
          <EvidencePopover size="compact" evidence={evidence} />
        </span>
      ) : (
        <Unknown reason="None" />
      );
    },
  },
];

function phenotypeEvidence(phenotype: Phenotype) {
  return recordEvidence(
    phenotype.source,
    `${phenotype.label ?? phenotype.hpo_id}${phenotype.frequency ? `, frequency ${phenotype.frequency}` : ""}`,
  );
}

function statusValue(value: StatusItem["value"]): React.ReactNode {
  if (value === null) return <Unknown reason="No source found" />;
  if (typeof value === "number") return formatCount(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

function ResearchStatus({ disease }: { disease: DiseaseResponse }) {
  const items = disease.research_status;
  return (
    <>
      <SectionHeader
        title="Research status"
        count={items.length}
        description="Counts read from each source on the date shown in its badge. They measure what is recorded, not how well the disease is understood."
      />
      {items.length === 0 ? (
        <EmptyState size="inline" title="No counts available" />
      ) : (
        <ul>
          {items.map((item) => {
            const evidence = item.evidence
              ? apiEvidence(item.evidence, { sources: disease.sources })
              : recordEvidence(
                  item.source,
                  `${item.label}: ${item.value === null ? "no value" : String(item.value)}`,
                );
            return (
              <li
                key={item.key}
                className="border-b border-border-subtle px-3 py-1.5 last:border-b-0"
              >
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-foreground">
                    {item.label}
                  </span>
                  <span className="tabular shrink-0 font-mono font-medium text-foreground">
                    {statusValue(item.value)}
                  </span>
                  {evidence ? (
                    <EvidencePopover
                      size="compact"
                      align="end"
                      evidence={evidence}
                      className="shrink-0 self-center"
                    />
                  ) : null}
                </div>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {item.definition}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function PhenotypeDetail({
  phenotype,
  onClear,
}: {
  phenotype: Phenotype;
  onClear: () => void;
}) {
  const evidence = phenotypeEvidence(phenotype);
  return (
    <div className="border-b border-border">
      <SectionHeader
        title="Selected phenotype"
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear the selected phenotype"
            onClick={onClear}
          >
            <XIcon />
          </Button>
        }
      />
      <DefinitionList termWidth="6rem">
        <DefinitionRow term="Term">
          {phenotype.label ?? <Unknown reason="Label not provided" />}
        </DefinitionRow>
        <DefinitionRow term="HPO ID">
          <span className="flex flex-wrap items-center gap-2">
            <MonoId value={phenotype.hpo_id} />
            <ExternalLink href={phenotype.url}>HPO</ExternalLink>
          </span>
        </DefinitionRow>
        <DefinitionRow term="Frequency">
          {phenotype.frequency ? (
            <>
              {phenotype.frequency}
              <span className="block text-2xs text-subtle-foreground">
                {COUNT_PATTERN.test(phenotype.frequency)
                  ? "patients with the phenotype / patients assessed, as the source reports"
                  : "frequency band as the source reports it"}
              </span>
            </>
          ) : (
            <Unknown reason="Not stated by the source" />
          )}
        </DefinitionRow>
        <DefinitionRow term="Source">
          {evidence ? (
            <span className="flex flex-wrap items-center gap-2">
              <EvidencePopover evidence={evidence} />
              <span className="text-muted-foreground">
                {phenotype.source?.name}
              </span>
            </span>
          ) : null}
        </DefinitionRow>
      </DefinitionList>
    </div>
  );
}

function RecordInspector({
  disease,
  phenotype,
  onClearPhenotype,
}: {
  disease: DiseaseResponse;
  phenotype: Phenotype | null;
  onClearPhenotype: () => void;
}) {
  return (
    <div className="flex flex-col">
      {phenotype ? (
        <PhenotypeDetail phenotype={phenotype} onClear={onClearPhenotype} />
      ) : null}
      <ResearchStatus disease={disease} />

      <SectionHeader
        title="Identifiers"
        count={disease.xrefs.length}
        className="border-t border-t-border"
      />
      {disease.xrefs.length === 0 ? (
        <EmptyState
          size="inline"
          title="No mapped identifier"
          description="The catalog entry comes from the IUIS classification and has no exact match in the ontologies below."
          searched={["Mondo", "Orphanet", "OMIM"]}
        />
      ) : (
        <DefinitionList termWidth="6rem">
          {disease.xrefs.map((xref) => (
            <DefinitionRow key={xref.id} term={xref.database}>
              <span className="flex flex-wrap items-center gap-2">
                <MonoId value={xref.id} />
                {xref.url ? (
                  <ExternalLink href={xref.url}>Record</ExternalLink>
                ) : null}
              </span>
            </DefinitionRow>
          ))}
        </DefinitionList>
      )}

      <SectionHeader
        title="Data sources"
        count={disease.record_sources.length}
        description="Records this page was assembled from."
        className="border-t border-t-border"
      />
      <ul>
        {disease.record_sources.map((source) => {
          const evidence = recordEvidence(source);
          return (
            <li
              key={`${source.source_id}:${source.record_id}`}
              className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-1.5 text-xs last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground">
                  {source.name ?? source.source_id}
                </div>
                <div className="font-mono text-2xs break-words text-muted-foreground">
                  {[source.record_id, source.release]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {evidence ? (
                <EvidencePopover
                  size="compact"
                  align="end"
                  evidence={evidence}
                  className="shrink-0 self-center"
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <SectionHeader
        title="Live sources"
        count={disease.sources.length}
        description="Queried when this page loaded."
        className="border-t border-t-border"
      />
      <SourceStatusList sources={disease.sources} />
    </div>
  );
}

/** Simple mode: the protein the disease gene encodes, in 3D, with the model that produced it. */
function DiseaseStructure({
  disease,
  actions,
}: {
  disease: DiseaseResponse;
  actions: React.ReactNode;
}) {
  const { gene, protein } = disease;
  const accession = protein?.accession ?? null;
  const ledgerQuery = useStructureLedger(accession);
  const ledger = ledgerQuery.data?.data ?? null;
  const structure = useShownStructure(accession, ledger);
  return (
    <StructureInstrument
      accession={accession}
      subject={gene?.symbol ?? disease.name}
      ledger={ledger}
      ledgerSettled={!ledgerQuery.isPending}
      structure={structure}
      position={null}
      title={gene ? `${gene.symbol} protein` : "Protein"}
      caption={
        protein?.name ? (
          <span className="truncate text-xs text-muted-foreground">
            {protein.name}
          </span>
        ) : null
      }
      actions={actions}
      bottom={
        <StructureResultStrip
          descriptor={structure.shown.descriptor}
          className="shrink-0"
        />
      }
    />
  );
}

export interface DiseaseWorkspaceProps {
  /** catalog slug, or a MONDO / ORPHA / OMIM identifier the API resolves */
  diseaseId: string;
}

/** Stage 1. What the disease is, which gene it points at, and what is recorded about it. */
export function DiseaseWorkspace({ diseaseId }: DiseaseWorkspaceProps) {
  const query = useDisease(diseaseId);
  const disease = query.data?.data;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selection = useWorkspaceSelection();
  const advanced = useAdvancedMode();
  const [details, setDetails] = useState(false);
  const full = advanced || details;

  const panel: Panel =
    searchParams.get("panel") === "literature" ? "literature" : "record";
  const phenotypeId = searchParams.get("hp");

  useSubjectBundle({ disease });
  useReportSources("disease-stage", query.data?.sources);

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    const next = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${next ? `?${next}` : ""}`,
    );
  }, []);

  const stageHref = useCallback(
    (path: string) => withSelection(path, selection),
    [selection],
  );

  const phenotypes = useMemo(() => disease?.phenotypes ?? [], [disease]);
  const groupOrder = useMemo(() => {
    const ranks = new Map<string, number>();
    for (const phenotype of phenotypes) {
      const group = frequencyGroup(phenotype);
      if (group !== COUNT_GROUP && group !== NO_FREQUENCY)
        ranks.set(group, frequencyRank(phenotype.frequency));
    }
    return [
      ...[...ranks.entries()]
        .sort((first, second) => second[1] - first[1])
        .map(([group]) => group),
      COUNT_GROUP,
      NO_FREQUENCY,
    ];
  }, [phenotypes]);
  const phenotype =
    phenotypes.find((entry) => entry.hpo_id === phenotypeId) ?? null;
  const byFrequency = useMemo(() => {
    const groupRank = (entry: Phenotype) =>
      groupOrder.indexOf(frequencyGroup(entry));
    return [...phenotypes].sort(
      (first, second) =>
        groupRank(first) - groupRank(second) ||
        frequencyRank(second.frequency) - frequencyRank(first.frequency),
    );
  }, [phenotypes, groupOrder]);

  const gene = disease?.gene ?? null;
  const notFound = isApiError(query.error) && query.error.isNotFound;

  const failure = query.isError ? (
    notFound ? (
      <EmptyState
        title={`No disease ${diseaseId} in the catalog`}
        description="The catalog holds the IUIS 2024 classification. Search by disease name, gene symbol or a MONDO, ORPHA or OMIM identifier."
        actions={
          <ButtonLink href={routes.explore()} size="sm">
            Open Explore
          </ButtonLink>
        }
      />
    ) : (
      <QueryErrorState
        error={query.error}
        subject={`disease ${diseaseId}`}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  ) : null;

  return (
    <>
      {disease ? (
        <SubjectBarActions>
          <AddToProjectButton
            size="sm"
            variant="ghost"
            item={{
              kind: "disease",
              ref: disease.id,
              label: disease.name,
              origin: { route: pathname },
              evidence: disease.record_sources,
              data: {
                xrefs: disease.xrefs.map((xref) => xref.id),
                gene: gene?.symbol ?? null,
                inheritance: disease.inheritance.codes,
                category: disease.category?.name ?? null,
              },
            }}
          />
        </SubjectBarActions>
      ) : null}
      {!full && !disease ? (
        <WorkspaceZones
          layoutId="disease"
          instrument={
            <Zone zone="instrument" title="Disease">
              {failure ?? <RowsSkeleton rows={10} />}
            </Zone>
          }
        />
      ) : !full && disease ? (
        <WorkspaceZones
          layoutId="disease"
          ledgerLabel="Disease"
          inspectorLabel="Phenotype"
          ledger={
            <Zone zone="ledger" title="Disease">
              <DiseaseSummary
                disease={disease}
                phenotypes={byFrequency}
                selectedPhenotypeId={phenotype?.hpo_id ?? null}
                onSelectPhenotype={(row) =>
                  setParam("hp", row.hpo_id === phenotypeId ? null : row.hpo_id)
                }
                frequencyCell={frequencyCell}
                stageHref={stageHref}
                onOpenRecord={() => setDetails(true)}
              />
            </Zone>
          }
          instrument={
            disease.protein ? (
              <DiseaseStructure
                disease={disease}
                actions={
                  gene ? (
                    <ButtonLink
                      href={stageHref(routes.gene(gene.symbol))}
                      variant="default"
                      size="sm"
                      className="mr-1"
                    >
                      {gene.symbol} variants
                      <ArrowRightIcon data-icon="inline-end" />
                    </ButtonLink>
                  ) : null
                }
              />
            ) : (
              <Zone zone="instrument" title="Structure">
                <EmptyState
                  title={gene ? "No protein mapped" : "No gene named"}
                  description="Without a protein there is no structure to show."
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetails(true)}
                    >
                      Open the record
                    </Button>
                  }
                />
              </Zone>
            )
          }
          inspector={
            phenotype ? (
              <Zone
                zone="inspector"
                title={phenotype.label ?? phenotype.hpo_id}
              >
                <PhenotypeDetail
                  phenotype={phenotype}
                  onClear={() => setParam("hp", null)}
                />
              </Zone>
            ) : undefined
          }
        />
      ) : (
      <WorkspaceZones
        layoutId="disease"
        ledgerLabel="Phenotypes"
        inspectorLabel="Record"
        ledger={
          <Zone
            zone="ledger"
            title="Phenotypes"
            count={disease ? phenotypes.length : null}
            scroll={false}
            footer={
              <>
                <span>Frequency as each source reports it</span>
                <KeyHint keys="enter" label="Inspect" />
              </>
            }
          >
            {failure ? (
              <EmptyState title="No phenotypes loaded" />
            ) : (
              <DataTable
                label={`Phenotypes of ${disease?.name ?? diseaseId}`}
                columns={PHENOTYPE_COLUMNS}
                data={phenotypes}
                loading={query.isPending}
                getRowId={(row) => row.hpo_id}
                selectedRowId={phenotype?.hpo_id ?? null}
                onRowSelect={(row) => {
                  setParam(
                    "hp",
                    row.hpo_id === phenotypeId ? null : row.hpo_id,
                  );
                  setParam("panel", null);
                }}
                defaultSort={{ id: "frequency", desc: true }}
                groupBy={frequencyGroup}
                groupOrder={groupOrder}
                empty={
                  <EmptyState
                    title="No annotated phenotypes"
                    description={
                      disease?.xrefs.length
                        ? "Neither source lists a phenotype for the mapped disorder."
                        : "Phenotypes are looked up by the mapped Orphanet or OMIM identifier, and this disease has none."
                    }
                    searched={[
                      "Orphadata phenotypes (product 4)",
                      "HPO annotations",
                    ]}
                  />
                }
              />
            )}
          </Zone>
        }
        instrument={
          <Zone
            zone="instrument"
            title="Disease"
            detail={
              disease?.category ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {disease.category.table !== null
                    ? `IUIS table ${disease.category.table} · `
                    : ""}
                  {disease.category.name}
                </span>
              ) : null
            }
            actions={
              <>
                {!advanced && details ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetails(false)}
                  >
                    Summary
                  </Button>
                ) : null}
                {gene ? (
                  <ButtonLink
                    href={stageHref(routes.gene(gene.symbol))}
                    variant="default"
                    size="sm"
                  >
                    {gene.symbol} gene and variants
                    <ArrowRightIcon data-icon="inline-end" />
                  </ButtonLink>
                ) : null}
              </>
            }
            footer={
              gene ? (
                <>
                  <KeyHint keys="]" label={`Next stage: ${gene.symbol} gene`} />
                  <span>Nodes in the diagram open their stage</span>
                </>
              ) : disease ? (
                <span>
                  No gene is assigned, so the later stages have nothing to open
                </span>
              ) : null
            }
          >
            {failure ??
              (disease ? (
                <DiseaseRecord disease={disease} stageHref={stageHref} />
              ) : (
                <RowsSkeleton rows={10} />
              ))}
          </Zone>
        }
        inspector={
          <Zone
            zone="inspector"
            title={
              panel === "literature"
                ? "Literature"
                : phenotype
                  ? (phenotype.label ?? phenotype.hpo_id)
                  : "Record"
            }
            scroll={panel !== "literature"}
            toolbar={
              <ToggleGroup
                aria-label="Inspector content"
                size="sm"
                variant="outline"
                spacing={0}
                value={[panel]}
                onValueChange={(value) =>
                  value.length
                    ? setParam(
                        "panel",
                        value[0] === "literature" ? "literature" : null,
                      )
                    : null
                }
              >
                <ToggleGroupItem value="record">Record</ToggleGroupItem>
                <ToggleGroupItem value="literature">Literature</ToggleGroupItem>
              </ToggleGroup>
            }
          >
            {failure ? (
              <EmptyState title="No record loaded" />
            ) : !disease ? (
              <RowsSkeleton rows={8} />
            ) : panel === "literature" ? (
              <LiteraturePanel
                context={{ disease: disease.id, gene: gene?.symbol }}
              />
            ) : (
              <RecordInspector
                disease={disease}
                phenotype={phenotype}
                onClearPhenotype={() => setParam("hp", null)}
              />
            )}
          </Zone>
        }
      />
      )}
    </>
  );
}
