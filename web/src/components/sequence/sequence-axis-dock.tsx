"use client";

import {
  FilterIcon,
  Maximize2Icon,
  Rows3Icon,
  TableIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { EVIDENCE_META, type EvidenceClass } from "@/lib/evidence";
import { toThreeLetter } from "@/lib/ids";
import { alphaMissenseClass } from "@/lib/science/alphamissense";
import {
  CLINICAL_SIGNIFICANCE,
  type ClinicalSignificanceGroup,
} from "@/lib/science/clinical-significance";
import { plddtBand } from "@/lib/science/plddt";
import { STRUCTURE_ORIGIN_META } from "@/lib/structure-origin";

import {
  BIN_BELOW_PX,
  COVERAGE_ORIGINS,
  SIGNIFICANCE_GROUPS,
  SIGNIFICANCE_GROUP_LABEL,
  clampView,
  drawAxis,
  drawOverview,
  groupByPosition,
  layoutRows,
  readPalette,
  significanceGroup,
  trackHasData,
  type HitRegion,
  type Palette,
  type Row,
  type View,
} from "./draw";
import {
  AxisLegend,
  CONSEQUENCES,
  CONSEQUENCE_LABEL,
  ConsequenceGlyph,
  GROUP_SHORT,
} from "./legend";
import { searchSequence, type SearchResult } from "./search";
import { SequenceStrip } from "./sequence-strip";
import { AxisTable } from "./table-view";
import type {
  ResidueRange,
  SequenceAxisDockProps,
  SequenceFeature,
  SequenceVariant,
  VariantConsequence,
} from "./types";

const GUTTER = "w-16 shrink-0 sm:w-[92px]";
const GUTTER_CELL =
  "border-r border-border bg-sunken text-2xs text-muted-foreground";
const OVERVIEW_HEIGHT = 18;
const TIP_VARIANT_LIMIT = 5;

interface VariantFilter {
  groups: Set<ClinicalSignificanceGroup>;
  consequences: Set<VariantConsequence>;
  minStars: number;
}

interface Tip {
  clientX: number;
  clientY: number;
  position: number;
  rowId: string | null;
  hit: HitRegion | null;
}

type Gesture =
  | {
      type: "select";
      anchor: number;
      startX: number;
      moved: boolean;
      additive: boolean;
    }
  | { type: "pan"; startX: number; startView: View; moved: boolean }
  | { type: "pinch"; distance: number; startView: View; centre: number }
  | null;

type OverviewDrag = {
  mode: "move" | "left" | "right";
  grab: number;
  startView: View;
} | null;

function toggled<T>(set: Set<T>, values: T[], all: T[], isolate: boolean) {
  if (isolate) {
    const alreadyIsolated =
      set.size === values.length && values.every((value) => set.has(value));
    return new Set(alreadyIsolated ? all : values);
  }
  const next = new Set(set);
  const on = values.some((value) => next.has(value));
  for (const value of values) {
    if (on) next.delete(value);
    else next.add(value);
  }
  return next;
}

const evidenceCode = (evidenceClass: EvidenceClass | undefined) =>
  evidenceClass ? EVIDENCE_META[evidenceClass].code : null;

function variantLine(variant: SequenceVariant): string {
  const meta = variant.significance
    ? CLINICAL_SIGNIFICANCE[variant.significance]
    : null;
  const parts = [
    CONSEQUENCE_LABEL[variant.consequence].toLowerCase(),
    meta ? `${meta.code} ${meta.label}` : "no classification",
  ];
  if (variant.group === "clinical") {
    parts.push(
      variant.reviewStars === null || variant.reviewStars === undefined
        ? "no review status"
        : `review ${variant.reviewStars}/4`,
    );
  }
  if (variant.alleleFrequency)
    parts.push(`AF ${variant.alleleFrequency.toExponential(2)}`);
  return parts.join(", ");
}

/**
 * The sequence axis: an overview strip, a ruler, residue letters, annotation tracks, per-residue
 * strips and variant lollipops on one shared scale, drawn on canvas so proteins of several
 * thousand residues stay smooth. Selection and hover are owned by the caller.
 */
export function SequenceAxisDock(props: SequenceAxisDockProps) {
  if (props.mode === "strip") return <SequenceStrip {...props} />;
  return (
    <AxisDock key={`${props.accession}:${props.sequence.length}`} {...props} />
  );
}

function AxisDock({
  accession,
  sequence,
  tracks,
  variants,
  variantStatus,
  selection,
  selectedVariantId = null,
  hoverPosition,
  window: axisWindow,
  onSelect,
  onSelectVariant,
  onHover,
  onWindowChange,
  className,
}: SequenceAxisDockProps) {
  const length = sequence.length;
  const summaryId = useId();
  const resultsId = useId();

  const rootRef = useRef<HTMLDivElement>(null);
  const monoProbeRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hitsRef = useRef<HitRegion[]>([]);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture>(null);
  const overviewDragRef = useRef<OverviewDrag>(null);
  const anchorRef = useRef<number | null>(null);
  const lastHoverRef = useRef<number | null>(null);
  const tipFrameRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});

  const [width, setWidth] = useState(0);
  const [overviewWidth, setOverviewWidth] = useState(0);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [view, setView] = useState<View>(() =>
    axisWindow
      ? {
          start: axisWindow.start - 1,
          span: axisWindow.end - axisWindow.start + 1,
        }
      : { start: 0, span: length },
  );
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState<VariantFilter>(() => ({
    groups: new Set(SIGNIFICANCE_GROUPS),
    consequences: new Set(CONSEQUENCES),
    minStars: 0,
  }));
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [dragRange, setDragRange] = useState<ResidueRange | null>(null);
  const [stack, setStack] = useState<{
    clientX: number;
    clientY: number;
    variants: SequenceVariant[];
  } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const initialWindowKey = axisWindow
    ? `${axisWindow.start}-${axisWindow.end}`
    : null;
  const [seenSelection, setSeenSelection] = useState<string | null>(null);
  const [seenWindow, setSeenWindow] = useState(initialWindowKey);
  const [emittedWindow, setEmittedWindow] = useState(initialWindowKey);

  const plotWidth = Math.max(1, width);
  const current = clampView(view, length, plotWidth);
  const pxPerResidue = plotWidth / current.span;
  const windowStart = Math.min(length, Math.floor(current.start) + 1);
  const windowEnd = Math.max(
    windowStart,
    Math.min(length, Math.round(current.start + current.span)),
  );
  const isFit = current.span >= length - 0.5;

  const visibleTracks = useMemo(
    () =>
      tracks.filter((track) =>
        hidden ? !hidden.has(track.id) : track.defaultVisible !== false,
      ),
    [tracks, hidden],
  );
  const hasClinical = useMemo(
    () => variants.some((variant) => variant.group === "clinical"),
    [variants],
  );
  const hasPopulation = useMemo(
    () => variants.some((variant) => variant.group === "population"),
    [variants],
  );
  const filtered = useMemo(
    () =>
      variants.filter((variant) => {
        if (!filter.consequences.has(variant.consequence)) return false;
        if (variant.group !== "clinical") return true;
        return (
          filter.groups.has(significanceGroup(variant)) &&
          (variant.reviewStars ?? 0) >= filter.minStars
        );
      }),
    [variants, filter],
  );
  const clinical = useMemo(
    () =>
      groupByPosition(
        filtered.filter((variant) => variant.group === "clinical"),
      ),
    [filtered],
  );
  const population = useMemo(
    () =>
      groupByPosition(
        filtered.filter((variant) => variant.group === "population"),
      ),
    [filtered],
  );
  const { rows, height: rowsHeight } = useMemo(
    () => layoutRows(visibleTracks, hasClinical, hasPopulation),
    [visibleTracks, hasClinical, hasPopulation],
  );
  const variantPositions = useMemo(
    () =>
      [
        ...new Set([...clinical, ...population].map((group) => group.position)),
      ].sort((left, right) => left - right),
    [clinical, population],
  );
  const boundaries = useMemo(() => {
    const set = new Set<number>();
    for (const track of visibleTracks) {
      if (track.kind === "coverage" || track.kind === "secondary_structure")
        continue;
      for (const feature of track.features ?? []) {
        set.add(feature.start);
        set.add(feature.end);
      }
    }
    return [...set].sort((left, right) => left - right);
  }, [visibleTracks]);
  const overviewDomains = useMemo(
    () => tracks.find((track) => track.kind === "domain")?.features ?? [],
    [tracks],
  );
  const trackKinds = useMemo(
    () =>
      new Set<string>(
        visibleTracks.filter(trackHasData).map((track) => track.kind),
      ),
    [visibleTracks],
  );

  const applyView = useCallback(
    (next: View, byUser = true) => {
      if (byUser) userMovedRef.current = true;
      setView(clampView(next, length, plotWidth));
    },
    [length, plotWidth],
  );

  const zoomAt = (pixel: number, factor: number) => {
    const span = current.span / factor;
    const residue = current.start + pixel / pxPerResidue;
    const clamped = clampView({ start: 0, span }, length, plotWidth).span;
    applyView({
      start: residue - (pixel / plotWidth) * clamped,
      span: clamped,
    });
  };
  const zoomToRange = (range: ResidueRange) => {
    const size = range.end - range.start + 1;
    const padding = Math.max(2, size * 0.15);
    applyView({ start: range.start - 1 - padding, span: size + padding * 2 });
  };
  const centreOn = (position: number, minPx = 0) => {
    const span =
      minPx > 0 && pxPerResidue < minPx
        ? Math.min(length, plotWidth / minPx)
        : current.span;
    applyView({ start: position - 0.5 - span / 2, span });
  };
  const ensureVisible = (position: number) => {
    const margin = Math.min(3, current.span / 4);
    if (position - 1 < current.start + margin) {
      applyView({ start: position - 1 - margin, span: current.span });
    } else if (position > current.start + current.span - margin) {
      applyView({
        start: position - current.span + margin,
        span: current.span,
      });
    }
  };

  useLayoutEffect(() => {
    const plot = plotRef.current;
    const overview = overviewRef.current;
    if (!plot || !overview) return;
    const measure = () => {
      setWidth(plot.clientWidth);
      setOverviewWidth(overview.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    observer.observe(overview);
    return () => observer.disconnect();
  }, [showTable]);

  // Canvas colours come from the theme tokens, so they are re-read when the theme or fonts change.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const read = () => setPalette(readPalette(root, monoProbeRef.current));
    read();
    const observer = new MutationObserver(read);
    for (
      let element: HTMLElement | null = root;
      element;
      element = element.parentElement
    ) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);
    document.fonts?.ready.then(read).catch(() => {});
    return () => {
      observer.disconnect();
      media.removeEventListener("change", read);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !palette || width === 0 || showTable) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(rowsHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    hitsRef.current = drawAxis({
      context,
      width,
      height: rowsHeight,
      palette,
      rows,
      sequence,
      view: current,
      clinical,
      population,
      selection,
      selectedVariantId,
    });
    // `current` is derived from view, length and width
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    palette,
    width,
    rowsHeight,
    rows,
    sequence,
    current.start,
    current.span,
    clinical,
    population,
    selection,
    selectedVariantId,
    showTable,
  ]);

  useLayoutEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas || !palette || overviewWidth === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(overviewWidth * ratio);
    canvas.height = Math.round(OVERVIEW_HEIGHT * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawOverview({
      context,
      width: overviewWidth,
      height: OVERVIEW_HEIGHT,
      palette,
      length,
      domains: overviewDomains,
      clinical,
      selection,
    });
  }, [palette, overviewWidth, length, overviewDomains, clinical, selection]);

  // A selection made elsewhere (3D viewport, table, URL) is brought into view.
  const selectionKey = selection
    .map((range) => `${range.start}-${range.end}`)
    .join(",");
  const ready = width > 0;
  if (ready && seenSelection !== selectionKey) {
    setSeenSelection(selectionKey);
    const range = selection[0];
    if (
      range &&
      (range.end <= current.start || range.start > current.start + current.span)
    ) {
      const middle = (range.start + range.end) / 2;
      setView(
        clampView(
          { start: middle - 0.5 - current.span / 2, span: current.span },
          length,
          plotWidth,
        ),
      );
    }
  }

  // The window prop moves the view unless it is the echo of a window this axis reported itself.
  const windowKey = axisWindow ? `${axisWindow.start}-${axisWindow.end}` : null;
  if (seenWindow !== windowKey) {
    setSeenWindow(windowKey);
    if (windowKey !== emittedWindow) {
      setEmittedWindow(windowKey);
      setView(
        axisWindow
          ? {
              start: axisWindow.start - 1,
              span: axisWindow.end - axisWindow.start + 1,
            }
          : { start: 0, span: length },
      );
    }
  }

  useEffect(() => {
    if (!onWindowChange || !userMovedRef.current) return;
    const timer = window.setTimeout(() => {
      const key = isFit ? null : `${windowStart}-${windowEnd}`;
      if (key === emittedWindow) return;
      setEmittedWindow(key);
      onWindowChange(isFit ? null : { start: windowStart, end: windowEnd });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [windowStart, windowEnd, isFit, onWindowChange, emittedWindow]);

  const publishHover = (position: number | null) => {
    if (lastHoverRef.current === position) return;
    lastHoverRef.current = position;
    onHover(position);
  };

  const pixelAt = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    return rect ? clientX - rect.left : 0;
  };
  const positionAt = (clientX: number, clamp = false): number | null => {
    const position =
      Math.floor(current.start + pixelAt(clientX) / pxPerResidue) + 1;
    if (clamp) return Math.min(length, Math.max(1, position));
    return position >= 1 && position <= length ? position : null;
  };
  const rowAt = (clientY: number): Row | null => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const y = clientY - rect.top;
    return rows.find((row) => y >= row.y && y < row.y + row.height) ?? null;
  };
  const hitAt = (clientX: number, clientY: number): HitRegion | null => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const hits = hitsRef.current;
    for (let index = hits.length - 1; index >= 0; index -= 1) {
      const hit = hits[index];
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) return hit;
    }
    return null;
  };

  const selectVariant = (variant: SequenceVariant) => {
    setCursor(variant.position);
    anchorRef.current = variant.position;
    if (onSelectVariant) onSelectVariant(variant);
    else
      onSelect([{ start: variant.position, end: variant.position }], {
        additive: false,
      });
  };

  const handleClick = (
    clientX: number,
    clientY: number,
    modifiers: { shift: boolean; additive: boolean },
  ) => {
    const hit = hitAt(clientX, clientY);
    if (hit?.bin) {
      const middle = (hit.bin.start + hit.bin.end) / 2;
      const span = Math.min(
        current.span,
        plotWidth / (BIN_BELOW_PX * 2),
        Math.max(40, (hit.bin.end - hit.bin.start + 1) * 6),
      );
      applyView({ start: middle - 0.5 - span / 2, span });
      return;
    }
    if (hit?.variants) {
      if (hit.variants.length === 1) {
        selectVariant(hit.variants[0]);
      } else {
        const position = hit.variants[0].position;
        setCursor(position);
        anchorRef.current = position;
        onSelect([{ start: position, end: position }], { additive: false });
        setStack({ clientX, clientY, variants: hit.variants });
      }
      return;
    }
    const position = positionAt(clientX);
    if (position === null) return;
    setCursor(position);
    if (modifiers.shift && anchorRef.current !== null) {
      onSelect(
        [
          {
            start: Math.min(anchorRef.current, position),
            end: Math.max(anchorRef.current, position),
          },
        ],
        { additive: modifiers.additive },
      );
      return;
    }
    anchorRef.current = position;
    onSelect([{ start: position, end: position }], {
      additive: modifiers.additive,
    });
  };

  const scheduleTip = (next: Tip | null) => {
    if (tipFrameRef.current !== null)
      window.cancelAnimationFrame(tipFrameRef.current);
    tipFrameRef.current = window.requestAnimationFrame(() => {
      tipFrameRef.current = null;
      setTip(next);
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setStack(null);
    scrollRef.current?.focus({ preventScroll: true });
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      gestureRef.current = {
        type: "pinch",
        distance: Math.max(1, Math.abs(first.x - second.x)),
        startView: current,
        centre: pixelAt((first.x + second.x) / 2),
      };
      setDragRange(null);
      return;
    }
    if (event.pointerType === "touch" || event.button === 1 || event.altKey) {
      gestureRef.current = {
        type: "pan",
        startX: event.clientX,
        startView: current,
        moved: false,
      };
    } else if (event.button === 0) {
      const anchor = positionAt(event.clientX);
      if (anchor === null) return;
      gestureRef.current = {
        type: "select",
        anchor,
        startX: event.clientX,
        moved: false,
        additive: event.metaKey || event.ctrlKey,
      };
    }
    if (event.pointerType !== "touch")
      event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }
    if (gesture?.type === "pinch") {
      if (pointersRef.current.size < 2) return;
      const [first, second] = [...pointersRef.current.values()];
      const ratio =
        Math.max(1, Math.abs(first.x - second.x)) / gesture.distance;
      const span = clampView(
        { start: 0, span: gesture.startView.span / ratio },
        length,
        plotWidth,
      ).span;
      const residue =
        gesture.startView.start +
        (gesture.centre / plotWidth) * gesture.startView.span;
      applyView({
        start: residue - (gesture.centre / plotWidth) * span,
        span,
      });
      return;
    }
    if (gesture?.type === "pan") {
      const delta = event.clientX - gesture.startX;
      if (Math.abs(delta) > 4) gesture.moved = true;
      if (gesture.moved) {
        applyView({
          start:
            gesture.startView.start -
            delta / (plotWidth / gesture.startView.span),
          span: gesture.startView.span,
        });
      }
      return;
    }
    const position = positionAt(event.clientX, gesture?.type === "select");
    if (gesture?.type === "select" && position !== null) {
      if (Math.abs(event.clientX - gesture.startX) > 3) gesture.moved = true;
      if (gesture.moved) {
        setDragRange({
          start: Math.min(gesture.anchor, position),
          end: Math.max(gesture.anchor, position),
        });
      }
    }
    publishHover(position);
    scheduleTip(
      position === null || gesture
        ? null
        : {
            clientX: event.clientX,
            clientY: event.clientY,
            position,
            rowId: rowAt(event.clientY)?.id ?? null,
            hit: hitAt(event.clientX, event.clientY),
          },
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    pointersRef.current.delete(event.pointerId);
    if (gesture?.type === "pinch") {
      if (pointersRef.current.size === 0) gestureRef.current = null;
      return;
    }
    gestureRef.current = null;
    if (!gesture) return;
    const modifiers = {
      shift: event.shiftKey,
      additive: event.metaKey || event.ctrlKey,
    };
    if (gesture.type === "select") {
      if (gesture.moved) {
        const end = positionAt(event.clientX, true) ?? gesture.anchor;
        anchorRef.current = gesture.anchor;
        setCursor(end);
        setDragRange(null);
        onSelect(
          [
            {
              start: Math.min(gesture.anchor, end),
              end: Math.max(gesture.anchor, end),
            },
          ],
          { additive: gesture.additive },
        );
      } else {
        handleClick(event.clientX, event.clientY, modifiers);
      }
    } else if (!gesture.moved && event.pointerType === "touch") {
      handleClick(event.clientX, event.clientY, modifiers);
    }
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    gestureRef.current = null;
    setDragRange(null);
  };

  const onPointerLeave = () => {
    if (gestureRef.current) return;
    publishHover(null);
    scheduleTip(null);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const position = positionAt(event.clientX);
    const row = rowAt(event.clientY);
    if (position === null) return;
    const feature = row?.features?.find(
      (entry) =>
        row.track?.kind !== "coverage" &&
        position >= entry.feature.start &&
        position <= entry.feature.end,
    )?.feature;
    if (feature) {
      onSelect([{ start: feature.start, end: feature.end }], {
        additive: false,
      });
      zoomToRange(feature);
    } else {
      zoomAt(pixelAt(event.clientX), 2);
    }
  };

  useEffect(() => {
    wheelRef.current = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = Math.max(-40, Math.min(40, event.deltaY));
        zoomAt(pixelAt(event.clientX), Math.exp(-delta * 0.012));
      } else if (
        event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        if (isFit) return;
        event.preventDefault();
        const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
        applyView({
          start: current.start + delta / pxPerResidue,
          span: current.span,
        });
      }
    };
  });

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const listener = (event: WheelEvent) => wheelRef.current(event);
    plot.addEventListener("wheel", listener, { passive: false });
    return () => plot.removeEventListener("wheel", listener);
  }, [showTable]);

  const describeResidue = (position: number): string => {
    const letter = sequence[position - 1];
    const parts = [`${toThreeLetter(letter) ?? letter}${position}`];
    const here = clinical.find((group) => group.position === position);
    if (here)
      parts.push(
        `${here.variants.length} clinical variant${here.variants.length === 1 ? "" : "s"}`,
      );
    for (const track of visibleTracks) {
      if (!trackHasData(track)) continue;
      const value = track.values?.[position - 1];
      if (track.kind === "confidence" && typeof value === "number") {
        parts.push(`pLDDT ${value.toFixed(1)} ${plddtBand(value).label}`);
      } else if (track.kind === "domain" || track.kind === "region") {
        const feature = track.features?.find(
          (entry) => position >= entry.start && position <= entry.end,
        );
        if (feature?.label) parts.push(`${track.label} ${feature.label}`);
      }
    }
    return parts.join(", ");
  };

  const moveCursor = (next: number, extend: boolean) => {
    const position = Math.min(length, Math.max(1, next));
    setCursor(position);
    ensureVisible(position);
    publishHover(position);
    setAnnouncement(describeResidue(position));
    if (extend) {
      const anchor = anchorRef.current ?? position;
      anchorRef.current = anchor;
      onSelect(
        [
          {
            start: Math.min(anchor, position),
            end: Math.max(anchor, position),
          },
        ],
        { additive: false },
      );
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey) return;
    const at =
      cursor ??
      selection[0]?.start ??
      Math.round(current.start + current.span / 2);
    const centrePixel = (at - 0.5 - current.start) * pxPerResidue;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const forward = event.key === "ArrowRight";
        if (event.altKey) {
          const target = forward
            ? boundaries.find((boundary) => boundary > at)
            : [...boundaries].reverse().find((boundary) => boundary < at);
          if (target !== undefined) moveCursor(target, false);
        } else {
          moveCursor(
            cursor === null ? at : at + (forward ? 1 : -1),
            event.shiftKey,
          );
        }
        break;
      }
      case "Home":
        moveCursor(1, event.shiftKey);
        break;
      case "End":
        moveCursor(length, event.shiftKey);
        break;
      case "PageDown":
        applyView({ start: current.start + current.span, span: current.span });
        break;
      case "PageUp":
        applyView({ start: current.start - current.span, span: current.span });
        break;
      case "Enter":
        anchorRef.current = at;
        setCursor(at);
        onSelect([{ start: at, end: at }], { additive: false });
        break;
      case "Escape":
        setStack(null);
        setCursor(null);
        anchorRef.current = null;
        publishHover(null);
        onSelect([], { additive: false });
        break;
      case "+":
      case "=":
        zoomAt(Math.min(plotWidth, Math.max(0, centrePixel)), 1.6);
        break;
      case "-":
      case "_":
        zoomAt(Math.min(plotWidth, Math.max(0, centrePixel)), 1 / 1.6);
        break;
      case "0":
        applyView({ start: 0, span: length });
        break;
      case "z":
        if (selection[0]) zoomToRange(selection[0]);
        break;
      case "n": {
        const target = variantPositions.find((position) => position > at);
        if (target !== undefined) moveCursor(target, false);
        break;
      }
      case "p": {
        const target = [...variantPositions]
          .reverse()
          .find((position) => position < at);
        if (target !== undefined) moveCursor(target, false);
        break;
      }
      case "/":
        searchRef.current?.focus();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  useHotkeys({
    "/": (event) => {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });

  const outcome = useMemo(
    () => searchSequence(query, { accession, sequence, tracks, variants }),
    [query, accession, sequence, tracks, variants],
  );

  const applyResult = (result: SearchResult) => {
    setSearchOpen(false);
    setCursor(result.start);
    anchorRef.current = result.start;
    if (result.kind === "residue") {
      if (result.variant) selectVariant(result.variant);
      else
        onSelect([{ start: result.start, end: result.end }], {
          additive: false,
        });
      centreOn(result.start, 6);
    } else {
      onSelect([{ start: result.start, end: result.end }], { additive: false });
      zoomToRange(result);
    }
    scrollRef.current?.focus({ preventScroll: true });
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = outcome.results.length;
      if (count === 0) return;
      setActiveResult(
        (previous) =>
          (previous + (event.key === "ArrowDown" ? 1 : count - 1)) % count,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = outcome.results[activeResult] ?? outcome.results[0];
      if (result) applyResult(result);
      else if (outcome.fix) {
        setQuery(outcome.fix);
        setActiveResult(0);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      setSearchOpen(false);
      scrollRef.current?.focus({ preventScroll: true });
    }
  };

  const overviewResidue = (clientX: number) => {
    const rect = overviewRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * length;
  };
  const onOverviewDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const residue = overviewResidue(event.clientX);
    const edge = (6 / Math.max(1, overviewWidth)) * length;
    const end = current.start + current.span;
    let mode: "move" | "left" | "right" = "move";
    let grab = current.span / 2;
    if (!isFit && Math.abs(residue - current.start) <= edge) mode = "left";
    else if (!isFit && Math.abs(residue - end) <= edge) mode = "right";
    else if (residue >= current.start && residue <= end)
      grab = residue - current.start;
    else applyView({ start: residue - current.span / 2, span: current.span });
    overviewDragRef.current = { mode, grab, startView: current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onOverviewMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = overviewDragRef.current;
    if (!drag) return;
    const residue = Math.min(
      length,
      Math.max(0, overviewResidue(event.clientX)),
    );
    const minSpan = clampView({ start: 0, span: 0 }, length, plotWidth).span;
    const end = drag.startView.start + drag.startView.span;
    if (drag.mode === "move") {
      applyView({ start: residue - drag.grab, span: current.span });
    } else if (drag.mode === "left") {
      const start = Math.min(residue, end - minSpan);
      applyView({ start, span: end - start });
    } else {
      applyView({
        start: drag.startView.start,
        span: Math.max(minSpan, residue - drag.startView.start),
      });
    }
  };

  const hoverAt =
    hoverPosition && hoverPosition >= 1 && hoverPosition <= length
      ? hoverPosition
      : null;
  const left = (position: number) =>
    (position - 1 - current.start) * pxPerResidue;
  const bands = dragRange ? [...selection, dragRange] : selection;
  const filterActive =
    filter.groups.size < SIGNIFICANCE_GROUPS.length ||
    filter.consequences.size < CONSEQUENCES.length ||
    filter.minStars > 0;
  const zoomFromCentre = (factor: number) => zoomAt(plotWidth / 2, factor);
  const variantNote =
    variants.length > 0
      ? null
      : variantStatus && variantStatus.state !== "ok"
        ? variantStatus.state === "empty"
          ? `No variant record in ${variantStatus.name ?? variantStatus.source}.`
          : `${variantStatus.name ?? variantStatus.source} unavailable${variantStatus.message ? `: ${variantStatus.message}` : ""}. Variant rows are not drawn.`
        : "No variants supplied for this protein.";

  const tipTracks = tip
    ? visibleTracks.flatMap((track) => {
        if (!trackHasData(track)) return [];
        const value = track.values?.[tip.position - 1];
        if (track.values) {
          if (value === null || value === undefined) return [];
          const text =
            track.kind === "confidence"
              ? `${value.toFixed(1)}, ${plddtBand(value).code} ${plddtBand(value).label}`
              : track.kind === "pathogenicity"
                ? `${value.toFixed(2)}, ${alphaMissenseClass(value).label}${track.valueLabel ? ` (${track.valueLabel})` : ""}`
                : value.toFixed(2);
          return [{ track, text, code: evidenceCode(track.evidenceClass) }];
        }
        const here = (track.features ?? []).filter(
          (feature) =>
            tip.position >= feature.start && tip.position <= feature.end,
        );
        if (here.length === 0) return [];
        if (track.kind === "coverage") {
          const text = COVERAGE_ORIGINS.flatMap((origin) => {
            const matching = here.filter(
              (feature) => feature.origin === origin,
            );
            if (matching.length === 0) return [];
            const names = matching
              .slice(0, 4)
              .map(
                (feature) => feature.label ?? feature.sourceId ?? feature.id,
              );
            return [
              `${STRUCTURE_ORIGIN_META[origin].tag} ${names.join(", ")}${matching.length > 4 ? ` and ${matching.length - 4} more` : ""}`,
            ];
          }).join("; ");
          return [{ track, text, code: null }];
        }
        return here.slice(0, 3).map((feature: SequenceFeature) => ({
          track,
          text: `${feature.label ?? feature.description ?? feature.id} ${feature.start === feature.end ? feature.start : `${feature.start}-${feature.end}`}${feature.sourceId ? `, ${feature.sourceId}` : ""}`,
          code: evidenceCode(feature.evidenceClass ?? track.evidenceClass),
        }));
      })
    : [];

  const tipLetter = tip ? sequence[tip.position - 1] : "";

  return (
    <div
      ref={rootRef}
      data-slot="sequence-axis-dock"
      className={cn(
        "relative flex size-full min-h-0 flex-col bg-background text-xs",
        className,
      )}
    >
      <span ref={monoProbeRef} aria-hidden className="sr-only font-mono" />

      <div
        data-slot="axis-toolbar"
        className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border px-2 text-2xs"
      >
        <span className="tabular hidden shrink-0 font-mono text-muted-foreground md:inline">
          win{" "}
          <span className="text-foreground">
            {windowStart}-{windowEnd}
          </span>{" "}
          of {length}, {pxPerResidue.toFixed(pxPerResidue < 10 ? 1 : 0)} px/aa
        </span>
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            aria-label={`Find a residue, range, variant or feature in ${accession}`}
            aria-expanded={searchOpen && query.length > 0}
            aria-controls={resultsId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="165, D165G, 150-180, SH2"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveResult(0);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={onSearchKeyDown}
            className="h-5 w-full min-w-0 rounded-sm border border-border-strong bg-background px-1.5 pr-6 font-mono text-2xs text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <KeyHint
            keys="/"
            className="pointer-events-none absolute top-0.5 right-0.5"
          />
          {searchOpen && query.trim().length > 0 ? (
            <div
              id={resultsId}
              role="listbox"
              aria-label="Search results"
              className="scroll-thin absolute top-full left-0 z-40 mt-1 max-h-40 w-80 max-w-[calc(100vw-1.5rem)] overflow-auto rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-popover"
            >
              {outcome.results.map((result, index) => (
                <button
                  key={result.key}
                  type="button"
                  role="option"
                  aria-selected={index === activeResult}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    applyResult(result);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-baseline gap-2 px-2 py-1 text-left hover:bg-accent",
                    index === activeResult && "bg-active",
                  )}
                >
                  <span className="shrink-0 font-mono text-foreground">
                    {result.label}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {result.detail}
                  </span>
                </button>
              ))}
              {outcome.error ? (
                <div className="px-2 py-1 text-foreground" role="status">
                  {outcome.error}
                  {outcome.fix ? (
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setQuery(outcome.fix ?? "");
                      }}
                      className="mt-1 flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <KeyHint keys="Enter" />
                      search{" "}
                      <span className="font-mono text-foreground">
                        {outcome.fix}
                      </span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            title="Zoom out (-)"
            disabled={isFit}
            onClick={() => zoomFromCentre(1 / 1.6)}
          >
            <ZoomOutIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            title="Zoom in (+). Ctrl or Cmd with the wheel, or pinch, zooms at the pointer"
            onClick={() => zoomFromCentre(1.6)}
          >
            <ZoomInIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit the whole protein"
            title="Fit the whole protein (0)"
            disabled={isFit}
            onClick={() => applyView({ start: 0, span: length })}
          >
            <Maximize2Icon />
          </Button>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Tracks: ${visibleTracks.length} of ${tracks.length} shown`}
                />
              }
            >
              <Rows3Icon />
              <span className="hidden sm:inline">Tracks</span>
              <span className="tabular font-mono text-muted-foreground">
                {visibleTracks.length}/{tracks.length}
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" side="top" className="w-80 gap-1 p-2">
              <p className="px-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
                Tracks
              </p>
              {tracks.map((track) => {
                const shown = visibleTracks.includes(track);
                return (
                  <label
                    key={track.id}
                    className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 hover:bg-accent"
                  >
                    <Checkbox
                      checked={shown}
                      onCheckedChange={(checked) => {
                        const next = new Set(
                          tracks
                            .filter((entry) => !visibleTracks.includes(entry))
                            .map((entry) => entry.id),
                        );
                        if (checked) next.delete(track.id);
                        else next.add(track.id);
                        setHidden(next);
                      }}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="text-foreground">{track.label}</span>
                      {evidenceCode(track.evidenceClass) ? (
                        <span className="ml-1.5 font-mono text-2xs text-muted-foreground">
                          {evidenceCode(track.evidenceClass)}
                        </span>
                      ) : null}
                      <span className="block text-2xs text-muted-foreground">
                        {trackHasData(track)
                          ? (track.source ?? "No source found")
                          : track.status?.state === "empty"
                            ? `No record in ${track.status.name ?? track.status.source}`
                            : `${track.status?.name ?? track.status?.source} unavailable`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Variant filters: ${filtered.length} of ${variants.length} shown`}
                />
              }
            >
              <FilterIcon />
              <span className="hidden sm:inline">Variants</span>
              <span
                className={cn(
                  "tabular font-mono",
                  filterActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {variantNote ? "none" : `${filtered.length}/${variants.length}`}
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" side="top" className="w-80 gap-2 p-2">
              {variantNote ? (
                <p role="status" className="px-1 text-foreground">
                  {variantNote}
                </p>
              ) : null}
              <fieldset className="flex flex-col gap-0.5">
                <legend className="px-1 pb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
                  Clinical significance (clinical row)
                </legend>
                {SIGNIFICANCE_GROUPS.map((group) => (
                  <label
                    key={group}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent"
                  >
                    <Checkbox
                      checked={filter.groups.has(group)}
                      onCheckedChange={() =>
                        setFilter((previous) => ({
                          ...previous,
                          groups: toggled(
                            previous.groups,
                            [group],
                            SIGNIFICANCE_GROUPS,
                            false,
                          ),
                        }))
                      }
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 rounded-[1px] ring-1 ring-border-strong/60 ring-inset",
                        GROUP_SHORT[group].swatchClass,
                      )}
                    />
                    <span className="font-mono text-2xs">
                      {GROUP_SHORT[group].code}
                    </span>
                    <span className="text-muted-foreground">
                      {GROUP_SHORT[group].label}
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-0.5">
                <legend className="px-1 pb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
                  Consequence (both rows)
                </legend>
                {CONSEQUENCES.map((consequence) => (
                  <label
                    key={consequence}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent"
                  >
                    <Checkbox
                      checked={filter.consequences.has(consequence)}
                      onCheckedChange={() =>
                        setFilter((previous) => ({
                          ...previous,
                          consequences: toggled(
                            previous.consequences,
                            [consequence],
                            CONSEQUENCES,
                            false,
                          ),
                        }))
                      }
                    />
                    <ConsequenceGlyph consequence={consequence} />
                    {CONSEQUENCE_LABEL[consequence]}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend className="px-1 pb-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
                  Minimum ClinVar review stars (clinical row)
                </legend>
                <div className="flex gap-1 px-1">
                  {[0, 1, 2, 3, 4].map((stars) => (
                    <button
                      key={stars}
                      type="button"
                      aria-pressed={filter.minStars === stars}
                      onClick={() =>
                        setFilter((previous) => ({
                          ...previous,
                          minStars: stars,
                        }))
                      }
                      className="tabular h-6 flex-1 cursor-pointer rounded-sm border border-border font-mono text-2xs text-muted-foreground hover:bg-accent aria-pressed:border-foreground aria-pressed:bg-active aria-pressed:text-foreground"
                    >
                      {stars === 0 ? "any" : `${stars}/4`}
                    </button>
                  ))}
                </div>
              </fieldset>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showTable}
            aria-label="Show the visible window as tables"
            title="Table of the features and variants in the visible window"
            onClick={() => setShowTable((previous) => !previous)}
            className="aria-pressed:bg-active"
          >
            <TableIcon />
            <span className="hidden sm:inline">Table</span>
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 border-b border-border">
        <div
          className={cn(
            GUTTER,
            GUTTER_CELL,
            "flex items-center px-2 font-mono",
          )}
          style={{ height: OVERVIEW_HEIGHT }}
          title="Whole protein. Drag the window to pan, drag its edges to zoom, double-click to fit."
        >
          1-{length}
        </div>
        <div
          ref={overviewRef}
          data-slot="axis-overview"
          role="presentation"
          className="relative min-w-0 flex-1 cursor-pointer touch-none bg-sunken"
          style={{ height: OVERVIEW_HEIGHT }}
          onPointerDown={onOverviewDown}
          onPointerMove={onOverviewMove}
          onPointerUp={() => (overviewDragRef.current = null)}
          onPointerCancel={() => (overviewDragRef.current = null)}
          onDoubleClick={() => applyView({ start: 0, span: length })}
        >
          <canvas
            ref={overviewCanvasRef}
            aria-hidden
            className="absolute inset-0 size-full"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-x-2 border-y border-foreground/80 bg-foreground/10"
            style={{
              left: `${(current.start / length) * 100}%`,
              width: `${Math.max(0.4, (current.span / length) * 100)}%`,
            }}
          />
        </div>
      </div>

      {showTable ? (
        <AxisTable
          accession={accession}
          window={{ start: windowStart, end: windowEnd }}
          tracks={visibleTracks}
          variants={filtered}
          selectedVariantId={selectedVariantId}
          onSelectRange={(range) => onSelect([range], { additive: false })}
          onSelectVariant={selectVariant}
        />
      ) : (
        <div
          ref={scrollRef}
          role="application"
          aria-roledescription="sequence axis"
          aria-label={`Sequence axis for ${accession}, ${length} residues, UniProt canonical numbering`}
          aria-describedby={summaryId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="scroll-thin flex min-h-0 flex-1 items-start overflow-x-hidden overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
        >
          <div
            className={cn(GUTTER, "relative")}
            style={{ height: rowsHeight }}
          >
            {rows.map((row) => (
              <div
                key={row.id}
                title={
                  row.track
                    ? `${row.track.label}${row.track.source ? `, ${row.track.source}` : ""}`
                    : row.kind === "clinical"
                      ? "Clinical variants, above the axis"
                      : row.kind === "population"
                        ? "Population and other reported variants, below the axis"
                        : `${accession} canonical numbering`
                }
                className={cn(
                  GUTTER_CELL,
                  "absolute inset-x-0 flex items-center justify-between gap-1 overflow-hidden px-2",
                  row.kind === "track" && "border-b border-b-border-subtle",
                )}
                style={{ top: row.y, height: row.height }}
              >
                <span className="truncate">{row.label}</span>
                {row.lanes && row.lanes.length > 0 ? (
                  <span className="flex shrink-0 flex-col justify-center font-mono text-foreground">
                    {row.lanes.map((lane) => (
                      <span
                        key={lane.origin}
                        className="h-[13px] leading-[13px]"
                      >
                        {STRUCTURE_ORIGIN_META[lane.origin].tag}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div
            ref={plotRef}
            data-slot="axis-plot"
            className="relative min-w-0 flex-1 cursor-crosshair touch-pan-y overflow-hidden select-none"
            style={{ height: rowsHeight }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onDoubleClick={onDoubleClick}
          >
            <canvas
              ref={canvasRef}
              aria-hidden
              className="absolute top-0 left-0"
              style={{ width: plotWidth, height: rowsHeight }}
            />
            {bands.map((range, index) => (
              <span
                key={`${range.start}-${range.end}-${index}`}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 border-x border-foreground/70 bg-foreground/10"
                style={{
                  left: left(range.start),
                  width: Math.max(
                    2,
                    (range.end - range.start + 1) * pxPerResidue,
                  ),
                }}
              />
            ))}
            {cursor !== null ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 border-x border-dashed border-foreground"
                style={{
                  left: left(cursor),
                  width: Math.max(3, pxPerResidue),
                }}
              />
            ) : null}
            {hoverAt !== null ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
                style={{ left: left(hoverAt) + pxPerResidue / 2 }}
              />
            ) : null}
          </div>
        </div>
      )}

      <AxisLegend
        hasClinical={hasClinical}
        hasPopulation={hasPopulation}
        binned={pxPerResidue < BIN_BELOW_PX}
        trackKinds={trackKinds}
        groups={filter.groups}
        consequences={filter.consequences}
        onToggleGroup={(group, isolate) =>
          setFilter((previous) => ({
            ...previous,
            groups: toggled(
              previous.groups,
              [group],
              SIGNIFICANCE_GROUPS,
              isolate,
            ),
          }))
        }
        onToggleConsequences={(consequences, isolate) =>
          setFilter((previous) => ({
            ...previous,
            consequences: toggled(
              previous.consequences,
              consequences,
              CONSEQUENCES,
              isolate,
            ),
          }))
        }
      />

      {tip && !showTable ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 flex w-max max-w-80 flex-col gap-1 rounded-md border border-border bg-popover px-2 py-1.5 text-2xs text-popover-foreground shadow-popover"
          style={
            tip.clientX > window.innerWidth - 340
              ? {
                  right: window.innerWidth - tip.clientX + 12,
                  bottom: window.innerHeight - tip.clientY + 12,
                }
              : {
                  left: tip.clientX + 12,
                  bottom: window.innerHeight - tip.clientY + 12,
                }
          }
        >
          <p className="font-mono text-xs text-foreground">
            {toThreeLetter(tipLetter) ?? tipLetter}
            {tip.position}
            <span className="ml-2 text-muted-foreground">
              {tipLetter}
              {tip.position}, {accession} canonical
            </span>
          </p>
          {tip.hit?.bin ? (
            <p className="text-foreground">
              Residues {tip.hit.bin.start}-{Math.min(length, tip.hit.bin.end)}{" "}
              contain {tip.hit.bin.total}{" "}
              {tip.hit.bin.group === "clinical" ? "clinical" : "population"}{" "}
              variant{tip.hit.bin.total === 1 ? "" : "s"}
              {tip.hit.bin.group === "clinical"
                ? `: ${SIGNIFICANCE_GROUPS.filter(
                    (group) => (tip.hit?.bin?.counts[group] ?? 0) > 0,
                  )
                    .map(
                      (group) =>
                        `${tip.hit?.bin?.counts[group]} ${SIGNIFICANCE_GROUP_LABEL[group]}`,
                    )
                    .join(", ")}`
                : ""}
              . Click to expand to single variants.
            </p>
          ) : null}
          {tip.hit?.variants?.slice(0, TIP_VARIANT_LIMIT).map((variant) => (
            <p key={`${variant.group}-${variant.id}`}>
              <span className="font-mono text-foreground">{variant.label}</span>{" "}
              {variantLine(variant)}
              <span className="block text-muted-foreground">
                {evidenceCode(variant.evidenceClass)
                  ? `${evidenceCode(variant.evidenceClass)} `
                  : ""}
                {variant.source ?? "No source found"}
                {variant.sourceId ? ` ${variant.sourceId}` : ""}
                {variant.description ? `, ${variant.description}` : ""}
              </span>
            </p>
          ))}
          {tip.hit?.variants && tip.hit.variants.length > TIP_VARIANT_LIMIT ? (
            <p className="text-muted-foreground">
              and {tip.hit.variants.length - TIP_VARIANT_LIMIT} more at this
              position. Click to list them.
            </p>
          ) : null}
          {tipTracks.map((entry, index) => (
            <p key={`${entry.track.id}-${index}`}>
              <span className="text-muted-foreground">{entry.track.label}</span>{" "}
              <span className="text-foreground">{entry.text}</span>
              <span className="ml-1.5 text-muted-foreground">
                {entry.code ? `${entry.code} ` : ""}
                {entry.track.source ?? ""}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      {stack ? (
        <div
          role="menu"
          aria-label={`Variants at residue ${stack.variants[0].position}`}
          className="scroll-thin fixed z-50 flex max-h-56 w-72 flex-col overflow-auto rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-popover"
          style={{
            left: Math.max(8, Math.min(stack.clientX, window.innerWidth - 300)),
            bottom: window.innerHeight - stack.clientY + 10,
          }}
        >
          <p className="px-2 pb-1 text-2xs text-muted-foreground">
            {stack.variants.length} variants at residue{" "}
            {stack.variants[0].position}
          </p>
          {stack.variants.map((variant) => (
            <button
              key={`${variant.group}-${variant.id}`}
              type="button"
              role="menuitem"
              onClick={() => {
                selectVariant(variant);
                setStack(null);
              }}
              className={cn(
                "flex cursor-pointer flex-col px-2 py-1 text-left hover:bg-accent",
                variant.id === selectedVariantId && "bg-active",
              )}
            >
              <span className="flex items-center gap-1.5">
                <ConsequenceGlyph consequence={variant.consequence} />
                <span className="font-mono text-foreground">
                  {variant.label}
                </span>
              </span>
              <span className="text-2xs text-muted-foreground">
                {variantLine(variant)}
                {variant.source ? `, ${variant.source}` : ""}
                {variant.sourceId ? ` ${variant.sourceId}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <p id={summaryId} className="sr-only">
        {`${accession}, ${length} residues, UniProt canonical numbering. Showing residues ${windowStart} to ${windowEnd}. `}
        {`${clinical.length} positions with clinical variants and ${population.length} positions with population variants after filters. `}
        {`Tracks: ${visibleTracks
          .map(
            (track) =>
              `${track.label}${track.source ? ` from ${track.source}` : ""}${track.features ? `, ${track.features.length} features` : ""}`,
          )
          .join("; ")}. `}
        Left and Right move the residue cursor, Enter selects it, Shift with
        arrows extends a range, Escape clears, plus and minus zoom, 0 fits the
        protein, n and p step through variants, slash opens residue search. The
        Table button shows the same rows as tables.
      </p>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
