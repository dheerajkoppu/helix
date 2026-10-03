import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/data/button-link";
import { TextLink } from "@/components/data/text-link";
import { HomeSearch } from "@/components/home/home-search";
import { Wordmark } from "@/components/shell/wordmark";
import { routes } from "@/lib/ids";
import {
  EXAMPLES_LABEL,
  HOME_LINE,
  OPEN_LAB_LABEL,
} from "@/lib/plain-language";
import { site } from "@/lib/site";

import { MissionLine } from "./mission-line";

const EXAMPLES = ["ADA", "IL2RG", "BTK", "WAS", "RAG1"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await searchParams;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 pt-[16vh] pb-6">
      <h1 className="sr-only">{site.name}</h1>
      <Wordmark size="lg" />
      <p className="mt-4 text-lg text-muted-foreground">{HOME_LINE}</p>

      <HomeSearch
        className="mt-10"
        initialQuery={typeof q === "string" ? q.slice(0, 200) : ""}
      />
      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
        <span className="mr-1">{EXAMPLES_LABEL}</span>
        {EXAMPLES.map((symbol) => (
          <Link
            key={symbol}
            href={routes.gene(symbol)}
            className="rounded-xs border border-border px-2 py-1 font-mono text-foreground hover:border-border-strong hover:bg-accent"
            translate="no"
          >
            {symbol}
          </Link>
        ))}
      </p>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-border pt-6">
        <MissionLine className="text-base text-muted-foreground" />
        <ButtonLink
          href="/lab"
          variant="default"
          className="h-10 gap-2 px-4 text-base"
        >
          {OPEN_LAB_LABEL}
          <ArrowRightIcon aria-hidden className="size-4" />
        </ButtonLink>
      </div>

      <p className="mt-auto flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pt-12 text-2xs text-subtle-foreground">
        <span>{site.researchUseNotice}</span>
        <TextLink href="/about">About</TextLink>
      </p>
    </div>
  );
}
