import type { Metadata } from "next";

import { AdvancedOnly } from "@/components/docs/advanced-only";
import { ProjectsList } from "@/components/project/projects-list";
import { Page, PageBody, PageHeader } from "@/components/shell/page";
import { WorkspaceIdentity } from "@/components/shell/workspace-identity";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Each project is a trail of saved steps."
        meta={
          <AdvancedOnly>
            <WorkspaceIdentity className="text-xs" />
          </AdvancedOnly>
        }
      />
      <PageBody>
        <ProjectsList />
      </PageBody>
    </Page>
  );
}
