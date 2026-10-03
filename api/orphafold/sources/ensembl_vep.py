"""Ensembl VEP REST: predicted consequence of one HGVS notation on the MANE Select transcript."""

from typing import Any
from urllib.parse import quote

from orphafold.sources.base import SourceAdapter, SourceResult


def _pick_consequence(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    for row in rows:
        if row.get("mane_select") or "MANE_Select" in (row.get("mane") or []):
            return row
    for row in rows:
        if row.get("canonical"):
            return row
    return rows[0] if rows else None


class EnsemblVepSource(SourceAdapter):
    id = "ensembl_vep"
    name = "Ensembl VEP"
    base_url = "https://rest.ensembl.org"
    homepage = "https://www.ensembl.org/info/docs/tools/vep/index.html"
    license = "Apache-2.0"
    license_url = "https://www.ensembl.org/info/about/legal/disclaimer.html"
    timeout = 15.0
    rate_limit_per_second = 10.0
    # VEP answers 400 for a notation it cannot place
    empty_statuses = frozenset({204, 400})
    default_headers = {"Accept": "application/json", "Content-Type": "application/json"}

    async def consequence(self, hgvs: str) -> SourceResult[dict[str, Any]]:
        """Most severe consequence and the MANE Select transcript row for an HGVS notation.
        Predictor scores and co-located variant IDs are not read."""
        refseq = hgvs.startswith(("NM_", "NR_", "XM_"))
        raw = await self.get_json(
            f"/vep/human/hgvs/{quote(hgvs, safe=':.')}",
            params={
                "mane": 1,
                "hgvs": 1,
                "protein": 1,
                "numbers": 1,
                "variant_class": 1,
                "refseq": 1 if refseq else None,
            },
            record_id=hgvs,
        )

        def parse(payload: Any) -> dict[str, Any] | None:
            if not payload:
                return None
            row = payload[0]
            transcript = _pick_consequence(row.get("transcript_consequences") or []) or {}
            mane_select = transcript.get("mane_select")
            return {
                "input": row.get("input"),
                "assembly": row.get("assembly_name"),
                "chromosome": row.get("seq_region_name"),
                "start": row.get("start"),
                "end": row.get("end"),
                "variant_class": row.get("variant_class"),
                "most_severe_consequence": row.get("most_severe_consequence"),
                "transcript_id": transcript.get("transcript_id"),
                "mane_select": mane_select if isinstance(mane_select, str) else None,
                "is_mane_select": bool(mane_select) or "MANE_Select" in (transcript.get("mane") or []),
                "consequence_terms": list(transcript.get("consequence_terms") or []),
                "impact": transcript.get("impact"),
                "hgvsc": transcript.get("hgvsc"),
                "hgvsp": transcript.get("hgvsp"),
                "exon": transcript.get("exon"),
                "intron": transcript.get("intron"),
                "protein_start": transcript.get("protein_start"),
                "amino_acids": transcript.get("amino_acids"),
                "codons": transcript.get("codons"),
            }

        return raw.map(parse)


ensembl_vep = EnsemblVepSource()
