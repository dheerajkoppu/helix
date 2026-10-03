"""Boltz-2 provider: structure prediction and protein-ligand co-folding with predicted affinity.

Inference runs on an attached backend (local command line or GPU worker). Without one the provider
reports that it is unavailable and every run fails at once with the reason; it never returns
coordinates or scores that a Boltz run did not write. See docs/providers/boltz2.md.
"""

import asyncio
import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import ValidationError

from helix.boltz.backends import (
    NOT_ATTACHED_REASON,
    SETUP_HINT,
    BackendStatus,
    BoltzBackend,
    BoltzRun,
    BoltzRunRequest,
    boltz_package,
    resolve_backend,
)
from helix.boltz.parameters import DEFAULT_SEED, UPSTREAM_DEFAULTS, BoltzParameters, cli_options
from helix.boltz.parser import (
    AFFINITY_UNIT,
    BINDER_PROBABILITY_LABEL,
    RANKING_SCORE_NAME,
    AffinitySettings,
    BoltzOutputError,
    BoltzOutputs,
    inspect_structure,
    parse_results,
    summarise_confidence,
    typed_affinity,
)
from helix.boltz.settings import get_boltz_settings
from helix.boltz.spec import BoltzInputError, BoltzJobSpec, build_spec
from helix.boltz.yaml_builder import build_yaml
from helix.hashing import sha256_hex
from helix.ids import utcnow
from helix.providers.base import (
    Availability,
    BindingPredictor,
    BindingRequest,
    BindingResult,
    Capability,
    ChainInput,
    ConfidenceSample,
    DatasetVersion,
    ExecutionMode,
    LigandInput,
    ModelCode,
    ModelIdentity,
    ModelWeights,
    ProviderError,
    ProviderFile,
    ProviderInfo,
    RunContext,
    StructurePredictor,
    StructureRequest,
    StructureResult,
    register_provider,
)
from helix.schemas.common import (
    Citation,
    ResidueRange,
    StructureCoverage,
    StructureDescriptor,
    StructureOrigin,
)
from helix.schemas.jobs import ArtifactRole, StageSpec

STAGE_PREPARE = "prepare_input"
STAGE_RUN = "run_model"
STAGE_READ = "read_outputs"

MMCIF_MEDIA_TYPE = "chemical/x-mmcif"
NPZ_MEDIA_TYPE = "application/x-npz"
YAML_MEDIA_TYPE = "application/yaml"

PREDICTION_STATEMENT = (
    "Computational prediction for hypothesis generation. Not experimental data. Not for clinical decisions."
)
LIMITATIONS = (
    PREDICTION_STATEMENT,
    "pLDDT is a local confidence estimate. In complexes it does not by itself indicate whether the "
    "relative placement of chains or the predicted interface is correct.",
    "The Boltz ranking score (0.8 x mean pLDDT + 0.2 x ipTM) orders samples within one run. It is not a "
    "probability of correctness and is not comparable across models.",
    "Not validated for predicting the effect of mutations. A difference between wild-type and variant "
    "output is model behaviour, never measured destabilisation or a measured change in binding.",
)
AFFINITY_LIMITATIONS = (
    "affinity_pred_value is log10(IC50) with IC50 in µM, lower meaning stronger predicted binding. Per the "
    "Boltz documentation it should only be used when comparing different active molecules, not inactives.",
    "affinity_probability_binary is the predicted probability that the ligand is a binder, intended for "
    "separating binders from decoys. It is not a measure of binding strength.",
    "Affinity is computed for one small-molecule ligand bound to a protein. Ligands above 128 atoms are "
    "rejected, and the Boltz documentation does not recommend ligands significantly larger than 56 atoms.",
    "Read the affinity together with the pose confidence of the same run (ligand_iptm, complex_plddt): a "
    "pose with low ligand_iptm makes the affinity uninterpretable.",
    "The affinity module was evaluated on the FEP+ benchmark, CASP16 and the authors' MF-PCBA test set. A "
    "target without a studied series of active compounds is outside that evaluation.",
)
CAVEAT_RECEPTOR_PREDICTED = "receptor_is_predicted_structure"

REPOSITORIES = {
    "boltz": "https://github.com/jwohlwend/boltz",
    "boltz-community": "https://github.com/Novel-Therapeutics/boltz-community",
}


