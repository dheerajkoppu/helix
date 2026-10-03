"use client";

import { useRouter } from "next/navigation";

import { AssistantDock, AssistantTrigger } from "@/components/assistant";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShortcutSheet } from "@/components/shell/shortcut-sheet";
import { StatusLine } from "@/components/shell/status-line";
import { TopBar } from "@/components/shell/top-bar";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useShell } from "@/lib/state/shell";

function GlobalHotkeys() {
  const router = useRouter();
  const togglePalette = useShell((state) => state.togglePalette);
  const setShortcutsOpen = useShell((state) => state.setShortcutsOpen);

  useHotkeys(
    {
      "$mod+k": (event) => {
        event.preventDefault();
        togglePalette();
      },
    },
    { singleKey: false },
  );

  useHotkeys({
    "Shift+?": () => setShortcutsOpen(true),
    "g j": () => router.push(routes.jobs()),
    "g e": () => router.push(routes.explore()),
  });

  return null;
}

/**
 * Application frame: top bar, one scrollable or fixed main region, and in Advanced the status line.
 * The viewport never scrolls as a whole; pages scroll inside `main`, and the workspace frame fills
 * it exactly.
 */
export function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const advanced = useAdvancedMode();
  return (
    <div className="isolate flex h-dvh min-h-0 flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-1 focus-visible:left-1 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="z-40 flex shrink-0 items-stretch bg-sunken">
        <div className="min-w-0 flex-1">
          <TopBar />
        </div>
        {advanced ? (
          <div className="flex h-10 shrink-0 items-center border-b border-border pr-2">
            <AssistantTrigger />
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <main
          id="main"
          tabIndex={-1}
          className="scroll-thin relative min-h-0 min-w-0 flex-1 overflow-auto outline-none"
        >
          {children}
        </main>
        <AssistantDock />
      </div>
      <StatusLine />
      <CommandPalette />
      <ShortcutSheet />
      <GlobalHotkeys />
    </div>
  );
}
