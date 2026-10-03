"use client";

import { useMemo } from "react";

import {
  domainColoring,
  variantImpactColoring,
  type ResidueColoring,
  type ViewerDomain,
} from "@/components/viewer";
import type { Schema } from "@/lib/api/types";
import { PLDDT_BANDS, PLDDT_NO_SCORE, plddtBand } from "@/lib/science/plddt";
import type { ColorMode } from "@/lib/state/selection";

import {
  useEffectMap,
  useProtein,
  type EffectMapResponse,
  type ProteinResponse,
} from "./queries";

type PlddtTrack = Schema<"PlddtTrack">;

/**
 * pLDDT per residue as a colour map, in the AlphaFold DB bands. `StructureViewport` colours
 * predicted files from their B-factor column on its own; use this where that column is not a
 * 0 to 100 pLDDT, or to colour another view (a table, a contact map) the same way.
 */
export function plddtColoring(
  track: PlddtTrack,
  source = "pLDDT",
): ResidueColoring {
  const colors = new Map<number, number>();
  track.residue_numbers.forEach((position, index) => {
    const score = track.scores[index];
    if (typeof score === "number") colors.set(position, plddtBand(score).color);
  });
  return {
    colors,
    fallback: PLDDT_NO_SCORE.color,
    legend: {
      title: "Model confidence",
      note: source,
      items: PLDDT_BANDS.map((band) => ({
        label: band.label,
        color: band.color,
        code: band.code,
        detail: band.range,
      })),
    },
  };
}

/** AlphaMissense mean pathogenicity per residue from `/effect-map`. Null when no residue has a score. */
export function alphaMissenseColoring(
  effectMap: EffectMapResponse,
): ResidueColoring | null {
  if (effectMap.residues.length === 0) return null;
  return variantImpactColoring(
    new Map(
      effectMap.residues.map((residue) => [
        residue.position,
        residue.mean_pathogenicity,
      ]),
    ),
    `${effectMap.tool}, residue mean`,
  );
}

export interface ProteinDomains {
  domains: ViewerDomain[];
  /** where the annotation comes from: "UniProt 2026_03" */
  source: string;
}

/**
 * UniProt domains, or InterPro domains when UniProt annotates none. The order is the order the
 * sequence axis draws them in, so the n-th domain has the same colour in the viewer and its legend.
 */
export function proteinDomains(protein: ProteinResponse): ProteinDomains {
  const pick = (trackId: string): ViewerDomain[] =>
    (protein.tracks.find((track) => track.id === trackId)?.features ?? [])
      .filter(
        (feature) =>
          typeof feature.start === "number" && typeof feature.end === "number",
      )
      .map((feature) => ({
        id: feature.id,
        label: feature.description ?? feature.type,
        start: feature.start as number,
        end: feature.end as number,
      }));
  const uniprot = pick("domains");
  if (uniprot.length > 0)
    return {
      domains: uniprot,
      source: ["UniProt", protein.provenance?.release]
        .filter(Boolean)
        .join(" "),
    };
  return {
    domains: pick("interpro_domains"),
    source: ["InterPro", protein.interpro_provenance?.release]
      .filter(Boolean)
      .join(" "),
  };
}

/** Null when the protein has no annotated domain. */
export function proteinDomainColoring(
  protein: ProteinResponse,
): ResidueColoring | null {
  const { domains, source } = proteinDomains(protein);
  return domains.length > 0 ? domainColoring(domains, source) : null;
}

export type ProteinColorings = Partial<Record<ColorMode, ResidueColoring>>;

/** The `colorings` object for `StructureViewport`, from whichever of the two answers is in. */
export function proteinColorings(
  protein: ProteinResponse | null | undefined,
  effectMap: EffectMapResponse | null | undefined,
): ProteinColorings {
  const colorings: ProteinColorings = {};
  const domain = protein ? proteinDomainColoring(protein) : null;
  if (domain) colorings.domain = domain;
  const impact = effectMap ? alphaMissenseColoring(effectMap) : null;
  if (impact) colorings.alphamissense = impact;
  return colorings;
}

/** Memoised `colorings` and `domains` props for `StructureViewport`, fetched for one protein. */
export function useProteinColorings(accession: string | null | undefined): {
  colorings: ProteinColorings;
  domains: ViewerDomain[];
} {
  const protein = useProtein(accession).data?.data;
  const effectMap = useEffectMap(accession).data?.data;
  return useMemo(
    () => ({
      colorings: proteinColorings(protein, effectMap),
      domains: protein ? proteinDomains(protein).domains : [],
    }),
    [protein, effectMap],
  );
}
