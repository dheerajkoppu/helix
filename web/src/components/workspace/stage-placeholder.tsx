"use client";


import { ButtonLink } from "@/components/data/button-link";
import { KeyHint } from "@/components/data/key-hint";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { EmptyState } from "@/components/states/empty-state";
import { useWorkspaceSubject } from "@/components/workspace/workspace-frame";
import { WorkspaceZones } from "@/components/workspace/workspace-zones";
import { Zone } from "@/components/workspace/zone";
import type { StageId, SubjectChain } from "@/lib/state/subject";

interface ZoneCopy {
  /** zone header title */
  title: string;
  /** what is absent right now */
  empty: string;
  /** what this zone holds once the stage is connected */
  holds: string;
}

export interface StagePlaceholderProps {
  stage: StageId;
  /** entities read from the URL, declared so the rail and subject bar show the chain */
  subject: SubjectChain;
  ledger?: ZoneCopy;
  instrument: ZoneCopy;
  inspector?: ZoneCopy;
}

/**
 * Route skeleton for a workspace stage. It renders the real frame and zones with honest empty
 * states and declares the subject from the URL. A stage builder replaces the page's use of this
 * component with the live stage and keeps the same structure: useWorkspaceSubject, then WorkspaceZones.
 */
export function StagePlaceholder({
  stage,
  subject,
  ledger,
  instrument,
  inspector,
}: StagePlaceholderProps) {
  useWorkspaceSubject(subject);

  return (
    <WorkspaceZones
      layoutId={stage}
      ledger={
        ledger ? (
          <Zone
            zone="ledger"
            title={ledger.title}
            footer={<KeyHint keys="l" label="Hide ledger" />}
          >
            <EmptyState title={ledger.empty} description={ledger.holds} />
          </Zone>
        ) : undefined
      }
      instrument={
        <Zone zone="instrument" title={instrument.title}>
          <EmptyState
            title={instrument.empty}
            description={`${instrument.holds} This stage is not connected to the data service in this build.`}
            actions={
              <>
                <div className="w-64">
                  <SearchTrigger />
                </div>
                <ButtonLink href="/explore">Open Explore</ButtonLink>
              </>
            }
          />
        </Zone>
      }
      inspector={
        inspector ? (
          <Zone
            zone="inspector"
            title={inspector.title}
            footer={<KeyHint keys="i" label="Hide inspector" />}
          >
            <EmptyState title={inspector.empty} description={inspector.holds} />
          </Zone>
        ) : undefined
      }
    />
  );
}
