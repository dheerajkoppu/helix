import type { Metadata } from "next";
import { Suspense } from "react";

import { ExploreBrowser } from "@/components/explore/explore-browser";
import { Page, PageBody, PageHeader } from "@/components/shell/page";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <Page>
      <PageHeader
        title="Inborn errors of immunity"
        description="Genes of the IUIS classification, with counts from public databases."
      />
      <PageBody className="py-4">
        <Suspense fallback={null}>
          <ExploreBrowser />
        </Suspense>
      </PageBody>
    </Page>
  );
}
