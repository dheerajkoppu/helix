"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";

import { ExternalLink } from "@/components/data/external-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiQuery } from "@/lib/api/query";
import { formatCount } from "@/lib/format";

import { PublicationRow } from "./publication-row";
import type {
  LiteratureContextInput,
  LiteratureKind,
  LiteratureResponse,
  LiteratureSort,
} from "./types";

const PAGE_SIZE = 25;

const KINDS: { value: LiteratureKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "review", label: "Reviews" },
  { value: "primary", label: "Primary research" },
];

const SORTS: { value: LiteratureSort; label: string }[] = [
  { value: "cited", label: "Most cited" },
  { value: "relevance", label: "Europe PMC order" },
  { value: "date", label: "Newest" },
];

export interface LiteraturePanelProps {
  context: LiteratureContextInput;
  /** start narrowed to the selected residue or variant; default false */
  defaultFocused?: boolean;
  className?: string;
}

function focusLabel(context: LiteratureContextInput): string | null {
  if (context.variant) return context.variant.replace(/^[A-Z0-9]+-/, "");
  if (context.residue !== undefined && context.residue !== null)
    return `residue ${context.residue}`;
  return null;
}

function subjectLabel(context: LiteratureContextInput): string {
  return (
    [context.gene ?? context.accession, context.disease]
      .filter(Boolean)
      .join(", ") || "this selection"
  );
}

/**
 * Publications for the entities in view, from Europe PMC. Fills its parent and scrolls itself.
 * Each row prints the rules that matched it; there is no combined score.
 */
