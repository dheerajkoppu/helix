"""Boltz input YAML (schema version 1) from a validated specification.

The schema checker lists every key documented upstream (docs/research/structure-models.md section
6.4) and is run on each generated document, so the builder cannot emit a key Boltz does not know.
Residue indices in constraints are 1-indexed, unlike the hosted Boltz API.
"""

from typing import Any

import yaml

from helix.boltz.spec import (
    POCKET_DISTANCE_MAX,
    POCKET_DISTANCE_MIN,
    BoltzInputError,
    BoltzJobSpec,
)

SCHEMA_VERSION = 1
TOP_LEVEL_KEYS = {"version", "sequences", "constraints", "templates", "properties"}
POLYMER_TYPES = {"protein", "dna", "rna"}
POLYMER_KEYS = {"id", "sequence", "msa", "modifications", "cyclic"}
LIGAND_KEYS = {"id", "smiles", "ccd"}
CONSTRAINT_KEYS = {
    "bond": {"atom1", "atom2"},
    "pocket": {"binder", "contacts", "max_distance", "force"},
    "contact": {"token1", "token2", "max_distance", "force"},
}
TEMPLATE_KEYS = {"cif", "pdb", "chain_id", "template_id", "force", "threshold"}
AFFINITY_KEYS = {"binder"}


class _Quoted(str):
    """A string always written in double quotes: SMILES and CCD codes such as 1E8 must stay strings
    in every YAML parser."""


class _Flow(list):
    """A list written inline, as the documented examples write contact pairs: [A, 97]."""


class _Dumper(yaml.SafeDumper):
    pass


def _represent_quoted(dumper: yaml.SafeDumper, value: _Quoted) -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(value), style='"')


def _represent_flow(dumper: yaml.SafeDumper, value: _Flow) -> yaml.SequenceNode:
    return dumper.represent_sequence("tag:yaml.org,2002:seq", list(value), flow_style=True)


_Dumper.add_representer(_Quoted, _represent_quoted)
_Dumper.add_representer(_Flow, _represent_flow)


def build_document(spec: BoltzJobSpec) -> dict[str, Any]:
    sequences: list[dict[str, Any]] = []
    for chain in spec.chains:
        protein: dict[str, Any] = {"id": chain.id, "sequence": chain.sequence}
        if chain.msa is not None:
            protein["msa"] = chain.msa
        sequences.append({"protein": protein})
    for ligand in spec.ligands:
        entry: dict[str, Any] = {"id": ligand.id}
        if ligand.smiles is not None:
            entry["smiles"] = _Quoted(ligand.smiles)
        else:
            entry["ccd"] = _Quoted(ligand.ccd or "")
        sequences.append({"ligand": entry})

    document: dict[str, Any] = {"version": SCHEMA_VERSION, "sequences": sequences}
    if spec.pocket is not None:
        pocket: dict[str, Any] = {
            "binder": spec.pocket.binder,
            "contacts": [_Flow([chain, position]) for chain, position in spec.pocket.contacts],
            "max_distance": spec.pocket.max_distance,
        }
        if spec.pocket.force:
            pocket["force"] = True
        document["constraints"] = [{"pocket": pocket}]
    if spec.affinity_binder is not None:
        document["properties"] = [{"affinity": {"binder": spec.affinity_binder}}]
    return document


def dump_yaml(document: dict[str, Any]) -> str:
    # Unlimited width: a folded sequence line would be read back with spaces in it
    return yaml.dump(
        document,
        Dumper=_Dumper,
        sort_keys=False,
        default_flow_style=False,
        width=1_000_000,
        allow_unicode=True,
    )


def _unknown(found: Any, allowed: set[str], where: str) -> list[str]:
    if not isinstance(found, dict):
        return [f"{where} must be a mapping"]
    return [f"{where}: unknown key '{key}'" for key in found if key not in allowed]


