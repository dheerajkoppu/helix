"""ChEMBL: targets, mechanisms, measured bioactivities, indications and similarity search.

Rules from docs/research/drug-discovery.md section 9.1: numbers arrive as strings, censored values
have a null pChEMBL, and a salt form carries the mechanism rows its parent lacks, so mechanisms and
indications are always asked for by parent molecule.
"""

from dataclasses import replace
from typing import Any
from urllib.parse import quote

from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass, SourceState
from orphafold.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="chembl",
        record_type="molecule",
        evidence_class=EvidenceClass.CURATED_DATABASE,
        eco="ECO:0000322",
    )
)

SINGLE_PROTEIN_FORMAT = "BAO_0000357"
PAGE_SIZE = 1000

ACTIVITY_FIELDS = (
    "activity_id,molecule_chembl_id,parent_molecule_chembl_id,molecule_pref_name,canonical_smiles,"
    "standard_type,standard_relation,standard_value,standard_units,pchembl_value,assay_chembl_id,"
    "assay_description,assay_type,bao_format,bao_label,document_chembl_id,document_year,"
    "data_validity_comment,target_chembl_id"
)
MOLECULE_FIELDS = (
    "molecule_chembl_id,pref_name,max_phase,first_approval,molecule_type,molecule_structures,"
    "molecule_properties,molecule_hierarchy,structure_type"
)


