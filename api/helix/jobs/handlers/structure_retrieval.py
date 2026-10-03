"""Job kind structure_retrieval: fetch an existing predicted model from a retrieval provider.

Nothing is predicted here. The result is labelled as retrieval and the structure keeps the origin
its provider declares (predicted_external for AlphaFold DB).
"""

from pydantic import BaseModel, Field, field_validator

from helix.identifiers import UNIPROT_ACCESSION_PATTERN
from helix.jobs import JobContext, JobFailed, job_handler
from helix.jobs.manifest import RecordRef
from helix.jobs.structures import store_structure_result
from helix.knowledge.catalog import get_catalog
from helix.providers.base import (
    ExecutionMode,
    Provider,
    StructurePredictor,
    StructureRequest,
    get_provider,
)
from helix.schemas.common import EntityRef, EntityType
from helix.schemas.jobs import StageSpec, StructureJobResult

KIND = "structure_retrieval"
STAGE_STORE = "store_artifacts"


class StructureRetrievalParams(BaseModel):
    provider: str = Field(default="afdb", description="A retrieval provider; see GET /api/v1/models")
    uniprot_accession: str = Field(
        pattern=rf"^(?:{UNIPROT_ACCESSION_PATTERN})$", description="UniProt accession"
    )
    expected_sequence_md5: str | None = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{32}$",
        description="MD5 of the current UniProt canonical sequence; a mismatch is reported as a warning",
    )

    @field_validator("provider")
    @classmethod
    def _is_retrieval_provider(cls, value: str) -> str:
        if not _is_retrieval(get_provider(value)):
            raise ValueError(f"'{value}' is not a structure retrieval provider")
        return value


def _is_retrieval(provider: Provider | None) -> bool:
    return isinstance(provider, StructurePredictor) and provider.execution_mode is ExecutionMode.RETRIEVAL


def _retrieval_provider(provider_id: str) -> StructurePredictor:
    provider = get_provider(provider_id)
    if not isinstance(provider, StructurePredictor) or not _is_retrieval(provider):
        raise JobFailed("unsupported_provider", f"'{provider_id}' is not a structure retrieval provider.")
    return provider


def _request(params: StructureRetrievalParams) -> StructureRequest:
    parameters = {}
    if params.expected_sequence_md5:
        parameters["expected_sequence_md5"] = params.expected_sequence_md5
    return StructureRequest(uniprot_accession=params.uniprot_accession, parameters=parameters)


def _stages(params: StructureRetrievalParams) -> list[StageSpec]:
    provider = get_provider(params.provider)
    planned = provider.plan(_request(params)) if isinstance(provider, StructurePredictor) else []
    return [*planned, StageSpec(id=STAGE_STORE, label="Storing files")]


def _title(params: StructureRetrievalParams) -> str:
    provider = get_provider(params.provider)
    return f"{provider.name if provider else params.provider} retrieval · {params.uniprot_accession}"


def _subject(params: StructureRetrievalParams) -> EntityRef:
    gene = get_catalog().gene_by_uniprot(params.uniprot_accession)
    return EntityRef.of(
        EntityType.PROTEIN,
        params.uniprot_accession,
        gene.protein_name if gene else None,
        f"uniprot:{params.uniprot_accession}",
    )


@job_handler(
    KIND,
    title="Retrieve predicted structure",
    description="Fetches an existing predicted model and its confidence files. Retrieval, not inference.",
    params=StructureRetrievalParams,
    result=StructureJobResult,
    stages=_stages,
    provider=lambda params: params.provider,
    restartable=True,
    describe=_title,
    subject=_subject,
)
async def retrieve_structure(context: JobContext, params: StructureRetrievalParams) -> StructureJobResult:
    provider = _retrieval_provider(params.provider)
    result = await provider.predict(_request(params), context)

    gene = get_catalog().gene_by_uniprot(params.uniprot_accession)
    async with context.stage(STAGE_STORE):
        descriptor = await store_structure_result(
            context,
            result,
            gene_symbol=gene.symbol if gene else None,
            sequence_source=RecordRef(
                database=provider.id,
                record_id=result.descriptor.source_id or params.uniprot_accession,
                record_version=result.descriptor.model_version,
                release=result.descriptor.model_version,
                url=result.descriptor.source_url,
            ),
        )
        context.manifest.add_package("httpx")
        context.manifest.add_package("gemmi")

    return StructureJobResult(
        performs_inference=False,
        structure=descriptor,
        upstream_files=result.descriptor.files,
        gene_symbol=gene.symbol if gene else None,
    )
