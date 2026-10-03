"use client";

import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  KIND_META,
  KindMark,
  structureOriginOf,
} from "@/components/project/kinds";
import { formatTimestamp } from "@/lib/format";
import { useAdvancedMode } from "@/lib/state/preferences";
import type { ProjectItem, Trail, TrailNode } from "@/lib/state/projects";

const NODE_WIDTH = 224;
const SIMPLE_NODE_WIDTH = 280;
const NODE_HEIGHT = 44;
const GAP_X = 40;
const GAP_Y = 22;
const PAD = 16;

interface Placed {
  node: TrailNode;
  column: number;
  row: number;
  x: number;
  y: number;
  annotations: TrailNode[];
}

const isAnnotation = (node: TrailNode) =>
  node.kind === "note" || node.kind === "screenshot";

/**
 * Top to bottom: a step sits below the item it followed. The first step continues the lane; each
 * further step from the same item opens a new lane to the right. Notes and screenshots that end a
 * branch are counted on the item they annotate instead of taking a slot.
 */
function layoutTrail(trail: Trail, nodeWidth: number) {
  const children = new Map<string | null, TrailNode[]>();
  const known = new Set(trail.nodes.map((node) => node.item_id));
  for (const node of trail.nodes) {
    const parent =
      node.parent_item_id && known.has(node.parent_item_id)
        ? node.parent_item_id
        : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const placed = new Map<string, Placed>();
  const hiddenInto = new Map<string, string>();
  let nextLane = 0;
  let rows = 0;

  function place(node: TrailNode, column: number, row: number) {
    rows = Math.max(rows, row + 1);
    const entry: Placed = {
      node,
      column,
      row,
      x: PAD + column * (nodeWidth + GAP_X),
      y: PAD + row * (NODE_HEIGHT + GAP_Y),
      annotations: [],
    };
    placed.set(node.item_id, entry);
    let first = true;
    for (const child of children.get(node.item_id) ?? []) {
      if (isAnnotation(child) && !children.has(child.item_id)) {
        entry.annotations.push(child);
        hiddenInto.set(child.item_id, node.item_id);
        continue;
      }
      if (first) place(child, column, row + 1);
      else {
        nextLane += 1;
        place(child, nextLane, row + 1);
      }
      first = false;
    }
  }

  (children.get(null) ?? []).forEach((root, index) => {
    if (index > 0) nextLane += 1;
    place(root, nextLane, 0);
  });

  return {
    placed,
    hiddenInto,
    width: PAD * 2 + (nextLane + 1) * (nodeWidth + GAP_X),
    height: PAD * 2 + rows * (NODE_HEIGHT + GAP_Y),
  };
}

export interface ResearchTrailProps {
  trail: Trail;
  items: ProjectItem[];
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
  /** shows where the next saved item attaches; off for a frozen snapshot */
  showAttachPoint?: boolean;
  className?: string;
}

/** The research trail as a node-link diagram. Every node is a saved item; every link a step. */
export function ResearchTrail({
  trail,
  items,
  selectedItemId,
  onSelect,
  showAttachPoint = true,
  className,
}: ResearchTrailProps) {
  const advanced = useAdvancedMode();
  // Simple mode trades the monospace identifiers for room to read the label
  const nodeWidth = advanced ? NODE_WIDTH : SIMPLE_NODE_WIDTH;
  const layout = useMemo(
    () => layoutTrail(trail, nodeWidth),
    [trail, nodeWidth],
  );
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const hasSelected = useRef(false);
  const selectedNodeId = selectedItemId
    ? (layout.hiddenInto.get(selectedItemId) ?? selectedItemId)
    : null;

  useEffect(() => {
    const target = selectedNodeId ? layout.placed.get(selectedNodeId) : null;
    const element = scroller.current;
    if (!target || !element) return;
    // The first paint keeps the start of the trail in view
    if (!hasSelected.current) {
      hasSelected.current = true;
      return;
    }
    const top = target.y - PAD;
    const bottom = target.y + NODE_HEIGHT + GAP_Y;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight)
      element.scrollTop = bottom - element.clientHeight;
    const left = target.x - PAD;
    const right = target.x + nodeWidth + GAP_X;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (right > element.scrollLeft + element.clientWidth)
      element.scrollLeft = right - element.clientWidth;
  }, [selectedNodeId, layout, nodeWidth]);

  const steps = trail.edges.filter(
    (edge) =>
      edge.relation === "led_to" &&
      layout.placed.has(edge.source) &&
      layout.placed.has(edge.target),
  );
  const supports = trail.edges.filter(
    (edge) =>
      edge.relation === "supports" &&
      layout.placed.has(edge.source) &&
      layout.placed.has(edge.target),
  );
  const active = trail.active_item_id
    ? layout.placed.get(
        layout.hiddenInto.get(trail.active_item_id) ?? trail.active_item_id,
      )
    : null;

  return (
    <div
      ref={scroller}
      className={cn("scroll-thin overflow-auto bg-background", className)}
    >
      <div
        role="tree"
        aria-label="Research trail"
        className="relative"
        style={{ width: layout.width, height: layout.height, minWidth: "100%" }}
      >
        <svg
          aria-hidden
          width={layout.width}
          height={layout.height}
          className="pointer-events-none absolute top-0 left-0"
        >
          <defs>
            <marker
              id="trail-arrow"
              viewBox="0 0 6 6"
              refX="5.5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0.5 L5.5 3 L0 5.5 Z" fill="currentColor" />
            </marker>
          </defs>
          <g className="text-border-strong" fill="none" stroke="currentColor">
            {steps.map((edge) => {
              const from = layout.placed.get(edge.source) as Placed;
              const to = layout.placed.get(edge.target) as Placed;
              const startX = from.x + nodeWidth / 2;
              const startY = from.y + NODE_HEIGHT;
              const endX = to.x + nodeWidth / 2;
              const bend = startY + GAP_Y / 2;
              const path =
                startX === endX
                  ? `M${startX} ${startY} V${to.y}`
                  : `M${startX} ${bend} H${endX} V${to.y}`;
              return (
                <path
                  key={`${edge.source}-${edge.target}`}
                  d={path}
                  strokeWidth={1}
                  markerEnd="url(#trail-arrow)"
                />
              );
            })}
            {showAttachPoint && active ? (
              <g>
                <path
                  d={`M${active.x + 14} ${active.y + NODE_HEIGHT} v7`}
                  strokeDasharray="2 2"
                />
                <rect
                  x={active.x + 11}
                  y={active.y + NODE_HEIGHT + 7}
                  width={6}
                  height={6}
                />
              </g>
            ) : null}
          </g>
          <g
            className="text-ev-hypothesis"
            fill="none"
            stroke="currentColor"
            strokeDasharray="1.5 3"
            strokeLinecap="round"
          >
            {supports.map((edge) => {
              const from = layout.placed.get(edge.source) as Placed;
              const to = layout.placed.get(edge.target) as Placed;
              const startX = from.x + nodeWidth;
              const endX = to.x + nodeWidth;
              const startY = from.y + NODE_HEIGHT / 2;
              const endY = to.y + NODE_HEIGHT / 2 + 8;
              const bulge = Math.max(startX, endX) + GAP_X - 14;
              return (
                <path
                  key={`${edge.source}-${edge.target}-supports`}
                  d={`M${startX} ${startY} C${bulge} ${startY}, ${bulge} ${endY}, ${endX} ${endY}`}
                  strokeWidth={1.25}
                />
              );
            })}
          </g>
        </svg>

        {[...layout.placed.values()].map((entry) => {
          const { node } = entry;
          const item = itemsById.get(node.item_id);
          const selected = selectedNodeId === node.item_id;
          const isHypothesis = node.kind === "hypothesis";
          const secondary = advanced
            ? (node.ref ??
              (item?.hypothesis
                ? `status: ${item.hypothesis.status}`
                : formatTimestamp(node.created_at)))
            : item?.hypothesis
              ? `${KIND_META[node.kind].label} · ${item.hypothesis.status}`
              : KIND_META[node.kind].label;
          const structureOrigin =
            node.kind === "structure" ? structureOriginOf(node.ref) : null;
          return (
            <div
              key={node.item_id}
              role="treeitem"
              aria-selected={selected}
              aria-level={node.depth + 1}
              className={cn(
                "group/node absolute flex border bg-background",
                isHypothesis
                  ? "border-dotted border-ev-hypothesis"
                  : "border-border-strong",
                selected && "bg-active",
              )}
              style={{
                left: entry.x,
                top: entry.y,
                width: nodeWidth,
                height: NODE_HEIGHT,
              }}
            >
              {selected ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
                />
              ) : null}
              <button
                type="button"
                onClick={() => onSelect(node.item_id)}
                className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {advanced || node.kind === "hypothesis" ? (
                    <KindMark item={node} />
                  ) : structureOrigin ? (
                    <StructureOriginTag origin={structureOrigin} size="compact" />
                  ) : null}
                  <span
                    className={cn(
                      "truncate font-medium text-foreground",
                      advanced ? "text-xs" : "text-sm",
                    )}
                  >
                    {node.label}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
                  <span className={cn("truncate", advanced && "font-mono")}>
                    {secondary}
                  </span>
                  {entry.annotations.length ? (
                    <span className="tabular ml-auto shrink-0 font-mono text-subtle-foreground">
                      {entry.annotations.length}{" "}
                      {entry.annotations.length === 1 ? "note" : "notes"}
                    </span>
                  ) : null}
                </span>
              </button>
              {node.href ? (
                <Link
                  href={node.href}
                  title={`Reopen the view ${node.label} was saved from`}
                  aria-label={`Reopen the view ${node.label} was saved from`}
                  className="flex w-6 shrink-0 items-center justify-center border-l border-border-subtle text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <ArrowRightIcon className="size-3" />
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrailLegend({
  showAttachPoint = true,
}: {
  showAttachPoint?: boolean;
}) {
  return (
    <div className="flex h-6 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-sunken px-3 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <svg aria-hidden width="22" height="6" className="text-border-strong">
          <path d="M0 3 H17" stroke="currentColor" fill="none" />
          <path d="M16 0.5 L21.5 3 L16 5.5 Z" fill="currentColor" />
        </svg>
        led to
      </span>
      <span className="flex items-center gap-1.5">
        <svg aria-hidden width="22" height="6" className="text-ev-hypothesis">
          <path
            d="M1 3 H21"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeDasharray="1.5 3"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        supports a hypothesis
      </span>
      {showAttachPoint ? (
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="18" height="8" className="text-border-strong">
            <path
              d="M0 4 h10"
              stroke="currentColor"
              strokeDasharray="2 2"
              fill="none"
            />
            <rect
              x="10.5"
              y="1"
              width="6"
              height="6"
              stroke="currentColor"
              fill="none"
            />
          </svg>
          next saved item attaches here
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <ArrowRightIcon aria-hidden className="size-3" />
        reopen the saved view
      </span>
    </div>
  );
}
