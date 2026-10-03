import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Mat4 } from "molstar/lib/mol-math/linear-algebra";
import { StructureElement } from "molstar/lib/mol-model/structure";
import { alignAndSuperpose } from "molstar/lib/mol-model/structure/structure/util/superposition";
import { tmAlign } from "molstar/lib/mol-model/structure/structure/util/tm-align";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import type { LoadedStructure } from "./load";

export interface ChainRef {
  /** auth_asym_id, or label_asym_id when numbering is "label" */
  chain: string;
  numbering?: "label" | "auth";
}

export interface SuperpositionResult {
  method: "sequence-ca" | "tm-align";
  /** C-alpha RMSD in angstrom over the aligned residue pairs */
  rmsd: number;
  alignedResidues: number;
  referenceCaCount: number;
  mobileCaCount: number;
  alignmentScore?: number;
  tmScoreReference?: number;
  tmScoreMobile?: number;
  /** column-major 4x4 to apply to the mobile structure */
  transform: number[];
}

const SUPERPOSITION_TAG = "orphafold-superposition";

function caLoci(loaded: LoadedStructure, chain: ChainRef): StructureElement.Loci {
  // untransformed coordinates on purpose, so a new transform replaces the old one instead of stacking
  const structure = loaded.structure.cell?.obj?.data;
  if (!structure) throw new Error("Structure is not loaded");
  const chainKey = chain.numbering === "label" ? "label_asym_id" : "auth_asym_id";
  return StructureElement.Loci.fromSchema(structure, { [chainKey]: chain.chain, label_atom_id: "CA" });
}

export function computeSuperposition(
  reference: LoadedStructure,
  referenceChain: ChainRef,
  mobile: LoadedStructure,
  mobileChain: ChainRef,
  method: "sequence-ca" | "tm-align" = "sequence-ca",
): SuperpositionResult {
  const referenceLoci = caLoci(reference, referenceChain);
  const mobileLoci = caLoci(mobile, mobileChain);
  const counts = {
    referenceCaCount: StructureElement.Loci.size(referenceLoci),
    mobileCaCount: StructureElement.Loci.size(mobileLoci),
  };
  if (counts.referenceCaCount < 3 || counts.mobileCaCount < 3) throw new Error("Not enough C-alpha atoms to superpose");
  // alignAndSuperpose only reads the first unit of each loci
  if (referenceLoci.elements.length !== 1 || mobileLoci.elements.length !== 1) {
    throw new Error("Superposition expects exactly one chain per structure");
  }

  if (method === "tm-align") {
    const result = tmAlign(referenceLoci, mobileLoci);
    const { rmsd, alignedLength, tmScoreA, tmScoreB, bTransform } = result;
    const scores = { tmScoreReference: tmScoreA, tmScoreMobile: tmScoreB };
    return { method, rmsd, alignedResidues: alignedLength, ...counts, ...scores, transform: Array.from(bTransform) };
  }
  const [result] = alignAndSuperpose([referenceLoci, mobileLoci]);
  const { rmsd, nAlignedElements, alignmentScore, bTransform } = result;
  return { method, rmsd, alignedResidues: nAlignedElements, ...counts, alignmentScore, transform: Array.from(bTransform) };
}

/** Inserts, or updates, the transform node that decorates the mobile structure. */
export async function applySuperposition(plugin: PluginContext, mobile: LoadedStructure, transform: number[]): Promise<void> {
  const existing = plugin.state.data.selectQ((q) => q.byRef(mobile.structure.ref).subtree().withTag(SUPERPOSITION_TAG));
  const params = {
    transform: { name: "matrix" as const, params: { data: Mat4.fromArray(Mat4(), transform, 0), transpose: false } },
  };
  const update = plugin.build();
  if (existing.length > 0) update.to(existing[0]).update(params);
  else update.to(mobile.structure).insert(StateTransforms.Model.TransformStructureConformation, params, { tags: SUPERPOSITION_TAG });
  await update.commit();
}

export function clearSuperposition(plugin: PluginContext, mobile: LoadedStructure): Promise<void> {
  return applySuperposition(plugin, mobile, Array.from(Mat4.identity()));
}
