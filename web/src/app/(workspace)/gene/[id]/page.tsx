import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Gene and variants` };
}

export default async function GenePage({ params }: Props) {
  const symbol = decodeParam((await params).id);
  return (
    <StagePlaceholder
      stage="gene"
      subject={{ gene: { id: symbol, label: symbol } }}
      ledger={{
        title: "Variants",
        empty: "No variants loaded",
        holds:
          "Reported variants with clinical significance, review status and population frequency.",
      }}
      instrument={{
        title: "Variants on the sequence",
        empty: `No gene record loaded for ${symbol}`,
        holds:
          "Variant markers above the domain architecture, linked to the table and the sequence axis.",
      }}
      inspector={{
        title: "Variant",
        empty: "No variant selected",
        holds:
          "The selected variant's record, review status, frequencies and evidence.",
      }}
    />
  );
}
