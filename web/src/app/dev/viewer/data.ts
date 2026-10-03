/**
 * Dev-only loader for /dev/viewer. It reads BTK straight from UniProt, AlphaFold DB, RCSB PDB and
 * PDBe in the browser so the viewer can be exercised before the Helix API serves structures.
 * Product pages never do this: they call the API through `@/lib/api`. Each source fails on its own.
 */
import type { SequenceTrack } from "@/components/sequence";
import type { ResidueMap, ViewerDomain } from "@/components/viewer";

export const ACCESSION = "Q06187";
export const GENE = "BTK";
export const PDB_ID = "1B55";

interface UniProtFeature {
  type: string;
  description?: string;
  featureId?: string;
  ligand?: { name?: string };
  location: { start: { value: number }; end: { value: number } };
}

export interface SourceNote {
  source: string;
  name: string;
  state: "ok" | "unavailable";
  release?: string | null;
  message?: string;
}

export interface BindingAnnotation {
  ligand: string;
  positions: number[];
}

export interface ViewerDemoData {
  sequence: string | null;
  domains: ViewerDomain[];
  bindingSites: BindingAnnotation[];
  tracks: SequenceTrack[];
  /** AlphaFold DB model entry, null when the prediction API did not answer */
  model: {
    entryId: string;
    version: number;
    bcifUrl: string;
    meanPlddt: number;
    created: string | null;
  } | null;
  /** mean AlphaMissense pathogenicity over the 19 substitutions at each position */
  alphaMissense: Map<number, number> | null;
  experimental: {
    method: string | null;
    resolution: number | null;
    /** UniProt to label_seq_id segments for chain A, from PDBe SIFTS */
    residueMap: ResidueMap | null;
  };
  sources: SourceNote[];
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : "no answer";

export async function fetchViewerDemoData(): Promise<ViewerDemoData> {
  const sources: SourceNote[] = [];
  const data: ViewerDemoData = {
    sequence: null,
    domains: [],
    bindingSites: [],
    tracks: [],
    model: null,
    alphaMissense: null,
    experimental: { method: null, resolution: null, residueMap: null },
    sources,
  };

  const uniprot = (async () => {
    const response = await fetch(
      `https://rest.uniprot.org/uniprotkb/${ACCESSION}.json?fields=sequence,ft_domain,ft_binding`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = response.headers.get("x-uniprot-release");
    const entry = (await response.json()) as {
      sequence: { value: string };
      features?: UniProtFeature[];
    };
    data.sequence = entry.sequence.value;
    const features = entry.features ?? [];
    data.domains = features
      .filter((feature) => feature.type === "Domain")
      .map((feature, index) => ({
        id: feature.featureId ?? `domain-${index}`,
        label: feature.description ?? "Domain",
        start: feature.location.start.value,
        end: feature.location.end.value,
      }));
    const byLigand = new Map<string, number[]>();
    for (const feature of features) {
      if (feature.type !== "Binding site" || !feature.ligand?.name) continue;
      const positions = byLigand.get(feature.ligand.name) ?? [];
      for (
        let position = feature.location.start.value;
        position <= feature.location.end.value;
        position += 1
      )
        positions.push(position);
      byLigand.set(feature.ligand.name, positions);
    }
    data.bindingSites = Array.from(byLigand, ([ligand, positions]) => ({
      ligand,
      positions,
    }));
    data.tracks.unshift({
      id: "domains",
      label: "Domains",
      kind: "domain",
      source: release ? `UniProt ${release}` : "UniProt",
      features: data.domains,
    });
    sources.push({ source: "uniprot", name: "UniProt", state: "ok", release });
  })().catch((error: unknown) =>
    sources.push({
      source: "uniprot",
      name: "UniProt",
      state: "unavailable",
      message: reason(error),
    }),
  );

  const alphafold = (async () => {
    const [entry] = await json<
      Array<{
        entryId: string;
        latestVersion: number;
        bcifUrl: string;
        globalMetricValue: number;
        modelCreatedDate?: string;
        plddtDocUrl?: string;
        amAnnotationsUrl?: string;
      }>
    >(`https://alphafold.ebi.ac.uk/api/prediction/${ACCESSION}`);
    data.model = {
      entryId: entry.entryId,
      version: entry.latestVersion,
      bcifUrl: entry.bcifUrl,
      meanPlddt: entry.globalMetricValue,
      created: entry.modelCreatedDate?.slice(0, 10) ?? null,
    };
    sources.push({
      source: "afdb",
      name: "AlphaFold DB",
      state: "ok",
      release: `v${entry.latestVersion}`,
    });

    await Promise.all([
      entry.plddtDocUrl
        ? json<{ confidenceScore: number[] }>(entry.plddtDocUrl)
            .then((confidence) => {
              data.tracks.push({
                id: "plddt",
                label: "pLDDT",
                kind: "confidence",
                source: `AlphaFold DB v${entry.latestVersion}`,
                values: confidence.confidenceScore,
              });
            })
            .catch(() => {})
        : null,
      entry.amAnnotationsUrl
        ? fetch(entry.amAnnotationsUrl)
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.text();
            })
            .then((csv) => {
              const totals = new Map<number, [number, number]>();
              for (const row of csv.split("\n").slice(1)) {
                const [variant, score] = row.split(",");
                const position = Number(variant?.slice(1, -1));
                const value = Number(score);
                if (!position || Number.isNaN(value)) continue;
                const [sum, count] = totals.get(position) ?? [0, 0];
                totals.set(position, [sum + value, count + 1]);
              }
              data.alphaMissense = new Map(
                Array.from(totals, ([position, [sum, count]]) => [
                  position,
                  sum / count,
                ]),
              );
              sources.push({
                source: "alphamissense",
                name: "AlphaMissense",
                state: "ok",
                release: "AlphaFold DB file",
              });
            })
            .catch((error: unknown) =>
              sources.push({
                source: "alphamissense",
                name: "AlphaMissense",
                state: "unavailable",
                message: reason(error),
              }),
            )
        : null,
    ]);
  })().catch((error: unknown) =>
    sources.push({
      source: "afdb",
      name: "AlphaFold DB",
      state: "unavailable",
      message: reason(error),
    }),
  );

