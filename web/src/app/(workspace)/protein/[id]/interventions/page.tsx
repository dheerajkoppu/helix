import type { Metadata } from "next";
import { Suspense } from "react";

import { InterventionStage } from "@/components/intervention/intervention-stage";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Intervention` };
}

export default async function InterventionsPage({ params }: Props) {
  const accession = decodeParam((await params).id).toUpperCase();
  return (
    <Suspense fallback={null}>
      <InterventionStage accession={accession} />
    </Suspense>
  );
}
