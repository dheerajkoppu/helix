import Link from "next/link";
import { cn } from "cn";

import { HelixMark } from "@/components/evidence/glyphs";
import { site } from "@/lib/site";

export function Wordmark({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "lg";
}) {
  return (
    <Link
      href="/"
      aria-label={`${site.name} home`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-xs text-foreground",
        size === "lg" ? "gap-3" : "gap-2",
        className,
      )}
    >
      <HelixMark className={size === "lg" ? "size-9" : "size-4"} />
      <span
        className={cn(
          "font-semibold",
          size === "lg"
            ? "text-4xl tracking-[-0.035em]"
            : "text-[0.9375rem] leading-none tracking-[-0.02em]",
        )}
      >
        Helix
      </span>
    </Link>
  );
}
