"use client";

import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Rows3Icon,
} from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import {
  SequenceAxisDock,
  type SequenceTrack,
  type SequenceVariant,
} from "@/components/sequence";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { parseVariantId } from "@/lib/ids";
import { setWorkspaceHover, useWorkspaceHover } from "@/lib/state/hover";
import { usePreferences, type DockHeight } from "@/lib/state/preferences";
import { describeRanges, useWorkspaceSelection } from "@/lib/state/selection";
import { useWorkspaceSubjectStore, type StageId } from "@/lib/state/subject";

export interface AxisDockData {
  /** UniProt accession the sequence belongs to */
  accession: string;
  /** canonical sequence, one-letter codes */
  sequence: string;
  tracks: SequenceTrack[];
  variants: SequenceVariant[];
}

interface AxisDockState {
  data: AxisDockData | null;
  loadingAccession: string | null;
  setData: (data: AxisDockData | null) => void;
  setLoading: (accession: string | null) => void;
}

const useAxisDockStore = create<AxisDockState>()((set) => ({
  data: null,
  loadingAccession: null,
  setData: (data) => set({ data, loadingAccession: null }),
  setLoading: (loadingAccession) => set({ loadingAccession }),
}));

/**
 * Feeds the persistent sequence axis. Call it from any workspace page that has the protein's
 * sequence and tracks. The dock lives in the frame, so it keeps its scroll position and data when
 * the user moves between stages of the same protein. Pass a stable (memoised) object.
 */
export function useAxisDock(
  data: AxisDockData | null | undefined,
  options: { loadingAccession?: string | null } = {},
): void {
  const setData = useAxisDockStore((state) => state.setData);
  const setLoading = useAxisDockStore((state) => state.setLoading);
  const loadingAccession = options.loadingAccession ?? null;

  useEffect(() => {
    if (data) setData(data);
  }, [data, setData]);

  useEffect(() => {
    if (!data && loadingAccession) setLoading(loadingAccession);
  }, [data, loadingAccession, setLoading]);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const HEIGHT_CLASS: Record<DockHeight, string> = {
  collapsed: "h-7",
  normal: "h-36 lg:h-[220px]",
  tall: "h-[46dvh]",
};

const HEIGHT_LABEL: Record<DockHeight, string> = {
  collapsed: "Expand the sequence axis",
  normal: "Make the sequence axis taller",
  tall: "Collapse the sequence axis",
};

export interface AxisDockSlotProps {
  stage: StageId | null;
  className?: string;
}

/**
 * The persistent dock under every stage from Gene to Intervention. Hidden on the Disease stage,
 * where there is no protein yet. Wires the sequence axis to the shared selection and hover channel.
 */
export function AxisDockSlot({ stage, className }: AxisDockSlotProps) {
  const data = useAxisDockStore((state) => state.data);
  const loadingAccession = useAxisDockStore((state) => state.loadingAccession);
  const protein = useWorkspaceSubjectStore((state) => state.chain.protein);
  const variantSubject = useWorkspaceSubjectStore(
    (state) => state.chain.variant,
  );
  const dockHeight = usePreferences((state) => state.dockHeight);
  const cycleDockHeight = usePreferences((state) => state.cycleDockHeight);

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const axisWindow = useWorkspaceSelection((state) => state.window);
  const setRanges = useWorkspaceSelection((state) => state.setRanges);
  const toggleRange = useWorkspaceSelection((state) => state.toggleRange);
  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  const setWindow = useWorkspaceSelection((state) => state.setWindow);
  const hover = useWorkspaceHover();

  useHotkeys(
    { a: cycleDockHeight },
    { enabled: stage !== "disease" && stage !== null },
  );

  if (stage === "disease" || stage === null) return null;

  const accession = protein?.id ?? null;
  const ready =
    data !== null && (accession === null || data.accession === accession);
  const loading =
    !ready && loadingAccession !== null && loadingAccession === accession;
  const height: DockHeight = ready ? dockHeight : "collapsed";
  const HeightIcon =
    dockHeight === "tall" ? ChevronsDownUpIcon : ChevronsUpDownIcon;

  return (
    <section
      data-slot="axis-dock"
      aria-label="Sequence axis"
      className={cn(
        "flex shrink-0 flex-col border-t border-border-strong/70 bg-background",
        HEIGHT_CLASS[height],
        className,
      )}
    >
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-sunken px-3 text-2xs whitespace-nowrap">
        <span className="text-[0.625rem] font-medium tracking-[0.08em] text-subtle-foreground uppercase">
          Axis
        </span>
        {ready && data ? (
          <>
            <span className="font-mono text-foreground" translate="no">
              {data.accession}
            </span>
            <span className="tabular font-mono text-muted-foreground">
              canonical 1-{data.sequence.length}
            </span>
            <span className="hidden text-subtle-foreground sm:inline">
              <Rows3Icon className="mr-1 inline size-3" aria-hidden />
              {plural(data.tracks.length, "track")}, {plural(data.variants.length, "variant")}
            </span>
            <span className="ml-2 hidden items-center gap-1.5 md:flex">
              <span className="text-muted-foreground">sel</span>
              <span className="tabular font-mono text-foreground">
                {describeRanges(ranges, data.sequence) ?? "none"}
              </span>
            </span>
          </>
        ) : loading ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Spinner className="size-3" /> Loading sequence for{" "}
            <span className="font-mono">{accession}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {accession ? (
              <>
                No sequence loaded for{" "}
                <span className="font-mono text-foreground">{accession}</span>.
              </>
            ) : (
              "No protein in context. The sequence axis appears when a protein is loaded."
            )}
          </span>
        )}
        {ready ? (
          <div className="ml-auto flex items-center gap-2">
            <KeyHint keys="a" className="hidden lg:inline-flex" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={HEIGHT_LABEL[dockHeight]}
                    onClick={cycleDockHeight}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <HeightIcon className="size-3" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="top">
                {HEIGHT_LABEL[dockHeight]}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </header>
      {ready && data && height !== "collapsed" ? (
        <div className="min-h-0 flex-1">
          <SequenceAxisDock
            accession={data.accession}
            sequence={data.sequence}
            tracks={data.tracks}
            variants={data.variants}
            selection={ranges}
            selectedVariantId={variantSubject?.id ?? null}
            hoverPosition={
              hover?.accession === data.accession ? hover.position : null
            }
            window={axisWindow}
            onSelect={(next, info) =>
              info.additive ? next.forEach(toggleRange) : setRanges(next)
            }
            onSelectVariant={(variant) => {
              const parsed = parseVariantId(variant.id);
              selectVariant({
                reference: variant.reference,
                position: variant.position,
                alternate: variant.alternate,
                sourceId:
                  variant.sourceId ??
                  (parsed?.kind === "clinvar" ? parsed.accession : null),
              });
            }}
            onHover={(position) =>
              setWorkspaceHover(
                position === null
                  ? null
                  : { accession: data.accession, position, origin: "axis" },
              )
            }
            onWindowChange={setWindow}
          />
        </div>
      ) : null}
    </section>
  );
}
