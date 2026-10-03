import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec, PluginSpec } from "molstar/lib/mol-plugin/spec";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { PluginBehaviors } from "molstar/lib/mol-plugin/behavior";
import { StructureFocusRepresentation } from "molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation";
import { PLDDTConfidenceColorThemeProvider } from "molstar/lib/extensions/model-archive/quality-assessment/color/plddt";
import { Color } from "molstar/lib/mol-util/color";

export interface CreateViewerOptions {
  backgroundColor: number;
  reducedMotion: boolean;
  /** clicking a residue adds ball-and-stick for it and its 5 A surroundings */
  focusOnClick?: boolean;
  pixelScale?: number;
}

export function createViewerSpec(options: CreateViewerOptions): PluginSpec {
  const cameraDurationMs = options.reducedMotion ? 0 : 250;
  const behaviors: PluginSpec.Behavior[] = [
    PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
    PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
    PluginSpec.Behavior(PluginBehaviors.Representation.DefaultLociLabelProvider),
    PluginSpec.Behavior(PluginBehaviors.Camera.FocusLoci, { durationMs: cameraDurationMs }),
    PluginSpec.Behavior(PluginBehaviors.Camera.CameraControls),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.Interactions),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.SecondaryStructure),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.ValenceModel),
  ];
  if (options.focusOnClick) {
    behaviors.push(
      PluginSpec.Behavior(PluginBehaviors.Representation.FocusLoci),
      PluginSpec.Behavior(StructureFocusRepresentation),
    );
  }
  return {
    ...DefaultPluginSpec(),
    behaviors,
    animations: [],
    canvas3d: {
      renderer: { backgroundColor: Color(options.backgroundColor), enableAnimation: !options.reducedMotion },
      cameraResetDurationMs: cameraDurationMs,
      // manualReset stops Mol* from re-framing the scene on its own whenever the scene bounds change
      camera: { manualReset: true, helper: { axes: { name: "off", params: {} } } },
      trackball: { animate: { name: "off", params: {} } },
    },
    config: [
      [PluginConfig.General.PixelScale, options.pixelScale ?? 1],
      [PluginConfig.VolumeStreaming.Enabled, false],
    ],
  };
}

export interface ViewerInstance {
  plugin: PluginContext;
  dispose(): void;
}

/** `target` must be positioned (position: relative) and have a non-zero size. */
export async function createViewer(target: HTMLElement, options: CreateViewerOptions): Promise<ViewerInstance> {
  const plugin = new PluginContext(createViewerSpec(options));
  await plugin.init();
  plugin.representation.structure.themes.colorThemeRegistry.add(PLDDTConfidenceColorThemeProvider);

  // creates its own wrapper div and canvas inside target, removed again by dispose()
  if (!(await plugin.mountAsync(target))) {
    plugin.dispose();
    throw new Error("Mol* could not create a WebGL context");
  }
  await plugin.canvas3dInitialized;
  return { plugin, dispose: () => plugin.dispose() };
}
