"""IntAct curated molecular interactions through PSICQUIC MITAB 2.7, which is about a hundred
times lighter than the IntAct JSON service (docs/research/data-apis.md section 3.16)."""

import re
from typing import Any

from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass
from orphafold.sources.base import SourceAdapter, SourceResult

# Each IntAct row is one curated experiment with its detection method and publication
register_evidence_rule(
    EvidenceRule(
        database="intact",
        record_type="interaction",
        evidence_class=EvidenceClass.EXPERIMENTAL,
        eco="ECO:0000006",
        scheme="intact_miscore",
    )
)

_MI_TERM = re.compile(r'psi-mi:"(MI:\d+)"\(([^)]*)\)')
_ISOFORM = re.compile(r"-\d+$")


def _mi_term(field: str) -> tuple[str | None, str | None]:
    match = _MI_TERM.search(field)
    return (match.group(1), match.group(2)) if match else (None, None)


def _tagged(field: str, prefix: str) -> list[str]:
    return [part[len(prefix) :] for part in field.split("|") if part.startswith(prefix)]


def _gene_name(aliases: str) -> str | None:
    for suffix in ("(gene name)", "(display_short)"):
        for part in aliases.split("|"):
            if part.endswith(suffix):
                return part.split(":", 1)[1][: -len(suffix)]
    return None


def _tax_id(field: str) -> str | None:
    ids = _tagged(field, "taxid:")
    return ids[0].split("(")[0] if ids else None


def parse_mitab(text: str, accession: str) -> list[dict[str, Any]]:
    """One row per curated interaction evidence, oriented so the query protein is side A."""
    rows = []
    for line in text.splitlines():
        columns = line.split("\t")
        if len(columns) < 15:
            continue
        ids = [columns[0].removeprefix("uniprotkb:"), columns[1].removeprefix("uniprotkb:")]
        query_side = next(
            (index for index, value in enumerate(ids) if _ISOFORM.sub("", value) == accession), None
        )
        if query_side is None:
            continue
        partner_side = 1 - query_side
        method_id, method = _mi_term(columns[6])
        type_id, interaction_type = _mi_term(columns[11])
        scores = _tagged(columns[14], "intact-miscore:")
        acs = _tagged(columns[13], "intact:")
        features = columns[36 + query_side] if len(columns) > 37 else ""
        rows.append(
            {
                "interaction_ac": acs[0] if acs else None,
                "partner_id": ids[partner_side],
                "partner_is_uniprot": columns[partner_side].startswith("uniprotkb:"),
                "partner_symbol": _gene_name(columns[4 + partner_side]),
                "partner_tax_id": _tax_id(columns[9 + partner_side]),
                "self_interaction": ids[0] == ids[1],
                "method_id": method_id,
                "method": method,
                "type_id": type_id,
                "type": interaction_type,
                "pmids": _tagged(columns[8], "pubmed:"),
                "mi_score": float(scores[0]) if scores else None,
                "negative": len(columns) > 35 and columns[35].strip().lower() == "true",
                "query_mutated": "mutation" in features.lower(),
                "expansion": _mi_term(columns[15])[1],
            }
        )
    return rows


class IntActSource(SourceAdapter):
    id = "intact"
    name = "IntAct"
    base_url = "https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search"
    homepage = "https://www.ebi.ac.uk/intact"
    license = "CC-BY-4.0"
    license_url = "https://www.ebi.ac.uk/intact/download"
    attribution = "IntAct Molecular Interaction Database, EMBL-EBI"
    timeout = 30.0

    def record_url(self, record_id: str) -> str | None:
        if record_id.startswith("EBI-"):
            return f"{self.homepage}/details/interaction/{record_id}"
        return f"{self.homepage}/search?query={record_id}"

    async def interactions(self, accession: str, *, limit: int = 500) -> SourceResult[list[dict[str, Any]]]:
        raw = await self.get_text(
            f"/query/id:{accession}",
            params={"format": "tab27", "firstResult": 0, "maxResults": limit},
            record_id=accession,
        )
        return raw.map(lambda text: parse_mitab(text, accession))


intact = IntActSource()
