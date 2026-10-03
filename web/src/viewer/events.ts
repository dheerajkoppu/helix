import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { Loci } from "molstar/lib/mol-model/loci";
import { Bond, StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { ButtonsType } from "molstar/lib/mol-util/input/input-observer";

export interface ResiduePick {
  /** state ref of the structure node the pick belongs to */
  structureRef: string | undefined;
  entryId: string;
  labelAsymId: string;
  authAsymId: string;
  labelSeqId: number;
  authSeqId: number;
  insertionCode: string;
  compId: string;
  atomName: string;
  bFactor: number;
}

export interface PickInfo {
  button: "primary" | "secondary" | "other";
  shift: boolean;
}

export interface PickHandlers {
  onHover?: (pick: ResiduePick | undefined) => void;
  onClick?: (pick: ResiduePick | undefined, info: PickInfo) => void;
}

export function lociToResiduePick(plugin: PluginContext, loci: Loci): ResiduePick | undefined {
  const elementLoci = StructureElement.Loci.is(loci) ? loci : Bond.isLoci(loci) ? Bond.toStructureElementLoci(loci) : undefined;
  if (!elementLoci) return undefined;
  const location = StructureElement.Loci.getFirstLocation(elementLoci);
  if (!location) return undefined;
  return {
    structureRef: plugin.helpers.substructureParent.get(elementLoci.structure)?.transform.ref,
    entryId: StructureProperties.unit.model_entry_id(location),
    labelAsymId: StructureProperties.chain.label_asym_id(location),
    authAsymId: StructureProperties.chain.auth_asym_id(location),
    labelSeqId: StructureProperties.residue.label_seq_id(location),
    authSeqId: StructureProperties.residue.auth_seq_id(location),
    insertionCode: StructureProperties.residue.pdbx_PDB_ins_code(location),
    compId: StructureProperties.atom.label_comp_id(location),
    atomName: StructureProperties.atom.label_atom_id(location),
    bFactor: StructureProperties.atom.B_iso_or_equiv(location),
  };
}

/** Returns an unsubscribe function. */
export function subscribePicks(plugin: PluginContext, handlers: PickHandlers): () => void {
  let lastHoverKey = "";
  const hover = plugin.behaviors.interaction.hover.subscribe(({ current }) => {
    const pick = lociToResiduePick(plugin, current.loci);
    const key = pick ? `${pick.structureRef}|${pick.labelAsymId}|${pick.authSeqId}|${pick.insertionCode}` : "";
    if (key === lastHoverKey) return;
    lastHoverKey = key;
    handlers.onHover?.(pick);
  });

  // BehaviorSubject replays its stale initial value on subscribe, which is not a user click
  let isInitialClick = true;
  const click = plugin.behaviors.interaction.click.subscribe(({ current, button, modifiers }) => {
    if (isInitialClick) {
      isInitialClick = false;
      return;
    }
    const { Primary, Secondary } = ButtonsType.Flag;
    const pressed = button === Primary ? "primary" : button === Secondary ? "secondary" : "other";
    handlers.onClick?.(lociToResiduePick(plugin, current.loci), { button: pressed, shift: modifiers.shift });
  });

  return () => {
    hover.unsubscribe();
    click.unsubscribe();
  };
}
