import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { InteractionsRepresentationProvider } from "molstar/lib/mol-model-props/computed/representations/interactions";
import { InteractionTypeColorThemeProvider } from "molstar/lib/mol-model-props/computed/themes/interaction-type";
import type { LoadedStructure } from "./load";
import { getStructureData } from "./selection";

export interface LigandSelector {
  compId: string;
  authAsymId?: string;
  authSeqId?: number;
}

export interface BindingSiteResidue {
  labelAsymId: string;
  authAsymId: string;
  labelSeqId: number;
  authSeqId: number;
  compId: string;
}

export interface BindingSite {
  /** state refs of the added components, delete them to hide the site */
  refs: string[];
  residues: BindingSiteResidue[];
}

export async function showBindingSite(
  plugin: PluginContext,
  loaded: LoadedStructure,
  ligand: LigandSelector,
  radius = 5,
  focusDurationMs = 250,
): Promise<BindingSite | undefined> {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return undefined;

  const ligandExpression = StructureElement.Schema.toExpression({
    label_comp_id: ligand.compId,
    auth_asym_id: ligand.authAsymId,
    auth_seq_id: ligand.authSeqId,
  });
  const ligandWithSite = MS.struct.modifier.includeSurroundings({ 0: ligandExpression, radius, "as-whole-residues": true });
  const siteOnly = MS.struct.modifier.exceptBy({ 0: ligandWithSite, by: ligandExpression });

  const residues: BindingSiteResidue[] = [];
  const seen = new Set<string>();
  StructureElement.Loci.forEachLocation(StructureElement.Loci.fromExpression(structure, siteOnly), (location) => {
    if (StructureProperties.entity.type(location) === "water") return;
    const residue: BindingSiteResidue = {
      labelAsymId: StructureProperties.chain.label_asym_id(location),
      authAsymId: StructureProperties.chain.auth_asym_id(location),
      labelSeqId: StructureProperties.residue.label_seq_id(location),
      authSeqId: StructureProperties.residue.auth_seq_id(location),
      compId: StructureProperties.atom.label_comp_id(location),
    };
    const residueKey = `${residue.labelAsymId}:${residue.authSeqId}:${residue.compId}`;
    if (seen.has(residueKey)) return;
    seen.add(residueKey);
    residues.push(residue);
  });

  const refs: string[] = [];
  const builder = plugin.builders.structure;
  await plugin.dataTransaction(async () => {
    const key = ligand.compId;
    const ligandComponent = await builder.tryCreateComponentFromExpression(loaded.structure, ligandExpression, `ligand-${key}`);
    if (ligandComponent) {
      refs.push(ligandComponent.ref);
      await builder.representation.addRepresentation(ligandComponent, {
        type: "ball-and-stick",
        color: "element-symbol",
        colorParams: { carbonColor: { name: "element-symbol", params: {} } },
        typeParams: { sizeFactor: 0.3 },
      });
    }
    const siteComponent = await builder.tryCreateComponentFromExpression(loaded.structure, siteOnly, `site-${key}`);
    if (siteComponent) {
      refs.push(siteComponent.ref);
      const sticks = { type: "ball-and-stick", color: "element-symbol", typeParams: { sizeFactor: 0.16 } } as const;
      await builder.representation.addRepresentation(siteComponent, sticks);
    }
    const contactsComponent = await builder.tryCreateComponentFromExpression(loaded.structure, ligandWithSite, `contacts-${key}`);
    if (contactsComponent) {
      refs.push(contactsComponent.ref);
      await builder.representation.addRepresentation(contactsComponent, {
        type: InteractionsRepresentationProvider,
        color: InteractionTypeColorThemeProvider,
      });
    }
  });

  plugin.managers.camera.focusLoci(StructureElement.Loci.fromExpression(structure, ligandWithSite), {
    extraRadius: 2,
    durationMs: focusDurationMs,
  });
  return { refs, residues };
}

export async function removeRefs(plugin: PluginContext, refs: string[]): Promise<void> {
  const update = plugin.build();
  for (const ref of refs) update.delete(ref);
  await update.commit();
}
