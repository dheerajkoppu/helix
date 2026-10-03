/**
 * Pure builders that turn API answers into sequence-axis tracks and variants. All positions are
 * UniProt canonical. `useProteinAxis` composes them; a page with unusual needs can call them itself.
 */
import type {
  SequenceFeature,
  SequenceTrack,
  SequenceVariant,
  VariantConsequence,
} from "@/components/sequence";
import type { Schema, SourceStatus } from "@/lib/api/types";
import type { EvidenceClass } from "@/lib/evidence";
import { parseClinicalSignificance } from "@/lib/science/clinical-significance";

import type {
  AxisVariantsResponse,
  EffectMapResponse,
  ProteinResponse,
  StructureConfidence,
  StructureLedger,
} from "./queries";
import { findSource } from "./sources";
import { structureDetail } from "./structures";

type Feature = Schema<"Feature">;

interface TrackPlan {
  id: string;
  label: string;
  kind: SequenceTrack["kind"];
  /** backend feature-track IDs merged into this row */
  from: string[];
  source: "uniprot" | "interpro";
  /** the row stays, marked empty, when the protein has no such annotation */
  keepWhenEmpty?: boolean;
  defaultVisible?: boolean;
}

const TRACK_PLAN: TrackPlan[] = [
  {
    id: "domains",
    label: "Domains",
    kind: "domain",
    from: ["domains"],
    source: "uniprot",
    keepWhenEmpty: true,
  },
  {
    id: "regions",
    label: "Regions",
    kind: "region",
    from: [
      "regions",
      "repeats",
      "motifs",
      "zinc_fingers",
      "dna_binding",
      "topology",
    ],
    source: "uniprot",
  },
  {
    id: "sites",
    label: "Sites",
    kind: "site",
    from: ["active_sites", "binding_sites", "sites"],
    source: "uniprot",
    keepWhenEmpty: true,
  },
  {
    id: "secondary_structure",
    label: "Sec. structure",
    kind: "secondary_structure",
    from: ["secondary_structure"],
    source: "uniprot",
  },
  {
    id: "modified_residues",
    label: "Modifications",
    kind: "site",
    from: ["modified_residues"],
    source: "uniprot",
    defaultVisible: false,
  },
  {
    id: "interpro_domains",
    label: "InterPro",
    kind: "domain",
    from: ["interpro_domains"],
    source: "interpro",
    defaultVisible: false,
  },
];

const SECONDARY: Record<string, SequenceFeature["secondaryStructure"]> = {
  Helix: "helix",
  "Beta strand": "strand",
  Turn: "turn",
};

/** Experimental wins when a feature carries several evidence rows; otherwise the first row's class. */
function featureEvidenceClass(feature: Feature): EvidenceClass | undefined {
  const classes = feature.evidence.map((row) => row.evidence_class);
  return classes.includes("experimental") ? "experimental" : classes[0];
}

function toSequenceFeature(feature: Feature): SequenceFeature | null {
  if (typeof feature.start !== "number" || typeof feature.end !== "number")
    return null;
  const eco = feature.evidence.find((row) => row.eco)?.eco?.id;
  const name = feature.description || feature.ligand?.name || feature.type;
  return {
    id: feature.id,
    start: feature.start,
    end: feature.end,
    label: name,
    description: [feature.type, eco].filter(Boolean).join(", "),
    evidenceClass: featureEvidenceClass(feature),
    sourceId: feature.source_feature_id ?? feature.id,
    secondaryStructure: SECONDARY[feature.type],
  };
}

/** Domain, region, site and secondary-structure rows from the protein record. */
export function featureTracks(protein: ProteinResponse): SequenceTrack[] {
  const release = {
    uniprot: ["UniProt", protein.provenance?.release].filter(Boolean).join(" "),
    interpro: ["InterPro", protein.interpro_provenance?.release]
      .filter(Boolean)
      .join(" "),
  };
  const byId = new Map(protein.tracks.map((track) => [track.id, track]));
  const tracks: SequenceTrack[] = [];
  for (const plan of TRACK_PLAN) {
    const features = plan.from
      .flatMap((id) => byId.get(id)?.features ?? [])
      .map(toSequenceFeature)
      .filter((feature): feature is SequenceFeature => feature !== null)
      .sort((left, right) => left.start - right.start);
    if (features.length === 0 && !plan.keepWhenEmpty) continue;
    const sourceRow = findSource(protein.sources, plan.source);
    tracks.push({
      id: plan.id,
      label: plan.label,
      kind: plan.kind,
      source: release[plan.source],
      evidenceClass:
        plan.source === "interpro" ? "computational_prediction" : undefined,
      features,
      defaultVisible: plan.defaultVisible,
      status:
        features.length > 0
          ? undefined
          : sourceRow && sourceRow.state !== "ok"
            ? sourceRow
            : {
                source: plan.source,
                name: plan.source === "uniprot" ? "UniProt" : "InterPro",
                state: "empty",
              },
    });
  }
  return tracks;
}

