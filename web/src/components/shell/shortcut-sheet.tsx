"use client";

import { KeyHint } from "@/components/data/key-hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SHORTCUTS } from "@/lib/shortcuts";
import { usePreferences } from "@/lib/state/preferences";
import { useShell } from "@/lib/state/shell";

export function ShortcutSheet() {
  const open = useShell((state) => state.shortcutsOpen);
  const setOpen = useShell((state) => state.setShortcutsOpen);
  const singleKeys = usePreferences((state) => state.singleKeyShortcuts);
  const setSingleKeys = usePreferences((state) => state.setSingleKeyShortcuts);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border-subtle px-4 py-3">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys never fire while you are typing in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60dvh] gap-x-8 gap-y-4 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3 className="flex items-baseline justify-between border-b border-border-subtle pb-1 text-2xs font-medium tracking-[0.04em] text-foreground uppercase">
                {group.title}
                <span className="font-normal tracking-normal text-subtle-foreground normal-case">
                  {group.scope}
                </span>
              </h3>
              <ul>
                {group.entries.map((entry) => (
                  <li
                    key={entry.keys}
                    className="flex h-7 items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-foreground">{entry.label}</span>
                    <KeyHint keys={entry.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <label className="flex items-center justify-between gap-4 border-t border-border-subtle bg-sunken px-4 py-2.5 text-xs">
          <span>
            <span className="font-medium text-foreground">
              Single-key shortcuts
            </span>
            <span className="ml-2 text-muted-foreground">
              Turn off to keep only shortcuts that use a modifier key.
            </span>
          </span>
          <Switch checked={singleKeys} onCheckedChange={setSingleKeys} />
        </label>
      </DialogContent>
    </Dialog>
  );
}
