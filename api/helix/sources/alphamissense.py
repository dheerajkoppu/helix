"""AlphaMissense per-protein substitution file, as published by AlphaFold DB.

The file URL is read from the AFDB prediction record (amAnnotationsUrl) and never constructed.
Header: protein_variant,am_pathogenicity,am_class; classes LBen, Amb, LPath are kept verbatim.
"""

from dataclasses import dataclass, field

from helix.sources.base import SourceAdapter, SourceResult

CLASS_VOCABULARY = {
    "LBen": "likely_benign",
    "Amb": "ambiguous",
    "LPath": "likely_pathogenic",
    "BENIGN": "likely_benign",
    "AMBIGUOUS": "ambiguous",
    "PATHOGENIC": "likely_pathogenic",
}
CLINICAL_DISCLAIMER = "AlphaMissense has not been validated for, and is not approved for, any clinical use."


@dataclass(slots=True)
class AlphaMissenseTable:
    """Substitutions by position: {position: {alternate: (pathogenicity, source class)}}."""

    references: dict[int, str] = field(default_factory=dict)
    substitutions: dict[int, dict[str, tuple[float, str]]] = field(default_factory=dict)


def _parse(text: str) -> AlphaMissenseTable:
    table = AlphaMissenseTable()
    lines = text.splitlines()
    if not lines or not lines[0].startswith("protein_variant"):
        raise ValueError("unexpected AlphaMissense header")
    for line in lines[1:]:
        if not line:
            continue
        variant, score, source_class = line.split(",")
        position = int(variant[1:-1])
        table.references[position] = variant[0]
        table.substitutions.setdefault(position, {})[variant[-1]] = (float(score), source_class)
    return table


class AlphaMissenseSource(SourceAdapter):
    id = "alphamissense"
    name = "AlphaMissense (AlphaFold DB file)"
    base_url = "https://alphafold.ebi.ac.uk/files"
    homepage = "https://alphafold.ebi.ac.uk"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    attribution = (
        "AlphaMissense Copyright (2023) DeepMind Technologies Limited; "
        "Cheng et al., Science 2023, doi:10.1126/science.adg7492"
    )
    timeout = 25.0
    cache_ttl = 7 * 24 * 3600
    empty_statuses = frozenset({204, 404})

    async def substitutions(self, url: str, entry_id: str) -> SourceResult[AlphaMissenseTable]:
        raw = await self.get_text(
            url, record_id=entry_id, record_url=f"https://alphafold.ebi.ac.uk/entry/{entry_id}"
        )
        return raw.map(_parse, empty_when_falsy=False)


alphamissense = AlphaMissenseSource()
