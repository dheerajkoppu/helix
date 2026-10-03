"""Experimental ligand evidence for a protein, compound detail, analogues and 2D depiction.

Compounds are keyed on InChIKey. Measured affinities follow the documented rule in
docs/research/drug-discovery.md sections 9.1 and 12; nothing here is a prediction.
"""

import re
import statistics
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from helix.errors import BadRequest, NotFound, SourceUnavailable
from helix.evidence import try_build_evidence
from helix.identifiers import INCHIKEY_RE, is_uniprot_accession
from helix.schemas.common import (
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Provenance,
    SourceState,
)
from helix.schemas.compounds import (
    BindingPredictionEligibility,
    ChemblTargetRef,
    CoCrystalRecord,
    CompoundAnalog,
    CompoundAnalogsResponse,
    CompoundCore,
    CompoundCounts,
    CompoundDetailResponse,
    CompoundTarget,
    CrossReference,
    IndicationRecord,
    MeasuredAffinity,
    MeasuredAffinitySummary,
    MechanismRecord,
    Modality,
    ProteinCompoundsResponse,
    TargetCompound,
)
from helix.sources import SourceCall, gather_sources
from helix.sources.base import Gathered, SourceResult
from helix.sources.chembl import SINGLE_PROTEIN_FORMAT, chembl
from helix.sources.pdbe import pdbe
from helix.sources.pubchem import pubchem
from helix.sources.rcsb import rcsb
from helix.sources.unichem import unichem

CHEMBL_ID_RE = re.compile(r"^CHEMBL\d+$")
MAX_ACTIVE_COMPOUNDS = 40
MAX_PDB_LIGANDS = 100
# leaves out ions and small crystallisation additives that PDBe does not flag as solvent
MIN_LIGAND_HEAVY_ATOMS = 10

AFFINITY_RULE = (
    "ChEMBL activity rows with standard_relation '=', standard_units nM, a pChEMBL value and no "
    "data validity comment. Rows in single protein format (BAO_0000357) are used when a compound "
    "has any, otherwise every qualifying row. The summary is the median pChEMBL of those rows, "
    "with the row and assay counts."
)
SELECTION_RULE = (
    "Every compound with a ChEMBL mechanism on a target containing this protein, the "
    f"{MAX_ACTIVE_COMPOUNDS} compounds with the highest single qualifying pChEMBL against the "
    "single-protein target (single protein format when the target has such rows), and up to "
    f"{MAX_PDB_LIGANDS} ligands of PDB entries of this protein that PDBe does not mark as solvent and "
    f"that have at least {MIN_LIGAND_HEAVY_ATOMS} heavy atoms, most entries first."
)
ORDER_RULE = (
    "Compounds with a ChEMBL mechanism first (maximum clinical phase, descending), then compounds "
    "with a measured affinity (median pChEMBL, descending), then PDB ligands (entry count, descending)."
)
INDICATIONS_NOTE = (
    "ChEMBL drug_indication can omit rare-disease indications; an indication missing here is not "
    "evidence that none exists."
)
NOT_SMALL_MOLECULE = "Not applicable: binding prediction supports small molecules only."
MODALITY_UNKNOWN = "Not offered: no source states that this compound is a small molecule."
NO_STRUCTURE = "Not offered: the source record has no chemical structure."

RECORD_TYPES = {"chembl": "molecule", "pubchem": "compound", "rcsb_pdb": "entry"}
STRUCTURE_BASIS = {
    "rcsb_pdb": "PDB non-polymer chemical component with a structure",
    "pubchem": "PubChem compound with a structure",
}

CHEM_COMPS_QUERY = """
query ($ids: [String!]!) {
  chem_comps(comp_ids: $ids) {
    chem_comp { id name formula formula_weight }
    rcsb_chem_comp_descriptor { SMILES_stereo SMILES InChIKey }
  }
}
"""

BIOLOGIC_TYPES = frozenset(
    {"antibody", "protein", "enzyme", "oligonucleotide", "oligosaccharide", "antibody drug conjugate"}
)
ADVANCED_THERAPY_TYPES = frozenset({"cell", "gene"})
XREF_PRIORITY = (
    "chembl",
    "pubchem",
    "pdbe",
    "rcsb_pdb",
    "chebi",
    "drugcentral",
    "bindingdb",
    "fdasrs",
    "drugbank",
    "surechembl",
    "comptox",
)

