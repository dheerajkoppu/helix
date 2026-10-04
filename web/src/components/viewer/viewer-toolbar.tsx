"use client";

import {
  CameraIcon,
  ChevronDownIcon,
  CrosshairIcon,
  DownloadIcon,
  EllipsisIcon,
  Maximize2Icon,
  Minimize2Icon,
  RotateCcwIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { COLOUR_BY, VIEWER_WORDS, plainShape } from "@/lib/plain-language";
import { REPRESENTATIONS, type Representation } from "@/lib/state/selection";

import type { ViewerDomain } from "./colorings";

export interface ViewerColorOption {
  value: string;
  label: string;
  /** why the mode cannot be used with the loaded structures */
  unavailable?: string;
}

export interface ViewerToolbarProps {
  representation: Representation;
  onRepresentationChange: (representation: Representation) => void;
  colorOptions: ViewerColorOption[];
  colorValue: string;
  onColorChange: (value: string) => void;
  domains?: ViewerDomain[];
  onDomainSelect?: (domain: ViewerDomain) => void;
  canFocus: boolean;
  onReset: () => void;
  onFocus: () => void;
  fullscreen: boolean;
  onFullscreenToggle: () => void;
  onScreenshot: (background: "canvas" | "white") => void;
  downloads: Array<{ id: string; label: string }>;
  onDownload: (id: string) => void;
  disabled?: boolean;
  /** representation, colour, reset and screenshot stay in the row; the rest moves under More */
  compact?: boolean;
  /** compact only: menu items appended to More, e.g. the superposition method */
  moreItems?: ReactNode;
  /** extra controls after the colour menu, e.g. the superposition method; not drawn when compact */
  children?: ReactNode;
}

const REPRESENTATION_LABEL: Record<Representation, string> = {
  cartoon: "Cartoon",
  surface: "Surface",
  "ball-and-stick": "Sticks",
};

const MENU_TRIGGER =
  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-xs whitespace-nowrap text-foreground outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-active disabled:pointer-events-none disabled:opacity-50";
const ICON_TRIGGER =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-active disabled:pointer-events-none disabled:opacity-50";

/** The control row of the 3D viewport. Every control is a button or a menu, so all of it is reachable by keyboard. */
export function ViewerToolbar({
  representation,
  onRepresentationChange,
  colorOptions,
  colorValue,
  onColorChange,
  domains,
  onDomainSelect,
  canFocus,
  onReset,
  onFocus,
  fullscreen,
  onFullscreenToggle,
  onScreenshot,
  downloads,
  onDownload,
  disabled = false,
  compact = false,
  moreItems,
  children,
}: ViewerToolbarProps) {
  const activeColor = colorOptions.find(
    (option) => option.value === colorValue,
  );
  const hasDomains = Boolean(domains && domains.length > 0 && onDomainSelect);

  const shapes = (
    <ToggleGroup
      size="sm"
      variant="outline"
      spacing={0}
      aria-label="Representation"
      value={[representation]}
      onValueChange={(value) => {
        if (value.length) onRepresentationChange(value[0] as Representation);
      }}
    >
      {REPRESENTATIONS.map((value) => (
        <ToggleGroupItem key={value} value={value} disabled={disabled}>
          {compact ? plainShape(value) : REPRESENTATION_LABEL[value]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div
      role="toolbar"
      aria-label="3D viewer controls"
      data-slot="viewer-toolbar"
      data-compact={compact ? "" : undefined}
      className="flex h-9 shrink-0 items-center border-b border-border-subtle bg-background pl-2 data-compact:h-11 data-compact:pl-3"
    >
      {/* the controls scroll in their own column, so the sticky actions never sit over one */}
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {/* simple mode leads with colour, the control a reader reaches for first */}
        {compact ? null : shapes}

        <DropdownMenu>
          <DropdownMenuTrigger
            className={MENU_TRIGGER}
            disabled={disabled}
            data-action="color-mode"
          >
            <span className="text-muted-foreground">
              {compact ? COLOUR_BY : "Colour"}
            </span>
            {activeColor?.label ?? "Choose"}
            <ChevronDownIcon
              className="size-3 text-muted-foreground"
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-auto min-w-56">
            <DropdownMenuRadioGroup
              value={colorValue}
              onValueChange={(value) => onColorChange(String(value))}
            >
              {colorOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  disabled={Boolean(option.unavailable)}
                  closeOnClick
                >
                  <span className="flex flex-col">
                    {option.label}
                    {option.unavailable ? (
                      <span className="text-2xs text-muted-foreground">
                        {option.unavailable}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {!compact && hasDomains ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={MENU_TRIGGER}
              disabled={disabled}
              data-action="select-domain"
            >
              Select domain
              <ChevronDownIcon
                className="size-3 text-muted-foreground"
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-auto min-w-56">
              {domains?.map((domain) => (
                <DropdownMenuItem
                  key={domain.id}
                  onClick={() => onDomainSelect?.(domain)}
                >
                  {domain.label}
                  <span className="tabular ml-auto pl-4 font-mono text-2xs text-muted-foreground">
                    {domain.start}-{domain.end}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {compact ? shapes : children}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 bg-background px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={compact ? VIEWER_WORDS.resetView : "Reset camera"}
          title={compact ? VIEWER_WORDS.resetView : "Reset camera"}
          data-action="reset-camera"
          disabled={disabled}
          onClick={onReset}
        >
          <RotateCcwIcon />
        </Button>
        {compact ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={VIEWER_WORDS.saveImage}
              title={VIEWER_WORDS.saveImage}
              data-action="screenshot"
              disabled={disabled}
              onClick={() => onScreenshot("canvas")}
            >
              <CameraIcon />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={ICON_TRIGGER}
                aria-label={VIEWER_WORDS.more}
                title={VIEWER_WORDS.more}
                data-action="more"
              >
                <EllipsisIcon className="size-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-56">
                {hasDomains ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={disabled}>
                      {VIEWER_WORDS.selectRegion}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-56">
                      {domains?.map((domain) => (
                        <DropdownMenuItem
                          key={domain.id}
                          onClick={() => onDomainSelect?.(domain)}
                        >
                          {domain.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                <DropdownMenuItem
                  data-action="focus-selection"
                  disabled={disabled || !canFocus}
                  onClick={onFocus}
                >
                  <CrosshairIcon />
                  {VIEWER_WORDS.zoomToSelection}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="fullscreen"
                  onClick={onFullscreenToggle}
                >
                  {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
                  {fullscreen
                    ? VIEWER_WORDS.exitFullScreen
                    : VIEWER_WORDS.fullScreen}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="screenshot-white"
                  disabled={disabled}
                  onClick={() => onScreenshot("white")}
                >
                  <CameraIcon />
                  {VIEWER_WORDS.saveImageWhite}
                </DropdownMenuItem>
                {downloads.length > 0 ? <DropdownMenuSeparator /> : null}
                {downloads.map((download, index) => (
                  <DropdownMenuItem
                    key={download.id}
                    disabled={disabled}
                    title={download.label}
                    onClick={() => onDownload(download.id)}
                  >
                    <DownloadIcon />
                    {downloads.length > 1
                      ? `${VIEWER_WORDS.download} ${index + 1}`
                      : VIEWER_WORDS.download}
                  </DropdownMenuItem>
                ))}
                {moreItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Focus selection"
              title={
                canFocus ? "Focus selection" : "Select a residue to focus it"
              }
              data-action="focus-selection"
              disabled={disabled || !canFocus}
              onClick={onFocus}
            >
              <CrosshairIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              aria-pressed={fullscreen}
              title={fullscreen ? "Exit full screen" : "Full screen"}
              data-action="fullscreen"
              onClick={onFullscreenToggle}
            >
              {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={ICON_TRIGGER}
                aria-label="Export figure as PNG"
                title="Export figure as PNG"
                data-action="screenshot"
                disabled={disabled}
              >
                <CameraIcon className="size-3" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-56">
                <DropdownMenuItem
                  data-action="screenshot-canvas"
                  onClick={() => onScreenshot("canvas")}
                >
                  PNG, as shown
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="screenshot-white"
                  onClick={() => onScreenshot("white")}
                >
                  PNG, white background
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={ICON_TRIGGER}
                aria-label="Download structure file"
                title="Download structure file"
                data-action="download"
                disabled={disabled || downloads.length === 0}
              >
                <DownloadIcon className="size-3" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-56">
                {downloads.map((download) => (
                  <DropdownMenuItem
                    key={download.id}
                    onClick={() => onDownload(download.id)}
                  >
                    <span className="font-mono">{download.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
