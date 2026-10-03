"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";

import { Swatch } from "@/components/science/swatch";
import { toThreeLetter } from "@/lib/ids";
import {
  CLINICAL_SIGNIFICANCE,
  type ClinicalSignificanceGroup,
} from "@/lib/science/clinical-significance";

import {
  groupByPosition,
  readPalette,
  significanceGroup,
  type Palette,
  type PositionGroup,
} from "./draw";
import { GROUP_SHORT } from "./legend";
import type {
  SequenceAxisDockProps,
  SequenceFeature,
  SequenceVariant,
} from "./types";

export interface SequenceStripProps extends Pick<
  SequenceAxisDockProps,
  | "accession"
  | "sequence"
  | "tracks"
  | "variants"
  | "selection"
  | "selectedVariantId"
  | "hoverPosition"
  | "onSelect"
  | "onSelectVariant"
  | "onHover"
  | "className"
> {
  /** shows the Expand control at the right end */
  onExpand?: () => void;
}

const HEIGHT = 48;
const MARK_TOP = 3;
const MARK_BOTTOM = 14;
const BAND_TOP = 17;
const BAND_BOTTOM = 31;
const AXIS_Y = 34;
const PICK_PX = 5;
const TICK_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

const MARK_GROUP: ClinicalSignificanceGroup = "pathogenic";

const residueName = (sequence: string, position: number) =>
  `${toThreeLetter(sequence[position - 1]) ?? sequence[position - 1] ?? ""}${position}`;

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string | null {
  if (context.measureText(text).width <= width) return text;
  for (let end = text.length - 1; end >= 2; end -= 1) {
    const cut = `${text.slice(0, end)}…`;
    if (context.measureText(cut).width <= width) return cut;
  }
  return null;
}

/**
 * The sequence axis as one slim row: domains as blocks, a mark above them for every position with
 * a pathogenic or likely pathogenic variant. Click a mark for the variant, a block for the domain,
 * anywhere else for the residue.
 */
