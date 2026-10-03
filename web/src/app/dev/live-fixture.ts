/**
 * Dev-only data loader for /dev/kit and /dev/frame. It reads one protein straight from UniProt and
 * AlphaFold DB in the browser so the shared components can be seen with real data before the
 * Helix API exists. Product pages never do this: they call the API through `@/lib/api`.
 */
import type { SequenceTrack } from "@/components/sequence";

interface UniProtFeature {
  type: string;
  description?: string;
  featureId?: string;
  location: { start: { value: number }; end: { value: number } };
}

export interface LiveProtein {
  accession: string;
  sequence: string;
  /** UniProt release from the response header */
  uniprotRelease: string | null;
  /** per-residue pLDDT from AlphaFold DB, 0 to 100; null when the file could not be read */
  plddt: number[] | null;
  tracks: SequenceTrack[];
}

export async function fetchLiveProtein(
  accession: string,
): Promise<LiveProtein> {
  const uniprot = await fetch(
    `https://rest.uniprot.org/uniprotkb/${accession}.json?fields=sequence,ft_domain`,
  );
  if (!uniprot.ok) throw new Error(`UniProt HTTP ${uniprot.status}`);
  const entry = (await uniprot.json()) as {
    sequence: { value: string };
    features?: UniProtFeature[];
  };
  const uniprotRelease = uniprot.headers.get("x-uniprot-release");

  const tracks: SequenceTrack[] = [
    {
      id: "domains",
      label: "Domains",
      kind: "domain",
      source: uniprotRelease ? `UniProt ${uniprotRelease}` : "UniProt",
      features: (entry.features ?? []).map((feature, index) => ({
        id: feature.featureId ?? `${feature.type}-${index}`,
        start: feature.location.start.value,
        end: feature.location.end.value,
        label: feature.description ?? feature.type,
      })),
    },
  ];

  let plddt: number[] | null = null;
  const confidence = await fetch(
    `https://alphafold.ebi.ac.uk/files/AF-${accession}-F1-confidence_v6.json`,
  ).catch(() => null);
  if (confidence?.ok) {
    plddt = ((await confidence.json()) as { confidenceScore: number[] })
      .confidenceScore;
    tracks.push({
      id: "plddt",
      label: "pLDDT",
      kind: "confidence",
      source: "AlphaFold DB v6",
      values: plddt,
    });
  } else {
    tracks.push({
      id: "plddt",
      label: "pLDDT",
      kind: "confidence",
      status: {
        source: "afdb",
        name: "AlphaFold DB",
        state: "unavailable",
        message: confidence ? `HTTP ${confidence.status}` : "no answer",
      },
    });
  }
  return {
    accession,
    sequence: entry.sequence.value,
    uniprotRelease,
    plddt,
    tracks,
  };
}
