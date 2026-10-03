"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type {
  SearchResponse,
  SearchResultType,
} from "@/components/search/types";
import { apiQuery } from "@/lib/api/query";

export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface EntitySearchOptions {
  /** omit for every catalog type; compound and paper text search runs only when named */
  types?: SearchResultType[];
  /** rows per group */
  limit?: number;
  enabled?: boolean;
  debounceMs?: number;
  minLength?: number;
}

/**
 * GET /search for what is being typed. Debounced, stale requests are cancelled, and the previous
 * answer stays on screen until the next one arrives. `answer` is null unless it belongs to the
 * current text.
 */
export function useEntitySearch(
  text: string,
  {
    types,
    limit = 6,
    enabled = true,
    debounceMs = 150,
    minLength = 1,
  }: EntitySearchOptions = {},
) {
  const trimmed = text.trim();
  const debounced = useDebouncedValue(trimmed, debounceMs);
  const active = enabled && debounced.length >= minLength;
  const query = useQuery({
    ...apiQuery<SearchResponse>("/search", {
      q: debounced,
      types: types?.join(","),
      limit,
    }),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  const shown = active && trimmed.length >= minLength ? query.data?.data : null;
  const settled = debounced === trimmed && !query.isPlaceholderData;
  return {
    /** the latest answer on screen; may still be the previous text's while typing */
    shown: shown ?? null,
    /** the answer for exactly the current text, else null */
    answer: shown && settled ? shown : null,
    pending:
      enabled &&
      trimmed.length >= minLength &&
      (!settled || query.isFetching) &&
      !query.isError,
    error: active && settled && query.isError ? query.error : null,
    retry: query.refetch,
  };
}
