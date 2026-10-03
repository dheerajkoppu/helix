"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";

import { SearchTrigger } from "@/components/shell/search-trigger";
import {
  AdvancedToggle,
  LearnModeToggle,
  ThemeToggle,
} from "@/components/shell/toggles";
import { Wordmark } from "@/components/shell/wordmark";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PRIMARY_NAV, site, type NavItem } from "@/lib/site";
import { useShell } from "@/lib/state/shell";

const isCurrent = (item: NavItem, pathname: string) =>
  item.match.some((prefix) => pathname.startsWith(prefix));

/** Running-jobs slot. The jobs feature publishes counts through `useShell().setJobs`. */
function JobsCount() {
  const jobs = useShell((state) => state.jobs);
  if (!jobs || jobs.running + jobs.queued === 0) return null;
  return (
    <span
      className="tabular ml-1.5 inline-flex h-4 items-center gap-1 rounded-xs border border-border-strong px-1 font-mono text-[0.625rem] text-foreground"
      aria-label={`${jobs.running} running, ${jobs.queued} queued`}
    >
      <span
        aria-hidden
        className="size-1.5 animate-pulse rounded-full bg-foreground"
      />
      {jobs.running + jobs.queued}
    </span>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z" />
    </svg>
  );
}

function SourceLink({ withLabel = false }: { withLabel?: boolean }) {
  const external = Boolean(site.repositoryUrl);
  const label = external ? "Source on GitHub" : "Open source";
  const classes = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
    withLabel ? "px-2" : "w-7 justify-center",
  );
  const content = (
    <>
      <GitHubMark className="size-3.5" />
      {withLabel ? (
        <span>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </>
  );
  const link = external ? (
    <a
      href={site.repositoryUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={classes}
    >
      {content}
    </a>
  ) : (
    <Link href="/about#open-source" className={classes}>
      {content}
    </Link>
  );
  if (withLabel) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="bottom">
        {label} · {site.license}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The only global navigation. 40px, monochrome. There is no sidebar anywhere in the product.
 * Phones keep the wordmark, search and a menu sheet.
 */
export function TopBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="z-40 flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sunken px-3">
      <Wordmark />

      <nav
        aria-label="Primary"
        className="ml-2 hidden h-full items-stretch md:flex"
      >
        {PRIMARY_NAV.map((item) => {
          const current = isCurrent(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "relative inline-flex items-center px-2.5 text-xs",
                current
                  ? "font-medium text-foreground after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {item.href === "/jobs" ? <JobsCount /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <SearchTrigger className="max-w-md" />
      </div>

      <div className="ml-auto hidden items-center gap-0.5 md:flex">
        <LearnModeToggle />
        <AdvancedToggle />
        <span aria-hidden className="mx-1.5 h-4 w-px bg-border" />
        <ThemeToggle />
        <SourceLink />
      </div>

      <div className="ml-auto flex items-center gap-0.5 md:hidden">
        <SearchTrigger variant="icon" />
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            aria-label="Menu"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MenuIcon className="size-4" aria-hidden />
          </SheetTrigger>
          <SheetContent side="right" className="w-72 gap-0 p-0">
            <SheetHeader className="border-b border-border-subtle px-4 py-3">
              <SheetTitle>{site.name}</SheetTitle>
              <SheetDescription>{site.tagline}</SheetDescription>
            </SheetHeader>
            <nav aria-label="Primary" className="flex flex-col py-1">
              {PRIMARY_NAV.map((item) => {
                const current = isCurrent(item, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex h-11 items-center px-4 text-sm",
                      current
                        ? "bg-active font-medium shadow-[inset_2px_0_0_var(--foreground)]"
                        : "hover:bg-accent",
                    )}
                  >
                    {item.label}
                    {item.href === "/jobs" ? <JobsCount /> : null}
                  </Link>
                );
              })}
              <Link
                href="/about"
                onClick={() => setMenuOpen(false)}
                className="flex h-11 items-center px-4 text-sm hover:bg-accent"
              >
                About
              </Link>
            </nav>
            <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border-subtle px-3 py-3">
              <LearnModeToggle />
              <AdvancedToggle />
              <ThemeToggle />
              <SourceLink withLabel />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
