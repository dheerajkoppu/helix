import { cn } from "cn";

export interface SwatchProps {
  /** Tailwind background utility from a scientific scale, e.g. "bg-plddt-high" */
  swatchClass?: string;
  /** raw colour for interpolated scales */
  color?: string;
  /** letter or code printed inside so the band reads without colour */
  code?: string;
  /** ink for the code: white on dark fills, ink on pale ones */
  onFill?: "white" | "ink";
  /** hatched swatches mark "likely" classes and computed values */
  hatched?: boolean;
  className?: string;
}

/**
 * A colour sample from a scientific scale. Always ringed, because several canonical colours
 * fall under 3:1 against the surface. Square, never round.
 */
export function Swatch({
  swatchClass,
  color,
  code,
  onFill = "ink",
  hatched = false,
  className,
}: SwatchProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-3 shrink-0 items-center justify-center overflow-hidden rounded-[1px] ring-1 ring-border-strong/60 ring-inset",
        code && "size-3.5",
        swatchClass,
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {hatched ? (
        <span className="absolute inset-0 hatch text-background opacity-70" />
      ) : null}
      {code ? (
        <span
          className={cn(
            "relative font-mono text-[0.5625rem] leading-none font-semibold",
            onFill === "white" ? "text-white" : "text-[#15171a]",
          )}
        >
          {code}
        </span>
      ) : null}
    </span>
  );
}
