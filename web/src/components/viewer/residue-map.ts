import type { ResidueRange } from "@/lib/state/selection";
import type { StructureOrigin } from "@/lib/structure-origin";

import type {
  ResidueMap,
  ResiduePick,
  StructureChainSummary,
  ViewerResidueRange,
} from "./types";

/**
 * Predicted models are numbered by UniProt position in label_seq_id. PDB entries usually carry
 * the UniProt position in auth_seq_id; when they do not, the page passes a SIFTS-derived map.
 */
export const defaultResidueMap = (origin: StructureOrigin): ResidueMap => ({
  numbering: origin === "experimental" ? "auth" : "label",
});

export function toStructureSeq(
  map: ResidueMap,
  position: number,
): number | null {
  if (!map.segments) return position + (map.offset ?? 0);
  const segment = map.segments.find(
    (entry) => position >= entry.uniprotStart && position <= entry.uniprotEnd,
  );
  return segment
    ? segment.structureStart + (position - segment.uniprotStart)
    : null;
}

export function toUniProtPosition(
  map: ResidueMap,
  seqId: number,
): number | null {
  if (!map.segments) return seqId - (map.offset ?? 0);
  for (const segment of map.segments) {
    const position = segment.uniprotStart + (seqId - segment.structureStart);
    if (position >= segment.uniprotStart && position <= segment.uniprotEnd)
      return position;
  }
  return null;
}

/** UniProt position of a 3D pick. */
export const pickPosition = (
  map: ResidueMap,
  pick: ResiduePick,
): number | null =>
  toUniProtPosition(
    map,
    map.numbering === "auth" ? pick.authSeqId : pick.labelSeqId,
  );

/** UniProt ranges to ranges the viewer can address on one chain. Unmapped stretches are dropped. */
export function mapRanges(
  map: ResidueMap,
  chain: Pick<StructureChainSummary, "labelAsymId" | "authAsymId">,
  ranges: ResidueRange[],
): ViewerResidueRange[] {
  const asymId = map.numbering === "auth" ? chain.authAsymId : chain.labelAsymId;
  const mapped: ViewerResidueRange[] = [];
  const push = (start: number, end: number) =>
    mapped.push({ chain: asymId, start, end, numbering: map.numbering });
  for (const range of ranges) {
    if (!map.segments) {
      const offset = map.offset ?? 0;
      push(range.start + offset, range.end + offset);
      continue;
    }
    for (const segment of map.segments) {
      const start = Math.max(range.start, segment.uniprotStart);
      const end = Math.min(range.end, segment.uniprotEnd);
      if (start > end) continue;
      const shift = segment.structureStart - segment.uniprotStart;
      push(start + shift, end + shift);
    }
  }
  return mapped;
}
