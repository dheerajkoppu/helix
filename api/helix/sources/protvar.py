"""EBI ProtVar: per-residue and per-substitution annotations in UniProt canonical numbering.

Rules from docs/research/variant-effect.md section 3.1: /score takes the one-letter code only (a
three-letter code silently returns conservation alone), the objects omit acc/pos/mt, and "no
coverage" arrives as [] with 200, as 404 (interaction) or as null fields (function).
"""

from typing import Any

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.schemas.common import EvidenceClass
from helix.sources.base import SourceAdapter, SourceResult

for _record_type in ("popeve", "esm1b", "missense3d", "pocket", "interface", "cadd"):
    register_evidence_rule(
        EvidenceRule(
            database="protvar",
            record_type=_record_type,
            evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
            eco="ECO:0007669",
        )
    )


class ProtVarSource(SourceAdapter):
    id = "protvar"
    name = "EBI ProtVar"
    base_url = "https://www.ebi.ac.uk/ProtVar/api"
    homepage = "https://www.ebi.ac.uk/ProtVar/"
    license = "CC-BY-4.0"
    license_url = "https://ftp.ebi.ac.uk/pub/databases/ProtVar/LICENCE"
    attribution = "ProtVar (EMBL-EBI): Stephenson et al., Nucleic Acids Res 2024, doi:10.1093/nar/gkae413"
    release = "data release 2.1"
    timeout = 15.0
    max_concurrency = 6

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.ebi.ac.uk/ProtVar/query?search={record_id}"

    async def scores(
        self, accession: str, position: int, alternate: str | None
    ) -> SourceResult[list[dict[str, Any]]]:
        """Score objects keyed by `type` (CONSERV, ESM, AM, POPEVE, EVE, M3D). Without an alternate
        only conservation is requested, because the unlabelled 19-object answer cannot be attributed."""
        params = {"mt": alternate} if alternate else {"type": "CONSERV"}
        record = f"{accession}:{position}:{alternate}" if alternate else f"{accession}:{position}"
        raw = await self.get_json(f"/score/{accession}/{position}", params=params, record_id=record)
        return raw.map(lambda payload: [row for row in payload if isinstance(row, dict)])

    async def foldx(
        self, accession: str, position: int, alternate: str
    ) -> SourceResult[list[dict[str, Any]]]:
        return await self.get_json(
            f"/prediction/foldx/{accession}/{position}",
            params={"variantAA": alternate},
            record_id=f"{accession}:{position}:{alternate}",
            empty_statuses={404},
        )

    async def pockets(self, accession: str, position: int) -> SourceResult[list[dict[str, Any]]]:
        return await self.get_json(
            f"/prediction/pocket/{accession}/{position}",
            record_id=f"{accession}:{position}",
            empty_statuses={404},
        )

    async def interfaces(self, accession: str, position: int) -> SourceResult[list[dict[str, Any]]]:
        return await self.get_json(
            f"/prediction/interaction/{accession}/{position}",
            record_id=f"{accession}:{position}",
            empty_statuses={404},
        )

    async def function(
        self, accession: str, position: int, alternate: str | None
    ) -> SourceResult[dict[str, Any]]:
        """UniProt entry facts and the features overlapping the residue."""
        raw = await self.get_json(
            f"/function/{accession}/{position}",
            params={"variantAA": alternate} if alternate else None,
            record_id=accession,
        )
        return raw.map(
            lambda payload: {
                "entry_id": payload.get("entryId"),
                "last_updated": payload.get("lastUpdated"),
                "features": [row for row in payload.get("features") or [] if isinstance(row, dict)],
            },
            empty_when_falsy=False,
        )

    async def cadd(
        self, accession: str, reference: str, position: int, alternate: str
    ) -> SourceResult[list[dict[str, Any]]]:
        """CADD PHRED per derived genomic variant, read from the mapping response."""

        def parse(payload: dict[str, Any]) -> list[dict[str, Any]]:
            rows = []
            for entry in payload["content"]["inputs"]:
                for variant in entry.get("derivedGenomicVariants") or []:
                    for gene in variant.get("genes") or []:
                        if gene.get("caddScore") is not None:
                            rows.append(
                                {
                                    "genomic_variant": f"{variant['chromosome']}-{variant['position']}-"
                                    f"{variant['refBase']}-{variant['altBase']}",
                                    "phred": gene["caddScore"],
                                }
                            )
            return rows

        raw = await self.get_json(
            "/mapping",
            params={"q": f"{accession} {reference}{position}{alternate}"},
            record_id=f"{accession}:{position}:{alternate}",
        )
        return raw.map(parse)


protvar = ProtVarSource()