# Structures seen while listing PDB ligands, for compounds that neither ChEMBL nor PubChem holds
_known_structures: dict[str, dict[str, Any]] = {}


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def modality_of(molecule_type: str | None, structure_type: str | None = None) -> tuple[Modality, str]:
    """Modality and the ChEMBL field it was read from. ChEMBL types most research compounds
    'Unknown'; those with a drawn structure (structure_type MOL) are small molecules."""
    kind = (molecule_type or "").strip().lower()
    basis = f"ChEMBL molecule_type {molecule_type}" if molecule_type else "ChEMBL gives no molecule_type"
    if kind == "small molecule":
        return Modality.SMALL_MOLECULE, basis
    if kind in BIOLOGIC_TYPES:
        return Modality.BIOLOGIC, basis
    if kind in ADVANCED_THERAPY_TYPES:
        return Modality.CELL_OR_GENE_THERAPY, basis
    if structure_type == "MOL":
        return Modality.SMALL_MOLECULE, f"ChEMBL structure_type MOL ({basis})"
    return Modality.UNKNOWN, basis


def eligibility(modality: Modality, smiles: str | None) -> BindingPredictionEligibility:
    if modality in (Modality.BIOLOGIC, Modality.CELL_OR_GENE_THERAPY):
        return BindingPredictionEligibility(eligible=False, reason=NOT_SMALL_MOLECULE)
    if modality is Modality.UNKNOWN:
        return BindingPredictionEligibility(eligible=False, reason=MODALITY_UNKNOWN)
    if not smiles:
        return BindingPredictionEligibility(eligible=False, reason=NO_STRUCTURE)
    return BindingPredictionEligibility(
        eligible=True, reason="Small molecule with a structure: can be sent to a binding prediction."
    )


def _depiction_url(compound_id: str, smiles: str | None) -> str | None:
    return f"/api/v1/compounds/{compound_id}/depiction.svg" if smiles else None


def core_from_chembl(molecule: dict[str, Any]) -> dict[str, Any]:
    structures = molecule.get("molecule_structures") or {}
    properties = molecule.get("molecule_properties") or {}
    chembl_id = molecule["molecule_chembl_id"]
    inchikey = structures.get("standard_inchi_key")
    smiles = structures.get("canonical_smiles")
    modality, basis = modality_of(molecule.get("molecule_type"), molecule.get("structure_type"))
    values = {
        "id": inchikey or chembl_id,
        "inchikey": inchikey,
        "chembl_id": chembl_id,
        "name": molecule.get("pref_name"),
        "molecule_type": molecule.get("molecule_type"),
        "max_phase": _number(molecule.get("max_phase")),
        "first_approval": molecule.get("first_approval"),
        "smiles": smiles,
        "molecular_weight": _number(properties.get("full_mwt")),
        "molecular_formula": properties.get("full_molformula"),
    }
    return {
        **values,
        "modality": modality,
        "modality_basis": basis,
        "depiction_url": _depiction_url(values["id"], smiles),
        "binding_prediction": eligibility(modality, smiles),
        "field_sources": {key: "chembl" for key, value in values.items() if value is not None and key != "id"}
        | {"modality": "chembl"},
    }


def core_from_structure(
    inchikey: str, record: dict[str, Any], source: str, *, chembl_id: str | None = None
) -> dict[str, Any]:
    """A compound known only by its structure: a PDB chemical component or a PubChem record."""
    smiles = record.get("smiles")
    values = {
        "inchikey": inchikey,
        "name": record.get("name"),
        "smiles": smiles,
        "molecular_weight": _number(record.get("molecular_weight")),
        "molecular_formula": record.get("molecular_formula"),
    }
    sources = {key: source for key, value in values.items() if value is not None}
    # a PDB non-polymer component or a PubChem compound with a structure is a small molecule
    modality = Modality.SMALL_MOLECULE if smiles else Modality.UNKNOWN
    sources["modality"] = source
    if chembl_id:
        sources["chembl_id"] = "pdbe"
    return {
        **values,
        "id": inchikey,
        "chembl_id": chembl_id,
        "molecule_type": None,
        "max_phase": None,
        "first_approval": None,
        "modality": modality,
        "modality_basis": STRUCTURE_BASIS[source] if smiles else "No structure in the source record",
        "depiction_url": _depiction_url(inchikey, smiles),
        "binding_prediction": eligibility(modality, smiles),
        "field_sources": sources,
    }


