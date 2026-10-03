"""Reference-versus-variant comparison: what can be run for a variant, and stored results.

A comparison is run through POST /api/v1/jobs (kind variant_comparison). This service resolves the
variant, proposes the construct, says which providers can run it here, and reads results back,
including the cached examples under data/examples.
"""

import asyncio
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from helix.analysis.caveats import comparison_caveats, is_deterministic, provider_ref
from helix.analysis.construct import choose_construct
from helix.analysis.inputs import (
    availability_blocker,
    length_blocker,
    nonstandard_residues,
    predictors_for,
)
from helix.analysis.properties import property_change
from helix.analysis.protein import ProteinRecord, fetch_protein
from helix.artifacts.store import ArtifactStore
from helix.config import API_PREFIX
from helix.db.models import Actor, Artifact, Job
from helix.errors import BadRequest, Conflict, NotFound
from helix.identifiers import ProteinSubstitution, parse_protein_change
from helix.knowledge.catalog import Catalog
from helix.log import get_logger
from helix.providers.base import ExecutionMode, StructurePredictor
from helix.providers.cached_examples import (
    DIFFERENCE_FILE,
    MANIFEST_FILE,
    CachedExample,
    example_by_job,
    examples_for_variant,
)
from helix.schemas.common import EntityRef, EntityType, SourceState, StructureDescriptor
from helix.schemas.compare import (
    CachedOrigin,
    ComparePlanResponse,
    CompareResultResponse,
    ComparisonConfidence,
    ComparisonConstruct,
    ComparisonJobResult,
    ComparisonResultSummary,
    ComparisonVariant,
    DifferencePayload,
    ProviderOption,
    ReferenceCheck,
)
from helix.schemas.jobs import JobStatus
from helix.sources import SourceCall, gather_sources
from helix.sources.uniprot import uniprot

logger = get_logger(__name__)

JOB_KIND = "variant_comparison"
MAX_LISTED_RESULTS = 20

MEDIA_TYPES = {".cif": "chemical/x-mmcif", ".pdb": "chemical/x-pdb", ".json": "application/json"}


def result_url(job_id: str) -> str:
    return f"{API_PREFIX}/compare/results/{job_id}"


def example_file_url(job_id: str, name: str) -> str:
    return f"{API_PREFIX}/compare/examples/{job_id}/files/{quote(name)}"


def _reference_check(change: ProteinSubstitution, protein: ProteinRecord | None) -> ReferenceCheck:
    if protein is None:
        return ReferenceCheck(
            state="unknown",
            expected=change.reference,
            message="The UniProt sequence is not available, so the reference residue was not checked.",
        )
    if not 1 <= change.position <= protein.length:
        return ReferenceCheck(
            state="out_of_range",
            expected=change.reference,
            message=f"Position {change.position} is outside the UniProt canonical sequence of "
            f"{protein.accession} ({protein.length} residues).",
        )
    found = protein.sequence[change.position - 1]
    if found != change.reference:
        return ReferenceCheck(
            state="mismatch",
            expected=change.reference,
            found=found,
            message=f"The UniProt canonical sequence of {protein.accession} has {found} at position "
            f"{change.position}, not {change.reference}. The variant may be numbered on another isoform.",
        )
    return ReferenceCheck(
        state="match",
        expected=change.reference,
        found=found,
        message=f"{change.reference}{change.position} matches the UniProt canonical sequence of "
        f"{protein.accession}.",
    )


async def _provider_option(
    provider: StructurePredictor,
    *,
    variant_id: str,
    change: ProteinSubstitution,
    protein: ProteinRecord | None,
    check: ReferenceCheck,
    accession: str | None,
) -> ProviderOption:
    availability = await provider._checked_availability()
    reasons: list[str] = []
    blocker = availability_blocker(provider, availability)
    if blocker:
        reasons.append(blocker)
    construct: ComparisonConstruct | None = None
    fixed_construct = getattr(provider, "construct_for", None)
    if fixed_construct is not None:
        construct = fixed_construct(accession, variant_id) if accession else None
        if construct is None:
            reasons.append("No cached output exists for this variant.")
    elif protein is None:
        reasons.append("The UniProt sequence is not available, so no construct can be built.")
    elif check.state != "match":
        reasons.append(check.message)
    else:
        construct = choose_construct(
            protein_length=protein.length,
            position=change.position,
            domains=protein.domains,
            max_residues=provider.max_residues,
            uniprot_accession=protein.accession,
        )
        blocker = length_blocker(provider, construct.length)
        if blocker:
            reasons.append(blocker)
        unknown = nonstandard_residues(protein.sequence[construct.start - 1 : construct.end])
        if unknown:
            reasons.append(
                "The construct contains residues other than the 20 standard amino acids: "
                f"{', '.join(unknown)}."
            )
    return ProviderOption(
        id=provider.id,
        name=provider.name,
        model_name=provider.model_name,
        model_version=await provider.current_model_version(),
        execution_mode=provider.execution_mode.value,
        performs_inference=provider.execution_mode is not ExecutionMode.RETRIEVAL,
        deterministic=is_deterministic(provider),
        max_residues=provider.max_residues,
        available=availability.available,
        can_run=not reasons,
        reasons=reasons,
        construct=construct,
        job_params={"provider": provider.id, "variant_id": variant_id},
    )