@dataclass(slots=True)
class _Execution:
    spec: BoltzJobSpec
    run: BoltzRun
    outputs: BoltzOutputs
    structure: StructureResult
    parameters: BoltzParameters
    seed: int
    warnings: list[str]


def _input_error(error: BoltzInputError) -> ProviderError:
    return ProviderError(error.code, error.message, error.detail)


@register_provider
class Boltz2Provider(StructurePredictor, BindingPredictor):
    id = "boltz2"
    name = "Boltz-2"
    model_name = "Boltz-2"
    model_version = None
    license = "MIT"
    license_url = "https://github.com/jwohlwend/boltz/blob/main/LICENSE"
    commercial_use = True
    capabilities = (
        Capability.MONOMER,
        Capability.COMPLEX,
        Capability.LIGAND,
        Capability.AFFINITY,
        Capability.PLDDT,
        Capability.PAE,
        Capability.PTM,
        Capability.IPTM,
    )
    execution_mode = ExecutionMode.GPU_WORKER
    structure_origin = StructureOrigin.PREDICTED_INTERNAL
    requires_gpu = True
    limitations = (*LIMITATIONS, *AFFINITY_LIMITATIONS)
    citation = (
        Citation(
            text="Passaro S et al. Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction. "
            "bioRxiv (2025).",
            title="Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction",
            year=2025,
            doi="10.1101/2025.06.14.659707",
        ),
        Citation(
            text="Wohlwend J et al. Boltz-1. bioRxiv (2024).", year=2024, doi="10.1101/2024.11.19.624167"
        ),
        Citation(
            text="Mirdita M et al. ColabFold: making protein folding accessible to all. Nature Methods "
            "(2022). Cite when the MSA server is used.",
            year=2022,
        ),
    )
    attribution = "Boltz (MIT): code and weights by the Boltz authors."
    homepage = "https://github.com/jwohlwend/boltz"
    job_kinds = ("structure_prediction", "binding_prediction")

    def __init__(self) -> None:
        self._backend: BoltzBackend | None = None
        self._backend_resolved = False

    def backend(self) -> BoltzBackend | None:
        if not self._backend_resolved:
            self._backend = resolve_backend(get_boltz_settings())
            self._backend_resolved = True
        return self._backend

    async def backend_status(self) -> BackendStatus:
        backend = self.backend()
        if backend is None:
            return BackendStatus(available=False, reason=NOT_ATTACHED_REASON, setup=SETUP_HINT)
        return await backend.status()

    async def check_availability(self) -> Availability:
        status = await self.backend_status()
        reason = status.reason if status.available else f"{status.reason} {status.setup or SETUP_HINT}"
        return Availability(available=status.available, reason=reason)

    async def current_model_version(self) -> str | None:
        status = await self.backend_status()
        distribution, version = boltz_package(status.environment)
        return f"{distribution} {version}" if distribution else None

    async def describe(self) -> ProviderInfo:
        info = await super().describe()
        status = await self.backend_status()
        if status.execution_mode is not None:
            info.execution_mode = status.execution_mode
        info.max_residues = get_boltz_settings().boltz_max_tokens
        return info

    def plan(self, request: StructureRequest | BindingRequest) -> list[StageSpec]:
        affinity = isinstance(request, BindingRequest) and request.parameters.get("predict_affinity", True)
        return [
            StageSpec(id=STAGE_PREPARE, label="Validating input and writing the Boltz YAML"),
            StageSpec(id=STAGE_RUN, label="Running Boltz-2"),
            StageSpec(
                id=STAGE_READ,
                label="Reading confidence and affinity" if affinity else "Reading confidence",
            ),
        ]

    async def predict(  # type: ignore[override]
        self, request: StructureRequest | BindingRequest, context: RunContext
    ) -> StructureResult | BindingResult:
        if isinstance(request, BindingRequest):
            return await self._predict_binding(request, context)
        if not request.chains:
            raise ProviderError("invalid_input", "Boltz-2 needs at least one protein chain to predict.")
        execution = await self._execute(
            chains=request.chains,
            ligands=request.ligands,
            affinity=False,
            pocket_residues=[],
            parameters=request.parameters,
            seed=request.seed,
            context=context,
        )
        return execution.structure

    async def _predict_binding(self, request: BindingRequest, context: RunContext) -> BindingResult:
        affinity_requested = bool(request.parameters.get("predict_affinity", True))
        execution = await self._execute(
            chains=request.chains,
            ligands=[request.ligand],
            affinity=affinity_requested,
            pocket_residues=request.pocket_residues,
            parameters=request.parameters,
            seed=request.seed,
            context=context,
        )
        outputs = execution.outputs
        record_id = execution.spec.record_id
        files: list[ProviderFile] = []
        metrics: dict[str, Any] = {}
        metric_units: dict[str, str] = {}
        native: dict[str, Any] = {
            "confidence": outputs.samples[0].confidence,
            "affinity": outputs.affinity,
            "affinity_summary": None,
            "ligand": execution.spec.ligands[0].describe(),
            "pocket_constraint": execution.spec.pocket.describe() if execution.spec.pocket else None,
            "caveats": [*execution.spec.caveats, CAVEAT_RECEPTOR_PREDICTED],
        }
        if outputs.affinity is not None and outputs.affinity_path is not None:
            summary = typed_affinity(
                outputs.affinity,
                AffinitySettings(
                    diffusion_samples_affinity=execution.parameters.diffusion_samples_affinity,
                    sampling_steps_affinity=execution.parameters.sampling_steps_affinity,
                    affinity_mw_correction=execution.parameters.affinity_mw_correction,
                ),
            )
            metrics = dict(outputs.affinity)
            for key in metrics:
                if key.startswith("affinity_pred_value"):
                    metric_units[key] = AFFINITY_UNIT
                elif key.startswith("affinity_probability_binary"):
                    metric_units[key] = BINDER_PROBABILITY_LABEL
            native["affinity_summary"] = summary.model_dump(mode="json")
            files.append(
                ProviderFile(
                    name=f"affinity_{record_id}.json",
                    role=ArtifactRole.AFFINITY,
                    media_type="application/json",
                    path=outputs.affinity_path,
                )
            )
            files.append(
                ProviderFile(
                    name="affinity_summary.json",
                    role=ArtifactRole.AFFINITY,
                    media_type="application/json",
                    content=json.dumps(
                        {
                            "statement": PREDICTION_STATEMENT,
                            "derived_from": f"affinity_{record_id}.json",
                            **native["affinity_summary"],
                        },
                        indent=2,
                        ensure_ascii=False,
                    ).encode(),
                )
            )
        return BindingResult(
            model=execution.structure.model,
            metrics=metrics,
            metric_units=metric_units,
            structure=execution.structure,
            confidence=execution.structure.descriptor.confidence,
            files=files,
            parameters=execution.structure.parameters,
            limitations=[*LIMITATIONS, *AFFINITY_LIMITATIONS],
            warnings=execution.warnings,
            provider_native=native,
        )

    async def _execute(
        self,
        *,
        chains: list[ChainInput],
        ligands: list[LigandInput],
        affinity: bool,
        pocket_residues: list[int],
        parameters: dict[str, Any],
        seed: int | None,
        context: RunContext,
    ) -> _Execution:
        status = await self.backend_status()
        backend = self.backend()
        if not status.available or backend is None:
            raise ProviderError(
                "provider_unavailable",
                f"Boltz-2 cannot run on this deployment. {status.reason}",
                {"setup": status.setup or SETUP_HINT, "backend": status.backend},
            )
        settings = get_boltz_settings()
        record_id = context.job_id or f"detached_{utcnow():%Y%m%d%H%M%S}"
        resolved_seed = DEFAULT_SEED if seed is None else int(seed)

        async with context.stage(STAGE_PREPARE):
            msa_mode = parameters.get("msa_mode") or "server"
            msa_format = parameters.get("msa_format") or "a3m"
            msa_contents: dict[str, str] = dict(parameters.get("msa_contents") or {})
            if parameters.get("msa_content") and chains:
                msa_contents.setdefault(chains[0].entity_id, parameters["msa_content"])
            msa_files = {f"{chain_id}.{msa_format}": text for chain_id, text in msa_contents.items()}
            try:
                boltz_parameters = BoltzParameters.from_request(parameters)
            except ValidationError as error:
                raise ProviderError(
                    "invalid_parameters",
                    "A Boltz parameter is out of range.",
                    {"errors": json.loads(error.json(include_url=False, include_context=False))},
                ) from error
            try:
                spec = build_spec(
                    record_id=record_id,
                    chains=chains,
                    ligands=ligands,
                    affinity=affinity,
                    pocket_residues=pocket_residues,
                    pocket_max_distance=float(parameters.get("pocket_max_distance") or 6.0),
                    pocket_force=bool(parameters.get("pocket_force", False)),
                    msa_mode=msa_mode,
                    msa_paths={chain_id: f"./msa/{chain_id}.{msa_format}" for chain_id in msa_contents},
                    max_tokens=settings.boltz_max_tokens,
                )
                input_yaml, _ = build_yaml(spec)
            except BoltzInputError as error:
                raise _input_error(error) from error
            msa_server_url = settings.resolved_msa_server_url
            options = cli_options(
                boltz_parameters,
                seed=resolved_seed,
                msa_mode=spec.msa_mode,
                msa_server_url=msa_server_url,
                affinity=affinity,
            )
            await context.log(
                f"Input: {spec.protein_residue_count} residues, {len(spec.ligands)} ligand(s), "
                f"about {spec.token_estimate or spec.protein_residue_count} tokens; seed {resolved_seed}; "
                f"backend {backend.id}.",
                input_yaml_sha256=sha256_hex(input_yaml),
            )
            if spec.msa_mode == "server":
                await context.log(
                    f"The protein sequence will be sent to the MSA server at {msa_server_url}.",
                    msa_server_url=msa_server_url,
                )

        async with context.stage(STAGE_RUN):
            run = await backend.run(
                BoltzRunRequest(
                    record_id=record_id,
                    input_yaml=input_yaml,
                    options=options,
                    msa_files=msa_files if spec.msa_mode == "precomputed" else {},
                ),
                context,
            )

        async with context.stage(STAGE_READ):
            try:
                outputs = await asyncio.to_thread(
                    parse_results,
                    run.results_dir,
                    record_id,
                    expect_affinity=affinity,
                    log_text=run.log_text,
                )
            except BoltzOutputError as error:
                detail = {**(error.detail or {}), "exit_code": run.exit_code, "backend": run.backend}
                raise ProviderError(error.code, error.message, detail) from error
            if run.exit_code not in (0, None):
                raise ProviderError(
                    "boltz_exit_nonzero",
                    f"Boltz exited with code {run.exit_code}.",
                    {"exit_code": run.exit_code, "log_tail": run.log_text[-4000:]},
                )
            structure, warnings = await asyncio.to_thread(
                self._structure_result,
                spec=spec,
                run=run,
                outputs=outputs,
                parameters=boltz_parameters,
                seed=resolved_seed,
                input_yaml=input_yaml,
                msa_files=msa_files if spec.msa_mode == "precomputed" else {},
                msa_server_url=msa_server_url,
                job_id=context.job_id,
            )
            best = outputs.samples[0].confidence
            await context.log(
                f"Read {len(outputs.samples)} sample(s). Boltz ranking score of sample 0: "
                f"{best.get('confidence_score')}; complex pLDDT (0-1): {best.get('complex_plddt')}."
            )
            if affinity and outputs.affinity is None:
                await context.log("Boltz wrote no affinity file for this run.", level="warning")
            for warning in warnings:
                await context.log(f"Warning: {warning}", level="warning")
        return _Execution(
            spec=spec,
            run=run,
            outputs=outputs,
            structure=structure,
            parameters=boltz_parameters,
            seed=resolved_seed,
            warnings=warnings,
        )

    def _structure_result(
        self,
        *,
        spec: BoltzJobSpec,
        run: BoltzRun,
        outputs: BoltzOutputs,
        parameters: BoltzParameters,
        seed: int,
        input_yaml: str,
        msa_files: dict[str, str],
        msa_server_url: str,
        job_id: str | None,
    ) -> tuple[StructureResult, list[str]]:
        record_id = spec.record_id
        environment = run.environment
        distribution, version = boltz_package(environment)
        version_label = f"{distribution} {version}" if distribution else "unknown"
        warnings = list(outputs.warnings)
        if distribution is None:
            warnings.append("boltz_version_not_reported_by_backend")

        files: list[ProviderFile] = []
        confidence_samples: list[ConfidenceSample] = []
        first = None
        derived: list[ProviderFile] = []
        native: list[ProviderFile] = []
        for sample in outputs.samples:
            summarised = summarise_confidence(sample, spec)
            warnings += [f"sample_{sample.index}:{warning}" for warning in summarised.warnings]
            if sample.index == 0:
                first = summarised
            files.append(
                ProviderFile(
                    name=sample.structure_path.name,
                    role=ArtifactRole.STRUCTURE,
                    media_type=MMCIF_MEDIA_TYPE,
                    path=sample.structure_path,
                    structure_origin=StructureOrigin.PREDICTED_INTERNAL,
                    sample_index=sample.index,
                )
            )
            files.append(
                ProviderFile(
                    name=sample.confidence_path.name,
                    role=ArtifactRole.CONFIDENCE_SUMMARY,
                    media_type="application/json",
                    path=sample.confidence_path,
                    sample_index=sample.index,
                )
            )
            if summarised.plddt_document is not None:
                derived.append(
                    ProviderFile(
                        name=f"plddt_residues_model_{sample.index}.json",
                        role=ArtifactRole.PLDDT,
                        media_type="application/json",
                        content=json.dumps(summarised.plddt_document).encode(),
                        sample_index=sample.index,
                    )
                )
            if summarised.pae_document is not None:
                derived.append(
                    ProviderFile(
                        name=f"pae_tokens_model_{sample.index}.json",
                        role=ArtifactRole.PAE,
                        media_type="application/json",
                        content=json.dumps(summarised.pae_document).encode(),
                        sample_index=sample.index,
                    )
                )
            for path, role in (
                (sample.plddt_path, ArtifactRole.PLDDT),
                (sample.pae_path, ArtifactRole.PAE),
                (sample.pde_path, ArtifactRole.PDE),
            ):
                if path is not None:
                    native.append(
                        ProviderFile(
                            name=path.name,
                            role=role,
                            media_type=NPZ_MEDIA_TYPE,
                            path=path,
                            sample_index=sample.index,
                        )
                    )
            # Raw values verbatim, on the model's own 0-1 scale
            confidence_samples.append(
                ConfidenceSample(
                    sample_index=sample.index,
                    structure_file=sample.structure_path.name,
                    metrics=sample.confidence,
                )
            )
        # Residue-indexed JSON first: the descriptor links the first pLDDT and PAE file
        files += derived + native
        assert first is not None

        try:
            inspection = inspect_structure(outputs.samples[0].structure_path)
        except Exception as error:
            raise ProviderError(
                "boltz_output_unreadable", f"The predicted mmCIF file could not be read: {error}"
            ) from error
        found_sequences = [chain["sequence"] for chain in inspection["chains"]]
        for chain in spec.chains:
            if chain.sequence not in found_sequences:
                warnings.append(f"chain_{chain.id}_sequence_not_found_in_coordinates")

        files.append(
            ProviderFile(
                name=f"{record_id}.yaml",
                role=ArtifactRole.MODEL_INPUT,
                media_type=YAML_MEDIA_TYPE,
                content=input_yaml.encode(),
            )
        )
        for name, text in msa_files.items():
            files.append(
                ProviderFile(
                    name=f"msa/input_{name}",
                    role=ArtifactRole.MSA,
                    media_type="text/x-a3m" if name.endswith(".a3m") else "text/csv",
                    content=text.encode(),
                )
            )
        msa_root = run.results_dir / "msa"
        for path in outputs.msa_files:
            relative = "__".join(path.relative_to(msa_root).parts)
            files.append(
                ProviderFile(
                    name=f"msa/{relative}",
                    role=ArtifactRole.MSA,
                    media_type="text/x-a3m" if path.suffix == ".a3m" else "text/csv",
                    path=path,
                )
            )
        if spec.msa_mode == "server" and not outputs.msa_files:
            warnings.append("msa_files_not_found_in_results")
        if run.log_text:
            files.append(
                ProviderFile(
                    name="boltz.log",
                    role=ArtifactRole.LOG,
                    media_type="text/plain",
                    content=run.log_text.encode(),
                )
            )

        weights = [
            ModelWeights(
                name=weight["name"],
                uri=weight.get("uri"),
                revision=weight.get("revision"),
                sha256=weight.get("sha256"),
                size_bytes=weight.get("size_bytes"),
            )
            for weight in environment.get("weights") or []
            if isinstance(weight, dict) and weight.get("name")
        ]
        for weight in environment.get("weights") or []:
            if isinstance(weight, dict) and weight.get("matches_pinned") is False:
                warnings.append(f"weights_differ_from_pinned:{weight.get('name')}")
        if not weights:
            warnings.append("weights_not_hashed")

        resolved_parameters: dict[str, Any] = {
            "seed": seed,
            **parameters.model_dump(),
            "msa_mode": spec.msa_mode,
            "msa_server_url": msa_server_url if spec.msa_mode == "server" else None,
            "predict_affinity": spec.affinity_binder is not None,
            "pocket_constraint": spec.pocket.describe() if spec.pocket else None,
            "record_id": record_id,
            "input_yaml_sha256": sha256_hex(input_yaml),
            "token_estimate": spec.token_estimate,
            "backend": run.backend,
            "accelerator": environment.get("accelerator"),
            "devices": environment.get("devices"),
            "precision": environment.get("precision"),
            "boltz_package": distribution,
            "boltz_version": version,
            "torch_version": environment.get("torch"),
            "checkpoints": [weight.name for weight in weights],
            "upstream_cli_defaults": UPSTREAM_DEFAULTS,
        }

        chain = spec.chains[0]
        title_parts = [
            chain.uniprot_accession or "custom sequence",
            f"{chain.residue_start}-{chain.residue_end}",
        ]
        if spec.ligands:
            ligand = spec.ligands[0]
            title_parts.append(f"with {ligand.label or ligand.ccd or ligand.inchikey or 'ligand'}")
        descriptor = StructureDescriptor(
            id=f"of:{job_id or record_id}",
            origin=StructureOrigin.PREDICTED_INTERNAL,
            title=f"Boltz-2 prediction · {' '.join(title_parts)}",
            provider=self.id,
            provider_name=self.name,
            model_name=self.model_name,
            model_version=version_label if distribution else None,
            method="Boltz-2 co-folding" if spec.ligands else "Boltz-2",
            coverage=StructureCoverage(
                uniprot_accession=chain.uniprot_accession,
                ranges=[
                    ResidueRange(start=item.residue_start, end=item.residue_end, chain=item.id)
                    for item in spec.chains
                ],
                covered_residues=spec.protein_residue_count,
            ),
            confidence=first.summary,
            license="MIT (code and weights)",
            attribution=self.attribution,
            created_date=date.today(),
            job_id=job_id,
            limitations=list(LIMITATIONS),
            warnings=warnings,
        )
        identifiers = [f"uniprot:{item.uniprot_accession}" for item in spec.chains if item.uniprot_accession]
        identifiers += [f"inchikey:{item.inchikey}" for item in spec.ligands if item.inchikey]
        identifiers += [f"pdb.ccd:{item.ccd}" for item in spec.ligands if item.ccd]
        result = StructureResult(
            descriptor=descriptor,
            model=ModelIdentity(
                provider=self.id,
                name=self.model_name,
                version=version_label,
                license="MIT",
                execution_mode=ExecutionMode.GPU_WORKER
                if run.backend == "remote_worker"
                else ExecutionMode.LOCAL_CLI,
                code=ModelCode(
                    repository=REPOSITORIES.get(distribution) if distribution else None,
                    revision=f"v{version}" if distribution == "boltz" and version else None,
                    package=f"{distribution}=={version}" if distribution and version else None,
                ),
                weights=weights,
            ),
            files=files,
            sequences=[
                ChainInput(
                    entity_id=item.id,
                    sequence=item.sequence,
                    uniprot_accession=item.uniprot_accession,
                    residue_start=item.residue_start,
                    applied_variant_ids=list(item.applied_variant_ids),
                )
                for item in spec.chains
            ],
            parameters=resolved_parameters,
            confidence_samples=confidence_samples,
            ranking_metric=RANKING_SCORE_NAME,
            plddt_per_residue=first.plddt_per_residue,
            source_datasets=[
                DatasetVersion(
                    name="ColabFold MSA server",
                    version="not reported by the server",
                    retrieved_at=utcnow(),
                    url=msa_server_url,
                )
            ]
            if spec.msa_mode == "server"
            else [],
            database_identifiers=identifiers,
            argv=run.argv or None,
            exit_code=run.exit_code,
            provider_native={
                "confidence": outputs.samples[0].confidence,
                "environment": environment,
                "coordinates": inspection,
                "msa": {
                    "mode": spec.msa_mode,
                    "server_url": msa_server_url if spec.msa_mode == "server" else None,
                    "pairing_strategy": parameters.msa_pairing_strategy,
                },
                "wall_time_seconds": run.wall_time_seconds,
            },
        )
        return result, warnings
