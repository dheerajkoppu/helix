"""Monarch Initiative v3 knowledge graph: disease entities and causal gene associations
(docs/research/data-apis.md section 3.18)."""

from typing import Any

from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass
from orphafold.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="monarch",
        record_type="causal_gene",
        evidence_class=EvidenceClass.CURATED_DATABASE,
        eco="ECO:0000322",
    )
)


class MonarchSource(SourceAdapter):
    id = "monarch"
    name = "Monarch Initiative"
    base_url = "https://api-v3.monarchinitiative.org/v3/api"
    homepage = "https://monarchinitiative.org"
    license = "LicenseRef-Monarch-upstream-terms"
    license_url = "https://monarchinitiative.org/about"
    attribution = "Monarch Initiative knowledge graph; upstream sources keep their own terms"
    timeout = 12.0
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"{self.homepage}/{record_id}"

    async def disease(self, mondo_id: str) -> SourceResult[dict[str, Any]]:
        raw = await self.get_json(f"/entity/{mondo_id}", record_id=mondo_id)
        return raw.map(
            lambda payload: {
                "id": payload["id"],
                "name": payload.get("name"),
                "description": payload.get("description"),
                "inheritance": payload.get("inheritance"),
                "causal_genes": [
                    {"id": gene.get("id"), "symbol": gene.get("name")}
                    for gene in payload.get("causal_gene") or []
                ],
                "association_counts": [
                    {"label": row.get("label"), "count": row.get("count")}
                    for row in payload.get("association_counts") or []
                ],
            }
        )

    async def causal_gene_associations(self, mondo_id: str) -> SourceResult[list[dict[str, Any]]]:
        raw = await self.get_json(
            "/association",
            params={"object": mondo_id, "category": "biolink:CausalGeneToDiseaseAssociation", "limit": 20},
            record_id=mondo_id,
            select=lambda payload: payload.get("items") if isinstance(payload, dict) else payload,
        )
        return raw.map(
            lambda items: [
                {
                    "id": item.get("id"),
                    "gene_id": item.get("subject"),
                    "gene_symbol": item.get("subject_label"),
                    "predicate": item.get("predicate"),
                    "primary_knowledge_source": item.get("primary_knowledge_source"),
                    "publications": item.get("publications") or [],
                }
                for item in items
            ]
        )


monarch = MonarchSource()
