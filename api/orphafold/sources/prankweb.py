"""PrankWeb v2: P2Rank pocket predictions for PDB entries and AlphaFold DB models.

Asking for a prediction that does not exist creates the task (201, status queued); the same URL is
polled until the status is successful (docs/research/drug-discovery.md section 2.1).
"""

from typing import Any

from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass
from orphafold.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="prankweb",
        record_type="pocket",
        evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
        eco="ECO:0007669",
        scheme="p2rank_probability",
    )
)

DATABASE_PDB = "v3"
DATABASE_ALPHAFOLD = "v3-alphafold"


class PrankWebSource(SourceAdapter):
    id = "prankweb"
    name = "PrankWeb (P2Rank)"
    base_url = "https://prankweb.cz/api/v2"
    homepage = "https://prankweb.cz"
    attribution = "PrankWeb, running P2Rank"
    timeout = 20.0
    max_concurrency = 3
    cache_ttl = 30 * 24 * 3600
    empty_cache_ttl = 60
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        database, _, identifier = record_id.partition("/")
        if not identifier:
            return None
        return f"https://prankweb.cz/analyze?database={database}&code={identifier}"

    async def task(self, database: str, identifier: str) -> SourceResult[dict[str, Any]]:
        """Task record {id, database, status, created, lastChange}. Never cached: it is the poll."""
        return await self.get_json(
            f"/prediction/{database}/{identifier}", record_id=f"{database}/{identifier}", ttl=0
        )

    async def prediction(self, database: str, identifier: str) -> SourceResult[dict[str, Any]]:
        return await self.get_json(
            f"/prediction/{database}/{identifier}/public/prediction.json",
            record_id=f"{database}/{identifier}",
            empty_if=lambda payload: "pockets" not in payload,
        )


prankweb = PrankWebSource()
