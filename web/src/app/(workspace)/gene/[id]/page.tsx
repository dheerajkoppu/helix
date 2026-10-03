import type { Metadata } from "next";

import { GeneWorkspace } from "@/components/gene/gene-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Gene and variants` };
}

export default async function GenePage({ params }: Props) {
  return <GeneWorkspace symbol={decodeParam((await params).id)} />;
}
