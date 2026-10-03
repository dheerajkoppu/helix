import type { Metadata } from "next";
import { Suspense } from "react";

import { LabRun } from "@/components/lab/lab-run";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ runId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Lab run ${decodeParam((await params).runId)}` };
}

export default async function LabRunPage({ params }: Props) {
  const runId = decodeParam((await params).runId);
  return (
    <Suspense>
      <LabRun runId={runId} />
    </Suspense>
  );
}