class ChemblSource(SourceAdapter):
    id = "chembl"
    name = "ChEMBL"
    base_url = "https://www.ebi.ac.uk/chembl/api/data"
    homepage = "https://www.ebi.ac.uk/chembl/"
    license = "CC-BY-SA-3.0"
    license_url = "https://creativecommons.org/licenses/by-sa/3.0/"
    attribution = "ChEMBL (EMBL-EBI), provided under CC BY-SA 3.0"
    timeout = 15.0
    max_concurrency = 4
    empty_statuses = frozenset({204, 404})

    _release_tag: str | None = None

    def record_url(self, record_id: str) -> str | None:
        if record_id.startswith("CHEMBL"):
            return f"https://www.ebi.ac.uk/chembl/explore/compound/{record_id}"
        return None

    @staticmethod
    def target_url(target_chembl_id: str) -> str:
        return f"https://www.ebi.ac.uk/chembl/explore/target/{target_chembl_id}"

    @staticmethod
    def assay_url(assay_chembl_id: str) -> str:
        return f"https://www.ebi.ac.uk/chembl/explore/assay/{assay_chembl_id}"

    @staticmethod
    def document_url(document_chembl_id: str) -> str:
        return f"https://www.ebi.ac.uk/chembl/explore/document/{document_chembl_id}"

    async def current_release(self) -> str | None:
        """ChEMBL release name from status.json, e.g. ChEMBL_37."""
        if type(self)._release_tag is None:
            status = await self.get_json("/status.json", record_id="status", timeout=8.0)
            if status.ok and isinstance(status.data, dict):
                type(self)._release_tag = status.data.get("chembl_db_version")
        return type(self)._release_tag

    async def _list(
        self,
        resource: str,
        key: str,
        params: dict[str, Any],
        *,
        record_id: str | None = None,
        max_pages: int = 1,
        page_size: int = PAGE_SIZE,
    ) -> SourceResult[dict[str, Any]]:
        """Rows of a list endpoint as {rows, total_count, truncated}, following pages up to max_pages."""
        release = await self.current_release()
        rows: list[dict[str, Any]] = []
        total = 0
        last: SourceResult[Any] | None = None
        for page in range(max_pages):
            last = await self.get_json(
                f"/{resource}.json",
                params={**params, "limit": page_size, "offset": page * page_size},
                record_id=record_id,
                release=release,
                empty_if=lambda payload: not payload.get(key),
            )
            if not last.ok or last.data is None:
                if rows:
                    break
                return last
            rows.extend(last.data[key])
            total = int((last.data.get("page_meta") or {}).get("total_count") or len(rows))
            if len(rows) >= total:
                break
        assert last is not None
        collected = {"rows": rows, "total_count": total, "truncated": len(rows) < total}
        if not last.ok:
            return self.result_like(last, collected)
        return last.map(lambda _: collected, empty_when_falsy=False)

    @staticmethod
    def result_like(result: SourceResult[Any], data: Any) -> SourceResult[Any]:
        """Keep the rows already read when a later page did not answer."""
        return replace(
            result,
            state=SourceState.OK,
            data=data,
            message="ChEMBL stopped answering part-way; the list is incomplete.",
        )

    async def targets_for_accession(self, accession: str) -> SourceResult[dict[str, Any]]:
        """Every ChEMBL target with this UniProt accession among its components."""
        return await self._list(
            "target", "targets", {"target_components__accession": accession}, record_id=accession
        )

    async def targets(self, target_chembl_ids: list[str]) -> SourceResult[dict[str, Any]]:
        return await self._list(
            "target", "targets", {"target_chembl_id__in": ",".join(sorted(set(target_chembl_ids)))}
        )

    async def mechanisms_for_targets(self, target_chembl_ids: list[str]) -> SourceResult[dict[str, Any]]:
        return await self._list(
            "mechanism", "mechanisms", {"target_chembl_id__in": ",".join(sorted(set(target_chembl_ids)))}
        )

    async def mechanisms_for_parent(self, parent_chembl_id: str) -> SourceResult[dict[str, Any]]:
        return await self._list(
            "mechanism",
            "mechanisms",
            {"parent_molecule_chembl_id": parent_chembl_id},
            record_id=parent_chembl_id,
        )

    async def indications_for_parent(self, parent_chembl_id: str) -> SourceResult[dict[str, Any]]:
        return await self._list(
            "drug_indication",
            "drug_indications",
            {"parent_molecule_chembl_id": parent_chembl_id},
            record_id=parent_chembl_id,
        )

    async def molecules(self, molecule_chembl_ids: list[str]) -> SourceResult[dict[str, Any]]:
        ids = sorted(set(molecule_chembl_ids))
        merged: list[dict[str, Any]] = []
        last: SourceResult[Any] | None = None
        for offset in range(0, len(ids), 100):
            last = await self._list(
                "molecule",
                "molecules",
                {"molecule_chembl_id__in": ",".join(ids[offset : offset + 100]), "only": MOLECULE_FIELDS},
            )
            if last.ok and last.data:
                merged.extend(last.data["rows"])
            elif not last.is_empty:
                break
        if last is None:
            return self.result(SourceState.EMPTY, message="No ChEMBL molecules to look up.")
        if merged and not last.ok:
            return self.result_like(last, {"rows": merged, "total_count": len(ids), "truncated": True})
        return last.map(lambda _: {"rows": merged, "total_count": len(merged), "truncated": False})

    async def molecule(self, molecule_chembl_id: str) -> SourceResult[dict[str, Any]]:
        release = await self.current_release()
        return await self.get_json(
            f"/molecule/{molecule_chembl_id}.json", record_id=molecule_chembl_id, release=release
        )

    async def molecule_by_inchikey(self, inchikey: str) -> SourceResult[dict[str, Any]]:
        result = await self._list(
            "molecule",
            "molecules",
            {"molecule_structures__standard_inchi_key": inchikey},
            record_id=inchikey,
        )
        mapped = result.map(lambda data: data["rows"][0] if data["rows"] else None)
        if mapped.ok and mapped.data:
            return mapped.with_record(mapped.data["molecule_chembl_id"])
        return mapped

    def _activity_filter(self, target_chembl_id: str) -> dict[str, Any]:
        return {
            "target_chembl_id": target_chembl_id,
            "pchembl_value__isnull": "false",
            "standard_relation": "=",
            "standard_units": "nM",
            "data_validity_comment__isnull": "true",
            "only": ACTIVITY_FIELDS,
        }

    async def top_activities(self, target_chembl_id: str) -> SourceResult[dict[str, Any]]:
        """The highest-pChEMBL qualifying rows of a target: used to choose which compounds to list.
        ChEMBL does not allow filtering on bao_format, so the assay format is checked by the caller."""
        params = {**self._activity_filter(target_chembl_id), "order_by": "-pchembl_value"}
        return await self._list("activity", "activities", params, record_id=target_chembl_id)

    async def activities_for_molecules(
        self, target_chembl_id: str, parent_chembl_ids: list[str], *, max_pages: int = 4
    ) -> SourceResult[dict[str, Any]]:
        """Every qualifying row of the listed parent molecules (salt forms included) against the target."""
        params = {
            **self._activity_filter(target_chembl_id),
            "parent_molecule_chembl_id__in": ",".join(sorted(set(parent_chembl_ids))),
        }
        return await self._list(
            "activity", "activities", params, record_id=target_chembl_id, max_pages=max_pages
        )

    async def similar(
        self, molecule_chembl_id: str, threshold: int, limit: int
    ) -> SourceResult[dict[str, Any]]:
        """Tanimoto similarity search as ChEMBL computes it; similarity is a percentage."""
        return await self._list(
            f"similarity/{quote(molecule_chembl_id, safe='')}/{threshold}",
            "molecules",
            {"only": f"{MOLECULE_FIELDS},similarity"},
            record_id=molecule_chembl_id,
            page_size=limit,
        )


chembl = ChemblSource()
