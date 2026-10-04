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
        if (previousId !== null && previousId !== (incoming?.id ?? null))
          changed.add(kind);
        next[kind] = incoming;
      }
      for (const kind of SUBJECT_KINDS) {
        if (kind in links) continue;
        if (TIED_TO[kind].some((other) => changed.has(other)))
          next[kind] = null;
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
  {
    id: "candidates",
    number: 7,
    label: "Candidates",
    short: "Candidates",
    key: "n",
  },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/**
 * Simple mode asks three questions instead of walking seven stages. Every stage still exists and
 * every route still works: a group opens its first stage, or stays on the one already open.
 * `opens` is tried in order, so the group lands on the page the reader expects.
 */
export const STAGE_GROUPS = [
  {
    id: "mutation",
    number: 1,
    stages: ["disease", "gene", "protein", "compare"],
    opens: ["gene", "disease", "protein", "compare"],
  },
  { id: "breaks", number: 2, stages: ["mechanism"], opens: ["mechanism"] },
  {
    id: "help",
    number: 3,
    stages: ["intervention", "candidates"],
    opens: ["candidates", "intervention"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  number: number;
  stages: readonly StageId[];
  opens: readonly StageId[];
}>;

export type StageGroupId = (typeof STAGE_GROUPS)[number]["id"];

/** The group a stage belongs to. */
export function groupOfStage(stage: StageId | null): StageGroupId | null {
  if (!stage) return null;
  return (
    STAGE_GROUPS.find((group) =>
      (group.stages as readonly StageId[]).includes(stage),
    )?.id ?? null
  );
}

export interface StageGroupTarget {
  /** the stage the group opens: the active one when it is inside the group */
  stage: StageId | null;
  href: string | null;
}

/** Where a group leads for the current chain, keeping the reader on the page they are already on. */
export function resolveGroup(
  group: (typeof STAGE_GROUPS)[number],
  chain: SubjectChain,
  active: StageId | null,
): StageGroupTarget {
  const order: StageId[] =
    active && (group.stages as readonly StageId[]).includes(active)
      ? [active, ...group.opens]
      : [...group.opens];
  for (const stage of order) {
    const { href } = resolveStage(stage, chain);
    if (href) return { stage, href };
  }
  return { stage: null, href: null };
}

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
    case "candidates":
      return gene
        ? {
            href: routes.discover(gene.id, {
              disease: disease?.id,
              variant: variant?.id,
            }),
            subject: gene,
            missing: null,
          }
        : {
            href: null,
            subject: null,
            missing:
              "Candidates needs a gene. Open a disease or search for a gene.",
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
    case "discover":
      return "candidates";
    default:
      return null;
  }
}