def _example_summary(example: CachedExample) -> ComparisonResultSummary | None:
    try:
        result = example.result()
    except Exception:
        logger.exception("Cached example %s could not be read", example.job_id)
        return None
    return ComparisonResultSummary(
        result_id=example.job_id,
        origin="cached_example",
        label=example.origin.label,
        provider=result.provider.model_copy(update={"cached_from": example.origin}),
        construct=result.construct,
        summary=result.summary,
        generated_at=example.origin.generated_at,
        result_url=result_url(example.job_id),
        manifest_url=example_file_url(example.job_id, MANIFEST_FILE),
    )


def _job_label(result: ComparisonJobResult, job_id: str) -> str:
    cached = result.provider.cached_from
    if cached is not None:
        return cached.label
    return f"Helix-generated prediction · {result.provider.name} · run {job_id}"


async def _job_summaries(
    session: AsyncSession, actor: Actor | None, variant_id: str, skip: set[str]
) -> list[ComparisonResultSummary]:
    """Finished comparisons of this variant run by the calling workspace."""
    if actor is None:
        return []
    jobs = await session.scalars(
        select(Job)
        .where(
            Job.kind == JOB_KIND,
            Job.status == JobStatus.SUCCEEDED.value,
            Job.subject_id == variant_id,
            Job.actor_id == actor.id,
        )
        .order_by(Job.created_at.desc())
        .limit(MAX_LISTED_RESULTS)
    )
    summaries: list[ComparisonResultSummary] = []
    for job in jobs:
        if job.id in skip or not job.result:
            continue
        try:
            result = ComparisonJobResult.model_validate(job.result)
        except Exception:
            logger.warning("Result of %s is not a comparison result; skipped", job.id)
            continue
        summaries.append(
            ComparisonResultSummary(
                result_id=job.id,
                origin="job",
                label=_job_label(result, job.id),
                provider=result.provider,
                construct=result.construct,
                summary=result.summary,
                generated_at=job.completed_at,
                result_url=result_url(job.id),
                manifest_url=f"{API_PREFIX}/jobs/{job.id}/manifest",
            )
        )
    return summaries


async def plan_comparison(
    session: AsyncSession, actor: Actor | None, catalog: Catalog, gene_symbol: str, change_text: str
) -> ComparePlanResponse:
    gene = catalog.gene(gene_symbol) or catalog.gene(gene_symbol.upper())
    if gene is None:
        raise NotFound(f"No gene {gene_symbol} in the catalog.", code="gene_not_found")
    text = change_text.strip()
    prefix = f"{gene.symbol}-"
    if text.upper().startswith(prefix.upper()):
        text = text[len(prefix) :]
    change = parse_protein_change(text, gene.symbol)
    if change is None:
        raise BadRequest(
            f"'{change_text}' is not a single amino acid substitution. A comparison needs one, such as "
            "p.Arg28His or R28H.",
            code="unsupported_variant",
        )
    if change.alternate == "*" or change.reference == change.alternate:
        raise BadRequest(
            f"{change.hgvs_p} has no variant protein of the same length to compare with the reference.",
            code="unsupported_variant",
        )
    variant_id = change.variant_id or f"{gene.symbol}-{change.hgvs_p}"
    accession = gene.uniprot_accession

    sources = [catalog.source_status()]
    protein: ProteinRecord | None = None
    if accession:
        gathered = await gather_sources(
            {"uniprot": SourceCall(uniprot, fetch_protein(accession), timeout=25)}
        )
        protein = gathered.data("uniprot")
        sources.extend(gathered.sources)
        if gathered["uniprot"].state is SourceState.EMPTY:
            protein = None

    check = _reference_check(change, protein)
    predictors = predictors_for(JOB_KIND)
    options = list(
        await asyncio.gather(
            *(
                _provider_option(
                    provider,
                    variant_id=variant_id,
                    change=change,
                    protein=protein,
                    check=check,
                    accession=accession,
                )
                for provider in predictors
            )
        )
    )
    # Providers that run a model first, then by ID
    options.sort(key=lambda option: (not option.performs_inference, option.id))
    by_id = {provider.id: provider for provider in predictors}
    preferred = next((option for option in options if option.can_run), None) or next(
        (option for option in options if option.construct is not None), None
    )

    examples = examples_for_variant(variant_id)
    results = [summary for summary in map(_example_summary, examples) if summary is not None]
    results.extend(await _job_summaries(session, actor, variant_id, {example.job_id for example in examples}))

    return ComparePlanResponse(
        variant=ComparisonVariant(
            variant_id=variant_id,
            gene_symbol=gene.symbol,
            uniprot_accession=accession,
            position=change.position,
            reference=change.reference,
            alternate=change.alternate,
            hgvs_p=change.hgvs_p,
            short=change.short,
        ),
        gene=EntityRef.of(
            EntityType.GENE, gene.symbol, gene.name, gene.hgnc_id.lower() if gene.hgnc_id else None
        ),
        protein=EntityRef.of(EntityType.PROTEIN, accession, gene.protein_name, f"uniprot:{accession}")
        if accession
        else None,
        protein_length=protein.length if protein else None,
        reference_check=check,
        property_change=property_change(change.reference, change.alternate),
        proposed_construct=preferred.construct if preferred else None,
        domains=protein.domains if protein else [],
        providers=options,
        results=results,
        caveats=comparison_caveats(
            deterministic=is_deterministic(by_id[preferred.id]) if preferred else None,
            full_length=preferred.construct.full_length if preferred and preferred.construct else True,
        ),
        sources=sources,
    )


