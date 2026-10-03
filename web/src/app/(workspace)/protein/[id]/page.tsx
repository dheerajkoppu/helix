import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";
import { proteinSubjectFromUrl } from "@/lib/subject-refs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Protein` };
}

export default async function ProteinPage({ params }: Props) {
  const accession = decodeParam((await params).id).toUpperCase();
  return (
    <StagePlaceholder
      stage="protein"
      subject={{ protein: proteinSubjectFromUrl(accession) }}
      ledger={{
        title: "Structures",
        empty: "No structures loaded",
        holds:
          "Experimental, existing predicted and OrphaFold-generated structures, grouped by class and never interleaved.",
      }}
      instrument={{
        title: "3D",
        empty: `No structure loaded for ${accession}`,
        holds:
          "The interactive 3D view, linked residue by residue to the sequence axis.",
      }}
      inspector={{
        title: "Residue",
        empty: "No residue selected",
        holds:
          "Confidence, annotations and evidence for the selected residue or feature.",
      }}
    />
  );
}
