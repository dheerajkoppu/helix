"use client";

import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { useState } from "react";
import { usePanelRef, useDefaultLayout } from "react-resizable-panels";
import { cn } from "cn";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useHydrated } from "@/hooks/use-hydrated";
import { useIsDesktop } from "@/hooks/use-media-query";
import { PANEL_WORDS, plainPanel } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

export interface WorkspaceZonesProps {
  /** left: the dense table for the stage. Omit for stages that have none. */
  ledger?: React.ReactNode;
  /** centre: the 3D viewport or the stage's primary plot. Always present. */
  instrument: React.ReactNode;
  /** right: evidence for the current selection. Omit it while nothing is selected and the zone closes. */
  inspector?: React.ReactNode;
  /** names the persisted panel layout; use the stage id */
  layoutId?: string;
  /** phones: label for the sheet buttons, when the default names are too generic */
  ledgerLabel?: string;
  inspectorLabel?: string;
  className?: string;
}

const noopStorage = { getItem: () => null, setItem: () => {} };

function DesktopZones({
  ledger,
  instrument,
  inspector,
  layoutId = "default",
}: WorkspaceZonesProps) {
  const ledgerRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const panelIds = [
    ledger ? "ledger" : null,
    "instrument",
    inspector ? "inspector" : null,
  ].filter((id): id is string => id !== null);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `helix.zones.${layoutId}`,
    panelIds,
    storage: typeof window === "undefined" ? noopStorage : window.localStorage,
  });

  const toggle = (panel: typeof ledgerRef) => {
    const handle = panel.current;
    if (!handle) return;
    if (handle.isCollapsed()) handle.expand();
    else handle.collapse();
  };

  useHotkeys({
    l: () => toggle(ledgerRef),
    i: () => toggle(inspectorRef),
  });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {ledger ? (
        <>
          <ResizablePanel
            id="ledger"
            panelRef={ledgerRef}
            defaultSize={392}
            minSize={264}
            maxSize="45%"
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
          >
            {ledger}
          </ResizablePanel>
          <ResizableHandle />
        </>
      ) : null}
      <ResizablePanel id="instrument" minSize={320}>
        {instrument}
      </ResizablePanel>
      {inspector ? (
        <>
          <ResizableHandle />
          <ResizablePanel
            id="inspector"
            panelRef={inspectorRef}
            defaultSize={376}
            minSize={300}
            maxSize="45%"
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
          >
            {inspector}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

function MobileZones({
  ledger,
  instrument,
  inspector,
  ledgerLabel: ledgerName,
  inspectorLabel: inspectorName,
}: WorkspaceZonesProps) {
  const advanced = useAdvancedMode();
  const ledgerLabel = advanced
    ? (ledgerName ?? "Ledger")
    : ledgerName
      ? plainPanel(ledgerName)
      : PANEL_WORDS.list;
  const inspectorLabel = advanced
    ? (inspectorName ?? "Inspector")
    : inspectorName
      ? plainPanel(inspectorName)
      : PANEL_WORDS.details;
  const [sheet, setSheet] = useState<"ledger" | "inspector" | null>(null);
  const buttons = [
    ledger
      ? { id: "ledger" as const, label: ledgerLabel, icon: PanelLeftIcon }
      : null,
    inspector
      ? {
          id: "inspector" as const,
          label: inspectorLabel,
          icon: PanelRightIcon,
        }
      : null,
  ].filter((button) => button !== null);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{instrument}</div>
      {buttons.length > 0 ? (
        <div className="grid shrink-0 auto-cols-fr grid-flow-col border-t border-border bg-sunken">
          {buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              onClick={() => setSheet(button.id)}
              className="flex h-11 items-center justify-center gap-2 border-r border-border text-xs font-medium text-foreground last:border-r-0 active:bg-active"
            >
              <button.icon
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              {button.label}
            </button>
          ))}
        </div>
      ) : null}
      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => (open ? null : setSheet(null))}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[72dvh]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>
              {sheet === "ledger" ? ledgerLabel : inspectorLabel}
            </SheetTitle>
            <SheetDescription>
              {sheet === "ledger"
                ? "Table for this stage"
                : "Evidence for the current selection"}
            </SheetDescription>
          </SheetHeader>
          <div
            aria-hidden
            className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border-strong"
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            {sheet === "ledger"
              ? ledger
              : sheet === "inspector"
                ? inspector
                : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The three-zone work area. From 1024px: resizable Ledger | Instrument | Inspector, sizes remembered
 * per stage, `l` and `i` collapse the side zones. Below that: the Instrument fills the area and the
 * side zones open as bottom sheets.
 */
export function WorkspaceZones(props: WorkspaceZonesProps) {
  const hydrated = useHydrated();
  const desktop = useIsDesktop();

  return (
    <div
      data-slot="workspace-zones"
      className={cn("size-full min-h-0", props.className)}
    >
      {!hydrated ? (
        <div aria-hidden className="flex size-full">
          {props.ledger ? (
            <div className="hidden w-80 shrink-0 border-r border-border lg:block" />
          ) : null}
          <div className="flex-1" />
          {props.inspector ? (
            <div className="hidden w-[340px] shrink-0 border-l border-border lg:block" />
          ) : null}
        </div>
      ) : desktop ? (
        <DesktopZones {...props} />
      ) : (
        <MobileZones {...props} />
      )}
    </div>
  );
}
