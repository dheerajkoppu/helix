"use client";

import { useWorkspaceSubject } from "@/components/workspace";
import type { SubjectChain, SubjectRef } from "@/lib/state/subject";
import { parseStructureId } from "@/lib/structure-origin";

import type {
  ApiStructureDescriptor,
  DiseaseResponse,
  GeneResponse,
  ProteinResponse,
  VariantDetail,
} from "./queries";

export function diseaseSubject(disease: DiseaseResponse): SubjectRef {
  const xref =
    disease.xrefs.find((entry) => entry.database === "MONDO") ??
    disease.xrefs[0];
  return {
    id: disease.id,
    label: disease.name,
    sourceId: xref?.id ?? null,
    source: xref?.database ?? null,
    href: xref?.url ?? null,
  };
}

export function geneSubject(gene: GeneResponse): SubjectRef {
  return {
    id: gene.symbol,
    label: gene.symbol,
    sourceId: gene.hgnc_id,
    source: gene.hgnc_id ? "HGNC" : null,
    href: gene.hgnc_id
      ? `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${gene.hgnc_id}`
      : null,
  };
}

/** Accepts the accession alone, for pages that know the protein before its record has loaded. */
export function proteinSubject(protein: ProteinResponse | string): SubjectRef {
  const accession = typeof protein === "string" ? protein : protein.accession;
  return {
    id: accession,
    label: accession,
    sourceId: `UniProtKB:${accession}`,
    source: "UniProt",
    href: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
  };
}

export function variantSubject(variant: VariantDetail): SubjectRef {
  const clinvar = variant.clinvar;
  return {
    id: variant.id,
    label: variant.protein_change ?? variant.name ?? variant.id,
    sourceId: clinvar?.vcv ?? variant.uniprot?.feature_id ?? null,
    source: clinvar ? "ClinVar" : variant.uniprot ? "UniProt" : null,
    href: clinvar?.url ?? null,
    evidenceClass: clinvar
      ? "clinical_database"
      : variant.uniprot
        ? "curated_database"
        : null,
  };
}

export function structureSubject(
  structure: ApiStructureDescriptor | string,
): SubjectRef | null {
  const id = typeof structure === "string" ? structure : structure.id;
  const parsed = parseStructureId(id);
  if (!parsed) return null;
  return {
    id,
    label: parsed.id,
    origin: typeof structure === "string" ? parsed.origin : structure.origin,
    href: typeof structure === "string" ? null : structure.source_url,
    source: typeof structure === "string" ? null : structure.provider_name,
  };
}

export interface SubjectBundle {
  disease?: DiseaseResponse | null;
  gene?: GeneResponse | null;
  protein?: ProteinResponse | string | null;
  variant?: VariantDetail | null;
  structure?: ApiStructureDescriptor | string | null;
}

/**
 * Entity records as the chain `useWorkspaceSubject` takes. A key left out (or undefined) is not
 * declared, so a record that is still loading leaves that link alone; `null` clears the link.
 * A disease, gene or variant record also fills the gene and protein links it names, unless the
 * bundle states them itself.
 */
export function subjectChain(bundle: SubjectBundle): SubjectChain {
  const chain: SubjectChain = {};
  const { disease, gene, protein, variant, structure } = bundle;

  if (disease !== undefined)
    chain.disease = disease ? diseaseSubject(disease) : null;
  if (gene !== undefined) chain.gene = gene ? geneSubject(gene) : null;
  if (protein !== undefined)
    chain.protein = protein ? proteinSubject(protein) : null;
  if (variant !== undefined)
    chain.variant = variant ? variantSubject(variant) : null;
  if (structure !== undefined)
    chain.structure = structure ? structureSubject(structure) : null;

  if (gene === undefined) {
    const symbol =
      variant?.gene.id ??
      disease?.gene?.symbol ??
      (typeof protein === "object" ? protein?.gene?.id : undefined);
    const hgncId = disease?.gene?.hgnc_id ?? null;
    if (symbol)
      chain.gene = {
        id: symbol,
        label: symbol,
        sourceId: hgncId,
        source: hgncId ? "HGNC" : null,
      };
  }
  if (protein === undefined) {
    const accession =
      gene?.uniprot_accession ??
      variant?.protein?.id ??
      disease?.protein?.accession;
    if (accession) chain.protein = proteinSubject(accession);
  }
  return chain;
}

/** Declares the page's entities from their API records; see `subjectChain` for the rules. */
export function useSubjectBundle(bundle: SubjectBundle): void {
  useWorkspaceSubject(subjectChain(bundle));
}
