"""STRING physical associations (docs/research/data-apis.md section 3.14). A STRING score is a
combined confidence over several evidence channels, not a curated interaction record."""

from typing import Any

from orphafold.sources.base import SourceAdapter, SourceResult

CHANNELS = ("escore", "dscore", "tscore", "ascore", "nscore", "fscore", "pscore")
CALLER = "orphafold"


class StringSource(SourceAdapter):
    id = "string"
    name = "STRING"
    # Pinned so that scores are reproducible
    base_url = "https://version-12-5.string-db.org/api"
    homepage = "https://string-db.org"
    license = "CC-BY-4.0"
    license_url = "https://string-db.org/cgi/access"
    attribution = "STRING database"
    release = "12.5"
    timeout = 20.0
    rate_limit_per_second = 1.0
    max_concurrency = 1
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"{self.homepage}/network/{record_id}"

    async def string_id(self, identifier: str) -> SourceResult[dict[str, Any]]:
        raw = await self.get_json(
            "/json/get_string_ids",
            params={"identifiers": identifier, "species": 9606, "limit": 1, "caller_identity": CALLER},
            record_id=identifier,
        )
        return raw.map(
            lambda payload: {
                "string_id": payload[0]["stringId"],
                "preferred_name": payload[0].get("preferredName"),
            }
        )

    async def physical_partners(
        self, identifier: str, *, limit: int = 15, required_score: int = 700
    ) -> SourceResult[dict[str, Any]]:
        """Partners in the physical subnetwork at or above the score threshold (0-1000)."""
        resolved = await self.string_id(identifier)
        if not resolved.ok or not resolved.data:
            return resolved
        string_id = resolved.data["string_id"]
        raw = await self.get_json(
            "/json/interaction_partners",
            params={
                "identifiers": string_id,
                "species": 9606,
                "limit": limit,
                "required_score": required_score,
                "network_type": "physical",
                "caller_identity": CALLER,
            },
            record_id=string_id,
        )
        return raw.map(
            lambda payload: {
                "string_id": string_id,
                "preferred_name": resolved.data["preferred_name"],
                "required_score": required_score / 1000,
                "partners": [
                    {
                        "string_id": row["stringId_B"],
                        "symbol": row.get("preferredName_B"),
                        "score": row.get("score"),
                        **{channel: row.get(channel) for channel in CHANNELS},
                    }
                    for row in payload
                ],
            }
        )


string_db = StringSource()