def _compound_ref(core: dict[str, Any]) -> EntityRef:
    return EntityRef.of(
        EntityType.COMPOUND,
        core["id"],
        label=core.get("name") or core.get("chembl_id") or core["id"],
        curie=f"chembl:{core['chembl_id']}" if core.get("chembl_id") else None,
    )


def _target_ref(row: dict[str, Any]) -> ChemblTargetRef:
    return ChemblTargetRef(
        chembl_id=row["target_chembl_id"],
        name=row.get("pref_name"),
        target_type=row.get("target_type"),
        organism=row.get("organism"),
        accessions=[
            component["accession"]
            for component in row.get("target_components") or []
            if component.get("accession")
        ],
        url=chembl.target_url(row["target_chembl_id"]),
    )


def _mechanism(row: dict[str, Any], targets: dict[str, ChemblTargetRef]) -> MechanismRecord:
    target = targets.get(row.get("target_chembl_id") or "")
    direct = row.get("direct_interaction")
    return MechanismRecord(
        mechanism_id=str(row.get("mec_id")),
        mechanism_of_action=row.get("mechanism_of_action"),
        action_type=row.get("action_type"),
        molecule_chembl_id=row["molecule_chembl_id"],
        target_chembl_id=row.get("target_chembl_id"),
        target_name=target.name if target else None,
        target_type=target.target_type if target else None,
        target_accessions=target.accessions if target else [],
        direct_interaction=bool(direct) if direct is not None else None,
        max_phase=_number(row.get("max_phase")),
        binding_site_comment=row.get("binding_site_comment"),
        mechanism_comment=row.get("mechanism_comment"),
        selectivity_comment=row.get("selectivity_comment"),
        references=[
            {"type": ref.get("ref_type"), "id": ref.get("ref_id"), "url": ref.get("ref_url")}
            for ref in row.get("mechanism_refs") or []
        ],
    )


def _mechanism_evidence(
    provenance: Provenance | None, record: MechanismRecord, subject: EntityRef
) -> Evidence | None:
    if provenance is None:
        return None
    return try_build_evidence(
        provenance,
        record_type="mechanism",
        record_id=f"mechanism:{record.mechanism_id}",
        url=chembl.record_url(record.molecule_chembl_id),
        subject=subject,
        predicate=(record.action_type or "has_mechanism").lower().replace(" ", "_"),
        object=EvidenceObject(
            type="target",
            id=f"chembl:{record.target_chembl_id}" if record.target_chembl_id else None,
            label=record.target_name,
        ),
        statement=record.mechanism_of_action,
    )


def _qualifies(row: dict[str, Any]) -> bool:
    return (
        row.get("standard_relation") == "="
        and row.get("standard_units") == "nM"
        and row.get("data_validity_comment") is None
        and _number(row.get("pchembl_value")) is not None
        and _number(row.get("standard_value")) is not None
    )


def _measured(row: dict[str, Any]) -> MeasuredAffinity:
    assay = row.get("assay_chembl_id")
    return MeasuredAffinity(
        activity_id=str(row["activity_id"]),
        standard_type=row.get("standard_type") or "",
        relation=row["standard_relation"],
        value=float(row["standard_value"]),
        units=row["standard_units"],
        pchembl=_number(row.get("pchembl_value")),
        assay_chembl_id=assay,
        assay_description=row.get("assay_description"),
        assay_format=row.get("bao_label"),
        document_chembl_id=row.get("document_chembl_id"),
        year=row.get("document_year"),
        url=chembl.assay_url(assay) if assay else None,
    )


def summarise_affinity(rows: list[dict[str, Any]], *, incomplete: bool) -> MeasuredAffinitySummary | None:
    qualifying = [row for row in rows if _qualifies(row)]
    if not qualifying:
        return None
    single_protein = [row for row in qualifying if row.get("bao_format") == SINGLE_PROTEIN_FORMAT]
    used = single_protein or qualifying
    values = [float(row["pchembl_value"]) for row in used]
    median = statistics.median(values)
    representative = min(
        used, key=lambda row: (abs(float(row["pchembl_value"]) - median), row["activity_id"])
    )
    types: dict[str, int] = {}
    for row in used:
        kind = row.get("standard_type") or "unspecified"
        types[kind] = types.get(kind, 0) + 1
    return MeasuredAffinitySummary(
        median_pchembl=round(median, 2),
        min_pchembl=min(values),
        max_pchembl=max(values),
        activity_count=len(used),
        assay_count=len({row.get("assay_chembl_id") for row in used}),
        assay_format="single protein format" if single_protein else "any assay format",
        standard_types=dict(sorted(types.items(), key=lambda item: -item[1])),
        representative=_measured(representative),
        incomplete=incomplete,
    )


