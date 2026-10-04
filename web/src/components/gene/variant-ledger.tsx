"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListFilterIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "cn";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { KeyHint } from "@/components/data/key-hint";
import { ClinicalSignificanceChip } from "@/components/science/legends";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Zone } from "@/components/workspace";
import { apiDownloadUrl } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { parseClinicalSignificance } from "@/lib/science/clinical-significance";
import {
  GENE_WORDS,
  plainChangeKind,
  plainClinicalClass,
  plainHarmfulCount,
  plainMutationRow,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useGeneVariants, type GeneVariantFilters } from "@/lib/workspace-data";

export type VariantRow = Schema<"VariantSummary">;
type CountRow = Schema<"CountRow">;

const PAGE_SIZE = 200;
const DEFAULT_SIGNIFICANCE = ["pathogenic", "likely_pathogenic"];

const SIGNIFICANCE_OPTIONS: Array<[key: string, label: string]> = [
  ["pathogenic", "Pathogenic"],
  ["likely_pathogenic", "Likely pathogenic"],
  ["uncertain_significance", "Uncertain significance"],
  ["conflicting", "Conflicting classifications"],
  ["likely_benign", "Likely benign"],
  ["benign", "Benign"],
  ["other", "Other"],
  ["not_classified", "No ClinVar classification"],
];

const SIGNIFICANCE_CODE: Record<string, string> = {
  pathogenic: "P",
  likely_pathogenic: "LP",
  uncertain_significance: "VUS",
  conflicting: "CONF",
  likely_benign: "LB",
  benign: "B",
  other: "Other",
  not_classified: "None",
};

const SORT_OPTIONS: Array<
  [value: NonNullable<GeneVariantFilters["sort"]>, label: string]
> = [
  ["position", "Protein position"],
  ["stars", "Review stars"],
  ["last_evaluated", "Last evaluated"],
];

export const consequenceLabel = (term: string | null | undefined) =>
  term ? term.replace(/_variant$/, "").replace(/_/g, " ") : null;

export interface LedgerFilters {
  /** ClinVar significance keys; empty means every class */
  significance: string[];
  consequence: string[];
  minStars: number;
  q: string;
  sort: NonNullable<GeneVariantFilters["sort"]>;
  page: number;
}

const INITIAL_FILTERS: LedgerFilters = {
  significance: DEFAULT_SIGNIFICANCE,
  consequence: [],
  minStars: 0,
  q: "",
  sort: "position",
  page: 0,
};

const apiFilters = (filters: LedgerFilters): GeneVariantFilters => ({
  significance:
    filters.significance.length > 0 ? filters.significance : ["all"],
  consequence: filters.consequence,
  minStars: filters.minStars > 0 ? filters.minStars : undefined,
  q: filters.q || undefined,
  sort: filters.sort,
});

/** Filter state and the variant query of the gene stage, owned by the page so the inspector can read the rows. */
export function useVariantLedger(symbol: string) {
  const [filters, setFilters] = useState<LedgerFilters>(INITIAL_FILTERS);
  const query = useGeneVariants(symbol, {
    ...apiFilters(filters),
    limit: PAGE_SIZE,
    offset: filters.page * PAGE_SIZE,
  });
  const update = (patch: Partial<LedgerFilters>) =>
    setFilters((current) => ({ ...current, page: 0, ...patch }));
  return {
    symbol,
    filters,
    update,
    reset: () => setFilters(INITIAL_FILTERS),
    query,
    rows: query.data?.data.items ?? EMPTY_ROWS,
  };
}

const EMPTY_ROWS: VariantRow[] = [];

export type VariantLedgerState = ReturnType<typeof useVariantLedger>;

