import { cn } from "cn";

import {
  AlphaMissenseLegend,
  PlddtLegend,
  ReferenceVariantLegend,
} from "@/components/science/legends";
import { Swatch } from "@/components/science/swatch";

import type { ViewerLegendSpec } from "./colorings";
import { colorToHex } from "./palette";

export interface ViewerLegendEntry {
  spec: ViewerLegendSpec;
  /** shared legend component that already draws this scale */
  kind?: "plddt" | "alphamissense" | "reference-variant";
}

function SpecLegend({
  spec,
  compact,
}: {
  spec: ViewerLegendSpec;
  compact: boolean;
}) {
  return (
    <figure
      className={cn(
        "flex items-center gap-x-3 text-2xs text-muted-foreground",
        compact ? "flex-wrap gap-y-1" : "flex-nowrap whitespace-nowrap",
      )}
    >
      <figcaption className="font-medium text-foreground">
        {spec.title}
        {spec.note && !compact ? (
          <span className="ml-1 font-normal text-subtle-foreground">
            {spec.note}
          </span>
        ) : null}
      </figcaption>
      <ul
        className={cn(
          "flex items-center gap-x-3",
          compact ? "flex-wrap gap-y-1" : "flex-nowrap",
        )}
      >
        {spec.items.map((item) => (
          <li
            key={item.label}
            className="flex items-center gap-1.5 whitespace-nowrap"
          >
            <Swatch color={colorToHex(item.color)} code={item.code} />
            <span className="text-foreground">{item.label}</span>
            {item.detail ? (
              <span className="tabular font-mono text-subtle-foreground">
                {item.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Legend for whatever the 3D scene is coloured by. One entry per colour mode in use. `compact`
 * lets it wrap inside the stage and drops the source note.
 */
export function ViewerLegend({
  entries,
  compact = false,
}: {
  entries: ViewerLegendEntry[];
  compact?: boolean;
}) {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === "plddt" ? (
          <PlddtLegend
            key={entry.spec.title}
            showRanges={false}
            wrap={compact}
          />
        ) : entry.kind === "alphamissense" ? (
          <AlphaMissenseLegend
            key={entry.spec.title}
            showRanges={false}
            wrap={compact}
          />
        ) : entry.kind === "reference-variant" ? (
          <ReferenceVariantLegend key={entry.spec.title} wrap={compact} />
        ) : (
          <SpecLegend
            key={entry.spec.title}
            spec={entry.spec}
            compact={compact}
          />
        ),
      )}
    </>
  );
}
