/**
 * Contract for the persistent sequence axis dock. The sequence specialist replaces the
 * implementation in this directory and keeps every exported name. All positions are UniProt
 * canonical, 1-based, inclusive.
 */
import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceClass } from "@/lib/evidence";
import type { ClinicalSignificance } from "@/lib/science/clinical-significance";
import type { ResidueRange } from "@/lib/state/selection";
import type { StructureOrigin } from "@/lib/structure-origin";

export type { ResidueRange };

export type SequenceTrackKind =
  "domain" | "site" | "coverage" | "confidence" | "custom";

export interface SequenceFeature {
  id: string;
  start: number;
  end: number;
  label?: string;
  description?: string;
  evidenceClass?: EvidenceClass;
  /** source record for this feature, e.g. a UniProt feature ID or a PDB ID */
  sourceId?: string | null;
  /** coverage rows: which structure class covers this stretch */
  origin?: StructureOrigin;
}

export interface SequenceTrack {
  id: string;
  /** row label in the gutter: "Domains", "pLDDT" */
  label: string;
  kind: SequenceTrackKind;
  /** source and release for the row, e.g. "UniProt 2026_03" */
  source?: string | null;
  features?: SequenceFeature[];
  /** per-residue values, index 0 is residue 1. For kind "confidence": pLDDT on the 0 to 100 scale. */
  values?: Array<number | null>;
  /** when the source had no data or failed, the row stays and says so */
  status?: SourceStatus;
}

export type VariantConsequence =
  | "missense"
  | "loss_of_function"
  | "splice"
  | "inframe"
  | "synonymous"
  | "other";

export interface SequenceVariant {
  /** variant ID as used in URLs: "BTK-p.Arg28His" or a ClinVar VCV accession */
  id: string;
  position: number;
  /** one-letter codes */
  reference: string;
  alternate: string;
  /** display label: "p.Arg28His" */
  label: string;
  consequence: VariantConsequence;
  /** database classification; null for population variants without one */
  significance: ClinicalSignificance | null;
  /** ClinVar gold stars 0 to 4 */
  reviewStars?: number | null;
  alleleFrequency?: number | null;
  /** clinical variants sit above the axis, population variants below */
  group: "clinical" | "population";
  sourceId?: string | null;
}

export interface SequenceAxisDockProps {
  /** UniProt accession the numbering refers to */
  accession: string;
  /** canonical sequence in one-letter codes; index 0 is residue 1 */
  sequence: string;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
  /** selected residue ranges from the workspace selection */
  selection: ResidueRange[];
  selectedVariantId?: string | null;
  /** position under the pointer anywhere in the workspace, from the hover channel */
  hoverPosition?: number | null;
  /** visible window; null or undefined shows the default view */
  window?: ResidueRange | null;
  /** `additive` is true for Cmd/Ctrl+click */
  onSelect: (ranges: ResidueRange[], info: { additive: boolean }) => void;
  onSelectVariant?: (variant: SequenceVariant) => void;
  /** null when the pointer leaves the axis */
  onHover: (position: number | null) => void;
  onWindowChange?: (window: ResidueRange | null) => void;
  className?: string;
}
