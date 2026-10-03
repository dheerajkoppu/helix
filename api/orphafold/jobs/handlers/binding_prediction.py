"""Job kind binding_prediction: co-fold a protein with one small-molecule ligand and, when asked,
predict the affinity of the pair.

The result is a prediction and is worded as one. Structure, pose confidence and affinity come from
the same run and are stored with the exact input YAML, the alignment and a complete manifest.
"""

import re
from typing import Any, Literal, Self

import httpx
from pydantic import BaseModel, Field, field_validator, model_validator

from orphafold.boltz.parser import PredictedAffinity
from orphafold.boltz.spec import (
    POCKET_DISTANCE_DEFAULT,
    POCKET_DISTANCE_MAX,
    POCKET_DISTANCE_MIN,
    BoltzInputError,
    analyse_ligand,
    validate_protein_sequence,
)
from orphafold.evidence import build_job_evidence
from orphafold.identifiers import UNIPROT_ACCESSION_PATTERN, parse_variant_id
from orphafold.jobs import JobContext, JobFailed, job_handler
from orphafold.jobs.manifest import Hardware, ManifestLigand, ManifestMsa, RecordRef, SoftwareItem
from orphafold.jobs.structures import store_structure_result
from orphafold.knowledge.catalog import get_catalog
from orphafold.providers.base import (
    BindingPredictor,
    BindingRequest,
    ChainInput,
    DatasetVersion,
    LigandInput,
    get_provider,
)
from orphafold.schemas.common import (
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Schema,
    StructureDescriptor,
)
from orphafold.schemas.jobs import ArtifactOut, ArtifactRole, StageSpec

KIND = "binding_prediction"
STAGE_SEQUENCE = "resolve_sequence"
STAGE_STORE = "store_artifacts"
UNIPROT_FASTA_URL = "https://rest.uniprot.org/uniprotkb/{accession}.fasta"
MAX_MSA_CHARACTERS = 8_000_000

POSE_CONFIDENCE_KEYS = (
    "confidence_score",
    "ptm",
    "iptm",
    "ligand_iptm",
    "protein_iptm",
    "complex_plddt",
    "complex_iplddt",
    "complex_pde",
    "complex_ipde",
)


