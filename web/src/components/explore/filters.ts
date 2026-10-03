import type { Schema } from "@/lib/api/types";

export type ExploreGene = Schema<"ExploreGene">;

export type Availability = "yes" | "no" | "unknown";

export const SORT_KEYS = [
  "symbol",
  "name",
  "protein_length",
  "experimental_structures",
  "pathogenic_variants",
  "total_variants",
  "publications",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface ExploreFilters {
  q: string;
  category: string[];
  inheritance: string[];
  proteinFamily: string[];
  experimental: Availability | null;
  alphafold: Availability | null;
  variantsMin: number | null;
  variantsMax: number | null;
  publicationsMin: number | null;
  publicationsMax: number | null;
  sort: SortKey;
  order: "asc" | "desc";
}

export const EMPTY_FILTERS: ExploreFilters = {
  q: "",
  category: [],
  inheritance: [],
  proteinFamily: [],
  experimental: null,
  alphafold: null,
  variantsMin: null,
  variantsMax: null,
  publicationsMin: null,
  publicationsMax: null,
  sort: "symbol",
  order: "asc",
};

/** The protein_family value the API uses for genes with no family statement. */
export const NO_FAMILY = "unknown";

const availability = (value: string | null): Availability | null =>
  value === "yes" || value === "no" || value === "unknown" ? value : null;

const count = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
};

/** Parameter names follow GET /explore/genes where the API has the same filter. */
export function parseFilters(params: URLSearchParams): ExploreFilters {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    category: params.getAll("category"),
    inheritance: params.getAll("inheritance"),
    proteinFamily: params.getAll("protein_family"),
    experimental: availability(params.get("experimental")),
    alphafold: availability(params.get("alphafold")),
    variantsMin: count(params.get("variants_min")),
    variantsMax: count(params.get("variants_max")),
    publicationsMin: count(params.get("publications_min")),
    publicationsMax: count(params.get("publications_max")),
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "")
      ? (sort as SortKey)
      : "symbol",
    order: params.get("order") === "desc" ? "desc" : "asc",
  };
}

export function serializeFilters(filters: ExploreFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const value of filters.category) params.append("category", value);
  for (const value of filters.inheritance) params.append("inheritance", value);
  for (const value of filters.proteinFamily)
    params.append("protein_family", value);
  if (filters.experimental) params.set("experimental", filters.experimental);
  if (filters.alphafold) params.set("alphafold", filters.alphafold);
  const numbers: Array<[string, number | null]> = [
    ["variants_min", filters.variantsMin],
    ["variants_max", filters.variantsMax],
    ["publications_min", filters.publicationsMin],
    ["publications_max", filters.publicationsMax],
  ];
  for (const [name, value] of numbers)
    if (value !== null) params.set(name, String(value));
  if (filters.sort !== "symbol") params.set("sort", filters.sort);
  if (filters.order !== "asc") params.set("order", filters.order);
  return params.toString();
}

export const experimentalState = (gene: ExploreGene): Availability => {
  const value = gene.stats.experimental_structure_count;
  return value === null ? "unknown" : value > 0 ? "yes" : "no";
};

export const alphafoldState = (gene: ExploreGene): Availability => {
  const value = gene.stats.has_alphafold_model;
  return value === null ? "unknown" : value ? "yes" : "no";
};

/** A gene with no value for the statistic never matches an active range. */
const inRange = (
  value: number | null,
  min: number | null,
  max: number | null,
) => {
  if (min === null && max === null) return true;
  if (value === null) return false;
  return (min === null || value >= min) && (max === null || value <= max);
};

export type FacetKey =
  | "q"
  | "category"
  | "inheritance"
  | "proteinFamily"
  | "experimental"
  | "alphafold"
  | "variants"
  | "publications";

const PREDICATES: Record<
  FacetKey,
  (gene: ExploreGene, filters: ExploreFilters) => boolean
> = {
  q: (gene, filters) => {
    const needle = filters.q.trim().toLowerCase();
    if (!needle) return true;
    return [
      gene.symbol,
      gene.name,
      gene.protein_name,
      gene.uniprot_accession,
      ...gene.diseases.map((disease) => disease.name),
    ].some((text) => text?.toLowerCase().includes(needle));
  },
  category: (gene, filters) =>
    !filters.category.length ||
    gene.category_ids.some((id) => filters.category.includes(id)),
  inheritance: (gene, filters) =>
    !filters.inheritance.length ||
    gene.inheritance_codes.some((code) => filters.inheritance.includes(code)),
  proteinFamily: (gene, filters) =>
    !filters.proteinFamily.length ||
    filters.proteinFamily.includes(gene.protein_family ?? NO_FAMILY),
  experimental: (gene, filters) =>
    !filters.experimental || experimentalState(gene) === filters.experimental,
  alphafold: (gene, filters) =>
    !filters.alphafold || alphafoldState(gene) === filters.alphafold,
  variants: (gene, filters) =>
    inRange(
      gene.stats.clinvar_pathogenic_count,
      filters.variantsMin,
      filters.variantsMax,
    ),
  publications: (gene, filters) =>
    inRange(
      gene.stats.publication_count,
      filters.publicationsMin,
      filters.publicationsMax,
    ),
};

