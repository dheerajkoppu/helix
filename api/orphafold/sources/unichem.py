"""UniChem: every database identifier of a compound, joined on InChIKey."""

from typing import Any

from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass
from orphafold.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="unichem",
        record_type="xref",
        evidence_class=EvidenceClass.CURATED_DATABASE,
        eco="ECO:0000322",
    )
)


class UniChemSource(SourceAdapter):
    id = "unichem"
    name = "UniChem"
    base_url = "https://www.ebi.ac.uk/unichem/api/v1"
    homepage = "https://www.ebi.ac.uk/unichem/"
    license = "LicenseRef-EMBL-EBI-Terms-of-Use"
    license_url = "https://www.ebi.ac.uk/about/terms-of-use"
    attribution = "UniChem (EMBL-EBI)"
    timeout = 20.0
    cache_ttl = 7 * 24 * 3600
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.ebi.ac.uk/unichem/compoundsources?type=inchikey&compound={record_id}"

    async def cross_references(self, inchikey: str) -> SourceResult[list[dict[str, Any]]]:
        """Source rows of one compound: {shortName, longName, compoundId, url}."""
        raw = await self.post_json(
            "/compounds",
            json_body={"type": "inchikey", "compound": inchikey},
            record_id=inchikey,
            empty_if=lambda payload: not payload.get("compounds"),
        )
        return raw.map(lambda payload: payload["compounds"][0].get("sources") or [])


unichem = UniChemSource()
