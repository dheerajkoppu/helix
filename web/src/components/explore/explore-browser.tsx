"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "cn";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { Unknown } from "@/components/data/definition-list";
import { Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest } from "@/lib/api/client";
import { apiQueryKey } from "@/lib/api/query";
import type { ApiResult, Schema } from "@/lib/api/types";
import { formatCount, formatDate } from "@/lib/format";
import { routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useReportSources } from "@/lib/state/shell";

import {
  applyFilters,
  countFacets,
  EMPTY_FILTERS,
  hasActiveFilters,
  NO_FAMILY,
  parseFilters,
  QUICK_VIEWS,
  quickViewActive,
  serializeFilters,
  toggleQuickView,
  type Availability,
  type ExploreFilters,
  type ExploreGene,
} from "./filters";

type ExploreGenesResponse = Schema<"ExploreGenesResponse">;
type FacetValue = Schema<"FacetValue">;

const PAGE_SIZE = 500;

/** The whole gene set, read page by page until the API reports no more. */
async function fetchAllGenes(
  signal: AbortSignal,
): Promise<ApiResult<ExploreGenesResponse>> {
  let result = await apiRequest<ExploreGenesResponse>("/explore/genes", {
    query: { limit: PAGE_SIZE, offset: 0 },
    signal,
  });
  const items = [...result.data.items];
  while (result.data.has_more) {
    result = await apiRequest<ExploreGenesResponse>("/explore/genes", {
      query: { limit: PAGE_SIZE, offset: items.length },
      signal,
    });
    items.push(...result.data.items);
  }
  return { ...result, data: { ...result.data, items, offset: 0 } };
}

const MEASURES = {
  structures:
    "Distinct PDB entries mapped to the UniProt accession in PDBe SIFTS.",
  alphafold:
    "AlphaFold DB has a predicted model for the canonical accession. Proteins longer than 2,700 residues have none.",
  pathogenic:
    "ClinVar records for the gene classified pathogenic or likely pathogenic. Includes multi-gene copy-number variants.",
  total:
    "All ClinVar records for the gene. Includes multi-gene copy-number variants.",
  publications:
    "Europe PMC records linked to the UniProtKB entry. Not a count of every paper that mentions the gene.",
} as const;

const chipClass = (pressed: boolean) =>
  cn(
    "inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-xs whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
    pressed
      ? "border-foreground bg-active font-medium text-foreground"
      : "border-border-strong text-muted-foreground hover:bg-accent hover:text-foreground",
  );

function Chip({
  pressed,
  count,
  children,
  ...props
}: {
  pressed: boolean;
  count?: number;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={chipClass(pressed)}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span className="tabular font-mono text-2xs text-subtle-foreground">
          {formatCount(count)}
        </span>
      ) : null}
    </button>
  );
}

