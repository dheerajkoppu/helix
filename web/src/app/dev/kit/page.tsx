import type { Metadata } from "next";

import { TextLink } from "@/components/data/text-link";
import { Page, PageHeader } from "@/components/shell/page";

import { Kit } from "./kit";

export const metadata: Metadata = { title: "Design kit" };

export default function KitPage() {
  return (
    <Page>
      <PageHeader
        kind="Dev"
        title="Design kit"
        description="Every shared component and token, each shown in the light and the dark theme. Build pages from these parts. If something you need is missing, add it here first."
        meta={
          <span className="text-xs text-muted-foreground">
            Rules for using them are in{" "}
            <span className="font-mono text-foreground">
              docs/DESIGN_SYSTEM.md
            </span>
            . The live frame is on any workspace route, for example{" "}
            <TextLink href="/protein/Q06187">/protein/Q06187</TextLink>.
          </span>
        }
      />
      <Kit />
    </Page>
  );
}
