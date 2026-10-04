"""Acting on a protein: the lean ChEMBL path every bridge shares.

For one UniProt accession this reads the ChEMBL targets that contain it, the mechanism records on
those targets, and the molecules behind them. It is deliberately lighter than
`services.compounds.protein_compounds`: no PDB ligand sites and no bioactivity paging, because a
bridge may have to ask about several proteins inside one request. Measured activities are read for
the subject's own protein only, through the existing compounds service, which shares this cache.

Every answer carries its SourceResult rows so the caller can report one SourceStatus per source.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any

from helix.evidence import try_build_evidence
from helix.schemas.common import (
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    SourceState,
)
from helix.schemas.discovery import CandidateMolecule, Druggability
from helix.sources import SourceCall, gather_sources
from helix.sources.base import SourceResult
from helix.sources.chembl import chembl

MAX_MOLECULES_PER_PROTEIN = 60
PHASE_LABELS: dict[int, str] = {
    4: "Approved",
    3: "Phase 3",
    2: "Phase 2",
    1: "Phase 1",
    0: "Research compound",
}


def phase_label(max_phase: float | None) -> str | None:
    if max_phase is None:
        return None
    return PHASE_LABELS.get(int(max_phase), f"Phase {max_phase:g}")


def pretty_name(name: str | None, fallback: str) -> str:
    """ChEMBL writes drug names in capitals. A plain word becomes Leniolisib; a code stays BMS-986142."""
    if not name:
        return fallback
    text = name.strip()
    plain = text.isupper() and all(part.isalpha() for part in text.split())
    return text.title() if plain else text


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


@dataclass(slots=True)
class ChemblTarget:
    chembl_id: str
    name: str | None
    target_type: str | None
    organism: str | None
    accessions: list[str]
    url: str | None

    @property
    def is_single_protein(self) -> bool:
        return self.target_type == "SINGLE PROTEIN"


@dataclass(slots=True)
class MoleculeAction:
    """One ChEMBL mechanism record: a molecule, the target it acts on, and the recorded action."""

    chembl_id: str
    name: str | None
    inchikey: str | None
    modality: str | None
    max_phase: float | None
    withdrawn: bool | None
    action_type: str | None
    mechanism_of_action: str | None
    mechanism_id: str
    target: ChemblTarget
    direct_interaction: bool | None
    reference_urls: list[str] = field(default_factory=list)
    # action_type values from any further mechanism record of this molecule on the same target.
    # Read by the direction filter: a second record pointing the other way blocks a rejection.
    other_action_types: tuple[str, ...] = ()

    @property
    def sort_key(self) -> tuple[Any, ...]:
        return (
            0 if self.target.is_single_protein else 1,
            -(self.max_phase or 0),
            self.name or self.chembl_id,
        )

    @property
    def label(self) -> str:
        return pretty_name(self.name, self.chembl_id)

    @property
    def statement(self) -> str:
        """The mechanism record in ChEMBL's own words, for the Evidence row."""
        said = self.mechanism_of_action or "mechanism recorded"
        return f"{self.label}: {said} ({self.action_type})" if self.action_type else f"{self.label}: {said}"

    def molecule(self) -> CandidateMolecule:
        return CandidateMolecule(
            inchikey=self.inchikey,
            chembl_id=self.chembl_id,
            name=self.label,
            modality=self.modality,
            max_phase=self.max_phase,
            max_phase_label=phase_label(self.max_phase),
            action_type=self.action_type,
            mechanism_of_action=self.mechanism_of_action,
            withdrawn=self.withdrawn,
            compound=EntityRef.of(
                EntityType.COMPOUND,
                self.inchikey or self.chembl_id,
                label=self.label,
                curie=f"chembl:{self.chembl_id}",
            ),
        )


@dataclass(slots=True)
class ProteinActions:
    """What ChEMBL records about acting on one protein."""

    accession: str
    targets: list[ChemblTarget] = field(default_factory=list)
    actions: list[MoleculeAction] = field(default_factory=list)
    results: dict[str, SourceResult[Any]] = field(default_factory=dict)
    mechanism_provenance: Any = None

    @property
    def single_target(self) -> ChemblTarget | None:
        return next(
            (
                target
                for target in self.targets
                if target.is_single_protein and target.accessions == [self.accession]
            ),
            None,
        )

    @property
    def answered(self) -> bool:
        return any(result.ok for result in self.results.values())

    def druggability(self, note: str | None = None) -> Druggability:
        phases = [action.max_phase for action in self.actions if action.max_phase is not None]
        return Druggability(
            molecules_with_a_recorded_action=len({action.chembl_id for action in self.actions}),
            highest_clinical_phase=max(phases) if phases else None,
            has_approved_molecule=any(phase >= 4 for phase in phases),
            note=note,
        )

    def evidence_for(self, action: MoleculeAction, subject: EntityRef) -> Evidence | None:
        if self.mechanism_provenance is None:
            return None
        return try_build_evidence(
            self.mechanism_provenance,
            record_type="mechanism",
            record_id=f"mechanism:{action.mechanism_id}",
            url=chembl.record_url(action.chembl_id),
            subject=subject,
            predicate=(action.action_type or "has_mechanism").lower().replace(" ", "_"),
            object=EvidenceObject(
                type="target", id=f"chembl:{action.target.chembl_id}", label=action.target.name
            ),
            statement=action.statement,
            strength_value=action.max_phase,
            strength_scheme="chembl_max_phase",
        )


