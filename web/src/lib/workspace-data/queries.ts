"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { QueryParams } from "@/lib/api/client";
import { apiQuery } from "@/lib/api/query";
import type { Schema } from "@/lib/api/types";

export type GeneResponse = Schema<"GeneResponse">;
export type ProteinResponse = Schema<"ProteinResponse">;
export type ResidueResponse = Schema<"ResidueResponse">;
export type GeneVariantsResponse = Schema<"GeneVariantsResponse">;
export type AxisVariantsResponse = Schema<"AxisVariantsResponse">;
export type VariantDetail = Schema<"VariantDetail">;
export type ResidueEffectsResponse = Schema<"ResidueEffectsResponse">;
export type EffectMapResponse = Schema<"EffectMapResponse">;
export type StructureLedger = Schema<"StructureLedger">;
export type ApiStructureDescriptor = Schema<"StructureDescriptor">;
export type StructureConfidence = Schema<"StructureConfidence">;
export type ApiResidueMap = Schema<"ResidueMap">;
export type StructureLigands = Schema<"StructureLigands">;
export type DiseaseResponse = Schema<"DiseaseResponse">;
export type InteractionsResponse = Schema<"InteractionsResponse">;
export type PathwaysResponse = Schema<"PathwaysResponse">;
export type TreatmentsResponse = Schema<"TreatmentsResponse">;
export type ProteinCompoundsResponse = Schema<"ProteinCompoundsResponse">;
export type CompoundDetailResponse = Schema<"CompoundDetailResponse">;
export type PocketsResponse = Schema<"PocketsResponse">;
export type ComparePlanResponse = Schema<"ComparePlanResponse">;
export type CompareResultResponse = Schema<"CompareResultResponse">;

type Id = string | null | undefined;

const segment = (value: Id) => encodeURIComponent(value ?? "");

/** Upstream records change with database releases, not within a session. */
const SLOW_CHANGING = { staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000 };

export interface GeneVariantFilters {
  /** significance keys, or "all"; the API default is pathogenic and likely pathogenic */
  significance?: string[];
  consequence?: string[];
  minStars?: number;
  residueStart?: number;
  residueEnd?: number;
  q?: string;
  sort?: "position" | "stars" | "last_evaluated";
  limit?: number;
  offset?: number;
}

const variantFilterParams = (filters: GeneVariantFilters): QueryParams => ({
  significance: filters.significance,
  consequence: filters.consequence,
  min_stars: filters.minStars,
  residue_start: filters.residueStart,
  residue_end: filters.residueEnd,
  q: filters.q,
  sort: filters.sort,
  limit: filters.limit,
  offset: filters.offset,
});

/** Query options for every workspace endpoint, for `useQuery`, `prefetchQuery` and invalidation. */
export const workspaceQueries = {
  gene: (symbol: string) => apiQuery<GeneResponse>(`/genes/${segment(symbol)}`),
  protein: (accession: string) =>
    apiQuery<ProteinResponse>(`/proteins/${segment(accession)}`),
  residue: (accession: string, position: number) =>
    apiQuery<ResidueResponse>(
      `/proteins/${segment(accession)}/residues/${position}`,
    ),
  geneVariants: (symbol: string, filters: GeneVariantFilters = {}) =>
    apiQuery<GeneVariantsResponse>(
      `/genes/${segment(symbol)}/variants`,
      variantFilterParams(filters),
    ),
  axisVariants: (symbol: string) =>
    apiQuery<AxisVariantsResponse>(`/genes/${segment(symbol)}/axis-variants`),
  variant: (variantId: string) =>
    apiQuery<VariantDetail>(`/variants/${segment(variantId)}`),
  residueEffects: (
    accession: string,
    position: number,
    change: { alt?: string | null; ref?: string | null } = {},
  ) =>
    apiQuery<ResidueEffectsResponse>(
      `/proteins/${segment(accession)}/residues/${position}/effects`,
      { alt: change.alt, ref: change.ref },
    ),
  effectMap: (accession: string, matrix = false) =>
    apiQuery<EffectMapResponse>(
      `/proteins/${segment(accession)}/effect-map`,
      matrix ? { matrix: true } : undefined,
    ),
  structureLedger: (accession: string, externalModels = true) =>
    apiQuery<StructureLedger>(
      `/proteins/${segment(accession)}/structures`,
      externalModels ? undefined : { external_models: false },
    ),
  structure: (structureId: string, accession?: Id) =>
    apiQuery<ApiStructureDescriptor>(`/structures/${segment(structureId)}`, {
      accession,
    }),
  structureConfidence: (structureId: string, pae = false) =>
    apiQuery<StructureConfidence>(
      `/structures/${segment(structureId)}/confidence`,
      { pae },
    ),
  structureResidueMap: (structureId: string, accession?: Id) =>
    apiQuery<ApiResidueMap>(`/structures/${segment(structureId)}/residue-map`, {
      accession,
    }),
  structureLigands: (structureId: string, accession?: Id) =>
    apiQuery<StructureLigands>(`/structures/${segment(structureId)}/ligands`, {
      accession,
    }),
  disease: (diseaseId: string) =>
    apiQuery<DiseaseResponse>(`/diseases/${segment(diseaseId)}`),
  interactions: (accession: string) =>
    apiQuery<InteractionsResponse>(
      `/proteins/${segment(accession)}/interactions`,
    ),
  pathways: (accession: string) =>
    apiQuery<PathwaysResponse>(`/proteins/${segment(accession)}/pathways`),
  treatments: (symbol: string) =>
    apiQuery<TreatmentsResponse>(`/genes/${segment(symbol)}/treatments`),
  compounds: (accession: string) =>
    apiQuery<ProteinCompoundsResponse>(
      `/proteins/${segment(accession)}/compounds`,
    ),
  compound: (compoundId: string) =>
    apiQuery<CompoundDetailResponse>(`/compounds/${segment(compoundId)}`),
  pockets: (
    accession: string,
    options: { structureId?: Id; residue?: number | null } = {},
  ) =>
    apiQuery<PocketsResponse>(`/proteins/${segment(accession)}/pockets`, {
      structure_id: options.structureId,
      residue: options.residue,
    }),
  comparePlan: (gene: string, change: string) =>
    apiQuery<ComparePlanResponse>(
      `/compare/${segment(gene)}/${segment(change)}`,
    ),
  compareResult: (jobId: string) =>
    apiQuery<CompareResultResponse>(`/compare/results/${segment(jobId)}`),
};

