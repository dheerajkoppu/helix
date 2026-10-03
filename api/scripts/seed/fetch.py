"""Disk-cached, rate-limited HTTP access for the seed build.

Every response is stored unmodified under <cache>/<source_id>/<key> with a
<key>.meta.json sidecar, so an interrupted build resumes without repeating
requests and every derived value can be traced to the bytes it came from.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

USER_AGENT = "OrphaFold-seed-builder/0.1 (open-source rare-disease research platform; httpx)"

# Minimum seconds between requests to one host. NCBI allows 3 requests per second without a key.
HOST_INTERVALS = {
    "eutils.ncbi.nlm.nih.gov": 0.40,
    "rest.uniprot.org": 0.35,
    "www.ebi.ac.uk": 0.15,
    "alphafold.ebi.ac.uk": 0.15,
    "search.rcsb.org": 0.15,
}
DEFAULT_INTERVAL = 0.25
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 5
KEPT_HEADERS = (
    "last-modified",
    "etag",
    "content-type",
    "x-uniprot-release",
    "x-uniprot-release-date",
)


class LookupFailed(Exception):
    """The source could not be reached or answered with an error."""


@dataclass(frozen=True)
class Cached:
    path: Path
    url: str
    status: int
    retrieved_at: str
    sha256: str
    size: int
    headers: dict[str, str]
    from_cache: bool

    def bytes(self) -> bytes:
        return self.path.read_bytes()

    def text(self) -> str:
        return self.path.read_text(encoding="utf-8")

    def json(self):
        return json.loads(self.path.read_bytes())


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Fetcher:
    def __init__(
        self, cache_directory: Path, *, offline: bool = False, refresh: frozenset[str] = frozenset()
    ):
        self.cache_directory = cache_directory
        self.offline = offline
        self.refresh = refresh
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=httpx.Timeout(60.0, connect=20.0),
        )
        self.lock = threading.Lock()
        self.next_slot: dict[str, float] = {}
        self.network_requests = 0
        self.cache_hits = 0

    def close(self) -> None:
        self.client.close()

    def wait_for_slot(self, host: str) -> None:
        interval = HOST_INTERVALS.get(host, DEFAULT_INTERVAL)
        with self.lock:
            now = time.monotonic()
            slot = max(now, self.next_slot.get(host, 0.0))
            self.next_slot[host] = slot + interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def paths(self, source_id: str, key: str) -> tuple[Path, Path]:
        body_path = self.cache_directory / source_id / key
        return body_path, body_path.with_name(body_path.name + ".meta.json")

    def read_cached(self, source_id: str, key: str) -> Cached | None:
        body_path, meta_path = self.paths(source_id, key)
        if not (body_path.exists() and meta_path.exists()):
            return None
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return Cached(
            path=body_path,
            url=meta["url"],
            status=meta["status"],
            retrieved_at=meta["retrieved_at"],
            sha256=meta["sha256"],
            size=meta["size"],
            headers=meta.get("headers", {}),
            from_cache=True,
        )

    def get(
        self,
        source_id: str,
        key: str,
        url: str,
        *,
        params: dict | None = None,
        headers: dict | None = None,
        json_body: dict | None = None,
        empty_statuses: tuple[int, ...] = (),
        timeout: float | None = None,
    ) -> Cached:
        """Return the cached response for (source_id, key), fetching it when absent.

        Statuses in empty_statuses are a real "no data" answer from the source and are cached.
        Any other non-200 status raises LookupFailed and nothing is cached, so a later run retries.
        """
        if source_id not in self.refresh:
            cached = self.read_cached(source_id, key)
            if cached is not None:
                with self.lock:
                    self.cache_hits += 1
                return cached
        if self.offline:
            raise LookupFailed(f"offline and not cached: {source_id}/{key}")

        host = urlsplit(url).netloc
        request = self.client.build_request(
            "POST" if json_body is not None else "GET",
            url,
            params=params,
            headers=headers,
            json=json_body,
            timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
        )
        last_error = "no attempt made"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self.wait_for_slot(host)
            with self.lock:
                self.network_requests += 1
            try:
                response = self.client.send(request)
            except httpx.HTTPError as error:
                last_error = f"{type(error).__name__}: {error}"
                time.sleep(min(2.0**attempt, 30.0))
                continue
            if response.status_code == 200 or response.status_code in empty_statuses:
                return self.store(source_id, key, str(request.url), response)
            last_error = f"HTTP {response.status_code}"
            if response.status_code not in RETRY_STATUSES:
                break
            retry_after = response.headers.get("retry-after", "")
            try:
                delay = float(retry_after)
            except ValueError:
                delay = 2.0**attempt
            time.sleep(min(max(delay, 1.0), 60.0))
        raise LookupFailed(f"{source_id}/{key}: {last_error} ({request.url})")

    def store(self, source_id: str, key: str, url: str, response: httpx.Response) -> Cached:
        body_path, meta_path = self.paths(source_id, key)
        body_path.parent.mkdir(parents=True, exist_ok=True)
        body = response.content
        meta = {
            "url": url,
            "status": response.status_code,
            "retrieved_at": utc_now(),
            "sha256": hashlib.sha256(body).hexdigest(),
            "size": len(body),
            "headers": {name: response.headers[name] for name in KEPT_HEADERS if name in response.headers},
        }
        temporary_path = body_path.with_name(body_path.name + ".part")
        temporary_path.write_bytes(body)
        temporary_path.replace(body_path)
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return Cached(path=body_path, from_cache=False, **meta)