def _with_example_files(
    descriptor: StructureDescriptor, example: CachedExample, label: str
) -> StructureDescriptor:
    """Point a stored descriptor at the example's files and say where it came from."""
    files = descriptor.files.model_copy()
    for field in type(files).model_fields:
        url = getattr(files, field)
        name = PurePosixPath(url).name if url else None
        setattr(files, field, example_file_url(example.job_id, name) if name and example.path(name) else None)
    return descriptor.model_copy(
        update={
            "files": files,
            "limitations": [label, *descriptor.limitations],
            "warnings": ["cached_example_output", *descriptor.warnings],
        }
    )


def _example_result(example: CachedExample) -> CompareResultResponse:
    result = example.result()
    difference = example.difference()
    origin: CachedOrigin = example.origin
    provider = result.provider.model_copy(update={"cached_from": origin})
    reference_model = _with_example_files(result.reference_model, example, origin.label)
    variant_model = _with_example_files(result.variant_model, example, origin.label)
    return CompareResultResponse(
        job_id=example.job_id,
        origin="cached_example",
        label=origin.label,
        cached_from=origin,
        performs_inference=False,
        variant=result.variant,
        construct=result.construct,
        provider=provider,
        reference_model=reference_model,
        variant_model=variant_model,
        difference=difference.model_copy(update={"provider": provider}),
        difference_url=example_file_url(example.job_id, DIFFERENCE_FILE),
        confidence=ComparisonConfidence(
            reference=reference_model.confidence, variant=variant_model.confidence, site=difference.site
        ),
        manifest_url=example_file_url(example.job_id, MANIFEST_FILE),
        generated_at=origin.generated_at,
        caveats=result.caveats,
    )


async def comparison_result(
    session: AsyncSession, store: ArtifactStore, job_id: str
) -> CompareResultResponse:
    example = example_by_job(job_id)
    if example is not None:
        return _example_result(example)

    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound(f"No comparison result {job_id}.", code="comparison_not_found")
    if job.kind != JOB_KIND:
        raise NotFound(f"Job {job_id} is a {job.kind} job, not a comparison.", code="comparison_not_found")
    if job.status != JobStatus.SUCCEEDED.value or not job.result:
        raise Conflict(
            f"Job {job_id} is {job.status}; a comparison result exists once the job has succeeded.",
            code="comparison_not_ready",
        )
    result = ComparisonJobResult.model_validate(job.result)
    artifact = await session.scalar(
        select(Artifact).where(Artifact.job_id == job_id, Artifact.name == DIFFERENCE_FILE)
    )
    if artifact is None:
        raise NotFound(f"Job {job_id} has no {DIFFERENCE_FILE}.", code="artifact_not_found")
    difference = DifferencePayload.model_validate_json(await store.get_bytes(artifact.storage_key))
    return CompareResultResponse(
        job_id=job.id,
        origin="job",
        label=_job_label(result, job.id),
        cached_from=result.provider.cached_from,
        performs_inference=result.performs_inference,
        variant=result.variant,
        construct=result.construct,
        provider=result.provider,
        reference_model=result.reference_model,
        variant_model=result.variant_model,
        difference=difference,
        difference_url=result.difference_url,
        confidence=ComparisonConfidence(
            reference=result.reference_model.confidence,
            variant=result.variant_model.confidence,
            site=difference.site,
        ),
        manifest_url=f"{API_PREFIX}/jobs/{job.id}/manifest",
        generated_at=job.completed_at,
        caveats=result.caveats,
    )


def example_file(job_id: str, name: str) -> tuple[Path, str]:
    """Path and media type of one stored file of a cached example."""
    example = example_by_job(job_id)
    if example is None:
        raise NotFound(f"No cached example {job_id}.", code="example_not_found")
    path = example.path(name)
    if path is None:
        raise NotFound(f"Cached example {job_id} has no file '{name}'.", code="example_file_not_found")
    return path, MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


__all__ = ["comparison_result", "example_file", "plan_comparison", "provider_ref"]
