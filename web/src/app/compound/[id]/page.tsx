import type { Metadata } from "next";
import { Suspense } from "react";

import { CompoundPage } from "@/components/compound/compound-page";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Compound ${decodeParam((await params).id)}` };
}

export default async function CompoundRoute({ params }: Props) {
  const compoundId = decodeParam((await params).id);
  return (
    <Suspense fallback={null}>
      <CompoundPage compoundId={compoundId} />
    </Suspense>
  );
}
