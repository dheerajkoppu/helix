/**
 * Dev-only loader for /dev/sequence. It reads one protein straight from UniProt, the EBI Proteins
 * variation API, PDBe and AlphaFold DB in the browser so the axis can be exercised on real data.
 * Product pages never do this: they call the OrphaFold API through `@/lib/api`.
 */
import type {
  SequenceFeature,
  SequenceTrack,
  SequenceVariant,
  VariantConsequence,
} from "@/components/sequence";
import type { SourceStatus } from "@/lib/api/types";
import type { EvidenceClass } from "@/lib/evidence";
import { toThreeLetter } from "@/lib/ids";
import {
  clinvarReviewStars,
  parseClinicalSignificance,
} from "@/lib/science/clinical-significance";

interface UniProtEvidence {
  evidenceCode?: string;
  source?: string;
  id?: string;
}

interface UniProtFeature {
  type: string;
  description?: string;
  featureId?: string;
  ligand?: { name?: string };
  evidences?: UniProtEvidence[];
  location: { start: { value: number }; end: { value: number } };
}

interface EbiVariant {
  begin: string;
  end: string;
  wildType?: string;
  mutatedType?: string;
  alternativeSequence?: string;
  consequenceType?: string;
  ftId?: string;
  sourceType?: string;
  clinicalSignificances?: Array<{
    type: string;
    sources?: string[];
    reviewStatus?: string;
  }>;
  populationFrequencies?: Array<{
    populationName: string;
    frequency: number;
    source: string;
  }>;
  xrefs?: Array<{ name: string; id: string }>;
  locations?: Array<{ loc: string }>;
  descriptions?: Array<{ value: string }>;
}

interface AfdbEntry {
  modelEntityId: string;
  latestVersion: number;
  sequenceStart: number;
  sequenceEnd: number;
  plddtDocUrl: string;
  amAnnotationsUrl?: string;
}

interface PdbeStructure {
  pdb_id: string;
  chain_id: string;
  experimental_method: string;
  resolution: number | null;
  unp_start: number;
  unp_end: number;
}

export interface LiveAxisData {
  accession: string;
  gene: string | null;
  sequence: string;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
  variantStatus: SourceStatus;
  sources: SourceStatus[];
}

const EXPERIMENTAL_ECO = new Set(["ECO:0000269", "ECO:0007829", "ECO:0007744"]);
const AUTOMATIC_ECO = new Set(["ECO:0000256", "ECO:0000259", "ECO:0000313"]);

function featureEvidence(feature: UniProtFeature): EvidenceClass {
  const codes = (feature.evidences ?? []).map(
    (evidence) => evidence.evidenceCode ?? "",
  );
  if (codes.some((code) => EXPERIMENTAL_ECO.has(code))) return "experimental";
  if (codes.length > 0 && codes.every((code) => AUTOMATIC_ECO.has(code)))
    return "computational_prediction";
  return "curated_database";
}

function toFeature(feature: UniProtFeature, index: number): SequenceFeature {
  const evidence = feature.evidences?.[0];
  const name = feature.description || feature.ligand?.name || feature.type;
  return {
    id: feature.featureId ?? `${feature.type}-${index}`,
    start: feature.location.start.value,
    end: feature.location.end.value,
    label: name,
    description: [
      feature.type,
      evidence?.evidenceCode,
      evidence?.source && evidence.id
        ? `${evidence.source} ${evidence.id}`
        : null,
    ]
      .filter(Boolean)
      .join(", "),
    evidenceClass: featureEvidence(feature),
    sourceId:
      feature.featureId ??
      (evidence?.source && evidence.id
        ? `${evidence.source}:${evidence.id}`
        : null),
  };
}

const SECONDARY: Record<string, SequenceFeature["secondaryStructure"]> = {
  Helix: "helix",
  "Beta strand": "strand",
  Turn: "turn",
};

