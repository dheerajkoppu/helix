import type { Metadata } from "next";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { Page, PageBody, PageHeader, PageSection } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { API_BASE_URL } from "@/lib/api/client";

export const metadata: Metadata = { title: "Documentation" };

export default function DocsPage() {
  return (
    <Page>
      <PageHeader
        kind="Docs"
        title="Documentation"
        description="Developer and scientific documentation: how the platform is built, how to run it, how conclusions are produced and what their limits are."
      />
      <PageBody>
        <PageSection title="Available now">
          <ul className="flex flex-col text-sm">
            <li className="flex flex-wrap items-baseline gap-x-3 border-b border-border-subtle py-2">
              <TextLink href="/about">Methodology and limitations</TextLink>
              <span className="text-muted-foreground">Evidence classes, structure classes and what a prediction does not show.</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-3 border-b border-border-subtle py-2">
              <TextLink href="/dev/kit">Design kit</TextLink>
              <span className="text-muted-foreground">Every shared component and colour token, for contributors.</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-3 py-2">
              <ExternalLink href={`${API_BASE_URL}/docs`}>API reference</ExternalLink>
              <span className="text-muted-foreground">
                Served by the API at <span className="font-mono">{API_BASE_URL}</span> when it is running.
              </span>
            </li>
          </ul>
        </PageSection>
        <PageSection title="Guides">
          <EmptyState
            size="inline"
            title="No guides published in this build"
            description="Guides for running OrphaFold locally, adding a model provider and adding a data source are not published here yet."
          />
        </PageSection>
      </PageBody>
    </Page>
  );
}
