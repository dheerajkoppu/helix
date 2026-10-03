import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StateObjectSelector } from "molstar/lib/mol-state";
import type { PluginStateObject } from "molstar/lib/mol-plugin-state/objects";
import { Asset } from "molstar/lib/mol-util/assets";

/** "mmcif" covers text mmCIF and BinaryCIF, set isBinary for .bcif */
export type StructureFormat = "mmcif" | "pdb";

export type StructureSource =
  | { kind: "url"; url: string; format: StructureFormat; isBinary?: boolean; label?: string }
  | { kind: "data"; data: string | ArrayBuffer | Uint8Array<ArrayBuffer>; format: StructureFormat; label?: string };

export interface LoadedStructure {
  dataRef: string;
  model: StateObjectSelector<PluginStateObject.Molecule.Model>;
  structure: StateObjectSelector<PluginStateObject.Molecule.Structure>;
}

export async function loadStructure(
  plugin: PluginContext,
  source: StructureSource,
  options: { assemblyId?: string } = {},
): Promise<LoadedStructure> {
  const data =
    source.kind === "url"
      ? await plugin.builders.data.download(
          { url: Asset.Url(source.url), isBinary: source.isBinary ?? false, label: source.label },
          { state: { isGhost: true } },
        )
      : await plugin.builders.data.rawData({ data: source.data, label: source.label }, { state: { isGhost: true } });
  // a failed download leaves an empty cell behind and only fails later with an opaque message
  const downloaded = data as typeof data | undefined;
  if (!downloaded?.cell?.obj) {
    if (downloaded && plugin.state.data.cells.has(downloaded.ref)) await plugin.build().delete(downloaded.ref).commit();
    const origin = source.kind === "url" ? ` from ${new URL(source.url, window.location.href).host}` : "";
    throw new Error(`The structure file could not be read${origin}. The source did not answer or refused the request.`);
  }
  const trajectory = await plugin.builders.structure.parseTrajectory(data, source.format);
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(
    model,
    options.assemblyId ? { name: "assembly", params: { id: options.assemblyId } } : { name: "model", params: {} },
  );
  return { dataRef: data.ref, model, structure };
}

/** Deleting the data node removes the whole subtree (model, structure, components, representations). */
export async function removeStructure(plugin: PluginContext, loaded: LoadedStructure): Promise<void> {
  await plugin.build().delete(loaded.dataRef).commit();
}

export const rcsbBcifUrl = (pdbId: string) => `https://models.rcsb.org/${pdbId.toLowerCase()}.bcif`;

/** Subset of the fields returned by the AlphaFold DB prediction API. */
export interface AlphaFoldDbEntry {
  modelEntityId: string;
  uniprotAccession: string;
  latestVersion: number;
  globalMetricValue: number;
  bcifUrl: string;
  cifUrl: string;
  paeDocUrl: string;
}

/** One entry per isoform model. File URLs carry the model version, so always resolve them here. */
export async function resolveAlphaFoldDb(uniprotAccession: string, signal?: AbortSignal): Promise<AlphaFoldDbEntry[]> {
  const url = `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(uniprotAccession)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`AlphaFold DB lookup failed for ${uniprotAccession}: HTTP ${response.status}`);
  return (await response.json()) as AlphaFoldDbEntry[];
}