function consequenceOf(raw: string | undefined): VariantConsequence {
  const value = (raw ?? "").toLowerCase();
  if (value === "missense") return "missense";
  if (value === "frameshift" || value === "stop gained")
    return "loss_of_function";
  if (value.startsWith("inframe") || value === "insertion") return "inframe";
  if (value.includes("splice")) return "splice";
  if (value === "synonymous") return "synonymous";
  return "other";
}

function toVariants(
  gene: string | null,
  features: EbiVariant[],
): SequenceVariant[] {
  const seen = new Map<string, number>();
  const variants: SequenceVariant[] = [];
  for (const feature of features) {
    const position = Number(feature.begin);
    if (!Number.isFinite(position)) continue;
    const reference = feature.wildType ?? "";
    const alternate = feature.mutatedType ?? feature.alternativeSequence ?? "";
    const substitution =
      reference.length === 1 &&
      alternate.length === 1 &&
      toThreeLetter(reference) !== null &&
      toThreeLetter(alternate) !== null;
    const label =
      feature.locations?.[0]?.loc ??
      (substitution
        ? `p.${toThreeLetter(reference)}${position}${toThreeLetter(alternate)}`
        : `${reference}${position}${alternate}`);
    const assertions = feature.clinicalSignificances ?? [];
    const assertion =
      assertions.find((entry) => entry.sources?.includes("ClinVar")) ??
      assertions[0];
    const clinical = assertion !== undefined;
    const frequency = feature.populationFrequencies?.[0];
    // somatic and study records with neither a classification nor a frequency belong to neither row
    if (!clinical && !frequency) continue;
    const xref = (name: string) =>
      feature.xrefs?.find((entry) => entry.name === name)?.id ?? null;
    const sourceId = clinical
      ? (xref("ClinVar") ?? feature.ftId ?? xref("dbSNP"))
      : (xref("dbSNP") ?? feature.xrefs?.[0]?.id ?? feature.ftId ?? null);
    const baseId = substitution
      ? `${gene ?? "protein"}-p.${toThreeLetter(reference)}${position}${toThreeLetter(alternate)}`
      : (sourceId ?? `${position}:${label}`);
    const repeat = seen.get(baseId) ?? 0;
    seen.set(baseId, repeat + 1);
    variants.push({
      id: repeat === 0 ? baseId : `${baseId}~${repeat}`,
      position,
      reference,
      alternate,
      label,
      consequence: consequenceOf(feature.consequenceType),
      significance: clinical ? parseClinicalSignificance(assertion.type) : null,
      reviewStars: clinical ? clinvarReviewStars(assertion.reviewStatus) : null,
      alleleFrequency: frequency?.frequency ?? null,
      group: clinical ? "clinical" : "population",
      sourceId,
      source: clinical
        ? assertion.sources?.includes("ClinVar")
          ? "ClinVar"
          : (assertion.sources?.[0] ?? "EBI Proteins API")
        : (frequency?.source ?? "EBI Proteins API"),
      evidenceClass: clinical ? "clinical_database" : "curated_database",
      description: feature.descriptions?.[0]?.value ?? null,
    });
  }
  return variants;
}

async function getJson<T>(url: string, attempts = 2): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    // EBI resets the occasional large response; one retry is enough to tell a blip from an outage
    if (attempts > 1) return getJson<T>(url, attempts - 1);
    throw error;
  }
}

const failure = (reason: unknown) =>
  reason instanceof Error ? reason.message : "no answer";

