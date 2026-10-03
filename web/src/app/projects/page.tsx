import type { Metadata } from "next";

import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { WorkspaceIdentity } from "@/components/shell/workspace-identity";
import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Page>
      <PageHeader
        kind="Projects"
        title="Research projects"
        description="A project keeps the diseases, genes, variants, structures, compounds, papers, runs, notes and hypotheses of one investigation, as a trail in which every step records where it came from."
        meta={<WorkspaceIdentity className="text-xs" />}
      />
      <PageBody className="py-5">
        <Plate className="h-64">
          <EmptyState
            title="No projects loaded"
            description="Projects saved from this browser are listed here. This page is not connected to the data service in this build. No account is needed to explore."
            actions={<TextLink href="/explore">Start from Explore</TextLink>}
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