  const rcsb = json<{
    exptl?: Array<{ method?: string }>;
    rcsb_entry_info?: { resolution_combined?: number[] };
  }>(`https://data.rcsb.org/rest/v1/core/entry/${PDB_ID}`)
    .then((entry) => {
      data.experimental.method = entry.exptl?.[0]?.method ?? null;
      data.experimental.resolution =
        entry.rcsb_entry_info?.resolution_combined?.[0] ?? null;
      sources.push({ source: "rcsb", name: "RCSB PDB", state: "ok" });
    })
    .catch((error: unknown) =>
      sources.push({
        source: "rcsb",
        name: "RCSB PDB",
        state: "unavailable",
        message: reason(error),
      }),
    );

  const sifts = json<
    Record<
      string,
      {
        UniProt?: Record<
          string,
          {
            mappings: Array<{
              struct_asym_id: string;
              unp_start: number;
              unp_end: number;
              start: { residue_number: number };
            }>;
          }
        >;
      }
    >
  >(`https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${PDB_ID.toLowerCase()}`)
    .then((body) => {
      const mappings =
        body[PDB_ID.toLowerCase()]?.UniProt?.[ACCESSION]?.mappings ?? [];
      const segments = mappings
        .filter((mapping) => mapping.struct_asym_id === "A")
        .map((mapping) => ({
          uniprotStart: mapping.unp_start,
          uniprotEnd: mapping.unp_end,
          structureStart: mapping.start.residue_number,
        }));
      if (segments.length > 0)
        data.experimental.residueMap = { numbering: "label", segments };
      sources.push({ source: "pdbe", name: "PDBe SIFTS", state: "ok" });
    })
    .catch((error: unknown) =>
      sources.push({
        source: "pdbe",
        name: "PDBe SIFTS",
        state: "unavailable",
        message: reason(error),
      }),
    );

  await Promise.all([uniprot, alphafold, rcsb, sifts]);
  return data;
}
