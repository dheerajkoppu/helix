"""3D-Beacons: one inventory of structures and models for a protein across member providers."""

from typing import Any

from pydantic import BaseModel

from orphafold.sources.base import SourceAdapter, SourceResult


class BeaconModel(BaseModel):
    """One structures[].summary row, with the provider's own wording kept verbatim."""

    model_identifier: str
    model_category: str | None = None
    provider: str | None = None
    model_url: str | None = None
    model_format: str | None = None
    model_page_url: str | None = None
    created: str | None = None
    sequence_identity: float | None = None
    uniprot_start: int | None = None
    uniprot_end: int | None = None
    coverage: float | None = None
    confidence_type: str | None = None
    confidence_version: str | None = None
    confidence_avg_local_score: float | None = None
    oligomeric_state: str | None = None
    experimental_method: str | None = None
    resolution: float | None = None


def _parse(payload: Any) -> list[BeaconModel]:
    return [
        BeaconModel.model_validate(item["summary"])
        for item in payload.get("structures") or []
        if item.get("summary")
    ]


class ThreeDBeaconsSource(SourceAdapter):
    id = "three_d_beacons"
    name = "3D-Beacons"
    base_url = "https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api"
    homepage = "https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/"
    license = "LicenseRef-3D-Beacons-member-terms"
    attribution = "3D-Beacons Network; each model is under the licence of its provider"
    timeout = 30.0
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/search/{record_id}"

    async def summary(self, accession: str) -> SourceResult[list[BeaconModel]]:
        accession = accession.strip().upper()
        raw = await self.get_json(f"/uniprot/summary/{accession}.json", record_id=accession)
        return raw.map(_parse)


three_d_beacons = ThreeDBeaconsSource()
