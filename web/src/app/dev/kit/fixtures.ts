/**
 * Specimen data for the design kit. Every value is a real record quoted in docs/research
 * (retrieved 2026-10-03) and is used here only to show how components render. Nothing in the
 * product reads this file.
 *
 * BTK p.Arg28His, UniProt Q06187: docs/research/variant-effect.md, section 2.
 * STAT1 structures, UniProt P42224: docs/research/ux-research.md, section 4.3.
 * Boltz output format example: docs/research/structure-models.md, section 6.4.
 */
import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceItem } from "@/lib/evidence";
import type { StructureOrigin } from "@/lib/structure-origin";

export const KIT_EVIDENCE: EvidenceItem[] = [
  {
    evidenceClass: "experimental",
    statement: "Residue 28 of BTK is annotated as a binding site.",
    source: {
      database: "UniProt",
      recordId: "Q06187",
      release: "2026_03",
      retrievedAt: "2026-10-03",
      url: "https://www.uniprot.org/uniprotkb/Q06187",
      license: "CC BY 4.0",
    },
    method: "ECO:0000269, PubMed:10196129",
  },
  {
    evidenceClass: "clinical_database",
    statement:
      "BTK p.Arg28His is classified Pathogenic. Last evaluated 2025-02-06.",
    source: {
      database: "ClinVar",
      recordId: "VCV000011348",
      release: "2026-09-28",
      retrievedAt: "2026-10-03",
      url: "https://www.ncbi.nlm.nih.gov/clinvar/variation/11348/",
    },
    strength: {
      scheme: "clinvar_review_status",
      value: "criteria provided, multiple submitters, no conflicts",
      rank: 2,
      maxRank: 4,
    },
  },
  {
    evidenceClass: "curated_database",
    statement: "In XLA; moderate; dbSNP:rs128620185.",
    source: {
      database: "UniProt",
      recordId: "VAR_006220",
      release: "2026_03",
      retrievedAt: "2026-10-03",
      url: "https://www.uniprot.org/uniprotkb/Q06187",
      license: "CC BY 4.0",
    },
    modifiers: ["natural variant"],
  },
  {
    evidenceClass: "literature",
    statement:
      "Publication cited for the binding-site annotation at residue 28.",
    source: {
      database: "PubMed",
      recordId: "PMID:10196129",
      url: "https://pubmed.ncbi.nlm.nih.gov/10196129/",
    },
  },
  {
    evidenceClass: "computational_prediction",
    statement:
      "FoldX ΔΔG of -0.755 kcal/mol for p.Arg28His on AF-Q06187-F1. Residue pLDDT 94.26.",
    source: {
      database: "EBI ProtVar",
      recordId: "Q06187:28:H",
      release: "ProtVar data 2.1",
      retrievedAt: "2026-10-03T16:36:10Z",
      url: "https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/Q06187/28?variantAA=H",
      license: "CC BY 4.0",
    },
    method: "FoldX v5.0",
  },
  {
    evidenceClass: "orphafold_hypothesis",
    statement:
      "Kit example of the hypothesis form: p.Arg28His may act through the binding site at residue 28 rather than through fold stability.",
    source: null,
  },
];

/** One row per source state. Releases are the real ones; the failure rows only demonstrate each state. */
export const KIT_SOURCES: SourceStatus[] = [
  {
    source: "uniprot",
    name: "UniProt",
    state: "ok",
    release: "2026_03",
    retrieved_at: "2026-10-03",
  },
  {
    source: "clinvar",
    name: "ClinVar",
    state: "ok",
    release: "2026-09-28",
    retrieved_at: "2026-10-03",
    from_cache: true,
  },
  {
    source: "afdb",
    name: "AlphaFold DB",
    state: "ok",
    release: "v6",
    retrieved_at: "2026-10-03",
  },
  {
    source: "afdb_complex",
    name: "AlphaFold DB complexes",
    state: "empty",
    message: "HTTP 404 with an empty body",
  },
  {
    source: "rcsb",
    name: "RCSB PDB",
    state: "unavailable",
    message: "timeout after 30 s",
  },
  { source: "cadd", name: "CADD", state: "disabled_by_license" },
  { source: "boltz2", name: "Boltz-2 worker", state: "not_configured" },
];

export interface KitStructureRow {
  id: string;
  origin: StructureOrigin;
  method: string;
  /** ångström for experimental structures */
  resolution: number | null;
  /** mean pLDDT for predicted structures */
  meanPlddt: number | null;
}

export const KIT_STRUCTURES: KitStructureRow[] = [
  {
    id: "pdb:1BF5",
    origin: "experimental",
    method: "X-ray",
    resolution: 2.9,
    meanPlddt: null,
  },
  {
    id: "pdb:1YVL",
    origin: "experimental",
    method: "X-ray",
    resolution: 3.0,
    meanPlddt: null,
  },
  {
    id: "pdb:8YYU",
    origin: "experimental",
    method: "EM",
    resolution: 3.84,
    meanPlddt: null,
  },
  {
    id: "afdb:AF-P42224-F1",
    origin: "predicted_external",
    method: "AlphaFold DB v6",
    resolution: null,
    meanPlddt: 87.3,
  },
];

/** Format example from the Boltz documentation. Not the result of any run. */
export const KIT_BOLTZ_EXAMPLE = {
  ptm: 0.8425,
  iptm: 0.8225,
  affinity: 0.8367,
  binderProbability: 0.8425,
};

export const KIT_BTK = {
  gene: "BTK",
  accession: "Q06187",
  variantId: "BTK-p.Arg28His",
  variantLabel: "p.Arg28His",
  clinvarAccession: "VCV000011348",
  residuePlddt: 94.26,
  alphaMissense: 0.9978,
  foldxDdg: -0.755,
};
