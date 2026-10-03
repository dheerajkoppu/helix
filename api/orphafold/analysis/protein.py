"""The UniProt canonical sequence and domain features a construct is built from."""

from dataclasses import dataclass, field
from typing import Any

from orphafold.identifiers import is_uniprot_accession
from orphafold.schemas.common import Provenance, SourceState
from orphafold.schemas.compare import ConstructDomain
from orphafold.sources.base import SourceResult
from orphafold.sources.uniprot import uniprot


@dataclass(slots=True)
class ProteinRecord:
    accession: str
    sequence: str
    gene_symbol: str | None = None
    protein_name: str | None = None
    entry_name: str | None = None
    entry_version: str | None = None
    sequence_version: str | None = None
    domains: list[ConstructDomain] = field(default_factory=list)
    provenance: Provenance | None = None

    @property
    def length(self) -> int:
        return len(self.sequence)


def _exact(location: dict[str, Any], end: str) -> int | None:
    point = location.get(end) or {}
    return point.get("value") if point.get("modifier", "EXACT") == "EXACT" else None


def _parse(entry: dict[str, Any]) -> ProteinRecord | None:
    sequence = (entry.get("sequence") or {}).get("value")
    if not sequence:
        return None
    domains: list[ConstructDomain] = []
    for feature in entry.get("features") or []:
        if feature.get("type") != "Domain":
            continue
        location = feature.get("location") or {}
        start, end = _exact(location, "start"), _exact(location, "end")
        if start is None or end is None or not 1 <= start <= end <= len(sequence):
            continue
        domains.append(ConstructDomain(name=feature.get("description") or "Domain", start=start, end=end))
    genes = entry.get("genes") or []
    recommended = (entry.get("proteinDescription") or {}).get("recommendedName") or {}
    audit = entry.get("entryAudit") or {}
    return ProteinRecord(
        accession=entry.get("primaryAccession", ""),
        sequence=sequence,
        gene_symbol=(genes[0].get("geneName") or {}).get("value") if genes else None,
        protein_name=(recommended.get("fullName") or {}).get("value"),
        entry_name=entry.get("uniProtkbId"),
        entry_version=str(audit["entryVersion"]) if audit.get("entryVersion") else None,
        sequence_version=str(audit["sequenceVersion"]) if audit.get("sequenceVersion") else None,
        domains=domains,
    )


async def fetch_protein(accession: str) -> SourceResult[ProteinRecord]:
    """Canonical sequence and Domain features of one UniProtKB entry."""
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        return uniprot.result(SourceState.EMPTY, message=f"{accession} is not a UniProt accession.")
    raw = await uniprot.get_json(f"/uniprotkb/{accession}.json", record_id=accession)
    parsed = raw.map(_parse)
    if parsed.ok and parsed.data is not None:
        parsed.data.provenance = parsed.provenance
    return parsed
