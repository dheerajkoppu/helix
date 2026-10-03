"use client";

import { useMemo } from "react";

import type { SequenceTrack } from "@/components/sequence";
import { useAxisDock, type AxisDockData } from "@/components/workspace";
import type { SourceStatus } from "@/lib/api/types";

import {
  axisVariants,
  confidenceTrack,
  coverageTrack,
  featureTracks,
  pathogenicityTrack,
  unavailableTrack,
  variantSourceStatus,
} from "./axis";
import {
  useAxisVariants,
  useEffectMap,
  useProtein,
  useStructureConfidence,
  useStructureLedger,
  type AxisVariantsResponse,
  type EffectMapResponse,
  type ProteinResponse,
  type StructureLedger,
} from "./queries";
import { failedSource, mergeSources } from "./sources";
import { canonicalModel } from "./structures";

export interface ProteinAxisOptions {
  /** HGNC symbol whose variants are drawn; default is the gene of the UniProt entry */
  gene?: string | null;
  /** false leaves both variant rows out and skips the variant request */
  variants?: boolean;
  /** predicted structure whose pLDDT fills the confidence row; default is the AlphaFold DB model */
  confidenceStructureId?: string | null;
  /** false assembles the data without feeding the dock, for a page that renders its own axis */
  feed?: boolean;
  enabled?: boolean;
}

export interface ProteinAxisResult {
  /** what the dock shows; null until the sequence has loaded */
  data: AxisDockData | null;
  /** the sequence itself is still loading */
  isPending: boolean;
  /** every axis request has settled, successfully or not */
  isComplete: boolean;
  /** the protein record could not be loaded, so there is no axis */
  error: Error | null;
  /** one row per source across the axis requests, for `useReportSources` */
  sources: SourceStatus[];
  protein: ProteinResponse | null;
  ledger: StructureLedger | null;
  effectMap: EffectMapResponse | null;
  variants: AxisVariantsResponse | null;
  /** gnomAD rows not drawn because their reference residue differs from the UniProt sequence */
  populationMismatched: number;
}

const PLDDT_ROW = { id: "plddt", label: "pLDDT", kind: "confidence" } as const;
const AM_ROW = {
  id: "alphamissense",
  label: "AM (predicted)",
  kind: "pathogenicity",
} as const;

/**
 * Assembles the sequence axis of one protein from the OrphaFold API and feeds the persistent dock.
 * The axis appears as soon as the sequence is in; each further row is added when its request
 * settles, and a request that fails leaves a row that says so. Requests share the React Query
 * cache with `useProtein`, `useStructureLedger`, `useEffectMap` and `useAxisVariants`, so a page
 * calling those hooks as well costs nothing extra.
 */
export function useProteinAxis(
  accession: string | null | undefined,
  options: ProteinAxisOptions = {},
): ProteinAxisResult {
  const enabled = (options.enabled ?? true) && Boolean(accession);
  const wantVariants = options.variants ?? true;

  const protein = useProtein(accession, { enabled });
  const ledger = useStructureLedger(accession, { enabled });
  const effectMap = useEffectMap(accession, { enabled });

  const proteinData = protein.data?.data ?? null;
  const ledgerData = ledger.data?.data ?? null;
  const effectMapData = effectMap.data?.data ?? null;

  const gene = options.gene ?? proteinData?.gene?.id ?? null;
  const variants = useAxisVariants(gene, { enabled: enabled && wantVariants });
  const variantData = variants.data?.data ?? null;

  const confidenceId =
    options.confidenceStructureId ?? canonicalModel(ledgerData)?.id ?? null;
  const confidence = useStructureConfidence(confidenceId, { enabled });
  const confidenceData = confidence.data?.data ?? null;

  const sequence = proteinData?.sequence.value ?? null;
  const length = sequence?.length ?? 0;

  const baseTracks = useMemo(
    () => (proteinData ? featureTracks(proteinData) : []),
    [proteinData],
  );

  const coverage = useMemo<SequenceTrack | null>(() => {
    if (ledgerData) return coverageTrack(ledgerData);
    if (ledger.isError)
      return {
        id: "coverage",
        label: "Structures",
        kind: "coverage",
        status: failedSource("pdbe", "Structures", ledger.error),
      };
    return null;
  }, [ledgerData, ledger.isError, ledger.error]);

  const plddt = useMemo<SequenceTrack | null>(() => {
    if (confidenceData) return confidenceTrack(confidenceData, length);
    if (confidence.isError)
      return unavailableTrack(
        PLDDT_ROW,
        failedSource("afdb", "AlphaFold DB", confidence.error),
      );
    if (ledger.isError)
      return unavailableTrack(
        PLDDT_ROW,
        failedSource("afdb", "AlphaFold DB", ledger.error),
      );
    if (ledgerData && !confidenceId)
      return unavailableTrack(PLDDT_ROW, {
        source: "afdb",
        name: "AlphaFold DB",
        state: "empty",
        message: "No AlphaFold DB model for this accession.",
      });
    return null;
  }, [
    confidenceData,
    confidence.isError,
    confidence.error,
    ledger.isError,
    ledger.error,
    ledgerData,
    confidenceId,
    length,
  ]);

  const pathogenicity = useMemo<SequenceTrack | null>(() => {
    if (effectMapData) return pathogenicityTrack(effectMapData, length);
    if (effectMap.isError)
      return unavailableTrack(
        AM_ROW,
        failedSource("alphamissense", "AlphaMissense", effectMap.error),
      );
    return null;
  }, [effectMapData, effectMap.isError, effectMap.error, length]);

  const variantSet = useMemo(
    () =>
      variantData && sequence ? axisVariants(variantData, sequence) : null,
    [variantData, sequence],
  );

  const variantStatus = useMemo<SourceStatus | null>(() => {
    if (!wantVariants) return null;
    if (variantData) return variantSourceStatus(variantData);
    if (variants.isError)
      return failedSource(
        "clinvar",
        "ClinVar, UniProt, gnomAD",
        variants.error,
      );
    return null;
  }, [wantVariants, variantData, variants.isError, variants.error]);

  const data = useMemo<AxisDockData | null>(() => {
    if (!accession || !sequence) return null;
    return {
      accession,
      sequence,
      tracks: [
        ...baseTracks,
        ...[coverage, plddt, pathogenicity].filter(
          (track): track is SequenceTrack => track !== null,
        ),
      ],
      variants: variantSet?.variants ?? [],
      variantStatus,
    };
  }, [
    accession,
    sequence,
    baseTracks,
    coverage,
    plddt,
    pathogenicity,
    variantSet,
    variantStatus,
  ]);

  const feed = options.feed ?? true;
  useAxisDock(feed ? data : null, {
    loadingAccession: feed && enabled && protein.isPending ? accession : null,
  });

  const sources = useMemo(
    () =>
      mergeSources(
        protein.data?.sources,
        ledger.data?.sources,
        confidence.data?.sources,
        effectMap.data?.sources,
        variants.data?.sources,
      ),
    [protein.data, ledger.data, confidence.data, effectMap.data, variants.data],
  );

  const settled = (query: { isPending: boolean; fetchStatus: string }) =>
    !query.isPending || query.fetchStatus === "idle";

  return {
    data,
    isPending: enabled && protein.isPending,
    isComplete:
      enabled &&
      [protein, ledger, effectMap, variants, confidence].every(settled),
    error: protein.error ?? null,
    sources,
    protein: proteinData,
    ledger: ledgerData,
    effectMap: effectMapData,
    variants: variantData,
    populationMismatched: variantSet?.populationMismatched ?? 0,
  };
}
