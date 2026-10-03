"use client";

import { cn } from "cn";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { GLOSSARY, type GlossaryTermId } from "@/lib/glossary";
import { useLearnMode } from "@/lib/state/preferences";

export interface LearnTermProps {
  /** glossary key, e.g. "plddt", "missense-mutation" */
  term: GlossaryTermId;
  /** the text as it appears in the sentence; defaults to the glossary term */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Wrap any concept a newcomer might not know. With Learn Mode off it renders plain text.
 * With Learn Mode on it gains a dotted underline and a short definition on hover or focus.
 * The definition is never the only place a fact lives.
 */
export function LearnTerm({ term, children, className }: LearnTermProps) {
  const learnMode = useLearnMode();
  const entry = GLOSSARY[term];
  const content = children ?? entry.term;

  if (!learnMode) return <span className={className}>{content}</span>;

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={120}
        closeDelay={80}
        render={<span tabIndex={0} />}
        className={cn(
          "cursor-help rounded-xs underline decoration-border-strong decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-foreground",
          className,
        )}
      >
        {content}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 gap-0 p-0">
        <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
          <span className="font-medium text-foreground">{entry.term}</span>
          <span className="text-2xs text-subtle-foreground">Learn Mode</span>
        </div>
        <div className="flex flex-col gap-1.5 px-3 py-2 text-foreground">
          <p>{entry.definition}</p>
          {"detail" in entry && entry.detail ? (
            <p className="text-muted-foreground">{entry.detail}</p>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
