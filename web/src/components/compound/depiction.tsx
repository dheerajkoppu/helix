"use client";

import { useTheme } from "next-themes";
import { cn } from "cn";

import { useHydrated } from "@/hooks/use-hydrated";
import { apiFileUrl } from "@/lib/workspace-data";

export interface CompoundDepictionProps {
  /** `depiction_url` of the compound record; null when the API holds no structure for it */
  depictionUrl: string | null | undefined;
  name: string;
  /** why there is no drawing, e.g. the modality */
  absentLabel?: string;
  className?: string;
}

/**
 * 2D structure drawn by the API (RDKit) in the page theme. A compound without a stored structure
 * gets a labelled blank, never a stand-in drawing.
 */
export function CompoundDepiction({
  depictionUrl,
  name,
  absentLabel = "No 2D structure",
  className,
}: CompoundDepictionProps) {
  const { resolvedTheme } = useTheme();
  const hydrated = useHydrated();
  const url = apiFileUrl(depictionUrl);

  if (!url || !hydrated) {
    return (
      <span
        className={cn(
          "flex items-center justify-center border border-dashed border-border text-center text-2xs leading-tight text-subtle-foreground",
          className,
        )}
      >
        {url ? null : absentLabel}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${url}?theme=${resolvedTheme === "dark" ? "dark" : "light"}`}
      alt={`2D structure of ${name}`}
      loading="lazy"
      decoding="async"
      className={cn("object-contain", className)}
    />
  );
}
