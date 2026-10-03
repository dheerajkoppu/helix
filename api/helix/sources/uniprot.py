"""UniProtKB REST: protein entries, FASTA and gene-to-accession resolution.

docs/research/data-apis.md section 3.1. One entry call returns names, function, features with ECO
evidence, isoforms and cross-references. The release is read from the x-uniprot-release header.
"""

from typing import Any

from helix.identifiers import is_uniprot_accession
from helix.schemas.common import SourceState
from helix.sources.base import SourceAdapter, SourceResult


class UniProtSource(SourceAdapter):
    id = "uniprot"
    name = "UniProtKB"
    base_url = "https://rest.uniprot.org"
    homepage = "https://www.uniprot.org"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    attribution = "UniProt Consortium, CC-BY-4.0"
    timeout = 20.0
    release_header = "x-uniprot-release"
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.uniprot.org/uniprotkb/{record_id}/entry"

    async def entry(self, accession: str) -> SourceResult[dict[str, Any]]:
        """The full UniProtKB entry as returned by the API."""
        accession = accession.strip().upper()
        if not is_uniprot_accession(accession):
            return self.result(SourceState.EMPTY, message=f"{accession} is not a UniProt accession.")
        return await self.get_json(f"/uniprotkb/{accession}.json", record_id=accession)

    async def fasta(self, accession: str) -> SourceResult[str]:
        accession = accession.strip().upper()
        if not is_uniprot_accession(accession):
            return self.result(SourceState.EMPTY, message=f"{accession} is not a UniProt accession.")
        return await self.get_text(f"/uniprotkb/{accession}.fasta", record_id=accession)

    async def reviewed_entry_for_gene(self, symbol: str) -> SourceResult[dict[str, Any]]:
        """The reviewed human entry whose primary gene name is the symbol. Empty when none matches."""
        symbol = symbol.strip()
        raw = await self.get_json(
            "/uniprotkb/search",
            params={
                "query": f"gene_exact:{symbol} AND organism_id:9606 AND reviewed:true",
                "fields": "accession,id,gene_primary,gene_names,protein_name,length,xref_hgnc",
                "format": "json",
                "size": 10,
            },
            record_id=symbol,
            record_url=f"https://www.uniprot.org/uniprotkb?query=gene_exact:{symbol}+AND+organism_id:9606",
            empty_if=lambda payload: not payload.get("results"),
        )

        def pick(payload: dict[str, Any]) -> dict[str, Any] | None:
            for row in payload["results"]:
                primary = [gene.get("geneName", {}).get("value", "") for gene in row.get("genes", [])]
                if symbol.upper() in (name.upper() for name in primary):
                    return row
            return None

        picked = raw.map(pick)
        if picked.ok and picked.data:
            accession = picked.data["primaryAccession"]
            return picked.with_record(accession, self.record_url(accession))
        return picked


uniprot = UniProtSource()
