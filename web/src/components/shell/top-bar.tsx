"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "cn";

import { KeyHint } from "@/components/data/key-hint";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { ApiDot } from "@/components/shell/status-line";
import { Wordmark } from "@/components/shell/wordmark";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHydrated } from "@/hooks/use-hydrated";
import { PRIMARY_NAV, SECONDARY_NAV, site, type NavItem } from "@/lib/site";
import { useAssistant } from "@/lib/state/assistant";
import { usePreferences } from "@/lib/state/preferences";
import { useShell } from "@/lib/state/shell";

const isCurrent = (item: NavItem, pathname: string) =>
  item.match.some((prefix) => pathname.startsWith(prefix));

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const ITEM_CLASS = "max-md:min-h-10 max-md:text-sm";

/** Running and queued jobs. The jobs feature publishes counts through `useShell().setJobs`. */
function useActiveJobs(): number {
  const jobs = useShell((state) => state.jobs);
  return jobs ? jobs.running + jobs.queued : 0;
}

function JobsCount({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "tabular inline-flex h-4 items-center gap-1 rounded-xs border border-border-strong px-1 font-mono text-[0.625rem] text-foreground",
        className,
      )}
      aria-label={`${count} running or queued`}
    >
      <span
        aria-hidden
        className="size-1.5 animate-pulse rounded-full bg-foreground"
      />
      {count}
    </span>
  );
}

/** Everything that is not one of the three destinations: one menu, the same on every screen size. */
function OverflowMenu({ pathname }: { pathname: string }) {
  const activeJobs = useActiveJobs();
  const learnMode = usePreferences((state) => state.learnMode);
  const setLearnMode = usePreferences((state) => state.setLearnMode);
  const advanced = usePreferences((state) => state.advanced);
  const setAdvanced = usePreferences((state) => state.setAdvanced);
  const setShortcutsOpen = useShell((state) => state.setShortcutsOpen);
  const setAssistantOpen = useAssistant((state) => state.setOpen);
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const sourceHref = site.repositoryUrl ?? "/about#open-source";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More"
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-active aria-expanded:text-foreground max-md:h-8 max-md:px-2"
      >
        <JobsCount count={activeJobs} />
        <EllipsisIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup className="md:hidden">
          {PRIMARY_NAV.map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              aria-current={isCurrent(item, pathname) ? "page" : undefined}
              className={cn(ITEM_CLASS, "aria-[current=page]:font-medium")}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </DropdownMenuGroup>

        {SECONDARY_NAV.map((item) => (
          <DropdownMenuItem
            key={item.href}
            render={<Link href={item.href} />}
            aria-current={isCurrent(item, pathname) ? "page" : undefined}
            className={cn(ITEM_CLASS, "aria-[current=page]:font-medium")}
          >
            {item.label}
            {item.href === "/jobs" ? (
              <JobsCount count={activeJobs} className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={ITEM_CLASS}
          onClick={() => setAssistantOpen(true)}
        >
          Ask Orpha
          <KeyHint keys="mod+j" className="ml-auto max-md:hidden" />
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(ITEM_CLASS, "max-md:hidden")}
          onClick={() => setShortcutsOpen(true)}
        >
          Shortcuts
          <KeyHint keys="?" className="ml-auto" />
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          className={ITEM_CLASS}
          checked={advanced}
          onCheckedChange={setAdvanced}
        >
          Advanced
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          className={ITEM_CLASS}
          checked={learnMode}
          onCheckedChange={setLearnMode}
        >
          Learn mode
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={hydrated ? theme : "system"}
            onValueChange={(value) => setTheme(String(value))}
          >
            {THEMES.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className={ITEM_CLASS}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={ITEM_CLASS}
          render={
            site.repositoryUrl ? (
              <a href={sourceHref} target="_blank" rel="noopener noreferrer" />
            ) : (
              <Link href={sourceHref} />
            )
          }
        >
          Source
          <span className="ml-auto font-mono text-2xs text-subtle-foreground">
            {site.license}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The only global navigation. 40px, monochrome: wordmark, three destinations, search, an API dot
 * and one menu for everything else. There is no sidebar anywhere in the product.
 */
export function TopBar() {
  const pathname = usePathname();
  const advanced = usePreferences((state) => state.advanced);

  return (
    <header className="z-40 flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sunken px-3 xl:grid xl:grid-cols-[1fr_minmax(0,28rem)_1fr]">
      <div className="flex h-full min-w-0 items-center gap-3">
        <Wordmark />
        <nav
          aria-label="Primary"
          className="ml-3 hidden h-full items-stretch gap-1 md:flex"
        >
        {PRIMARY_NAV.map((item) => {
          const current = isCurrent(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "relative inline-flex items-center px-2.5 text-sm",
                current
                  ? "font-medium text-foreground after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        </nav>
      </div>

      <SearchTrigger className="min-w-0 flex-1 max-md:hidden md:mx-auto md:max-w-md xl:max-w-none" />

      <div className="ml-auto flex shrink-0 items-center justify-end gap-0.5">
        <SearchTrigger variant="icon" className="md:hidden" />
        {advanced ? null : <ApiDot />}
        <OverflowMenu pathname={pathname} />
      </div>
    </header>
  );
}
