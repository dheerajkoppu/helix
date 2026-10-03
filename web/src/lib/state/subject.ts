import { create } from "zustand";

import type { EvidenceClass } from "@/lib/evidence";
import { routes } from "@/lib/ids";
import type { StructureOrigin } from "@/lib/structure-origin";

export const SUBJECT_KINDS = [
  "disease",
  "gene",
  "protein",
  "variant",
  "structure",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** One link of the entity chain shown in the stage rail and the subject bar. */
export interface SubjectRef {
  /** URL-facing identifier: disease slug, HGNC symbol, UniProt accession, variant ID, structure ID */
  id: string;
  /** short display label, e.g. "BTK", "p.Arg28His", "X-linked agammaglobulinemia" */
  label: string;
  /** canonical source identifier shown in monospace, e.g. "HGNC:1133", "MONDO:0010421" */
  sourceId?: string | null;
  /** database that owns `sourceId`, e.g. "HGNC" */
  source?: string | null;
  /** link to the source record */
  href?: string | null;
  evidenceClass?: EvidenceClass | null;
  /** structures only */
  origin?: StructureOrigin | null;
}

export type SubjectChain = Partial<Record<SubjectKind, SubjectRef | null>>;

interface SubjectState {
  chain: SubjectChain;
  /** Merges links into the chain. Links tied to a changed link are dropped unless restated. */
  declare: (links: SubjectChain) => void;
  reset: () => void;
}

/**
 * Links are tied together: a link that is not restated is dropped when a link it is tied to is
 * replaced by a different one. A page that knows both the gene and the protein declares them in one call.
 */
const TIED_TO: Record<SubjectKind, SubjectKind[]> = {
  disease: [],
  gene: ["protein"],
  protein: ["gene"],
  variant: ["gene", "protein"],
  structure: ["protein"],
};

export const useWorkspaceSubjectStore = create<SubjectState>()((set) => ({
  chain: {},
  declare: (links) =>
    set((state) => {
      const next: SubjectChain = { ...state.chain };
      const changed = new Set<SubjectKind>();
      for (const kind of SUBJECT_KINDS) {
        if (!(kind in links)) continue;
        const incoming = links[kind] ?? null;
        const previousId = state.chain[kind]?.id ?? null;
        // Filling an empty link (a gene page resolving its protein) invalidates nothing.
        if (previousId !== null && previousId !== (incoming?.id ?? null)) changed.add(kind);
        next[kind] = incoming;
      }
      for (const kind of SUBJECT_KINDS) {
        if (kind in links) continue;
        if (TIED_TO[kind].some((other) => changed.has(other))) next[kind] = null;
      }
      return { chain: next };
    }),
  reset: () => set({ chain: {} }),
}));

export const STAGES = [
  { id: "disease", number: 1, label: "Disease", short: "Disease", key: "d" },
  {
    id: "gene",
    number: 2,
    label: "Gene and variants",
    short: "Gene",
    key: "g",
  },
  { id: "protein", number: 3, label: "Protein", short: "Protein", key: "p" },
  { id: "compare", number: 4, label: "Compare", short: "Compare", key: "c" },
  {
    id: "mechanism",
    number: 5,
    label: "Mechanism",
    short: "Mechanism",
    key: "m",
  },
  {
    id: "intervention",
    number: 6,
    label: "Intervention",
    short: "Intervention",
    key: "i",
  },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export interface StageTarget {
  /** null when the stage cannot be opened yet */
  href: string | null;
  /** the entity this stage would show */
  subject: SubjectRef | null;
  /** what is missing, phrased as the next action */
  missing: string | null;
}

/** Variant IDs are `GENE-p.Arg28His`; the compare route takes the change on its own. */
function variantChange(variant: SubjectRef): string {
  const separator = variant.id.indexOf("-p.");
  return separator > 0 ? variant.id.slice(separator + 1) : variant.id;
}

/** Where each stage leads for the current chain, or what it still needs. */
export function resolveStage(stage: StageId, chain: SubjectChain): StageTarget {
  const { disease, gene, protein, variant } = chain;
  switch (stage) {
    case "disease":
      return disease
        ? { href: routes.disease(disease.id), subject: disease, missing: null }
        : {
            href: null,
            subject: null,
            missing: "No disease in context. Search for one or open Explore.",
          };
    case "gene":
      return gene
        ? { href: routes.gene(gene.id), subject: gene, missing: null }
        : {
            href: null,
            subject: null,
            missing:
              "No gene in context. Pick a gene from a disease or search for one.",
          };
    case "protein":
      return protein
        ? { href: routes.protein(protein.id), subject: protein, missing: null }
        : {
            href: null,
            subject: null,
            missing: "No protein in context. Open a gene to reach its protein.",
          };
    case "compare":
      return gene && variant
        ? {
            href: routes.compare(gene.id, variantChange(variant)),
            subject: variant,
            missing: null,
          }
        : {
            href: null,
            subject: null,
            missing: "Compare needs a variant. Pick one in Gene and variants.",
          };
    case "mechanism":
      return variant
        ? {
            href: routes.mechanism(variant.id),
            subject: variant,
            missing: null,
          }
        : {
            href: null,
            subject: null,
            missing:
              "Mechanism needs a variant. Pick one in Gene and variants.",
          };
    case "intervention":
      return protein
        ? {
            href: routes.interventions(protein.id),
            subject: protein,
            missing: null,
          }
        : {
            href: null,
            subject: null,
            missing:
              "Intervention needs a protein. Open a gene to reach its protein.",
          };
  }
}

/** Stage for a pathname inside the workspace route group. */
export function stageFromPathname(pathname: string): StageId | null {
  const [, root, , leaf] = pathname.split("/");
  switch (root) {
    case "disease":
      return "disease";
    case "gene":
      return "gene";
    case "protein":
      return leaf === "interventions" ? "intervention" : "protein";
    case "variant":
      return leaf === "mechanism" ? "mechanism" : "gene";
    case "compare":
      return "compare";
    default:
      return null;
  }
}
