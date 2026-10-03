import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";
import { variantSubjectsFromUrl } from "@/lib/subject-refs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Mechanism` };
}

export default async function MechanismPage({ params }: Props) {
  const variantId = decodeParam((await params).id);
  const subject = variantSubjectsFromUrl(variantId);
  return (
    <StagePlaceholder
      stage="mechanism"
      subject={subject}
      ledger={{
        title: "Candidate mechanisms",
        empty: "No mechanisms supported by data",
        holds: "Only mechanisms backed by a database record or a computational result are listed: stability, catalytic site, binding, interface, localisation.",
      }}
      instrument={{
        title: "What might this variant disrupt?",
        empty: `No mechanism analysis loaded for ${subject.variant?.label ?? variantId}`,
        holds: "The 3D view with interaction and pocket overlays, and each claim labelled by how it is known.",
      }}
      inspector={{
        title: "Evidence",
        empty: "No claim selected",
        holds: "The evidence behind the selected claim, with its class and confidence.",
      }}
    />
  );
}