export function SequenceStrip({
  accession,
  sequence,
  tracks,
  variants,
  selection,
  selectedVariantId = null,
  hoverPosition,
  onSelect,
  onSelectVariant,
  onHover,
  onExpand,
  className,
}: SequenceStripProps) {
  const length = sequence.length;
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const monoProbeRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const domains = useMemo<SequenceFeature[]>(
    () => tracks.find((track) => track.kind === "domain")?.features ?? [],
    [tracks],
  );
  const marks = useMemo<PositionGroup[]>(
    () =>
      groupByPosition(
        variants.filter(
          (variant) =>
            variant.group === "clinical" &&
            significanceGroup(variant) === MARK_GROUP &&
            variant.position >= 1 &&
            variant.position <= length,
        ),
      ),
    [variants, length],
  );
  const selectedVariant = useMemo(
    () =>
      selectedVariantId
        ? (variants.find((variant) => variant.id === selectedVariantId) ?? null)
        : null,
    [variants, selectedVariantId],
  );

  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const read = () => {
      setWidth(plot.clientWidth);
      setPalette(readPalette(plot, monoProbeRef.current));
    };
    read();
    const resize = new ResizeObserver(read);
    resize.observe(plot);
    const theme = new MutationObserver(read);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, []);

  const toX = useCallback(
    (position: number) =>
      length > 0 ? ((position - 0.5) / length) * width : 0,
    [length, width],
  );
  const toPosition = useCallback(
    (x: number) =>
      Math.min(length, Math.max(1, Math.floor((x / width) * length) + 1)),
    [length, width],
  );

  const variantNear = useCallback(
    (x: number): PositionGroup | null => {
      let best: PositionGroup | null = null;
      let distance = PICK_PX;
      for (const entry of marks) {
        const gap = Math.abs(toX(entry.position) - x);
        if (gap < distance) {
          best = entry;
          distance = gap;
        }
      }
      return best;
    },
    [marks, toX],
  );
  const domainAt = useCallback(
    (position: number) =>
      domains.find(
        (domain) => position >= domain.start && position <= domain.end,
      ) ?? null,
    [domains],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !palette || width === 0 || length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, HEIGHT);

    for (const range of selection) {
      if (range.start === range.end) continue;
      const left = ((range.start - 1) / length) * width;
      const right = (range.end / length) * width;
      context.fillStyle = palette.muted;
      context.fillRect(left, 0, Math.max(1, right - left), HEIGHT);
    }

    context.strokeStyle = palette.borderStrong;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, AXIS_Y + 0.5);
    context.lineTo(width, AXIS_Y + 0.5);
    context.stroke();

    const step =
      TICK_STEPS.find((candidate) => (candidate / length) * width >= 64) ??
      TICK_STEPS[TICK_STEPS.length - 1];
    context.font = `10px ${palette.mono}`;
    context.textBaseline = "alphabetic";
    context.fillStyle = palette.subtleForeground;
    for (let tick = step; tick <= length; tick += step) {
      const x = Math.round(toX(tick)) + 0.5;
      context.beginPath();
      context.moveTo(x, AXIS_Y);
      context.lineTo(x, AXIS_Y + 3);
      context.stroke();
      const label = String(tick);
      const labelWidth = context.measureText(label).width;
      if (x + labelWidth / 2 < width - 2)
        context.fillText(label, x - labelWidth / 2, HEIGHT - 1);
    }

    context.font = `500 11px ${palette.sans}`;
    context.textBaseline = "middle";
    for (const domain of domains) {
      const left = Math.round(((domain.start - 1) / length) * width);
      const right = Math.round((domain.end / length) * width);
      const blockWidth = Math.max(2, right - left);
      context.fillStyle = palette.muted;
      context.fillRect(left, BAND_TOP, blockWidth, BAND_BOTTOM - BAND_TOP);
      context.strokeStyle = palette.borderStrong;
      context.strokeRect(
        left + 0.5,
        BAND_TOP + 0.5,
        blockWidth - 1,
        BAND_BOTTOM - BAND_TOP - 1,
      );
      const label = domain.label
        ? fitText(context, domain.label, blockWidth - 8)
        : null;
      if (label) {
        context.fillStyle = palette.foreground;
        context.fillText(label, left + 4, (BAND_TOP + BAND_BOTTOM) / 2 + 0.5);
      }
    }

    context.fillStyle = CLINICAL_SIGNIFICANCE[MARK_GROUP].hex;
    for (const entry of marks)
      context.fillRect(
        Math.round(toX(entry.position)),
        MARK_TOP,
        1,
        MARK_BOTTOM - MARK_TOP,
      );

    const line = (position: number, color: string, lineWidth: number) => {
      const x = Math.round(toX(position)) + (lineWidth % 2 ? 0.5 : 0);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, AXIS_Y);
      context.stroke();
    };
    if (typeof hoverPosition === "number")
      line(hoverPosition, palette.mutedForeground, 1);
    for (const range of selection)
      if (range.start === range.end) line(range.start, palette.foreground, 2);
      else {
        const left = ((range.start - 1) / length) * width;
        const right = (range.end / length) * width;
        context.strokeStyle = palette.foreground;
        context.lineWidth = 1;
        context.strokeRect(
          left + 0.5,
          BAND_TOP - 2.5,
          Math.max(1, right - left - 1),
          BAND_BOTTOM - BAND_TOP + 5,
        );
      }
  }, [
    palette,
    width,
    length,
    domains,
    marks,
    selection,
    hoverPosition,
    toX,
  ]);

  const single =
    selection.length === 1 && selection[0].start === selection[0].end
      ? selection[0].start
      : null;
  const selectionLabel =
    single !== null
      ? selectedVariant?.position === single
        ? selectedVariant.label
        : residueName(sequence, single)
      : null;

  const hovered =
    pointer && width > 0
      ? (() => {
          const inMarks = pointer.y < BAND_TOP;
          const near = inMarks ? variantNear(pointer.x) : null;
          const position = near?.position ?? toPosition(pointer.x);
          return { position, near, domain: domainAt(position) };
        })()
      : null;

  const pick = (variant: SequenceVariant) => {
    if (onSelectVariant) onSelectVariant(variant);
    else
      onSelect([{ start: variant.position, end: variant.position }], {
        additive: false,
      });
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const additive = event.metaKey || event.ctrlKey;
    const near = y < BAND_TOP ? variantNear(x) : null;
    if (near) return pick(near.variants[0]);
    const position = toPosition(x);
    const domain =
      y >= BAND_TOP && y <= BAND_BOTTOM ? domainAt(position) : null;
    onSelect(
      [
        domain
          ? { start: domain.start, end: domain.end }
          : { start: position, end: position },
      ],
      { additive },
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const stride = event.shiftKey ? 10 : 1;
    const from = single ?? selection[0]?.start ?? 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(length, from + stride);
    else if (event.key === "ArrowLeft") next = Math.max(1, from - stride);
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = length;
    if (next === null) return;
    event.preventDefault();
    onSelect([{ start: next, end: next }], { additive: false });
  };

  const tipLeft = hovered ? toX(hovered.position) : 0;
  const tipAlign =
    tipLeft < 120
      ? "translate-x-0"
      : tipLeft > width - 120
        ? "-translate-x-full"
        : "-translate-x-1/2";

  return (
    <div
      data-slot="sequence-strip"
      className={cn(
        "flex w-full min-w-0 items-stretch bg-background text-2xs",
        className,
      )}
      style={{ height: HEIGHT }}
    >
      <span ref={monoProbeRef} className="hidden font-mono" aria-hidden />
      <div className="hidden w-[92px] shrink-0 flex-col justify-center border-r border-border px-3 leading-4 sm:flex">
        <span className="font-medium text-foreground">Sequence</span>
        <span className="tabular font-mono text-subtle-foreground">
          1-{length}
        </span>
      </div>
      <div
        ref={plotRef}
        role="slider"
        tabIndex={0}
        aria-label={`Sequence of ${accession}, residue selection`}
        aria-valuemin={1}
        aria-valuemax={length}
        aria-valuenow={single ?? undefined}
        aria-valuetext={
          selectionLabel ??
          (selection[0]
            ? `${selection[0].start} to ${selection[0].end}`
            : "No residue selected")
        }
        className="relative min-w-0 flex-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - bounds.left;
          const y = event.clientY - bounds.top;
          setPointer({ x, y });
          onHover(
            (y < BAND_TOP ? variantNear(x)?.position : null) ?? toPosition(x),
          );
        }}
        onPointerLeave={() => {
          setPointer(null);
          onHover(null);
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute inset-0 block"
          style={{ width: "100%", height: HEIGHT }}
        />
        {selectionLabel !== null && single !== null && width > 0 ? (
          <span
            className={cn(
              "pointer-events-none absolute top-0 bg-foreground px-1 font-mono leading-4 whitespace-nowrap text-background",
              toX(single) > width - 96 ? "-translate-x-full" : "",
            )}
            style={{ left: Math.round(toX(single)) }}
          >
            {selectionLabel}
          </span>
        ) : null}
        {hovered ? (
          <div
            role="presentation"
            className={cn(
              "pointer-events-none absolute bottom-full z-30 mb-1 flex items-center gap-2 border border-border bg-popover px-2 py-1 whitespace-nowrap text-popover-foreground shadow-sm",
              tipAlign,
            )}
            style={{ left: tipLeft }}
          >
            <span className="font-mono text-foreground">
              {residueName(sequence, hovered.position)}
            </span>
            {hovered.domain?.label ? (
              <span className="text-muted-foreground">
                {hovered.domain.label}
              </span>
            ) : null}
            {hovered.near ? (
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-foreground">
                  {hovered.near.variants[0].label}
                </span>
                <span className="text-muted-foreground">
                  {hovered.near.variants[0].significance
                    ? CLINICAL_SIGNIFICANCE[
                        hovered.near.variants[0].significance
                      ].label
                    : "No classification"}
                </span>
                {hovered.near.variants.length > 1 ? (
                  <span className="tabular font-mono text-subtle-foreground">
                    +{hovered.near.variants.length - 1}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {marks.length > 0 ? (
        <span
          title={GROUP_SHORT[MARK_GROUP].label}
          className="hidden shrink-0 items-center gap-1.5 border-l border-border px-3 text-muted-foreground lg:flex"
        >
          <Swatch swatchClass={GROUP_SHORT[MARK_GROUP].swatchClass} />
          <span className="tabular font-mono text-foreground">
            {marks.length}
          </span>
          {GROUP_SHORT[MARK_GROUP].code} sites
        </span>
      ) : null}
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-l border-border px-3 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <ChevronsUpDownIcon className="size-3" aria-hidden />
          <span className="hidden sm:inline">Expand</span>
          <span className="sr-only sm:hidden">Expand the sequence axis</span>
        </button>
      ) : null}
    </div>
  );
}
