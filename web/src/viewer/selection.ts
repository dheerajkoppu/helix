import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { EmptyLoci } from "molstar/lib/mol-model/loci";
import { Structure, StructureElement } from "molstar/lib/mol-model/structure";
import { StateTree } from "molstar/lib/mol-state";
import type { LoadedStructure } from "./load";

export interface ResidueRange {
  /** label_asym_id, or auth_asym_id when numbering is "auth" */
  chain: string;
  start: number;
  end?: number;
  numbering?: "label" | "auth";
}

/** The structure as displayed, including a superposition transform decorating the structure node. */
export function getStructureData(plugin: PluginContext, loaded: LoadedStructure): Structure | undefined {
  const state = plugin.state.data;
  const ref = StateTree.getDecoratorRoot(state.tree, loaded.structure.ref);
  return state.cells.get(ref)?.obj?.data as Structure | undefined;
}

export function lociForRanges(structure: Structure, ranges: ResidueRange[]): StructureElement.Loci {
  if (ranges.length === 0) return StructureElement.Loci.none(structure);
  return StructureElement.Loci.fromSchema(structure, {
    items: ranges.map((range) =>
      range.numbering === "auth"
        ? { auth_asym_id: range.chain, beg_auth_seq_id: range.start, end_auth_seq_id: range.end ?? range.start }
        : { label_asym_id: range.chain, beg_label_seq_id: range.start, end_label_seq_id: range.end ?? range.start },
    ),
  });
}

/** `add` keeps the highlight already shown on another structure of an overlay. */
export function highlightResidues(plugin: PluginContext, loaded: LoadedStructure, ranges: ResidueRange[], add = false): void {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return;
  const current = { loci: lociForRanges(structure, ranges) };
  if (add) plugin.managers.interactivity.lociHighlights.highlight(current);
  else plugin.managers.interactivity.lociHighlights.highlightOnly(current);
}

export function clearHighlight(plugin: PluginContext): void {
  plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: EmptyLoci });
}

export function selectResidues(plugin: PluginContext, loaded: LoadedStructure, ranges: ResidueRange[], add = false): void {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return;
  const current = { loci: lociForRanges(structure, ranges) };
  if (add) plugin.managers.interactivity.lociSelects.select(current);
  else plugin.managers.interactivity.lociSelects.selectOnly(current);
}

export function clearSelection(plugin: PluginContext): void {
  plugin.managers.interactivity.lociSelects.deselectAll();
}

export function focusResidues(
  plugin: PluginContext,
  loaded: LoadedStructure,
  ranges: ResidueRange[],
  options: { durationMs?: number; extraRadius?: number } = {},
): void {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return;
  const loci = lociForRanges(structure, ranges);
  if (StructureElement.Loci.isEmpty(loci)) return;
  const { durationMs = 250, extraRadius = 4 } = options;
  plugin.managers.camera.focusLoci(loci, { durationMs, extraRadius, minRadius: 8 });
}