/**
 * Which residues have coordinates, per structure class. Experimental rows are the observed
 * regions of the best SIFTS-ranked chain of each entry; predicted rows are the modelled range.
 */
export function coverageTrack(ledger: StructureLedger): SequenceTrack {
  const features: SequenceFeature[] = [];
  for (const row of ledger.experimental) {
    const chain = row.chains[0];
    if (!chain) continue;
    const regions =
      chain.observed_regions.length > 0
        ? chain.observed_regions
        : [{ start: chain.unp_start, end: chain.unp_end }];
    regions.forEach((region, index) =>
      features.push({
        id: `${row.structure.id}:${chain.chain_id}:${index}`,
        start: region.start,
        end: region.end,
        label: `${row.structure.source_id ?? row.structure.id} ${chain.chain_id}`,
        description: structureDetail(row.structure),
        origin: "experimental",
        evidenceClass: "experimental",
        sourceId: row.structure.id,
      }),
    );
  }
  for (const descriptor of [
    ...ledger.predicted_external,
    ...ledger.predicted_orphafold,
  ]) {
    (descriptor.coverage?.ranges ?? []).forEach((range, index) =>
      features.push({
        id: `${descriptor.id}:${index}`,
        start: range.start,
        end: range.end,
        label: descriptor.source_id ?? descriptor.id,
        description: structureDetail(descriptor),
        origin: descriptor.origin,
        evidenceClass:
          descriptor.origin === "predicted_orphafold"
            ? "orphafold_hypothesis"
            : "computational_prediction",
        sourceId: descriptor.id,
      }),
    );
  }
  const names = ledger.sources
    .filter((row) => row.state === "ok" && row.source !== "three_d_beacons")
    .map((row) =>
      [row.name ?? row.source, row.release].filter(Boolean).join(" "),
    );
  const failed = ledger.sources.find(
    (row) => row.state === "unavailable" && row.source !== "three_d_beacons",
  );
  return {
    id: "coverage",
    label: "Structures",
    kind: "coverage",
    source: names.join(", ") || null,
    features,
    status:
      features.length > 0
        ? undefined
        : (failed ?? { source: "pdbe", name: "Structures", state: "empty" }),
  };
}

const perResidue = (length: number): Array<number | null> =>
  new Array<number | null>(length).fill(null);

/** pLDDT row from `/structures/{id}/confidence`, on the 0 to 100 scale. */
export function confidenceTrack(
  confidence: StructureConfidence,
  sequenceLength: number,
): SequenceTrack {
  const afdb = findSource(confidence.sources, "afdb");
  const track: SequenceTrack = {
    id: "plddt",
    label: "pLDDT",
    kind: "confidence",
    evidenceClass: "computational_prediction",
    source: [afdb?.name ?? confidence.structure_id, afdb?.release]
      .filter(Boolean)
      .join(" "),
  };
  const plddt = confidence.plddt;
  if (!confidence.available || !plddt)
    return {
      ...track,
      status:
        afdb && afdb.state !== "ok"
          ? afdb
          : {
              source: "afdb",
              name: "AlphaFold DB",
              state: "empty",
              message: confidence.message,
            },
    };
  const values = perResidue(sequenceLength);
  plddt.residue_numbers.forEach((position, index) => {
    if (position >= 1 && position <= sequenceLength)
      values[position - 1] = plddt.scores[index] ?? null;
  });
  return { ...track, values, valueLabel: "pLDDT, 0 to 100" };
}

/** AlphaMissense residue-mean row from `/effect-map`. Always labelled as a prediction. */
export function pathogenicityTrack(
  effectMap: EffectMapResponse,
  sequenceLength: number,
): SequenceTrack {
  const row = findSource(effectMap.sources, "alphamissense", "afdb");
  const track: SequenceTrack = {
    id: "alphamissense",
    label: "AM (predicted)",
    kind: "pathogenicity",
    evidenceClass: "computational_prediction",
    source: [effectMap.tool, effectMap.structure_id].filter(Boolean).join(", "),
  };
  if (effectMap.residues.length === 0)
    return {
      ...track,
      status:
        row && row.state !== "ok"
          ? row
          : { source: "alphamissense", name: "AlphaMissense", state: "empty" },
    };
  const values = perResidue(sequenceLength);
  for (const residue of effectMap.residues) {
    if (residue.position >= 1 && residue.position <= sequenceLength)
      values[residue.position - 1] = residue.mean_pathogenicity;
  }
  return { ...track, values, valueLabel: effectMap.summary_method };
}

