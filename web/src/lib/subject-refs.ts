import { formatVariantId, isUniProtAccession, parseProteinChange, parseVariantId } from "@/lib/ids";
import type { SubjectChain, SubjectRef } from "@/lib/state/subject";

/**
 * Subject links built from URL parameters alone, before any record is loaded. Pages replace them
 * with resolved links (labels and source IDs from the API) as soon as the data arrives.
 */
export function proteinSubjectFromUrl(accession: string): SubjectRef {
  const valid = isUniProtAccession(accession);
  return {
    id: accession,
    label: accession,
    source: valid ? "UniProt" : null,
    sourceId: valid ? `UniProtKB:${accession}` : null,
    href: valid ? `https://www.uniprot.org/uniprotkb/${accession}` : null,
  };
}

/** `BTK-p.Arg28His` yields the gene and the variant; a ClinVar accession yields the variant only. */
export function variantSubjectsFromUrl(variantId: string): SubjectChain {
  const parsed = parseVariantId(variantId);
  if (!parsed) return { variant: { id: variantId, label: variantId } };
  if (parsed.kind === "clinvar") {
    return {
      variant: {
        id: parsed.accession,
        label: parsed.accession,
        source: "ClinVar",
        sourceId: parsed.accession,
        href: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${parsed.accession}/`,
      },
    };
  }
  return {
    gene: { id: parsed.gene, label: parsed.gene },
    variant: { id: formatVariantId(parsed.gene, parsed.change), label: parsed.label },
  };
}

/** `/compare/BTK/p.Arg28His`: the change may be written in one-letter or three-letter form. */
export function compareSubjectsFromUrl(gene: string, change: string): SubjectChain {
  const parsed = parseProteinChange(change);
  return {
    gene: { id: gene, label: gene },
    variant: parsed
      ? variantSubjectsFromUrl(formatVariantId(gene, parsed)).variant
      : { id: `${gene}-${change}`, label: change },
  };
}
