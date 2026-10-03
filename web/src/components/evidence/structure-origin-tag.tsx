"use client";

import { cn } from "cn";

import { BORDER_STYLE } from "@/components/evidence/evidence-badge";
import { StructureOriginGlyph } from "@/components/evidence/glyphs";
import { plainOrigin, plainOriginCaveat } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  STRUCTURE_ORIGIN_META,
  type StructureOrigin,
} from "@/lib/structure-origin";

export interface StructureOriginTagProps extends Omit<
  React.ComponentProps<"span">,
  "children"
> {
  origin: StructureOrigin;
  /** compact: glyph and code for ledger rows. standard: framed tag. */
  size?: "compact" | "standard";
  /** what the structure is: "1BF5 X-ray 2.9 Å", "AlphaFold DB v6", "job 41 Boltz-2" */
  detail?: React.ReactNode;
  /** append the fixed caption: "predicted, not experimental" */
  caption?: boolean;
  /** simple mode only: the words printed in place of "Predicted", e.g. "Predicted structure · AlphaFold DB" */
  plainLabel?: string;
}

/**
 * EXP, PRD or OF. Shown on every structure, in every list row, and as the non-removable corner tag
 * of the 3D viewport. The three classes are never presented as equivalent.
 */
export function StructureOriginTag({
  origin,
  size = "standard",
  detail,
  caption = false,
  plainLabel,
  className,
  ...props
}: StructureOriginTagProps) {
  const advanced = useAdvancedMode();
  const meta = STRUCTURE_ORIGIN_META[origin];
  if (!advanced) {
    return (
      <span
        data-slot="structure-origin-tag"
        data-origin={origin}
        title={
          typeof detail === "string"
            ? `${detail} · ${plainOriginCaveat(origin)}`
            : plainOriginCaveat(origin)
        }
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 align-middle text-2xs whitespace-nowrap",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1",
            size === "standard" && [
              "h-[18px] rounded-xs border px-1",
              BORDER_STYLE[meta.border],
              meta.borderClass,
            ],
          )}
        >
          <StructureOriginGlyph origin={origin} className={meta.textClass} />
          <span className="truncate leading-none text-foreground">
            {plainLabel ?? plainOrigin(origin)}
          </span>
        </span>
        {caption ? (
          <span className="text-muted-foreground">
            {plainOriginCaveat(origin)}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      data-slot="structure-origin-tag"
      data-origin={origin}
      className={cn(
        "inline-flex items-center gap-1.5 align-middle text-2xs whitespace-nowrap",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1",
          meta.textClass,
          size === "standard" && [
            "h-[18px] rounded-xs border px-1",
            BORDER_STYLE[meta.border],
            meta.borderClass,
          ],
        )}
      >
        <StructureOriginGlyph origin={origin} />
        <span className="font-mono text-[0.625rem] leading-none font-semibold tracking-[0.06em]">
          {meta.tag}
        </span>
      </span>
      <span className="sr-only">{meta.label}</span>
      {detail ? (
        <span className="font-mono text-foreground">{detail}</span>
      ) : null}
      {caption ? (
        <span className="text-muted-foreground">{meta.caption}</span>
      ) : null}
    </span>
  );
}
