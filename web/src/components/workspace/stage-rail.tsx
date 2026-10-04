"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CHOOSE_STEP_LABEL,
  STEPS_LABEL,
  plainStage,
  plainStageGroup,
  plainStageGroupNeeds,
} from "@/lib/plain-language";
import { withSelection } from "@/lib/state/selection-url";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  STAGES,
  STAGE_GROUPS,
  groupOfStage,
  resolveGroup,
  resolveStage,
  stageFromPathname,
  useWorkspaceSubjectStore,
  type StageId,
} from "@/lib/state/subject";

/** Stage links carry the current selection so context survives the move. */
function useStageTargets() {
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const selection = useWorkspaceSelection();
  return STAGES.map((stage) => {
    const target = resolveStage(stage.id, chain);
    return {
      stage,
      target,
      href: target.href ? withSelection(target.href, selection) : null,
    };
  });
}

/** The same links, grouped into the three questions simple mode asks. */
function useGroupTargets(active: StageId | null) {
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const selection = useWorkspaceSelection();
  return STAGE_GROUPS.map((group) => {
    const target = resolveGroup(group, chain, active);
    return {
      group,
      href: target.href ? withSelection(target.href, selection) : null,
    };
  });
}

export interface StageRailProps {
  /** overrides the stage derived from the pathname */
  current?: StageId | null;
  /** three grouped questions instead of seven stages */
  simple?: boolean;
  className?: string;
}

/**
 * The stages as positions on an axis. Advanced mode shows all seven with the entity that fills each;
 * simple mode groups them into three questions and names the page you are on underneath. A stage or
 * group that cannot open yet says what it needs. On phones the rail collapses to a stepper.
 */
