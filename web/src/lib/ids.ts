/** URL-facing identifier helpers. Canonical database IDs live on the entity records. */

export const AMINO_ACIDS: ReadonlyArray<
  readonly [one: string, three: string, name: string]
> = [
  ["A", "Ala", "Alanine"],
  ["R", "Arg", "Arginine"],
  ["N", "Asn", "Asparagine"],
  ["D", "Asp", "Aspartate"],
  ["C", "Cys", "Cysteine"],
  ["Q", "Gln", "Glutamine"],
  ["E", "Glu", "Glutamate"],
  ["G", "Gly", "Glycine"],
  ["H", "His", "Histidine"],
  ["I", "Ile", "Isoleucine"],
  ["L", "Leu", "Leucine"],
  ["K", "Lys", "Lysine"],
  ["M", "Met", "Methionine"],
  ["F", "Phe", "Phenylalanine"],
  ["P", "Pro", "Proline"],
  ["S", "Ser", "Serine"],
  ["T", "Thr", "Threonine"],
  ["W", "Trp", "Tryptophan"],
  ["Y", "Tyr", "Tyrosine"],
  ["V", "Val", "Valine"],
  ["U", "Sec", "Selenocysteine"],
];

const THREE_BY_ONE = new Map(AMINO_ACIDS.map(([one, three]) => [one, three]));
const ONE_BY_THREE = new Map(
  AMINO_ACIDS.map(([one, three]) => [three.toLowerCase(), one]),
);
const NAME_BY_ONE = new Map(AMINO_ACIDS.map(([one, , name]) => [one, name]));

export const toThreeLetter = (one: string): string | null =>
  THREE_BY_ONE.get(one.toUpperCase()) ?? null;
export const toOneLetter = (three: string): string | null =>
  ONE_BY_THREE.get(three.toLowerCase()) ?? null;
export const aminoAcidName = (one: string): string | null =>
  NAME_BY_ONE.get(one.toUpperCase()) ?? null;

export interface ProteinSubstitution {
  /** one-letter codes */
  reference: string;
  position: number;
  alternate: string;
}

const THREE_LETTER_CHANGE = /^(?:p\.)?([A-Za-z]{3})(\d+)([A-Za-z]{3})$/;
const ONE_LETTER_CHANGE = /^(?:p\.)?([A-Za-z])(\d+)([A-Za-z])$/;

/** Accepts `p.Arg28His`, `Arg28His`, `R28H` and `p.R28H`. */
export function parseProteinChange(value: string): ProteinSubstitution | null {
  const trimmed = value.trim();
  const three = THREE_LETTER_CHANGE.exec(trimmed);
  if (three) {
    const reference = toOneLetter(three[1]);
    const alternate = toOneLetter(three[3]);
    if (reference && alternate)
      return { reference, position: Number(three[2]), alternate };
    return null;
  }
  const one = ONE_LETTER_CHANGE.exec(trimmed);
  if (
    one &&
    THREE_BY_ONE.has(one[1].toUpperCase()) &&
    THREE_BY_ONE.has(one[3].toUpperCase())
  ) {
    return {
      reference: one[1].toUpperCase(),
      position: Number(one[2]),
      alternate: one[3].toUpperCase(),
    };
  }
  return null;
}

/** `p.Arg28His` */
export function formatProteinChange(change: ProteinSubstitution): string {
  return `p.${toThreeLetter(change.reference) ?? change.reference}${change.position}${toThreeLetter(change.alternate) ?? change.alternate}`;
}

/** `R28H` */
export function formatShortChange(change: ProteinSubstitution): string {
  return `${change.reference}${change.position}${change.alternate}`;
}

export type ParsedVariantId =
  | {
      kind: "substitution";
      gene: string;
      change: ProteinSubstitution;
      label: string;
    }
  | { kind: "clinvar"; accession: string; label: string };

const CLINVAR_ACCESSION = /^VCV\d{9}(?:\.\d+)?$/i;

/** Parses the URL form `GENE-p.Ref3PosAlt3` or a ClinVar VCV accession. */
export function parseVariantId(value: string): ParsedVariantId | null {
  const decoded = decodeURIComponent(value);
  if (CLINVAR_ACCESSION.test(decoded)) {
    const accession = decoded.toUpperCase();
    return { kind: "clinvar", accession, label: accession };
  }
  const separator = decoded.indexOf("-p.");
  if (separator < 1) return null;
  const gene = decoded.slice(0, separator);
  const change = parseProteinChange(decoded.slice(separator + 1));
  if (!change) return null;
  return {
    kind: "substitution",
    gene,
    change,
    label: formatProteinChange(change),
  };
}

/** `BTK-p.Arg28His` */
export function formatVariantId(
  gene: string,
  change: ProteinSubstitution,
): string {
  return `${gene}-${formatProteinChange(change)}`;
}

const UNIPROT_ACCESSION =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;

export const isUniProtAccession = (value: string): boolean =>
  UNIPROT_ACCESSION.test(value.toUpperCase());

/** Path builders. Every internal link goes through these so identifiers stay consistent. */
export const routes = {
  home: () => "/",
  explore: () => "/explore",
  disease: (slug: string) => `/disease/${encodeURIComponent(slug)}`,
  gene: (symbol: string) => `/gene/${encodeURIComponent(symbol)}`,
  protein: (accession: string) => `/protein/${encodeURIComponent(accession)}`,
  interventions: (accession: string) =>
    `/protein/${encodeURIComponent(accession)}/interventions`,
  variant: (variantId: string) => `/variant/${encodeURIComponent(variantId)}`,
  mechanism: (variantId: string) =>
    `/variant/${encodeURIComponent(variantId)}/mechanism`,
  compare: (gene: string, change: string) =>
    `/compare/${encodeURIComponent(gene)}/${encodeURIComponent(change)}`,
  /**
   * Candidate targets and molecules for a gene, narrowed by the disease and variant in context.
   * `heldOut` asks the API to withhold the disease's own drug links, so a recovery must come
   * through a bridge. The Lab run, the disease page and the gene page all link through this.
   */
  discover: (
    gene: string,
    options: {
      disease?: string | null;
      variant?: string | null;
      heldOut?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.disease) query.set("disease", options.disease);
    if (options.variant) query.set("variant", options.variant);
    if (options.heldOut) query.set("held_out", "1");
    const search = query.toString();
    return `/discover/${encodeURIComponent(gene)}${search ? `?${search}` : ""}`;
  },
  compound: (compoundId: string) =>
    `/compound/${encodeURIComponent(compoundId)}`,
  project: (projectId: string) => `/project/${encodeURIComponent(projectId)}`,
  projects: () => "/projects",
  snapshot: (snapshotId: string) => `/s/${encodeURIComponent(snapshotId)}`,
  jobs: () => "/jobs",
  job: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`,
  models: () => "/models",
  about: () => "/about",
  docs: () => "/docs",
} as const;

/** Route params may arrive percent-encoded; a malformed sequence is returned unchanged. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Immutable project snapshot: `ofs_` followed by the first 32 hex characters of the content hash. */
export const isSnapshotId = (value: string): boolean =>
  /^ofs_[0-9a-f]{32}$/.test(value);
