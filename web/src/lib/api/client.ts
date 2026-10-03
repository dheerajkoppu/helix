import {
  SOURCE_STATUS_STATES,
  type ApiErrorBody,
  type ApiProblem,
  type ApiResult,
  type SourceStatus,
  type SourceStatusState,
} from "@/lib/api/types";
import { WORKSPACE_HEADER, getWorkspaceId } from "@/lib/workspace-identity";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");
export const API_PREFIX = "/api/v1";

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: QueryParams;
  /** serialised as JSON unless it is FormData */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** One error type for every failed call. `status` is 0 when the API could not be reached. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;
  readonly requestId: string | null;
  readonly sources: SourceStatus[];
  /** the problem JSON document, when the API sent one: `errors`, `source`, `setting` live here */
  readonly problem: ApiProblem | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    detail?: unknown;
    requestId?: string | null;
    sources?: SourceStatus[];
    problem?: ApiProblem | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.requestId = init.requestId ?? null;
    this.sources = init.sources ?? [];
    this.problem = init.problem ?? null;
  }

  /** the API process itself did not answer */
  get isUnreachable(): boolean {
    return this.status === 0;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Absolute URL for a path under /api/v1. Accepts "/genes/BTK" or "genes/BTK". */
export function apiUrl(path: string, query?: QueryParams): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${API_PREFIX}${normalized}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined && item !== "")
        url.searchParams.append(key, String(item));
    }
  }
  return url.toString();
}

type LooseRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is LooseRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSourceState = (value: unknown): value is SourceStatusState =>
  typeof value === "string" &&
  (SOURCE_STATUS_STATES as readonly string[]).includes(value);

function toSourceStatus(raw: unknown): SourceStatus | null {
  if (!isRecord(raw)) return null;
  const source = raw.source ?? raw.id;
  if (typeof source !== "string" || !isSourceState(raw.state)) return null;
  const optional = (key: string) =>
    typeof raw[key] === "string" ? (raw[key] as string) : null;
  return {
    source,
    state: raw.state,
    name: optional("name") ?? source,
    release: optional("release"),
    retrieved_at: optional("retrieved_at"),
    message: optional("message"),
    license: optional("license"),
    url: optional("url"),
    from_cache: raw.from_cache === true,
    stale: raw.stale === true,
    elapsed_ms: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : null,
  };
}

/**
 * Reads per-source status from a response body. The backend reports it as a top-level `sources`
 * array; `source_status` and `meta.sources` are accepted as well.
 */
export function extractSourceStatus(body: unknown): SourceStatus[] {
  if (!isRecord(body)) return [];
  const meta = isRecord(body.meta) ? body.meta : null;
  const candidate = body.sources ?? body.source_status ?? meta?.sources;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map(toSourceStatus)
    .filter((entry): entry is SourceStatus => entry !== null);
}

function describeValidationDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const messages = detail
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.msg !== "string") return null;
      const location = Array.isArray(entry.loc)
        ? entry.loc.filter((part) => part !== "body").join(".")
        : "";
      return location ? `${location}: ${entry.msg}` : entry.msg;
    })
    .filter((message): message is string => message !== null);
  return messages.length ? messages.join("; ") : null;
}

const isProblem = (body: LooseRecord): body is ApiProblem =>
  typeof body.code === "string" &&
  typeof body.title === "string" &&
  typeof body.status === "number";

function describeFieldProblems(problem: ApiProblem): string | null {
  const messages = (problem.errors ?? []).map((entry) => {
    const location = entry.location
      .filter((part) => part !== "body" && part !== "query" && part !== "path")
      .join(".");
    return location ? `${location}: ${entry.message}` : entry.message;
  });
  return messages.length ? messages.join("; ") : null;
}

/**
 * Understands the API's problem JSON (RFC 9457 with `code`), and falls back to an `error` envelope
 * or FastAPI's plain `detail` for answers that did not come from an Helix handler.
 */
function parseErrorBody(status: number, body: unknown): ApiErrorBody {
  const fallback: ApiErrorBody = {
    code: `http_${status}`,
    message: `The API returned HTTP ${status}.`,
  };
  if (!isRecord(body)) return fallback;
  if (isProblem(body)) {
    return {
      code: body.code,
      message: describeFieldProblems(body) ?? body.detail ?? body.title,
      detail: body.detail ?? null,
      problem: body,
    };
  }
  if (isRecord(body.error)) {
    const error = body.error;
    return {
      code: typeof error.code === "string" ? error.code : fallback.code,
      message:
        typeof error.message === "string" ? error.message : fallback.message,
      detail: error.detail,
      request_id:
        typeof error.request_id === "string" ? error.request_id : null,
    };
  }
  if ("detail" in body) {
    return {
      code: typeof body.type === "string" ? body.type : fallback.code,
      message:
        describeValidationDetail(body.detail) ??
        (typeof body.title === "string" ? body.title : fallback.message),
      detail: body.detail,
    };
  }
  if (typeof body.message === "string")
    return { ...fallback, message: body.message };
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) return response.json().catch(() => null);
  return response.text().catch(() => null);
}

/** Calls the API and returns the body together with the per-source status it reported. */
export async function apiRequest<Data>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<Data>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const workspaceId = getWorkspaceId();
  if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw cause;
    throw new ApiError({
      status: 0,
      code: "api_unreachable",
      message: `The Helix API at ${API_BASE_URL} did not answer.`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const requestId = response.headers.get("x-request-id");
  const parsed = await readBody(response);

  if (!response.ok) {
    const error = parseErrorBody(response.status, parsed);
    throw new ApiError({
      status: response.status,
      code: error.code,
      message: error.message,
      detail: error.detail,
      requestId: error.request_id ?? requestId,
      sources: extractSourceStatus(parsed),
      problem: error.problem,
    });
  }

  return {
    data: parsed as Data,
    sources: extractSourceStatus(parsed),
    status: response.status,
    requestId,
  };
}

/** Calls the API and returns only the body. Use `apiRequest` when the page shows source status. */
export async function apiFetch<Data>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Data> {
  return (await apiRequest<Data>(path, options)).data;
}

/** URL for a stored artifact or export, for `<a href>` and viewer loads. */
export function apiDownloadUrl(path: string, query?: QueryParams): string {
  return apiUrl(path, query);
}
