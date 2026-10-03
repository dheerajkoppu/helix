import type { Metadata } from "next";
import { Suspense } from "react";

import { DiseaseWorkspace } from "@/components/disease/disease-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Disease` };
}

export default async function DiseasePage({ params }: Props) {
  const diseaseId = decodeParam((await params).id);
  return (
    <Suspense fallback={null}>
      <DiseaseWorkspace diseaseId={diseaseId} />
    </Suspense>
  );
}
