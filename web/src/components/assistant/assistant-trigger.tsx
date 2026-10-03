"use client";

import { cn } from "cn";
import { MessageSquareIcon } from "lucide-react";

import { useAssistant } from "@/lib/state/assistant";

/** Opens and closes the assistant dock. Same toggle form as Learn and Advanced in the top bar. */
export function AssistantTrigger({ className }: { className?: string }) {
  const open = useAssistant((state) => state.open);
  const toggle = useAssistant((state) => state.toggle);
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label="Ask Orpha, the research assistant"
      onClick={toggle}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs hover:bg-accent",
        open
          ? "bg-active font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <MessageSquareIcon className="size-3.5" aria-hidden />
      <span className="max-sm:sr-only">Ask Orpha</span>
    </button>
  );
}
