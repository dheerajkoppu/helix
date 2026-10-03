"""MaveDB: multiplexed assays of variant effect (experimental measurements).

Rules from docs/research/variant-effect.md section 3.7: hgvs_pro positions are relative to the
assayed target sequence and the declared offsets are inconsistent between score sets, so the
target sequence is located in the UniProt sequence here and the declared offset is only reported.
"""

import csv
import io
from typing import Any

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.schemas.common import EvidenceClass
from helix.sources.base import SourceAdapter, SourceResult

register_evidence_rule(
    EvidenceRule(
        database="mavedb",
        record_type="variant_score",
        evidence_class=EvidenceClass.EXPERIMENTAL,
        eco="ECO:0000006",
        scheme="mavedb_score",
    )
)

_BASES = "TCAG"
_AMINO_ACIDS = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
_CODONS = {
    first + second + third: _AMINO_ACIDS[16 * i + 4 * j + k]
    for i, first in enumerate(_BASES)
    for j, second in enumerate(_BASES)
    for k, third in enumerate(_BASES)
}


def translate(dna: str) -> str:
    dna = dna.upper().replace("U", "T")
    return "".join(_CODONS.get(dna[index : index + 3], "X") for index in range(0, len(dna) - 2, 3))


def _score_set(row: dict[str, Any]) -> dict[str, Any]:
    targets = []
    for gene in row.get("targetGenes") or []:
        sequence = gene.get("targetSequence") or {}
        text = sequence.get("sequence") or ""
        sequence_type = sequence.get("sequenceType")
        targets.append(
            {
                "name": gene.get("name"),
                "category": gene.get("category"),
                "sequence_type": sequence_type,
                "protein_sequence": translate(text) if sequence_type == "dna" else text.upper(),
                "declared_offsets": [
                    {
                        "database": (identifier.get("identifier") or {}).get("dbName"),
                        "identifier": (identifier.get("identifier") or {}).get("identifier"),
                        "offset": identifier.get("offset"),
                    }
                    for identifier in gene.get("externalIdentifiers") or []
                ],
            }
        )
    return {
        "urn": row["urn"],
        "title": row.get("title"),
        "short_description": row.get("shortDescription"),
        "published_date": row.get("publishedDate"),
        "num_variants": row.get("numVariants"),
        "license": (row.get("license") or {}).get("shortName"),
        "license_url": (row.get("license") or {}).get("link"),
        "publications": [
            {"database": item.get("dbName"), "identifier": item.get("identifier"), "url": item.get("url")}
            for item in row.get("primaryPublicationIdentifiers") or []
        ],
        "targets": targets,
    }


class MaveDBSource(SourceAdapter):
    id = "mavedb"
    name = "MaveDB"
    base_url = "https://api.mavedb.org/api/v1"
    homepage = "https://www.mavedb.org"
    license = "LicenseRef-MaveDB-per-score-set"
    attribution = "MaveDB: Rubin et al., Genome Biol 2025, doi:10.1186/s13059-025-03476-y"
    timeout = 20.0
    max_concurrency = 3

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.mavedb.org/score-sets/{record_id.split('#')[0]}"

    async def score_sets(self, accession: str) -> SourceResult[list[dict[str, Any]]]:
        """Published score sets whose text matches the accession (GET /genes reports none)."""
        raw = await self.post_json(
            "/score-sets/search",
            json_body={"text": accession, "published": True, "limit": 50},
            record_id=accession,
        )
        return raw.map(lambda payload: [_score_set(row) for row in payload.get("scoreSets") or []])

    async def scores(self, urn: str) -> SourceResult[list[dict[str, str]]]:
        raw = await self.get_text(f"/score-sets/{urn}/scores", record_id=urn, ttl=7 * 24 * 3600)
        return raw.map(lambda text: list(csv.DictReader(io.StringIO(text))))

    async def calibrations(self, urn: str) -> SourceResult[list[dict[str, Any]]]:
        """Functional class ranges published with the score set. 404 means the set has none."""
        return await self.get_json(
            f"/score-calibrations/score-set/{urn}", record_id=urn, empty_statuses={404}
        )


mavedb = MaveDBSource()