export async function fetchAxisData(accession: string): Promise<LiveAxisData> {
  const uniprot = await fetch(
    `https://rest.uniprot.org/uniprotkb/${accession}.json?fields=accession,gene_names,sequence,ft_domain,ft_region,ft_zn_fing,ft_motif,ft_binding,ft_act_site,ft_site,ft_mod_res,ft_helix,ft_strand,ft_turn`,
  );
  if (!uniprot.ok) throw new Error(`UniProt HTTP ${uniprot.status}`);
  const entry = (await uniprot.json()) as {
    sequence: { value: string };
    genes?: Array<{ geneName?: { value: string } }>;
    features?: UniProtFeature[];
  };
  const release = uniprot.headers.get("x-uniprot-release");
  const uniprotSource = release ? `UniProt ${release}` : "UniProt";
  const sequence = entry.sequence.value;
  const gene = entry.genes?.[0]?.geneName?.value ?? null;
  const features = entry.features ?? [];
  const sources: SourceStatus[] = [
    { source: "uniprot", name: "UniProt", state: "ok", release },
  ];

  const pick = (types: string[]) =>
    features
      .map((feature, index) => ({ feature, index }))
      .filter(({ feature }) => types.includes(feature.type));
  const featureTrack = (
    id: string,
    label: string,
    kind: SequenceTrack["kind"],
    types: string[],
  ): SequenceTrack => {
    const picked = pick(types);
    return {
      id,
      label,
      kind,
      source: uniprotSource,
      features: picked.map(({ feature, index }) => ({
        ...toFeature(feature, index),
        secondaryStructure: SECONDARY[feature.type],
      })),
      status:
        picked.length === 0
          ? { source: "uniprot", name: "UniProt", state: "empty", release }
          : undefined,
    };
  };

  const variationNotes: string[] = [];
  const [variation, pdbe, afdb] = await Promise.allSettled([
    getJson<{ features: EbiVariant[] }>(
      `https://www.ebi.ac.uk/proteins/api/variation/${accession}`,
      1,
    ).catch(() => {
      variationNotes.push(
        "read through the dev server because the direct browser request failed",
      );
      return getJson<{ features: EbiVariant[] }>(
        `/dev/sequence/variation/${accession}`,
      );
    }),
    getJson<Record<string, PdbeStructure[]>>(
      `https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/${accession}`,
    ),
    getJson<AfdbEntry[]>(
      `https://alphafold.ebi.ac.uk/api/prediction/${accession}`,
    ),
  ]);

  let variants: SequenceVariant[] = [];
  if (variation.status === "fulfilled") {
    const records = variation.value?.features ?? [];
    variants = toVariants(gene, records);
    const skipped = records.length - variants.length;
    if (skipped > 0)
      variationNotes.push(
        `${skipped} of ${records.length} records have neither a clinical classification nor a population frequency and are not drawn`,
      );
    sources.push({
      source: "ebi_proteins",
      name: "EBI Proteins variation",
      state: variants.length > 0 ? "ok" : "empty",
      message: variationNotes.join("; ") || undefined,
    });
  } else {
    sources.push({
      source: "ebi_proteins",
      name: "EBI Proteins variation",
      state: "unavailable",
      message: failure(variation.reason),
    });
  }

  const coverage: SequenceFeature[] = [];
  const coverageSources: string[] = [];
  let coverageStatus: SourceStatus | undefined;
  if (pdbe.status === "fulfilled") {
    const structures = pdbe.value?.[accession] ?? [];
    structures.forEach((structure, index) => {
      coverage.push({
        id: `pdb-${structure.pdb_id}-${structure.chain_id}-${index}`,
        start: structure.unp_start,
        end: structure.unp_end,
        label: `${structure.pdb_id.toUpperCase()} ${structure.chain_id}`,
        description: `${structure.experimental_method}${structure.resolution ? `, ${structure.resolution} Å` : ""}`,
        origin: "experimental",
        evidenceClass: "experimental",
        sourceId: `pdb:${structure.pdb_id.toUpperCase()}`,
      });
    });
    coverageSources.push("PDBe SIFTS");
    sources.push({
      source: "pdbe",
      name: "PDBe",
      state: structures.length > 0 ? "ok" : "empty",
    });
  } else {
    coverageStatus = {
      source: "pdbe",
      name: "PDBe",
      state: "unavailable",
      message: failure(pdbe.reason),
    };
    sources.push(coverageStatus);
  }

  const model = afdb.status === "fulfilled" ? afdb.value?.[0] : undefined;
  const afdbSource = model ? `AlphaFold DB v${model.latestVersion}` : null;
  let plddtTrack: SequenceTrack = {
    id: "plddt",
    label: "pLDDT",
    kind: "confidence",
    evidenceClass: "computational_prediction",
    status: {
      source: "afdb",
      name: "AlphaFold DB",
      state: afdb.status === "fulfilled" ? "empty" : "unavailable",
      message: afdb.status === "rejected" ? failure(afdb.reason) : undefined,
    },
  };
  let alphaMissenseTrack: SequenceTrack = {
    id: "alphamissense",
    label: "AM (predicted)",
    kind: "pathogenicity",
    evidenceClass: "computational_prediction",
    status: {
      source: "alphamissense",
      name: "AlphaMissense",
      state: afdb.status === "fulfilled" ? "empty" : "unavailable",
    },
  };
  if (model && afdbSource) {
    coverage.push({
      id: `afdb-${model.modelEntityId}`,
      start: model.sequenceStart,
      end: model.sequenceEnd,
      label: model.modelEntityId,
      description: afdbSource,
      origin: "predicted_external",
      evidenceClass: "computational_prediction",
      sourceId: `afdb:${model.modelEntityId}`,
    });
    coverageSources.push(afdbSource);
    const [confidence, substitutions] = await Promise.allSettled([
      getJson<{ confidenceScore: number[] }>(model.plddtDocUrl),
      model.amAnnotationsUrl
        ? fetch(model.amAnnotationsUrl).then((response) =>
            response.ok ? response.text() : null,
          )
        : Promise.resolve(null),
    ]);
    if (confidence.status === "fulfilled" && confidence.value) {
      plddtTrack = {
        ...plddtTrack,
        source: afdbSource,
        values: confidence.value.confidenceScore,
        status: undefined,
      };
    }
    if (substitutions.status === "fulfilled" && substitutions.value) {
      const sums = new Array<number>(sequence.length).fill(0);
      const counts = new Array<number>(sequence.length).fill(0);
      for (const line of substitutions.value.split("\n").slice(1)) {
        const [change, score] = line.split(",");
        const position = Number(change?.slice(1, -1));
        const value = Number(score);
        if (!Number.isFinite(position) || !Number.isFinite(value)) continue;
        if (position < 1 || position > sequence.length) continue;
        sums[position - 1] += value;
        counts[position - 1] += 1;
      }
      alphaMissenseTrack = {
        ...alphaMissenseTrack,
        source: `AlphaMissense, ${afdbSource} files`,
        valueLabel: "mean over the substitutions at this residue",
        values: sums.map((sum, index) =>
          counts[index] > 0 ? sum / counts[index] : null,
        ),
        status: undefined,
      };
    }
  }
  sources.push({
    source: "afdb",
    name: "AlphaFold DB",
    state: afdb.status === "rejected" ? "unavailable" : model ? "ok" : "empty",
    release: model ? `v${model.latestVersion}` : undefined,
    message: afdb.status === "rejected" ? failure(afdb.reason) : undefined,
  });

  const tracks: SequenceTrack[] = [
    {
      ...featureTrack("domains", "Domains", "domain", ["Domain"]),
      evidenceClass: "curated_database",
    },
    featureTrack("regions", "Regions", "region", [
      "Region",
      "Motif",
      "Zinc finger",
    ]),
    featureTrack("sites", "Sites", "site", [
      "Active site",
      "Binding site",
      "Site",
      "Modified residue",
    ]),
    {
      ...featureTrack("secondary", "Sec. struct.", "secondary_structure", [
        "Helix",
        "Beta strand",
        "Turn",
      ]),
      evidenceClass: "experimental",
    },
    {
      id: "coverage",
      label: "Coverage",
      kind: "coverage",
      source: coverageSources.join(", ") || null,
      features: coverage,
      status:
        coverage.length === 0
          ? (coverageStatus ?? {
              source: "pdbe",
              name: "PDBe or AlphaFold DB",
              state: "empty",
            })
          : undefined,
    },
    plddtTrack,
    alphaMissenseTrack,
  ];

  const variantStatus =
    sources.find((status) => status.source === "ebi_proteins") ?? sources[0];
  return {
    accession,
    gene,
    sequence,
    tracks,
    variants,
    variantStatus,
    sources,
  };
}
