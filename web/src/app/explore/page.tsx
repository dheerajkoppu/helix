import type { Metadata } from "next";
import { Suspense } from "react";

import { ByMode } from "@/components/docs/advanced-only";
import { ExploreBrowser } from "@/components/explore/explore-browser";
import { Page, PageBody, PageHeader } from "@/components/shell/page";
import { EXPLORE_WORDS } from "@/lib/plain-language";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <Page>
      <PageHeader
        title={
          <ByMode
            simple={EXPLORE_WORDS.title}
            advanced="Inborn errors of immunity"
          />
        }
        description={
          <ByMode
            simple={EXPLORE_WORDS.line}
            advanced="Genes of the IUIS classification, with counts from public databases."
          />
        }
      />
      <PageBody className="py-4">
        <Suspense fallback={null}>
          <ExploreBrowser />
        </Suspense>
      </PageBody>
    </Page>
  );
}