const FACET_KEYS = Object.keys(PREDICATES) as FacetKey[];

/** Genes passing every filter, optionally leaving one out (for that facet's own counts). */
export function applyFilters(
  genes: ExploreGene[],
  filters: ExploreFilters,
  except?: FacetKey,
): ExploreGene[] {
  const active = FACET_KEYS.filter((key) => key !== except);
  return genes.filter((gene) =>
    active.every((key) => PREDICATES[key](gene, filters)),
  );
}

function tally(
  genes: ExploreGene[],
  values: (gene: ExploreGene) => string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gene of genes)
    for (const value of new Set(values(gene)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export interface FacetCounts {
  category: Map<string, number>;
  inheritance: Map<string, number>;
  proteinFamily: Map<string, number>;
  experimental: Map<string, number>;
  alphafold: Map<string, number>;
}

/** Each facet is counted with every other active filter applied, as the API does. */
export function countFacets(
  genes: ExploreGene[],
  filters: ExploreFilters,
): FacetCounts {
  return {
    category: tally(
      applyFilters(genes, filters, "category"),
      (gene) => gene.category_ids,
    ),
    inheritance: tally(
      applyFilters(genes, filters, "inheritance"),
      (gene) => gene.inheritance_codes,
    ),
    proteinFamily: tally(
      applyFilters(genes, filters, "proteinFamily"),
      (gene) => [gene.protein_family ?? NO_FAMILY],
    ),
    experimental: tally(
      applyFilters(genes, filters, "experimental"),
      (gene) => [experimentalState(gene)],
    ),
    alphafold: tally(applyFilters(genes, filters, "alphafold"), (gene) => [
      alphafoldState(gene),
    ]),
  };
}

export interface QuickView {
  id: string;
  label: string;
  /** exactly what the view selects, in source terms */
  measures: string;
  patch: Partial<ExploreFilters>;
}

/** Views select on a single source-native statistic. None of them orders genes by promise. */
export const QUICK_VIEWS: QuickView[] = [
  {
    id: "no-experimental",
    label: "No experimental structure",
    measures: "Zero PDB entries mapped to the UniProt accession in PDBe SIFTS.",
    patch: { experimental: "no" },
  },
  {
    id: "model-only",
    label: "AlphaFold DB model only",
    measures:
      "Zero PDB entries in PDBe SIFTS and a model for the canonical accession in AlphaFold DB.",
    patch: { experimental: "no", alphafold: "yes" },
  },
  {
    id: "no-structure",
    label: "No PDB entry, no AlphaFold DB model",
    measures:
      "Zero PDB entries in PDBe SIFTS and no AlphaFold DB model for the canonical accession.",
    patch: { experimental: "no", alphafold: "no" },
  },
  {
    id: "few-publications",
    label: "10 or fewer linked publications",
    measures:
      "At most 10 Europe PMC records linked to the UniProtKB entry. Not a count of every paper that mentions the gene.",
    patch: { publicationsMax: 10, sort: "publications", order: "asc" },
  },
  {
    id: "few-variants",
    label: "20 or fewer ClinVar P/LP records",
    measures:
      "At most 20 ClinVar records classified pathogenic or likely pathogenic, including multi-gene copy-number variants.",
    patch: { variantsMax: 20, sort: "pathogenic_variants", order: "asc" },
  },
  {
    id: "no-family",
    label: "No protein family stated",
    measures:
      'UniProt gives no "Belongs to the ..." statement for the protein.',
    patch: { proteinFamily: [NO_FAMILY] },
  },
];

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export const quickViewActive = (view: QuickView, filters: ExploreFilters) =>
  (Object.keys(view.patch) as Array<keyof ExploreFilters>).every((key) =>
    same(filters[key], view.patch[key]),
  );

/** Turning a view off returns the fields it set to their defaults. */
export function toggleQuickView(
  view: QuickView,
  filters: ExploreFilters,
): ExploreFilters {
  if (!quickViewActive(view, filters)) return { ...filters, ...view.patch };
  const reset = Object.fromEntries(
    (Object.keys(view.patch) as Array<keyof ExploreFilters>).map((key) => [
      key,
      EMPTY_FILTERS[key],
    ]),
  );
  return { ...filters, ...reset };
}

export const hasActiveFilters = (filters: ExploreFilters) =>
  serializeFilters({ ...filters, sort: "symbol", order: "asc" }) !== "";
