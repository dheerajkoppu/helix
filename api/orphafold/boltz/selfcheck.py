"""Check the YAML builder against the documented schema and the parser against the documented
output layout, on a machine that cannot run Boltz.

    cd api && .venv/bin/python -m orphafold.boltz.selfcheck

The parser is read against the hand-written fixture in api/worker/boltz/fixtures, which is not
model output and is refused by the parser everywhere else.
"""

import sys
import tempfile
from pathlib import Path

import yaml

from orphafold.boltz.parameters import BoltzParameters, cli_options
from orphafold.boltz.parser import (
    AFFINITY_KEYS,
    AFFINITY_UNIT,
    CONFIDENCE_KEYS,
    BoltzOutputError,
    inspect_structure,
    parse_results,
    summarise_confidence,
    typed_affinity,
)
from orphafold.boltz.spec import BoltzInputError, build_spec
from orphafold.boltz.yaml_builder import build_yaml, validate_document
from orphafold.config import API_DIR
from orphafold.providers.base import ChainInput, LigandInput

FIXTURE_DIR = API_DIR / "worker" / "boltz" / "fixtures" / "boltz_results_parser_fixture"
FIXTURE_ID = "parser_fixture"

BTK_FIRST_60 = "MAAVILESIFLKRSQQKKKTSPLNFKKRLFLLTVHKLSYYEYDFERGRRGSKKGSIDVEK"
BTK_KINASE = (
    "GSWEIDPKDLTFLKELGTGQFGVVKYGKWRGQYDVAIKMIKEGSMSEDEFIEEAKVMMNLSHEKLVQLYGVCTKQRPIFIITEYMANGCLLNYLREMRHRF"
    "QTQQLLEMCKDVCEAMEYLESKQFLHRDLAARNCLVNDQGVVKVSDFGLSRYVLDDEYTSSVGSKFPVRWSPPEVLMYSKFSSKSDIWAFGVLMWEIYSLG"
    "KMPYERFTNSETAEHIAQGLRLYRPHLASEKVYTIMYSCWHEKADERPTFKILLSNILDVMDEES"
)
TYROSINE = "N[C@@H](Cc1ccc(O)cc1)C(=O)O"

# The two examples of docs/research/structure-models.md section 6.4
DOCUMENTED_MONOMER = f"""
version: 1
sequences:
  - protein:
      id: A
      sequence: {BTK_FIRST_60}
"""
DOCUMENTED_COMPLEX = f"""
version: 1
sequences:
  - protein:
      id: A
      sequence: {BTK_KINASE}
      msa: ./msa/A.a3m
  - ligand:
      id: L
      smiles: "{TYROSINE}"
constraints:
  - pocket:
      binder: L
      contacts: [[A, 97], [A, 98]]
      max_distance: 6
properties:
  - affinity:
      binder: L
"""

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    print(f"  {'ok  ' if condition else 'FAIL'}  {label}")
    if not condition:
        _failures.append(label)


def refuses(code: str, label: str, **arguments: object) -> None:
    try:
        build_spec(**arguments)  # type: ignore[arg-type]
    except BoltzInputError as error:
        check(error.code == code, f"{label} ({error.code})")
    else:
        check(False, f"{label} was accepted")


