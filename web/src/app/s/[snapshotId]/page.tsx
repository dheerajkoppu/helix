import type { Metadata } from "next";

import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { decodeParam, isSnapshotId } from "@/lib/ids";

type Props = { params: Promise<{ snapshotId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Snapshot ${decodeParam((await params).snapshotId)}` };
}

export default async function SnapshotPage({ params }: Props) {
  const snapshotId = decodeParam((await params).snapshotId);
  const wellFormed = isSnapshotId(snapshotId);
  return (
    <Page>
      <PageHeader
        kind="Snapshot"
        title="Shared research snapshot"
        id={<MonoId value={snapshotId} />}
        description="An immutable copy of a project at one moment: its trail, inputs, model versions, output files, citations and hypotheses. The identifier is derived from the content, so the same link always shows the same analysis."
      />
      <PageBody className="py-5">
        <Plate className="h-72">
          {wellFormed ? (
            <EmptyState
              title="Snapshot not loaded"
              description="This page is not connected to the data service in this build."
              actions={<TextLink href="/projects">Projects</TextLink>}
            />
          ) : (
            <EmptyState
              title="Not a snapshot identifier"
              description="A snapshot identifier is ofs_ followed by 32 hexadecimal characters. Check that the link was copied in full."
              actions={<TextLink href="/projects">Projects</TextLink>}
            />
          )}
        </Plate>
      </PageBody>
    </Page>
  );
}
