"use client";

import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { KeyHint } from "@/components/data/key-hint";
import { TextLink } from "@/components/data/text-link";
import {
  parsePaletteInput,
  unresolvedParsedRows,
} from "@/components/search/parse-input";
import {
  SearchResultRow,
  openAtSource,
  openSearchResult,
  resultValue,
} from "@/components/search/result-row";
import { useEntitySearch } from "@/components/search/use-entity-search";
import { SEARCH_PLACEHOLDER } from "@/components/shell/search-trigger";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { isApiError } from "@/lib/api/client";
import { routes } from "@/lib/ids";

const LIST_ID = "home-search-results";

/**
 * The home page's one action: a search field whose typed results appear inline. Arrow keys move,
 * Enter opens, Mod+Enter opens the record at its source, Esc clears.
 */
export function HomeSearch({
  className,
  initialQuery = "",
}: {
  className?: string;
  /** `/?q=BTK` opens with the search already typed, so a search can be linked to */
  initialQuery?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<{ scope: string; value: string } | null>(
    null,
  );

  const text = query.trim();
  const search = useEntitySearch(text, { limit: 5 });
  const groups = useMemo(() => search.shown?.groups ?? [], [search.shown]);
  const parsed = useMemo(
    () => unresolvedParsedRows(parsePaletteInput(text), search.answer),
    [text, search.answer],
  );

  useEffect(() => {
    // On touch the keyboard stays down until the field is tapped
    if (initialQuery || window.matchMedia("(pointer: fine)").matches)
      inputRef.current?.focus();
  }, [initialQuery]);

  const results = groups.flatMap((group) => group.results);
  const firstValue = parsed[0]
    ? `parsed:${parsed[0].id}`
    : results[0]
      ? resultValue(results[0])
      : "";
  // The highlight returns to the first row whenever the text or the answer changes
  const scope = `${text}\n${search.shown?.query ?? ""}`;
  const selected = picked?.scope === scope ? picked.value : firstValue;

  const open = focused && text.length > 0;
  const failed = search.error;
  const nothing =
    search.answer !== null && results.length === 0 && parsed.length === 0;
  const unanswered = (search.answer?.sources ?? []).filter(
    (source) => source.state === "unavailable",
  );

  function navigate(href: string) {
    router.push(href);
  }

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      vimBindings={false}
      label="Search"
      value={selected}
      onValueChange={(value) => setPicked({ scope, value })}
      className={className}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (query) setQuery("");
          else inputRef.current?.blur();
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          const result = results.find((row) => resultValue(row) === selected);
          if (result?.external_url) {
            event.preventDefault();
            openAtSource(result);
          }
        }
      }}
    >
      <div className="relative">
        <div className="flex h-12 items-center gap-3 rounded-lg border border-input bg-background px-4 hover:border-foreground has-focus-visible:border-foreground">
          <SearchIcon
            className="size-4.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={SEARCH_PLACEHOLDER}
            aria-controls={LIST_ID}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-hidden placeholder:text-subtle-foreground"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          ) : (
            <KeyHint keys="mod+k" className="hidden shrink-0 sm:inline-flex" />
          )}
        </div>

        <div
          hidden={!open}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border-strong bg-popover text-popover-foreground shadow-lg"
        >
          <CommandPrimitive.List
            id={LIST_ID}
            className="max-h-[min(26rem,55dvh)] scroll-py-1 overflow-x-hidden overflow-y-auto outline-none"
          >
            {parsed.length > 0 ? (
              <CommandGroup heading="Parsed input">
                {parsed.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`parsed:${entry.id}`}
                    onSelect={() => navigate(entry.href)}
                    className="min-h-8"
                  >
                    <CornerDownLeftIcon className="text-muted-foreground" />
                    <span className="text-sm font-medium" translate="no">
                      {entry.label}
                    </span>
                    <span
                      data-slot="command-shortcut"
                      className="ml-auto truncate text-2xs text-subtle-foreground"
                    >
                      {entry.detail}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {groups.map((group) => (
              <CommandGroup
                key={group.type}
                heading={
                  group.total > group.results.length
                    ? `${group.label} · ${group.results.length} of ${group.total}`
                    : group.label
                }
              >
                {group.results.map((result) => (
                  <CommandItem
                    key={resultValue(result)}
                    value={resultValue(result)}
                    onSelect={() => openSearchResult(result, navigate)}
                    className="min-h-8"
                  >
                    <SearchResultRow result={result} size="roomy" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {nothing ? (
              <div className="px-3.5 py-3 text-xs text-muted-foreground">
                <p className="text-foreground">
                  No source found for &ldquo;{text}&rdquo;.
                </p>
                <p className="mt-1">
                  Searched: the IEI catalog (names, aliases, symbols and
                  cross-references)
                  {(search.answer?.sources.length ?? 0) > 1
                    ? ` and ${search.answer?.sources
                        .slice(1)
                        .map((source) => source.name ?? source.source)
                        .join(", ")}`
                    : ""}
                  .{" "}
                  <TextLink href={routes.explore()}>
                    Browse immune disorders and genes
                  </TextLink>
                </p>
              </div>
            ) : null}

            {failed ? (
              <div className="px-3.5 py-3 text-xs text-muted-foreground">
                <p className="text-foreground">
                  {isApiError(failed) && failed.isUnreachable
                    ? "The OrphaFold API did not answer, so names and aliases cannot be resolved."
                    : `Search failed: ${failed.message}`}
                </p>
                <button
                  type="button"
                  onClick={() => search.retry()}
                  className="mt-1 underline decoration-border-strong underline-offset-[3px] hover:text-foreground"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </CommandPrimitive.List>

          <div className="flex h-7 items-center gap-4 border-t border-border-subtle bg-sunken px-3">
            <KeyHint keys="enter" label="Open" />
            <span className="hidden items-center gap-4 sm:flex">
              <KeyHint keys="mod+enter" label="Open at source" />
              <span className="inline-flex items-center">
                <KeyHint keys="up" />
                <KeyHint keys="down" label="Move" />
              </span>
            </span>
            <span className="ml-auto truncate text-2xs text-subtle-foreground">
              {search.pending
                ? "Searching the catalog"
                : unanswered.length > 0
                  ? `${unanswered.map((source) => source.name ?? source.source).join(", ")} did not answer`
                  : search.answer?.outside_catalog
                    ? "Outside the IEI catalog"
                    : null}
            </span>
            <KeyHint
              keys="esc"
              label="Clear"
              className="hidden sm:inline-flex"
            />
          </div>
        </div>
      </div>
    </CommandPrimitive>
  );
}
