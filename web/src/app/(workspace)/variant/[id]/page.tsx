import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";
import { variantSubjectsFromUrl } from "@/lib/subject-refs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Variant` };
}

export default async function VariantPage({ params }: Props) {
  const variantId = decodeParam((await params).id);
  const subject = variantSubjectsFromUrl(variantId);
  return (
    <StagePlaceholder
      stage="gene"
      subject={subject}
      ledger={{
        title: "Evidence",
        empty: "No evidence rows loaded",
        holds: "Clinical classifications, curated annotations, literature and predictions for this variant, one row per source.",
      }}
      instrument={{
        title: "Variant",
        empty: `No variant record loaded for ${subject.variant?.label ?? variantId}`,
        holds: "The amino-acid change in its sequence and structural context, with predicted effect values from each source.",
      }}
      inspector={{
        title: "Source record",
        empty: "No evidence row selected",
        holds: "The source record, release and retrieval date behind the selected row.",
      }}
    />
  );
}
