"""Job kind structure_prediction: run a registered structure predictor on one protein chain.

Input is a UniProt accession or a raw sequence, with an optional residue window and an optional
single substitution. The structure keeps the origin its provider declares.
"""

from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from helix.analysis.inputs import (
    availability_blocker,
    clean_sequence,
    length_blocker,
    nonstandard_residues,
    predictor_for,
    unknown_provider_message,
)
from helix.analysis.protein import ProteinRecord, fetch_protein
from helix.identifiers import UNIPROT_ACCESSION_PATTERN, ProteinSubstitution, parse_protein_change
from helix.jobs import JobContext, JobFailed, job_handler
from helix.jobs.manifest import ManifestMsa, ManifestVariant, ProteinChange, RecordRef
from helix.jobs.structures import store_structure_result
from helix.knowledge.catalog import get_catalog
from helix.providers.base import ChainInput, ExecutionMode, StructureRequest, get_provider
from helix.schemas.common import EntityRef, EntityType, SourceState
from helix.schemas.jobs import StageSpec, StructureJobResult

KIND = "structure_prediction"
STAGE_RESOLVE = "resolve_input"
STAGE_STORE = "store_artifacts"


class StructurePredictionParams(BaseModel):
    provider: str = Field(default="esm_atlas", description="A structure predictor; see GET /api/v1/models")
    uniprot_accession: str | None = Field(
        default=None,
        pattern=rf"^(?:{UNIPROT_ACCESSION_PATTERN})$",
        description="Predict the UniProt canonical sequence of this accession",
    )
    sequence: str | None = Field(default=None, description="Raw protein sequence, instead of an accession")
    residue_start: int | None = Field(default=None, ge=1, description="First residue of the window")
    residue_end: int | None = Field(default=None, ge=1, description="Last residue of the window")
    substitution: str | None = Field(
        default=None, description="Single substitution to apply, e.g. p.Arg28His or R28H"
    )
    gene_symbol: str | None = None
    seed: int | None = Field(default=None, description="Passed to providers that sample; ignored otherwise")

    @field_validator("provider")
    @classmethod
    def _is_predictor(cls, value: str) -> str:
        if predictor_for(value, KIND) is None:
            raise ValueError(unknown_provider_message(value, KIND))
        return value

    @field_validator("sequence")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        if value is None:
            return None
        sequence = clean_sequence(value)
        if not sequence:
            raise ValueError("the sequence is empty")
        unknown = nonstandard_residues(sequence)
        if unknown:
            raise ValueError(f"only the 20 standard amino acids are accepted; found {', '.join(unknown)}")
        return sequence

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if (self.uniprot_accession is None) == (self.sequence is None):
            raise ValueError("give either uniprot_accession or sequence")
        if self.residue_start and self.residue_end and self.residue_end < self.residue_start:
            raise ValueError("residue_end is before residue_start")
        if self.substitution is not None:
            change = parse_protein_change(self.substitution)
            if change is None or change.alternate == "*":
                raise ValueError("substitution must be one amino acid change such as p.Arg28His or R28H")
            self.substitution = change.hgvs_p
        return self


def _gene_symbol(params: StructurePredictionParams) -> str | None:
    if params.gene_symbol:
        return params.gene_symbol
    if params.uniprot_accession:
        gene = get_catalog().gene_by_uniprot(params.uniprot_accession)
        return gene.symbol if gene else None
    return None


def _substitution(params: StructurePredictionParams) -> ProteinSubstitution | None:
    return parse_protein_change(params.substitution, _gene_symbol(params)) if params.substitution else None


def _stages(params: StructurePredictionParams) -> list[StageSpec]:
    provider = predictor_for(params.provider, KIND)
    planned = provider.plan(StructureRequest()) if provider else []
    resolve = "Fetching the sequence from UniProt" if params.uniprot_accession else "Checking the sequence"
    return [
        StageSpec(id=STAGE_RESOLVE, label=resolve),
        *planned,
        StageSpec(id=STAGE_STORE, label="Storing files"),
    ]


def _title(params: StructurePredictionParams) -> str:
    provider = get_provider(params.provider)
    subject = params.uniprot_accession or "custom sequence"
    if params.residue_start or params.residue_end:
        subject += f" {params.residue_start or 1}-{params.residue_end or 'end'}"
    if params.substitution:
        subject += f" {params.substitution}"
    return f"{provider.name if provider else params.provider} prediction · {subject}"


def _subject(params: StructurePredictionParams) -> EntityRef | None:
    if not params.uniprot_accession:
        return None
    gene = get_catalog().gene_by_uniprot(params.uniprot_accession)
    return EntityRef.of(
        EntityType.PROTEIN,
        params.uniprot_accession,
        gene.protein_name if gene else None,
        f"uniprot:{params.uniprot_accession}",
    )


