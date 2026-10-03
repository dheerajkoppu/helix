import type { Metadata } from "next";

import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Job ${decodeParam((await params).id)}` };
}

export default async function JobPage({ params }: Props) {
  const jobId = decodeParam((await params).id);
  return (
    <Page>
      <PageHeader kind="Job" title="Computational job" id={<MonoId value={jobId} />} />
      <PageBody className="py-5">
        <Plate className="h-72">
          <EmptyState
            title="Job not loaded"
            description="Stages, elapsed time, confidence outputs, artifacts and the run manifest appear here. This page is not connected to the job service in this build."
            actions={<TextLink href="/jobs">All jobs</TextLink>}
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
