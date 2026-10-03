"""Source adapter base.

Every upstream database is reached through a SourceAdapter subclass. The base class gives each
adapter: one shared async HTTP client, a per-source rate limiter, timeout, retry with backoff,
a database-backed response cache with TTL, normalised outcomes and a provenance envelope.

Adapter methods return SourceResult and never raise for upstream failures, so an aggregated page
still renders when one source is down. gather_sources runs several calls concurrently and returns
partial results plus one SourceStatus row per source.
"""

import asyncio
import json
import random
import time
import zlib
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any, ClassVar, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from sqlalchemy import delete

from orphafold.config import Settings, get_settings
from orphafold.db.models import HttpCacheEntry
from orphafold.db.session import session_scope
from orphafold.errors import ApiError, DisabledByLicense, NotConfigured, SourceUnavailable
from orphafold.hashing import sha256_hex
from orphafold.ids import utcnow
from orphafold.log import get_logger
from orphafold.schemas.common import Provenance, SourceState, SourceStatus

logger = get_logger(__name__)

ParseMode = Literal["json", "text", "bytes"]

MAX_CACHED_BODY_BYTES = 32 * 1024 * 1024
MAX_RETRY_AFTER_SECONDS = 10.0
STALE_RETENTION = timedelta(days=30)


@dataclass(slots=True)
class SourceResult[T]:
    """Outcome of one source call: ok (data), empty (source answered, nothing there),
    unavailable (source did not answer usefully), disabled_by_license or not_configured."""

    source: str
    name: str
    state: SourceState
    data: T | None = None
    provenance: Provenance | None = None
    message: str | None = None
    status_code: int | None = None
    elapsed_ms: float | None = None
    license: str | None = None
    homepage: str | None = None

    @property
    def ok(self) -> bool:
        return self.state is SourceState.OK

    @property
    def is_empty(self) -> bool:
        return self.state is SourceState.EMPTY

    @property
    def answered(self) -> bool:
        """The source responded: either with data or with a definite 'nothing here'."""
        return self.state in (SourceState.OK, SourceState.EMPTY)

    def status(self) -> SourceStatus:
        provenance = self.provenance
        return SourceStatus(
            source=self.source,
            name=self.name,
            state=self.state,
            message=self.message,
            release=provenance.release if provenance else None,
            retrieved_at=provenance.retrieved_at if provenance else None,
            license=self.license,
            url=self.homepage,
            from_cache=provenance.from_cache if provenance else False,
            stale=provenance.stale if provenance else False,
            elapsed_ms=self.elapsed_ms,
        )

    def map[U](self, transform: Callable[[T], U], *, empty_when_falsy: bool = True) -> SourceResult[U]:
        """Parse the payload. A transform that raises marks the source unavailable (unexpected
        response shape); a transform that returns nothing marks it empty."""
        if not self.ok or self.data is None:
            return replace(self, data=None)  # type: ignore[arg-type]
        try:
            parsed = transform(self.data)
        except Exception:
            logger.exception("Unexpected response shape from %s", self.source)
            return replace(
                self,  # type: ignore[arg-type]
                state=SourceState.UNAVAILABLE,
                data=None,
                message=f"{self.name} returned a response OrphaFold could not read.",
            )
        if parsed is None or (empty_when_falsy and isinstance(parsed, list | dict | str) and not parsed):
            return replace(self, state=SourceState.EMPTY, data=parsed)  # type: ignore[arg-type]
        return replace(self, data=parsed)  # type: ignore[arg-type]

    def with_record(self, record_id: str, record_url: str | None = None) -> SourceResult[T]:
        """Set the record ID on the provenance once it is known from the payload."""
        if self.provenance is None:
            return self
        update = {"record_id": record_id}
        if record_url is not None:
            update["record_url"] = record_url
        return replace(self, provenance=self.provenance.model_copy(update=update))

    def unwrap(self) -> T | None:
        """Return the data, or raise the matching API error when the source did not answer."""
        if self.state is SourceState.UNAVAILABLE:
            raise SourceUnavailable(self.name, self.message)
        if self.state is SourceState.NOT_CONFIGURED:
            raise NotConfigured(self.name, self.message)
        if self.state is SourceState.DISABLED_BY_LICENSE:
            raise DisabledByLicense(self.name, self.message)
        return self.data


