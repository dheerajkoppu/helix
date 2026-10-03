"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";

import { CLINICAL_SIGNIFICANCE } from "@/lib/science/clinical-significance";
import { plddtBand } from "@/lib/science/plddt";
import { isResidueSelected } from "@/lib/state/selection";

import type {
  SequenceAxisDockProps,
  SequenceFeature,
  SequenceTrack,
  SequenceVariant,
} from "./types";

/** pixels per residue; letters need at least 8 */
const CELL = 12;
const GUTTER = 84;
const OVERSCAN = 8;

const ROW = "relative flex h-[18px] items-stretch";
const ROW_LABEL =
  "sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-sunken px-2 font-mono text-[0.625rem] text-muted-foreground";

function featureClass(track: SequenceTrack, feature: SequenceFeature): string {
  if (track.kind === "coverage") {
    if (feature.origin === "experimental") return "bg-origin-experimental";
    if (feature.origin === "predicted_orphafold") {
      return "border border-dotted border-origin-predicted-orphafold text-origin-predicted-orphafold";
    }
    return "hatch border border-dashed border-origin-predicted-external/70 text-origin-predicted-external";
  }
  return "border border-border-strong bg-muted";
}

function VariantGlyph({
  variant,
  selected,
}: {
  variant: SequenceVariant;
  selected: boolean;
}) {
  const fill = variant.significance
    ? CLINICAL_SIGNIFICANCE[variant.significance].hex
    : "transparent";
  const stroke = selected ? "var(--foreground)" : "var(--border-strong)";
  const common = { fill, stroke, strokeWidth: selected ? 1.6 : 0.8 };
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
      {variant.consequence === "loss_of_function" ? (
        <path
          d="M2 2 8 8M8 2 2 8"
          stroke={selected ? "var(--foreground)" : fill}
          strokeWidth="2"
        />
      ) : variant.consequence === "missense" ||
        variant.consequence === "inframe" ? (
        <path d="M5 1.5 9 8.5H1z" {...common} />
      ) : variant.consequence === "splice" ? (
        <path d="M5 1 9 5 5 9 1 5z" {...common} />
      ) : (
        <circle cx="5" cy="5" r="3.5" {...common} />
      )}
    </svg>
  );
}

/**
 * Lightweight sequence axis: ruler, residue letters, feature tracks, confidence cells and variant
 * markers on one shared axis, with click selection and hover. It scrolls horizontally at a fixed
 * 12px per residue. The sequence specialist replaces this with the zoomable in-house axis and keeps
 * the exported name and props.
 */
