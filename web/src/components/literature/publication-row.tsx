"use client";

import { useId, useState } from "react";
import { ChevronRightIcon, MessageSquareTextIcon } from "lucide-react";
import { cn } from "cn";

import { ExternalLink } from "@/components/data/external-link";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { Button } from "@/components/ui/button";
import { askOrpha } from "@/lib/state/assistant";
import { formatCount } from "@/lib/format";

import type {
  LiteratureContextInput,
  LiteraturePublication,
  RelevanceReason,
} from "./types";

const MAX_AUTHORS = 3;

function authorLine(publication: LiteraturePublication): string | null {
  const authors = publication.authors;
  if (authors.length === 0) return publication.author_string;
  if (authors.length <= MAX_AUTHORS) return authors.join(", ");
  return `${authors.slice(0, MAX_AUTHORS).join(", ")} and ${authors.length - MAX_AUTHORS} more`;
}

/** The detail is printed for short matches (the matched text); long explanations stay in the label. */
function reasonText(reason: RelevanceReason): React.ReactNode {
  if (reason.code === "highly_cited" || !reason.detail) return reason.label;
  if (reason.code === "matched_outside_abstract") return reason.label;
  return (
    <>
      {reason.label}{": "}
      <span className="font-mono">{reason.detail}</span>
    </>
  );
}

function currentRoute(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname + window.location.search;
}

export interface PublicationRowProps {
  publication: LiteraturePublication;
  context: LiteratureContextInput;
}

export function PublicationRow({ publication, context }: PublicationRowProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const authors = authorLine(publication);
  const outside = publication.relevance.find(
    (reason) => reason.code === "matched_outside_abstract",
  );
  const reference = publication.pmid
    ? `pmid:${publication.pmid}`
    : publication.doi
      ? `doi:${publication.doi}`
      : (publication.url ?? publication.title);

  const ask = () => {
    const about = [
      context.variant,
      context.gene ?? context.accession,
      context.disease,
    ]
      .filter(Boolean)
      .join(", ");
    const identifier = publication.pmid
      ? `PMID ${publication.pmid}`
      : (publication.doi ?? "");
    askOrpha(
      `What does this paper report${about ? ` about ${about}` : ""}? "${publication.title}" (${identifier})`,
      {
        route: currentRoute(),
        gene: context.gene ?? undefined,
        disease: context.disease ?? undefined,
        accession: context.accession ?? undefined,
        variant: context.variant ?? undefined,
        residue:
          typeof context.residue === "number" ? context.residue : undefined,
        pmid: publication.pmid,
        doi: publication.doi,
        paperTitle: publication.title,
      },
    );
  };

  return (
    <li className={cn("border-b border-border-subtle", open && "bg-active")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-1.5 px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "mt-0.5 size-3 shrink-0 text-subtle-foreground",
            open && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {publication.title}
          </span>
          <span className="text-muted-foreground">
            {authors ?? "Authors unknown"}
            <span className="text-subtle-foreground"> · </span>
            {publication.journal_abbreviation ??
              publication.journal ??
              "Journal unknown"}
            <span className="text-subtle-foreground"> · </span>
            <span className="tabular font-mono">
              {publication.year ?? "Year unknown"}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            {publication.pmid ? (
              <span>
                PMID{" "}
                <span className="font-mono text-foreground" translate="no">
                  {publication.pmid}
                </span>
              </span>
            ) : null}
            <span>
              {publication.cited_by_count === null ? (
                "Citations unknown"
              ) : (
                <>
                  <span className="tabular font-mono text-foreground">
                    {formatCount(publication.cited_by_count)}
                  </span>{" "}
                  {publication.cited_by_count === 1 ? "citation" : "citations"}
                </>
              )}
            </span>
            <span>
              {publication.is_open_access === null
                ? "Access unknown"
                : publication.is_open_access
                  ? "Open access"
                  : "Not open access"}
            </span>
            {publication.relevance.map((reason) => (
              <span
                key={reason.code}
                data-relevance={reason.code}
                className="inline-flex h-4 items-center gap-1 rounded-xs border border-border px-1 text-foreground"
              >
                {reasonText(reason)}
              </span>
            ))}
          </span>
        </span>
      </button>
      {open ? (
        <div
          id={detailId}
          className="flex flex-col gap-2 pr-3 pb-2.5 pl-[30px]"
        >
          {publication.abstract ? (
            <p className="max-w-[70ch] text-xs leading-5 whitespace-pre-line text-foreground">
              {publication.abstract}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No abstract in Europe PMC for this record.
            </p>
          )}
          {outside?.detail ? (
            <p className="text-2xs text-muted-foreground">{outside.detail}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AddToProjectButton
              size="sm"
              label="Save to project"
              item={{
                kind: "paper",
                ref: reference,
                label: publication.title,
                origin: { route: currentRoute() },
                evidence: publication.evidence ? [publication.evidence] : [],
                data: {
                  pmid: publication.pmid,
                  pmcid: publication.pmcid,
                  doi: publication.doi,
                  journal: publication.journal,
                  year: publication.year,
                  authors: publication.authors,
                  url: publication.url,
                  relevance: publication.relevance,
                },
              }}
            />
            <Button variant="outline" size="sm" onClick={ask}>
              <MessageSquareTextIcon data-icon="inline-start" aria-hidden />
              Ask Orpha about this paper
            </Button>
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs">
              <span className="text-subtle-foreground">View source</span>
              {publication.url ? (
                <ExternalLink href={publication.url}>Europe PMC</ExternalLink>
              ) : null}
              {publication.pubmed_url ? (
                <ExternalLink href={publication.pubmed_url}>
                  PubMed
                </ExternalLink>
              ) : null}
              {publication.doi_url ? (
                <ExternalLink href={publication.doi_url}>DOI</ExternalLink>
              ) : null}
              {publication.full_text_url ? (
                <ExternalLink href={publication.full_text_url}>
                  Full text
                </ExternalLink>
              ) : null}
            </span>
          </div>
          {publication.license ? (
            <p className="text-2xs text-subtle-foreground">
              Article licence (Europe PMC):{" "}
              <span className="font-mono">{publication.license}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
