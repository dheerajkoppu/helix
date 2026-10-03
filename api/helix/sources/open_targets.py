"""Open Targets Platform GraphQL: drugs and clinical candidates of a target or a disease, and
gene-disease validity evidence (docs/research/data-apis.md section 3.10)."""

from typing import Any

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.schemas.common import EvidenceClass
from helix.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="open_targets",
        record_type="clinical_candidate",
        evidence_class=EvidenceClass.CURATED_DATABASE,
        eco="ECO:0000322",
    )
)

_ROW_FIELDS = """
  id
  maxClinicalStage
  drug {
    id name drugType maximumClinicalStage
    mechanismsOfAction { rows { mechanismOfAction actionType targetName references { source ids urls } } }
  }
  clinicalReports { id source url clinicalStage trialPhase title type year }
"""
# Only the target side lists the indications of each candidate
_TARGET_FIELDS = "count rows {" + _ROW_FIELDS + " diseases { diseaseFromSource disease { id name } } }"
_DISEASE_FIELDS = "count rows {" + _ROW_FIELDS + "}"

_TARGET_QUERY = (
    "query TargetDrugs($id: String!) { target(ensemblId: $id) { id approvedSymbol approvedName "
    "drugAndClinicalCandidates {" + _TARGET_FIELDS + "} } }"
)

_DISEASE_QUERY = (
    "query DiseaseDrugs($id: String!, $targets: [String!]!) { disease(efoId: $id) { id name "
    "drugAndClinicalCandidates {" + _DISEASE_FIELDS + "} "
    'evidences(ensemblIds: $targets, datasourceIds: ["clingen"], size: 20) { count rows { '
    "id datasourceId confidence diseaseFromSource studyId allelicRequirements urls { url niceName } } } } }"
)

_MAP_QUERY = (
    'query MapIds($terms: [String!]!) { mapIds(queryTerms: $terms, entityNames: ["target"]) { '
    "mappings { term hits { id entity name } } } }"
)

_META_QUERY = "{ meta { dataVersion { year month } } }"


class OpenTargetsSource(SourceAdapter):
    id = "open_targets"
    name = "Open Targets Platform"
    base_url = "https://api.platform.opentargets.org/api/v4/graphql"
    homepage = "https://platform.opentargets.org"
    license = "CC0-1.0"
    license_url = "https://platform-docs.opentargets.org/licence"
    attribution = "Open Targets Platform"
    timeout = 20.0
    max_concurrency = 4

    def record_url(self, record_id: str) -> str | None:
        if record_id.startswith("ENSG"):
            return f"{self.homepage}/target/{record_id}"
        if record_id.startswith("CHEMBL"):
            return f"{self.homepage}/drug/{record_id}"
        return f"{self.homepage}/disease/{record_id}"

    async def data_release(self) -> str | None:
        """Data version as Open Targets states it, e.g. 26.09."""
        result = await self.graphql(_META_QUERY, root="meta", record_id="meta")
        version = (result.data or {}).get("dataVersion") if result.ok else None
        if not version:
            return None
        return f"{version['year']}.{str(version['month']).zfill(2)}"

    async def target_drugs(self, ensembl_gene_id: str) -> SourceResult[dict[str, Any]]:
        release = await self.data_release()
        return await self.graphql(
            _TARGET_QUERY, {"id": ensembl_gene_id}, root="target", record_id=ensembl_gene_id, release=release
        )

    async def disease_drugs(
        self, disease_id: str, ensembl_gene_ids: list[str] | None = None
    ) -> SourceResult[dict[str, Any]]:
        """Drugs with this disease as an indication, and ClinGen gene-validity evidence for the
        given targets. disease_id is a MONDO or Orphanet CURIE in either separator form."""
        efo_id = disease_id.replace(":", "_").replace("ORPHA_", "Orphanet_")
        release = await self.data_release()
        return await self.graphql(
            _DISEASE_QUERY,
            {"id": efo_id, "targets": ensembl_gene_ids or []},
            root="disease",
            record_id=efo_id,
            release=release,
        )

    async def target_id(self, term: str) -> SourceResult[str]:
        """Ensembl gene ID of a symbol or UniProt accession."""
        raw = await self.graphql(_MAP_QUERY, {"terms": [term]}, root="mapIds", record_id=term)

        def first_hit(payload: dict[str, Any]) -> str | None:
            for mapping in payload.get("mappings") or []:
                for hit in mapping.get("hits") or []:
                    if hit.get("entity") == "target":
                        return hit["id"]
            return None

        return raw.map(first_hit)


open_targets = OpenTargetsSource()
