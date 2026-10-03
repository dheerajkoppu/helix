"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "cn";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePreferences } from "@/lib/state/preferences";

interface ModeToggleProps {
  label: string;
  description: string;
  pressed: boolean;
  onToggle: () => void;
  className?: string;
}

/** Text toggle with a square state mark: hollow when off, filled when on. */
function ModeToggle({
  label,
  description,
  pressed,
  onToggle,
  className,
}: ModeToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={pressed}
            onClick={onToggle}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs hover:bg-accent",
              pressed
                ? "bg-active font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
              className,
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-[1px] border",
            pressed
              ? "border-foreground bg-foreground"
              : "border-border-strong",
          )}
        />
        {label}
      </TooltipTrigger>
      <TooltipContent side="bottom">{description}</TooltipContent>
    </Tooltip>
  );
}

export function LearnModeToggle({ className }: { className?: string }) {
  const learnMode = usePreferences((state) => state.learnMode);
  const toggle = usePreferences((state) => state.toggleLearnMode);
  return (
    <ModeToggle
      label="Learn"
      description={
        learnMode
          ? "Learn Mode is on: hover an underlined term for its meaning"
          : "Learn Mode: explain terms on hover"
      }
      pressed={learnMode}
      onToggle={toggle}
      className={className}
    />
  );
}

export function AdvancedToggle({ className }: { className?: string }) {
  const advanced = usePreferences((state) => state.advanced);
  const toggle = usePreferences((state) => state.toggleAdvanced);
  return (
    <ModeToggle
      label="Advanced"
      description={
        advanced
          ? "Advanced is on: full metrics and parameters"
          : "Advanced: show full metrics and parameters"
      }
      pressed={advanced}
      onToggle={toggle}
      className={className}
    />
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const current =
    THEME_OPTIONS.find(
      (option) => option.value === (hydrated ? theme : "system"),
    ) ?? THEME_OPTIONS[0];
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${current.label}`}
        className={cn(
          "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-active aria-expanded:text-foreground",
          className,
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuRadioGroup
          value={hydrated ? theme : "system"}
          onValueChange={(value) => setTheme(String(value))}
        >
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              <option.icon
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
