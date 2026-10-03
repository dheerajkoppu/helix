import { cn } from "cn";

import { EvidenceGlyph } from "@/components/evidence/glyphs";
import {
  EVIDENCE_META,
  type EvidenceBorder,
  type EvidenceClass,
} from "@/lib/evidence";

export const BORDER_STYLE: Record<EvidenceBorder, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
};

export interface EvidenceBadgeProps extends Omit<
  React.ComponentProps<"span">,
  "children"
> {
  evidenceClass: EvidenceClass;
  /**
   * compact: glyph and code, no frame, for table cells and tooltip lines.
   * standard: framed chip, for inspector rows and anywhere a claim is made.
   */
  size?: "compact" | "standard";
  /** short source reference printed after the code, e.g. "PubMed:21727188", "AFDB v6" */
  detail?: React.ReactNode;
}

/**
 * The evidence class of a statement. Four redundant channels: text code, glyph shape, border style
 * and glyph fill. Hue is a fifth and never the only one. Pure display; wrap it in EvidencePopover
 * to make the source inspectable.
 */
export function EvidenceBadge({
  evidenceClass,
  size = "standard",
  detail,
  className,
  ...props
}: EvidenceBadgeProps) {
  const meta = EVIDENCE_META[evidenceClass];
  return (
    <span
      data-slot="evidence-badge"
      data-evidence={evidenceClass}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 align-middle whitespace-nowrap",
        size === "standard" && [
          "h-[18px] rounded-xs border px-1",
          BORDER_STYLE[meta.border],
          meta.borderClass,
        ],
        className,
      )}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-1", meta.textClass)}>
        <EvidenceGlyph evidenceClass={evidenceClass} />
        <span className="font-mono text-[0.625rem] leading-none font-semibold tracking-[0.06em]">
          {meta.code}
        </span>
      </span>
      <span className="sr-only">{meta.label}</span>
      {detail ? (
        <span className="font-mono text-2xs leading-none text-foreground">
          {detail}
        </span>
      ) : null}
    </span>
  );
}

/** The four-label reading used by comparison and mechanism views. */
export function ClaimLabel({
  evidenceClass,
  className,
}: {
  evidenceClass: EvidenceClass;
  className?: string;
}) {
  const meta = EVIDENCE_META[evidenceClass];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <EvidenceGlyph evidenceClass={evidenceClass} className={meta.textClass} />
      {meta.claim}
    </span>
  );
}
