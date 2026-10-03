import type { Metadata } from "next";
import Link from "next/link";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { DOC_GROUPS } from "@/components/docs/registry";
import { AdvancedOnly } from "@/components/docs/advanced-only";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
} from "@/components/shell/page";
import { API_BASE_URL } from "@/lib/api/client";

export const metadata: Metadata = { title: "Documentation" };

const QUICK_START = ["make setup", "make dev"];

export default function DocsPage() {
  return (
    <Page>
      <PageHeader
        title="Documentation"
        description="How to run it, where data comes from, and its limits."
      />
      <PageBody>
        <PageSection
          title="Run it"
          actions={
            <TextLink href="/docs/getting-started">Getting started</TextLink>
          }
        >
          <div className="max-w-[40rem] overflow-x-auto border border-border bg-sunken">
            <pre className="px-3 py-2.5 font-mono text-xs leading-5 text-foreground">
              {QUICK_START.map((command) => (
                <span key={command} className="block">
                  <span
                    aria-hidden
                    className="mr-2 text-subtle-foreground select-none"
                  >
                    $
                  </span>
                  {command}
                </span>
              ))}
            </pre>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            No database, queue, GPU or API key needed.
          </p>
        </PageSection>

        {DOC_GROUPS.map((group) => (
          <PageSection
            key={group.id}
            title={group.title}
            count={group.entries.length}
          >
            <ul className="flex flex-col border-t border-border-subtle">
              {group.entries.map((entry) => (
                <li key={entry.slug} className="border-b border-border-subtle">
                  <Link
                    href={`/docs/${entry.slug}`}
                    className="group grid items-baseline gap-x-6 gap-y-0.5 py-2.5 text-base outline-none hover:bg-sunken focus-visible:bg-sunken sm:grid-cols-[15rem_minmax(0,1fr)_auto] sm:px-2"
                  >
                    <span className="font-medium text-foreground underline decoration-transparent decoration-1 underline-offset-[3px] group-hover:decoration-foreground">
                      {entry.title}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.summary}
                    </span>
                    <AdvancedOnly>
                      <span className="hidden font-mono text-xs text-subtle-foreground lg:block">
                        {entry.file
                          ? `docs/${entry.file}`
                          : "web/src/lib/glossary.ts"}
                      </span>
                    </AdvancedOnly>
                  </Link>
                </li>
              ))}
            </ul>
          </PageSection>
        ))}

        <PageSection title="Reference">
          <ul className="flex flex-col text-base">
            <li className="grid items-baseline gap-x-6 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:px-2">
              <ExternalLink
                href={`${API_BASE_URL}/docs`}
                className="justify-self-start font-medium"
              >
                API reference
              </ExternalLink>
              <span className="text-muted-foreground">
                OpenAPI, at{" "}
                <span className="font-mono text-sm">{API_BASE_URL}</span>
              </span>
            </li>
            <li className="grid items-baseline gap-x-6 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:px-2">
              <TextLink
                href="/models"
                className="justify-self-start font-medium"
              >
                Model providers
              </TextLink>
              <span className="text-muted-foreground">
                Models registered here and their availability.
              </span>
            </li>
            <li className="grid items-baseline gap-x-6 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:px-2">
              <TextLink
                href="/about"
                className="justify-self-start font-medium"
              >
                About
              </TextLink>
              <span className="text-muted-foreground">
                Mission, methodology and limits.
              </span>
            </li>
            <li className="grid items-baseline gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:px-2">
              <TextLink
                href="/dev/kit"
                className="justify-self-start font-medium"
              >
                Design kit
              </TextLink>
              <span className="text-muted-foreground">
                Shared components and tokens.
              </span>
            </li>
          </ul>
        </PageSection>
      </PageBody>
    </Page>
  );
}
