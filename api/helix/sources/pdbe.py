"""PDBe SIFTS: which PDB chains cover a UniProt protein, in UniProt canonical numbering."""

from typing import Any

from pydantic import BaseModel, Field

from helix.sources.base import SourceAdapter, SourceResult


class SiftsRegion(BaseModel):
    unp_start: int
    unp_end: int


class SiftsChain(BaseModel):
    """One row of best_structures: a chain of a PDB entry mapped onto the protein."""

    pdb_id: str
    chain_id: str
    entity_id: int | None = None
    experimental_method: str | None = None
    resolution: float | None = None
    tax_id: int | None = None
    unp_start: int
    unp_end: int
    entity_start: int | None = None
    entity_end: int | None = None
    coverage: float | None = None
    preferred_assembly_id: int | None = None
    observed_regions: list[SiftsRegion] = Field(default_factory=list)
    rank: int = Field(description="Position in the list as PDBe returns it, best first, from 1")


class SiftsSegment(BaseModel):
    """One aligned segment of mappings/uniprot/{pdb}. Entity numbering (label_seq_id) is linear
    with UniProt numbering inside a segment; author numbering is given at the segment ends."""

    uniprot_accession: str
    uniprot_name: str | None = None
    entity_id: int | None = None
    chain_id: str
    struct_asym_id: str | None = None
    unp_start: int
    unp_end: int
    entity_start: int | None = None
    entity_end: int | None = None
    author_start: int | None = None
    author_end: int | None = None
    author_start_insertion_code: str | None = None
    author_end_insertion_code: str | None = None
    identity: float | None = None


def _parse_best(payload: Any, accession: str) -> list[SiftsChain]:
    rows = payload.get(accession) or next(iter(payload.values()), [])
    chains = []
    for rank, row in enumerate(rows, start=1):
        chains.append(
            SiftsChain(
                pdb_id=str(row["pdb_id"]).upper(),
                chain_id=str(row["chain_id"]),
                entity_id=row.get("entity_id"),
                experimental_method=row.get("experimental_method"),
                resolution=row.get("resolution"),
                tax_id=row.get("tax_id"),
                unp_start=row["unp_start"],
                unp_end=row["unp_end"],
                entity_start=row.get("start"),
                entity_end=row.get("end"),
                coverage=row.get("coverage"),
                preferred_assembly_id=row.get("preferred_assembly_id"),
                observed_regions=[SiftsRegion(**region) for region in row.get("observed_regions") or []],
                rank=rank,
            )
        )
    return chains


def _parse_segments(payload: Any) -> list[SiftsSegment]:
    segments = []
    for entry in payload.values():
        for accession, record in (entry.get("UniProt") or {}).items():
            for mapping in record.get("mappings") or []:
                start = mapping.get("start") or {}
                end = mapping.get("end") or {}
                segments.append(
                    SiftsSegment(
                        uniprot_accession=accession,
                        uniprot_name=record.get("identifier") or record.get("name"),
                        entity_id=mapping.get("entity_id"),
                        chain_id=str(mapping["chain_id"]),
                        struct_asym_id=mapping.get("struct_asym_id"),
                        unp_start=mapping["unp_start"],
                        unp_end=mapping["unp_end"],
                        entity_start=start.get("residue_number"),
                        entity_end=end.get("residue_number"),
                        author_start=start.get("author_residue_number"),
                        author_end=end.get("author_residue_number"),
                        author_start_insertion_code=start.get("author_insertion_code") or None,
                        author_end_insertion_code=end.get("author_insertion_code") or None,
                        identity=mapping.get("identity"),
                    )
                )
    return segments


class PdbeSource(SourceAdapter):
    id = "pdbe"
    name = "PDBe SIFTS"
    base_url = "https://www.ebi.ac.uk/pdbe"
    homepage = "https://www.ebi.ac.uk/pdbe/"
    license = "CC0-1.0"
    license_url = "https://creativecommons.org/publicdomain/zero/1.0/"
    attribution = "Protein Data Bank in Europe (PDBe), SIFTS residue-level mapping"
    timeout = 20.0
    # PDBe answers 404 when a protein or entry has no mapping
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        if len(record_id) == 4:
            return f"https://www.ebi.ac.uk/pdbe/entry/pdb/{record_id.lower()}"
        return f"https://www.ebi.ac.uk/pdbe/pdbe-kb/proteins/{record_id}/structures"

    async def best_structures(self, accession: str) -> SourceResult[list[SiftsChain]]:
        """Every PDB chain mapped to the accession, in PDBe's own order (best first)."""
        accession = accession.strip().upper()
        raw = await self.get_json(f"/graph-api/uniprot/best_structures/{accession}", record_id=accession)
        return raw.map(lambda payload: _parse_best(payload, accession))

    async def uniprot_mappings(self, pdb_id: str) -> SourceResult[list[SiftsSegment]]:
        """SIFTS segments of one entry: UniProt range, chain, entity and author numbering."""
        pdb_id = pdb_id.strip().lower()
        raw = await self.get_json(f"/api/mappings/uniprot/{pdb_id}", record_id=pdb_id.upper())
        return raw.map(_parse_segments)


pdbe = PdbeSource()
