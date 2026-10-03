"""Europe PMC: publication search and records.

docs/research/data-apis.md section 3.13. Errors arrive as HTTP 200 with errCode. The search has no
page number: paging is by cursorMark. A query is limited to 1500 characters.
"""

from typing import Any

from orphafold.sources.base import SourceAdapter, SourceResult

MAX_QUERY_LENGTH = 1500
MAX_PAGE_SIZE = 1000


class EuropePmcSource(SourceAdapter):
    id = "europepmc"
    name = "Europe PMC"
    base_url = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    homepage = "https://europepmc.org"
    license = "LicenseRef-EuropePMC-Terms"
    license_url = "https://europepmc.org/Copyright"
    attribution = "Europe PMC (EMBL-EBI); article copyright stays with the rights holders"
    timeout = 20.0
    rate_limit_per_second = 8.0
    max_concurrency = 4
    cache_ttl = 6 * 3600
    empty_cache_ttl = 3600

    def payload_error(self, payload: Any) -> str | None:
        if isinstance(payload, dict) and payload.get("errCode"):
            return str(payload.get("errMsg") or f"Europe PMC error {payload['errCode']}")
        return None

    def is_empty(self, payload: Any) -> bool:
        return not isinstance(payload, dict) or not payload.get("hitCount")

    def extract_release(self, headers: Any, payload: Any) -> str | None:
        if isinstance(payload, dict) and payload.get("version"):
            return f"REST API {payload['version']}"
        return None

    def record_url(self, record_id: str) -> str | None:
        if record_id.isdigit():
            return f"https://europepmc.org/article/MED/{record_id}"
        return None

    async def search(
        self,
        query: str,
        *,
        page_size: int = 25,
        cursor: str = "*",
        sort: str | None = None,
        result_type: str = "core",
    ) -> SourceResult[dict[str, Any]]:
        """One page of a search: hit_count, next_cursor and the raw result rows."""
        params: dict[str, Any] = {
            "query": query,
            "format": "json",
            "resultType": result_type,
            "pageSize": min(max(page_size, 1), MAX_PAGE_SIZE),
            "cursorMark": cursor,
        }
        if sort:
            params["sort"] = sort
        raw = await self.get_json("/search", params=params)
        return raw.map(
            lambda payload: {
                "hit_count": int(payload["hitCount"]),
                "next_cursor": payload.get("nextCursorMark"),
                "results": (payload.get("resultList") or {}).get("result") or [],
            }
        )

    async def article(self, pmid: str) -> SourceResult[dict[str, Any]]:
        """The core record of one PubMed-indexed article."""
        raw = await self.get_json(
            "/search",
            params={"query": f"EXT_ID:{pmid} AND SRC:MED", "format": "json", "resultType": "core"},
            record_id=pmid,
        )
        return raw.map(lambda payload: ((payload.get("resultList") or {}).get("result") or [None])[0])

    async def uniprot_publications(self, accession: str) -> SourceResult[list[str]]:
        """PMIDs Europe PMC lists as cited by a UniProt entry (UNIPROT_PUBS)."""
        raw = await self.get_json(
            "/search",
            params={
                "query": f"UNIPROT_PUBS:{accession} AND SRC:MED",
                "format": "json",
                "resultType": "idlist",
                "pageSize": MAX_PAGE_SIZE,
            },
            record_id=accession,
            record_url=f"https://europepmc.org/search?query=UNIPROT_PUBS%3A{accession}",
        )
        return raw.map(
            lambda payload: [
                str(row["pmid"])
                for row in (payload.get("resultList") or {}).get("result") or []
                if row.get("pmid")
            ]
        )


europepmc = EuropePmcSource()
