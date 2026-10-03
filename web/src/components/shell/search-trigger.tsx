"use client";

import { SearchIcon } from "lucide-react";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import { useShell } from "@/lib/state/shell";

export const SEARCH_PLACEHOLDER = "Search a disease, gene, protein, or variant";

export interface SearchTriggerProps {
  /** "bar": 28px control in the top bar. "hero": the home page's one action. "icon": phones. */
  variant?: "bar" | "hero" | "icon";
  className?: string;
}

/** Opens the command palette. Always visible, always shows its shortcut. */
export function SearchTrigger({
  variant = "bar",
  className,
}: SearchTriggerProps) {
  const setPaletteOpen = useShell((state) => state.setPaletteOpen);

  if (variant === "icon") {
    return (
      <button
        type="button"
        aria-label="Search"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        <SearchIcon className="size-4" aria-hidden />
      </button>
    );
  }

  const hero = variant === "hero";
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "group/search flex w-full cursor-text items-center border border-input bg-background text-left text-subtle-foreground hover:border-foreground",
        hero
          ? "h-12 gap-3 rounded-lg px-4 text-base"
          : "h-7 gap-2 rounded-md px-2 text-xs",
        className,
      )}
    >
      <SearchIcon
        className={cn(
          "shrink-0 text-muted-foreground",
          hero ? "size-4.5" : "size-3.5",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{SEARCH_PLACEHOLDER}</span>
      <KeyHint keys="mod+k" className="shrink-0" />
    </button>
  );
}
