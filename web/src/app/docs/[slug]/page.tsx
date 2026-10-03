import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TextLink } from "@/components/data/text-link";
import { DocRail } from "@/components/docs/doc-rail";
import {
  GLOSSARY_HEADINGS,
  GlossaryList,
} from "@/components/docs/glossary-list";
import { DocMarkdown } from "@/components/docs/markdown";
import { DOC_ENTRIES, docEntry } from "@/components/docs/registry";
import { loadDoc } from "@/components/docs/source";
import { Page, PageBody, PageHeader } from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";

interface DocPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return DOC_ENTRIES.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: DocPageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = docEntry(slug);
  return { title: entry ? `${entry.title} · Docs` : "Docs" };
}

export default async function DocPage({ params }: DocPageProps) {
  const { slug } = await params;
  const entry = docEntry(slug);
  if (!entry) notFound();

  const position = DOC_ENTRIES.indexOf(entry);
  const previous = DOC_ENTRIES[position - 1];
  const next = DOC_ENTRIES[position + 1];
  const loaded = await loadDoc(entry);
  const headings = entry.file ? (loaded?.headings ?? []) : GLOSSARY_HEADINGS;

  return (
    <Page>
      <PageHeader
        kind={
          <TextLink href="/docs" className="no-underline hover:underline">
            Docs
          </TextLink>
        }
        title={entry.title}
        id={entry.file ? `docs/${entry.file}` : "web/src/lib/glossary.ts"}
        description={entry.summary}
      />
      <PageBody className="grid gap-x-10 gap-y-8 py-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="min-w-0">
          {!entry.file ? (
            <GlossaryList />
          ) : loaded ? (
            <DocMarkdown file={entry.file}>{loaded.body}</DocMarkdown>
          ) : (
            <EmptyState
              size="inline"
              title="This document is not in this build"
              description={`docs/${entry.file} was not found beside the web app. It is part of the source repository.`}
            />
          )}
          <nav
            aria-label="Adjacent documents"
            className="mt-10 flex flex-wrap justify-between gap-3 border-t border-border pt-4 text-sm"
          >
            {previous ? (
              <span className="text-muted-foreground">
                Previous:{" "}
                <TextLink href={`/docs/${previous.slug}`}>
                  {previous.title}
                </TextLink>
              </span>
            ) : (
              <span />
            )}
            {next ? (
              <span className="text-muted-foreground">
                Next:{" "}
                <TextLink href={`/docs/${next.slug}`}>{next.title}</TextLink>
              </span>
            ) : null}
          </nav>
        </article>
        <DocRail current={entry.slug} headings={headings} />
      </PageBody>
    </Page>
  );
}
