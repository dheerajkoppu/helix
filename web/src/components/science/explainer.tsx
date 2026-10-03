"use client";

import { cn } from "cn";

import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { Swatch } from "@/components/science/swatch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GLOSSARY,
  type GlossaryEntry,
  type GlossaryTermId,
} from "@/lib/glossary";
import { METRICS, type MetricId } from "@/lib/science/metrics";

/** A metric id from `@/lib/science/metrics` or a glossary term id from `@/lib/glossary`. */
export type ExplainerKey = MetricId | GlossaryTermId;

export function isMetricId(key: string): key is MetricId {
  return Object.hasOwn(METRICS, key);
}

export function isExplainerKey(key: string): key is ExplainerKey {
  return isMetricId(key) || Object.hasOwn(GLOSSARY, key);
}

export interface ExplainerProps {
  /** unknown keys render nothing, so a missing definition never shows an empty popover */
  term: ExplainerKey | (string & {});
  /** model or tool that produced the number: "AlphaFold DB v6" */
  producedBy?: string | null;
  className?: string;
}

/**
 * The `?` beside a number or a term. Explanations live here, never inline.
 */
export function Explainer({ term, producedBy, className }: ExplainerProps) {
  if (!isExplainerKey(term)) return null;
  const name = isMetricId(term) ? METRICS[term].label : GLOSSARY[term].term;

  return (
    <Popover>
      <PopoverTrigger
        data-slot="explainer"
        aria-label={`What does ${name} mean?`}
        className={cn(
          "inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong font-sans text-[0.5625rem] leading-none font-medium text-subtle-foreground hover:border-foreground hover:text-foreground aria-expanded:border-foreground aria-expanded:text-foreground",
          className,
        )}
      >
        ?
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[23rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
      >
        {isMetricId(term) ? (
          <MetricExplanation metric={term} producedBy={producedBy} />
        ) : (
          <TermExplanation entry={GLOSSARY[term]} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function MetricExplanation({
  metric,
  producedBy,
}: {
  metric: MetricId;
  producedBy?: string | null;
}) {
  const definition = METRICS[metric];
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{definition.label}</p>
          <p className="text-2xs text-muted-foreground">{definition.name}</p>
        </div>
        <EvidenceBadge evidenceClass="computational_prediction" />
      </div>
      <p className="px-3 py-2 text-foreground">{definition.what}</p>
      {definition.scale.length > 0 ? (
        <ul className="border-t border-border-subtle py-1">
          {definition.scale.map((row) => (
            <li
              key={row.range}
              className="grid grid-cols-[0.875rem_7rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1"
            >
              {row.swatchClass ? (
                <Swatch
                  swatchClass={row.swatchClass}
                  code={row.code}
                  onFill={row.onFill}
                  className="self-center"
                />
              ) : (
                <span aria-hidden />
              )}
              <span className="tabular font-mono text-2xs text-foreground">
                {row.range}
              </span>
              <span className="text-muted-foreground">{row.meaning}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="border-t border-border-subtle px-3 py-2 text-muted-foreground">
        {definition.limits}
      </p>
      {producedBy ? (
        <p className="border-t border-border-subtle px-3 py-2 text-2xs text-subtle-foreground">
          Produced by{" "}
          <span className="font-mono text-muted-foreground">{producedBy}</span>
        </p>
      ) : null}
    </>
  );
}

function TermExplanation({ entry }: { entry: GlossaryEntry }) {
  return (
    <>
      <p className="border-b border-border-subtle px-3 py-2 font-medium text-foreground">
        {entry.term}
      </p>
      <div className="flex flex-col gap-1.5 px-3 py-2 text-foreground">
        <p>{entry.definition}</p>
        {entry.detail ? (
          <p className="text-muted-foreground">{entry.detail}</p>
        ) : null}
      </div>
    </>
  );
}
