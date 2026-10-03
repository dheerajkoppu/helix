"""Preload the upstream cache for the flagship genes, so their pages open without waiting on a source.

    make warm                      every flagship gene, through the running API when there is one
    make warm WARM_ARGS="BTK ADA"  only these genes
    .venv/bin/python scripts/warm_cache.py --api http://localhost:8000 --passes 2

Every request goes through the API's own routes and services, so the cache holds exactly what the
pages ask for. With an API listening on --api the requests are sent to it. Without one the
application is started inside this process against the configured database.
"""

import argparse
import asyncio
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orphafold.config import API_PREFIX  # noqa: E402
from orphafold.identifiers import parse_variant_id  # noqa: E402
from orphafold.knowledge.catalog import get_catalog, load_catalog  # noqa: E402

REQUEST_TIMEOUT = 180.0
GENE_CONCURRENCY = 3
REQUEST_CONCURRENCY = 4
SLOW_MS = 1000


@dataclass(slots=True)
class Outcome:
    path: str
    status: int | None
    elapsed_ms: float
    unavailable: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    error: str | None = None

    @property
    def failed(self) -> bool:
        return self.status is None or self.status >= 500


class Warmer:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.limit = asyncio.Semaphore(REQUEST_CONCURRENCY * GENE_CONCURRENCY)
        self.outcomes: list[Outcome] = []

    async def get(self, path: str, **params: Any) -> Any:
        """Request one page endpoint and record how it answered. Returns the JSON body or None."""
        async with self.limit:
            started = time.perf_counter()
            try:
                response = await self.client.get(path, params=params or None)
            except httpx.HTTPError as error:
                elapsed = (time.perf_counter() - started) * 1000
                self.outcomes.append(Outcome(path, None, elapsed, error=type(error).__name__))
                return None
        outcome = Outcome(path, response.status_code, (time.perf_counter() - started) * 1000)
        body: Any = None
        if "json" in response.headers.get("content-type", ""):
            body = response.json()
            sources = body.get("sources") if isinstance(body, dict) else None
            for source in sources or []:
                if source.get("state") == "unavailable":
                    outcome.unavailable.append(source["source"])
                elif source.get("stale"):
                    outcome.stale.append(source["source"])
        self.outcomes.append(outcome)
        return body if response.status_code == 200 else None

    async def gene(self, flagship: Any) -> None:
        symbol = flagship.gene_symbol
        accession = flagship.uniprot_accession
        gene = await self.get(f"/genes/{symbol}")
        calls = [
            self.get(f"/genes/{symbol}/variants"),
            self.get(f"/genes/{symbol}/axis-variants"),
            self.get(f"/genes/{symbol}/population-variants"),
            self.get(f"/genes/{symbol}/treatments"),
            self.get("/literature", gene=symbol),
            self.get("/search", q=symbol),
        ]
        for disease in (gene or {}).get("diseases") or []:
            calls.append(self.get(f"/diseases/{disease['id']}"))
            calls.append(self.get("/literature", gene=symbol, disease=disease["id"]))
        if accession:
            calls += [
                self.get(f"/proteins/{accession}"),
                self.structures(accession),
                self.get(f"/proteins/{accession}/interactions"),
                self.get(f"/proteins/{accession}/pathways"),
                self.get(f"/proteins/{accession}/pockets"),
                self.get(f"/proteins/{accession}/compounds"),
                self.get(f"/proteins/{accession}/effect-map"),
            ]
        for variant in flagship.variants:
            calls.append(self.variant(symbol, accession, variant.id))
        await asyncio.gather(*calls)

    async def structures(self, accession: str) -> None:
        """The structure the page opens with, and the highest-ranked experimental entry."""
        listing = await self.get(f"/proteins/{accession}/structures") or {}
        ids = [model["id"] for model in listing.get("predicted_external") or []][:1]
        ids += [row["structure"]["id"] for row in listing.get("experimental") or []][:1]
        recommended = (listing.get("recommended") or {}).get("structure_id")
        if recommended and recommended not in ids:
            ids.append(recommended)
        await asyncio.gather(
            *(
                self.get(f"/structures/{structure_id}{suffix}")
                for structure_id in ids
                for suffix in ("", "/confidence", "/residue-map", "/ligands", "/file")
            )
        )

    async def variant(self, symbol: str, accession: str | None, variant_id: str) -> None:
        calls = [
            self.get(f"/variants/{variant_id}"),
            self.get(f"/variants/{variant_id}/mechanisms"),
            self.get("/literature", gene=symbol, variant=variant_id),
        ]
        change = parse_variant_id(variant_id)
        position = getattr(change, "position", None)
        if change is not None and position:
            calls.append(self.get(f"/compare/{symbol}/{variant_id.split('-', 1)[1]}"))
            if accession:
                calls.append(self.get(f"/proteins/{accession}/residues/{position}"))
                calls.append(self.get(f"/proteins/{accession}/residues/{position}/effects"))
        await asyncio.gather(*calls)


