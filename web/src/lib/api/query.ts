import { QueryClient, queryOptions } from "@tanstack/react-query";

import { apiRequest, isApiError, type QueryParams } from "@/lib/api/client";
import type { ApiGetPath, ApiGetResponse, ApiResult } from "@/lib/api/types";

/**
 * Conventions
 * - Query keys are `["api", path, query]`. Build them with `apiQuery` so invalidation stays uniform.
 * - Public metadata is stable: 5 minutes fresh, 30 minutes retained. Job state overrides this with
 *   `refetchInterval` at the call site.
 * - A 4xx is an answer, not a failure to retry. Only an unreachable API or a 5xx retries, twice.
 * - Queries return `ApiResult<Data>`, so every consumer has `result.sources` for SourceStatusList.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export const apiQueryKey = (path: string, query?: QueryParams) =>
  ["api", path, query ?? {}] as const;

/** The named model when one is given, else the generated response type of a literal route. */
type QueryData<Data, Path extends string> = [Data] extends [never]
  ? Path extends ApiGetPath
    ? ApiGetResponse<Path>
    : unknown
  : Data;

/**
 * `useQuery(apiQuery("/explore/genes", { q }))` returns `{ data: { data, sources, status, requestId } }`.
 * A route written literally is typed from the generated schema. For a path built at run time, name
 * the model: `useQuery({ ...apiQuery<Schema<"JobOut">>(`/jobs/${id}`), refetchInterval: 2000 })`.
 */
export function apiQuery<Data = never, Path extends string = string>(
  path: Path,
  query?: QueryParams,
) {
  return queryOptions<ApiResult<QueryData<Data, Path>>>({
    queryKey: apiQueryKey(path, query),
    queryFn: ({ signal }) =>
      apiRequest<QueryData<Data, Path>>(path, { query, signal }),
  });
}
