import type { components, paths } from "@/lib/api/schema";

/**
 * `Schema<"JobOut">` is the backend model of that name, generated from `api/openapi.json` into
 * `schema.ts` by `make types`. A model used in both a request and a response is split by the
 * backend into `Name-Input` and `Name-Output`.
 */
export type Schema<Name extends keyof components["schemas"]> =
  components["schemas"][Name];

type ApiPathPrefix = "/api/v1";

type JsonBody<Operation> = Operation extends {
  responses: { 200: { content: { "application/json": infer Body } } };
}
  ? Body
  : never;

/** GET routes with a JSON answer, written the way the client takes them: "/explore/genes". */
export type ApiGetPath = {
  [Path in keyof paths]: Path extends `${ApiPathPrefix}${infer Rest}`
    ? paths[Path] extends { get: infer Operation }
      ? [JsonBody<Operation>] extends [never]
        ? never
        : Rest
      : never
    : never;
}[keyof paths];

/** Response body of a GET route: `ApiGetResponse<"/explore/genes">`. */
export type ApiGetResponse<Path extends ApiGetPath> =
  `${ApiPathPrefix}${Path}` extends infer Full extends keyof paths
    ? paths[Full] extends { get: infer Operation }
      ? JsonBody<Operation>
      : never
    : never;

/** Query parameters of a GET route: `ApiGetQuery<"/explore/genes">`. */
export type ApiGetQuery<Path extends ApiGetPath> =
  `${ApiPathPrefix}${Path}` extends infer Full extends keyof paths
    ? paths[Full] extends { get: { parameters: { query?: infer Query } } }
      ? NonNullable<Query>
      : never
    : never;

export const SOURCE_STATUS_STATES = [
  "ok",
  "empty",
  "unavailable",
  "disabled_by_license",
  "not_configured",
] as const satisfies readonly Schema<"SourceState">[];

export type SourceStatusState = Schema<"SourceState">;

type BackendSourceStatus = Schema<"SourceStatus">;

/**
 * How one upstream source answered for the current response. A page renders whatever answered and
 * says which source did not. Field names are the backend's (`name`, `from_cache`, `stale`); only
 * `source` and `state` are required so that a row can also be built in the browser.
 */
export type SourceStatus = Pick<BackendSourceStatus, "source" | "state"> &
  Partial<Omit<BackendSourceStatus, "source" | "state">>;

/** Body of every non-2xx answer (RFC 9457 problem JSON with a machine-readable `code`). */
export type ApiProblem = Schema<"ProblemDetail">;

export interface ApiErrorBody {
  code: string;
  message: string;
  detail?: unknown;
  request_id?: string | null;
  problem?: ApiProblem | null;
}

export interface ApiResult<Data> {
  data: Data;
  /** per-source status reported with this response; empty when the endpoint reports none */
  sources: SourceStatus[];
  status: number;
  requestId: string | null;
}