const COLUMNS: DataTableColumn<VariantRow>[] = [
  {
    id: "change",
    header: "Change",
    width: "minmax(5.5rem,1fr)",
    sortable: false,
    cell: (row) =>
      row.protein_change ? (
        <span className="font-mono">{row.protein_change}</span>
      ) : (
        <span className="font-mono text-muted-foreground">
          {row.hgvs.c?.split(":").pop() ?? row.name ?? row.id}
        </span>
      ),
  },
  {
    id: "position",
    header: "Pos.",
    align: "right",
    width: 54,
    sortable: false,
    cell: (row) =>
      row.position ?? <span className="text-subtle-foreground">-</span>,
  },
  {
    id: "class",
    header: "ClinVar",
    width: 96,
    sortable: false,
    cell: (row) => {
      const significance = parseClinicalSignificance(row.clinical_significance);
      return significance ? (
        <ClinicalSignificanceChip
          significance={significance}
          reviewStars={row.review_stars}
        />
      ) : (
        <span className="text-2xs text-subtle-foreground">
          {row.in_uniprot ? "UniProt only" : "Not classified"}
        </span>
      );
    },
  },
  {
    id: "consequence",
    header: "Consequence",
    width: 116,
    sortable: false,
    cell: (row) => (
      <span className="text-muted-foreground">
        {consequenceLabel(row.consequence) ?? (
          <span className="text-subtle-foreground">Unknown</span>
        )}
      </span>
    ),
  },
];

/** Simple mode: the change, its class in words and one evidence mark. */
const SIMPLE_COLUMNS: DataTableColumn<VariantRow>[] = [
  {
    id: "change",
    header: GENE_WORDS.mutation,
    width: "minmax(5.5rem,1fr)",
    sortable: false,
    cell: (row) => (
      <span
        className="truncate"
        title={row.protein_change ?? row.name ?? row.id}
      >
        {row.protein_change
          ? plainMutationRow(row.protein_change)
          : plainChangeKind(row.consequence)}
      </span>
    ),
  },
  {
    id: "class",
    header: GENE_WORDS.classification,
    width: 158,
    sortable: false,
    cell: (row) => {
      const significance = parseClinicalSignificance(row.clinical_significance);
      return significance ? (
        <ClinicalSignificanceChip significance={significance} long />
      ) : (
        <span className="text-2xs text-subtle-foreground">
          {GENE_WORDS.notClassified}
        </span>
      );
    },
  },
];

function countFor(rows: CountRow[] | undefined, key: string): number | null {
  if (!rows) return null;
  return rows
    .filter((row) => row.keys.includes(key))
    .reduce((sum, row) => sum + row.count, 0);
}

function FilterTrigger({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1 font-normal", active && "border-border-strong")}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="max-w-24 truncate font-medium text-foreground">
            {value}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      }
    />
  );
}

function Count({ value }: { value: number | null }) {
  return value === null ? null : (
    <span className="tabular ml-auto pl-3 font-mono text-2xs text-subtle-foreground">
      {value}
    </span>
  );
}

const toggled = (list: string[], key: string) =>
  list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

const sameSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item) => right.includes(item));

export interface VariantLedgerProps {
  state: VariantLedgerState;
  selectedRowKey: string | null;
  onSelect: (row: VariantRow) => void;
  onActivate: (row: VariantRow) => void;
  onHover: (row: VariantRow | null) => void;
}

