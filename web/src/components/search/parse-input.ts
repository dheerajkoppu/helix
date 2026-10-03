import type { SearchResponse } from "@/components/search/types";
import {
  formatProteinChange,
  formatVariantId,
  isUniProtAccession,
  parseProteinChange,
  parseVariantId,
  routes,
  toOneLetter,
  toThreeLetter,
  type ProteinSubstitution,
} from "@/lib/ids";

export interface ParsedInput {
  id: string;
  label: string;
  detail: string;
  href: string;
  /** true when the text only looks like the identifier; the server decides whether it exists */
  guess?: boolean;
}

const CHEMBL_ID = /^CHEMBL\d+$/i;
const AFDB_ENTRY = /^(?:afdb:)?AF-([A-Z0-9]{6,10})-F(\d+)$/i;

/**
 * Recognises identifiers locally, before any network call. Each row says what will be opened.
 * Names and aliases are resolved by GET /search.
 */
export function parsePaletteInput(raw: string): ParsedInput[] {
  const input = raw.trim();
  if (!input) return [];

  const afdb = AFDB_ENTRY.exec(input);
  if (afdb && isUniProtAccession(afdb[1])) {
    const accession = afdb[1].toUpperCase();
    const entry = `AF-${accession}-F${afdb[2]}`;
    return [
      {
        id: "structure",
        label: `Open ${entry}`,
        detail: "AlphaFold DB entry, a predicted structure",
        href: `${routes.protein(accession)}?s=afdb:${entry}`,
      },
    ];
  }

  if (isUniProtAccession(input)) {
    const accession = input.toUpperCase();
    return [
      {
        id: "protein",
        label: `Open protein ${accession}`,
        detail: "UniProt accession",
        href: routes.protein(accession),
      },
    ];
  }

  if (CHEMBL_ID.test(input)) {
    const chemblId = input.toUpperCase();
    return [
      {
        id: "compound",
        label: `Open compound ${chemblId}`,
        detail: "ChEMBL ID",
        href: routes.compound(chemblId),
      },
    ];
  }

  const variantId = parseVariantId(input);
  if (variantId) {
    return [
      {
        id: "variant",
        label: `Open variant ${variantId.kind === "clinvar" ? variantId.accession : `${variantId.gene} ${variantId.label}`}`,
        detail:
          variantId.kind === "clinvar"
            ? "ClinVar accession"
            : "Variant identifier",
        href: routes.variant(
          variantId.kind === "clinvar"
            ? variantId.accession
            : formatVariantId(variantId.gene.toUpperCase(), variantId.change),
        ),
      },
    ];
  }

  const geneAndChange = /^([A-Za-z][A-Za-z0-9-]{0,11})[\s:]+(\S+)$/.exec(input);
  if (geneAndChange) {
    const change = parseProteinChange(geneAndChange[2]);
    if (change) {
      const gene = geneAndChange[1].toUpperCase();
      return [
        {
          id: "variant",
          label: `Open variant ${gene} ${formatProteinChange(change)}`,
          detail: "Gene symbol and protein change",
          href: routes.variant(formatVariantId(gene, change)),
        },
      ];
    }
  }

  if (/^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(input)) {
    const symbol = input.toUpperCase();
    return [
      {
        id: "gene",
        label: `Open gene ${symbol}`,
        detail: "Read as an HGNC symbol; resolved when the page loads",
        href: routes.gene(symbol),
        guess: true,
      },
    ];
  }
  return [];
}

/**
 * Parsed rows still worth showing once the server has answered: a guess gives way to the server's
 * resolution, and a row the server also returned is shown once, with its source IDs.
 */
export function unresolvedParsedRows(
  parsed: ParsedInput[],
  answer: SearchResponse | null,
): ParsedInput[] {
  if (!answer) return parsed;
  const answered = new Set(
    answer.groups.flatMap((group) =>
      group.results.map((result) => result.href),
    ),
  );
  return parsed.filter((row) => !row.guess && !answered.has(row.href));
}

export interface ResidueInput {
  position: number;
  /** one-letter code, when the reader typed one */
  reference: string | null;
  /** set when the text is a substitution such as D165G */
  change: ProteinSubstitution | null;
}

const RESIDUE = /^#?\s*(?:p\.)?([A-Za-z]{3}|[A-Za-z])?\s*(\d{1,5})$/;

/** `#165`, `165`, `R226`, `Arg226` name a residue; `#D165G` and `p.Asp165Gly` name a substitution. */
export function parseResidueInput(raw: string): ResidueInput | null {
  const input = raw.trim();
  if (!input) return null;
  const change = parseProteinChange(input.replace(/^#\s*/, ""));
  if (change)
    return { position: change.position, reference: change.reference, change };
  const residue = RESIDUE.exec(input);
  if (!residue) return null;
  const position = Number(residue[2]);
  if (position < 1) return null;
  const letters = residue[1];
  if (!letters) return { position, reference: null, change: null };
  const reference =
    letters.length === 3
      ? toOneLetter(letters)
      : toThreeLetter(letters) && letters.toUpperCase();
  return reference ? { position, reference, change: null } : null;
}
