import type { Metadata } from "next";

import { ProteinWorkspace } from "@/components/protein/protein-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Protein` };
}

export default async function ProteinPage({ params }: Props) {
  const accession = decodeParam((await params).id).toUpperCase();
  return <ProteinWorkspace accession={accession} />;
}
