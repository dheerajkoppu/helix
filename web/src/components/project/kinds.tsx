import { cn } from "cn";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import type { ItemKind, ProjectItem, TrailNode } from "@/lib/state/projects";
import type { StructureOrigin } from "@/lib/structure-origin";

export const KIND_META: Record<
  ItemKind,
  { code: string; label: string; plural: string }
> = {
  disease: { code: "DIS", label: "Disease", plural: "Diseases" },
  gene: { code: "GENE", label: "Gene", plural: "Genes" },
  variant: { code: "VAR", label: "Variant", plural: "Variants" },
  protein: { code: "PROT", label: "Protein", plural: "Proteins" },
  structure: { code: "STR", label: "Structure", plural: "Structures" },
  residue: { code: "RES", label: "Residue", plural: "Residues" },
  compound: { code: "CPD", label: "Compound", plural: "Compounds" },
  paper: { code: "PUB", label: "Paper", plural: "Papers" },
  job: { code: "RUN", label: "Model run", plural: "Model runs" },
  note: { code: "NOTE", label: "Note", plural: "Notes" },
  hypothesis: { code: "HYP", label: "Hypothesis", plural: "Hypotheses" },
  screenshot: { code: "IMG", label: "Screenshot", plural: "Screenshots" },
};

export const KIND_ORDER: ItemKind[] = [
  "disease",
  "gene",
  "variant",
  "protein",
  "structure",
  "residue",
  "compound",
  "paper",
  "job",
  "hypothesis",
  "note",
  "screenshot",
];

/** The origin a structure ID states by its prefix: pdb:, afdb: or of:. */
export function structureOriginOf(ref: string | null): StructureOrigin | null {
  if (!ref) return null;
  if (ref.startsWith("pdb:")) return "experimental";
  if (ref.startsWith("afdb:")) return "predicted_external";
  if (ref.startsWith("of:")) return "predicted_orphafold";
  return null;
}

/**
 * Type marker of a trail node or ledger row. A hypothesis always carries the HYP evidence badge and
 * a structure its origin tag; every other kind is a plain monospace code.
 */
export function KindMark({
  item,
  className,
}: {
  item: Pick<ProjectItem | TrailNode, "kind" | "ref">;
  className?: string;
}) {
  if (item.kind === "hypothesis")
    return (
      <EvidenceBadge
        evidenceClass="orphafold_hypothesis"
        size="compact"
        className={className}
      />
    );
  const origin = item.kind === "structure" ? structureOriginOf(item.ref) : null;
  if (origin)
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <KindCode kind="structure" />
        <StructureOriginTag origin={origin} size="compact" />
      </span>
    );
  return <KindCode kind={item.kind} className={className} />;
}

export function KindCode({
  kind,
  className,
}: {
  kind: ItemKind;
  className?: string;
}) {
  return (
    <span
      title={KIND_META[kind].label}
      className={cn(
        "shrink-0 font-mono text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase",
        className,
      )}
    >
      {KIND_META[kind].code}
    </span>
  );
}