def _ligand_positions(ligand: dict[str, Any]) -> list[int]:
    positions: set[int] = set()
    for residue in ligand.get("residues") or []:
        start, end = residue.get("startIndex"), residue.get("endIndex")
        if residue.get("indexType") == "UNIPROT" and isinstance(start, int) and isinstance(end, int):
            positions.update(range(start, end + 1))
    return sorted(positions)


async def _ligand_sites(accession: str) -> SourceResult[list[dict[str, Any]]]:
    raw = await pdbe.get_json(f"/graph-api/uniprot/ligand_sites/{accession}", record_id=accession)
    return raw.map(lambda payload: (payload.get(accession) or {}).get("data") or [])


async def _chem_comps(ccd_ids: list[str]) -> SourceResult[dict[str, dict[str, Any]]]:
    if not ccd_ids:
        return rcsb.result(SourceState.EMPTY, message="No PDB ligands to look up.")
    raw = await rcsb.graphql(CHEM_COMPS_QUERY, {"ids": sorted(ccd_ids)}, path="/graphql", root="chem_comps")

    def parse(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        components = {}
        for row in rows:
            component = row.get("chem_comp") or {}
            descriptor = row.get("rcsb_chem_comp_descriptor") or {}
            components[component["id"]] = {
                "name": component.get("name"),
                "molecular_weight": component.get("formula_weight"),
                "molecular_formula": component.get("formula"),
                "smiles": descriptor.get("SMILES_stereo") or descriptor.get("SMILES"),
                "inchikey": descriptor.get("InChIKey"),
            }
        return components

    return raw.map(parse)


async def protein_compounds(accession: str) -> ProteinCompoundsResponse:
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.", code="invalid_accession")
    protein = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
    results: dict[str, SourceResult[Any]] = {}

    first = await gather_sources(
        {
            "targets": SourceCall(chembl, chembl.targets_for_accession(accession), timeout=45),
            "ligand_sites": SourceCall(pdbe, _ligand_sites(accession), timeout=45),
        }
    )
    results.update(first.results)
    target_refs = [_target_ref(row) for row in (first.data("targets") or {}).get("rows", [])]
    targets = {target.chembl_id: target for target in target_refs}
    single = next(
        (
            target
            for target in target_refs
            if target.target_type == "SINGLE PROTEIN" and target.accessions == [accession]
        ),
        None,
    )
    all_ligands = [
        ligand
        for ligand in first.data("ligand_sites", [])
        if not (ligand.get("additionalData") or {}).get("isSolvent")
        and ligand.get("accession")
        and ((ligand.get("additionalData") or {}).get("numAtoms") or 0) >= MIN_LIGAND_HEAVY_ATOMS
    ]
    ligands = sorted(
        all_ligands, key=lambda ligand: -len((ligand.get("additionalData") or {}).get("pdbEntries") or [])
    )[:MAX_PDB_LIGANDS]

    calls: dict[str, SourceCall] = {}
    if targets:
        calls["mechanisms"] = SourceCall(chembl, chembl.mechanisms_for_targets(list(targets)), timeout=45)
    if single:
        calls["top"] = SourceCall(chembl, chembl.top_activities(single.chembl_id), timeout=60)
    if ligands:
        calls["chem_comps"] = SourceCall(
            rcsb, _chem_comps([ligand["accession"] for ligand in ligands]), timeout=45
        )
    second = await gather_sources(calls) if calls else Gathered({})
    results.update(second.results)
    mechanism_rows = (
        (second.data("mechanisms") or {}).get("rows", []) if "mechanisms" in second.results else []
    )
    top = (second.data("top") or {}) if "top" in second.results else {}
    parents: list[str] = []
    for row in mechanism_rows:
        parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
        if parent not in parents:
            parents.append(parent)
    actives: list[str] = []
    top_rows = [row for row in top.get("rows", []) if _qualifies(row)]
    for row in [row for row in top_rows if row.get("bao_format") == SINGLE_PROTEIN_FORMAT] or top_rows:
        parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
        if parent not in actives:
            actives.append(parent)
        if len(actives) >= MAX_ACTIVE_COMPOUNDS:
            break
    parents.extend(parent for parent in actives if parent not in parents)

    molecules: dict[str, dict[str, Any]] = {}
    activity_rows: dict[str, list[dict[str, Any]]] = {}
    activities_incomplete = False
    if parents:
        calls = {"molecules": SourceCall(chembl, chembl.molecules(parents), timeout=60)}
        if single:
            calls["activities"] = SourceCall(
                chembl, chembl.activities_for_molecules(single.chembl_id, parents), timeout=90
            )
        third = await gather_sources(calls)
        results.update(third.results)
        molecules = {
            row["molecule_chembl_id"]: row for row in (third.data("molecules") or {}).get("rows", [])
        }
        if "activities" in third.results:
            activities = third.data("activities") or {}
            activities_incomplete = bool(activities.get("truncated"))
            for row in activities.get("rows", []):
                parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
                activity_rows.setdefault(parent, []).append(row)

    mechanism_provenance = results["mechanisms"].provenance if "mechanisms" in results else None
    activity_provenance = results["activities"].provenance if "activities" in results else None
    ligand_provenance = results["ligand_sites"].provenance

    compounds: dict[str, TargetCompound] = {}
    by_chembl_id: dict[str, str] = {}
    for parent in parents:
        molecule = molecules.get(parent)
        if molecule is None:
            continue
        core = core_from_chembl(molecule)
        subject = _compound_ref(core)
        evidence: list[Evidence] = []
        mechanisms = [
            _mechanism(row, targets)
            for row in mechanism_rows
            if (row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]) == parent
        ]
        for record in mechanisms:
            item = _mechanism_evidence(mechanism_provenance, record, subject)
            if item is not None:
                evidence.append(item)
        summary = summarise_affinity(activity_rows.get(parent, []), incomplete=activities_incomplete)
        if summary is not None and activity_provenance is not None and single is not None:
            measured = summary.representative
            item = try_build_evidence(
                activity_provenance,
                record_type="activity",
                record_id=f"activity:{measured.activity_id}",
                url=measured.url,
                subject=subject,
                predicate="measured_activity",
                object=EvidenceObject(
                    type="target",
                    id=f"chembl:{single.chembl_id}",
                    label=single.name,
                    value=measured.value,
                    unit=measured.units,
                ),
                statement=f"{measured.standard_type} {measured.relation} {measured.value:g} {measured.units}",
                strength_value=measured.pchembl,
            )
            if item is not None:
                evidence.append(item)
        kinds = (["mechanism"] if mechanisms else []) + (["bioactivity"] if summary else [])
        if not kinds:
            continue
        compounds[core["id"]] = TargetCompound(
            **core, evidence_kinds=kinds, mechanisms=mechanisms, measured_affinity=summary, evidence=evidence
        )
        by_chembl_id[parent] = core["id"]

    components = second.data("chem_comps", {}) if "chem_comps" in second.results else {}
    for ligand in ligands:
        ccd_id = ligand["accession"]
        component = components.get(ccd_id) or {}
        extra = ligand.get("additionalData") or {}
        inchikey = component.get("inchikey")
        pdbe_chembl_id = extra.get("chemblId") or None
        pdb_ids = sorted({str(entry).upper() for entry in extra.get("pdbEntries") or []})
        record = CoCrystalRecord(
            ccd_id=ccd_id,
            name=ligand.get("name"),
            pdb_ids=pdb_ids,
            pdb_entry_count=len(pdb_ids),
            binding_positions=_ligand_positions(ligand),
        )
        key = inchikey if inchikey in compounds else by_chembl_id.get(pdbe_chembl_id or "")
        if key is None:
            if not inchikey:
                continue
            _known_structures[inchikey] = {**component, "source": "rcsb_pdb"}
            core = core_from_structure(
                inchikey,
                {**component, "name": component.get("name") or ligand.get("name")},
                "rcsb_pdb",
                chembl_id=pdbe_chembl_id,
            )
            compounds[inchikey] = TargetCompound(
                **core, evidence_kinds=[], mechanisms=[], measured_affinity=None, evidence=[]
            )
            key = inchikey
        compound = compounds[key]
        if compound.co_crystal is not None:
            continue
        compound.co_crystal = record
        compound.evidence_kinds.append("co_crystal")
        if ligand_provenance is not None and pdb_ids:
            item = try_build_evidence(
                ligand_provenance,
                record_type="entry",
                record_id=pdb_ids[0],
                url=pdbe.record_url(pdb_ids[0]),
                subject=EntityRef.of(EntityType.COMPOUND, compound.id, label=compound.name or ccd_id),
                predicate="co_crystallised_with",
                object=EvidenceObject(type="protein", id=f"uniprot:{accession}", label=accession),
                statement=f"Ligand {ccd_id} is bound in {len(pdb_ids)} PDB entries of {accession}.",
            )
            if item is not None:
                compound.evidence.append(item)

    def order(compound: TargetCompound) -> tuple[Any, ...]:
        if compound.mechanisms:
            return (0, -(compound.max_phase or 0), compound.name or compound.id)
        if compound.measured_affinity:
            return (1, -compound.measured_affinity.median_pchembl, compound.id)
        return (2, -(compound.co_crystal.pdb_entry_count if compound.co_crystal else 0), compound.id)

    rows = sorted(compounds.values(), key=order)
    return ProteinCompoundsResponse(
        protein=protein,
        target=single,
        related_targets=[target for target in target_refs if target is not single],
        compounds=rows,
        counts=CompoundCounts(
            with_mechanism=sum(1 for row in rows if row.mechanisms),
            with_measured_affinity=sum(1 for row in rows if row.measured_affinity),
            co_crystallised=sum(1 for row in rows if row.co_crystal),
            qualifying_activities_in_chembl=top.get("total_count") if top else None,
            pdb_ligands_total=len(all_ligands) if results["ligand_sites"].answered else None,
        ),
        affinity_rule=AFFINITY_RULE,
        selection_rule=SELECTION_RULE,
        order_rule=ORDER_RULE,
        sources=Gathered(results).sources,
    )


