import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";
import { proteinSubjectFromUrl } from "@/lib/subject-refs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Intervention` };
}

export default async function InterventionsPage({ params }: Props) {
  const accession = decodeParam((await params).id).toUpperCase();
  return (
    <StagePlaceholder
      stage="intervention"
      subject={{ protein: proteinSubjectFromUrl(accession) }}
      ledger={{
        title: "Candidates",
        empty: "No compounds retrieved",
        holds: "Known drugs, known ligands and observed binders for this target, each with its evidence class and source.",
      }}
      instrument={{
        title: "Pocket and pose",
        empty: `No interaction data loaded for ${accession}`,
        holds: "Pockets, ligand poses and the comparison table of predicted interactions. Exploratory only.",
      }}
      inspector={{
        title: "Evidence",
        empty: "No candidate selected",
        holds: "Experimental evidence, predicted affinity with its confidence, and the model that produced it.",
      }}
    />
  );
}
