import type { Metadata } from "next";

import { ButtonLink } from "@/components/data/button-link";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <Page>
      <PageHeader kind="404" title="No page at this address" />
      <PageBody className="py-5">
        <Plate className="h-56">
          <EmptyState
            title="Nothing is served here"
            description="The address may be mistyped, or the identifier in it may not exist. Search for the disease, gene, protein or variant instead."
            actions={
              <>
                <div className="w-64">
                  <SearchTrigger />
                </div>
                <ButtonLink href="/explore">Open Explore</ButtonLink>
              </>
            }
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