export function StageRail({
  current,
  simple = false,
  className,
}: StageRailProps) {
  const pathname = usePathname();
  const active = current === undefined ? stageFromPathname(pathname) : current;
  const targets = useStageTargets();
  const groups = useGroupTargets(active);
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeEntry = targets.find((entry) => entry.stage.id === active);
  const activeGroup = groupOfStage(active);
  const activeGroupEntry = groups.find(
    (entry) => entry.group.id === activeGroup,
  );

  const frame = cn(
    "shrink-0 border-b border-border-strong/70 bg-background",
    className,
  );

  if (simple)
    return (
      <nav aria-label="Research steps" className={frame}>
        <ol className="hidden min-h-12 auto-cols-fr grid-flow-col lg:grid">
          {groups.map(({ group, href }) => {
            const isActive = group.id === activeGroup;
            const body = (
              <>
                <span
                  className={cn(
                    "tabular font-mono text-2xs",
                    isActive ? "text-foreground" : "text-subtle-foreground",
                  )}
                >
                  {group.number}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("truncate", isActive && "font-medium")}>
                    {plainStageGroup(group.id)}
                  </span>
                  {isActive && active ? (
                    // the caption wraps rather than clipping; the cell grows with it
                    <span className="text-2xs leading-[1.35] text-muted-foreground">
                      {plainStage(active)}
                    </span>
                  ) : null}
                </span>
              </>
            );
            const cell = cn(
              "relative flex h-full min-h-12 min-w-0 items-center gap-2 px-3 py-1.5 text-sm outline-offset-[-2px]",
              // tick on the axis at the start of every step
              "before:absolute before:bottom-0 before:left-0 before:h-1.5 before:w-px before:bg-border-strong",
              isActive &&
                "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
            );
            return (
              <li key={group.id} className="min-w-0">
                {href ? (
                  <Link
                    href={href}
                    aria-current={isActive ? "step" : undefined}
                    className={cn(
                      cell,
                      !isActive &&
                        "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          aria-disabled="true"
                          className={cn(
                            cell,
                            "cursor-default text-disabled-foreground",
                          )}
                        />
                      }
                    >
                      {body}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {plainStageGroupNeeds(group.id)}
                    </TooltipContent>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ol>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm lg:hidden">
            <span className="tabular shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
              {activeGroupEntry
                ? `${activeGroupEntry.group.number} of ${STAGE_GROUPS.length}`
                : ""}
            </span>
            <span className="shrink-0 font-medium whitespace-nowrap">
              {activeGroupEntry
                ? plainStageGroup(activeGroupEntry.group.id)
                : CHOOSE_STEP_LABEL}
            </span>
            {activeGroupEntry && active ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {plainStage(active)}
              </span>
            ) : null}
            <ChevronDownIcon
              className="ml-auto size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="gap-0 rounded-t-2xl p-0"
          >
            <SheetHeader className="border-b border-border-subtle px-4 py-3">
              <SheetTitle>{STEPS_LABEL}</SheetTitle>
              <SheetDescription className="sr-only">
                Move between the three steps. The current disease, gene,
                mutation and protein stay in context.
              </SheetDescription>
            </SheetHeader>
            <ol className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {groups.map(({ group, href }) => {
                const isActive = group.id === activeGroup;
                const row =
                  "flex min-h-12 items-center gap-3 border-b border-border-subtle px-4 py-2 text-sm last:border-b-0";
                const body = (
                  <>
                    <span className="tabular w-3 font-mono text-xs text-muted-foreground">
                      {group.number}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className={cn(isActive && "font-medium")}>
                        {plainStageGroup(group.id)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {isActive && active
                          ? plainStage(active)
                          : href
                            ? ""
                            : plainStageGroupNeeds(group.id)}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={group.id}>
                    {href ? (
                      <Link
                        href={href}
                        onClick={() => setSheetOpen(false)}
                        aria-current={isActive ? "step" : undefined}
                        className={cn(
                          row,
                          isActive &&
                            "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
                        )}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        className={cn(row, "text-disabled-foreground")}
                      >
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </SheetContent>
        </Sheet>
      </nav>
    );

  return (
    <nav aria-label="Research stages" className={frame}>
      <ol className="hidden h-9 auto-cols-fr grid-flow-col lg:grid">
        {targets.map(({ stage, target, href }) => {
          const isActive = stage.id === active;
          const body = (
            <>
              <span
                className={cn(
                  "tabular font-mono text-2xs",
                  isActive ? "text-foreground" : "text-subtle-foreground",
                )}
              >
                {stage.number}
              </span>
              <span className={cn("shrink-0", isActive && "font-medium")}>
                {stage.label}
              </span>
              {target.subject ? (
                <span
                  className="min-w-0 truncate font-mono text-2xs text-muted-foreground"
                  translate="no"
                >
                  {target.subject.label}
                </span>
              ) : null}
            </>
          );
          const cell = cn(
            "relative flex h-full min-w-0 items-center gap-2 px-3 text-xs outline-offset-[-2px]",
            // tick on the axis at the start of every stage
            "before:absolute before:bottom-0 before:left-0 before:h-1.5 before:w-px before:bg-border-strong",
            isActive &&
              "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
          );
          return (
            <li key={stage.id} className="min-w-0">
              {href ? (
                <Link
                  href={href}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    cell,
                    !isActive &&
                      "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {body}
                </Link>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        aria-disabled="true"
                        className={cn(
                          cell,
                          "cursor-default text-disabled-foreground",
                        )}
                      />
                    }
                  >
                    {body}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {target.missing}
                  </TooltipContent>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ol>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm lg:hidden">
          <span className="tabular font-mono text-xs text-muted-foreground">
            {activeEntry
              ? `${activeEntry.stage.number}/${STAGES.length}`
              : `0/${STAGES.length}`}
          </span>
          <span className="font-medium">
            {activeEntry ? activeEntry.stage.label : "Choose a stage"}
          </span>
          {activeEntry?.target.subject ? (
            <span
              className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              translate="no"
            >
              {activeEntry.target.subject.label}
            </span>
          ) : null}
          <ChevronDownIcon
            className="ml-auto size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b border-border-subtle px-4 py-3">
            <SheetTitle>Research stages</SheetTitle>
            <SheetDescription className="sr-only">
              Move between stages. The current disease, gene, variant and
              protein stay in context.
            </SheetDescription>
          </SheetHeader>
          <ol className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {targets.map(({ stage, target, href }) => {
              const isActive = stage.id === active;
              const row =
                "flex min-h-12 items-center gap-3 border-b border-border-subtle px-4 py-2 text-sm last:border-b-0";
              const body = (
                <>
                  <span className="tabular w-3 font-mono text-xs text-muted-foreground">
                    {stage.number}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn(isActive && "font-medium")}>
                      {stage.label}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {target.subject?.label ?? target.missing}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={stage.id}>
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => setSheetOpen(false)}
                      aria-current={isActive ? "step" : undefined}
                      className={cn(
                        row,
                        isActive &&
                          "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      className={cn(row, "text-disabled-foreground")}
                    >
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

/** Printed in zone footers and the shortcut sheet so the rail teaches its own keys. */
export function StageKeyHints({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <KeyHint keys="[" label="Previous stage" />
      <KeyHint keys="]" label="Next stage" />
    </span>
  );
}
