"""RCSB PDB: entry metadata through the Data API (GraphQL) and coordinate files."""

from typing import Any

from orphafold.schemas.common import SourceState
from orphafold.sources.base import SourceAdapter, SourceResult

BATCH_SIZE = 200

_ENTITY_FIELDS = """
polymer_entities{
  rcsb_id
  entity_poly{rcsb_mutation_count}
  rcsb_polymer_entity{pdbx_description pdbx_mutation}
  rcsb_polymer_entity_container_identifiers{entity_id auth_asym_ids asym_ids uniprot_ids}
  rcsb_polymer_entity_align{
    reference_database_name reference_database_accession
    aligned_regions{entity_beg_seq_id ref_beg_seq_id length}
  }
}
"""

_ENTRY_FIELDS = (
    """
rcsb_id
struct{title}
exptl{method}
rcsb_entry_info{resolution_combined experimental_method nonpolymer_bound_components}
rcsb_accession_info{deposit_date initial_release_date revision_date}
refine{ls_R_factor_R_free}
rcsb_primary_citation{
  pdbx_database_id_PubMed pdbx_database_id_DOI title year journal_abbrev rcsb_authors
}
"""
    + _ENTITY_FIELDS
)

_LIGAND_FIELDS = """
nonpolymer_entities{
  nonpolymer_comp{
    chem_comp{id name formula formula_weight}
    rcsb_chem_comp_descriptor{InChIKey SMILES}
  }
  rcsb_nonpolymer_entity_container_identifiers{auth_asym_ids}
}
"""

_LIGAND_SITE_FIELDS = """
nonpolymer_entities{
  nonpolymer_comp{
    chem_comp{id name formula formula_weight}
    rcsb_chem_comp_descriptor{InChIKey SMILES}
  }
  rcsb_nonpolymer_entity_container_identifiers{auth_asym_ids}
  nonpolymer_entity_instances{
    rcsb_nonpolymer_entity_instance_container_identifiers{asym_id auth_asym_id auth_seq_id}
    rcsb_target_neighbors{
      target_asym_id target_entity_id target_seq_id target_auth_seq_id target_comp_id distance
    }
  }
}
"""

ENTRIES_QUERY = f"query($ids:[String!]!){{entries(entry_ids:$ids){{{_ENTRY_FIELDS}{_LIGAND_FIELDS}}}}}"
LIGAND_SITES_QUERY = (
    f"query($ids:[String!]!){{entries(entry_ids:$ids){{rcsb_id {_ENTITY_FIELDS}{_LIGAND_SITE_FIELDS}}}}}"
)

FILE_URLS = {
    "cif": "https://files.rcsb.org/download/{id}.cif",
    "pdb": "https://files.rcsb.org/download/{id}.pdb",
    "bcif": "https://models.rcsb.org/{id}.bcif",
}


class RcsbSource(SourceAdapter):
    id = "rcsb_pdb"
    name = "RCSB PDB"
    base_url = "https://data.rcsb.org"
    homepage = "https://www.rcsb.org"
    license = "CC0-1.0"
    license_url = "https://creativecommons.org/publicdomain/zero/1.0/"
    attribution = "RCSB Protein Data Bank (RCSB.org); structure authors are named in the citation"
    timeout = 20.0
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.rcsb.org/structure/{record_id.upper()}"

    def file_url(self, pdb_id: str, file_format: str) -> str:
        return FILE_URLS[file_format].format(id=pdb_id.upper())

    async def _entries(self, query: str, pdb_ids: list[str]) -> SourceResult[dict[str, dict[str, Any]]]:
        ids = sorted({pdb_id.upper() for pdb_id in pdb_ids})
        if not ids:
            return self.result(SourceState.EMPTY, message="No PDB entries to look up.")
        merged: dict[str, dict[str, Any]] = {}
        last: SourceResult[Any] | None = None
        for offset in range(0, len(ids), BATCH_SIZE):
            batch = ids[offset : offset + BATCH_SIZE]
            last = await self.graphql(
                query,
                {"ids": batch},
                path="/graphql",
                root="entries",
                record_id=batch[0] if len(batch) == 1 else None,
            )
            if not last.ok or last.data is None:
                if last.is_empty:
                    continue
                return last
            for entry in last.data:
                if entry:
                    merged[entry["rcsb_id"]] = entry
        assert last is not None
        return last.map(lambda _: merged)

    async def entries(self, pdb_ids: list[str]) -> SourceResult[dict[str, dict[str, Any]]]:
        """Entry metadata keyed by PDB ID: method, resolution, dates, citation, entities, ligands."""
        return await self._entries(ENTRIES_QUERY, pdb_ids)

    async def ligand_sites(self, pdb_id: str) -> SourceResult[dict[str, Any]]:
        """Non-polymer entities of one entry with the polymer residues RCSB lists as neighbours."""
        result = await self._entries(LIGAND_SITES_QUERY, [pdb_id])
        return result.map(lambda entries: entries.get(pdb_id.upper()))

    async def file(self, pdb_id: str, file_format: str) -> SourceResult[bytes]:
        """Coordinate file of an entry. Not kept in the HTTP cache: the caller stores the bytes."""
        return await self.get_bytes(
            self.file_url(pdb_id, file_format), record_id=pdb_id.upper(), ttl=0, timeout=60.0
        )


rcsb = RcsbSource()
