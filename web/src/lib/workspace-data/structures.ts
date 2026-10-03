"use client";

import { useMemo } from "react";

import type {
  ResidueMap,
  StructureSource,
  ViewportStructure,
} from "@/components/viewer";
import { API_BASE_URL } from "@/lib/api/client";
import type { SourceStatus } from "@/lib/api/types";

import {
  useStructure,
  useStructureResidueMap,
  type ApiResidueMap,
  type ApiStructureDescriptor,
  type StructureLedger,
} from "./queries";

/** Descriptor file URLs are API paths ("/api/v1/..."); upstream URLs pass through unchanged. */
export function apiFileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** BinaryCIF when the descriptor has it, then mmCIF, then PDB. Null when no file is stored. */
export function structureSource(
  descriptor: ApiStructureDescriptor,
): StructureSource | null {
  const { bcif_url, cif_url, pdb_url } = descriptor.files;
  const label = descriptor.source_id ?? descriptor.id;
  const bcif = apiFileUrl(bcif_url);
  if (bcif)
    return { kind: "url", url: bcif, format: "mmcif", isBinary: true, label };
  const cif = apiFileUrl(cif_url);
  if (cif) return { kind: "url", url: cif, format: "mmcif", label };
  const pdb = apiFileUrl(pdb_url);
  if (pdb) return { kind: "url", url: pdb, format: "pdb", label };
  return null;
}

const METHOD_SHORT: Record<string, string> = {
  "X-RAY DIFFRACTION": "X-ray",
  "ELECTRON MICROSCOPY": "Cryo-EM",
  "SOLUTION NMR": "NMR",
  "SOLID-STATE NMR": "Solid-state NMR",
  "ELECTRON CRYSTALLOGRAPHY": "Electron crystallography",
  "NEUTRON DIFFRACTION": "Neutron diffraction",
};

