"use client";

import {
  ChevronFirstIcon,
  ChevronLastIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";

import { eventTypeLabel } from "@/components/lab/format";
import { useAgentLabel } from "@/components/lab/run-context";
import type { LabEvent } from "@/components/lab/types";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import { useAdvancedMode } from "@/lib/state/preferences";

export const REPLAY_SPEEDS = [
  { id: 1, label: "1×", intervalMs: 900 },
  { id: 2, label: "2×", intervalMs: 450 },
  { id: 4, label: "4×", intervalMs: 225 },
] as const;

export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]["id"];

export interface ReplayBarProps {
  events: LabEvent[];
  /** index into `events` of the line the replay is on */
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** when the run was recorded */
  recordedAt: string | null;
  onIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: ReplaySpeed) => void;
  onExit: () => void;
}

/**
 * Transport for stepping through a finished run. It says plainly that the page is showing a
 * recorded run and when it was recorded; nothing is recomputed.
 */
export function ReplayBar({
  events,
  index,
  playing,
  speed,
  recordedAt,
  onIndex,
  onPlaying,
  onSpeed,
  onExit,
}: ReplayBarProps) {
  const agentLabel = useAgentLabel();
  const advanced = useAdvancedMode();
  const last = events.length - 1;
  const current = events[index];
  const atEnd = index >= last;
  return (
    <div
      role="region"
      aria-label="Replay of a recorded run"
      className="border-b border-border bg-sunken"
    >
      <div className="mx-auto flex min-h-10 w-full max-w-[96rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 md:px-6">
        <p className="flex items-center gap-2 text-xs">
          <span aria-hidden className="h-2.5 w-px shrink-0 bg-foreground" />
          <span className="text-2xs font-medium tracking-[0.04em] uppercase">
            Replay
          </span>
          <span className="text-muted-foreground">
            Recorded{" "}
            <span className="tabular font-mono text-foreground">
              {formatTimestamp(recordedAt) ?? "at an unrecorded time"}
            </span>
          </span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="First line"
              disabled={index <= 0}
              onClick={() => onIndex(0)}
            >
              <ChevronFirstIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous line"
              disabled={index <= 0}
              onClick={() => onIndex(index - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={atEnd && !playing}
              onClick={() => onPlaying(!playing)}
            >
              {playing ? (
                <PauseIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next line"
              disabled={atEnd}
              onClick={() => onIndex(index + 1)}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Last line"
              disabled={atEnd}
              onClick={() => onIndex(last)}
            >
              <ChevronLastIcon />
            </Button>
          </div>

          <input
            type="range"
            aria-label="Record line"
            aria-valuetext={
              current
                ? `Line ${current.seq}: ${agentLabel(current.agent)}, ${eventTypeLabel(current.type)}`
                : undefined
            }
            min={0}
            max={Math.max(last, 0)}
            step={1}
            value={index}
            onChange={(event) => onIndex(Number(event.target.value))}
            className="hidden h-1 w-28 cursor-pointer accent-foreground sm:block xl:w-40"
          />
          <span className="tabular font-mono text-2xs whitespace-nowrap text-muted-foreground">
            {advanced ? "line " : null}
            {index + 1} of {events.length}
          </span>

          <div
            role="group"
            aria-label="Replay speed"
            className="hidden items-center gap-0.5 sm:flex"
          >
            {REPLAY_SPEEDS.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={speed === option.id ? "secondary" : "ghost"}
                aria-pressed={speed === option.id}
                onClick={() => onSpeed(option.id)}
                className="font-mono"
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={onExit}>
            Exit replay
          </Button>
        </div>
      </div>
    </div>
  );
}
