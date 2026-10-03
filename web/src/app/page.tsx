import Link from "next/link";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { Wordmark } from "@/components/shell/wordmark";
import { routes } from "@/lib/ids";
import { site } from "@/lib/site";

import { MissionLine } from "./mission-line";

const EXAMPLES = ["ADA", "IL2RG", "BTK", "WAS", "RAG1"];

const STEPS = [
  {
    title: "Understand the mutation.",
    body: "A disease, its gene and the variants reported for it, each with the database that asserts it.",
  },
  {
    title: "See the structure.",
    body: "Experimental and predicted structures in 3D, linked residue by residue to the sequence, with confidence shown.",
  },
  {
    title: "Explore what might restore function.",
    body: "Compare reference and variant, weigh candidate mechanisms and compounds, and record a hypothesis.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 pt-[12vh] pb-10">
      <Wordmark size="lg" />
      <p className="mt-4 text-lg text-muted-foreground">{site.tagline}</p>

      <SearchTrigger variant="hero" className="mt-9" />
      <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-subtle-foreground">
        <span className="mr-1">Examples</span>
        {EXAMPLES.map((symbol) => (
          <Link
            key={symbol}
            href={routes.gene(symbol)}
            className="rounded-xs border border-border px-1.5 py-0.5 font-mono text-foreground hover:border-border-strong hover:bg-accent"
            translate="no"
          >
            {symbol}
          </Link>
        ))}
      </p>

      <section aria-label="What you can do" className="mt-16">
        <MissionLine />
        <ol className="grid border-t border-border-strong sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="relative border-b border-border-subtle py-4 pr-6 before:absolute before:top-0 before:left-0 before:h-2 before:w-px before:bg-border-strong sm:border-b-0 sm:pl-3"
            >
              <span className="tabular font-mono text-2xs text-subtle-foreground">
                {index + 1}
              </span>
              <h2 className="mt-1 text-sm font-medium text-foreground">
                {step.title}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="open"
        aria-labelledby="open-heading"
        className="mt-10 grid gap-x-10 gap-y-4 border-t border-border pt-5 sm:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div>
          <h2 id="open-heading" className="text-sm font-medium text-foreground">
            Open by construction
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
            Every statement carries its source and evidence class. Every
            prediction carries its model, version, inputs and confidence.
            Analyses can be reproduced, downloaded and run locally, and models
            and data sources can be added. Licensed {site.license}.
          </p>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>
            {site.repositoryUrl ? (
              <ExternalLink href={site.repositoryUrl}>
                Source on GitHub
              </ExternalLink>
            ) : (
              <TextLink href="/about#open-source">Open source</TextLink>
            )}
          </li>
          <li>
            <TextLink href="/about">Methodology and limitations</TextLink>
          </li>
          <li>
            <TextLink href="/explore">
              Browse immune disorders and genes
            </TextLink>
          </li>
        </ul>
      </section>

      <p className="mt-auto pt-12 text-2xs text-subtle-foreground">
        A research and hypothesis-generation tool. It does not diagnose and does
        not recommend treatment.
      </p>
    </div>
  );
}