/** Printed after the corner tag: "X-ray 1.08 Å", "AlphaFold DB v6", "ESMFold v1 esmfold_v1". */
export function structureDetail(descriptor: ApiStructureDescriptor): string {
  if (descriptor.origin === "experimental") {
    const method = descriptor.method
      ? (METHOD_SHORT[descriptor.method.toUpperCase()] ?? descriptor.method)
      : "Experimental";
    return descriptor.resolution !== null && descriptor.resolution !== undefined
      ? `${method} ${descriptor.resolution.toFixed(2)} Å`
      : method;
  }
  if (descriptor.origin === "predicted_external")
    return [
      descriptor.provider_name ?? descriptor.provider,
      descriptor.model_version,
    ]
      .filter(Boolean)
      .join(" ");
  return [
    descriptor.model_name ?? descriptor.provider_name,
    descriptor.model_version,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Model name and version, or the experimental method, for exported figures. */
export function structureModelVersion(
  descriptor: ApiStructureDescriptor,
): string {
  if (descriptor.origin === "experimental")
    return [descriptor.source_id, structureDetail(descriptor)]
      .filter(Boolean)
      .join(", ");
  return [descriptor.model_name, descriptor.model_version]
    .filter(Boolean)
    .join(" ");
}

export interface ViewerChainMap {
  /** label_asym_id of the chain carrying the protein */
  chain: string | undefined;
  residueMap: ResidueMap;
}

/**
 * SIFTS segments from `/structures/{id}/residue-map` as the viewer's residue map, addressed by
 * label_seq_id. Picks the chain that covers the most of the protein unless `chainId` (the SIFTS
 * author chain) is given. Null when no segment maps the accession.
 */
export function toViewerResidueMap(
  map: ApiResidueMap,
  options: { accession?: string | null; chainId?: string | null } = {},
): ViewerChainMap | null {
  const usable = map.segments.filter(
    (entry) =>
      entry.entity_start !== null &&
      entry.entity_start !== undefined &&
      (!options.accession || entry.uniprot_accession === options.accession),
  );
  if (usable.length === 0) return null;
  const spans = new Map<string, number>();
  for (const entry of usable) {
    const key = entry.struct_asym_id ?? entry.chain_id;
    spans.set(key, (spans.get(key) ?? 0) + entry.unp_end - entry.unp_start + 1);
  }
  const wanted = options.chainId
    ? usable.find((entry) => entry.chain_id === options.chainId)
    : undefined;
  const chain = wanted
    ? (wanted.struct_asym_id ?? wanted.chain_id)
    : [...spans.entries()].reduce((best, entry) =>
        entry[1] > best[1] ? entry : best,
      )[0];
  return {
    chain,
    residueMap: {
      numbering: "label",
      segments: usable
        .filter((entry) => (entry.struct_asym_id ?? entry.chain_id) === chain)
        .map((entry) => ({
          uniprotStart: entry.unp_start,
          uniprotEnd: entry.unp_end,
          structureStart: entry.entity_start as number,
        })),
    },
  };
}

export interface ViewportStructureOptions {
  /** answer of `/structures/{id}/residue-map`; needed for experimental entries */
  residueMap?: ApiResidueMap | null;
  accession?: string | null;
  /** SIFTS author chain to show instead of the best-covering one */
  chainId?: string | null;
  slot?: string;
  frameOnly?: boolean;
}

/**
 * An API StructureDescriptor as the input `StructureViewport` takes. Residue numbering by origin:
 * AlphaFold DB models carry the UniProt position in label_seq_id; OrphaFold-generated files carry
 * it in auth_seq_id (their label_seq_id restarts at 1 for a construct); experimental entries need
 * the SIFTS map and fall back to author numbering without it. Null when the descriptor has no file.
 */
export function toViewportStructure(
  descriptor: ApiStructureDescriptor,
  options: ViewportStructureOptions = {},
): ViewportStructure | null {
  const source = structureSource(descriptor);
  if (!source) return null;
  const mapped =
    descriptor.origin === "experimental" && options.residueMap
      ? toViewerResidueMap(options.residueMap, options)
      : null;
  const residueMap: ResidueMap | undefined =
    mapped?.residueMap ??
    (descriptor.origin === "predicted_orphafold"
      ? { numbering: "auth" }
      : undefined);
  return {
    id: descriptor.id,
    source,
    origin: descriptor.origin,
    detail: structureDetail(descriptor) || undefined,
    modelVersion: structureModelVersion(descriptor) || undefined,
    chain: mapped?.chain,
    residueMap,
    plddtScale: descriptor.confidence?.plddt_native_scale ?? undefined,
    slot: options.slot,
    frameOnly: options.frameOnly,
  };
}

/** Every descriptor of a ledger in display order: experimental, AlphaFold DB, isoforms, OrphaFold. */
export function ledgerDescriptors(
  ledger: StructureLedger,
): ApiStructureDescriptor[] {
  return [
    ...ledger.experimental.map((row) => row.structure),
    ...ledger.predicted_external,
    ...ledger.isoform_models,
    ...ledger.predicted_orphafold,
  ];
}

export function findLedgerStructure(
  ledger: StructureLedger | null | undefined,
  structureId: string | null | undefined,
): ApiStructureDescriptor | null {
  if (!ledger || !structureId) return null;
  return (
    ledgerDescriptors(ledger).find((entry) => entry.id === structureId) ?? null
  );
}

/** The AlphaFold DB model of the canonical sequence, when the ledger has one. */
export const canonicalModel = (
  ledger: StructureLedger | null | undefined,
): ApiStructureDescriptor | null => ledger?.predicted_external[0] ?? null;

export interface ViewportStructureResult {
  /** null until the descriptor (and, for experimental entries, the residue map) has arrived */
  structure: ViewportStructure | null;
  descriptor: ApiStructureDescriptor | null;
  isPending: boolean;
  error: Error | null;
  sources: SourceStatus[];
}

/**
 * One structure ready for `StructureViewport`. Pass the descriptor when the page already has it
 * (a ledger row, a comparison model); pass only the ID to have it fetched. For an experimental
 * entry the SIFTS residue map is fetched as well, so selections land on the right residues.
 */
export function useViewportStructure(
  structure: ApiStructureDescriptor | string | null | undefined,
  accession: string | null | undefined,
  options: Pick<
    ViewportStructureOptions,
    "chainId" | "slot" | "frameOnly"
  > = {},
): ViewportStructureResult {
  const given = typeof structure === "string" ? null : (structure ?? null);
  const structureId = typeof structure === "string" ? structure : given?.id;
  const fetched = useStructure(structureId, accession, {
    enabled: given === null,
  });
  const descriptor = given ?? fetched.data?.data ?? null;
  const experimental = descriptor?.origin === "experimental";
  const map = useStructureResidueMap(structureId, accession, {
    enabled: experimental,
  });
  const mapData = map.data?.data ?? null;
  const mapSettled = !experimental || !map.isPending;
  const { chainId, slot, frameOnly } = options;

  const viewportStructure = useMemo(
    () =>
      descriptor && mapSettled
        ? toViewportStructure(descriptor, {
            residueMap: mapData,
            accession,
            chainId,
            slot,
            frameOnly,
          })
        : null,
    [descriptor, mapSettled, mapData, accession, chainId, slot, frameOnly],
  );

  return {
    structure: viewportStructure,
    descriptor,
    isPending: (given === null && fetched.isPending) || !mapSettled,
    error: (given === null ? fetched.error : null) ?? null,
    sources: map.data?.sources ?? [],
  };
}
