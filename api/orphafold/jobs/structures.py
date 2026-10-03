"""Shared step for every job that ends with a structure: store the provider's files, fill the
manifest and return a descriptor whose file URLs point at the stored artifacts."""

from pathlib import PurePosixPath

from orphafold.jobs.context import JobContext, JobFailed
from orphafold.jobs.manifest import RecordRef
from orphafold.providers.base import ProviderFile, StructureResult
from orphafold.schemas.common import StructureDescriptor, StructureFiles, StructureOrigin
from orphafold.schemas.jobs import ArtifactOut, ArtifactRole

MMCIF_MEDIA_TYPE = "chemical/x-mmcif"
BCIF_MEDIA_TYPE = "application/octet-stream"
PDB_MEDIA_TYPE = "chemical/x-pdb"

# Structure files are told apart by extension: BinaryCIF has no registered media type
_STRUCTURE_FILE_FIELDS = {".cif": "cif_url", ".bcif": "bcif_url", ".pdb": "pdb_url"}


async def _save(context: JobContext, file: ProviderFile) -> ArtifactOut:
    data = file.content if file.content is not None else file.path
    if data is None:
        raise JobFailed("empty_provider_file", f"The provider returned no content for {file.name}.")
    return await context.save_artifact(
        file.name,
        data,
        media_type=file.media_type,
        role=file.role,
        structure_origin=file.structure_origin,
        sample_index=file.sample_index,
        meta={"source_url": file.source_url} if file.source_url else None,
    )


async def store_structure_result(
    context: JobContext,
    result: StructureResult,
    *,
    gene_symbol: str | None = None,
    variant_id: str | None = None,
    sequence_source: RecordRef | None = None,
) -> StructureDescriptor:
    """Save every file with its SHA-256, record model, inputs, datasets and confidence in the
    manifest, and register OrphaFold-generated predictions. Call it inside a stage."""
    saved: dict[str, ArtifactOut] = {}
    for index, file in enumerate(result.files, start=1):
        await context.check_cancelled()
        saved[file.name] = await _save(context, file)
        await context.progress(index, len(result.files), unit="files")

    files = StructureFiles()
    primary: ArtifactOut | None = None
    for file in result.files:
        artifact = saved[file.name]
        if file.role is ArtifactRole.STRUCTURE and file.sample_index in (None, 0):
            extension = PurePosixPath(file.name).suffix.lower()
            field = _STRUCTURE_FILE_FIELDS.get(extension)
            if field and getattr(files, field) is None:
                setattr(files, field, artifact.url)
            if primary is None or extension == ".cif":
                primary = artifact
        elif file.role is ArtifactRole.PLDDT and files.plddt_url is None:
            files.plddt_url = artifact.url
        elif file.role is ArtifactRole.PAE and files.pae_url is None:
            files.pae_url = artifact.url

    manifest = context.manifest
    manifest.set_model(result.model)
    manifest.set_parameters(result.parameters)
    manifest.set_execution(result.argv, result.exit_code)
    for chain in result.sequences:
        manifest.add_sequence(
            chain.sequence,
            entity_id=chain.entity_id,
            molecule_type=chain.molecule_type,
            uniprot_start=chain.residue_start if chain.uniprot_accession else None,
            source=sequence_source,
            applied_variant_ids=chain.applied_variant_ids,
        )
    for curie in result.database_identifiers:
        manifest.add_identifier(curie)
    for dataset in result.source_datasets:
        manifest.add_source_dataset(dataset)
    manifest.confidence.ranking_metric = result.ranking_metric
    for sample in result.confidence_samples:
        artifact = saved.get(sample.structure_file) if sample.structure_file else None
        manifest.add_confidence_sample(sample, artifact.id if artifact else None)

    descriptor = result.descriptor.model_copy(update={"files": files, "job_id": context.job_id})
    if descriptor.origin is StructureOrigin.PREDICTED_ORPHAFOLD:
        first_chain = result.sequences[0] if result.sequences else None
        await context.record_structure(
            descriptor,
            structure_artifact=primary,
            uniprot_accession=first_chain.uniprot_accession if first_chain else None,
            gene_symbol=gene_symbol,
            variant_id=variant_id,
            sequence=first_chain.sequence if first_chain else None,
            residue_start=first_chain.residue_start if first_chain else None,
            residue_end=first_chain.residue_start + len(first_chain.sequence) - 1 if first_chain else None,
        )
    return descriptor
