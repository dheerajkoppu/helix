/**
 * Hand-written glossary behind Learn Mode. Definitions are short, literal and written for a reader
 * who knows school biology. Add terms here; never generate them at runtime.
 */
export type GlossaryCategory =
  | "genetics"
  | "protein"
  | "structure"
  | "confidence"
  | "interaction"
  | "evidence";

export interface GlossaryEntry {
  term: string;
  category: GlossaryCategory;
  /** one or two sentences shown on hover */
  definition: string;
  /** optional second paragraph shown beneath */
  detail?: string;
}

export const GLOSSARY_VERSION = "2026-10-03";

export const GLOSSARY = {
  "pathogenic-variant": {
    term: "Pathogenic variant",
    category: "genetics",
    definition:
      "A change in DNA sequence that a clinical database has classified as causing disease. The classification belongs to the database and its reviewers, and it comes with a review status.",
    detail:
      '"Likely pathogenic" is a weaker classification. A "variant of uncertain significance" has too little evidence either way.',
  },
  "missense-mutation": {
    term: "Missense mutation",
    category: "genetics",
    definition:
      "A single-letter DNA change that swaps one amino acid in the protein for another. p.Arg28His means arginine at position 28 became histidine.",
  },
  variant: {
    term: "Variant",
    category: "genetics",
    definition:
      "Any difference from the reference DNA sequence. Most variants are harmless; some change a protein enough to cause disease.",
  },
  residue: {
    term: "Residue",
    category: "protein",
    definition:
      "One amino acid at a numbered position in a protein chain. OrphaFold numbers residues by the UniProt canonical sequence, so residue 28 means the same thing in every view.",
  },
  "protein-domain": {
    term: "Protein domain",
    category: "protein",
    definition:
      "A stretch of a protein that folds into its own compact unit and usually has its own job, such as binding DNA or another protein.",
  },
  isoform: {
    term: "Isoform",
    category: "protein",
    definition:
      "One of several protein versions made from the same gene. The canonical isoform is the one UniProt uses as the reference for numbering.",
  },
  ligand: {
    term: "Ligand",
    category: "interaction",
    definition:
      "A molecule that binds to a protein. It can be a drug, a natural small molecule, a metal ion or another biological molecule.",
  },
  "binding-affinity": {
    term: "Binding affinity",
    category: "interaction",
    definition:
      "How tightly a ligand holds on to a protein. Tighter binding means a lower concentration is needed to occupy the site.",
    detail:
      "A predicted affinity is a model output for comparing candidate molecules. It is not a measurement and not a statement about treatment.",
  },
  "binding-site": {
    term: "Binding site",
    category: "interaction",
    definition:
      "The residues on a protein surface that contact a ligand or partner molecule. A pocket is a cavity that could act as one.",
  },
  plddt: {
    term: "pLDDT",
    category: "confidence",
    definition:
      "A structure model's own confidence in each residue's local structure, from 0 to 100. Above 90 is very high; below 50 should not be interpreted.",
    detail:
      "It says nothing about how separate domains or chains are placed relative to each other.",
  },
  pae: {
    term: "PAE",
    category: "confidence",
    definition:
      "Predicted aligned error: the expected error in the position of one residue, in ångströms, when the structure is aligned on another. Low values mean the two parts are confidently placed relative to each other.",
  },
  ptm: {
    term: "pTM",
    category: "confidence",
    definition:
      "Predicted TM-score: one number from 0 to 1 for the model's confidence in the overall fold. Above 0.5 suggests the fold might be similar to the true structure.",
  },
  iptm: {
    term: "ipTM",
    category: "confidence",
    definition:
      "Interface predicted TM-score: confidence, from 0 to 1, in how two or more chains are placed against each other. Above 0.8 is confident; below 0.6 suggests the interface prediction failed.",
  },
  msa: {
    term: "MSA",
    category: "structure",
    definition:
      "Multiple sequence alignment: related protein sequences from many species lined up position by position. Structure models read it to find residues that change together during evolution.",
  },
  conservation: {
    term: "Conservation",
    category: "genetics",
    definition:
      "How little a position has changed across species. A highly conserved residue has stayed the same through evolution, which suggests changes there are poorly tolerated.",
  },
  "allele-frequency": {
    term: "Allele frequency",
    category: "genetics",
    definition:
      "The fraction of chromosomes in a population database that carry a variant. A variant that causes a severe rare disease is expected to be very rare.",
  },
  "autosomal-recessive": {
    term: "Autosomal recessive (AR)",
    category: "genetics",
    definition:
      "Disease appears when both copies of a gene on a non-sex chromosome carry a pathogenic variant. Carriers with one affected copy are usually healthy.",
  },
  "autosomal-dominant": {
    term: "Autosomal dominant (AD)",
    category: "genetics",
    definition:
      "One altered copy of a gene on a non-sex chromosome is enough to cause disease.",
  },
  "x-linked": {
    term: "X-linked (XL)",
    category: "genetics",
    definition:
      "The gene is on the X chromosome. Males have one X, so a single pathogenic variant usually causes disease in males, while females with one affected copy are often carriers.",
  },
  "gain-of-function": {
    term: "Gain of function (GOF)",
    category: "genetics",
    definition:
      "The variant makes the protein more active than normal, or active when it should be off.",
  },
  "loss-of-function": {
    term: "Loss of function (LOF)",
    category: "genetics",
    definition: "The variant reduces or removes the protein's normal activity.",
  },
  "dominant-negative": {
    term: "Dominant negative (DN)",
    category: "genetics",
    definition:
      "The altered protein interferes with the normal protein made from the other copy of the gene, so one altered copy is enough to cause disease.",
  },
  haploinsufficiency: {
    term: "Haploinsufficiency",
    category: "genetics",
    definition:
      "One working copy of the gene does not make enough protein for normal function.",
  },
  "experimental-structure": {
    term: "Experimental structure",
    category: "structure",
    definition:
      "Atomic coordinates determined in a laboratory by X-ray crystallography, cryo-electron microscopy or NMR, and deposited in the Protein Data Bank.",
  },
  "predicted-structure": {
    term: "Predicted structure",
    category: "structure",
    definition:
      "Atomic coordinates computed by a model from the protein sequence. It is a hypothesis about the structure and always carries confidence values.",
  },
  resolution: {
    term: "Resolution",
    category: "structure",
    definition:
      "How much detail an experimental structure shows, in ångströms. Smaller numbers mean finer detail: at 2 Å individual side chains are clear.",
  },
  "delta-delta-g": {
    term: "ΔΔG",
    category: "structure",
    definition:
      "The predicted change in a protein's folding stability caused by a variant, in kcal/mol. Positive values mean the variant is predicted to be less stable.",
  },
  "evidence-class": {
    term: "Evidence class",
    category: "evidence",
    definition:
      "Where a statement comes from: an experiment, a clinical database, a paper, a curated database, a computational prediction or an OrphaFold hypothesis. Every statement in OrphaFold carries one.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTermId = keyof typeof GLOSSARY;

export function glossaryEntry(id: GlossaryTermId): GlossaryEntry {
  return GLOSSARY[id];
}

export const GLOSSARY_TERM_IDS = Object.keys(GLOSSARY) as GlossaryTermId[];
