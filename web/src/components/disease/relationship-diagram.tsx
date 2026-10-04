"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";

import { ExternalLink } from "@/components/data/external-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { EmptyState } from "@/components/states/empty-state";
import type { Schema, SourceStatus } from "@/lib/api/types";
import { routes } from "@/lib/ids";

import { apiEvidence } from "./evidence";

type Graph = Schema<"RelationshipGraph">;
type GraphNode = Schema<"GraphNode">;
type GraphEdge = Schema<"GraphEdge">;

const ROW = 24;
const GROUP_GAP = 10;
const MIN_WIDTH = 520;
const TRUNK_GAP = 40;
const TRUNK_GAP_TALL = 56;

/** An edge with more than two source records prints its badges on a second line. */
const trunkGap = (edge: GraphEdge | undefined) =>
  edge && edge.evidence.length > 2 ? TRUNK_GAP_TALL : TRUNK_GAP;
const NODE_HEIGHT = { disease: 76, gene: 56, protein: 60 } as const;

type LeafType =
  "participates_in" | "interacts_with" | "physically_associated_with";

const LEAF_GROUPS: Array<{
  type: LeafType;
  title: string;
  relation: string;
  source: string;
}> = [
  {
    type: "participates_in",
    title: "Pathways",
    relation: "participates in",
    source: "Reactome",
  },
  {
    type: "interacts_with",
    title: "Interaction partners",
    relation: "interacts with",
    source: "IntAct, curated",
  },
  {
    type: "physically_associated_with",
    title: "Physical association",
    relation: "physically associated with",
    source: "STRING physical",
  },
];

interface Leaf {
  edge: GraphEdge;
  node: GraphNode;
  y: number;
}