def validate_document(document: Any) -> list[str]:
    """Problems of a document against the documented Boltz schema. Empty when it conforms."""
    if not isinstance(document, dict):
        return ["the document must be a mapping"]
    problems = _unknown(document, TOP_LEVEL_KEYS, "document")
    if document.get("version") != SCHEMA_VERSION:
        problems.append("version must be 1")

    sequences = document.get("sequences")
    if not isinstance(sequences, list) or not sequences:
        return [*problems, "sequences must be a non-empty list"]
    chain_ids: list[str] = []
    ligand_ids: list[str] = []
    polymer_lengths: dict[str, int] = {}
    for index, item in enumerate(sequences):
        where = f"sequences[{index}]"
        if not isinstance(item, dict) or len(item) != 1:
            problems.append(f"{where} must hold exactly one of protein, dna, rna, ligand")
            continue
        kind, body = next(iter(item.items()))
        if kind in POLYMER_TYPES:
            problems += _unknown(body, POLYMER_KEYS, f"{where}.{kind}")
            if not isinstance(body, dict):
                continue
            sequence = body.get("sequence")
            if not isinstance(sequence, str) or not sequence or any(char.isspace() for char in sequence):
                problems.append(f"{where}.{kind}.sequence must be a string without whitespace")
            if "msa" in body and not isinstance(body["msa"], str):
                problems.append(f"{where}.{kind}.msa must be a path or 'empty'")
        elif kind == "ligand":
            problems += _unknown(body, LIGAND_KEYS, f"{where}.ligand")
            if not isinstance(body, dict):
                continue
            has_smiles = isinstance(body.get("smiles"), str) and bool(body.get("smiles"))
            has_ccd = isinstance(body.get("ccd"), str) and bool(body.get("ccd"))
            if has_smiles == has_ccd:
                problems.append(f"{where}.ligand needs exactly one of smiles and ccd")
        else:
            problems.append(f"{where}: unknown entity type '{kind}'")
            continue
        ids = body.get("id")
        ids = ids if isinstance(ids, list) else [ids]
        for chain_id in ids:
            if not isinstance(chain_id, str) or not chain_id:
                problems.append(f"{where}.{kind}.id must be a string or a list of strings")
            elif chain_id in chain_ids:
                problems.append(f"{where}.{kind}.id '{chain_id}' is repeated")
            else:
                chain_ids.append(chain_id)
                if kind == "ligand":
                    ligand_ids.append(chain_id)
                elif isinstance(body.get("sequence"), str):
                    polymer_lengths[chain_id] = len(body["sequence"])

    for index, item in enumerate(document.get("constraints") or []):
        where = f"constraints[{index}]"
        if not isinstance(item, dict) or len(item) != 1:
            problems.append(f"{where} must hold exactly one of bond, pocket, contact")
            continue
        kind, body = next(iter(item.items()))
        if kind not in CONSTRAINT_KEYS:
            problems.append(f"{where}: unknown constraint '{kind}'")
            continue
        problems += _unknown(body, CONSTRAINT_KEYS[kind], f"{where}.{kind}")
        if kind != "pocket" or not isinstance(body, dict):
            continue
        if body.get("binder") not in chain_ids:
            problems.append(f"{where}.pocket.binder must name a chain of this document")
        contacts = body.get("contacts")
        if not isinstance(contacts, list) or not contacts:
            problems.append(f"{where}.pocket.contacts must be a non-empty list")
            contacts = []
        for contact in contacts:
            if not (isinstance(contact, list) and len(contact) == 2):
                problems.append(f"{where}.pocket.contacts entries must be [chain, residue index]")
                continue
            chain_id, position = contact
            if chain_id not in polymer_lengths:
                problems.append(f"{where}.pocket.contacts names unknown chain '{chain_id}'")
            elif not isinstance(position, int) or not 1 <= position <= polymer_lengths[chain_id]:
                problems.append(
                    f"{where}.pocket.contacts residue {position} is outside chain {chain_id} "
                    f"(1-indexed, length {polymer_lengths[chain_id]})"
                )
        distance = body.get("max_distance")
        if distance is not None and not (
            isinstance(distance, (int, float)) and POCKET_DISTANCE_MIN <= distance <= POCKET_DISTANCE_MAX
        ):
            problems.append(f"{where}.pocket.max_distance must be between 4 and 20")
        if "force" in body and not isinstance(body["force"], bool):
            problems.append(f"{where}.pocket.force must be a boolean")

    for index, item in enumerate(document.get("templates") or []):
        problems += _unknown(item, TEMPLATE_KEYS, f"templates[{index}]")

    properties = document.get("properties") or []
    affinity_count = 0
    for index, item in enumerate(properties):
        where = f"properties[{index}]"
        if not isinstance(item, dict) or set(item) != {"affinity"}:
            problems.append(f"{where} must hold exactly one affinity entry")
            continue
        affinity_count += 1
        problems += _unknown(item["affinity"], AFFINITY_KEYS, f"{where}.affinity")
        binder = item["affinity"].get("binder") if isinstance(item["affinity"], dict) else None
        if binder not in ligand_ids:
            problems.append(f"{where}.affinity.binder must name a ligand of this document")
    if affinity_count > 1:
        problems.append("only one affinity property is allowed")
    return problems


def build_yaml(spec: BoltzJobSpec) -> tuple[str, dict[str, Any]]:
    """YAML text and the plain document it parses to. Raises when the text does not read back as
    the document that was built or does not conform to the schema."""
    document = build_document(spec)
    text = dump_yaml(document)
    parsed = yaml.safe_load(text)
    problems = validate_document(parsed)
    if parsed != document:
        problems.append("the YAML text does not read back as the document that was built")
    if problems:
        raise BoltzInputError(
            "invalid_boltz_yaml",
            "The generated Boltz input does not conform to the documented schema.",
            {"problems": problems},
        )
    return text, parsed