export function SequenceAxisDock({
  accession,
  sequence,
  tracks,
  variants,
  selection,
  selectedVariantId,
  hoverPosition,
  window: axisWindow,
  onSelect,
  onSelectVariant,
  onHover,
  onWindowChange,
  className,
}: SequenceAxisDockProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const userScrolled = useRef(false);
  const [viewport, setViewport] = useState({ left: 0, width: 1200 });
  const length = sequence.length;

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element)
      setViewport({ left: element.scrollLeft, width: element.clientWidth });
  }, []);

  useLayoutEffect(() => {
    measure();
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const first = Math.max(1, Math.floor(viewport.left / CELL) + 1 - OVERSCAN);
  const last = Math.min(
    length,
    Math.ceil((viewport.left + viewport.width - GUTTER) / CELL) + OVERSCAN,
  );
  const positions = useMemo(() => {
    const visible: number[] = [];
    for (let position = first; position <= last; position += 1)
      visible.push(position);
    return visible;
  }, [first, last]);

  const scrollToResidue = useCallback(
    (position: number, align: "start" | "center") => {
      const element = scrollRef.current;
      if (!element) return;
      const x = (position - 1) * CELL;
      const left =
        align === "start" ? x : x - (element.clientWidth - GUTTER) / 2;
      element.scrollTo({ left: Math.max(0, left) });
    },
    [],
  );

  // Follow a selection made elsewhere (3D viewport, table) when it is off screen.
  const selectionStart = selection[0]?.start;
  useEffect(() => {
    if (selectionStart === undefined) return;
    const element = scrollRef.current;
    if (!element) return;
    const x = (selectionStart - 1) * CELL;
    if (
      x < element.scrollLeft ||
      x > element.scrollLeft + element.clientWidth - GUTTER - CELL
    ) {
      scrollToResidue(selectionStart, "center");
    }
  }, [selectionStart, scrollToResidue]);

  const windowStart = axisWindow?.start;
  useEffect(() => {
    if (windowStart !== undefined && !userScrolled.current)
      scrollToResidue(windowStart, "start");
  }, [windowStart, scrollToResidue]);

  useEffect(() => {
    if (!onWindowChange || !userScrolled.current) return;
    const timer = window.setTimeout(() => {
      const start = Math.floor(viewport.left / CELL) + 1;
      const end = Math.min(
        length,
        start + Math.floor((viewport.width - GUTTER) / CELL) - 1,
      );
      onWindowChange(start <= 1 ? null : { start, end });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [viewport, length, onWindowChange]);

  function positionAt(
    event: React.PointerEvent | React.MouseEvent,
  ): number | null {
    const element = scrollRef.current;
    if (!element) return null;
    const x =
      event.clientX -
      element.getBoundingClientRect().left +
      element.scrollLeft -
      GUTTER;
    if (x < 0) return null;
    const position = Math.floor(x / CELL) + 1;
    return position >= 1 && position <= length ? position : null;
  }

  function onClick(event: React.MouseEvent) {
    const position = positionAt(event);
    if (position === null) return;
    const additive = event.metaKey || event.ctrlKey;
    if (event.shiftKey && anchorRef.current !== null) {
      onSelect(
        [
          {
            start: Math.min(anchorRef.current, position),
            end: Math.max(anchorRef.current, position),
          },
        ],
        {
          additive,
        },
      );
      return;
    }
    anchorRef.current = position;
    onSelect([{ start: position, end: position }], { additive });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = selection[0]?.start ?? first;
    const next = Math.min(
      length,
      Math.max(1, current + (event.key === "ArrowRight" ? 1 : -1)),
    );
    anchorRef.current = next;
    onSelect([{ start: next, end: next }], { additive: false });
    event.preventDefault();
  }

  const x = (position: number) => (position - 1) * CELL;
  const inView = (start: number, end: number) => end >= first && start <= last;
  const clinical = variants.filter((variant) => variant.group === "clinical");
  const population = variants.filter(
    (variant) => variant.group === "population",
  );

  const variantRow = (label: string, rows: SequenceVariant[]) => (
    <div className={ROW}>
      <div className={ROW_LABEL} style={{ width: GUTTER }}>
        {label}
      </div>
      <div className="relative" style={{ width: length * CELL }}>
        {rows
          .filter((variant) => inView(variant.position, variant.position))
          .map((variant) => (
            <button
              key={variant.id}
              type="button"
              title={`${variant.label}${variant.significance ? `, ${CLINICAL_SIGNIFICANCE[variant.significance].label}` : ""}`}
              aria-label={`Select variant ${variant.label}`}
              aria-pressed={variant.id === selectedVariantId}
              onClick={(event) => {
                event.stopPropagation();
                onSelectVariant?.(variant);
              }}
              className="absolute top-0 flex h-full cursor-pointer items-center justify-center"
              style={{ left: x(variant.position), width: CELL }}
            >
              <VariantGlyph
                variant={variant}
                selected={variant.id === selectedVariantId}
              />
            </button>
          ))}
      </div>
    </div>
  );

  return (
    <div
      ref={scrollRef}
      data-slot="sequence-axis-dock"
      role="group"
      aria-label={`Sequence axis for ${accession}, ${length} residues, UniProt canonical numbering`}
      tabIndex={0}
      onScroll={measure}
      onWheel={() => (userScrolled.current = true)}
      onPointerDown={() => (userScrolled.current = true)}
      onPointerMove={(event) => onHover(positionAt(event))}
      onPointerLeave={() => onHover(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "scroll-thin relative size-full overflow-auto bg-background outline-none select-none",
        className,
      )}
    >
      <div
        className="relative min-h-full"
        style={{ width: GUTTER + length * CELL }}
      >
        <div
          className={cn(
            ROW,
            "sticky top-0 z-30 h-5 border-b border-border-subtle bg-background",
          )}
        >
          <div className={cn(ROW_LABEL, "z-40")} style={{ width: GUTTER }}>
            pos
          </div>
          <div className="relative" style={{ width: length * CELL }}>
            {positions
              .filter((position) => position % 10 === 0)
              .map((position) => (
                <span
                  key={position}
                  className="tabular absolute top-0 flex h-full -translate-x-1/2 flex-col items-center font-mono text-[0.625rem] leading-3 text-subtle-foreground"
                  style={{ left: x(position) + CELL / 2 }}
                >
                  {position}
                  <span className="h-1 w-px bg-border-strong" />
                </span>
              ))}
          </div>
        </div>

        <div className={ROW}>
          <div className={ROW_LABEL} style={{ width: GUTTER }}>
            seq
          </div>
          <div
            className="relative font-mono text-2xs"
            style={{ width: length * CELL }}
            translate="no"
          >
            {positions.map((position) => (
              <span
                key={position}
                className={cn(
                  "absolute top-0 flex h-full items-center justify-center text-foreground",
                  isResidueSelected(selection, position) &&
                    "font-semibold underline",
                )}
                style={{ left: x(position), width: CELL }}
              >
                {sequence[position - 1]}
              </span>
            ))}
          </div>
        </div>

        {tracks.map((track) => (
          <div key={track.id} className={ROW}>
            <div
              className={ROW_LABEL}
              style={{ width: GUTTER }}
              title={track.source ?? undefined}
            >
              <span className="truncate">{track.label}</span>
            </div>
            <div className="relative" style={{ width: length * CELL }}>
              {track.status && track.status.state !== "ok" ? (
                <span className="sticky left-[92px] flex h-full w-fit items-center text-[0.625rem] text-subtle-foreground">
                  {track.status.state === "empty"
                    ? `No ${track.label.toLowerCase()} from ${track.status.name ?? track.status.source}`
                    : `${track.status.name ?? track.status.source} unavailable`}
                </span>
              ) : null}
              {track.kind === "confidence" && track.values
                ? positions.map((position) => {
                    const value = track.values?.[position - 1];
                    if (value === null || value === undefined) return null;
                    const band = plddtBand(value);
                    return (
                      <span
                        key={position}
                        title={`pLDDT ${value.toFixed(1)} at ${position}`}
                        className={cn(
                          "absolute inset-y-[3px] flex items-center justify-center font-mono text-[0.5625rem] font-medium",
                          band.swatchClass,
                          band.onFill === "white"
                            ? "text-white"
                            : "text-[#15171a]",
                        )}
                        style={{ left: x(position) + 0.5, width: CELL - 1 }}
                      >
                        {band.code}
                      </span>
                    );
                  })
                : null}
              {track.features
                ?.filter((feature) => inView(feature.start, feature.end))
                .map((feature) => (
                  <span
                    key={feature.id}
                    title={[
                      feature.label,
                      `${feature.start}-${feature.end}`,
                      feature.description,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className={cn(
                      "absolute inset-y-[3px] overflow-hidden rounded-[1px] px-1 text-[0.625rem] leading-3 whitespace-nowrap text-foreground",
                      featureClass(track, feature),
                    )}
                    style={{
                      left: x(feature.start),
                      width: (feature.end - feature.start + 1) * CELL,
                    }}
                  >
                    {track.kind === "coverage" ? null : (
                      <span className="sticky left-[92px]">
                        {feature.label}
                      </span>
                    )}
                  </span>
                ))}
            </div>
          </div>
        ))}

        {clinical.length > 0 ? variantRow("clin", clinical) : null}
        {population.length > 0 ? variantRow("pop", population) : null}

        {selection.map((range) => (
          <span
            key={`${range.start}-${range.end}`}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 border-x border-foreground/60 bg-foreground/10"
            style={{
              left: GUTTER + x(range.start),
              width: (range.end - range.start + 1) * CELL,
            }}
          />
        ))}
        {hoverPosition && hoverPosition >= 1 && hoverPosition <= length ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/70"
            style={{ left: GUTTER + x(hoverPosition) + CELL / 2 }}
          />
        ) : null}
      </div>
    </div>
  );
}
