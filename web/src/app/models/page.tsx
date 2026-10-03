import type { Metadata } from "next";

import { ButtonLink } from "@/components/data/button-link";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
} from "@/components/shell/page";

import { AdvancedOnly } from "@/components/docs/advanced-only";

import { ModelsTable } from "./models-table";

export const metadata: Metadata = { title: "Models" };

export default function ModelsPage() {
  return (
    <Page>
      <PageHeader
        title="Models"
        description="Every result names its model and version."
        actions={
          <ButtonLink href="/docs/adding-a-model">Add a model</ButtonLink>
        }
      />
      <PageBody>
        <ModelsTable />
        <AdvancedOnly>
        <PageSection title="Adding a model">
          <ol className="flex max-w-[80ch] list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Add one new module under{" "}
              <code className="font-mono text-foreground">
                api/orphafold/providers/
              </code>
              . Every module in that package is imported at startup, so no
              registration list has to be edited.
            </li>
            <li>
              Implement one of the interfaces in{" "}
              <code className="font-mono text-foreground">
                orphafold.providers.base
              </code>{" "}
              (<code className="font-mono">StructurePredictor</code>,{" "}
              <code className="font-mono">BindingPredictor</code>,{" "}
              <code className="font-mono">VariantEffectProvider</code>,{" "}
              <code className="font-mono">PocketProvider</code>,{" "}
              <code className="font-mono">LiteratureProvider</code>) and declare
              the fields shown in this table as class attributes: model name and
              version, license, commercial-use flag, capabilities, execution
              mode, structure origin, limitations and citation.
            </li>
            <li>
              Implement{" "}
              <code className="font-mono text-foreground">
                check_availability()
              </code>{" "}
              so this page can say whether the model runs here and why not.
            </li>
            <li>
              The provider then appears in{" "}
              <code className="font-mono text-foreground">
                GET /api/v1/models
              </code>
              , in this table and in the run dialog of every job kind that
              accepts it.
            </li>
          </ol>
          <p className="mt-3 max-w-[80ch] text-sm text-muted-foreground">
            The full recipe, with a worked example, is section 8 of{" "}
            <code className="font-mono text-foreground">
              docs/ARCHITECTURE.md
            </code>{" "}
            in the repository (&ldquo;A model provider&rdquo; and &ldquo;A job
            handler&rdquo;).
          </p>
        </PageSection>
        </AdvancedOnly>
      </PageBody>
    </Page>
  );
}
