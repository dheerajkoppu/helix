"""EBI Proteins API, variation endpoint: UniProt natural variants and the canonical sequence."""

from typing import Any

from orphafold.sources.base import SourceAdapter, SourceResult

# Variants reviewed by UniProt curators; large_scale_study rows are imported, not curated
CURATED_SOURCE_TYPES = frozenset({"uniprot", "mixed"})


def _evidences(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        {
            "code": row.get("code"),
            "source": (row.get("source") or {}).get("name"),
            "id": (row.get("source") or {}).get("id"),
            "url": (row.get("source") or {}).get("url"),
        }
        for row in rows or []
        if row.get("code")
    ]


def _position(value: Any) -> int | None:
    text = str(value) if value is not None else ""
    return int(text) if text.isdigit() else None


def parse_feature(feature: dict[str, Any]) -> dict[str, Any]:
    xrefs = [
        {"db": xref.get("name"), "id": xref.get("id"), "url": xref.get("url")}
        for xref in feature.get("xrefs") or []
        if xref.get("name") and xref.get("id")
    ]
    return {
        "ft_id": feature.get("ftId"),
        "begin": _position(feature.get("begin")),
        "end": _position(feature.get("end")),
        "wild_type": feature.get("wildType"),
        "mutated_type": feature.get("mutatedType") or feature.get("alternativeSequence"),
        "consequence": feature.get("consequenceType"),
        "source_type": feature.get("sourceType"),
        "somatic": feature.get("somaticStatus") == 1,
        "hgvs_g": list(feature.get("genomicLocation") or []),
        "descriptions": [
            {"value": row.get("value"), "sources": row.get("sources") or []}
            for row in feature.get("descriptions") or []
            if row.get("value")
        ],
        "associations": [
            {
                "name": row.get("name"),
                "is_disease": bool(row.get("disease")),
                "xrefs": [
                    {"db": xref.get("name"), "id": xref.get("id"), "url": xref.get("url")}
                    for xref in row.get("dbReferences") or []
                ],
                "evidences": _evidences(row.get("evidences")),
            }
            for row in feature.get("association") or []
            if row.get("name")
        ],
        "evidences": _evidences(feature.get("evidences")),
        "xrefs": xrefs,
        "rsid": next((xref["id"] for xref in xrefs if xref["db"] == "dbSNP"), None),
    }


class EbiProteinsVariationSource(SourceAdapter):
    id = "ebi_proteins"
    name = "UniProt variants (EBI Proteins API)"
    base_url = "https://www.ebi.ac.uk/proteins/api"
    homepage = "https://www.ebi.ac.uk/proteins/api/doc/"
    license = "CC-BY-4.0"
    license_url = "https://www.uniprot.org/help/license"
    attribution = "UniProt Consortium"
    timeout = 30.0
    empty_statuses = frozenset({204, 404})
    release_header = "x-uniprot-release"

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.uniprot.org/uniprotkb/{record_id}/variant-viewer"

    async def variation(self, accession: str) -> SourceResult[dict[str, Any]]:
        """Canonical sequence and UniProt-curated natural variants of a protein."""
        raw = await self.get_json(f"/variation/{accession}", record_id=accession, ttl=7 * 24 * 3600)

        def parse(payload: Any) -> dict[str, Any]:
            features = payload.get("features") or []
            return {
                "accession": payload.get("accession"),
                "gene_symbol": payload.get("geneName"),
                "sequence": payload.get("sequence"),
                "feature_count": len(features),
                "curated": [
                    parse_feature(feature)
                    for feature in features
                    if feature.get("sourceType") in CURATED_SOURCE_TYPES
                ],
            }

        return raw.map(parse)


ebi_variation = EbiProteinsVariationSource()