export function LiteraturePanel({
  context,
  defaultFocused = false,
  className,
}: LiteraturePanelProps) {
  const [kind, setKind] = useState<LiteratureKind>("all");
  const [sort, setSort] = useState<LiteratureSort>("cited");
  const [focused, setFocused] = useState(defaultFocused);
  const [page, setPage] = useState(1);

  const focus = focusLabel(context);
  const narrowed = focused && focus !== null;
  const hasSubject = Boolean(
    context.gene || context.disease || context.accession || focus,
  );

  const contextKey = [
    context.gene,
    context.disease,
    context.accession,
    context.variant,
    context.residue,
  ].join("|");
  const [seenContext, setSeenContext] = useState(contextKey);
  if (seenContext !== contextKey) {
    setSeenContext(contextKey);
    setPage(1);
  }

  const result = useQuery({
    ...apiQuery<LiteratureResponse>("/literature", {
      gene: context.gene ?? undefined,
      disease: context.disease ?? undefined,
      accession: context.accession ?? undefined,
      variant: narrowed ? (context.variant ?? undefined) : undefined,
      residue:
        narrowed && context.residue !== undefined && context.residue !== null
          ? String(context.residue)
          : undefined,
      kind,
      sort,
      page,
      page_size: PAGE_SIZE,
    }),
    enabled: hasSubject,
    placeholderData: keepPreviousData,
  });

  const response = result.data?.data;
  const failedSource = response?.sources.find(
    (source) => source.source === "europepmc" && source.state === "unavailable",
  );
  const total = response?.total ?? null;
  const first = response ? (response.page - 1) * response.page_size + 1 : 0;
  const last = response ? first + response.items.length - 1 : 0;

  const change = (update: () => void) => {
    update();
    setPage(1);
  };

  return (
    <section
      aria-label="Literature"
      className={cn("flex h-full min-h-0 flex-col text-xs", className)}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-sunken px-3 py-1">
        <ToggleGroup
          aria-label="Publication type"
          value={[kind]}
          onValueChange={(value) =>
            value.length
              ? change(() => setKind(value[0] as LiteratureKind))
              : null
          }
          variant="outline"
          size="sm"
          spacing={0}
        >
          {KINDS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label="Sort"
          value={[sort]}
          onValueChange={(value) =>
            value.length
              ? change(() => setSort(value[0] as LiteratureSort))
              : null
          }
          variant="outline"
          size="sm"
          spacing={0}
        >
          {SORTS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {focus ? (
          <Toggle
            variant="outline"
            size="sm"
            pressed={focused}
            onPressedChange={(pressed) => change(() => setFocused(pressed))}
          >
            Only papers on <span className="font-mono">{focus}</span>
          </Toggle>
        ) : (
          <span className="text-2xs text-subtle-foreground">
            Select a residue or variant to narrow to papers on it
          </span>
        )}
      </div>

      {response ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border-subtle px-3 py-1.5 text-2xs text-muted-foreground">
          <EvidenceBadge evidenceClass="literature" size="compact" />
          <span>
            {total === null ? (
              "Count unknown"
            ) : (
              <>
                <span className="tabular font-mono text-foreground">
                  {formatCount(total)}
                </span>{" "}
                {total === 1 ? "paper" : "papers"}
              </>
            )}
            {narrowed ? (
              <>
                {" "}
                mentioning <span className="font-mono">{focus}</span>
              </>
            ) : null}
          </span>
          <span aria-hidden className="h-2.5 w-px bg-border" />
          {response.query_url ? (
            <ExternalLink href={response.query_url} className="text-2xs">
              Same search at Europe PMC
            </ExternalLink>
          ) : (
            <span>Europe PMC</span>
          )}
          <span className="basis-full text-subtle-foreground">
            Tags on each row are fixed rules (text match, UniProt citation list,
            publication type, {response.highly_cited_threshold} or more
            citations). No model ranks or reads the papers.
          </span>
          {response.notes.map((note) => (
            <span key={note} className="basis-full text-muted-foreground">
              {note}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          result.isPlaceholderData && "opacity-60",
        )}
      >
        {!hasSubject ? (
          <EmptyState
            title="Nothing to search for yet"
            description="Open a gene, disease, protein or variant and its publications are listed here."
          />
        ) : result.isPending ? (
          <RowsSkeleton rows={10} />
        ) : result.isError ? (
          <QueryErrorState
            error={result.error}
            subject={`publications for ${subjectLabel(context)}`}
            onRetry={() => result.refetch()}
            retrying={result.isFetching}
          />
        ) : failedSource ? (
          <SourceUnavailable
            size="zone"
            source={failedSource.name ?? "Europe PMC"}
            message={failedSource.message}
            onRetry={() => result.refetch()}
            retrying={result.isFetching}
          />
        ) : response && response.items.length === 0 ? (
          <EmptyState
            title={
              narrowed
                ? `No paper found mentioning ${focus}`
                : kind === "review"
                  ? "No review found"
                  : "No publication found"
            }
            description={
              narrowed
                ? "Only the notations listed in the search were matched; a paper that writes the change differently, or only in a figure or supplement, is not found this way."
                : `Europe PMC returned no PubMed-indexed record for ${subjectLabel(context)}.`
            }
            searched={["Europe PMC"]}
            actions={
              <>
                {narrowed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => change(() => setFocused(false))}
                  >
                    Show all papers for {subjectLabel(context)}
                  </Button>
                ) : null}
                {kind !== "all" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => change(() => setKind("all"))}
                  >
                    Include all publication types
                  </Button>
                ) : null}
                {response.query_url ? (
                  <ExternalLink href={response.query_url}>
                    Open the search at Europe PMC
                  </ExternalLink>
                ) : null}
              </>
            }
          />
        ) : (
          <ol>
            {response?.items.map((publication) => (
              <PublicationRow
                key={publication.pmid ?? publication.url ?? publication.title}
                publication={publication}
                context={context}
              />
            ))}
          </ol>
        )}
      </div>

      {response && response.items.length > 0 && total !== null ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-sunken px-3 text-2xs text-muted-foreground">
          <span className="tabular font-mono">
            {first}-{last} of {formatCount(total)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1 || result.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!response.has_more || result.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