/** A row that says why it has no data: the request failed, or its input does not exist. */
export function unavailableTrack(
  track: Pick<SequenceTrack, "id" | "label" | "kind">,
  status: SourceStatus,
): SequenceTrack {
  return { ...track, evidenceClass: "computational_prediction", status };
}

function consequenceOf(
  term: string | null | undefined,
  changeKind: string | null | undefined,
): VariantConsequence {
  const value = (term ?? "").toLowerCase();
  if (value.includes("missense")) return "missense";
  if (value.includes("splice")) return "splice";
  if (
    value === "nonsense" ||
    value.includes("stop_gained") ||
    value.includes("frameshift")
  )
    return "loss_of_function";
  if (value.includes("inframe")) return "inframe";
  if (value.includes("synonymous")) return "synonymous";
  switch (changeKind) {
    case "substitution":
      return "missense";
    case "nonsense":
    case "frameshift":
      return "loss_of_function";
    case "synonymous":
      return "synonymous";
    case "deletion":
    case "insertion":
    case "delins":
    case "duplication":
      return "inframe";
    default:
      return "other";
  }
}

export interface AxisVariantSet {
  variants: SequenceVariant[];
  /** gnomAD rows left out because their reference residue is not the UniProt residue at that position */
  populationMismatched: number;
}

/**
 * Clinical rows (ClinVar and UniProt) above the axis, gnomAD rows below. IDs are the URL variant
 * IDs; a second record with the same protein change gets a "~n" suffix so every row stays
 * addressable. gnomAD positions are on its canonical transcript, so a row is kept only when its
 * reference residue matches the UniProt sequence.
 */
export function axisVariants(
  response: AxisVariantsResponse,
  sequence: string,
): AxisVariantSet {
  const seen = new Map<string, number>();
  const unique = (id: string) => {
    const repeat = seen.get(id) ?? 0;
    seen.set(id, repeat + 1);
    return repeat === 0 ? id : `${id}~${repeat}`;
  };
  const clinvar = response.clinvar_release
    ? `ClinVar ${response.clinvar_release}`
    : "ClinVar";
  const variants: SequenceVariant[] = [];

  for (const row of response.clinical) {
    variants.push({
      id: unique(row.id),
      position: row.position,
      reference: row.reference_residue ?? "",
      alternate: row.alternate_residue ?? "",
      label: row.protein_change ?? row.id,
      consequence: consequenceOf(row.consequence, row.change_kind),
      significance: row.in_clinvar
        ? parseClinicalSignificance(row.clinical_significance)
        : null,
      reviewStars: row.in_clinvar ? row.review_stars : null,
      alleleFrequency: null,
      group: "clinical",
      sourceId: row.vcv ?? row.uniprot_feature_id ?? null,
      source: row.in_clinvar ? clinvar : "UniProt",
      evidenceClass: row.in_clinvar ? "clinical_database" : "curated_database",
      description: row.condition ?? row.review_status ?? null,
    });
  }

  let populationMismatched = 0;
  for (const row of response.population) {
    if (
      !row.reference_residue ||
      sequence[row.position - 1] !== row.reference_residue
    ) {
      populationMismatched += 1;
      continue;
    }
    variants.push({
      id: unique(row.variant_id ?? row.gnomad_id),
      position: row.position,
      reference: row.reference_residue,
      alternate: row.alternate_residue ?? "",
      label: row.hgvs_p,
      consequence: consequenceOf(row.consequence, row.change_kind),
      significance: null,
      reviewStars: null,
      alleleFrequency: row.allele_frequency ?? null,
      group: "population",
      sourceId: row.gnomad_id,
      source: response.population_dataset,
      evidenceClass: "curated_database",
      description:
        row.allele_count !== null &&
        row.allele_count !== undefined &&
        row.allele_number
          ? `${row.allele_count} of ${row.allele_number} alleles`
          : null,
    });
  }
  return { variants, populationMismatched };
}

/** State of the variant sources for the dock's Variants control. */
export function variantSourceStatus(
  response: AxisVariantsResponse,
): SourceStatus | null {
  const rows = response.sources.filter((row) =>
    ["clinvar", "ebi_proteins", "gnomad"].includes(row.source),
  );
  const failed = rows.filter((row) => row.state === "unavailable");
  if (failed.length > 0)
    return {
      ...failed[0],
      message: `${failed.map((row) => row.name ?? row.source).join(", ")} did not answer${failed[0].message ? `: ${failed[0].message}` : "."}`,
    };
  if (response.clinical.length === 0 && response.population.length === 0)
    return {
      source: "clinvar",
      name: "ClinVar, UniProt, gnomAD",
      state: "empty",
    };
  return rows.find((row) => row.source === "clinvar") ?? rows[0] ?? null;
}
