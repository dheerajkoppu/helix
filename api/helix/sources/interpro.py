"""InterPro: integrated entries matched on a UniProt protein, with their locations.

docs/research/data-apis.md section 3.9. No match answers 204. Entries are signature matches computed
against the sequence, so they are classed as computational predictions.
"""

from typing import Any

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.schemas.common import EvidenceClass
from helix.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="interpro",
        record_type=None,
        evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
        eco="ECO:0000256",
        modifiers=("auto",),
    )
)

MAX_PAGES = 5


def _parse_entry(row: dict[str, Any], accession: str) -> dict[str, Any]:
    metadata = row["metadata"]
    locations: list[dict[str, Any]] = []
    for protein in row.get("proteins", []):
        if protein.get("accession", "").upper() != accession:
            continue
        for location in protein.get("entry_protein_locations") or []:
            for fragment in location.get("fragments", []):
                locations.append(
                    {
                        "start": int(fragment["start"]),
                        "end": int(fragment["end"]),
                        "model": location.get("model"),
                        "score": location.get("score"),
                    }
                )
    locations.sort(key=lambda location: (location["start"], location["end"]))
    signatures = [
        {"database": database, "accession": signature, "name": name}
        for database, members in (metadata.get("member_databases") or {}).items()
        for signature, name in (members or {}).items()
    ]
    return {
        "accession": metadata["accession"],
        "name": metadata.get("name"),
        "type": metadata.get("type"),
        "source_database": metadata.get("source_database"),
        "integrated": metadata.get("integrated"),
        "signatures": signatures,
        "go_terms": [
            {"id": term.get("identifier"), "name": term.get("name")} for term in metadata.get("go_terms") or []
        ],
        "locations": locations,
    }


class InterProSource(SourceAdapter):
    id = "interpro"
    name = "InterPro"
    base_url = "https://www.ebi.ac.uk/interpro/api"
    homepage = "https://www.ebi.ac.uk/interpro"
    license = "CC0-1.0"
    license_url = "https://creativecommons.org/publicdomain/zero/1.0/"
    attribution = "InterPro (EMBL-EBI), CC0"
    timeout = 20.0
    release_header = "interpro-version"

    def record_url(self, record_id: str) -> str | None:
        if record_id.upper().startswith("IPR"):
            return f"https://www.ebi.ac.uk/interpro/entry/InterPro/{record_id}/"
        return f"https://www.ebi.ac.uk/interpro/protein/UniProt/{record_id}/"

    async def entries(self, accession: str) -> SourceResult[list[dict[str, Any]]]:
        """Integrated InterPro entries of a protein, each with its residue ranges."""
        accession = accession.strip().upper()
        first = await self.get_json(
            f"/entry/interpro/protein/uniprot/{accession}",
            params={"page_size": 200},
            record_id=accession,
        )
        if not first.ok or first.data is None:
            return first
        rows = list(first.data.get("results", []))
        next_url = first.data.get("next")
        pages = 1
        while next_url and pages < MAX_PAGES:
            page = await self.get_json(next_url, record_id=accession)
            if not page.ok or page.data is None:
                break
            rows.extend(page.data.get("results", []))
            next_url = page.data.get("next")
            pages += 1
        return first.map(lambda _: [_parse_entry(row, accession) for row in rows])


interpro = InterProSource()