@dataclass(slots=True)
class ResolvedCompound:
    core: dict[str, Any]
    inchi: str | None = None
    parent_chembl_id: str | None = None
    provenance: Provenance | None = None
    results: dict[str, SourceResult[Any]] = field(default_factory=dict)


async def resolve_compound(identifier: str) -> ResolvedCompound:
    """Find a compound by InChIKey or ChEMBL ID: ChEMBL first, PubChem for an InChIKey ChEMBL lacks."""
    identifier = identifier.strip().upper()
    results: dict[str, SourceResult[Any]] = {}
    if CHEMBL_ID_RE.match(identifier):
        found = await chembl.molecule(identifier)
    elif INCHIKEY_RE.match(identifier):
        found = await chembl.molecule_by_inchikey(identifier)
    else:
        raise BadRequest(f"{identifier} is neither an InChIKey nor a ChEMBL ID.", code="invalid_compound_id")
    results["molecule"] = found
    if found.ok and found.data:
        molecule = found.data
        hierarchy = molecule.get("molecule_hierarchy") or {}
        return ResolvedCompound(
            core=core_from_chembl(molecule),
            inchi=(molecule.get("molecule_structures") or {}).get("standard_inchi"),
            parent_chembl_id=hierarchy.get("parent_chembl_id") or molecule["molecule_chembl_id"],
            provenance=found.provenance,
            results=results,
        )
    if INCHIKEY_RE.match(identifier):
        properties = await pubchem.properties_by_inchikey(identifier)
        results["pubchem"] = properties
        if properties.ok and properties.data:
            record = {
                "name": properties.data.get("Title"),
                "smiles": properties.data.get("SMILES"),
                "molecular_weight": properties.data.get("MolecularWeight"),
                "molecular_formula": properties.data.get("MolecularFormula"),
            }
            return ResolvedCompound(
                core=core_from_structure(identifier, record, "pubchem"),
                inchi=properties.data.get("InChI"),
                provenance=properties.provenance,
                results=results,
            )
        known = _known_structures.get(identifier)
        if known is not None:
            return ResolvedCompound(
                core=core_from_structure(identifier, known, known["source"]), results=results
            )
        # a ligand only the PDB holds: UniChem names its chemical component, RCSB gives the structure
        references = await unichem.cross_references(identifier)
        results["unichem"] = references
        ccd_id = next(
            (
                str(row.get("compoundId"))
                for row in (references.data or [] if references.ok else [])
                if row.get("shortName") in ("pdbe", "rcsb_pdb")
            ),
            None,
        )
        if ccd_id:
            components = await _chem_comps([ccd_id])
            results["chem_comps"] = components
            component = (components.data or {}).get(ccd_id) if components.ok else None
            if component and component.get("inchikey") == identifier:
                _known_structures[identifier] = {**component, "source": "rcsb_pdb"}
                return ResolvedCompound(
                    core=core_from_structure(identifier, component, "rcsb_pdb"),
                    provenance=components.with_record(
                        ccd_id, f"https://www.rcsb.org/ligand/{ccd_id}"
                    ).provenance,
                    results=results,
                )
    if found.state is SourceState.UNAVAILABLE:
        raise SourceUnavailable(found.name, found.message)
    raise NotFound(f"No source found for compound {identifier}.", code="compound_not_found")


