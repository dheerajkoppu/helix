"""Validated input of one Boltz-2 run.

Limits follow the Boltz documentation (docs/research/structure-models.md section 5.6 and
docs/research/drug-discovery.md section 4.3): affinity takes exactly one small-molecule ligand
bound to a protein, at most 128 atoms, and is not recommended above 56 atoms.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from orphafold.providers.base import ChainInput, LigandInput

PROTEIN_ALPHABET = frozenset("ACDEFGHIKLMNPQRSTVWY")
AFFINITY_MAX_ATOMS = 128
AFFINITY_RECOMMENDED_ATOMS = 56
POCKET_DISTANCE_MIN = 4.0
POCKET_DISTANCE_MAX = 20.0
POCKET_DISTANCE_DEFAULT = 6.0
CCD_PATTERN = re.compile(r"^[A-Z0-9]{1,5}$")
ENTITY_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,3}$")
RECORD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")

MsaMode = Literal["server", "precomputed", "single_sequence"]

CAVEAT_ATOMS_ABOVE_RECOMMENDED = "ligand_atoms_above_56"
CAVEAT_CCD_ATOMS_UNCHECKED = "ligand_atom_count_not_checked_for_ccd"
CAVEAT_VARIANT_SEQUENCE = "variant_sequence_outside_validated_use"
CAVEAT_ACTIVES_ONLY = "comparison_only_across_actives"


class BoltzInputError(ValueError):
    """Input the adapter refuses before any compute is spent."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


@dataclass(frozen=True, slots=True)
class ProteinChain:
    id: str
    sequence: str
    residue_start: int = 1
    uniprot_accession: str | None = None
    applied_variant_ids: tuple[str, ...] = ()
    # Path written into the YAML relative to the input file, or "empty" for single-sequence mode
    msa: str | None = None

    @property
    def residue_end(self) -> int:
        return self.residue_start + len(self.sequence) - 1


@dataclass(frozen=True, slots=True)
class Ligand:
    id: str
    smiles: str | None = None
    ccd: str | None = None
    label: str | None = None
    xrefs: tuple[str, ...] = ()
    # Computed with RDKit from the SMILES; None for a CCD code, which is not resolved locally
    canonical_smiles: str | None = None
    inchikey: str | None = None
    atom_count: int | None = None
    heavy_atom_count: int | None = None
    molecular_weight: float | None = None

    def describe(self) -> dict[str, Any]:
        return {
            "entity_id": self.id,
            "smiles": self.smiles,
            "ccd": self.ccd,
            "label": self.label,
            "canonical_smiles": self.canonical_smiles,
            "inchikey": self.inchikey,
            "atom_count": self.atom_count,
            "heavy_atom_count": self.heavy_atom_count,
            "molecular_weight": self.molecular_weight,
            "atom_count_definition": "atoms left by RDKit RemoveHs (heavy atoms plus retained hydrogens)",
        }


@dataclass(frozen=True, slots=True)
class PocketConstraint:
    binder: str
    # Chain ID and 1-indexed position in that chain's sequence, as Boltz expects
    contacts: tuple[tuple[str, int], ...]
    # The same residues in UniProt canonical numbering, as the user gave them
    uniprot_positions: tuple[int, ...]
    max_distance: float = POCKET_DISTANCE_DEFAULT
    force: bool = False

    def describe(self) -> dict[str, Any]:
        return {
            "binder": self.binder,
            "contacts": [[chain, position] for chain, position in self.contacts],
            "contacts_numbering": "1-indexed position in the submitted chain sequence",
            "uniprot_positions": list(self.uniprot_positions),
            "max_distance_angstrom": self.max_distance,
            "force": self.force,
        }


@dataclass(frozen=True, slots=True)
class BoltzJobSpec:
    record_id: str
    chains: tuple[ProteinChain, ...]
    ligands: tuple[Ligand, ...] = ()
    affinity_binder: str | None = None
    pocket: PocketConstraint | None = None
    msa_mode: MsaMode = "server"
    caveats: tuple[str, ...] = ()
    notes: tuple[str, ...] = field(default=())

    @property
    def chain_count(self) -> int:
        return len(self.chains) + len(self.ligands)

    @property
    def protein_residue_count(self) -> int:
        return sum(len(chain.sequence) for chain in self.chains)

    @property
    def token_estimate(self) -> int | None:
        """Residues plus ligand heavy atoms. None when a CCD ligand's atom count is not known."""
        total = self.protein_residue_count
        for ligand in self.ligands:
            if ligand.heavy_atom_count is None:
                return None
            total += ligand.heavy_atom_count
        return total

    @property
    def affinity_ligand(self) -> Ligand | None:
        return next((ligand for ligand in self.ligands if ligand.id == self.affinity_binder), None)


def clean_sequence(sequence: str) -> str:
    return "".join(sequence.split()).upper()


