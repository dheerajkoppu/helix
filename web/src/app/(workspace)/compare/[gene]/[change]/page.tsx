import type { Metadata } from "next";

import { CompareStage } from "@/components/compare/compare-stage";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ gene: string; change: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gene, change } = await params;
  return { title: `${decodeParam(gene)} ${decodeParam(change)} · Compare` };
}

export default async function ComparePage({ params }: Props) {
  const resolved = await params;
  return (
    <CompareStage
      gene={decodeParam(resolved.gene)}
      change={decodeParam(resolved.change)}
    />
  );
}
