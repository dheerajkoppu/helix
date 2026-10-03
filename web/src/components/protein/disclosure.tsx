"use client";

import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface DisclosureProps {
  /** one to three words: "Details", "All providers" */
  label: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Closed by default. Holds the detail a first reading does not need. */
export function Disclosure({
  label,
  defaultOpen = false,
  className,
  children,
}: DisclosureProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn("border-t border-border-subtle", className)}
    >
      <CollapsibleTrigger className="group flex h-9 w-full cursor-pointer items-center gap-1.5 px-3 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
        <ChevronRightIcon
          aria-hidden
          className="size-3 group-data-[panel-open]:rotate-90"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
