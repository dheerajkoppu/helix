"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { toast } from "sonner";

export interface MonoIdProps {
  /** the identifier exactly as the source writes it */
  value: string;
  /** shows a copy control on hover and focus; default true */
  copyable?: boolean;
  /** optional display override, e.g. a shortened form. The full value is always what is copied. */
  children?: React.ReactNode;
  className?: string;
}

/** Monospace identifier: accessions, HGVS, residue IDs, job IDs. Never truncated without a copy action. */
export function MonoId({
  value,
  copyable = true,
  children,
  className,
}: MonoIdProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast(`Copied ${value}`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }

  const text = (
    <span
      className={cn(
        "font-mono text-xs tracking-[-0.01em] text-foreground",
        !copyable && className,
      )}
      translate="no"
    >
      {children ?? value}
    </span>
  );
  if (!copyable) return text;

  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <span
      className={cn(
        "group/mono-id inline-flex max-w-full items-center gap-1 align-baseline",
        className,
      )}
    >
      {text}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${value}`}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-subtle-foreground opacity-0 transition-opacity duration-(--dur-fast) group-hover/mono-id:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <Icon className="size-3" aria-hidden />
      </button>
    </span>
  );
}
