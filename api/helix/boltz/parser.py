"""Parser of a Boltz results directory.

Layout and keys are the documented ones (docs/research/structure-models.md section 6.4):

    boltz_results_<id>/predictions/<id>/<id>_model_<n>.cif
                                        confidence_<id>_model_<n>.json
                                        plddt_<id>_model_<n>.npz   key "plddt", per token, 0-1
                                        pae_<id>_model_<n>.npz     key "pae", tokens x tokens, angstrom
                                        pde_<id>_model_<n>.npz     key "pde"
                                        affinity_<id>.json         only with properties.affinity
    boltz_results_<id>/msa/                                        raw server alignments

Success is decided by file existence: Boltz catches out-of-memory errors and can exit with code 0
without writing a prediction. Every number returned here was read from one of these files.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import gemmi
import numpy as np
from pydantic import Field

from helix.boltz.spec import BoltzJobSpec
from helix.schemas.common import ConfidenceSummary, PlddtFractions, Schema

CONFIDENCE_KEYS = (
    "confidence_score",
    "ptm",
    "iptm",
    "ligand_iptm",
    "protein_iptm",
    "complex_plddt",
    "complex_iplddt",
    "complex_pde",
    "complex_ipde",
    "chains_ptm",
    "pair_chains_iptm",
)
AFFINITY_KEYS = (
    "affinity_pred_value",
    "affinity_probability_binary",
    "affinity_pred_value1",
    "affinity_probability_binary1",
    "affinity_pred_value2",
    "affinity_probability_binary2",
)
RANKING_SCORE_NAME = "boltz_confidence_score"
AFFINITY_UNIT = "predicted log10(IC50 / µM)"
BINDER_PROBABILITY_LABEL = "predicted probability that the ligand is a binder (0-1)"
KCAL_PER_MOL_FACTOR = 1.364
# A hand-written parser fixture carries this key; it is refused everywhere except the self-check
FIXTURE_MARKER = "_helix_parser_fixture"

OUT_OF_MEMORY_PATTERN = re.compile(r"ran out of memory", re.IGNORECASE)
FAILED_EXAMPLES_PATTERN = re.compile(r"Number of failed examples:\s*(\d+)")


class BoltzOutputError(Exception):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


@dataclass(slots=True)
class BoltzSample:
    index: int
    structure_path: Path
    confidence_path: Path
    confidence: dict[str, Any]
    plddt_path: Path | None = None
    pae_path: Path | None = None
    pde_path: Path | None = None


@dataclass(slots=True)
class BoltzOutputs:
    record_id: str
    prediction_dir: Path
    samples: list[BoltzSample]
    affinity_path: Path | None = None
    affinity: dict[str, Any] | None = None
    msa_files: list[Path] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class AffinityDerived(Schema):
    """Values computed from affinity_pred_value by formula, for display next to the raw value.
    They are not separate model outputs and not measurements."""

    approx_ic50_um: float = Field(description="10 ** affinity_pred_value, in µM")
    pic50: float = Field(description="6 - affinity_pred_value")
    pic50_kcal_per_mol: float = Field(description="(6 - affinity_pred_value) * 1.364, per Boltz docs")
    formulae: dict[str, str]
    note: str


class AffinitySettings(Schema):
    diffusion_samples_affinity: int
    sampling_steps_affinity: int
    affinity_mw_correction: bool


class PredictedAffinity(Schema):
    """Boltz-2 affinity output with its units. Field names are the keys of affinity_<id>.json."""

    affinity_pred_value: float
    affinity_pred_value_unit: Literal["predicted log10(IC50 / µM)"] = AFFINITY_UNIT
    lower_is_stronger: Literal[True] = True
    affinity_pred_value1: float | None = None
    affinity_pred_value2: float | None = None
    affinity_pred_value_spread: float | None = Field(
        default=None, description="Absolute difference between the two ensemble members"
    )
    affinity_probability_binary: float
    affinity_probability_binary_label: str = BINDER_PROBABILITY_LABEL
    affinity_probability_binary1: float | None = None
    affinity_probability_binary2: float | None = None
    derived: AffinityDerived
    settings: AffinitySettings | None = None
    intended_use: dict[str, str]


INTENDED_USE = {
    "affinity_pred_value": (
        "Hit-to-lead and lead optimisation. Per the Boltz documentation it should only be used when "
        "comparing different active molecules, not inactives."
    ),
    "affinity_probability_binary": (
        "Hit discovery: separating binders from decoys. It is not a measure of binding strength."
    ),
}


def failure_reason(log_text: str) -> tuple[str, str]:
    """Code and message for a run that wrote no prediction, from what Boltz printed."""
    if OUT_OF_MEMORY_PATTERN.search(log_text):
        return (
            "boltz_out_of_memory",
            "Boltz ran out of memory and skipped the prediction. Model a shorter residue window or "
            "use a GPU with more memory.",
        )
    failed = FAILED_EXAMPLES_PATTERN.findall(log_text)
    if failed and int(failed[-1]) > 0:
        return (
            "boltz_failed_examples",
            f"Boltz reported {failed[-1]} failed example(s) and wrote no prediction.",
        )
    return "boltz_no_output", "Boltz finished without writing a prediction."


def _read_json(path: Path, *, allow_fixture: bool) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise BoltzOutputError(
            "boltz_output_unreadable", f"{path.name} could not be read: {error}"
        ) from error
    if not isinstance(document, dict):
        raise BoltzOutputError("boltz_output_unreadable", f"{path.name} is not a JSON object.")
    if FIXTURE_MARKER in document and not allow_fixture:
        raise BoltzOutputError(
            "fixture_output_refused",
            f"{path.name} is a hand-written parser fixture, not model output, and is never returned.",
        )
    return document


def parse_results(
    results_dir: Path,
    record_id: str,
    *,
    expect_affinity: bool,
    log_text: str = "",
    allow_fixture: bool = False,
) -> BoltzOutputs:
    prediction_dir = results_dir / "predictions" / record_id
    structure_path = prediction_dir / f"{record_id}_model_0.cif"
    confidence_path = prediction_dir / f"confidence_{record_id}_model_0.json"
    missing = [path.name for path in (structure_path, confidence_path) if not path.is_file()]
    if missing:
        code, message = failure_reason(log_text)
        raise BoltzOutputError(
            code, message, {"missing_files": missing, "log_tail": log_text[-4000:] or None}
        )

    warnings: list[str] = []
    samples: list[BoltzSample] = []
    index = 0
    while True:
        structure_path = prediction_dir / f"{record_id}_model_{index}.cif"
        confidence_path = prediction_dir / f"confidence_{record_id}_model_{index}.json"
        if not structure_path.is_file() or not confidence_path.is_file():
            break
        confidence = _read_json(confidence_path, allow_fixture=allow_fixture)
        absent = [key for key in CONFIDENCE_KEYS if key not in confidence]
        if absent:
            warnings.append(f"confidence_keys_missing:{','.join(absent)}")

        def optional(prefix: str, sample: int = index) -> Path | None:
            path = prediction_dir / f"{prefix}_{record_id}_model_{sample}.npz"
            return path if path.is_file() else None

        samples.append(
            BoltzSample(
                index=index,
                structure_path=structure_path,
                confidence_path=confidence_path,
                confidence=confidence,
                plddt_path=optional("plddt"),
                pae_path=optional("pae"),
                pde_path=optional("pde"),
            )
        )
        index += 1

    affinity_path = prediction_dir / f"affinity_{record_id}.json"
    affinity: dict[str, Any] | None = None
    if affinity_path.is_file():
        affinity = _read_json(affinity_path, allow_fixture=allow_fixture)
        for key in ("affinity_pred_value", "affinity_probability_binary"):
            if not isinstance(affinity.get(key), (int, float)) or isinstance(affinity.get(key), bool):
                raise BoltzOutputError(
                    "boltz_affinity_malformed", f"{affinity_path.name} has no numeric {key}."
                )
    elif expect_affinity:
        warnings.append("affinity_output_missing")

    msa_dir = results_dir / "msa"
    msa_files = (
        sorted(path for path in msa_dir.rglob("*") if path.is_file() and path.suffix in (".a3m", ".csv"))
        if msa_dir.is_dir()
        else []
    )
    return BoltzOutputs(
        record_id=record_id,
        prediction_dir=prediction_dir,
        samples=samples,
        affinity_path=affinity_path if affinity is not None else None,
        affinity=affinity,
        msa_files=msa_files,
        warnings=warnings,
    )


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def plddt_category(score: float) -> str:
    """AlphaFold DB band letters with lower-inclusive cut-offs at 90, 70 and 50."""
    if score >= 90:
        return "H"
    if score >= 70:
        return "M"
    if score >= 50:
        return "L"
    return "D"


def read_token_plddt(path: Path) -> list[float]:
    """Per-token pLDDT of plddt_<id>_model_<n>.npz, normalised from 0-1 to 0-100."""
    with np.load(path) as archive:
        values = np.asarray(archive["plddt"], dtype=float).reshape(-1)
    return [round(float(value) * 100.0, 2) for value in values]


def read_matrix(path: Path, key: str) -> np.ndarray:
    with np.load(path) as archive:
        return np.asarray(archive[key], dtype=float)


@dataclass(slots=True)
class SampleConfidence:
    summary: ConfidenceSummary
    # First protein chain, UniProt order; None when the token count does not fit the input
    plddt_per_residue: list[float] | None
    plddt_document: dict[str, Any] | None
    pae_document: list[dict[str, Any]] | None
    warnings: list[str]


def _token_layout(spec: BoltzJobSpec) -> list[dict[str, Any]]:
    """Token ranges in input order: one token per protein residue, then one per ligand atom."""
    layout: list[dict[str, Any]] = []
    offset = 0
    for chain in spec.chains:
        layout.append(
            {
                "chain": chain.id,
                "kind": "protein_residues",
                "start": offset,
                "end": offset + len(chain.sequence) - 1,
                "uniprot_start": chain.residue_start,
            }
        )
        offset += len(chain.sequence)
    for ligand in spec.ligands:
        layout.append({"chain": ligand.id, "kind": "ligand_atoms", "start": offset, "end": None})
    return layout


def summarise_confidence(sample: BoltzSample, spec: BoltzJobSpec) -> SampleConfidence:
    """Normalised confidence of one sample. pLDDT becomes 0-100 with the native scale recorded;
    ipTM is null for a single-chain job, where Boltz writes 0."""
    confidence = sample.confidence
    warnings: list[str] = []
    single_chain = spec.chain_count == 1
    complex_plddt = _number(confidence.get("complex_plddt"))

    token_plddt: list[float] | None = None
    if sample.plddt_path is not None:
        try:
            token_plddt = read_token_plddt(sample.plddt_path)
        except (OSError, KeyError, ValueError) as error:
            warnings.append(f"plddt_file_unreadable:{type(error).__name__}")
    plddt_per_residue: list[float] | None = None
    plddt_document: dict[str, Any] | None = None
    fractions: PlddtFractions | None = None
    protein_tokens = spec.protein_residue_count
    if token_plddt is not None and len(token_plddt) >= protein_tokens:
        chains: list[dict[str, Any]] = []
        offset = 0
        for chain in spec.chains:
            scores = token_plddt[offset : offset + len(chain.sequence)]
            offset += len(chain.sequence)
            chains.append(
                {
                    "chain": chain.id,
                    "uniprot_accession": chain.uniprot_accession,
                    "residueNumber": list(range(chain.residue_start, chain.residue_end + 1)),
                    "confidenceScore": scores,
                    "confidenceCategory": [plddt_category(score) for score in scores],
                }
            )
        plddt_per_residue = chains[0]["confidenceScore"]
        protein_scores = token_plddt[:protein_tokens]
        total = len(protein_scores)
        fractions = PlddtFractions(
            very_low=sum(score < 50 for score in protein_scores) / total,
            low=sum(50 <= score < 70 for score in protein_scores) / total,
            confident=sum(70 <= score < 90 for score in protein_scores) / total,
            very_high=sum(score >= 90 for score in protein_scores) / total,
        )
        ligand_tokens = token_plddt[protein_tokens:]
        expected = spec.token_estimate
        if expected is not None and len(token_plddt) != expected:
            warnings.append(f"plddt_token_count_differs:{len(token_plddt)}_vs_{expected}")
        plddt_document = {
            # Same keys as an AlphaFold DB confidence file, for the first protein chain
            "residueNumber": chains[0]["residueNumber"],
            "confidenceScore": chains[0]["confidenceScore"],
            "confidenceCategory": chains[0]["confidenceCategory"],
            "chains": chains,
            "ligand_atom_scores": ligand_tokens,
            "scale": "0-100",
            "native_scale": "0-1",
            "numbering": "UniProt canonical",
            "derived_from": sample.plddt_path.name if sample.plddt_path else None,
            "category_cutoffs": "H >= 90, M >= 70, L >= 50, D < 50",
        }
    elif token_plddt is not None:
        warnings.append(f"plddt_token_count_below_residue_count:{len(token_plddt)}_vs_{protein_tokens}")

    pae_document: list[dict[str, Any]] | None = None
    if sample.pae_path is not None:
        try:
            matrix = read_matrix(sample.pae_path, "pae")
            if matrix.ndim == 3 and matrix.shape[0] == 1:
                matrix = matrix[0]
            pae_document = [
                {
                    "predicted_aligned_error": np.round(matrix, 2).tolist(),
                    # Largest value in this matrix, not a cap stated by the model
                    "max_predicted_aligned_error": round(float(matrix.max()), 2),
                    "max_is_observed_maximum": True,
                    "unit": "angstrom",
                    "axes": "tokens: one per protein residue, one per ligand atom",
                    "token_layout": _token_layout(spec),
                    "derived_from": sample.pae_path.name,
                }
            ]
        except (OSError, KeyError, ValueError) as error:
            warnings.append(f"pae_file_unreadable:{type(error).__name__}")

    summary = ConfidenceSummary(
        plddt_mean=round(complex_plddt * 100.0, 2) if complex_plddt is not None else None,
        plddt_native_scale="0-1",
        plddt_fractions=fractions,
        pae_available=pae_document is not None,
        pae_max=None,
        ptm=_number(confidence.get("ptm")),
        iptm=None if single_chain else _number(confidence.get("iptm")),
        ranking_score=_number(confidence.get("confidence_score")),
        ranking_score_name=RANKING_SCORE_NAME,
        provider_native=confidence,
    )
    return SampleConfidence(
        summary=summary,
        plddt_per_residue=plddt_per_residue,
        plddt_document=plddt_document,
        pae_document=pae_document,
        warnings=warnings,
    )


def inspect_structure(path: Path) -> dict[str, Any]:
    """What the coordinate file holds: chains, residue counts and the one-letter sequence of each
    polymer chain, for comparison with the submitted input."""
    structure = gemmi.read_structure(str(path))
    if len(structure) == 0:
        raise BoltzOutputError("boltz_output_unreadable", f"{path.name} contains no model.")
    structure.setup_entities()
    chains: list[dict[str, Any]] = []
    for chain in structure[0]:
        names = [residue.name for residue in chain]
        b_factors = [atom.b_iso for residue in chain for atom in residue]
        chains.append(
            {
                "chain": chain.name,
                "residues": len(names),
                "atoms": len(b_factors),
                "sequence": gemmi.one_letter_code(names).upper(),
                "b_factor_mean": round(sum(b_factors) / len(b_factors), 2) if b_factors else None,
            }
        )
    return {"chains": chains}


def typed_affinity(affinity: dict[str, Any], settings: AffinitySettings | None = None) -> PredictedAffinity:
    """Affinity values with their unit label, the ensemble spread and derived display values."""
    value = float(affinity["affinity_pred_value"])
    first = _number(affinity.get("affinity_pred_value1"))
    second = _number(affinity.get("affinity_pred_value2"))
    return PredictedAffinity(
        affinity_pred_value=value,
        affinity_pred_value1=first,
        affinity_pred_value2=second,
        affinity_pred_value_spread=(
            round(abs(first - second), 6) if first is not None and second is not None else None
        ),
        affinity_probability_binary=float(affinity["affinity_probability_binary"]),
        affinity_probability_binary1=_number(affinity.get("affinity_probability_binary1")),
        affinity_probability_binary2=_number(affinity.get("affinity_probability_binary2")),
        derived=AffinityDerived(
            approx_ic50_um=10.0**value,
            pic50=6.0 - value,
            pic50_kcal_per_mol=(6.0 - value) * KCAL_PER_MOL_FACTOR,
            formulae={
                "approx_ic50_um": "10 ** affinity_pred_value",
                "pic50": "6 - affinity_pred_value",
                "pic50_kcal_per_mol": "(6 - affinity_pred_value) * 1.364",
            },
            note=(
                "Derived from affinity_pred_value by formula for display. Not separate model outputs, "
                "not measured values, and not Kd, Ki or a measured free energy."
            ),
        ),
        settings=settings,
        intended_use=INTENDED_USE,
    )
