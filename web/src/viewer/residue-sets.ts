import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Structure, StructureElement, StructureProperties, Unit } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import type { LoadedStructure } from "./load";
import { getStructureData, ResidueRange } from "./selection";
import type { LigandSelector, StructureChainSummary, StructureSummary } from "./types";

function schemaFor(ranges: ResidueRange[]) {
  return {
    items: ranges.map((range) =>
      range.numbering === "auth"
        ? { auth_asym_id: range.chain, beg_auth_seq_id: range.start, end_auth_seq_id: range.end ?? range.start }
        : { label_asym_id: range.chain, beg_label_seq_id: range.start, end_label_seq_id: range.end ?? range.start },
    ),
  };
}

/** Adds ball-and-stick for a set of residues (variant site, pocket, annotated binding site). Returns the component ref. */
export async function showResidueSet(
  plugin: PluginContext,
  loaded: LoadedStructure,
  key: string,
  ranges: ResidueRange[],
  options: { color?: number; sizeFactor?: number } = {},
): Promise<string | undefined> {
  if (ranges.length === 0) return undefined;
  const expression = StructureElement.Schema.toExpression(schemaFor(ranges));
  const builder = plugin.builders.structure;
  let ref: string | undefined;
  await plugin.dataTransaction(async () => {
    const component = await builder.tryCreateComponentFromExpression(loaded.structure, expression, `residue-set-${key}`);
    if (!component) return;
    ref = component.ref;
    const carbonColor =
      options.color === undefined
        ? { name: "element-symbol" as const, params: {} }
        : { name: "uniform" as const, params: { value: Color(options.color), saturation: 0, lightness: 0 } };
    await builder.representation.addRepresentation(component, {
      type: "ball-and-stick",
      color: "element-symbol",
      colorParams: { carbonColor },
      typeParams: { sizeFactor: options.sizeFactor ?? 0.22 },
    });
  });
  return ref;
}

/** Chains, residue counts and bound components of a loaded structure, read from the coordinates. */
export function summarizeStructure(plugin: PluginContext, loaded: LoadedStructure): StructureSummary | undefined {
  const structure: Structure | undefined = getStructureData(plugin, loaded);
  if (!structure) return undefined;
  const chains = new Map<string, StructureChainSummary>();
  const ligands: LigandSelector[] = [];
  let entryId = "";
  let residueCount = 0;

  const location = StructureElement.Location.create(structure);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    location.unit = unit;
    let lastResidue = -1;
    for (let index = 0; index < unit.elements.length; index++) {
      const element = unit.elements[index];
      const residueIndex = unit.residueIndex[element];
      if (residueIndex === lastResidue) continue;
      lastResidue = residueIndex;
      location.element = element;
      if (!entryId) entryId = StructureProperties.unit.model_entry_id(location);

      const entityType = StructureProperties.entity.type(location);
      if (entityType === "water") continue;
      const labelAsymId = StructureProperties.chain.label_asym_id(location);
      const authAsymId = StructureProperties.chain.auth_asym_id(location);
      const labelSeqId = StructureProperties.residue.label_seq_id(location);
      const authSeqId = StructureProperties.residue.auth_seq_id(location);

      if (entityType !== "polymer") {
        ligands.push({ compId: StructureProperties.atom.label_comp_id(location), authAsymId, authSeqId });
        continue;
      }
      residueCount += 1;
      const chain = chains.get(labelAsymId);
      if (chain) {
        chain.residueCount += 1;
        chain.labelSeqRange = [Math.min(chain.labelSeqRange[0], labelSeqId), Math.max(chain.labelSeqRange[1], labelSeqId)];
        chain.authSeqRange = [Math.min(chain.authSeqRange[0], authSeqId), Math.max(chain.authSeqRange[1], authSeqId)];
      } else {
        chains.set(labelAsymId, {
          labelAsymId,
          authAsymId,
          entityId: StructureProperties.chain.label_entity_id(location),
          residueCount: 1,
          labelSeqRange: [labelSeqId, labelSeqId],
          authSeqRange: [authSeqId, authSeqId],
        });
      }
    }
  }
  return { entryId, residueCount, chains: Array.from(chains.values()), ligands };
}