interface HookOptions {
  enabled?: boolean;
}

const on = (options: HookOptions | undefined, ...ids: unknown[]) =>
  (options?.enabled ?? true) &&
  ids.every((id) => id !== null && id !== undefined && id !== "");

export function useGene(symbol: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.gene(symbol ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, symbol),
  });
}

export function useProtein(accession: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.protein(accession ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

export function useResidue(
  accession: Id,
  position: number | null | undefined,
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.residue(accession ?? "", position ?? 0),
    ...SLOW_CHANGING,
    enabled: on(options, accession, position),
  });
}

/** The variant table. The previous page stays on screen while a filter change loads. */
export function useGeneVariants(
  symbol: Id,
  filters: GeneVariantFilters = {},
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.geneVariants(symbol ?? "", filters),
    ...SLOW_CHANGING,
    placeholderData: keepPreviousData,
    enabled: on(options, symbol),
  });
}

/** Slim clinical and population rows of a gene, the form the sequence axis draws. */
export function useAxisVariants(symbol: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.axisVariants(symbol ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, symbol),
  });
}

export function useVariant(variantId: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.variant(variantId ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, variantId),
  });
}

/** Without `alt` the answer is residue-level only. */
export function useResidueEffects(
  accession: Id,
  position: number | null | undefined,
  change: { alt?: string | null; ref?: string | null } = {},
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.residueEffects(accession ?? "", position ?? 0, change),
    ...SLOW_CHANGING,
    enabled: on(options, accession, position),
  });
}

/** Per-residue AlphaMissense summary; `matrix` adds the residue x 20 heatmap. */
export function useEffectMap(
  accession: Id,
  options?: HookOptions & { matrix?: boolean },
) {
  return useQuery({
    ...workspaceQueries.effectMap(accession ?? "", options?.matrix ?? false),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

export function useStructureLedger(
  accession: Id,
  options?: HookOptions & { externalModels?: boolean },
) {
  return useQuery({
    ...workspaceQueries.structureLedger(
      accession ?? "",
      options?.externalModels ?? true,
    ),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

export function useStructure(
  structureId: Id,
  accession?: Id,
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.structure(structureId ?? "", accession),
    ...SLOW_CHANGING,
    enabled: on(options, structureId),
  });
}

/** pLDDT per residue, and the PAE matrix when `pae` is set. Experimental entries answer `available: false`. */
export function useStructureConfidence(
  structureId: Id,
  options?: HookOptions & { pae?: boolean },
) {
  return useQuery({
    ...workspaceQueries.structureConfidence(
      structureId ?? "",
      options?.pae ?? false,
    ),
    ...SLOW_CHANGING,
    enabled: on(options, structureId),
  });
}

export function useStructureResidueMap(
  structureId: Id,
  accession?: Id,
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.structureResidueMap(structureId ?? "", accession),
    ...SLOW_CHANGING,
    enabled: on(options, structureId),
  });
}

export function useStructureLigands(
  structureId: Id,
  accession?: Id,
  options?: HookOptions,
) {
  return useQuery({
    ...workspaceQueries.structureLigands(structureId ?? "", accession),
    ...SLOW_CHANGING,
    enabled: on(options, structureId),
  });
}

/** Accepts a catalog slug or an exact cross-reference such as MONDO:0010421. */
export function useDisease(diseaseId: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.disease(diseaseId ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, diseaseId),
  });
}

export function useInteractions(accession: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.interactions(accession ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

export function usePathways(accession: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.pathways(accession ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

export function useTreatments(symbol: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.treatments(symbol ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, symbol),
  });
}

/** The first call for a protein can take 25 to 45 s; show a loading state and the source status. */
export function useCompounds(accession: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.compounds(accession ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, accession),
  });
}

/** Accepts an InChIKey or a ChEMBL ID. */
export function useCompound(compoundId: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.compound(compoundId ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, compoundId),
  });
}

/** Polls at the interval the API asks for while the pocket prediction is still computing. */
export function usePockets(
  accession: Id,
  options?: HookOptions & { structureId?: Id; residue?: number | null },
) {
  return useQuery({
    ...workspaceQueries.pockets(accession ?? "", {
      structureId: options?.structureId,
      residue: options?.residue,
    }),
    enabled: on(options, accession),
    refetchInterval: (query) => {
      const pockets = query.state.data?.data;
      return pockets?.status === "pending"
        ? (pockets.retry_after_seconds ?? 5) * 1000
        : false;
    },
  });
}

/** `change` is the protein change on its own: "p.Arg28His". */
export function useComparePlan(gene: Id, change: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.comparePlan(gene ?? "", change ?? ""),
    enabled: on(options, gene, change),
  });
}

/** Both models and the difference payload of a finished comparison or a cached example. */
export function useCompareResult(jobId: Id, options?: HookOptions) {
  return useQuery({
    ...workspaceQueries.compareResult(jobId ?? ""),
    ...SLOW_CHANGING,
    enabled: on(options, jobId),
  });
}
