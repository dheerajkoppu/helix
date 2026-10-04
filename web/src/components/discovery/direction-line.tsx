"use client";

import { HelpCircleIcon } from "lucide-react";

import { EvidencePopover } from "@/components/evidence/evidence-popover";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DISCOVERY_WORDS,
  plainDirectionLine,
  plainRequiredActions,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

import { badgeEvidence } from "./model";
import {
  toDiscoveryEvidence,
  type DiscoveryCandidatesResponse,
} from "@/lib/workspace-data";

/**
 * The one line the screen opens on: what the protein does wrong and what a drug would therefore
 * have to do. The rule that derived it sits behind the `?`, never inline. When the direction is
 * unknown the line says so; it is never guessed.
 */
export function DirectionLine({ data }: { data: DiscoveryCandidatesResponse }) {
  const advanced = useAdvancedMode();
  const mechanism = data.subject?.mechanism ?? null;
  const action = data.required_action ?? null;
  const actions = action?.actions ?? [];
  // The headline keeps one action; the rest are a click away, inside the rule.
  const sentence = plainDirectionLine({
    mechanismClass: mechanism?.class ?? null,
    direction: mechanism?.direction ?? null,
    actions: advanced ? actions : actions.slice(0, 1),
  });
  const evidence = mechanism?.evidence ?? [];

  return (
    <div className="border-b border-border-subtle px-4 py-4 sm:px-6">
      <div className="flex max-w-[52rem] items-start gap-2">
        <p className="text-base leading-snug font-medium text-foreground sm:text-lg">
          {sentence}
        </p>
        <Popover>
          <PopoverTrigger
            aria-label={DISCOVERY_WORDS.rule}
            className="mt-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-subtle-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-active"
          >
            <HelpCircleIcon className="size-3.5" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 gap-2">
            <PopoverTitle>{DISCOVERY_WORDS.rule}</PopoverTitle>
            {action?.rule ? (
              <p className="text-foreground">{action.rule}</p>
            ) : (
              <p className="text-muted-foreground">
                No rule was reported with this answer.
              </p>
            )}
            {action?.why ? (
              <p className="text-muted-foreground">{action.why}</p>
            ) : null}
            {plainRequiredActions(actions) ? (
              <p className="text-muted-foreground">
                Helix kept only molecules whose recorded action would{" "}
                {plainRequiredActions(actions)}.
              </p>
            ) : null}
            {advanced && actions.length ? (
              <p className="font-mono text-2xs text-muted-foreground">
                {actions.join(", ")}
                {mechanism?.class ? ` · ${mechanism.class}` : ""}
                {mechanism?.direction ? ` · ${mechanism.direction}` : ""}
                {mechanism?.confidence ? ` · ${mechanism.confidence}` : ""}
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
      {evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {badgeEvidence(evidence, advanced).map((item, index) => (
              <EvidencePopover
                key={`${item.source?.record_id ?? item.source?.database ?? "evidence"}-${index}`}
                evidence={toDiscoveryEvidence(item)}
                size="compact"
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
