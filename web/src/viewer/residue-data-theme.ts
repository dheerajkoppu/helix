import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Bond, Model, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import type { ColorTheme, LocationColor } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";

export const RESIDUE_DATA_THEME = "helix-residue-data";

export interface ResidueColorDataset {
  /** which identifiers the keys use: label_asym_id + label_seq_id, or auth_asym_id + auth_seq_id */
  numbering: "label" | "auth";
  /** key `${asymId}:${seqId}`, value 0xRRGGBB */
  colors: ReadonlyMap<string, number>;
  /** colour for residues without a value */
  fallback: number;
}

const datasets = new Map<string, ResidueColorDataset>();

export function setResidueColorDataset(datasetId: string, dataset: ResidueColorDataset): void {
  datasets.set(datasetId, dataset);
}

export function deleteResidueColorDataset(datasetId: string): void {
  datasets.delete(datasetId);
}

// Only the id and a version live in Mol* state; bumping the version makes Mol* rebuild the colours.
const ResidueDataThemeParams = {
  datasetId: PD.Text("", { isHidden: true }),
  version: PD.Numeric(0, undefined, { isHidden: true }),
};
type ResidueDataThemeParams = typeof ResidueDataThemeParams;

function colorsByResidueIndex(model: Model, dataset: ResidueColorDataset): Uint32Array {
  const { residues, chains, residueAtomSegments, chainAtomSegments } = model.atomicHierarchy;
  const colors = new Uint32Array(residues._rowCount);
  const useAuth = dataset.numbering === "auth";
  for (let residueIndex = 0; residueIndex < residues._rowCount; residueIndex++) {
    const chainIndex = chainAtomSegments.index[residueAtomSegments.offsets[residueIndex]];
    const asymId = useAuth ? chains.auth_asym_id.value(chainIndex) : chains.label_asym_id.value(chainIndex);
    const seqId = useAuth ? residues.auth_seq_id.value(residueIndex) : residues.label_seq_id.value(residueIndex);
    colors[residueIndex] = dataset.colors.get(`${asymId}:${seqId}`) ?? dataset.fallback;
  }
  return colors;
}

export function ResidueDataColorTheme(
  ctx: ThemeDataContext,
  props: PD.Values<ResidueDataThemeParams>,
): ColorTheme<ResidueDataThemeParams> {
  const dataset = datasets.get(props.datasetId);
  const fallback = Color(dataset?.fallback ?? 0x8a8f98);
  const perModel = new Map<Model, Uint32Array>();
  if (dataset && ctx.structure) {
    for (const model of ctx.structure.models) perModel.set(model, colorsByResidueIndex(model, dataset));
  }

  const atomColor = (unit: Unit, element: number): Color => {
    if (!Unit.isAtomic(unit)) return fallback;
    const colors = perModel.get(unit.model);
    return colors ? Color(colors[unit.model.atomicHierarchy.residueAtomSegments.index[element]]) : fallback;
  };
  const color: LocationColor = (location) => {
    if (StructureElement.Location.is(location)) return atomColor(location.unit, location.element);
    if (Bond.isLocation(location)) return atomColor(location.aUnit, location.aUnit.elements[location.aIndex]);
    return fallback;
  };

  return {
    factory: ResidueDataColorTheme,
    granularity: "group",
    preferSmoothing: true,
    color,
    props,
    description: "Per-residue colours supplied by Helix",
  };
}

export const ResidueDataColorThemeProvider: ColorTheme.Provider<ResidueDataThemeParams, typeof RESIDUE_DATA_THEME> = {
  name: RESIDUE_DATA_THEME,
  label: "Helix residue data",
  category: ColorThemeCategory.Misc,
  factory: ResidueDataColorTheme,
  getParams: () => ResidueDataThemeParams,
  defaultValues: PD.getDefaultValues(ResidueDataThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};

/** registry.add throws on a duplicate name, so guard it. */
export function registerResidueDataTheme(plugin: PluginContext): void {
  const registry = plugin.representation.structure.themes.colorThemeRegistry;
  if (!registry.has(ResidueDataColorThemeProvider)) registry.add(ResidueDataColorThemeProvider);
}