def _target(row: dict[str, Any]) -> ChemblTarget:
    return ChemblTarget(
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


async def _withdrawn_flags(chembl_ids: list[str]) -> SourceResult[dict[str, bool]]:
    raw = await chembl.get_json(
        "/molecule.json",
        params={
            "molecule_chembl_id__in": ",".join(sorted(set(chembl_ids))),
            "only": "molecule_chembl_id,withdrawn_flag",
            "limit": 1000,
        },
        empty_if=lambda payload: not payload.get("molecules"),
    )
    return raw.map(
        lambda payload: {
            row["molecule_chembl_id"]: bool(row.get("withdrawn_flag"))
            for row in payload.get("molecules") or []
        }
    )


async def protein_actions(accession: str, *, timeout: float = 30.0) -> ProteinActions:
    """ChEMBL targets, mechanism records and molecules for one protein. Never raises for a source."""
    found = ProteinActions(accession=accession)
    targets_result = await asyncio.wait_for(chembl.targets_for_accession(accession), timeout)
    found.results["chembl_targets"] = targets_result
    if not targets_result.ok or not targets_result.data:
        return found
    found.targets = [_target(row) for row in targets_result.data.get("rows", [])]
    by_id = {target.chembl_id: target for target in found.targets}
    if not by_id:
        return found

    mechanisms = await asyncio.wait_for(chembl.mechanisms_for_targets(list(by_id)), timeout)
    found.results["chembl_mechanisms"] = mechanisms
    if not mechanisms.ok or not mechanisms.data:
        return found
    found.mechanism_provenance = mechanisms.provenance
    rows = mechanisms.data.get("rows", [])
    # ChEMBL returns mechanism rows in no useful order, so truncating to the first
    # MAX_MOLECULES_PER_PROTEIN parents used to keep an arbitrary subset. Order by the record's own
    # strength first - a single-protein target and the highest clinical phase - so that when the cap
    # does bite it keeps the strongest records rather than whichever arrived first.
    def _retrieval_rank(row: dict[str, Any]) -> tuple[Any, ...]:
        target = by_id.get(row.get("target_chembl_id") or "")
        return (
            0 if target is not None and target.is_single_protein else 1,
            -(_number(row.get("max_phase")) or 0.0),
        )

    parents: list[str] = []
    for row in sorted(rows, key=_retrieval_rank):
        parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
        if parent not in parents:
            parents.append(parent)
    parents = parents[:MAX_MOLECULES_PER_PROTEIN]
    if not parents:
        return found

    gathered = await gather_sources(
        {
            "chembl_molecules": SourceCall(chembl, chembl.molecules(parents), timeout=timeout),
            "chembl_withdrawn": SourceCall(chembl, _withdrawn_flags(parents), timeout=timeout),
        }
    )
    found.results.update(gathered.results)
    molecules = {
        row["molecule_chembl_id"]: row for row in (gathered.data("chembl_molecules") or {}).get("rows", [])
    }
    withdrawn = gathered.data("chembl_withdrawn", {}) or {}

    # Every action_type recorded for one molecule on one target, before the one-row-per-pair dedup
    # below drops the extras. The direction filter needs the ones it is about to discard.
    all_action_types: dict[tuple[str, str], list[str]] = {}
    for row in rows:
        parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
        target_id = row.get("target_chembl_id") or ""
        if parent not in parents or target_id not in by_id:
            continue
        if row.get("action_type"):
            all_action_types.setdefault((parent, target_id), []).append(str(row["action_type"]))

    seen: set[tuple[str, str]] = set()
    for row in rows:
        parent = row.get("parent_molecule_chembl_id") or row["molecule_chembl_id"]
        target = by_id.get(row.get("target_chembl_id") or "")
        if parent not in parents or target is None:
            continue
        key = (parent, target.chembl_id)
        if key in seen:
            continue
        seen.add(key)
        kept = row.get("action_type")
        others = [value for value in all_action_types.get(key, []) if value != kept]
        molecule = molecules.get(parent) or {}
        structures = molecule.get("molecule_structures") or {}
        found.actions.append(
            MoleculeAction(
                chembl_id=parent,
                name=molecule.get("pref_name"),
                inchikey=structures.get("standard_inchi_key"),
                modality=molecule.get("molecule_type"),
                max_phase=_number(molecule.get("max_phase")) or _number(row.get("max_phase")),
                withdrawn=withdrawn.get(parent),
                action_type=row.get("action_type"),
                mechanism_of_action=row.get("mechanism_of_action"),
                mechanism_id=str(row.get("mec_id")),
                target=target,
                direct_interaction=(
                    bool(row["direct_interaction"]) if row.get("direct_interaction") is not None else None
                ),
                reference_urls=[
                    reference["ref_url"]
                    for reference in row.get("mechanism_refs") or []
                    if reference.get("ref_url")
                ][:4],
                other_action_types=tuple(dict.fromkeys(others)),
            )
        )
    found.actions.sort(key=lambda action: action.sort_key)
    return found


async def indications(parent_chembl_ids: list[str], *, timeout: float = 30.0) -> SourceResult[Any]:
    """ChEMBL drug_indication rows of several molecules, used for 'studied in another disease'."""
    if not parent_chembl_ids:
        return chembl.result(SourceState.EMPTY, message="No molecules to look up.")
    raw = await asyncio.wait_for(
        chembl.get_json(
            "/drug_indication.json",
            params={
                "parent_molecule_chembl_id__in": ",".join(sorted(set(parent_chembl_ids))),
                "only": "parent_molecule_chembl_id,molecule_chembl_id,efo_id,efo_term,mesh_id,"
                "mesh_heading,max_phase_for_ind,drugind_id",
                "limit": 1000,
            },
            empty_if=lambda payload: not payload.get("drug_indications"),
        ),
        timeout,
    )
    return raw.map(lambda payload: payload.get("drug_indications") or [])
