import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StateObjectSelector } from "molstar/lib/mol-state";
import type { PluginStateObject } from "molstar/lib/mol-plugin-state/objects";
import { createStructureRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import type { LoadedStructure } from "./load";

export type RepresentationKind = "cartoon" | "molecular-surface" | "ball-and-stick" | "spacefill";
export type RepresentationSelector = StateObjectSelector<PluginStateObject.Molecule.Structure.Representation3D>;

export interface StructureScene {
  loaded: LoadedStructure;
  polymer?: RepresentationSelector;
  ligand?: RepresentationSelector;
  branched?: RepresentationSelector;
  ion?: RepresentationSelector;
}

export async function buildScene(
  plugin: PluginContext,
  loaded: LoadedStructure,
  polymerKind: RepresentationKind = "cartoon",
): Promise<StructureScene> {
  const builder = plugin.builders.structure;
  const scene: StructureScene = { loaded };
  await plugin.dataTransaction(async () => {
    const polymer = await builder.tryCreateComponentStatic(loaded.structure, "polymer");
    if (polymer) {
      scene.polymer = await builder.representation.addRepresentation(polymer, {
        type: polymerKind,
        color: "chain-id",
        colorParams: { asymId: "label" },
      });
    }
    const atoms = { type: "ball-and-stick", color: "element-symbol" } as const;
    const ligand = await builder.tryCreateComponentStatic(loaded.structure, "ligand");
    if (ligand) scene.ligand = await builder.representation.addRepresentation(ligand, atoms);
    const ion = await builder.tryCreateComponentStatic(loaded.structure, "ion");
    if (ion) scene.ion = await builder.representation.addRepresentation(ion, atoms);
    const branched = await builder.tryCreateComponentStatic(loaded.structure, "branched");
    if (branched) {
      const glycan = { type: "carbohydrate", color: "carbohydrate-symbol" } as const;
      scene.branched = await builder.representation.addRepresentation(branched, glycan);
    }
  });
  return scene;
}

/** Swaps the representation type in place and keeps the current colour theme. */
export async function setRepresentationKind(
  plugin: PluginContext,
  representation: RepresentationSelector,
  kind: RepresentationKind,
): Promise<void> {
  const cell = representation.cell;
  const structure = cell?.obj?.data.sourceData;
  const previous = cell?.transform.params;
  if (!structure || !previous) return;
  const next = createStructureRepresentationParams(plugin, structure, { type: kind });
  next.colorTheme = previous.colorTheme;
  await plugin.build().to(representation).update(next).commit();
}

/** Works for any state ref: pass a representation ref to toggle a single representation. */
export function setStructureVisibility(plugin: PluginContext, loaded: LoadedStructure, visible: boolean): void {
  setSubtreeVisibility(plugin.state.data, loaded.structure.ref, !visible);
}

export async function setRepresentationAlpha(
  plugin: PluginContext,
  representation: RepresentationSelector,
  alpha: number,
): Promise<void> {
  const update = plugin.build().to(representation).update((old) => {
    old.type.params.alpha = alpha;
  });
  await update.commit();
}