def check_yaml() -> None:
    print("YAML builder")
    monomer = build_spec(
        record_id="job_monomer", chains=[ChainInput(sequence=BTK_FIRST_60)], ligands=[], affinity=False
    )
    text, document = build_yaml(monomer)
    check(document == yaml.safe_load(DOCUMENTED_MONOMER), "monomer equals the documented example")
    check(BTK_FIRST_60 in text, "the sequence is written on one line")

    complex_spec = build_spec(
        record_id="job_complex",
        chains=[ChainInput(sequence=BTK_KINASE, uniprot_accession="Q06187", residue_start=393)],
        ligands=[LigandInput(smiles=TYROSINE)],
        affinity=True,
        # UniProt positions; the YAML carries 1-indexed positions in the chain
        pocket_residues=[489, 490],
        msa_mode="precomputed",
        msa_paths={"A": "./msa/A.a3m"},
    )
    text, document = build_yaml(complex_spec)
    check(
        document == yaml.safe_load(DOCUMENTED_COMPLEX),
        "protein + ligand + pocket + affinity equals the documented example",
    )
    check(f'smiles: "{TYROSINE}"' in text, "SMILES is double-quoted")
    check(complex_spec.ligands[0].inchikey == "OUYCCCASQSFEME-QMMMGPOBSA-N", "InChIKey of L-tyrosine")
    check(complex_spec.ligands[0].atom_count == 13, "ligand atom count after RemoveHs")

    ccd = build_spec(
        record_id="job_ccd",
        chains=[ChainInput(sequence=BTK_KINASE)],
        ligands=[LigandInput(ccd="1E8")],
        affinity=True,
    )
    text, document = build_yaml(ccd)
    check(document["sequences"][1] == {"ligand": {"id": "L", "ccd": "1E8"}}, "CCD ligand")
    check('ccd: "1E8"' in text, "a CCD code that looks like a number stays a string")
    single = build_spec(
        record_id="job_single",
        chains=[ChainInput(sequence=BTK_FIRST_60)],
        ligands=[],
        affinity=False,
        msa_mode="single_sequence",
    )
    check(
        build_yaml(single)[1]["sequences"][0]["protein"]["msa"] == "empty",
        "single-sequence mode writes msa: empty",
    )

    check(
        bool(
            validate_document(
                {"version": 1, "sequences": [{"ligand": {"id": "L", "smiles": "C", "ccd": "X"}}]}
            )
        ),
        "schema check rejects smiles together with ccd",
    )
    check(
        bool(
            validate_document(
                {"version": 1, "sequences": [{"protein": {"id": "A", "sequence": "MA", "foo": 1}}]}
            )
        ),
        "schema check rejects an undocumented key",
    )
    chain = [ChainInput(sequence=BTK_KINASE, residue_start=393)]
    refuses("ligand_smiles_and_ccd", "smiles and ccd together", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="CCO", ccd="EOH")], affinity=True)  # fmt: skip
    refuses("affinity_needs_one_ligand", "two ligands with affinity", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="CCO"), LigandInput(entity_id="M", smiles="CCN")],
            affinity=True)  # fmt: skip
    refuses("ligand_too_large", "ligand above 128 atoms", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="C" * 129)], affinity=True)  # fmt: skip
    refuses("ligand_multiple_components", "salt form", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="CC(=O)[O-].[Na+]")], affinity=True)  # fmt: skip
    refuses("invalid_smiles", "unparseable SMILES", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="C1CC")], affinity=True)  # fmt: skip
    refuses("pocket_residue_outside_sequence", "pocket residue outside the window", record_id="x",
            chains=chain, ligands=[LigandInput(smiles="CCO")], affinity=True,
            pocket_residues=[28])  # fmt: skip
    refuses("input_too_large", "token cap", record_id="x", chains=chain,
            ligands=[LigandInput(smiles="CCO")], affinity=True, max_tokens=100)  # fmt: skip
    refuses("invalid_sequence", "non-standard residue", record_id="x",
            chains=[ChainInput(sequence="MAXB")], ligands=[], affinity=False)  # fmt: skip
    large = build_spec(record_id="x", chains=chain, ligands=[LigandInput(smiles="C" * 60)], affinity=True)
    check("ligand_atoms_above_56" in large.caveats, "ligand above 56 atoms is accepted with a caveat")

    options = cli_options(
        BoltzParameters(),
        seed=7,
        msa_mode="server",
        msa_server_url="https://api.colabfold.com",
        affinity=True,
    )
    check(options[options.index("--seed") + 1] == "7", "the seed is always passed")
    for flag in ("--use_msa_server", "--msa_server_url", "--write_full_pae", "--use_potentials", "--override",
                 "--recycling_steps", "--sampling_steps", "--diffusion_samples", "--sampling_steps_affinity",
                 "--diffusion_samples_affinity"):  # fmt: skip
        check(flag in options, f"option {flag}")


