"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "cn";

import { SourceStatusList } from "@/components/evidence/source-status-list";
import { SequenceAxisDock } from "@/components/sequence";
import { Page, PageBody, PageHeader, PageSection, Plate } from "@/components/shell/page";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseVariantId, toThreeLetter } from "@/lib/ids";
import { setWorkspaceHover, useWorkspaceHover } from "@/lib/state/hover";
import {
  describeRanges,
  useWorkspaceSelection,
  type ResidueRange,
} from "@/lib/state/selection";

import { fetchAxisData } from "./live-data";

const PROTEINS: Array<{ accession: string; label: string }> = [
  { accession: "Q06187", label: "BTK, 659 aa" },
  { accession: "P42224", label: "STAT1, 750 aa" },
  { accession: "P50851", label: "LRBA, 2,863 aa" },
];

function parseRange(value: string | null): ResidueRange | null {
  const match = value ? /^(\d+)(?:-(\d+))?$/.exec(value) : null;
  if (!match) return null;
  const start = Number(match[1]);
  return { start, end: match[2] ? Number(match[2]) : start };
}

export interface SequenceDemoProps {
  initialAccession: string;
  initialWindow: string | null;
  initialSelection: string | null;
  initialTall: boolean;
}

export function SequenceDemo({
  initialAccession,
  initialWindow,
  initialSelection,
  initialTall,
}: SequenceDemoProps) {
  const [accession, setAccession] = useState(initialAccession);
  const [tall, setTall] = useState(initialTall);
  const protein = useQuery({
    queryKey: ["dev-sequence", accession],
    queryFn: () => fetchAxisData(accession),
    staleTime: Infinity,
    retry: false,
  });

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const variant = useWorkspaceSelection((state) => state.variant);
  const axisWindow = useWorkspaceSelection((state) => state.window);
  const bindAccession = useWorkspaceSelection((state) => state.bindAccession);
  const setRanges = useWorkspaceSelection((state) => state.setRanges);
  const toggleRange = useWorkspaceSelection((state) => state.toggleRange);
  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  const setWindow = useWorkspaceSelection((state) => state.setWindow);
  const hover = useWorkspaceHover();

  useEffect(() => {
    bindAccession(accession);
    if (accession !== initialAccession) return;
    const startWindow = parseRange(initialWindow);
    const startSelection = parseRange(initialSelection);
    if (startWindow) setWindow(startWindow);
    if (startSelection) setRanges([startSelection]);
  }, [
    accession,
    bindAccession,
    initialAccession,
    initialSelection,
    initialWindow,
    setRanges,
    setWindow,
  ]);

  const data = protein.data;
  const selectedVariantId =
    variant && data?.gene
      ? `${data.gene}-p.${toThreeLetter(variant.reference)}${variant.position}${toThreeLetter(variant.alternate)}`
      : null;
  const hoverLetter =
    hover && data && hover.accession === data.accession
      ? data.sequence[hover.position - 1]
      : null;

  return (
    <Page>
      <PageHeader
        kind="Dev"
        title="Sequence axis"
        id={accession}
        description="The axis dock on live data read in the browser from UniProt, the EBI Proteins variation API, PDBe and AlphaFold DB. Selection and hover go through the shared workspace stores, as they do inside the workspace frame."
        actions={
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={0}
            value={[accession]}
            onValueChange={(value) => (value.length ? setAccession(value[0] as string) : null)}
          >
            {PROTEINS.map((entry) => (
              <ToggleGroupItem key={entry.accession} value={entry.accession}>
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <PageBody flush>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-2 text-xs md:px-6">
          <span className="text-muted-foreground">
            sel{" "}
            <span className="tabular font-mono text-foreground">
              {describeRanges(ranges, data?.sequence) ?? "none"}
            </span>
          </span>
          <span className="text-muted-foreground">
            variant{" "}
            <span className="font-mono text-foreground">
              {variant
                ? `p.${toThreeLetter(variant.reference) ?? variant.reference}${variant.position}${toThreeLetter(variant.alternate) ?? variant.alternate}${variant.sourceId ? ` ${variant.sourceId}` : ""}`
                : "none"}
            </span>
          </span>
          <span className="text-muted-foreground">
            hover{" "}
            <span className="tabular font-mono text-foreground">
              {hover && hoverLetter
                ? `${toThreeLetter(hoverLetter) ?? hoverLetter}${hover.position} from ${hover.origin}`
                : "none"}
            </span>
          </span>
          <span className="text-muted-foreground">
            win{" "}
            <span className="tabular font-mono text-foreground">
              {axisWindow ? `${axisWindow.start}-${axisWindow.end}` : "whole protein"}
            </span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setRanges([{ start: 28, end: 28 }])}>
              Store: select 28
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRanges([{ start: 540, end: 560 }])}>
              Store: select 540-560
            </Button>
            <Button variant="outline" size="sm" aria-pressed={tall} onClick={() => setTall((previous) => !previous)}>
              {tall ? "Dock height: tall" : "Dock height: normal"}
            </Button>
          </span>
        </div>
        {data ? (
          <label className="flex items-center gap-3 border-b border-border-subtle px-4 py-2 text-xs text-muted-foreground md:px-6">
            Hover from the 3D viewport (simulated)
            <input
              type="range"
              min={1}
              max={data.sequence.length}
              defaultValue={1}
              aria-label="Simulated viewport hover position"
              className="max-w-md flex-1"
              onChange={(event) =>
                setWorkspaceHover({
                  accession: data.accession,
                  position: Number(event.target.value),
                  origin: "viewport",
                })
              }
            />
          </label>
        ) : null}

        <Plate
          className={cn(
            "border-x-0 border-t-0",
            tall ? "h-[calc(46dvh-28px)] min-h-[320px]" : "h-[192px]",
          )}
        >
          {protein.isPending ? (
            <RowsSkeleton rows={5} />
          ) : protein.isError ? (
            <QueryErrorState
              error={protein.error}
              subject={`sequence data for ${accession}`}
              onRetry={() => void protein.refetch()}
            />
          ) : data ? (
            <SequenceAxisDock
              accession={data.accession}
              sequence={data.sequence}
              tracks={data.tracks}
              variants={data.variants}
              variantStatus={data.variantStatus}
              selection={ranges}
              selectedVariantId={selectedVariantId}
              hoverPosition={hover?.accession === data.accession ? hover.position : null}
              window={axisWindow}
              onSelect={(next, info) => (info.additive ? next.forEach(toggleRange) : setRanges(next))}
              onSelectVariant={(selected) => {
                const parsed = parseVariantId(selected.id);
                selectVariant({
                  reference: selected.reference,
                  position: selected.position,
                  alternate: selected.alternate,
                  sourceId:
                    selected.sourceId ?? (parsed?.kind === "clinvar" ? parsed.accession : null),
                });
              }}
              onHover={(position) =>
                setWorkspaceHover(
                  position === null ? null : { accession: data.accession, position, origin: "axis" },
                )
              }
              onWindowChange={setWindow}
            />
          ) : null}
        </Plate>

        <div className="px-4 md:px-6">
          <PageSection
            title="Sources"
            count={data?.sources.length ?? null}
            description="Each row of the axis names its own source. One source failing leaves the other rows in place."
          >
            {data ? <SourceStatusList sources={data.sources} /> : null}
          </PageSection>
        </div>
      </PageBody>
    </Page>
  );
}
