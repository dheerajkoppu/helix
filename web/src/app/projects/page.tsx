import type { Metadata } from "next";

import { AdvancedOnly, ByMode } from "@/components/docs/advanced-only";
import { ProjectsList } from "@/components/project/projects-list";
import { Page, PageBody, PageHeader } from "@/components/shell/page";
import { WorkspaceIdentity } from "@/components/shell/workspace-identity";
import { PROJECT_WORDS } from "@/lib/plain-language";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Page>
      <PageHeader
        title="Projects"
        description={
          <ByMode
            simple={PROJECT_WORDS.listLine}
            advanced="Each project is a trail of saved steps."
          />
        }
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
