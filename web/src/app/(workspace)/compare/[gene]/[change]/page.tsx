import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";
import { compareSubjectsFromUrl } from "@/lib/subject-refs";

type Props = { params: Promise<{ gene: string; change: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gene, change } = await params;
  return { title: `${decodeParam(gene)} ${decodeParam(change)} · Compare` };
}

export default async function ComparePage({ params }: Props) {
  const resolved = await params;
  const gene = decodeParam(resolved.gene);
  const change = decodeParam(resolved.change);
  const subject = compareSubjectsFromUrl(gene, change);
  return (
    <StagePlaceholder
      stage="compare"
      subject={subject}
      ledger={{
        title: "Changed residues",
        empty: "No comparison computed",
        holds: "Residues ranked by the chosen difference metric, masked where either structure is low confidence.",
      }}
      instrument={{
        title: "Reference and variant",
        empty: `No structures loaded for ${gene} ${subject.variant?.label ?? change}`,
        holds: "Reference and variant structures in Split, Overlay or Difference mode, with both structure classes named.",
      }}
      inspector={{
        title: "Residue",
        empty: "No residue selected",
        holds: "Reference and variant amino acid, domain, local confidence, neighbours and the evidence for each difference.",
      }}
    />
  );
}
