import { toOneLetter, toThreeLetter } from "@/lib/ids";

import type { SequenceFeature, SequenceTrack, SequenceVariant } from "./types";

export type SearchResult =
  | {
      kind: "residue";
      key: string;
      start: number;
      end: number;
      label: string;
      detail: string;
      variant?: SequenceVariant;
    }
  | {
      kind: "range" | "motif";
      key: string;
      start: number;
      end: number;
      label: string;
      detail: string;
    }
  | {
      kind: "feature";
      key: string;
      start: number;
      end: number;
      label: string;
      detail: string;
      feature: SequenceFeature;
    };

export interface SearchOutcome {
  results: SearchResult[];
  /** why the query matched nothing */
  error?: string;
  /** a corrected query the user can apply with one key */
  fix?: string;
}

export interface SearchContext {
  accession: string;
  sequence: string;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
}

const MAX_RESULTS = 12;
const RESIDUE_QUERY =
  /^(?:p\.)?\(?([A-Za-z]{3}|[A-Za-z])(\d+)([A-Za-z]{3}|[A-Za-z]|\*|=)?\)?$/;
const RANGE_QUERY = /^(\d+)\s*(?:-|–|:|\.\.)\s*(\d+)$/;
const MOTIF_QUERY = /^[A-Za-z.[\]^{},0-9]+$/;

function oneLetter(code: string): string | null {
  if (code === "*" || code === "=") return code;
  if (code.length === 1) return toThreeLetter(code) ? code.toUpperCase() : null;
  if (code.toLowerCase() === "ter") return "*";
  return toOneLetter(code);
}

const residueName = (one: string, position: number) =>
  `${toThreeLetter(one) ?? one}${position}`;

function featureMatches(
  needle: string,
  tracks: SequenceTrack[],
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const track of tracks) {
    for (const feature of track.features ?? []) {
      const haystack =
        `${feature.label ?? ""} ${feature.description ?? ""} ${feature.sourceId ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      results.push({
        kind: "feature",
        key: `feature-${track.id}-${feature.id}`,
        start: feature.start,
        end: feature.end,
        label: feature.label ?? feature.description ?? feature.id,
        detail: `${track.label} ${feature.start}-${feature.end}${track.source ? `, ${track.source}` : ""}`,
        feature,
      });
      if (results.length >= MAX_RESULTS) return results;
    }
  }
  return results;
}

function motifMatches(query: string, sequence: string): SearchResult[] {
  const looksLikeMotif = /[.[\]]/.test(query) || /^[A-Z]{3,}$/.test(query);
  if (!looksLikeMotif || !MOTIF_QUERY.test(query)) return [];
  let pattern: RegExp;
  try {
    pattern = new RegExp(query.replace(/x/g, "."), "g");
  } catch {
    return [];
  }
  const results: SearchResult[] = [];
  let match = pattern.exec(sequence);
  while (match && results.length < MAX_RESULTS) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    } else {
      const start = match.index + 1;
      const end = match.index + match[0].length;
      results.push({
        kind: "motif",
        key: `motif-${start}`,
        start,
        end,
        label: match[0],
        detail: `Sequence motif ${start}-${end}`,
      });
      pattern.lastIndex = match.index + 1;
    }
    match = pattern.exec(sequence);
  }
  return results;
}

/**
 * Residue search for the axis: `165`, `D165`, `D165G`, `p.Asp165Gly`, `150-180`, a feature name or
 * a motif pattern. The reference residue is checked against the canonical sequence.
 */
export function searchSequence(
  rawQuery: string,
  { accession, sequence, tracks, variants }: SearchContext,
): SearchOutcome {
  const query = rawQuery.trim();
  if (!query) return { results: [] };
  const length = sequence.length;
  const outside = (position: number) =>
    `Position ${position} is outside ${accession} canonical (1-${length}).`;

  if (/^\d+$/.test(query)) {
    const position = Number(query);
    if (position < 1 || position > length)
      return { results: [], error: outside(position) };
    const reference = sequence[position - 1];
    return {
      results: [
        {
          kind: "residue",
          key: `residue-${position}`,
          start: position,
          end: position,
          label: residueName(reference, position),
          detail: `Residue ${reference}${position}, ${accession} canonical`,
        },
      ],
    };
  }

  const range = RANGE_QUERY.exec(query);
  if (range) {
    const start = Math.min(Number(range[1]), Number(range[2]));
    const end = Math.max(Number(range[1]), Number(range[2]));
    if (start < 1 || end > length)
      return { results: [], error: outside(start < 1 ? start : end) };
    return {
      results: [
        {
          kind: "range",
          key: `range-${start}-${end}`,
          start,
          end,
          label: `${start}-${end}`,
          detail: `Range of ${end - start + 1} residues, ${accession} canonical`,
        },
      ],
    };
  }

  const features = featureMatches(query.toLowerCase(), tracks);
  const residue = RESIDUE_QUERY.exec(query);
  const reference = residue ? oneLetter(residue[1]) : null;
  const alternate = residue?.[3] ? oneLetter(residue[3]) : null;
  const residueQueryValid =
    residue !== null &&
    reference !== null &&
    reference !== "*" &&
    reference !== "=" &&
    (residue[3] === undefined || alternate !== null);

  if (residue && residueQueryValid && reference) {
    const position = Number(residue[2]);
    const threeLetter = residue[1].length === 3;
    if (position < 1 || position > length) {
      return features.length > 0
        ? { results: features }
        : { results: [], error: outside(position) };
    }
    const actual = sequence[position - 1];
    if (actual !== reference) {
      if (features.length > 0) return { results: features };
      const alternateText = alternate
        ? threeLetter
          ? (toThreeLetter(alternate) ?? alternate)
          : alternate
        : "";
      const typed = threeLetter
        ? `${toThreeLetter(reference)}${position}`
        : `${reference}${position}`;
      return {
        results: [],
        error: `Position ${position} is ${actual} (${toThreeLetter(actual) ?? "unknown"}) in ${accession} canonical. No match for ${typed}.`,
        fix: threeLetter
          ? `p.${toThreeLetter(actual) ?? actual}${position}${alternateText}`
          : `${actual}${position}${alternateText}`,
      };
    }
    const record =
      alternate && alternate !== "="
        ? variants.find(
            (variant) =>
              variant.position === position && variant.alternate === alternate,
          )
        : undefined;
    const name = residueName(reference, position);
    const result: SearchResult = {
      kind: "residue",
      key: `residue-${position}-${alternate ?? ""}`,
      start: position,
      end: position,
      label: record
        ? record.label
        : alternate
          ? `${name}${alternate === "=" ? "=" : (toThreeLetter(alternate) ?? alternate)}`
          : name,
      detail: record
        ? `Variant record${record.source ? ` from ${record.source}` : ""}${record.sourceId ? ` ${record.sourceId}` : ""}`
        : alternate
          ? `No record for this change in the loaded variant sources. Selects residue ${position}.`
          : `Residue ${reference}${position}, ${accession} canonical`,
      variant: record,
    };
    return { results: [result, ...features].slice(0, MAX_RESULTS) };
  }

  if (features.length > 0) return { results: features };
  const motifs = motifMatches(query, sequence);
  if (motifs.length > 0) return { results: motifs };
  return {
    results: [],
    error: `No residue, range, feature or motif matches "${query}" in ${accession}.`,
  };
}