def validate_protein_sequence(sequence: str, *, chain_id: str = "A") -> str:
    cleaned = clean_sequence(sequence)
    if not cleaned:
        raise BoltzInputError("empty_sequence", f"Chain {chain_id} has no sequence.")
    unknown = sorted(set(cleaned) - PROTEIN_ALPHABET)
    if unknown:
        raise BoltzInputError(
            "invalid_sequence",
            f"Chain {chain_id} contains characters that are not one of the 20 standard amino acids: "
            f"{', '.join(unknown)}.",
            {"chain": chain_id, "characters": unknown},
        )
    return cleaned


def analyse_ligand(ligand: LigandInput, *, for_affinity: bool) -> tuple[Ligand, list[str]]:
    """Check one ligand and compute its identifiers. Returns the ligand and the caveats it adds."""
    smiles = (ligand.smiles or "").strip() or None
    ccd = (ligand.ccd or "").strip().upper() or None
    entity_id = ligand.entity_id
    if not ENTITY_ID_PATTERN.match(entity_id):
        raise BoltzInputError("invalid_ligand_id", f"'{entity_id}' is not a valid chain ID for a ligand.")
    if smiles and ccd:
        raise BoltzInputError(
            "ligand_smiles_and_ccd", "Give the ligand as a SMILES string or as a CCD code, never both."
        )
    if not smiles and not ccd:
        raise BoltzInputError("ligand_missing", "The ligand needs a SMILES string or a CCD code.")

    caveats: list[str] = []
    if ccd:
        if not CCD_PATTERN.match(ccd):
            raise BoltzInputError("invalid_ccd", f"'{ccd}' is not a Chemical Component Dictionary code.")
        if for_affinity:
            caveats.append(CAVEAT_CCD_ATOMS_UNCHECKED)
        return (
            Ligand(id=entity_id, ccd=ccd, label=ligand.label, xrefs=tuple(ligand.xrefs)),
            caveats,
        )

    from rdkit import Chem, RDLogger
    from rdkit.Chem import Descriptors

    RDLogger.DisableLog("rdApp.*")
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise BoltzInputError("invalid_smiles", "The ligand SMILES could not be parsed.", {"smiles": smiles})
    if molecule.GetNumAtoms() == 0:
        raise BoltzInputError("invalid_smiles", "The ligand SMILES describes no atoms.", {"smiles": smiles})
    fragments = Chem.GetMolFrags(molecule)
    if len(fragments) > 1:
        raise BoltzInputError(
            "ligand_multiple_components",
            f"The SMILES describes {len(fragments)} disconnected components. Boltz affinity takes one "
            "single small molecule: remove counter-ions and solvent and submit the parent compound.",
            {"components": len(fragments)},
        )
    atom_count = Chem.RemoveHs(molecule).GetNumAtoms()
    heavy_atom_count = molecule.GetNumHeavyAtoms()
    if atom_count > AFFINITY_MAX_ATOMS and for_affinity:
        raise BoltzInputError(
            "ligand_too_large",
            f"The ligand has {atom_count} atoms. Boltz-2 affinity accepts a small molecule of at most "
            f"{AFFINITY_MAX_ATOMS} atoms; peptides, proteins and other large molecules are not applicable.",
            {"atom_count": atom_count, "limit": AFFINITY_MAX_ATOMS},
        )
    if atom_count > AFFINITY_RECOMMENDED_ATOMS and for_affinity:
        caveats.append(CAVEAT_ATOMS_ABOVE_RECOMMENDED)
    inchikey = Chem.MolToInchiKey(molecule) or None
    return (
        Ligand(
            id=entity_id,
            smiles=smiles,
            label=ligand.label,
            xrefs=tuple(ligand.xrefs),
            canonical_smiles=Chem.MolToSmiles(molecule),
            inchikey=ligand.inchikey or inchikey,
            atom_count=atom_count,
            heavy_atom_count=heavy_atom_count,
            molecular_weight=round(Descriptors.MolWt(molecule), 3),
        ),
        caveats,
    )


def pocket_constraint(
    chain: ProteinChain,
    binder: str,
    uniprot_positions: list[int],
    *,
    max_distance: float = POCKET_DISTANCE_DEFAULT,
    force: bool = False,
) -> PocketConstraint:
    """Translate UniProt positions into the 1-indexed chain positions of the Boltz YAML."""
    if not POCKET_DISTANCE_MIN <= max_distance <= POCKET_DISTANCE_MAX:
        raise BoltzInputError(
            "invalid_pocket_distance",
            f"The pocket distance must be between {POCKET_DISTANCE_MIN:g} and {POCKET_DISTANCE_MAX:g} Å.",
        )
    positions = sorted(set(uniprot_positions))
    outside = [position for position in positions if not chain.residue_start <= position <= chain.residue_end]
    if outside:
        raise BoltzInputError(
            "pocket_residue_outside_sequence",
            f"Pocket residues {', '.join(map(str, outside))} are outside the modelled range "
            f"{chain.residue_start}-{chain.residue_end}.",
            {"outside": outside, "residue_start": chain.residue_start, "residue_end": chain.residue_end},
        )
    contacts = tuple((chain.id, position - chain.residue_start + 1) for position in positions)
    return PocketConstraint(
        binder=binder,
        contacts=contacts,
        uniprot_positions=tuple(positions),
        max_distance=float(max_distance),
        force=force,
    )


