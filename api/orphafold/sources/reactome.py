"""Reactome Content Service: pathways a protein takes part in (docs/research/data-apis.md 3.15)."""

from typing import Any

from orphafold.sources.base import SourceAdapter, SourceResult


class ReactomeSource(SourceAdapter):
    id = "reactome"
    name = "Reactome"
    base_url = "https://reactome.org/ContentService"
    homepage = "https://reactome.org"
    license = "CC0-1.0"
    license_url = "https://reactome.org/license"
    timeout = 15.0
    # Reactome answers 404 when a protein has no pathways
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        if record_id.startswith("R-"):
            return f"{self.homepage}/content/detail/{record_id}"
        return f"{self.homepage}/content/query?q={record_id}"

    async def data_release(self) -> str | None:
        result = await self.get_text("/data/database/version", record_id="version")
        return result.data.strip() if result.ok and result.data else None

    async def pathways(self, accession: str) -> SourceResult[list[dict[str, Any]]]:
        release = await self.data_release()
        raw = await self.get_json(
            f"/data/mapping/UniProt/{accession}/pathways",
            params={"species": 9606},
            record_id=accession,
            release=release,
        )
        return raw.map(
            lambda payload: [
                {
                    "id": row["stId"],
                    "version": row.get("stIdVersion"),
                    "name": row["displayName"],
                    "in_disease": bool(row.get("isInDisease")),
                    "inferred": bool(row.get("isInferred")),
                    "has_diagram": bool(row.get("hasDiagram")),
                    "doi": row.get("doi"),
                    "release_date": row.get("releaseDate"),
                }
                for row in payload
            ]
        )


reactome = ReactomeSource()
