import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { StructureElement } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import type { LoadedStructure } from "./load";
import { getStructureData, lociForRanges, ResidueRange } from "./selection";

/** Adds a 3D text label anchored to a residue (range). Returns the state ref used to remove it. */
export async function addResidueLabel(
  plugin: PluginContext,
  loaded: LoadedStructure,
  range: ResidueRange,
  text: string,
  options: { textColor?: number; borderColor?: number; textSize?: number } = {},
): Promise<string | undefined> {
  const structure = getStructureData(plugin, loaded);
  if (!structure) return undefined;
  const loci = lociForRanges(structure, [range]);
  if (StructureElement.Loci.isEmpty(loci)) return undefined;

  const label = await plugin.managers.structure.measurement.addLabel(loci, {
    reprTags: "orphafold-label",
    visualParams: {
      customText: text,
      textColor: Color(options.textColor ?? 0x111111),
      borderColor: Color(options.borderColor ?? 0xffffff),
      borderWidth: 0.25,
      textSize: options.textSize ?? 1.4,
      scaleByRadius: false,
      background: true,
      backgroundMargin: 0.3,
      backgroundColor: Color(options.borderColor ?? 0xffffff),
      backgroundOpacity: 0.85,
      tether: true,
      tetherLength: 2,
      attachment: "bottom-left",
      // towards the camera, so the cartoon does not cut through the text
      offsetZ: 6,
    },
  });
  return label?.selection.ref;
}

export async function removeLabel(plugin: PluginContext, labelRef: string): Promise<void> {
  await plugin.build().delete(labelRef).commit();
}
