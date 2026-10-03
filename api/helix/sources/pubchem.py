"""PubChem PUG-REST: compound properties by InChIKey, for compounds ChEMBL does not hold."""

from typing import Any

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.schemas.common import EvidenceClass
from helix.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="pubchem",
        record_type="compound",
        evidence_class=EvidenceClass.CURATED_DATABASE,
        eco="ECO:0000322",
    )
)

# The isomeric structure is the property named SMILES; CanonicalSMILES drops stereochemistry.
PROPERTIES = "Title,SMILES,MolecularWeight,MolecularFormula,InChI,InChIKey"


class PubChemSource(SourceAdapter):
    id = "pubchem"
    name = "PubChem"
    base_url = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
    homepage = "https://pubchem.ncbi.nlm.nih.gov"
    license = "LicenseRef-NCBI-Policies"
    license_url = "https://www.ncbi.nlm.nih.gov/home/about/policies/"
    attribution = "PubChem (NCBI, U.S. National Library of Medicine)"
    timeout = 15.0
    rate_limit_per_second = 4.0
    cache_ttl = 7 * 24 * 3600
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://pubchem.ncbi.nlm.nih.gov/compound/{record_id}"

    async def properties_by_inchikey(self, inchikey: str) -> SourceResult[dict[str, Any]]:
        raw = await self.get_json(
            f"/compound/inchikey/{inchikey}/property/{PROPERTIES}/JSON", record_id=inchikey
        )
        mapped = raw.map(lambda payload: (payload["PropertyTable"]["Properties"] or [None])[0])
        if mapped.ok and mapped.data and mapped.data.get("CID"):
            return mapped.with_record(str(mapped.data["CID"]))
        return mapped


pubchem = PubChemSource()
