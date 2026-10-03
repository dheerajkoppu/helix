"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { decodeParam } from "@/lib/ids";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useWorkspaceSubjectStore } from "@/lib/state/subject";

import type { ChatContext } from "./types";

export interface ContextChip {
  kind: string;
  value: string;
}

const WORKSPACE_PREFIXES = [
  "/disease/",
  "/gene/",
  "/protein/",
  "/variant/",
  "/compare/",
];

/** The entities the reader has open: subject chain, selection and the route itself. */
export function useAssistantContext(): {
  context: ChatContext;
  chips: ContextChip[];
  labels: { gene?: string; variant?: string; disease?: string };
} {
  const pathname = usePathname() ?? "/";
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const ranges = useWorkspaceSelection((state) => state.ranges);
  const structureId = useWorkspaceSelection((state) => state.structureId);
  const boundAccession = useWorkspaceSelection((state) => state.accession);

  return useMemo(() => {
    const inWorkspace = WORKSPACE_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    );
    const parts = pathname.split("/").filter(Boolean).map(decodeParam);
    const context: ChatContext = { route: pathname };
    const labels: { gene?: string; variant?: string; disease?: string } = {};

    if (inWorkspace) {
      const { disease, gene, protein, variant, structure } = chain;
      if (disease) {
        context.disease = disease.id;
        labels.disease = disease.label;
      }
      if (gene) {
        context.gene = gene.id;
        labels.gene = gene.id;
      }
      const accession = protein?.id ?? boundAccession ?? undefined;
      if (accession) context.accession = accession;
      if (variant) {
        context.variant = variant.id;
        labels.variant = variant.label;
      }
      const active = structureId ?? structure?.id;
      if (active) context.structure = active;
      if (accession && ranges.length === 1 && ranges[0].start === ranges[0].end)
        context.residue = ranges[0].start;
      // The route names its entity before the page has declared it
      if (parts[0] === "gene" && parts[1] && !context.gene)
        context.gene = parts[1];
      if (parts[0] === "variant" && parts[1] && !context.variant)
        context.variant = parts[1];
      if (parts[0] === "disease" && parts[1] && !context.disease)
        context.disease = parts[1];
      if (parts[0] === "protein" && parts[1] && !context.accession)
        context.accession = parts[1];
      if (parts[0] === "compare" && parts[1] && parts[2]) {
        context.gene ??= parts[1];
        context.variant ??= `${parts[1]}-${parts[2]}`;
      }
    } else if (parts[0] === "compound" && parts[1]) {
      context.compound = parts[1];
    } else if (parts[0] === "project" && parts[1]) {
      context.project = parts[1];
    }

    const chips: ContextChip[] = [];
    if (context.disease)
      chips.push({ kind: "Disease", value: labels.disease ?? context.disease });
    if (context.gene) chips.push({ kind: "Gene", value: context.gene });
    if (context.variant)
      chips.push({ kind: "Variant", value: context.variant });
    if (context.accession)
      chips.push({ kind: "Protein", value: context.accession });
    if (context.residue)
      chips.push({ kind: "Residue", value: String(context.residue) });
    if (context.structure)
      chips.push({ kind: "Structure", value: context.structure });
    if (context.compound)
      chips.push({ kind: "Compound", value: context.compound });
    if (context.project)
      chips.push({ kind: "Project", value: context.project });
    return { context, chips, labels };
  }, [pathname, chain, ranges, structureId, boundAccession]);
}

export interface QuestionChip {
  /** one to three words, shown on the chip */
  label: string;
  /** the question that is sent */
  prompt: string;
}

/** Questions the open entities make answerable, as short chips. Empty when nothing is open. */
export function suggestedChips(context: ChatContext): QuestionChip[] {
  const chips: QuestionChip[] = [];
  const { gene, variant, residue, accession, disease, structure, compound } =
    context;
  const protein = gene ?? accession;
  if (variant) {
    chips.push({
      label: "Disease evidence",
      prompt: `What evidence connects ${variant} to disease?`,
    });
    chips.push({
      label: "Reference vs variant",
      prompt: `What changed between the reference and variant models of ${variant}?`,
    });
  }
  if (residue && protein)
    chips.push({
      label: `Why residue ${residue}`,
      prompt: `Why is residue ${residue} of ${protein} important?`,
    });
  if (protein) {
    chips.push({
      label: "Partners",
      prompt: `What proteins interact with ${protein}?`,
    });
    if (!variant)
      chips.push({
        label: `What ${protein} does`,
        prompt: `What does ${protein} do, and which diseases involve it?`,
      });
  }
  if (structure)
    chips.push({
      label: "Model confidence",
      prompt: `How confident is ${structure}, and what does it cover?`,
    });
  else if (accession)
    chips.push({
      label: "Structures",
      prompt: `Which structures exist for ${accession}, experimental and predicted?`,
    });
  if (disease && !variant)
    chips.push({
      label: "Disease cause",
      prompt: "What is known about the cause of this disease?",
    });
  if (compound)
    chips.push({
      label: "How it acts",
      prompt: `What do sources record about how ${compound} acts?`,
    });
  if (context.project)
    chips.push({
      label: "Experiments",
      prompt: "What experiments could distinguish the hypotheses saved here?",
    });
  return chips.slice(0, 5);
}

/** The same questions as full sentences. */
export const suggestedQuestions = (context: ChatContext): string[] =>
  suggestedChips(context).map((chip) => chip.prompt);

export const hasEntity = (context: ChatContext): boolean =>
  Boolean(
    context.disease ??
    context.gene ??
    context.accession ??
    context.variant ??
    context.compound,
  );

/** Query of GET /assistant/digest for a context. */
export function digestQuery(context: ChatContext) {
  return {
    disease: context.disease,
    gene: context.gene,
    accession: context.accession,
    variant: context.variant,
    residue: context.residue,
    structure: context.structure,
    compound: context.compound,
    comparison: context.comparison,
  };
}
