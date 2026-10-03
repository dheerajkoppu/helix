"""Job kind variant_comparison: predict the reference and the variant sequence with the same
provider and the same construct, then compute the geometric difference between the two models.

The result is geometry computed from predicted models. It carries no damage or stability score.
"""

import asyncio
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from helix.analysis.caveats import comparison_caveats, is_deterministic, provider_ref
from helix.analysis.construct import choose_construct, user_construct
from helix.analysis.difference import (
    CONTACT_CUTOFF,
    FIT_METHOD,
    NEIGHBOUR_RADIUS,
    PLDDT_THRESHOLD,
    DifferenceError,
    ModelInput,
    compute_difference,
)
from helix.analysis.inputs import (
    RoleContext,
    availability_blocker,
    length_blocker,
    nonstandard_residues,
    predictor_for,
    unknown_provider_message,
)
from helix.analysis.protein import fetch_protein
from helix.identifiers import (
    UNIPROT_ACCESSION_PATTERN,
    ProteinSubstitution,
    parse_protein_change,
    parse_variant_id,
)
from helix.jobs import JobContext, JobFailed, job_handler
from helix.jobs.manifest import ManifestMsa, ManifestVariant, ProteinChange, RecordRef
from helix.knowledge.catalog import get_catalog
from helix.providers.base import (
    ChainInput,
    ConfidenceSample,
    ExecutionMode,
    ProviderFile,
    StructureRequest,
    StructureResult,
    get_provider,
)
from helix.schemas.common import (
    EntityRef,
    EntityType,
    SourceState,
    StructureDescriptor,
    StructureFiles,
    StructureOrigin,
)
from helix.schemas.compare import CachedOrigin, ComparisonJobResult, ComparisonVariant
from helix.schemas.jobs import ArtifactOut, ArtifactRole, StageSpec

KIND = "variant_comparison"
STAGE_RESOLVE = "resolve_input"
STAGE_DIFFERENCE = "difference"
STAGE_STORE = "store_artifacts"
ROLES = ("reference", "variant")
DIFFERENCE_FILE = "difference.json"


class VariantComparisonParams(BaseModel):
    provider: str = Field(default="esm_atlas", description="A structure predictor; see GET /api/v1/models")
    variant_id: str | None = Field(default=None, description="GENE-p.Ref3PosAlt3, e.g. BTK-p.Arg28His")
    gene_symbol: str | None = None
    uniprot_accession: str | None = Field(default=None, pattern=rf"^(?:{UNIPROT_ACCESSION_PATTERN})$")
    substitution: str | None = Field(default=None, description="e.g. p.Arg28His or R28H, UniProt numbering")
    residue_start: int | None = Field(default=None, ge=1, description="Construct start; chosen when omitted")
    residue_end: int | None = Field(default=None, ge=1, description="Construct end; chosen when omitted")
    seed: int | None = Field(default=None, description="Passed to providers that sample; ignored otherwise")

    @field_validator("provider")
    @classmethod
    def _is_predictor(cls, value: str) -> str:
        if predictor_for(value, KIND) is None:
            raise ValueError(unknown_provider_message(value, KIND))
        return value

    @model_validator(mode="after")
    def _resolve(self) -> Self:
        if self.variant_id:
            parsed = parse_variant_id(self.variant_id)
            if parsed is None:
                raise ValueError("variant_id must look like BTK-p.Arg28His")
            self.gene_symbol = self.gene_symbol or parsed.gene_symbol
            self.substitution = self.substitution or parsed.hgvs_p
        change = parse_protein_change(self.substitution or "")
        if change is None or change.alternate == "*" or change.reference == change.alternate:
            raise ValueError("give one amino acid substitution such as p.Arg28His or R28H")
        self.substitution = change.hgvs_p
        if self.gene_symbol:
            self.gene_symbol = self.gene_symbol.upper()
        if self.uniprot_accession is None:
            gene = get_catalog().gene(self.gene_symbol) if self.gene_symbol else None
            if gene is None or not gene.uniprot_accession:
                raise ValueError("give uniprot_accession, or a gene_symbol the catalog maps to a protein")
            self.uniprot_accession = gene.uniprot_accession
            self.gene_symbol = gene.symbol
        if (self.residue_start is None) != (self.residue_end is None):
            raise ValueError("give both residue_start and residue_end, or neither")
        if self.residue_start and self.residue_end:
            if not self.residue_start <= change.position <= self.residue_end:
                raise ValueError("the construct must contain the variant position")
        self.variant_id = ProteinSubstitution(
            change.reference, change.position, change.alternate, self.gene_symbol
        ).variant_id
        return self


