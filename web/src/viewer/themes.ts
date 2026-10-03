import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { createStructureColorThemeParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { Color } from "molstar/lib/mol-util/color";
import type { RepresentationSelector } from "./representations";
import { RESIDUE_DATA_THEME } from "./residue-data-theme";

export type ColorMode =
  | { kind: "chain" }
  | { kind: "secondary-structure" }
  | { kind: "plddt" }
  | { kind: "b-factor"; domain?: [number, number] }
  | { kind: "element" }
  | { kind: "uniform"; color: number }
  | { kind: "residue-data"; datasetId: string; version: number };

function themeFor(mode: ColorMode): { name: string; params?: Record<string, unknown> } {
  // prettier-ignore
  switch (mode.kind) {
    case "chain": return { name: "chain-id", params: { asymId: "label" } };
    // unmodified Mol* colours, so the legend can print them exactly
    case "secondary-structure": return { name: "secondary-structure", params: { saturation: 0, lightness: 0 } };
    case "plddt": return { name: "plddt-confidence" };
    case "b-factor": return { name: "uncertainty", params: { domain: mode.domain ?? [0, 100] } };
    case "element": return { name: "element-symbol", params: { carbonColor: { name: "element-symbol", params: {} } } };
    case "uniform": return { name: "uniform", params: { value: Color(mode.color) } };
    case "residue-data": return { name: RESIDUE_DATA_THEME, params: { datasetId: mode.datasetId, version: mode.version } };
  }
}

/** Pass the representations of one structure for per-structure colouring, or of all structures. */
export async function setColorMode(
  plugin: PluginContext,
  representations: RepresentationSelector[],
  mode: ColorMode,
): Promise<void> {
  const { name, params } = themeFor(mode);
  const update = plugin.build();
  for (const representation of representations) {
    const cell = representation.cell;
    if (!cell?.obj || !cell.transform.params) continue;
    const typeName = cell.transform.params.type.name;
    const colorTheme = createStructureColorThemeParams(plugin, cell.obj.data.sourceData, typeName, name, params);
    update.to(representation).update((old) => {
      old.colorTheme = colorTheme;
    });
  }
  await update.commit();
}