def check_parser() -> None:
    print("Output parser")
    spec = build_spec(
        record_id=FIXTURE_ID,
        chains=[ChainInput(sequence="GSWEID", uniprot_accession="Q06187", residue_start=393)],
        ligands=[LigandInput(smiles="CCO")],
        affinity=True,
    )
    try:
        parse_results(FIXTURE_DIR, FIXTURE_ID, expect_affinity=True)
    except BoltzOutputError as error:
        check(error.code == "fixture_output_refused", "the fixture is refused outside this check")
    else:
        check(False, "the fixture was accepted as a result")

    outputs = parse_results(FIXTURE_DIR, FIXTURE_ID, expect_affinity=True, allow_fixture=True)
    sample = outputs.samples[0]
    check(len(outputs.samples) == 1, "one sample found by file name")
    check(all(key in sample.confidence for key in CONFIDENCE_KEYS), "every documented confidence key is read")
    check(
        outputs.affinity is not None and all(key in outputs.affinity for key in AFFINITY_KEYS),
        "every documented affinity key is read",
    )
    check(sample.plddt_path is not None and sample.pae_path is not None, "plddt and pae archives located")
    check([path.name for path in outputs.msa_files] == ["parser_fixture_0.csv"], "alignment file located")

    confidence = summarise_confidence(sample, spec)
    check(confidence.summary.plddt_native_scale == "0-1", "native pLDDT scale kept")
    check(confidence.summary.plddt_mean == 84.02, "complex_plddt normalised to 0-100")
    check(
        confidence.plddt_per_residue == [95.0, 91.0, 90.0, 72.0, 55.0, 41.0],
        "per-residue pLDDT normalised to 0-100",
    )
    document = confidence.plddt_document or {}
    check(document.get("residueNumber") == [393, 394, 395, 396, 397, 398], "residues in UniProt numbering")
    check(
        document.get("confidenceCategory") == ["H", "H", "H", "M", "L", "D"],
        "bands are lower-inclusive at 90, 70, 50",
    )
    check(document.get("ligand_atom_scores") == [60.0, 61.0, 62.0], "ligand atoms are separate tokens")
    check(confidence.summary.iptm == 0.8225, "ipTM kept for a two-chain job")
    check(confidence.summary.ranking_score == 0.8367, "ranking score is confidence_score")
    check(confidence.summary.ranking_score_name == "boltz_confidence_score", "ranking score is named")
    check(
        confidence.summary.pae_available and confidence.summary.pae_max is None,
        "PAE present, no cap invented",
    )
    pae = (confidence.pae_document or [{}])[0]
    check(len(pae.get("predicted_aligned_error", [])) == 9, "PAE is token by token")
    check(confidence.summary.provider_native == sample.confidence, "raw confidence kept verbatim")
    check(not confidence.warnings, f"no warnings ({confidence.warnings})")

    monomer = build_spec(
        record_id=FIXTURE_ID, chains=[ChainInput(sequence="GSWEID")], ligands=[], affinity=False
    )
    check(summarise_confidence(sample, monomer).summary.iptm is None, "ipTM is null for a single-chain job")

    inspection = inspect_structure(sample.structure_path)
    check(inspection["chains"][0]["sequence"] == "GSWEID", "coordinates match the submitted sequence")

    affinity = typed_affinity(outputs.affinity or {})
    check(
        affinity.affinity_pred_value_unit == AFFINITY_UNIT == "predicted log10(IC50 / µM)",
        "affinity unit label",
    )
    check(affinity.affinity_pred_value == 0.8367, "affinity value verbatim")
    check(affinity.affinity_probability_binary == 0.8425, "binder probability verbatim")
    check(abs(affinity.derived.approx_ic50_um - 10**0.8367) < 1e-9, "derived IC50 = 10 ** value")
    check(abs(affinity.derived.pic50 - 5.1633) < 1e-9, "derived pIC50 = 6 - value")
    check(abs(affinity.derived.pic50_kcal_per_mol - 5.1633 * 1.364) < 1e-9, "derived (6 - value) * 1.364")
    check(affinity.affinity_pred_value_spread == 0.0, "ensemble spread")

    with tempfile.TemporaryDirectory() as directory:
        empty = Path(directory)
        for log_text, code in (
            (
                "WARNING: ran out of memory, skipping batch\nNumber of failed examples: 1",
                "boltz_out_of_memory",
            ),
            ("Number of failed examples: 1", "boltz_failed_examples"),
            ("", "boltz_no_output"),
        ):
            try:
                parse_results(empty, "job_x", expect_affinity=False, log_text=log_text)
            except BoltzOutputError as error:
                check(error.code == code, f"missing files are a failure ({code})")
            else:
                check(False, "missing files were accepted")


def main() -> int:
    check_yaml()
    check_parser()
    print(f"\n{len(_failures)} failed" if _failures else "\nAll checks passed.")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
