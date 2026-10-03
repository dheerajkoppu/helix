import type { Metadata } from "next";

import { SnapshotView } from "@/components/project/snapshot-view";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ snapshotId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Snapshot ${decodeParam((await params).snapshotId)}` };
}

export default async function SnapshotPage({ params }: Props) {
  return <SnapshotView snapshotId={decodeParam((await params).snapshotId)} />;
}
