import type { Metadata } from "next";

import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Project ${decodeParam((await params).id)}` };
}

export default async function ProjectPage({ params }: Props) {
  const projectId = decodeParam((await params).id);
  return (
    <Page>
      <PageHeader kind="Project" title="Research project" id={<MonoId value={projectId} />} />
      <PageBody className="py-5">
        <Plate className="h-72">
          <EmptyState
            title="Project not loaded"
            description="The research trail, saved items, runs, notes and hypotheses of this project appear here. This page is not connected to the data service in this build."
            actions={<TextLink href="/projects">All projects</TextLink>}
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
