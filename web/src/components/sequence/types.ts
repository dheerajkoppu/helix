/**
 * Contract for the persistent sequence axis dock. All positions are UniProt canonical, 1-based,
 * inclusive.
 */
import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceClass } from "@/lib/evidence";
import type { ClinicalSignificance } from "@/lib/science/clinical-significance";
import type { ResidueRange } from "@/lib/state/selection";
import type { StructureOrigin } from "@/lib/structure-origin";

export type { ResidueRange };

export type SequenceTrackKind =
  | "domain"
  | "region"
  | "site"
  | "secondary_structure"
  | "coverage"
  | "confidence"
  | "pathogenicity"
  | "conservation"
  | "custom";

export type SecondaryStructureType = "helix" | "strand" | "turn";

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
  /** secondary structure rows: the element type, drawn as a distinct shape */
  secondaryStructure?: SecondaryStructureType;
}

export interface SequenceTrack {
  id: string;
  /** row label in the gutter: "Domains", "pLDDT" */
  label: string;
  kind: SequenceTrackKind;
  /** source and release for the row, e.g. "UniProt 2026_03" */
  source?: string | null;
  /** evidence class of the whole row; a feature's own class wins */
  evidenceClass?: EvidenceClass;
  features?: SequenceFeature[];
  /**
   * per-residue values, index 0 is residue 1. "confidence": pLDDT on the 0 to 100 scale.
   * "pathogenicity": AlphaMissense score 0 to 1. "conservation": 0 to 1.
   */
  values?: Array<number | null>;
  /** what one value is, for tooltips and the table: "mean over 19 substitutions" */
  valueLabel?: string;
  /** false keeps the row out of the default set; the track picker can turn it on */
  defaultVisible?: boolean;
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
  /** database the record came from: "ClinVar", "UniProt", "gnomAD v4.1.0" */
  source?: string | null;
  evidenceClass?: EvidenceClass;
  /** the source's own wording, e.g. a disease name or a consequence term */
  description?: string | null;
}

export interface SequenceAxisDockProps {
  /** UniProt accession the numbering refers to */
  accession: string;
  /** canonical sequence in one-letter codes; index 0 is residue 1 */
  sequence: string;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
  /** state of the variant source, so an empty variant list can say whether nothing exists or the source failed */
  variantStatus?: SourceStatus | null;
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
  /** "strip" draws one slim row of domains and variant marks; default is the full axis */
  mode?: "full" | "strip";
  /** strip mode: shows the Expand control */
  onExpand?: () => void;
  className?: string;
}
