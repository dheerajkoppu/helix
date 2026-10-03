import type { Metadata } from "next";

import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { WorkspaceIdentity } from "@/components/shell/workspace-identity";
import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <Page>
      <PageHeader
        kind="Jobs"
        title="Computational jobs"
        description="Every prediction runs as a job with named stages. A job never blocks the workspace, its results persist, and each run produces a machine-readable manifest of its inputs, model, version and outputs."
        meta={<WorkspaceIdentity className="text-xs" />}
      />
      <PageBody className="py-5">
        <Plate className="h-64">
          <EmptyState
            title="No jobs loaded"
            description="Queued, running and finished jobs for this workspace are listed here. This page is not connected to the job service in this build."
            actions={<TextLink href="/models">See available models</TextLink>}
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
