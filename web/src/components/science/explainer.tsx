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
import {
  MORE_LABEL,
  PREDICTION_CAVEAT,
  plainMetricLabel,
  plainMetricMeaning,
} from "@/lib/plain-language";
import { METRICS, type MetricId } from "@/lib/science/metrics";
import { useAdvancedMode } from "@/lib/state/preferences";

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
  const advanced = useAdvancedMode();
  if (!isExplainerKey(term)) return null;
  const entry: GlossaryEntry | null = isMetricId(term) ? null : GLOSSARY[term];
  const name = isMetricId(term)
    ? advanced
      ? METRICS[term].label
      : plainMetricLabel(term)
    : advanced
      ? GLOSSARY[term].term
      : plainTermName(GLOSSARY[term]);

  return (
    <Popover>
      <PopoverTrigger
        data-slot="explainer"
        aria-label={`What does ${name} mean?`}
        className={cn(
          "inline-flex size-[1.125rem] shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong font-sans text-2xs leading-none font-medium text-subtle-foreground hover:border-foreground hover:text-foreground aria-expanded:border-foreground aria-expanded:text-foreground",
          className,
        )}
      >
        ?
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[23rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
      >
        {advanced ? (
          isMetricId(term) ? (
            <MetricExplanation metric={term} producedBy={producedBy} />
          ) : (
            <TermExplanation entry={GLOSSARY[term]} />
          )
        ) : (
          <PlainExplanation
            title={name}
            sentences={
              isMetricId(term)
                ? [
                    plainMetricMeaning(term) ?? METRICS[term].what,
                    PREDICTION_CAVEAT,
                  ]
                : [entry?.plain ?? firstSentences(entry?.definition ?? "")]
            }
          >
            {isMetricId(term) ? (
              <MetricExplanation metric={term} producedBy={producedBy} />
            ) : (
              <TermExplanation entry={GLOSSARY[term]} />
            )}
          </PlainExplanation>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A glossary term's name in simple mode. */
export function plainTermName(entry: GlossaryEntry): string {
  return entry.plainTerm ?? entry.term;
}

/** At most two sentences of a longer definition. */
export function firstSentences(text: string, count = 2): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  return sentences ? sentences.slice(0, count).join("").trim() : text;
}

/** Simple mode: a plain line or two, with the technical definition folded under "More". */
export function PlainExplanation({
  title,
  sentences,
  children,
}: {
  title: string;
  sentences: string[];
  children: React.ReactNode;
}) {
  return (
    <>
      <p className="border-b border-border-subtle px-3 py-2 font-medium text-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-1 px-3 py-2 text-sm text-foreground">
        {sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      <details className="group/more border-t border-border-subtle">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          {MORE_LABEL}
        </summary>
        <div className="border-t border-border-subtle text-xs">{children}</div>
      </details>
    </>
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