def _xref_order(row: dict[str, Any]) -> tuple[int, str]:
    name = row.get("shortName") or ""
    rank = XREF_PRIORITY.index(name) if name in XREF_PRIORITY else len(XREF_PRIORITY)
    return rank, name


async def compound_detail(identifier: str) -> CompoundDetailResponse:
    resolved = await resolve_compound(identifier)
    core = resolved.core
    subject = _compound_ref(core)
    results = dict(resolved.results)
    calls: dict[str, SourceCall] = {}
    if core.get("inchikey"):
        calls["unichem"] = SourceCall(unichem, unichem.cross_references(core["inchikey"]), timeout=30)
    if resolved.parent_chembl_id:
        calls["mechanisms"] = SourceCall(
            chembl, chembl.mechanisms_for_parent(resolved.parent_chembl_id), timeout=45
        )
        calls["indications"] = SourceCall(
            chembl, chembl.indications_for_parent(resolved.parent_chembl_id), timeout=45
        )
    gathered = await gather_sources(calls) if calls else Gathered({})
    results.update(gathered.results)

    mechanism_rows = (gathered.data("mechanisms") or {}).get("rows", []) if "mechanisms" in calls else []
    indication_rows = (gathered.data("indications") or {}).get("rows", []) if "indications" in calls else []
    target_ids = sorted({row["target_chembl_id"] for row in mechanism_rows if row.get("target_chembl_id")})
    targets: dict[str, ChemblTargetRef] = {}
    if target_ids:
        looked_up = await gather_sources(
            {"targets": SourceCall(chembl, chembl.targets(target_ids), timeout=45)}
        )
        results["targets"] = looked_up["targets"]
        targets = {
            row["target_chembl_id"]: _target_ref(row)
            for row in (looked_up.data("targets") or {}).get("rows", [])
        }

    evidence: list[Evidence] = []
    if resolved.provenance is not None:
        item = try_build_evidence(
            resolved.provenance,
            record_type=RECORD_TYPES.get(resolved.provenance.source, "compound"),
            record_id=core.get("chembl_id") or resolved.provenance.record_id or core["id"],
            subject=subject,
            predicate="described_by",
            object=EvidenceObject(type="compound", id=core["id"], label=core.get("name")),
        )
        if item is not None:
            evidence.append(item)
    mechanisms = [_mechanism(row, targets) for row in mechanism_rows]
    mechanism_provenance = gathered["mechanisms"].provenance if "mechanisms" in calls else None
    for record in mechanisms:
        item = _mechanism_evidence(mechanism_provenance, record, subject)
        if item is not None:
            evidence.append(item)

    indications: dict[str, IndicationRecord] = {}
    indication_provenance = gathered["indications"].provenance if "indications" in calls else None
    for row in indication_rows:
        record = IndicationRecord(
            indication_id=str(row.get("drugind_id")),
            mesh_heading=row.get("mesh_heading"),
            mesh_id=row.get("mesh_id"),
            efo_term=row.get("efo_term"),
            efo_id=row.get("efo_id"),
            max_phase_for_indication=_number(row.get("max_phase_for_ind")),
            references=[
                {"type": ref.get("ref_type"), "id": ref.get("ref_id"), "url": ref.get("ref_url")}
                for ref in row.get("indication_refs") or []
            ],
        )
        indications[record.indication_id] = record
        if indication_provenance is not None:
            item = try_build_evidence(
                indication_provenance,
                record_type="indication",
                record_id=f"drug_indication:{record.indication_id}",
                url=chembl.record_url(row.get("molecule_chembl_id") or ""),
                subject=subject,
                predicate="has_indication",
                object=EvidenceObject(
                    type="disease",
                    id=record.efo_id or (f"mesh:{record.mesh_id}" if record.mesh_id else None),
                    label=record.efo_term or record.mesh_heading,
                ),
            )
            if item is not None:
                evidence.append(item)

    compound_targets = []
    for target_id in target_ids:
        target = targets.get(target_id)
        if target is None:
            continue
        single_protein = target.target_type == "SINGLE PROTEIN"
        compound_targets.append(
            CompoundTarget(
                **target.model_dump(exclude={"source"}),
                action_types=sorted(
                    {
                        row["action_type"]
                        for row in mechanism_rows
                        if row.get("target_chembl_id") == target_id and row.get("action_type")
                    }
                ),
                protein_refs=[
                    EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
                    for accession in (target.accessions if single_protein else [])
                ],
            )
        )

    return CompoundDetailResponse(
        compound=CompoundCore(**core),
        inchi=resolved.inchi,
        parent_chembl_id=resolved.parent_chembl_id,
        cross_references=[
            CrossReference(
                database=row.get("shortName") or "",
                database_name=row.get("longName"),
                id=str(row.get("compoundId")),
                url=row.get("url") or None,
            )
            for row in sorted(gathered.data("unichem", []) if "unichem" in calls else [], key=_xref_order)
        ],
        mechanisms=mechanisms,
        indications=sorted(
            indications.values(),
            key=lambda record: (-(record.max_phase_for_indication or 0), record.efo_term or ""),
        ),
        indications_note=INDICATIONS_NOTE,
        targets=compound_targets,
        evidence=evidence,
        sources=Gathered(results).sources,
    )


