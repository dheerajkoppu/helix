"""Ensembl REST: gene lookup with transcripts and MANE annotation.

docs/research/data-apis.md section 3.8. The content type is always sent as a parameter because a
request without it answers HTML. IDs are stored unversioned with the version beside them.
"""

import re
from typing import Any

from helix.sources.base import SourceAdapter, SourceResult

_DESCRIPTION_SOURCE_RE = re.compile(r"\s*\[Source:(?P<source>[^;\]]+);Acc:(?P<accession>[^\]]+)\]\s*$")


def _parse_transcript(row: dict[str, Any]) -> dict[str, Any]:
    mane = row.get("MANE") or []
    translation = row.get("Translation") or {}
    return {
        "id": row["id"],
        "version": row.get("version"),
        "display_name": row.get("display_name"),
        "biotype": row.get("biotype"),
        "is_canonical": bool(row.get("is_canonical")),
        "mane": [
            {"type": item.get("type"), "refseq_match": item.get("refseq_match")}
            for item in mane
            if item.get("type")
        ],
        "length": row.get("length"),
        "start": row.get("start"),
        "end": row.get("end"),
        "exon_count": len(row["Exon"]) if isinstance(row.get("Exon"), list) else None,
        "protein_id": translation.get("id"),
        "protein_version": translation.get("version"),
        "protein_length": translation.get("length"),
    }


def _parse_gene(payload: dict[str, Any]) -> dict[str, Any]:
    description = payload.get("description")
    name, name_source, name_accession = description, None, None
    match = _DESCRIPTION_SOURCE_RE.search(description or "")
    if match and description:
        name = description[: match.start()].strip() or None
        name_source, name_accession = match.group("source"), match.group("accession")
    return {
        "id": payload["id"],
        "version": payload.get("version"),
        "symbol": payload.get("display_name"),
        "name": name,
        "name_source": name_source,
        "name_accession": name_accession,
        "biotype": payload.get("biotype"),
        "assembly": payload.get("assembly_name"),
        "chromosome": payload.get("seq_region_name"),
        "start": payload.get("start"),
        "end": payload.get("end"),
        "strand": payload.get("strand"),
        "canonical_transcript": payload.get("canonical_transcript"),
        "transcripts": [_parse_transcript(row) for row in payload.get("Transcript", [])],
    }


class EnsemblSource(SourceAdapter):
    id = "ensembl"
    name = "Ensembl"
    base_url = "https://rest.ensembl.org"
    homepage = "https://www.ensembl.org"
    license = "Apache-2.0"
    license_url = "https://www.ensembl.org/info/about/legal/disclaimer.html"
    attribution = "Ensembl (EMBL-EBI)"
    timeout = 25.0
    rate_limit_per_second = 10.0
    default_headers = {"Accept": "application/json", "Content-Type": "application/json"}

    _release: str | None = None

    def record_url(self, record_id: str) -> str | None:
        if record_id.startswith("ENST"):
            return f"https://www.ensembl.org/Homo_sapiens/Transcript/Summary?t={record_id}"
        return f"https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={record_id}"

    async def data_release(self) -> str | None:
        """Ensembl release number served by the REST API. None when the call fails."""
        if self._release is None:
            result = await self.get_json("/info/data", params={"content-type": "application/json"})
            releases = result.data.get("releases") if result.ok and isinstance(result.data, dict) else None
            if releases:
                self._release = str(releases[0])
        return self._release

    async def gene(self, ensembl_gene_id: str) -> SourceResult[dict[str, Any]]:
        """Gene with every transcript; the MANE Select transcript carries a non-empty `mane`."""
        ensembl_gene_id = ensembl_gene_id.strip().split(".")[0]
        raw = await self.get_json(
            f"/lookup/id/{ensembl_gene_id}",
            params={"expand": 1, "mane": 1, "content-type": "application/json"},
            record_id=ensembl_gene_id,
            release=await self.data_release(),
            empty_statuses={400, 404},
        )
        return raw.map(_parse_gene)

    async def gene_by_symbol(self, symbol: str) -> SourceResult[dict[str, Any]]:
        """Human gene by display symbol. Empty when Ensembl has no gene of that name."""
        symbol = symbol.strip()
        raw = await self.get_json(
            f"/lookup/symbol/homo_sapiens/{symbol}",
            params={"expand": 1, "mane": 1, "content-type": "application/json"},
            record_id=symbol,
            release=await self.data_release(),
            empty_statuses={400, 404},
            empty_if=lambda payload: payload.get("object_type") != "Gene",
        )
        parsed = raw.map(_parse_gene)
        if parsed.ok and parsed.data:
            return parsed.with_record(parsed.data["id"], self.record_url(parsed.data["id"]))
        return parsed


ensembl = EnsemblSource()
