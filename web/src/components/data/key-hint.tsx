"use client";

import { cn } from "cn";

import { Kbd } from "@/components/ui/kbd";
import { useIsMac } from "@/hooks/use-media-query";

const NAMED_KEYS: Record<string, string> = {
  shift: "⇧",
  enter: "↵",
  esc: "Esc",
  escape: "Esc",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "Tab",
  backspace: "⌫",
};

function keyLabel(key: string, isMac: boolean): string {
  const lower = key.toLowerCase();
  if (lower === "mod") return isMac ? "⌘" : "Ctrl";
  if (lower === "alt") return isMac ? "⌥" : "Alt";
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  return key.length === 1 ? key.toUpperCase() : key;
}

export interface KeyHintProps {
  /** "mod+k" for a chord, "g p" for a sequence, "?" for a single key */
  keys: string;
  /** what the keys do, printed after them */
  label?: React.ReactNode;
  className?: string;
}

/** On-screen shortcut hint. Every shortcut in the product is printed somewhere with this. */
export function KeyHint({ keys, label, className }: KeyHintProps) {
  const isMac = useIsMac();
  const presses = keys.split(" ").filter(Boolean);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {presses.map((press, pressIndex) => (
          <span
            key={`${press}-${pressIndex}`}
            className="inline-flex items-center gap-0.5"
          >
            {press.split("+").map((key) => (
              <Kbd key={key} className="h-4 min-w-4 px-1">
                {keyLabel(key, isMac)}
              </Kbd>
            ))}
          </span>
        ))}
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}