def build_spec(
    *,
    record_id: str,
    chains: list[ChainInput],
    ligands: list[LigandInput],
    affinity: bool,
    pocket_residues: list[int] | None = None,
    pocket_max_distance: float = POCKET_DISTANCE_DEFAULT,
    pocket_force: bool = False,
    msa_mode: MsaMode = "server",
    msa_paths: dict[str, str] | None = None,
    max_tokens: int | None = None,
) -> BoltzJobSpec:
    """Validate a request and return the specification the YAML is written from."""
    if not RECORD_ID_PATTERN.match(record_id):
        raise BoltzInputError("invalid_record_id", f"'{record_id}' cannot be used as an input file name.")
    if not chains:
        raise BoltzInputError("no_chain", "At least one protein chain is required.")

    seen: set[str] = set()
    protein_chains: list[ProteinChain] = []
    caveats: list[str] = []
    for chain in chains:
        if chain.molecule_type != "protein":
            raise BoltzInputError(
                "unsupported_molecule_type",
                "This adapter accepts protein chains only. With an RNA or DNA target the Boltz affinity "
                "output is unreliable.",
                {"molecule_type": chain.molecule_type},
            )
        if not ENTITY_ID_PATTERN.match(chain.entity_id) or chain.entity_id in seen:
            raise BoltzInputError("invalid_chain_id", f"Chain ID '{chain.entity_id}' is invalid or repeated.")
        seen.add(chain.entity_id)
        if chain.residue_start < 1:
            raise BoltzInputError("invalid_residue_start", "The first residue position must be 1 or more.")
        if msa_mode == "single_sequence":
            msa: str | None = "empty"
        elif msa_mode == "precomputed":
            msa = (msa_paths or {}).get(chain.entity_id)
            if not msa:
                raise BoltzInputError(
                    "msa_missing", f"No precomputed alignment was given for chain {chain.entity_id}."
                )
        else:
            msa = None
        if chain.applied_variant_ids:
            caveats.append(CAVEAT_VARIANT_SEQUENCE)
        protein_chains.append(
            ProteinChain(
                id=chain.entity_id,
                sequence=validate_protein_sequence(chain.sequence, chain_id=chain.entity_id),
                residue_start=chain.residue_start,
                uniprot_accession=chain.uniprot_accession,
                applied_variant_ids=tuple(chain.applied_variant_ids),
                msa=msa,
            )
        )

    if affinity and len(ligands) != 1:
        raise BoltzInputError(
            "affinity_needs_one_ligand",
            "Boltz-2 affinity is computed for exactly one small-molecule ligand per run; "
            f"{len(ligands)} were given.",
            {"ligands": len(ligands)},
        )
    analysed: list[Ligand] = []
    for ligand in ligands:
        if ligand.entity_id in seen:
            raise BoltzInputError("invalid_ligand_id", f"Chain ID '{ligand.entity_id}' is used twice.")
        seen.add(ligand.entity_id)
        checked, ligand_caveats = analyse_ligand(ligand, for_affinity=affinity)
        analysed.append(checked)
        caveats.extend(ligand_caveats)
    if affinity:
        caveats.append(CAVEAT_ACTIVES_ONLY)

    pocket: PocketConstraint | None = None
    if pocket_residues:
        if not analysed:
            raise BoltzInputError("pocket_needs_ligand", "A pocket constraint needs a ligand to act on.")
        pocket = pocket_constraint(
            protein_chains[0],
            analysed[0].id,
            pocket_residues,
            max_distance=pocket_max_distance,
            force=pocket_force,
        )

    spec = BoltzJobSpec(
        record_id=record_id,
        chains=tuple(protein_chains),
        ligands=tuple(analysed),
        affinity_binder=analysed[0].id if affinity else None,
        pocket=pocket,
        msa_mode=msa_mode,
        caveats=tuple(dict.fromkeys(caveats)),
    )
    tokens = spec.token_estimate if spec.token_estimate is not None else spec.protein_residue_count
    if max_tokens is not None and tokens > max_tokens:
        raise BoltzInputError(
            "input_too_large",
            f"The input is about {tokens} tokens (residues plus ligand heavy atoms); this deployment "
            f"accepts at most {max_tokens}. Model a shorter residue window around the site of interest.",
            {"tokens": tokens, "limit": max_tokens},
        )
    return spec