def _change(params: VariantComparisonParams) -> ProteinSubstitution:
    change = parse_protein_change(params.substitution or "", params.gene_symbol)
    if change is None:
        raise JobFailed("invalid_variant", "The substitution could not be read.")
    return change


def _stages(params: VariantComparisonParams) -> list[StageSpec]:
    provider = predictor_for(params.provider, KIND)
    planned = provider.plan(StructureRequest()) if provider else []
    return [
        StageSpec(id=STAGE_RESOLVE, label="Fetching sequence and domains from UniProt"),
        *(
            StageSpec(id=RoleContext.stage_id(role, stage.id), label=f"{role.capitalize()} · {stage.label}")
            for role in ROLES
            for stage in planned
        ),
        StageSpec(id=STAGE_DIFFERENCE, label="Computing differences between the models"),
        StageSpec(id=STAGE_STORE, label="Storing files"),
    ]


def _title(params: VariantComparisonParams) -> str:
    provider = get_provider(params.provider)
    subject = params.variant_id or f"{params.uniprot_accession} {params.substitution}"
    return f"{provider.name if provider else params.provider} reference and variant · {subject}"


def _subject(params: VariantComparisonParams) -> EntityRef | None:
    if params.variant_id:
        return EntityRef.of(EntityType.VARIANT, params.variant_id, params.variant_id)
    if params.uniprot_accession:
        return EntityRef.of(
            EntityType.PROTEIN, params.uniprot_accession, None, f"uniprot:{params.uniprot_accession}"
        )
    return None


def _artifact_name(role: str, file_name: str) -> str:
    """model_0.cif of the reference prediction is stored as reference.cif."""
    stem, separator, rest = file_name.partition(".")
    return f"{role}.{rest}" if separator and stem.startswith("model") else f"{role}.{file_name}"


def _cif_file(result: StructureResult) -> ProviderFile:
    for file in result.files:
        if file.role is ArtifactRole.STRUCTURE and file.name.lower().endswith(".cif"):
            return file
    raise JobFailed("no_mmcif_model", "The provider returned no mmCIF model to compare.")


def _text(file: ProviderFile) -> str:
    if file.content is not None:
        return file.content.decode("utf-8")
    if file.path is not None:
        return file.path.read_text(encoding="utf-8")
    raise JobFailed("empty_provider_file", f"The provider returned no content for {file.name}.")