@dataclass(slots=True)
class _Fetched:
    state: SourceState
    body: bytes = b""
    status_code: int | None = None
    content_type: str | None = None
    release: str | None = None
    message: str | None = None
    fetched_at: datetime = field(default_factory=utcnow)
    from_cache: bool = False
    stale: bool = False
    elapsed_ms: float | None = None


class _Throttle:
    def __init__(self, rate_per_second: float | None, max_concurrency: int) -> None:
        self.interval = 1.0 / rate_per_second if rate_per_second else 0.0
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.lock = asyncio.Lock()
        self.next_at = 0.0

    async def wait_turn(self) -> None:
        if not self.interval:
            return
        async with self.lock:
            now = time.monotonic()
            delay = self.next_at - now
            self.next_at = max(now, self.next_at) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


class _LoopState:
    """HTTP client, throttles and in-flight requests bound to one event loop."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        settings = get_settings()
        self.loop = loop
        self.client = httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": settings.user_agent},
            limits=httpx.Limits(max_connections=60, max_keepalive_connections=20),
            timeout=httpx.Timeout(settings.source_timeout_default),
        )
        self.throttles: dict[str, _Throttle] = {}
        self.inflight: dict[str, asyncio.Task[_Fetched]] = {}


_loop_states: dict[int, _LoopState] = {}


def _loop_state() -> _LoopState:
    loop = asyncio.get_running_loop()
    state = _loop_states.get(id(loop))
    if state is None or state.loop is not loop or state.client.is_closed:
        state = _LoopState(loop)
        _loop_states[id(loop)] = state
    return state


def get_http_client() -> httpx.AsyncClient:
    """Shared client for code that must stream or post outside the adapter helpers."""
    return _loop_state().client


async def close_http_clients() -> None:
    for state in list(_loop_states.values()):
        if not state.client.is_closed and not state.loop.is_closed():
            try:
                await state.client.aclose()
            except RuntimeError:
                pass
    _loop_states.clear()


_registry: dict[str, SourceAdapter] = {}


def get_source(source_id: str) -> SourceAdapter | None:
    return _registry.get(source_id)


def all_sources() -> list[SourceAdapter]:
    return sorted(_registry.values(), key=lambda adapter: adapter.id)


def load_sources() -> None:
    """Import every adapter module so that the registry and /meta list all of them."""
    from orphafold.plugins import import_submodules

    import_submodules("orphafold.sources")


class SourceAdapter:
    """Base class for an upstream database. Subclass, set the class attributes, add typed methods
    that call get_json / post_json / graphql / get_text / get_bytes, and instantiate once at module
    level (the instance registers itself)."""

    id: ClassVar[str]
    name: ClassVar[str]
    base_url: ClassVar[str]
    homepage: ClassVar[str | None] = None
    license: ClassVar[str | None] = None
    license_url: ClassVar[str | None] = None
    attribution: ClassVar[str | None] = None

    # Restricted to non-commercial use: gated behind ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES
    noncommercial_only: ClassVar[bool] = False

    timeout: ClassVar[float | None] = None
    rate_limit_per_second: ClassVar[float | None] = None
    max_concurrency: ClassVar[int] = 4
    max_retries: ClassVar[int | None] = None
    retry_statuses: ClassVar[frozenset[int]] = frozenset({429, 502, 503, 504})

    # 204 always means "no results". Add 404 for sources that answer 404 for an unknown record.
    empty_statuses: ClassVar[frozenset[int]] = frozenset({204})

    cache_ttl: ClassVar[int] = 24 * 3600
    empty_cache_ttl: ClassVar[int] = 6 * 3600

    release: ClassVar[str | None] = None
    release_header: ClassVar[str | None] = None
    default_headers: ClassVar[Mapping[str, str]] = {"Accept": "application/json"}
    secret_params: ClassVar[frozenset[str]] = frozenset({"api_key", "api-key", "apikey", "key", "token"})

    def __init__(self) -> None:
        existing = _registry.get(self.id)
        if existing is not None and type(existing) is not type(self):
            logger.warning(
                "Source id %s registered twice: %s replaces %s", self.id, type(self), type(existing)
            )
        _registry[self.id] = self

    @property
    def settings(self) -> Settings:
        return get_settings()

    # Hooks

    def configured(self) -> str | None:
        """Return a human-readable reason when the adapter cannot run without configuration."""
        return None

    def default_params(self) -> dict[str, Any]:
        """Query parameters added to every request (API key, tool name, contact email)."""
        return {}

    def payload_error(self, payload: Any) -> str | None:
        """Return a message when a 2xx payload is really an error (errors[], errCode, errorlist)."""
        return None

    def is_empty(self, payload: Any) -> bool:
        """Whether a 2xx payload means 'nothing found'."""
        return payload is None or payload == [] or payload == {} or payload == "" or payload == b""

    def extract_release(self, headers: Mapping[str, str], payload: Any) -> str | None:
        """Source release for the provenance envelope. Default: the release_header, then release."""
        if self.release_header:
            value = headers.get(self.release_header)
            if value:
                return value
        return self.release

    def record_url(self, record_id: str) -> str | None:
        """Human-facing page for a record."""
        return None

    # State

    def gate(self) -> SourceState | None:
        """disabled_by_license or not_configured when the adapter may not or cannot run."""
        if self.noncommercial_only and not get_settings().enable_noncommercial_sources:
            return SourceState.DISABLED_BY_LICENSE
        if self.configured() is not None:
            return SourceState.NOT_CONFIGURED
        return None

    def describe(self) -> SourceStatus:
        """Static status row for listings: whether the adapter is enabled on this deployment."""
        gate = self.gate()
        return SourceStatus(
            source=self.id,
            name=self.name,
            state=gate or SourceState.OK,
            message=self._gate_message(gate) if gate else None,
            release=self.release,
            license=self.license,
            url=self.homepage,
        )

    def _gate_message(self, gate: SourceState) -> str:
        if gate is SourceState.DISABLED_BY_LICENSE:
            return (
                f"{self.name} is restricted to non-commercial use and is disabled. "
                "Set ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES=true to enable it."
            )
        return self.configured() or f"{self.name} is not configured."

    def result[T](
        self,
        state: SourceState,
        data: T | None = None,
        *,
        provenance: Provenance | None = None,
        message: str | None = None,
        status_code: int | None = None,
        elapsed_ms: float | None = None,
    ) -> SourceResult[T]:
        return SourceResult(
            source=self.id,
            name=self.name,
            state=state,
            data=data,
            provenance=provenance,
            message=message,
            status_code=status_code,
            elapsed_ms=elapsed_ms,
            license=self.license,
            homepage=self.homepage,
        )

    def unavailable(self, message: str | None = None) -> SourceResult[Any]:
        return self.result(
            SourceState.UNAVAILABLE, message=message or f"{self.name} is temporarily unavailable."
        )

    # Requests

    async def get_json(
        self, path: str, *, params: Mapping[str, Any] | None = None, **options: Any
    ) -> SourceResult[Any]:
        return await self.request("GET", path, params=params, parse="json", **options)

    async def post_json(
        self,
        path: str,
        *,
        json_body: Any = None,
        form: Mapping[str, Any] | None = None,
        params: Mapping[str, Any] | None = None,
        **options: Any,
    ) -> SourceResult[Any]:
        return await self.request(
            "POST", path, params=params, json_body=json_body, form=form, parse="json", **options
        )

    async def get_text(
        self, path: str, *, params: Mapping[str, Any] | None = None, **options: Any
    ) -> SourceResult[str]:
        options.setdefault("headers", {"Accept": "*/*"})
        return await self.request("GET", path, params=params, parse="text", **options)

    async def get_bytes(
        self, path: str, *, params: Mapping[str, Any] | None = None, **options: Any
    ) -> SourceResult[bytes]:
        options.setdefault("headers", {"Accept": "*/*"})
        return await self.request("GET", path, params=params, parse="bytes", **options)

    async def graphql(
        self,
        query: str,
        variables: Mapping[str, Any] | None = None,
        *,
        path: str = "",
        root: str | None = None,
        **options: Any,
    ) -> SourceResult[Any]:
        """POST a GraphQL query. errors[] in a 200 response marks the source unavailable; a null
        data (or null data[root]) is empty."""

        def select_data(payload: Any) -> Any:
            data = payload.get("data") if isinstance(payload, dict) else None
            if root is not None and isinstance(data, dict):
                return data.get(root)
            return data

        return await self.request(
            "POST",
            path,
            json_body={"query": query, "variables": dict(variables or {})},
            parse="json",
            select=select_data,
            graphql=True,
            **options,
        )

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json_body: Any = None,
        form: Mapping[str, Any] | None = None,
        content: bytes | str | None = None,
        headers: Mapping[str, str] | None = None,
        parse: ParseMode = "json",
        record_id: str | None = None,
        record_url: str | None = None,
        release: str | None = None,
        ttl: int | None = None,
        empty_statuses: frozenset[int] | set[int] | None = None,
        empty_if: Callable[[Any], bool] | None = None,
        select: Callable[[Any], Any] | None = None,
        timeout: float | None = None,
        graphql: bool = False,
    ) -> SourceResult[Any]:
        """Perform one upstream request and normalise the outcome.

        path: relative to base_url, or an absolute URL (for file URLs read from an API response).
        ttl: cache lifetime in seconds; 0 disables the cache for this call.
        empty_statuses: HTTP statuses that mean 'no record' for this call (adds to the class set).
        empty_if: extra emptiness test on the parsed payload.
        select: picks the useful part of the payload after the error check.
        """
        gate = self.gate()
        if gate is not None:
            return self.result(gate, message=self._gate_message(gate))

        settings = get_settings()
        url = self._absolute_url(path)
        query = {
            key: value
            for key, value in {**self.default_params(), **(params or {})}.items()
            if value is not None
        }
        public_url = self._public_url(url, query)
        body_fingerprint = self._body_fingerprint(json_body, form, content)
        cache_key = sha256_hex(f"{method}\n{public_url}\n{body_fingerprint}")
        effective_ttl = self.cache_ttl if ttl is None else ttl
        caching = settings.http_cache_enabled and effective_ttl > 0

        async def fetch_and_store() -> _Fetched:
            outcome = await self._fetch(
                method,
                url,
                query=query,
                json_body=json_body,
                form=form,
                content=content,
                headers=headers,
                parse=parse,
                release=release,
                empty_statuses=frozenset(empty_statuses or ()) | self.empty_statuses,
                empty_if=empty_if,
                select=select,
                timeout=settings.source_timeout(self.id, timeout if timeout is not None else self.timeout),
                graphql=graphql,
            )
            if caching and outcome.state in (SourceState.OK, SourceState.EMPTY):
                lifetime = effective_ttl
                if outcome.state is SourceState.EMPTY:
                    lifetime = min(effective_ttl, self.empty_cache_ttl)
                await _cache_write(cache_key, self.id, method, public_url, outcome, lifetime)
            return outcome

        cached = await _cache_read(cache_key) if caching else None
        if cached is not None and not cached.stale:
            fetched = cached
        else:
            fetched = await self._single_flight(cache_key, fetch_and_store)
            if fetched.state is SourceState.UNAVAILABLE and cached is not None:
                logger.warning("%s unavailable, serving cached response from %s", self.id, cached.fetched_at)
                fetched = replace(
                    cached,
                    message=f"{self.name} is temporarily unavailable; showing data retrieved "
                    f"{cached.fetched_at:%Y-%m-%d}.",
                )

        if fetched.state is SourceState.UNAVAILABLE:
            return self.result(
                SourceState.UNAVAILABLE,
                message=fetched.message or f"{self.name} is temporarily unavailable.",
                status_code=fetched.status_code,
                elapsed_ms=fetched.elapsed_ms,
            )

        provenance = Provenance(
            source=self.id,
            source_name=self.name,
            release=release or fetched.release or self.release,
            method=method,
            request_url=public_url,
            retrieved_at=fetched.fetched_at,
            record_id=record_id,
            record_url=record_url or (self.record_url(record_id) if record_id else None),
            license=self.license,
            license_url=self.license_url,
            attribution=self.attribution,
            response_sha256=sha256_hex(fetched.body) if fetched.body else None,
            from_cache=fetched.from_cache,
            stale=fetched.stale,
        )
        data: Any = None
        if fetched.state is SourceState.OK:
            data = self._decode(fetched.body, parse)
            if select is not None:
                data = select(data)
        return self.result(
            fetched.state,
            data,
            provenance=provenance,
            message=fetched.message,
            status_code=fetched.status_code,
            elapsed_ms=fetched.elapsed_ms,
        )

    # Internals

    def _absolute_url(self, path: str) -> str:
        if path.startswith(("http://", "https://")):
            return path
        if not path:
            return self.base_url
        return self.base_url.rstrip("/") + "/" + path.lstrip("/")

    def _public_url(self, url: str, query: Mapping[str, Any]) -> str:
        """URL with query string and secrets removed: recorded in provenance and used as cache key."""
        parts = urlsplit(url)
        pairs = parse_qsl(parts.query, keep_blank_values=True)
        for key, value in query.items():
            if isinstance(value, list | tuple):
                pairs.extend((key, str(item)) for item in value)
            else:
                pairs.append((key, str(value)))
        visible = [(key, value) for key, value in pairs if key.lower() not in self.secret_params]
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(visible), ""))

    @staticmethod
    def _body_fingerprint(json_body: Any, form: Mapping[str, Any] | None, content: bytes | str | None) -> str:
        if json_body is not None:
            return sha256_hex(json.dumps(json_body, sort_keys=True, separators=(",", ":"), default=str))
        if form is not None:
            return sha256_hex(json.dumps(dict(form), sort_keys=True, default=str))
        if content is not None:
            return sha256_hex(content)
        return ""

    @staticmethod
    def _decode(body: bytes, parse: ParseMode) -> Any:
        if parse == "bytes":
            return body
        if parse == "text":
            return body.decode("utf-8", errors="replace")
        return json.loads(body) if body else None

    async def _single_flight(self, key: str, fetch: Callable[[], Awaitable[_Fetched]]) -> _Fetched:
        """Concurrent identical requests share one upstream call. The call runs as its own task, so
        a caller that times out does not cancel it and the response still reaches the cache."""
        inflight = _loop_state().inflight
        task = inflight.get(key)
        if task is None:
            task = asyncio.get_running_loop().create_task(fetch())
            inflight[key] = task

            def finished(done: asyncio.Task[_Fetched]) -> None:
                inflight.pop(key, None)
                if not done.cancelled():
                    done.exception()

            task.add_done_callback(finished)
        return await asyncio.shield(task)

    def _throttle(self) -> _Throttle:
        throttles = _loop_state().throttles
        throttle = throttles.get(self.id)
        if throttle is None:
            throttle = _Throttle(self.rate_limit_per_second, self.max_concurrency)
            throttles[self.id] = throttle
        return throttle

    async def _fetch(
        self,
        method: str,
        url: str,
        *,
        query: Mapping[str, Any],
        json_body: Any,
        form: Mapping[str, Any] | None,
        content: bytes | str | None,
        headers: Mapping[str, str] | None,
        parse: ParseMode,
        release: str | None,
        empty_statuses: frozenset[int],
        empty_if: Callable[[Any], bool] | None,
        select: Callable[[Any], Any] | None,
        timeout: float,
        graphql: bool,
    ) -> _Fetched:
        settings = get_settings()
        retries = self.max_retries if self.max_retries is not None else settings.source_max_retries
        request_headers = {**self.default_headers, **(headers or {})}
        throttle = self._throttle()
        client = get_http_client()
        started = time.perf_counter()
        message = f"{self.name} is temporarily unavailable."
        status_code: int | None = None

        for attempt in range(retries + 1):
            retry_after: float | None = None
            try:
                async with throttle.semaphore:
                    await throttle.wait_turn()
                    response = await client.request(
                        method,
                        url,
                        params=query or None,
                        json=json_body,
                        data=dict(form) if form is not None else None,
                        content=content,
                        headers=request_headers,
                        timeout=timeout,
                    )
            except httpx.TimeoutException:
                message = f"{self.name} did not answer within {timeout:g} s."
            except httpx.HTTPError as error:
                message = f"{self.name} could not be reached ({type(error).__name__})."
            else:
                status_code = response.status_code
                elapsed_ms = (time.perf_counter() - started) * 1000
                logger.debug("%s %s %s -> %s in %.0f ms", self.id, method, url, status_code, elapsed_ms)
                if status_code in empty_statuses:
                    return _Fetched(SourceState.EMPTY, status_code=status_code, elapsed_ms=elapsed_ms)
                if status_code in self.retry_statuses:
                    # Throttled responses can echo the caller IP: never read or log the body
                    message = f"{self.name} answered HTTP {status_code}."
                    retry_after = _retry_after_seconds(response.headers.get("retry-after"))
                elif status_code >= 400:
                    return _Fetched(
                        SourceState.UNAVAILABLE,
                        status_code=status_code,
                        message=f"{self.name} rejected the request (HTTP {status_code})."
                        + _error_hint(response),
                        elapsed_ms=elapsed_ms,
                    )
                else:
                    return self._interpret(response, parse, release, empty_if, select, graphql, elapsed_ms)

            if attempt < retries:
                backoff = min(8.0, 0.5 * (2**attempt)) + random.uniform(0, 0.25)
                await asyncio.sleep(max(backoff, retry_after or 0.0))

        return _Fetched(
            SourceState.UNAVAILABLE,
            status_code=status_code,
            message=message,
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    def _interpret(
        self,
        response: httpx.Response,
        parse: ParseMode,
        release: str | None,
        empty_if: Callable[[Any], bool] | None,
        select: Callable[[Any], Any] | None,
        graphql: bool,
        elapsed_ms: float,
    ) -> _Fetched:
        body = response.content
        status_code = response.status_code
        content_type = response.headers.get("content-type")

        def unavailable(message: str) -> _Fetched:
            return _Fetched(
                SourceState.UNAVAILABLE, status_code=status_code, message=message, elapsed_ms=elapsed_ms
            )

        try:
            payload = self._decode(body, parse)
        except ValueError:
            return unavailable(f"{self.name} returned a response that is not valid JSON.")

        if parse == "json":
            if graphql and isinstance(payload, dict) and payload.get("errors"):
                first = payload["errors"][0]
                detail = first.get("message") if isinstance(first, dict) else str(first)
                return unavailable(f"{self.name} rejected the query: {str(detail)[:200]}")
            error_message = self.payload_error(payload)
            if error_message:
                return unavailable(f"{self.name} reported an error: {error_message[:200]}")

        selected = select(payload) if select is not None else payload
        found_release = release or self.extract_release(response.headers, payload)
        if self.is_empty(selected) or (empty_if is not None and empty_if(selected)):
            return _Fetched(
                SourceState.EMPTY,
                body=body,
                status_code=status_code,
                content_type=content_type,
                release=found_release,
                elapsed_ms=elapsed_ms,
            )
        return _Fetched(
            SourceState.OK,
            body=body,
            status_code=status_code,
            content_type=content_type,
            release=found_release,
            elapsed_ms=elapsed_ms,
        )


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return min(float(value), MAX_RETRY_AFTER_SECONDS)
    except ValueError:
        return None


def _error_hint(response: httpx.Response) -> str:
    """Short reason from a JSON error body of a non-retryable 4xx response."""
    if "json" not in response.headers.get("content-type", ""):
        return ""
    try:
        payload = response.json()
    except ValueError:
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("error", "message", "detail", "errors"):
        value = payload.get(key)
        if isinstance(value, list) and value:
            value = value[0].get("message") if isinstance(value[0], dict) else value[0]
        if isinstance(value, str) and value.strip():
            return f" {value.strip().splitlines()[0][:200]}"
    return ""


async def _cache_read(key: str) -> _Fetched | None:
    """Cached response, flagged stale when past its TTL. Never raises: the cache is optional."""
    try:
        async with session_scope() as session:
            entry = await session.get(HttpCacheEntry, key)
            if entry is None:
                return None
            body = zlib.decompress(entry.body) if entry.body_encoding == "zlib" else entry.body
            return _Fetched(
                state=SourceState(entry.state),
                body=body,
                status_code=entry.status_code,
                content_type=entry.content_type,
                release=entry.release,
                fetched_at=entry.fetched_at,
                from_cache=True,
                stale=entry.expires_at <= utcnow(),
            )
    except Exception:
        logger.warning("HTTP cache read failed", exc_info=True)
        return None


async def _cache_write(key: str, source: str, method: str, url: str, fetched: _Fetched, ttl: int) -> None:
    if len(fetched.body) > MAX_CACHED_BODY_BYTES:
        return
    try:
        async with session_scope() as session:
            await session.merge(
                HttpCacheEntry(
                    key=key,
                    source=source,
                    method=method,
                    url=url,
                    state=fetched.state.value,
                    status_code=fetched.status_code or 200,
                    content_type=fetched.content_type,
                    body=zlib.compress(fetched.body, 6),
                    body_encoding="zlib",
                    body_sha256=sha256_hex(fetched.body),
                    release=fetched.release,
                    fetched_at=fetched.fetched_at,
                    expires_at=fetched.fetched_at + timedelta(seconds=ttl),
                )
            )
    except Exception:
        logger.warning("HTTP cache write failed", exc_info=True)


async def purge_http_cache() -> int:
    """Delete cache rows that expired long enough ago to be useless even as a stale fallback."""
    try:
        async with session_scope() as session:
            outcome = await session.execute(
                delete(HttpCacheEntry).where(HttpCacheEntry.expires_at < utcnow() - STALE_RETENTION)
            )
            return outcome.rowcount or 0
    except Exception:
        logger.warning("HTTP cache purge failed", exc_info=True)
        return 0


@dataclass(slots=True)
class SourceCall:
    """One call for gather_sources, with its own timeout."""

    source: SourceAdapter | str
    awaitable: Awaitable[SourceResult[Any]]
    timeout: float | None = None


_STATE_SEVERITY = {
    SourceState.UNAVAILABLE: 4,
    SourceState.NOT_CONFIGURED: 3,
    SourceState.DISABLED_BY_LICENSE: 2,
    SourceState.OK: 1,
    SourceState.EMPTY: 0,
}


@dataclass(slots=True)
class Gathered:
    """Results of gather_sources, keyed as given."""

    results: dict[str, SourceResult[Any]]

    def __getitem__(self, key: str) -> SourceResult[Any]:
        return self.results[key]

    def data(self, key: str, default: Any = None) -> Any:
        """Data of one call, or the default when that source had nothing or did not answer."""
        result = self.results[key]
        return result.data if result.ok and result.data is not None else default

    @property
    def sources(self) -> list[SourceStatus]:
        """One row per source. With several calls to one source the most severe state is reported."""
        merged: dict[str, SourceStatus] = {}
        for result in self.results.values():
            status = result.status()
            current = merged.get(status.source)
            if current is None:
                merged[status.source] = status
                continue
            keep, other = (
                (status, current)
                if _STATE_SEVERITY[status.state] > _STATE_SEVERITY[current.state]
                else (current, status)
            )
            merged[status.source] = keep.model_copy(
                update={
                    "release": keep.release or other.release,
                    "retrieved_at": keep.retrieved_at or other.retrieved_at,
                }
            )
        return list(merged.values())


async def gather_sources(
    calls: Mapping[str, SourceCall | Awaitable[SourceResult[Any]]],
    *,
    timeout: float | None = None,
) -> Gathered:
    """Run source calls concurrently. Each call has its own timeout; a call that times out or raises
    becomes an 'unavailable' result, so the caller always gets one result per key.

    A bare awaitable uses its key as the source ID; wrap it in SourceCall to name the adapter or to
    give it its own timeout.
    """
    default_timeout = timeout if timeout is not None else get_settings().gather_timeout_default

    async def run(key: str, call: SourceCall | Awaitable[SourceResult[Any]]) -> tuple[str, SourceResult[Any]]:
        if not isinstance(call, SourceCall):
            call = SourceCall(source=key, awaitable=call)
        adapter = call.source if isinstance(call.source, SourceAdapter) else get_source(call.source)
        source_id = adapter.id if adapter else str(call.source)
        name = adapter.name if adapter else str(call.source)
        limit = call.timeout if call.timeout is not None else default_timeout

        def failed(message: str) -> SourceResult[Any]:
            return SourceResult(
                source=source_id,
                name=name,
                state=SourceState.UNAVAILABLE,
                message=message,
                license=adapter.license if adapter else None,
                homepage=adapter.homepage if adapter else None,
            )

        try:
            outcome = await asyncio.wait_for(call.awaitable, limit)
            if not isinstance(outcome, SourceResult):
                logger.error(
                    "Source call %s returned %s instead of a SourceResult", key, type(outcome).__name__
                )
                return key, failed(f"{name} is temporarily unavailable.")
            return key, outcome
        except TimeoutError:
            return key, failed(f"{name} did not answer within {limit:g} s.")
        except ApiError as error:
            return key, failed(error.detail or f"{name} is temporarily unavailable.")
        except Exception:
            logger.exception("Source call %s failed", key)
            return key, failed(f"{name} is temporarily unavailable.")

    pairs = await asyncio.gather(*(run(key, call) for key, call in calls.items()))
    return Gathered(results=dict(pairs))