interface LeafGroup {
  type: LeafType;
  title: string;
  relation: string;
  source: string;
  total: number | null;
  y: number;
  leaves: Leaf[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const nodeIdentifier = (node: GraphNode): string | null => {
  const separator = node.id.indexOf(":");
  if (separator < 0) return null;
  const kind = node.id.slice(0, separator);
  return kind === "pathway" || kind === "protein"
    ? node.id.slice(separator + 1)
    : null;
};

function TrunkNode({
  kind,
  label,
  detail,
  href,
  top,
  width,
  current = false,
}: {
  kind: keyof typeof NODE_HEIGHT;
  label: string;
  detail?: React.ReactNode;
  href?: string | null;
  top: number;
  width: number;
  current?: boolean;
}) {
  const body = (
    <>
      <span className="text-2xs leading-4 font-medium tracking-[0.08em] text-subtle-foreground uppercase">
        {kind}
        {current ? " · this page" : ""}
      </span>
      <span
        className={cn(
          "text-xs font-medium text-foreground",
          kind === "disease" ? "line-clamp-2" : "truncate",
        )}
        translate={kind === "disease" ? undefined : "no"}
      >
        {label}
      </span>
      {detail ? (
        <span className="truncate text-2xs text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </>
  );
  const classes = cn(
    "absolute left-0 flex flex-col justify-center gap-0.5 rounded-xs border px-2.5",
    current
      ? "border-border-strong bg-active shadow-[inset_2px_0_0_var(--color-foreground)]"
      : "border-border-strong bg-background",
  );
  const style = { top, width, height: NODE_HEIGHT[kind] };
  if (!href || current) {
    return (
      <div
        className={classes}
        style={style}
        title={label}
        aria-current={current ? "page" : undefined}
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      title={`Open the ${kind} stage for ${label}`}
      className={cn(
        classes,
        "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
      style={style}
    >
      {body}
    </Link>
  );
}

function TrunkEdge({
  edge,
  top,
  width,
  sources,
}: {
  edge: GraphEdge | undefined;
  top: number;
  width: number;
  sources: SourceStatus[] | undefined;
}) {
  if (!edge) return null;
  return (
    <div
      className="absolute left-7 flex flex-wrap content-center items-center gap-x-1.5 gap-y-1 overflow-hidden text-2xs whitespace-nowrap text-muted-foreground"
      style={{ top, height: trunkGap(edge), width: width - 28 }}
    >
      <span className={edge.evidence.length > 2 ? "w-full" : undefined}>
        {edge.label}
      </span>
      {edge.evidence.map((evidence) => (
        <EvidencePopover
          key={evidence.id}
          size="compact"
          evidence={apiEvidence(evidence, { sources })}
        />
      ))}
    </div>
  );
}

export interface RelationshipDiagramProps {
  graph: Graph;
  /** catalog gene and protein of the disease, for the node captions */
  gene: Schema<"DiseaseGeneSummary"> | null;
  protein: Schema<"DiseaseProteinSummary"> | null;
  sources: SourceStatus[] | undefined;
  /** adds the current selection to links that stay on this disease's own gene and protein */
  stageHref: (path: string) => string;
}

/**
 * Disease, gene, protein, pathways and interaction partners as a ruled tree. The trunk runs down
 * the left; everything known about the protein hangs off one bus on the right. Every edge prints
 * the evidence record it was drawn from, and every node opens its stage or its source record.
 */
export function RelationshipDiagram({
  graph,
  gene,
  protein,
  sources,
  stageHref,
}: RelationshipDiagramProps) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const width = Math.max(measured, MIN_WIDTH);

  const layout = useMemo(() => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const totals: Record<LeafType, number | null> = {
      participates_in: graph.pathway_total,
      interacts_with: graph.curated_partner_total,
      physically_associated_with: graph.string_partner_total,
    };
    let cursor = 0;
    const groups: LeafGroup[] = [];
    for (const definition of LEAF_GROUPS) {
      const edges = graph.edges.filter((edge) => edge.type === definition.type);
      if (edges.length === 0) continue;
      const top = cursor;
      cursor += ROW;
      const leaves: Leaf[] = [];
      for (const edge of edges) {
        const node = byId.get(edge.target);
        if (!node) continue;
        leaves.push({ edge, node, y: cursor });
        cursor += ROW;
      }
      cursor += GROUP_GAP;
      groups.push({
        ...definition,
        total: totals[definition.type],
        y: top,
        leaves,
      });
    }
    return {
      disease: graph.nodes.find((node) => node.type === "disease") ?? null,
      geneNode: graph.nodes.find((node) => node.type === "gene") ?? null,
      proteinNode: graph.nodes.find((node) => node.type === "protein") ?? null,
      causedBy: graph.edges.find((edge) => edge.type === "caused_by"),
      encodes: graph.edges.find((edge) => edge.type === "encodes"),
      groups,
      leavesHeight: Math.max(cursor - GROUP_GAP, 0),
    };
  }, [graph]);

  const { disease, geneNode, proteinNode, groups } = layout;
  const trunkWidth = Math.round(Math.min(Math.max(width * 0.3, 176), 240));
  const busX = trunkWidth + 24;
  const leafX = trunkWidth + 48;

  const geneTop = NODE_HEIGHT.disease + trunkGap(layout.causedBy);
  const proteinTop = geneTop + NODE_HEIGHT.gene + trunkGap(layout.encodes);
  const trunkHeight = !geneNode
    ? NODE_HEIGHT.disease
    : !proteinNode
      ? geneTop + NODE_HEIGHT.gene
      : proteinTop + NODE_HEIGHT.protein;
  const proteinY = proteinTop + NODE_HEIGHT.protein / 2;
  const leaves = groups.flatMap((group) => group.leaves);
  const height = Math.max(trunkHeight, layout.leavesHeight, 96);
  const line = (value: number) => Math.round(value) + 0.5;

  const hoveredLeaf = hovered
    ? leaves.find((leaf) => leaf.edge.id === hovered)
    : undefined;

  return (
    <div ref={ref} className="scroll-thin overflow-x-auto">
      <div
        className="relative"
        style={{ width, height }}
        role="group"
        aria-label="Relationship diagram: disease, gene, protein, pathways and interaction partners"
      >
        <svg
          aria-hidden
          width={width}
          height={height}
          className="pointer-events-none absolute inset-0"
          shapeRendering="crispEdges"
          fill="none"
        >
          <g className="stroke-border-strong" strokeWidth={1}>
            {geneNode ? (
              <path d={`M${line(16)} ${NODE_HEIGHT.disease}V${geneTop}`} />
            ) : null}
            {geneNode && proteinNode ? (
              <path
                d={`M${line(16)} ${geneTop + NODE_HEIGHT.gene}V${proteinTop}`}
              />
            ) : null}
            {proteinNode && leaves.length > 0 ? (
              <>
                <path d={`M${trunkWidth} ${line(proteinY)}H${busX}`} />
                <path
                  d={`M${line(busX)} ${Math.min(proteinY, leaves[0].y + ROW / 2)}V${Math.max(proteinY, leaves[leaves.length - 1].y + ROW / 2)}`}
                />
                {leaves.map((leaf) => (
                  <path
                    key={leaf.edge.id}
                    d={`M${busX} ${line(leaf.y + ROW / 2)}H${leafX - 2}`}
                  />
                ))}
              </>
            ) : null}
          </g>
          {hoveredLeaf && proteinNode ? (
            <path
              className="stroke-foreground"
              strokeWidth={1}
              d={`M${trunkWidth} ${line(proteinY)}H${line(busX)}V${line(hoveredLeaf.y + ROW / 2)}H${leafX - 2}`}
            />
          ) : null}
        </svg>

        {disease ? (
          <TrunkNode
            kind="disease"
            label={disease.label}
            detail={disease.ref?.curie ?? "No mapped identifier"}
            top={0}
            width={trunkWidth}
            current
          />
        ) : null}
        {geneNode ? (
          <>
            <TrunkEdge
              edge={layout.causedBy}
              top={NODE_HEIGHT.disease}
              width={trunkWidth}
              sources={sources}
            />
            <TrunkNode
              kind="gene"
              label={geneNode.label}
              detail={gene?.name}
              href={stageHref(routes.gene(geneNode.ref?.id ?? geneNode.label))}
              top={geneTop}
              width={trunkWidth}
            />
          </>
        ) : null}
        {proteinNode ? (
          <>
            <TrunkEdge
              edge={layout.encodes}
              top={geneTop + NODE_HEIGHT.gene}
              width={trunkWidth}
              sources={sources}
            />
            <TrunkNode
              kind="protein"
              label={proteinNode.label}
              detail={
                <span className="font-mono">
                  {proteinNode.ref?.id ?? protein?.accession}
                  {protein?.length ? ` · ${protein.length} aa` : ""}
                </span>
              }
              href={
                proteinNode.ref?.id
                  ? stageHref(routes.protein(proteinNode.ref.id))
                  : null
              }
              top={proteinTop}
              width={trunkWidth}
            />
          </>
        ) : null}

        <div
          className="absolute top-0"
          style={{ left: leafX, width: width - leafX }}
        >
          {!geneNode ? (
            <EmptyState
              size="inline"
              className="px-0 py-1"
              title="No gene, protein, pathway or partner is linked"
              description="The catalog entry, taken from the IUIS 2024 classification, names no HGNC gene for this disease, so there is nothing to draw past the disease itself."
              searched={["IUIS 2024 classification"]}
            />
          ) : !proteinNode ? (
            <EmptyState
              size="inline"
              className="px-0 py-1"
              title="No protein mapped for this gene"
              description="Pathways and interaction partners are looked up by UniProt accession."
              searched={["UniProtKB"]}
            />
          ) : leaves.length === 0 ? (
            <EmptyState
              size="inline"
              className="px-0 py-1"
              title="No pathway or interaction partner on record"
              searched={["Reactome", "IntAct", "STRING"]}
            />
          ) : null}
        </div>

        {groups.map((group) => (
          <div key={group.type}>
            <div
              className="absolute flex items-center gap-2 text-2xs whitespace-nowrap"
              style={{
                top: group.y,
                left: leafX,
                width: width - leafX,
                height: ROW,
              }}
            >
              <span className="font-medium tracking-[0.04em] text-foreground uppercase">
                {group.title}
              </span>
              <span className="tabular font-mono text-subtle-foreground">
                {group.total !== null && group.total > group.leaves.length
                  ? `${group.leaves.length} of ${group.total}`
                  : group.leaves.length}
              </span>
              <span className="truncate text-muted-foreground">
                {group.relation} · {group.source}
              </span>
            </div>
            {group.leaves.map(({ edge, node, y }) => {
              const identifier = nodeIdentifier(node);
              const internal =
                node.type === "interactor" && node.ref?.type === "protein"
                  ? routes.protein(node.ref.id)
                  : null;
              return (
                <div
                  key={edge.id}
                  className={cn(
                    "absolute flex items-center gap-2 pr-1 text-xs",
                    hovered === edge.id && "bg-accent",
                  )}
                  style={{
                    top: y,
                    left: leafX,
                    width: width - leafX,
                    height: ROW,
                  }}
                  onMouseEnter={() => setHovered(edge.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(edge.id)}
                  onBlur={() => setHovered(null)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-[5px] shrink-0 border border-border-strong bg-background",
                      node.type === "pathway" ? "rotate-45" : "rounded-full",
                      hovered === edge.id && "border-foreground bg-foreground",
                    )}
                  />
                  {internal ? (
                    <Link
                      href={internal}
                      title={`Open the protein stage for ${node.label}`}
                      className="min-w-0 truncate rounded-xs font-medium text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground"
                      translate="no"
                    >
                      {node.label}
                    </Link>
                  ) : node.url ? (
                    <ExternalLink
                      href={node.url}
                      title={node.label}
                      className="min-w-0 [&>svg]:shrink-0"
                    >
                      <span className="truncate">{node.label}</span>
                    </ExternalLink>
                  ) : (
                    <span className="min-w-0 truncate" title={node.label}>
                      {node.label}
                    </span>
                  )}
                  {node.in_catalog ? (
                    <span className="shrink-0 rounded-xs border border-border px-1 text-2xs leading-4 text-muted-foreground">
                      in catalog
                    </span>
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {identifier && width - leafX >= 300 ? (
                      <span className="font-mono text-2xs text-subtle-foreground">
                        {identifier}
                      </span>
                    ) : null}
                    {edge.evidence.map((evidence) => (
                      <EvidencePopover
                        key={evidence.id}
                        size="compact"
                        align="end"
                        evidence={apiEvidence(evidence, {
                          sources,
                          statement: `${proteinNode?.label ?? "The protein"} ${group.relation} ${node.label}.`,
                        })}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