@job_handler(
    KIND,
    title="Predict structure",
    description=(
        "Runs a structure predictor on one protein chain: a UniProt accession or a raw sequence, "
        "optionally a residue window and one substitution."
    ),
    params=StructurePredictionParams,
    result=StructureJobResult,
    stages=_stages,
    provider=lambda params: params.provider,
    describe=_title,
    subject=_subject,
)
async def predict_structure(context: JobContext, params: StructurePredictionParams) -> StructureJobResult:
    provider = predictor_for(params.provider, KIND)
    if provider is None:
        raise JobFailed("unsupported_provider", unknown_provider_message(params.provider, KIND))
    change = _substitution(params)
    protein: ProteinRecord | None = None

    async with context.stage(STAGE_RESOLVE):
        if params.uniprot_accession:
            fetched = await fetch_protein(params.uniprot_accession)
            if fetched.state is SourceState.UNAVAILABLE:
                raise JobFailed("source_unavailable", fetched.message or "UniProt did not answer.")
            if not fetched.ok or fetched.data is None:
                raise JobFailed("protein_not_found", f"UniProt has no entry {params.uniprot_accession}.")
            protein = fetched.data
            full_sequence = protein.sequence
            await context.log(
                f"UniProt {protein.accession}: {protein.length} residues"
                + (f", release {fetched.provenance.release}." if fetched.provenance else ".")
            )
        else:
            full_sequence = params.sequence or ""
        start = params.residue_start or 1
        end = params.residue_end or len(full_sequence)
        if end > len(full_sequence) or start > end:
            raise JobFailed(
                "window_out_of_range",
                f"The window {start}-{end} is outside the sequence of {len(full_sequence)} residues.",
            )
        unknown = nonstandard_residues(full_sequence[start - 1 : end])
        if unknown:
            raise JobFailed(
                "unsupported_residues",
                f"The window contains residues other than the 20 standard amino acids: {', '.join(unknown)}.",
            )
        if change is not None:
            if not start <= change.position <= end:
                raise JobFailed(
                    "variant_outside_window",
                    f"Residue {change.position} is outside the window {start}-{end}.",
                )
            try:
                full_sequence = change.apply(full_sequence)
            except ValueError as error:
                raise JobFailed("reference_residue_mismatch", f"{change.hgvs_p}: {error}.") from error
        sequence = full_sequence[start - 1 : end]
        blocker = length_blocker(provider, len(sequence))
        if blocker:
            raise JobFailed("sequence_too_long", blocker + " Choose a residue window.")
        blocker = availability_blocker(provider, await provider.check_availability())
        if blocker and provider.execution_mode is ExecutionMode.REMOTE_API:
            # A remote service can recover between the check and the call: the call decides
            await context.log(f"{blocker} Calling it anyway.", level="warning")
        elif blocker:
            raise JobFailed("provider_unavailable", blocker)
        await context.log(
            f"Construct {start}-{end}: {len(sequence)} residues"
            + (f" with {change.hgvs_p}." if change else ", reference sequence.")
        )

    gene_symbol = protein.gene_symbol if protein and protein.gene_symbol else _gene_symbol(params)
    variant_id = None
    if change is not None:
        variant_id = (
            ProteinSubstitution(change.reference, change.position, change.alternate, gene_symbol).variant_id
            or change.hgvs_p
        )
    chain = ChainInput(
        sequence=sequence,
        uniprot_accession=params.uniprot_accession,
        residue_start=start,
        applied_variant_ids=[variant_id] if variant_id else [],
    )
    request = StructureRequest(
        uniprot_accession=params.uniprot_accession,
        chains=[chain],
        parameters={"protein_length": protein.length} if protein else {},
        seed=params.seed,
    )
    result = await provider.predict(request, context)

    async with context.stage(STAGE_STORE):
        descriptor = await store_structure_result(
            context,
            result,
            gene_symbol=gene_symbol,
            variant_id=variant_id if gene_symbol else None,
            sequence_source=RecordRef(
                database="uniprot",
                record_id=protein.accession,
                record_version=protein.entry_version,
                release=protein.provenance.release if protein.provenance else None,
                url=protein.provenance.record_url if protein.provenance else None,
            )
            if protein
            else None,
        )
        manifest = context.manifest
        if protein and protein.provenance:
            manifest.add_provenance(protein.provenance)
        if change is not None and variant_id:
            manifest.add_variant(
                ManifestVariant(
                    variant_id=variant_id,
                    hgvs={"p": change.hgvs_p},
                    protein_change=ProteinChange(
                        position=change.position, ref=change.reference, alt=change.alternate
                    ),
                )
            )
        if str(result.parameters.get("msa", "")).startswith("none"):
            manifest.set_msa(ManifestMsa(mode="single_sequence"))
        manifest.add_package("httpx")
        manifest.add_package("gemmi")

    return StructureJobResult(
        performs_inference=provider.execution_mode is not ExecutionMode.RETRIEVAL,
        structure=descriptor,
        gene_symbol=gene_symbol,
        variant_id=variant_id if gene_symbol else None,
    )
