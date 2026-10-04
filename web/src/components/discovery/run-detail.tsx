"use client";

import { SectionHeader } from "@/components/data/section-header";
import { SourceStatusList } from "@/components/evidence/source-status-list";
import { DISCOVERY_WORDS } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import type { SourceStatus } from "@/lib/api/types";
import type { DiscoveryCandidatesResponse } from "@/lib/workspace-data";

import { withheldEdgeLine } from "./model";

/**
 * What the run itself did: the edges it withheld, the limits it reports and which sources answered.
 * Shown in the inspector while nothing is selected.
 */
export function RunDetail({
  data,
  sources,
}: {
  data: DiscoveryCandidatesResponse;
  sources: SourceStatus[];
}) {
  const advanced = useAdvancedMode();
  const withheld = data.withheld_edges ?? [];
  const limits = data.limits ?? [];

  return (
    <div>
      {withheld.length > 0 ? (
        <>
          <SectionHeader
            title={DISCOVERY_WORDS.withheld}
            count={withheld.length}
            description={advanced ? undefined : DISCOVERY_WORDS.heldOutLine}
          />
          <ul className="flex flex-col">
            {withheld.map((edge, index) => (
              <li
                key={`withheld-${index}`}
                className="border-b border-border-subtle px-3 py-2 text-xs leading-snug text-muted-foreground last:border-b-0"
              >
                {withheldEdgeLine(edge)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {limits.length > 0 ? (
        <>
          <SectionHeader title={DISCOVERY_WORDS.limits} count={limits.length} />
          <ul className="flex flex-col">
            {limits.map((limit, index) => (
              <li
                key={`limit-${index}`}
                className="border-b border-border-subtle px-3 py-2 text-xs leading-snug text-muted-foreground last:border-b-0"
              >
                {limit}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {advanced && data.ranking_rule?.length ? (
        <>
          <SectionHeader
            title={DISCOVERY_WORDS.ranking}
            count={data.ranking_rule.length}
          />
          <ul className="flex flex-col">
            {data.ranking_rule.map((rule, index) => (
              <li
                key={`rank-rule-${index}`}
                className="border-b border-border-subtle px-3 py-2 text-xs leading-snug text-muted-foreground last:border-b-0"
              >
                {rule}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionHeader title={DISCOVERY_WORDS.sources} count={sources.length} />
      <SourceStatusList sources={sources} plain={!advanced} />
    </div>
  );
}