@job_handler(
    KIND,
    title="Compare reference and variant models",
    description=(
        "Predicts the reference and the variant sequence with the same provider and the same "
        "construct, then computes the geometric difference. Structure predictors are not validated "
        "for single-residue substitutions."
    ),
    params=VariantComparisonParams,
    result=ComparisonJobResult,
    stages=_stages,
    provider=lambda params: params.provider,
    describe=_title,
    subject=_subject,
)
async def compare_variant(context: JobContext, params: VariantComparisonParams) -> ComparisonJobResult:
    provider = predictor_for(params.provider, KIND)
    if provider is None:
        raise JobFailed("unsupported_provider", unknown_provider_message(params.provider, KIND))
    change = _change(params)
    accession = params.uniprot_accession or ""
    variant_label = params.variant_id or f"{accession} {change.hgvs_p}"

    async with context.stage(STAGE_RESOLVE):
        fetched = await fetch_protein(accession)
        if fetched.state is SourceState.UNAVAILABLE:
            raise JobFailed("source_unavailable", fetched.message or "UniProt did not answer.")
        if not fetched.ok or fetched.data is None:
            raise JobFailed("protein_not_found", f"UniProt has no entry {accession}.")
        protein = fetched.data
        release = fetched.provenance.release if fetched.provenance else None
        await context.log(
            f"UniProt {protein.accession}: {protein.length} residues, "
            f"{len(protein.domains)} domain features, release {release or 'not reported'}."
        )
        try:
            variant_sequence = change.apply(protein.sequence)
        except ValueError as error:
            raise JobFailed(
                "reference_residue_mismatch",
                f"{change.hgvs_p} does not fit the UniProt canonical sequence of {protein.accession}: "
                f"{error}.",
            ) from error
        if params.residue_start and params.residue_end:
            if params.residue_end > protein.length:
                raise JobFailed(
                    "window_out_of_range",
                    f"The construct ends at {params.residue_end}; the protein has {protein.length} residues.",
                )
            construct = user_construct(
                protein_length=protein.length,
                start=params.residue_start,
                end=params.residue_end,
                max_residues=provider.max_residues,
                uniprot_accession=protein.accession,
            )
        elif (fixed_construct := getattr(provider, "construct_for", None)) is not None:
            # A provider of stored outputs can serve only the construct that was stored
            construct = fixed_construct(protein.accession, params.variant_id)
            if construct is None:
                raise JobFailed("not_cached", f"{provider.name} holds no output for {variant_label}.")
        else:
            construct = choose_construct(
                protein_length=protein.length,
                position=change.position,
                domains=protein.domains,
                max_residues=provider.max_residues,
                uniprot_accession=protein.accession,
            )
        await context.log(f"Construct {construct.start}-{construct.end}. {construct.rationale}")
        sequences = {
            "reference": protein.sequence[construct.start - 1 : construct.end],
            "variant": variant_sequence[construct.start - 1 : construct.end],
        }
        unknown = nonstandard_residues(sequences["reference"])
        if unknown:
            raise JobFailed(
                "unsupported_residues",
                "The construct contains residues other than the 20 standard amino acids: "
                f"{', '.join(unknown)}.",
            )
        blocker = length_blocker(provider, construct.length)
        if blocker:
            raise JobFailed("sequence_too_long", blocker)
        blocker = availability_blocker(provider, await provider.check_availability())
        if blocker and provider.execution_mode is ExecutionMode.REMOTE_API:
            # A remote service can recover between the check and the call: the call decides
            await context.log(f"{blocker} Calling it anyway.", level="warning")
        elif blocker:
            raise JobFailed("provider_unavailable", blocker)

    gene_symbol = params.gene_symbol or protein.gene_symbol
    variant_id = params.variant_id or change.hgvs_p
    variant = ComparisonVariant(
        variant_id=params.variant_id,
        gene_symbol=gene_symbol,
        uniprot_accession=protein.accession,
        position=change.position,
        reference=change.reference,
        alternate=change.alternate,
        hgvs_p=change.hgvs_p,
        short=change.short,
    )

    results: dict[str, StructureResult] = {}
    for role in ROLES:
        chain = ChainInput(
            sequence=sequences[role],
            uniprot_accession=protein.accession,
            residue_start=construct.start,
            applied_variant_ids=[variant_id] if role == "variant" else [],
        )
        request = StructureRequest(
            uniprot_accession=protein.accession,
            chains=[chain],
            parameters={"protein_length": protein.length},
            seed=params.seed,
        )
        results[role] = await provider.predict(request, RoleContext(context, role))
        if results[role].plddt_per_residue is None:
            raise JobFailed(
                "no_confidence", f"{provider.name} returned no per-residue pLDDT for the {role} model."
            )

    if results["reference"].model != results["variant"].model:
        raise JobFailed("model_mismatch", "The two models were not produced by the same model version.")

    cached = results["variant"].provider_native.get("cached_from")
    cached_from = CachedOrigin.model_validate(cached) if cached else None
    provider_summary = provider_ref(provider, cached_from)
    caveats = comparison_caveats(deterministic=is_deterministic(provider), full_length=construct.full_length)
    structure_ids = {role: f"of:{context.job_id}-{role}" for role in ROLES}
    cif_files = {role: _cif_file(results[role]) for role in ROLES}

    async with context.stage(STAGE_DIFFERENCE):
        inputs = {
            role: ModelInput(
                structure_id=structure_ids[role],
                file=_artifact_name(role, cif_files[role].name),
                cif_text=_text(cif_files[role]),
                sequence=sequences[role],
                plddt=list(results[role].plddt_per_residue or []),
            )
            for role in ROLES
        }
        try:
            difference = await asyncio.to_thread(
                compute_difference,
                reference=inputs["reference"],
                variant_model=inputs["variant"],
                variant=variant,
                construct=construct,
                provider=provider_summary,
                caveats=caveats,
                job_id=context.job_id,
            )
        except DifferenceError as error:
            raise JobFailed("models_not_comparable", str(error)) from error
        fit = difference.superposition
        await context.log(
            f"Fit on {fit.residues_used} C-alpha atoms ({fit.scope_rule}); C-alpha RMSD "
            f"{difference.global_difference.rmsd_ca_all:.2f} A over {construct.length} residues; "
            f"{difference.masking.masked_residues} residues masked below pLDDT {PLDDT_THRESHOLD:g}."
        )

    descriptors: dict[str, StructureDescriptor] = {}
    async with context.stage(STAGE_STORE):
        manifest = context.manifest
        total = sum(len(results[role].files) for role in ROLES) + 1
        stored = 0
        for sample_index, role in enumerate(ROLES):
            result = results[role]
            files = StructureFiles()
            primary: ArtifactOut | None = None
            for file in result.files:
                await context.check_cancelled()
                data = file.content if file.content is not None else file.path
                if data is None:
                    raise JobFailed(
                        "empty_provider_file", f"The provider returned no content for {file.name}."
                    )
                artifact = await context.save_artifact(
                    _artifact_name(role, file.name),
                    data,
                    media_type=file.media_type,
                    role=file.role,
                    structure_origin=file.structure_origin,
                    sample_index=sample_index if file.role is ArtifactRole.STRUCTURE else None,
                    meta={"model_role": role, **({"source_url": file.source_url} if file.source_url else {})},
                )
                if file is cif_files[role]:
                    files.cif_url = artifact.url
                    primary = artifact
                elif file.role is ArtifactRole.PLDDT and files.plddt_url is None:
                    files.plddt_url = artifact.url
                stored += 1
                await context.progress(stored, total, unit="files")

            label = "Reference" if role == "reference" else f"Variant {change.hgvs_p}"
            descriptor = result.descriptor.model_copy(
                update={
                    "id": structure_ids[role],
                    "files": files,
                    "job_id": context.job_id,
                    "title": f"{label} model · {result.descriptor.title or protein.accession}",
                }
            )
            descriptors[role] = descriptor
            if descriptor.origin is StructureOrigin.PREDICTED_INTERNAL:
                await context.record_structure(
                    descriptor,
                    structure_artifact=primary,
                    uniprot_accession=protein.accession,
                    gene_symbol=gene_symbol,
                    variant_id=params.variant_id if role == "variant" else None,
                    sequence=sequences[role],
                    residue_start=construct.start,
                    residue_end=construct.end,
                )
            manifest.add_sequence(
                sequences[role],
                entity_id=role,
                uniprot_start=construct.start,
                source=RecordRef(
                    database="uniprot",
                    record_id=protein.accession,
                    record_version=protein.entry_version,
                    release=release,
                    url=fetched.provenance.record_url if fetched.provenance else None,
                ),
                applied_variant_ids=[variant_id] if role == "variant" else [],
            )
            for sample in result.confidence_samples:
                manifest.add_confidence_sample(
                    ConfidenceSample(
                        sample_index=sample_index,
                        structure_file=_artifact_name(role, cif_files[role].name),
                        metrics={"model_role": role, **sample.metrics},
                    ),
                    primary.id if primary else None,
                )

        difference_artifact = await context.save_artifact(
            DIFFERENCE_FILE,
            difference.model_dump_json(indent=2),
            media_type="application/json",
            role=ArtifactRole.OTHER,
            meta={"schema_version": difference.schema_version},
        )
        await context.progress(total, total, unit="files")

        reference_result = results["reference"]
        manifest.set_model(reference_result.model)
        manifest.set_parameters(
            {
                "seed": params.seed,
                "provider": reference_result.parameters,
                "construct": construct.model_dump(mode="json"),
                "same_provider_and_construct_for_both_models": True,
                "analysis": {
                    "superposition": FIT_METHOD,
                    "superposition_scope": difference.superposition.scope,
                    "plddt_mask_threshold": PLDDT_THRESHOLD,
                    "contact_cutoff_angstrom": CONTACT_CUTOFF,
                    "neighbour_radius_angstrom": NEIGHBOUR_RADIUS,
                },
                **({"cached_from": cached_from.model_dump(mode="json")} if cached_from else {}),
            }
        )
        manifest.add_variant(
            ManifestVariant(
                variant_id=variant_id,
                hgvs={"p": change.hgvs_p},
                protein_change=ProteinChange(
                    position=change.position, ref=change.reference, alt=change.alternate
                ),
            )
        )
        manifest.add_identifier(f"uniprot:{protein.accession}")
        if fetched.provenance:
            manifest.add_provenance(fetched.provenance)
        for dataset in reference_result.source_datasets:
            manifest.add_source_dataset(dataset)
        if str(reference_result.parameters.get("msa", "")).startswith("none"):
            manifest.set_msa(ManifestMsa(mode="single_sequence"))
        for package in ("httpx", "gemmi", "numpy"):
            manifest.add_package(package)

    return ComparisonJobResult(
        performs_inference=provider_summary.performs_inference,
        variant_id=params.variant_id,
        gene_symbol=gene_symbol,
        variant=variant,
        construct=construct,
        provider=provider_summary,
        reference_model=descriptors["reference"],
        variant_model=descriptors["variant"],
        difference_url=difference_artifact.url,
        summary=difference.summary,
        caveats=caveats,
    )
