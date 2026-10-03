"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { Unknown } from "@/components/data/definition-list";
import { Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState } from "@/components/states/query-state";
import { apiRequest } from "@/lib/api/client";
import { apiQueryKey } from "@/lib/api/query";
import type { ApiResult, Schema } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { routes } from "@/lib/ids";
import { useReportSources } from "@/lib/state/shell";

type ExploreGene = Schema<"ExploreGene">;
type ExplorePage = Schema<"ExploreGenesResponse">;

const PAGE_SIZE = 500;

/** The whole gene set, read page by page until the API reports no more. */
async function fetchAllGenes(
  signal: AbortSignal,
): Promise<ApiResult<ExplorePage>> {
  let result = await apiRequest<ExplorePage>("/explore/genes", {
    query: { limit: PAGE_SIZE, offset: 0 },
    signal,
  });
  const items = [...result.data.items];
  while (result.data.has_more) {
    result = await apiRequest<ExplorePage>("/explore/genes", {
      query: { limit: PAGE_SIZE, offset: items.length },
      signal,
    });
    items.push(...result.data.items);
  }
  return { ...result, data: { ...result.data, items, offset: 0 } };
}

const count = (value: number | null) =>
  value === null ? <Unknown /> : formatCount(value);

function columnsFor(
  tableOf: Map<string, number | null>,
): DataTableColumn<ExploreGene>[] {
  return [
    {
      id: "symbol",
      header: "Gene",
      width: 104,
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
      id: "protein",
      header: "Protein",
      width: "minmax(12rem,2fr)",
      accessor: (gene) => gene.protein_name,
      cell: (gene) =>
        gene.protein_name ? (
          <span title={gene.protein_name}>{gene.protein_name}</span>
        ) : (
          <Unknown reason="No protein product" />
        ),
    },
    {
      id: "accession",
      header: "UniProt",
      width: 88,
      mono: true,
      accessor: (gene) => gene.uniprot_accession,
    },
    {
      id: "table",
      header: <span title="Table of the IUIS classification">Table</span>,
      width: 72,
      mono: true,
      accessor: (gene) =>
        gene.category_ids
          .map((id) => tableOf.get(id))
          .filter((table) => table !== null && table !== undefined)
          .join(", "),
    },
    {
      id: "inheritance",
      header: "Inheritance",
      width: 108,
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
      id: "structures",
      header: (
        <span title="PDB entries mapped to the protein (PDBe SIFTS)">
          PDB entries
        </span>
      ),
      width: 116,
      align: "right",
      accessor: (gene) => gene.stats.experimental_structure_count,
      cell: (gene) => count(gene.stats.experimental_structure_count),
    },
    {
      id: "alphafold",
      header: (
        <span title="A model for the canonical sequence exists in AlphaFold DB">
          AFDB model
        </span>
      ),
      width: 112,
      accessor: (gene) =>
        gene.stats.has_alphafold_model === null
          ? null
          : gene.stats.has_alphafold_model
            ? "Yes"
            : "None",
    },
    {
      id: "pathogenic",
      header: (
        <span title="ClinVar records classified pathogenic or likely pathogenic, including multi-gene copy-number variants">
          ClinVar P/LP
        </span>
      ),
      width: 124,
      align: "right",
      accessor: (gene) => gene.stats.clinvar_pathogenic_count,
      cell: (gene) => count(gene.stats.clinvar_pathogenic_count),
    },
    {
      id: "publications",
      header: (
        <span title="Publications linked to the UniProtKB entry (Europe PMC), not all literature on the gene">
          UniProt pubs
        </span>
      ),
      width: 124,
      align: "right",
      accessor: (gene) => gene.stats.publication_count,
      cell: (gene) => count(gene.stats.publication_count),
    },
  ];
}

/** The seeded gene set as one sortable table, read from GET /explore/genes. */
export function ExploreGenes() {
  const router = useRouter();
  const genes = useQuery({
    queryKey: apiQueryKey("/explore/genes", { all: true }),
    queryFn: ({ signal }) => fetchAllGenes(signal),
  });
  useReportSources("explore", genes.data?.sources);

  const columns = useMemo(
    () =>
      columnsFor(
        new Map(
          (genes.data?.data.facets.category ?? []).map((category) => [
            category.value,
            category.table,
          ]),
        ),
      ),
    [genes.data],
  );

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

  const page = genes.data?.data;
  return (
    <>
      <p className="mb-2 flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Genes</span>
        <span className="tabular font-mono">
          {page ? formatCount(page.total) : null}
        </span>
      </p>
      <Plate className="h-[calc(100dvh-17rem)] min-h-80 overflow-x-auto">
        <div className="h-full min-w-[60rem]">
          <DataTable
            label="Genes of the IUIS classification of inborn errors of immunity"
            columns={columns}
            data={page?.items ?? []}
            getRowId={(gene) => gene.symbol}
            onRowActivate={(gene) => router.push(routes.gene(gene.symbol))}
            defaultSort={{ id: "symbol" }}
            loading={genes.isPending}
            empty={
              <EmptyState
                title="No genes in the seeded dataset"
                description={
                  page && page.catalog_state !== "ready"
                    ? `The catalog is ${page.catalog_state}. Build it with make seed.`
                    : "The API returned an empty gene set."
                }
              />
            }
          />
        </div>
      </Plate>
    </>
  );
}