async def run(client: httpx.AsyncClient, symbols: list[str], passes: int) -> int:
    catalog = get_catalog()
    flagship = [entry for entry in catalog.flagship if not symbols or entry.gene_symbol in symbols]
    unknown = set(symbols) - {entry.gene_symbol for entry in flagship}
    if unknown:
        print(f"Not a flagship gene: {', '.join(sorted(unknown))}")
    failed = 0
    for number in range(1, passes + 1):
        warmer = Warmer(client)
        gate = asyncio.Semaphore(GENE_CONCURRENCY)
        started = time.perf_counter()

        async def one(entry: Any, warmer: Warmer = warmer, gate: asyncio.Semaphore = gate) -> None:
            async with gate:
                gene_started = time.perf_counter()
                await warmer.gene(entry)
                print(f"  {entry.gene_symbol:8} {time.perf_counter() - gene_started:6.1f} s", flush=True)

        print(f"Pass {number} of {passes}: {len(flagship)} genes")
        await asyncio.gather(*(one(entry) for entry in flagship))
        outcomes = warmer.outcomes
        slow = sorted(
            (outcome for outcome in outcomes if outcome.elapsed_ms >= SLOW_MS),
            key=lambda outcome: -outcome.elapsed_ms,
        )
        unavailable = [outcome for outcome in outcomes if outcome.unavailable]
        errors = [outcome for outcome in outcomes if outcome.failed]
        other = [outcome for outcome in outcomes if not outcome.failed and outcome.status != 200]
        print(
            f"  {len(outcomes)} requests in {time.perf_counter() - started:.1f} s: "
            f"{len(slow)} took over {SLOW_MS} ms, {len(unavailable)} with a source unavailable, "
            f"{len(other)} answered 4xx, {len(errors)} failed"
        )
        for outcome in slow[:15]:
            print(f"    slow   {outcome.elapsed_ms:8.0f} ms  {outcome.path}")
        for outcome in unavailable:
            print(f"    source unavailable ({', '.join(outcome.unavailable)})  {outcome.path}")
        for outcome in other:
            print(f"    HTTP {outcome.status}  {outcome.path}")
        for outcome in errors:
            print(f"    failed {outcome.status or outcome.error}  {outcome.path}")
        failed = len(errors)
    return 1 if failed else 0


async def api_is_up(base_url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as probe:
            return (await probe.get(f"{base_url}{API_PREFIX}/health")).status_code == 200
    except httpx.HTTPError:
        return False


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("genes", nargs="*", help="flagship gene symbols; default: all of them")
    parser.add_argument("--api", default="http://localhost:8000", help="base URL of a running API")
    parser.add_argument("--in-process", action="store_true", help="never use a running API")
    parser.add_argument("--passes", type=int, default=1, help="a second pass shows the warm timings")
    args = parser.parse_args()
    symbols = [symbol.upper() for symbol in args.genes]
    load_catalog()

    base_url = args.api.rstrip("/")
    if not args.in_process and await api_is_up(base_url):
        print(f"Warming through the API at {base_url}")
        async with httpx.AsyncClient(base_url=base_url + API_PREFIX, timeout=REQUEST_TIMEOUT) as client:
            return await run(client, symbols, args.passes)

    from orphafold.main import app
    from orphafold.sources.base import drain_inflight

    print("No API is listening: warming in this process against the configured database")
    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport, base_url="http://warm" + API_PREFIX, timeout=REQUEST_TIMEOUT
        ) as client,
    ):
        code = await run(client, symbols, args.passes)
        await drain_inflight()
        return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
