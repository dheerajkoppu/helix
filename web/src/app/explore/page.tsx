import type { Metadata } from "next";

import { Page, PageBody, PageHeader } from "@/components/shell/page";

import { ExploreGenes } from "./explore-genes";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <Page>
      <PageHeader
        kind="Explore"
        title="Inborn errors of immunity"
        description="Browse immune disorders and their genes by classification category, inheritance, protein family, structure availability and reported variants. Nothing here ranks a disease or a protein by its chance of a cure."
      />
      <PageBody className="py-5">
        <ExploreGenes />
      </PageBody>
    </Page>
  );
}