class BindingPredictionParams(BaseModel):
    provider: str = Field(default="boltz2", description="A binding predictor; see GET /api/v1/models")
    uniprot_accession: str | None = Field(
        default=None,
        pattern=rf"^(?:{UNIPROT_ACCESSION_PATTERN})$",
        description="Protein to model. Its canonical sequence is fetched from UniProt unless sequence is set",
    )
    sequence: str | None = Field(
        default=None,
        description="Protein sequence, one-letter codes. With uniprot_accession it must be that protein's "
        "full-length sequence, so positions stay in UniProt numbering",
    )
    residue_start: int | None = Field(
        default=None, ge=1, description="First residue of the modelled window, UniProt numbering"
    )
    residue_end: int | None = Field(
        default=None, ge=1, description="Last residue of the modelled window, UniProt numbering"
    )
    variant_id: str | None = Field(
        default=None, description="Protein substitution to apply before modelling, e.g. BTK-p.Cys481Ser"
    )
    ligand_smiles: str | None = Field(
        default=None, description="Ligand as SMILES (exclusive with ligand_ccd)"
    )
    ligand_ccd: str | None = Field(default=None, description="Ligand as a Chemical Component Dictionary code")
    ligand_label: str | None = Field(default=None, max_length=200, description="Name shown for the ligand")
    ligand_xrefs: list[str] = Field(default_factory=list, description="CURIEs, e.g. chembl:CHEMBL1873475")
    pocket_residues: list[int] = Field(
        default_factory=list, description="UniProt positions the ligand should contact (optional)"
    )
    pocket_max_distance: float = Field(
        default=POCKET_DISTANCE_DEFAULT, ge=POCKET_DISTANCE_MIN, le=POCKET_DISTANCE_MAX, description="Å"
    )
    pocket_force: bool = Field(
        default=False, description="Enforce the pocket with an inference-time potential"
    )
    predict_affinity: bool = True
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    msa_mode: Literal["server", "precomputed", "single_sequence"] = "server"
    msa_content: str | None = Field(
        default=None, max_length=MAX_MSA_CHARACTERS, description="Alignment text for msa_mode=precomputed"
    )
    msa_format: Literal["a3m", "csv"] = "a3m"
    recycling_steps: int | None = Field(default=None, ge=1, le=25)
    sampling_steps: int | None = Field(default=None, ge=1, le=1000)
    diffusion_samples: int | None = Field(default=None, ge=1, le=25)
    use_potentials: bool | None = None
    sampling_steps_affinity: int | None = Field(default=None, ge=1, le=1000)
    diffusion_samples_affinity: int | None = Field(default=None, ge=1, le=25)
    affinity_mw_correction: bool | None = None

    @field_validator("provider")
    @classmethod
    def _is_binding_provider(cls, value: str) -> str:
        if not isinstance(get_provider(value), BindingPredictor):
            raise ValueError(f"'{value}' is not a binding prediction provider")
        return value

    @field_validator("sequence")
    @classmethod
    def _clean_sequence(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return validate_protein_sequence(value)
        except BoltzInputError as error:
            raise ValueError(error.message) from error

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if not self.uniprot_accession and not self.sequence:
            raise ValueError("give uniprot_accession or sequence")
        if self.residue_start and self.residue_end and self.residue_end < self.residue_start:
            raise ValueError("residue_end is before residue_start")
        if self.sequence and self.residue_end and self.residue_end > len(self.sequence):
            raise ValueError(f"residue_end is beyond the sequence (length {len(self.sequence)})")
        if self.variant_id and parse_variant_id(self.variant_id) is None:
            raise ValueError("variant_id must look like GENE-p.Ref3PosAlt3, e.g. BTK-p.Cys481Ser")
        if self.msa_mode == "precomputed" and not self.msa_content:
            raise ValueError("msa_mode=precomputed needs msa_content")
        try:
            analyse_ligand(self.ligand_input(), for_affinity=self.predict_affinity)
        except BoltzInputError as error:
            raise ValueError(error.message) from error
        return self

    def ligand_input(self) -> LigandInput:
        return LigandInput(
            entity_id="L",
            smiles=self.ligand_smiles,
            ccd=self.ligand_ccd,
            label=self.ligand_label,
            xrefs=self.ligand_xrefs,
        )

    def model_parameters(self) -> dict[str, Any]:
        return {
            "predict_affinity": self.predict_affinity,
            "pocket_max_distance": self.pocket_max_distance,
            "pocket_force": self.pocket_force,
            "msa_mode": self.msa_mode,
            "msa_content": self.msa_content,
            "msa_format": self.msa_format,
            "recycling_steps": self.recycling_steps,
            "sampling_steps": self.sampling_steps,
            "diffusion_samples": self.diffusion_samples,
            "use_potentials": self.use_potentials,
            "sampling_steps_affinity": self.sampling_steps_affinity,
            "diffusion_samples_affinity": self.diffusion_samples_affinity,
            "affinity_mw_correction": self.affinity_mw_correction,
        }


class BindingProtein(Schema):
    uniprot_accession: str | None = None
    gene_symbol: str | None = None
    residue_start: int
    residue_end: int
    length: int
    numbering: str
    variant_id: str | None = None
    sequence_source: str


class BindingLigand(Schema):
    entity_id: str
    label: str | None = None
    smiles: str | None = None
    ccd: str | None = None
    canonical_smiles: str | None = None
    inchikey: str | None = Field(default=None, description="Compound ID; null for a CCD code")
    atom_count: int | None = Field(
        default=None, description="Atoms left by RDKit RemoveHs; null for a CCD code"
    )
    heavy_atom_count: int | None = None
    molecular_weight: float | None = None
    xrefs: list[str] = Field(default_factory=list)


class BindingPocketConstraint(Schema):
    uniprot_positions: list[int]
    contacts: list[list[str | int]] = Field(description="Chain ID and 1-indexed chain position, as sent")
    max_distance_angstrom: float
    force: bool


class PoseConfidence(Schema):
    """Keys of confidence_<id>_model_0.json, verbatim, on the model's own scales."""

    confidence_score: float | None = Field(default=None, description="Boltz ranking score, 0-1")
    ptm: float | None = None
    iptm: float | None = None
    ligand_iptm: float | None = Field(default=None, description="The value to read for a protein-ligand pose")
    protein_iptm: float | None = None
    complex_plddt: float | None = Field(default=None, description="0-1, the model's native scale")
    complex_iplddt: float | None = None
    complex_pde: float | None = Field(default=None, description="Å, lower is better")
    complex_ipde: float | None = Field(default=None, description="Å, lower is better")


class BindingPredictionResult(Schema):
    performs_inference: Literal[True] = True
    statement: str
    structure: StructureDescriptor
    protein: BindingProtein
    ligand: BindingLigand
    pocket_constraint: BindingPocketConstraint | None = None
    pose_confidence: PoseConfidence
    affinity: PredictedAffinity | None = Field(
        default=None, description="Null when affinity was not requested or Boltz wrote no affinity file"
    )
    affinity_status: Literal["predicted", "not_requested", "not_produced"]
    caveats: list[str] = Field(
        description="Machine-readable conditions under which the run left validated use"
    )
    limitations: list[str]
    warnings: list[str]
    seed: int
    artifacts: dict[str, str | None] = Field(description="Artifact URL by purpose")
    evidence: list[Evidence]
    gene_symbol: str | None = None
    variant_id: str | None = None


def _binding_provider(provider_id: str) -> BindingPredictor:
    provider = get_provider(provider_id)
    if not isinstance(provider, BindingPredictor):
        raise JobFailed("unsupported_provider", f"'{provider_id}' does not predict binding.")
    return provider


def _placeholder_request(params: BindingPredictionParams) -> BindingRequest:
    return BindingRequest(
        chains=[ChainInput(sequence=params.sequence or "")],
        ligand=params.ligand_input(),
        parameters={"predict_affinity": params.predict_affinity},
    )


def _stages(params: BindingPredictionParams) -> list[StageSpec]:
    provider = get_provider(params.provider)
    planned = provider.plan(_placeholder_request(params)) if isinstance(provider, BindingPredictor) else []
    return [
        StageSpec(id=STAGE_SEQUENCE, label="Resolving the protein sequence"),
        *planned,
        StageSpec(id=STAGE_STORE, label="Storing files"),
    ]


def _ligand_name(params: BindingPredictionParams) -> str:
    return params.ligand_label or params.ligand_ccd or "ligand"


def _title(params: BindingPredictionParams) -> str:
    provider = get_provider(params.provider)
    gene = get_catalog().gene_by_uniprot(params.uniprot_accession) if params.uniprot_accession else None
    target = gene.symbol if gene else params.uniprot_accession or "custom sequence"
    name = provider.name if provider else params.provider
    return f"{name} binding prediction · {target} + {_ligand_name(params)}"


def _subject(params: BindingPredictionParams) -> EntityRef | None:
    if not params.uniprot_accession:
        return None
    gene = get_catalog().gene_by_uniprot(params.uniprot_accession)
    return EntityRef.of(
        EntityType.PROTEIN,
        params.uniprot_accession,
        gene.protein_name if gene else None,
        f"uniprot:{params.uniprot_accession}",
    )


async def _uniprot_sequence(context: JobContext, accession: str) -> tuple[str, RecordRef, DatasetVersion]:
    url = UNIPROT_FASTA_URL.format(accession=accession)
    try:
        async with httpx.AsyncClient(
            timeout=20.0, headers={"User-Agent": context.settings.user_agent}, follow_redirects=True
        ) as client:
            response = await client.get(url)
    except httpx.HTTPError as error:
        raise JobFailed(
            "sequence_unavailable", f"UniProt did not answer for {accession} ({type(error).__name__})."
        ) from error
    lines = response.text.splitlines() if response.status_code == 200 else []
    sequence = "".join(line.strip() for line in lines if not line.startswith(">"))
    if not sequence:
        raise JobFailed(
            "sequence_unavailable",
            f"UniProt returned no sequence for {accession} (HTTP {response.status_code}).",
        )
    release = response.headers.get("x-uniprot-release")
    header = lines[0] if lines and lines[0].startswith(">") else ""
    version = re.search(r"\bSV=(\d+)", header)
    record = RecordRef(
        database="uniprot",
        record_id=accession,
        record_version=version.group(1) if version else None,
        release=release,
        url=f"https://www.uniprot.org/uniprotkb/{accession}",
    )
    dataset = DatasetVersion(name="UniProtKB", version=release or "unknown", license="CC BY 4.0", url=url)
    return sequence, record, dataset


@job_handler(
    KIND,
    title="Predict protein-ligand binding",
    description=(
        "Co-folds a protein with one small-molecule ligand and predicts the affinity of the pair. "
        "A computational prediction for hypothesis generation, never experimental data."
    ),
    params=BindingPredictionParams,
    result=BindingPredictionResult,
    stages=_stages,
    provider=lambda params: params.provider,
    requires_seed=True,
    describe=_title,
    subject=_subject,
)
async def predict_binding(context: JobContext, params: BindingPredictionParams) -> BindingPredictionResult:
    provider = _binding_provider(params.provider)
    availability = await provider.check_availability()
    if not availability.available:
        raise JobFailed(
            "provider_unavailable",
            f"{provider.name} cannot run on this deployment. {availability.reason}",
            {"provider": provider.id},
        )

    accession = params.uniprot_accession
    gene = get_catalog().gene_by_uniprot(accession) if accession else None
    async with context.stage(STAGE_SEQUENCE):
        sequence_source: RecordRef | None = None
        if params.sequence:
            full_sequence = params.sequence
            source_note = "submitted sequence"
        else:
            full_sequence, sequence_source, dataset = await _uniprot_sequence(context, accession or "")
            context.manifest.add_source_dataset(dataset)
            source_note = f"UniProtKB {accession} canonical sequence, release {dataset.version}"
        try:
            full_sequence = validate_protein_sequence(full_sequence)
        except BoltzInputError as error:
            raise JobFailed(error.code, error.message, error.detail) from error

        applied_variants: list[str] = []
        if params.variant_id:
            substitution = parse_variant_id(params.variant_id)
            if substitution is None or substitution.alternate == "*":
                raise JobFailed(
                    "unsupported_variant", "Only single-residue substitutions can be applied to the sequence."
                )
            try:
                full_sequence = substitution.apply(full_sequence)
            except ValueError as error:
                raise JobFailed(
                    "variant_does_not_match_sequence", f"{params.variant_id} cannot be applied: {error}."
                ) from error
            applied_variants.append(params.variant_id)

        start = params.residue_start or 1
        end = params.residue_end or len(full_sequence)
        if start > len(full_sequence) or end > len(full_sequence):
            raise JobFailed(
                "window_outside_sequence",
                f"The window {start}-{end} is outside the sequence (length {len(full_sequence)}).",
            )
        window = full_sequence[start - 1 : end]
        await context.log(
            f"Modelling residues {start}-{end} ({len(window)} of {len(full_sequence)}), {source_note}."
        )

    chain = ChainInput(
        entity_id="A",
        sequence=window,
        uniprot_accession=accession,
        residue_start=start,
        applied_variant_ids=applied_variants,
    )
    result = await provider.predict(
        BindingRequest(
            chains=[chain],
            ligand=params.ligand_input(),
            pocket_residues=params.pocket_residues,
            parameters=params.model_parameters(),
            seed=params.seed,
        ),
        context,
    )
    if result.structure is None:
        raise JobFailed("no_structure", f"{provider.name} returned no complex structure.")
    native = result.provider_native
    ligand = native.get("ligand") or {}

    async with context.stage(STAGE_STORE):
        descriptor = await store_structure_result(
            context,
            result.structure,
            gene_symbol=gene.symbol if gene else None,
            variant_id=params.variant_id,
            sequence_source=sequence_source,
        )
        saved: dict[str, ArtifactOut] = {}
        for file in result.files:
            saved[file.name] = await context.save_artifact(
                file.name,
                file.content if file.content is not None else file.path or b"",
                media_type=file.media_type,
                role=file.role,
            )

        manifest = context.manifest
        manifest.add_ligand(
            ManifestLigand(
                entity_id=ligand.get("entity_id") or "L",
                ccd=ligand.get("ccd"),
                smiles=ligand.get("smiles"),
                inchikey=ligand.get("inchikey"),
                xrefs=params.ligand_xrefs,
            )
        )
        structure_native = result.structure.provider_native
        environment = structure_native.get("environment") or {}
        msa = structure_native.get("msa") or {}
        msa_artifacts = [artifact for artifact in context.artifacts if artifact.role is ArtifactRole.MSA]
        manifest.set_msa(
            ManifestMsa(
                mode=msa.get("mode") or params.msa_mode,
                server_url=msa.get("server_url"),
                pairing_strategy=msa.get("pairing_strategy") if msa.get("mode") == "server" else None,
                search_tool=SoftwareItem(
                    name="MMseqs2 (ColabFold server)", version="not reported by the server"
                )
                if msa.get("mode") == "server"
                else None,
                artifact_ids=[artifact.id for artifact in msa_artifacts],
            )
        )
        for package in ("boltz", "boltz-community", "torch"):
            if environment.get(package):
                manifest.add_package(package, str(environment[package]))
        for package in ("rdkit", "gemmi", "numpy", "pyyaml"):
            manifest.add_package(package)
        accelerator = environment.get("accelerator")
        manifest.hardware = Hardware(
            accelerator=accelerator if accelerator in ("gpu", "cpu", "mps") else None,
            gpu_model=environment.get("gpu_model"),
            gpu_count=environment.get("gpu_count"),
        )
        manifest.cuda = environment.get("cuda")
        if environment.get("container"):
            manifest.container = environment["container"]

    confidence = native.get("confidence") or {}
    summary = native.get("affinity_summary")
    affinity = PredictedAffinity.model_validate(summary) if summary else None
    if affinity is not None:
        affinity_status = "predicted"
    else:
        affinity_status = "not_produced" if params.predict_affinity else "not_requested"
    pocket = native.get("pocket_constraint")

    def url_of(role: ArtifactRole, suffix: str = "") -> str | None:
        return next(
            (
                artifact.url
                for artifact in context.artifacts
                if artifact.role is role and artifact.name.endswith(suffix)
            ),
            None,
        )

    subject = EntityRef.of(EntityType.PROTEIN, accession, None, f"uniprot:{accession}") if accession else None
    ligand_name = params.ligand_label or ligand.get("inchikey") or ligand.get("ccd") or "the ligand"
    evidence = [
        build_job_evidence(
            context.job_id or "",
            "complex_prediction",
            subject=subject,
            predicate="predicted_complex_with",
            object=EvidenceObject(
                type="compound", id=ligand.get("inchikey") or ligand.get("ccd"), label=ligand_name
            ),
            statement=(
                f"Boltz-2 predicted a complex of residues {start}-{end} with {ligand_name}; "
                f"ligand_iptm {confidence.get('ligand_iptm')}."
            ),
            strength_scheme="boltz_confidence",
            strength_value=confidence.get("confidence_score"),
        )
    ]
    if affinity is not None:
        evidence.append(
            build_job_evidence(
                context.job_id or "",
                "affinity_prediction",
                subject=subject,
                predicate="predicted_affinity_for",
                object=EvidenceObject(
                    type="compound",
                    id=ligand.get("inchikey") or ligand.get("ccd"),
                    label=ligand_name,
                    value=affinity.affinity_pred_value,
                    unit=affinity.affinity_pred_value_unit,
                ),
                statement=(
                    f"Boltz-2 predicted log10(IC50 / µM) = {affinity.affinity_pred_value:.3f} and binder "
                    f"probability {affinity.affinity_probability_binary:.3f} for {ligand_name}."
                ),
            )
        )

    return BindingPredictionResult(
        statement=result.limitations[0] if result.limitations else "Computational prediction.",
        structure=descriptor,
        protein=BindingProtein(
            uniprot_accession=accession,
            gene_symbol=gene.symbol if gene else None,
            residue_start=start,
            residue_end=end,
            length=len(window),
            numbering="UniProt canonical" if accession else "position in the submitted sequence",
            variant_id=params.variant_id,
            sequence_source=source_note,
        ),
        ligand=BindingLigand(
            entity_id=ligand.get("entity_id") or "L",
            label=params.ligand_label,
            smiles=ligand.get("smiles"),
            ccd=ligand.get("ccd"),
            canonical_smiles=ligand.get("canonical_smiles"),
            inchikey=ligand.get("inchikey"),
            atom_count=ligand.get("atom_count"),
            heavy_atom_count=ligand.get("heavy_atom_count"),
            molecular_weight=ligand.get("molecular_weight"),
            xrefs=params.ligand_xrefs,
        ),
        pocket_constraint=BindingPocketConstraint(
            uniprot_positions=pocket["uniprot_positions"],
            contacts=pocket["contacts"],
            max_distance_angstrom=pocket["max_distance_angstrom"],
            force=pocket["force"],
        )
        if pocket
        else None,
        pose_confidence=PoseConfidence(
            **{
                key: confidence.get(key)
                for key in POSE_CONFIDENCE_KEYS
                if isinstance(confidence.get(key), (int, float))
            }
        ),
        affinity=affinity,
        affinity_status=affinity_status,
        caveats=list(native.get("caveats") or []),
        limitations=result.limitations,
        warnings=result.warnings,
        seed=params.seed,
        artifacts={
            "structure": descriptor.files.cif_url,
            "confidence": url_of(ArtifactRole.CONFIDENCE_SUMMARY),
            "plddt": descriptor.files.plddt_url,
            "pae": descriptor.files.pae_url,
            "affinity": saved[next(iter(saved))].url if saved else None,
            "affinity_summary": saved["affinity_summary.json"].url
            if "affinity_summary.json" in saved
            else None,
            "model_input": url_of(ArtifactRole.MODEL_INPUT),
            "log": url_of(ArtifactRole.LOG),
            "manifest": f"/api/v1/jobs/{context.job_id}/manifest",
        },
        evidence=evidence,
        gene_symbol=gene.symbol if gene else None,
        variant_id=params.variant_id,
    )