function FilterGroup({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span
        title={title}
        className={cn(
          "text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase",
          title && "cursor-help underline decoration-dotted underline-offset-2",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const AVAILABILITY_LABELS: Array<[Availability, string]> = [
  ["yes", "Has"],
  ["no", "None"],
  ["unknown", "Unknown"],
];

function AvailabilityFilter({
  label,
  title,
  value,
  counts,
  onChange,
}: {
  label: string;
  title: string;
  value: Availability | null;
  counts: Map<string, number>;
  onChange: (value: Availability | null) => void;
}) {
  return (
    <FilterGroup label={label} title={title}>
      {AVAILABILITY_LABELS.map(([state, text]) => (
        <Chip
          key={state}
          pressed={value === state}
          count={counts.get(state) ?? 0}
          onClick={() => onChange(value === state ? null : state)}
        >
          {text}
        </Chip>
      ))}
    </FilterGroup>
  );
}

function RangeFilter({
  label,
  title,
  min,
  max,
  bounds,
  onChange,
}: {
  label: string;
  title: string;
  min: number | null;
  max: number | null;
  bounds?: { min: number | null; max: number | null };
  onChange: (min: number | null, max: number | null) => void;
}) {
  const parse = (text: string) =>
    /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  return (
    <FilterGroup label={label} title={title}>
      <Input
        inputMode="numeric"
        aria-label={`${label}, minimum`}
        placeholder={bounds?.min != null ? String(bounds.min) : "min"}
        value={min ?? ""}
        onChange={(event) => onChange(parse(event.target.value), max)}
        className="h-6 w-14 px-1.5 font-mono text-xs"
      />
      <span className="text-subtle-foreground">to</span>
      <Input
        inputMode="numeric"
        aria-label={`${label}, maximum`}
        placeholder={bounds?.max != null ? String(bounds.max) : "max"}
        value={max ?? ""}
        onChange={(event) => onChange(min, parse(event.target.value))}
        className="h-6 w-16 px-1.5 font-mono text-xs"
      />
    </FilterGroup>
  );
}

function FamilyFilter({
  options,
  counts,
  selected,
  onChange,
}: {
  options: FacetValue[];
  counts: Map<string, number>;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const visible = options
    .filter((option) => option.label.toLowerCase().includes(needle))
    .sort(
      (left, right) =>
        (counts.get(right.value) ?? 0) - (counts.get(left.value) ?? 0) ||
        left.label.localeCompare(right.label),
    );
  const label = (value: string) =>
    value === NO_FAMILY ? "None stated" : value;
  return (
    <FilterGroup
      label="Protein family"
      title={
        'Top level of UniProt\'s "Belongs to the ..." statement. "None stated" selects proteins without one.'
      }
    >
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "max-w-56 border-border-strong font-normal",
                selected.length && "border-foreground bg-active font-medium",
              )}
            />
          }
        >
          <span className="truncate">
            {selected.length === 0
              ? "Any"
              : selected.length === 1
                ? label(selected[0])
                : `${selected.length} families`}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-2">
          <Input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Filter families"
            aria-label="Filter protein families"
            className="h-7 text-xs"
          />
          <ul className="max-h-72 overflow-y-auto">
            {visible.map((option) => {
              const active = selected.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChange(
                        active
                          ? selected.filter((value) => value !== option.value)
                          : [...selected, option.value],
                      )
                    }
                    className={cn(
                      "flex w-full items-baseline justify-between gap-3 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-accent",
                      active && "bg-active font-medium",
                    )}
                  >
                    <span className="truncate">{label(option.value)}</span>
                    <span className="tabular font-mono text-2xs text-subtle-foreground">
                      {formatCount(counts.get(option.value) ?? 0)}
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="px-1.5 py-1 text-subtle-foreground">
                No family matches
              </li>
            ) : null}
          </ul>
          {selected.length ? (
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear families
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </FilterGroup>
  );
}

const statCell = (value: number | null) =>
  value === null ? <Unknown /> : formatCount(value);

function columnsFor(
  tableOf: Map<string, number | null>,
): DataTableColumn<ExploreGene>[] {
  return [
    {
      id: "symbol",
      header: "Gene",
      width: 84,
      mono: true,
      accessor: (gene) => gene.symbol,
      cell: (gene) => (
        <Link
          href={routes.gene(gene.symbol)}
          className="font-medium text-foreground underline-offset-2 hover:underline"
          translate="no"
        >
          {gene.symbol}
        </Link>
      ),
    },
    {
      id: "name",
      header: "Protein",
      width: "minmax(9rem,1.2fr)",
      accessor: (gene) => gene.protein_name,
      cell: (gene) =>
        gene.protein_name ? (
          <span title={gene.protein_name}>{gene.protein_name}</span>
        ) : (
          <Unknown reason="No protein product" />
        ),
    },
    {
      id: "diseases",
      header: "Diseases (IUIS)",
      width: "minmax(11rem,1.6fr)",
      accessor: (gene) => gene.diseases[0]?.name ?? null,
      cell: (gene) => {
        const [first, ...rest] = gene.diseases;
        if (!first) return <Unknown reason="No source found" />;
        return (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <Link
              href={routes.disease(first.id)}
              title={first.name}
              className="truncate underline-offset-2 hover:underline"
            >
              {first.name}
            </Link>
            {rest.length ? (
              <span
                title={rest.map((disease) => disease.name).join("\n")}
                className="tabular shrink-0 font-mono text-2xs text-subtle-foreground"
              >
                +{rest.length}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "table",
      header: <span title="Table of the IUIS classification">Tbl</span>,
      width: 60,
      mono: true,
      accessor: (gene) =>
        gene.category_ids
          .map((id) => tableOf.get(id))
          .filter((table) => table !== null && table !== undefined)
          .join(", "),
    },
    {
      id: "inheritance",
      header: "Inherit.",
      width: 84,
      mono: true,
      accessor: (gene) => gene.inheritance_codes.join(", "),
      cell: (gene) =>
        gene.inheritance_codes.length ? (
          gene.inheritance_codes.join(", ")
        ) : (
          <Unknown reason="Not stated" />
        ),
    },
    {
      id: "family",
      header: "Protein family",
      width: "minmax(8rem,1fr)",
      accessor: (gene) => gene.protein_family,
      cell: (gene) =>
        gene.protein_family ? (
          <span title={gene.protein_family}>{gene.protein_family}</span>
        ) : (
          <Unknown reason="None stated" />
        ),
    },
    {
      id: "protein_length",
      header: (
        <span title="Residues in the UniProt canonical sequence">aa</span>
      ),
      width: 56,
      align: "right",
      accessor: (gene) => gene.protein_length,
      cell: (gene) => statCell(gene.protein_length),
    },
    {
      id: "experimental_structures",
      header: <span title={MEASURES.structures}>PDB</span>,
      width: 68,
      align: "right",
      accessor: (gene) => gene.stats.experimental_structure_count,
      cell: (gene) => statCell(gene.stats.experimental_structure_count),
    },
    {
      id: "alphafold",
      header: <span title={MEASURES.alphafold}>AFDB</span>,
      width: 64,
      accessor: (gene) =>
        gene.stats.has_alphafold_model === null
          ? null
          : gene.stats.has_alphafold_model
            ? "Yes"
            : "None",
    },
    {
      id: "pathogenic_variants",
      header: <span title={MEASURES.pathogenic}>CV P/LP</span>,
      width: 84,
      align: "right",
      accessor: (gene) => gene.stats.clinvar_pathogenic_count,
      cell: (gene) => statCell(gene.stats.clinvar_pathogenic_count),
    },
    {
      id: "total_variants",
      header: <span title={MEASURES.total}>CV all</span>,
      width: 76,
      align: "right",
      accessor: (gene) => gene.stats.clinvar_total_count,
      cell: (gene) => statCell(gene.stats.clinvar_total_count),
    },
    {
      id: "publications",
      header: <span title={MEASURES.publications}>Pubs</span>,
      width: 64,
      align: "right",
      accessor: (gene) => gene.stats.publication_count,
      cell: (gene) => statCell(gene.stats.publication_count),
    },
  ];
}

const SIMPLE_COLUMNS = [
  "symbol",
  "name",
  "diseases",
  "inheritance",
  "experimental_structures",
  "alphafold",
  "pathogenic_variants",
];

function GeneDetail({
  gene,
  categoryLabel,
}: {
  gene: ExploreGene;
  categoryLabel: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-sunken px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={routes.gene(gene.symbol)}
          className="font-mono text-sm font-semibold underline-offset-2 hover:underline"
          translate="no"
        >
          {gene.symbol}
        </Link>
        <span className="text-muted-foreground">
          {gene.protein_name ?? gene.name ?? <Unknown />}
        </span>
        {gene.uniprot_accession ? (
          <Link
            href={routes.protein(gene.uniprot_accession)}
            className="font-mono text-muted-foreground underline-offset-2 hover:underline"
          >
            {gene.uniprot_accession}
          </Link>
        ) : null}
        <Link
          href={routes.gene(gene.symbol)}
          className="ml-auto font-medium underline underline-offset-2"
        >
          Open gene workspace
        </Link>
      </div>
      <ul className="flex flex-col gap-0.5">
        {gene.diseases.map((disease) => (
          <li
            key={disease.id}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <Link
              href={routes.disease(disease.id)}
              className="underline-offset-2 hover:underline"
            >
              {disease.name}
            </Link>
            <span className="font-mono text-2xs text-muted-foreground">
              {disease.inheritance_codes.join(", ") || "inheritance not stated"}
            </span>
            <span className="text-2xs text-subtle-foreground">
              {categoryLabel.get(disease.category_id ?? "") ?? ""}
              {disease.is_phenocopy ? " (phenocopy)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Browser of the seeded IEI gene set. Filters live in the URL; filtering runs on the loaded set. */
export function ExploreBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ExploreFilters>(() =>
    parseFilters(new URLSearchParams(searchParams.toString())),
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const advanced = useAdvancedMode();
  // Filters arriving in the URL open the panel so they are never applied out of sight
  const [filtersOpen, setFiltersOpen] = useState(() =>
    hasActiveFilters({ ...filters, q: "" }),
  );
  const showFilters = advanced || filtersOpen;

  const serialized = serializeFilters(filters);
  useEffect(() => {
    const target = `${window.location.pathname}${serialized ? `?${serialized}` : ""}`;
    if (target !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, "", target);
  }, [serialized]);

  const genes = useQuery({
    queryKey: apiQueryKey("/explore/genes", { all: true }),
    queryFn: ({ signal }) => fetchAllGenes(signal),
  });
  useReportSources("explore", genes.data?.sources);

  const page = genes.data?.data;
  const allGenes = useMemo(() => page?.items ?? [], [page]);
  const facets = page?.facets;

  const rows = useMemo(
    () => applyFilters(allGenes, filters),
    [allGenes, filters],
  );
  const counts = useMemo(
    () => countFacets(allGenes, filters),
    [allGenes, filters],
  );
  const viewCounts = useMemo(
    () =>
      new Map(
        QUICK_VIEWS.map((view) => [
          view.id,
          applyFilters(allGenes, { ...EMPTY_FILTERS, ...view.patch }).length,
        ]),
      ),
    [allGenes],
  );
  const columns = useMemo(() => {
    const all = columnsFor(
      new Map(
        (facets?.category ?? []).map((category) => [
          category.value,
          category.table,
        ]),
      ),
    );
    return advanced
      ? all
      : all.filter((column) => SIMPLE_COLUMNS.includes(column.id));
  }, [facets, advanced]);
  const categoryLabel = useMemo(
    () =>
      new Map(
        (facets?.category ?? []).map((category) => [
          category.value,
          category.label,
        ]),
      ),
    [facets],
  );

  const update = (patch: Partial<ExploreFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const toggleIn = (key: "category" | "inheritance", value: string) =>
    setFilters((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));

  if (genes.isError) {
    return (
      <Plate className="h-[min(28rem,60dvh)]">
        <QueryErrorState
          error={genes.error}
          subject="the gene set"
          onRetry={() => genes.refetch()}
          retrying={genes.isFetching}
        />
      </Plate>
    );
  }

  const selected = rows.find((gene) => gene.symbol === selectedSymbol) ?? null;
  const retrieved = formatDate(allGenes[0]?.stats.retrieved_at);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full sm:w-auto">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            type="search"
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder="Gene, protein, accession or disease"
            aria-label="Filter by gene symbol, protein name, UniProt accession or disease name"
            className="h-7 w-full pl-7 text-xs sm:w-64"
          />
        </div>
        {advanced ? null : (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
          </Button>
        )}
        <span className="tabular font-mono text-xs text-muted-foreground">
          {page
            ? rows.length === allGenes.length
              ? `${formatCount(rows.length)} genes`
              : `${formatCount(rows.length)} of ${formatCount(allGenes.length)} genes`
            : null}
        </span>
        {hasActiveFilters(filters) ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            <XIcon data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <>
      <div
        role="group"
        aria-label="IUIS classification table"
        className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-5"
      >
        {(facets?.category ?? []).map((category) => {
          const pressed = filters.category.includes(category.value);
          return (
            <button
              key={category.value}
              type="button"
              aria-pressed={pressed}
              title={category.label}
              onClick={() => toggleIn("category", category.value)}
              className={cn(
                "flex min-w-0 items-baseline gap-2 border-r border-b border-border px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
                pressed
                  ? "bg-active font-medium text-foreground shadow-[inset_2px_0_0_var(--foreground)]"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="shrink-0 font-mono text-2xs text-subtle-foreground">
                T{category.table}
              </span>
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <span className="tabular shrink-0 font-mono text-2xs">
                {formatCount(counts.category.get(category.value) ?? 0)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <FilterGroup
          label="Inheritance"
          title="Inheritance codes stated by IUIS for the gene's diseases."
        >
          {(facets?.inheritance ?? []).map((option) => (
            <Chip
              key={option.value}
              pressed={filters.inheritance.includes(option.value)}
              count={counts.inheritance.get(option.value) ?? 0}
              onClick={() => toggleIn("inheritance", option.value)}
            >
              <span className="font-mono">{option.label}</span>
            </Chip>
          ))}
        </FilterGroup>
        <FamilyFilter
          options={facets?.protein_family ?? []}
          counts={counts.proteinFamily}
          selected={filters.proteinFamily}
          onChange={(proteinFamily) => update({ proteinFamily })}
        />
        <AvailabilityFilter
          label="Experimental structure"
          title={MEASURES.structures}
          value={filters.experimental}
          counts={counts.experimental}
          onChange={(experimental) => update({ experimental })}
        />
        <AvailabilityFilter
          label="AlphaFold DB model"
          title={MEASURES.alphafold}
          value={filters.alphafold}
          counts={counts.alphafold}
          onChange={(alphafold) => update({ alphafold })}
        />
        <RangeFilter
          label="ClinVar P/LP"
          title={`${MEASURES.pathogenic} Genes with no count never match a range.`}
          min={filters.variantsMin}
          max={filters.variantsMax}
          bounds={page?.ranges.pathogenic_variants}
          onChange={(variantsMin, variantsMax) =>
            update({ variantsMin, variantsMax })
          }
        />
        <RangeFilter
          label="UniProt pubs"
          title={`${MEASURES.publications} Genes with no count never match a range.`}
          min={filters.publicationsMin}
          max={filters.publicationsMax}
          bounds={page?.ranges.publications}
          onChange={(publicationsMin, publicationsMax) =>
            update({ publicationsMin, publicationsMax })
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border-subtle pt-2.5">
        <span
          className="cursor-help text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase underline decoration-dotted underline-offset-2"
          title="Each view selects on one source-native statistic. A low count describes what public databases hold; it is not a ranking."
        >
          Less-studied views
        </span>
        {QUICK_VIEWS.map((view) => (
          <Chip
            key={view.id}
            title={view.measures}
            pressed={quickViewActive(view, filters)}
            count={viewCounts.get(view.id)}
            onClick={() => setFilters(toggleQuickView(view, filters))}
          >
            {view.label}
          </Chip>
        ))}
      </div>

        </>
      ) : null}

      <div>
        <Plate>
          <div
            className={cn(
              "min-h-96 overflow-x-auto",
              showFilters
                ? "h-[calc(100dvh-24rem)]"
                : "h-[calc(100dvh-15rem)]",
            )}
          >
            <div
              className={cn(
                "h-full",
                advanced ? "min-w-[66rem]" : "min-w-[44rem]",
              )}
            >
              <DataTable
                key={`${filters.sort}-${filters.order}`}
                label="Genes of the IUIS classification of inborn errors of immunity"
                columns={columns}
                data={rows}
                getRowId={(gene) => gene.symbol}
                selectedRowId={selected?.symbol ?? null}
                onRowSelect={(gene) => setSelectedSymbol(gene.symbol)}
                onRowActivate={(gene) => router.push(routes.gene(gene.symbol))}
                defaultSort={{
                  id: filters.sort,
                  desc: filters.order === "desc",
                }}
                loading={genes.isPending}
                empty={
                  page && page.catalog_state !== "ready" ? (
                    <EmptyState
                      title="No genes in the seeded dataset"
                      description={`The catalog is ${page.catalog_state}. Build it with make seed.`}
                    />
                  ) : (
                    <EmptyState
                      title="No gene matches these filters"
                      actions={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFilters(EMPTY_FILTERS)}
                        >
                          Clear filters
                        </Button>
                      }
                    />
                  )
                }
              />
            </div>
          </div>
          {selected ? (
            <GeneDetail gene={selected} categoryLabel={categoryLabel} />
          ) : null}
        </Plate>
      </div>

      {advanced ? (
      <dl className="grid max-w-5xl gap-x-6 gap-y-1 text-2xs text-muted-foreground sm:grid-cols-2">
        {(
          [
            ["PDB", MEASURES.structures],
            ["AFDB", MEASURES.alphafold],
            ["CV P/LP", MEASURES.pathogenic],
            ["CV all", MEASURES.total],
            ["Pubs", MEASURES.publications],
            [
              "Unknown",
              `The source returned no value. It never stands in for zero.${retrieved ? ` Counts retrieved ${retrieved}.` : ""}`,
            ],
          ] as const
        ).map(([term, text]) => (
          <div key={term} className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-foreground">
              {term}
            </dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      ) : null}
    </div>
  );
}