async def compound_analogs(identifier: str, threshold: int, limit: int) -> CompoundAnalogsResponse:
    resolved = await resolve_compound(identifier)
    core = resolved.core
    results = dict(resolved.results)
    analogs: list[CompoundAnalog] = []
    message = None
    chembl_id = core.get("chembl_id") if core["field_sources"].get("chembl_id") == "chembl" else None
    if chembl_id is None:
        message = "ChEMBL does not hold this compound, so its similarity search cannot be run."
    else:
        gathered = await gather_sources(
            {"similar": SourceCall(chembl, chembl.similar(chembl_id, threshold, limit + 1), timeout=60)}
        )
        results["similar"] = gathered["similar"]
        for row in (gathered.data("similar") or {}).get("rows", []):
            similarity = _number(row.get("similarity"))
            if row["molecule_chembl_id"] == chembl_id or similarity is None:
                continue
            analogs.append(CompoundAnalog(**core_from_chembl(row), similarity=round(similarity, 2)))
    return CompoundAnalogsResponse(
        query=CompoundCore(**core),
        threshold=threshold,
        analogs=sorted(analogs, key=lambda analog: -analog.similarity)[:limit],
        message=message,
        sources=Gathered(results).sources,
    )


INK = {"light": "#1F2328", "dark": "#E6E8EB"}


@lru_cache(maxsize=4096)
def render_depiction(smiles: str, theme: str, width: int, height: int) -> str | None:
    """Monochrome 2D depiction on a transparent background. None when RDKit cannot read the SMILES."""
    from rdkit import Chem, RDLogger
    from rdkit.Chem.Draw import rdMolDraw2D

    RDLogger.DisableLog("rdApp.*")
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return None
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    options = drawer.drawOptions()
    options.clearBackground = False
    options.useBWAtomPalette()
    options.bondLineWidth = 1.4
    options.padding = 0.06
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, molecule)
    drawer.FinishDrawing()
    return drawer.GetDrawingText().replace("#000000", INK[theme])


async def compound_depiction(identifier: str, theme: str, width: int, height: int) -> str:
    resolved = await resolve_compound(identifier)
    smiles = resolved.core.get("smiles")
    if not smiles:
        raise NotFound(
            f"No source gives a chemical structure for {identifier}, so there is nothing to draw.",
            code="no_structure",
        )
    svg = render_depiction(smiles, theme, width, height)
    if svg is None:
        raise NotFound(f"The structure of {identifier} could not be drawn.", code="depiction_failed")
    return svg