/** The variant table of a gene: ClinVar merged with UniProt natural variants, filtered by the API. */
export function VariantLedger({
  state,
  selectedRowKey,
  onSelect,
  onActivate,
  onHover,
}: VariantLedgerProps) {
  const { symbol, filters, update, reset, query, rows } = state;
  const data = query.data?.data;
  const summary = data?.summary;
  const [text, setText] = useState(filters.q);
  const advanced = useAdvancedMode();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilters = advanced || filtersOpen;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (text.trim() !== filters.q) update({ q: text.trim() });
    }, 250);
    return () => window.clearTimeout(handle);
    // only the typed text schedules a request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const consequences = useMemo(
    () =>
      (summary?.by_consequence ?? [])
        .filter((row) => row.keys[0] && row.keys[0] !== "Unknown")
        .slice(0, 14),
    [summary],
  );

  const significanceValue =
    filters.significance.length === 0
      ? "All"
      : advanced
        ? filters.significance
            .map((key) => SIGNIFICANCE_CODE[key] ?? key)
            .join(", ")
        : filters.significance.length === 1
          ? plainClinicalClass(filters.significance[0].replace(/_/g, " "))
          : `${filters.significance.length} chosen`;
  const filtered =
    !sameSet(filters.significance, DEFAULT_SIGNIFICANCE) ||
    filters.consequence.length > 0 ||
    filters.minStars > 0 ||
    filters.q !== "";

  const total = data?.total ?? null;
  const first = total ? filters.page * PAGE_SIZE + 1 : 0;
  const last = total ? Math.min(total, (filters.page + 1) * PAGE_SIZE) : 0;
  const csvUrl = apiDownloadUrl(
    `/genes/${encodeURIComponent(symbol)}/variants.csv`,
    {
      significance:
        filters.significance.length > 0 ? filters.significance : ["all"],
      consequence: filters.consequence,
      min_stars: filters.minStars > 0 ? filters.minStars : undefined,
      q: filters.q || undefined,
      sort: filters.sort,
    },
  );

  return (
    <Zone
      zone="ledger"
      title={advanced ? "Variants" : "Mutations"}
      count={advanced || filtered ? total : null}
      scroll={false}
      detail={
        !advanced ? (
          filtered ? (
            <span className="truncate text-xs text-muted-foreground">
              {GENE_WORDS.filtered}
            </span>
          ) : null
        ) : summary ? (
          <span
            className="truncate text-2xs text-muted-foreground"
            title={`${summary.clinvar_records} ClinVar records and ${summary.uniprot_only} variants listed only by UniProt. ${summary.with_protein_position} have a protein position.`}
          >
            of {summary.total}
          </span>
        ) : null
      }
      actions={
        advanced ? (
          <a
            href={csvUrl}
            download
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            title="Download the filtered variants as CSV, all pages"
          >
            <DownloadIcon data-icon="inline-start" />
            CSV
          </a>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={GENE_WORDS.filter}
            aria-pressed={filtersOpen}
            title={GENE_WORDS.filter}
            className={cn(filtersOpen && "bg-active")}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ListFilterIcon />
          </Button>
        )
      }
      footer={
        !advanced && !(total !== null && total > PAGE_SIZE) ? undefined : (
          <>
            {advanced ? (
              <>
                <KeyHint keys="up" label="" />
                <KeyHint keys="down" label="Move" />
                <KeyHint keys="enter" label="Select, open" />
              </>
            ) : null}
            {total !== null && total > PAGE_SIZE ? (
              <span className="ml-auto flex items-center gap-1">
                <span className="tabular font-mono">
                  {advanced
                    ? `${first}-${last}`
                    : `${first}–${last} of ${total}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={GENE_WORDS.previous}
                  disabled={filters.page === 0}
                  onClick={() => update({ page: filters.page - 1 })}
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={GENE_WORDS.next}
                  disabled={!data?.has_more}
                  onClick={() => update({ page: filters.page + 1 })}
                >
                  <ChevronRightIcon />
                </Button>
              </span>
            ) : null}
          </>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {!advanced && !filtered && total !== null ? (
          <p className="shrink-0 border-b border-border-subtle px-3 py-3 text-sm font-medium text-foreground">
            {plainHarmfulCount(total, symbol)}
          </p>
        ) : null}
        <div
          hidden={!showFilters}
          className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle px-2 py-1.5 [&[hidden]]:hidden"
        >
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            />
            <Input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                advanced
                  ? "Protein change, HGVS, VCV, rsID or condition"
                  : GENE_WORDS.search
              }
              aria-label={`Filter variants of ${symbol} by text`}
              className="h-7 w-full pl-7 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <DropdownMenu>
              <FilterTrigger
                label={advanced ? "Class" : GENE_WORDS.classification}
                value={significanceValue}
                active={!sameSet(filters.significance, DEFAULT_SIGNIFICANCE)}
              />
              <DropdownMenuContent align="start" className="min-w-64">
                {SIGNIFICANCE_OPTIONS.map(([key, label]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={filters.significance.includes(key)}
                    closeOnClick={false}
                    onCheckedChange={() =>
                      update({
                        significance: toggled(filters.significance, key),
                      })
                    }
                  >
                    {label}
                    <Count value={countFor(summary?.by_significance, key)} />
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => update({ significance: [] })}>
                  {advanced ? "Every class" : "All mutations"}
                  <Count value={summary?.total ?? null} />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <FilterTrigger
                label={advanced ? "Consequence" : "Kind"}
                value={
                  filters.consequence.length === 0
                    ? "Any"
                    : filters.consequence.length === 1
                      ? advanced
                        ? (consequenceLabel(filters.consequence[0]) ?? "1")
                        : plainChangeKind(filters.consequence[0])
                      : String(filters.consequence.length)
                }
                active={filters.consequence.length > 0}
              />
              <DropdownMenuContent align="start" className="min-w-60">
                {consequences.map((row) => (
                  <DropdownMenuCheckboxItem
                    key={row.keys[0]}
                    checked={filters.consequence.includes(row.keys[0])}
                    closeOnClick={false}
                    onCheckedChange={() =>
                      update({
                        consequence: toggled(filters.consequence, row.keys[0]),
                      })
                    }
                  >
                    {advanced
                      ? consequenceLabel(row.keys[0])
                      : plainChangeKind(row.keys[0])}
                    <Count value={row.count} />
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <FilterTrigger
                label={advanced ? "Review" : "Checked"}
                value={
                  filters.minStars > 0
                    ? advanced
                      ? `${filters.minStars}/4 or more`
                      : `${filters.minStars} of 4 stars`
                    : "Any"
                }
                active={filters.minStars > 0}
              />
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuRadioGroup
                  value={String(filters.minStars)}
                  onValueChange={(value) => update({ minStars: Number(value) })}
                >
                  <DropdownMenuRadioItem value="0">
                    Any review status
                  </DropdownMenuRadioItem>
                  {[1, 2, 3, 4].map((stars) => (
                    <DropdownMenuRadioItem key={stars} value={String(stars)}>
                      {stars} of 4 stars or more
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <FilterTrigger
                label="Sort"
                value={
                  SORT_OPTIONS.find(([value]) => value === filters.sort)?.[1] ??
                  filters.sort
                }
                active={false}
              />
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuRadioGroup
                  value={filters.sort}
                  onValueChange={(value) =>
                    update({ sort: value as LedgerFilters["sort"] })
                  }
                >
                  {SORT_OPTIONS.map(([value, label]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText("");
                  reset();
                }}
              >
                Reset
              </Button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {query.isError ? (
            <QueryErrorState
              error={query.error}
              subject={`variants of ${symbol}`}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          ) : (
            <DataTable
              label={`Variants of ${symbol}`}
              columns={advanced ? COLUMNS : SIMPLE_COLUMNS}
              data={rows}
              getRowId={(row) => row.row_key}
              selectedRowId={selectedRowKey}
              onRowSelect={onSelect}
              onRowActivate={onActivate}
              onRowHover={onHover}
              loading={query.isPending}
              className={cn(query.isPlaceholderData && "opacity-60")}
              empty={
                <EmptyState
                  title={
                    advanced
                      ? "No variant matches these filters"
                      : GENE_WORDS.noMatch
                  }
                  description={
                    summary && advanced
                      ? `${summary.total} variants are recorded for ${symbol}; none passes the current class, consequence, review and text filters.`
                      : undefined
                  }
                  searched={["ClinVar", "UniProt natural variants"]}
                  actions={
                    filtered ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setText("");
                          reset();
                        }}
                      >
                        {advanced ? "Reset filters" : GENE_WORDS.reset}
                      </Button>
                    ) : null
                  }
                />
              }
            />
          )}
        </div>
      </div>
    </Zone>
  );
}
