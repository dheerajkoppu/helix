"""Cached examples provider: serves stored outputs of real model runs kept under data/examples.

It runs no model. Every structure it returns is the unmodified output of the run named in its
label (provider, model version, date, job), written there by api/scripts/cache_examples.py. A
sequence without a stored output is refused; nothing is generated or approximated.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from helix.config import get_settings
from helix.hashing import sha256_hex
from helix.log import get_logger
from helix.providers.base import (
    Availability,
    Capability,
    ChainInput,
    ConfidenceSample,
    ExecutionMode,
    ModelIdentity,
    ProviderError,
    ProviderFile,
    RunContext,
    StructurePredictor,
    StructureRequest,
    StructureResult,
    register_provider,
)
from helix.schemas.common import StructureDescriptor, StructureOrigin
from helix.schemas.compare import (
    CachedOrigin,
    ComparisonConstruct,
    ComparisonJobResult,
    DifferencePayload,
)
from helix.schemas.jobs import ArtifactRole, StageSpec

logger = get_logger(__name__)

INDEX_FILE = "index.json"
MANIFEST_FILE = "manifest.json"
RESULT_FILE = "result.json"
DIFFERENCE_FILE = "difference.json"
STAGE_READ = "read_cached_output"
ROLES = ("reference", "variant")


@dataclass(slots=True)
class CachedExample:
    """One stored comparison: both models, the difference payload and the run manifest."""

    job_id: str
    directory: Path
    variant_id: str | None
    gene_symbol: str | None
    uniprot_accession: str
    origin: CachedOrigin
    construct: ComparisonConstruct
    sequence_sha256: dict[str, str]
    files: list[str]
    manifest_sha256: str | None = None

    def path(self, name: str) -> Path | None:
        """A stored file of this example, by its listed name only."""
        if name not in self.files:
            return None
        path = self.directory / name
        return path if path.is_file() else None

    def read_json(self, name: str) -> Any:
        path = self.path(name)
        if path is None:
            raise FileNotFoundError(name)
        return json.loads(path.read_text(encoding="utf-8"))

    def result(self) -> ComparisonJobResult:
        return ComparisonJobResult.model_validate(self.read_json(RESULT_FILE)["result"])

    def difference(self) -> DifferencePayload:
        return DifferencePayload.model_validate(self.read_json(DIFFERENCE_FILE))


def cached_label(origin: CachedOrigin) -> str:
    return (
        f"Cached output of {origin.provider_name or origin.provider_id}, model version "
        f"{origin.model_version}, generated {origin.generated_at:%Y-%m-%d} by run {origin.job_id}. "
        "No model was run for this request."
    )


_loaded: tuple[tuple[str, float], list[CachedExample]] | None = None


def _parse(directory: Path, row: dict[str, Any]) -> CachedExample:
    origin = CachedOrigin(
        provider_id=row["provider_id"],
        provider_name=row.get("provider_name"),
        model_name=row.get("model_name"),
        model_version=row.get("model_version"),
        job_id=row["job_id"],
        generated_at=datetime.fromisoformat(row["generated_at"]),
        label="",
    )
    origin.label = cached_label(origin)
    return CachedExample(
        job_id=row["job_id"],
        directory=directory / row["directory"],
        variant_id=row.get("variant_id"),
        gene_symbol=row.get("gene_symbol"),
        uniprot_accession=row["uniprot_accession"],
        origin=origin,
        construct=ComparisonConstruct.model_validate(row["construct"]),
        sequence_sha256=dict(row["sequence_sha256"]),
        files=list(row["files"]),
        manifest_sha256=row.get("manifest_sha256"),
    )


def load_examples() -> list[CachedExample]:
    """Examples listed in data/examples/index.json; reread when the file changes."""
    global _loaded
    directory = get_settings().examples_dir
    index = directory / INDEX_FILE
    try:
        fingerprint = (str(index), index.stat().st_mtime)
    except OSError:
        return []
    if _loaded is not None and _loaded[0] == fingerprint:
        return _loaded[1]
    examples: list[CachedExample] = []
    try:
        document = json.loads(index.read_text(encoding="utf-8"))
        for row in document.get("examples", []):
            example = _parse(directory, row)
            if example.path(MANIFEST_FILE) is None:
                # An output without the manifest of the run that produced it is never served
                logger.warning("Cached example %s has no run manifest; skipped", example.job_id)
                continue
            examples.append(example)
    except Exception:
        logger.exception("The cached example index %s could not be read", index)
        return []
    _loaded = (fingerprint, examples)
    return examples


def example_by_job(job_id: str) -> CachedExample | None:
    return next((example for example in load_examples() if example.job_id == job_id), None)


def examples_for_variant(variant_id: str) -> list[CachedExample]:
    return [example for example in load_examples() if example.variant_id == variant_id]


@register_provider
class CachedExamplesProvider(StructurePredictor):
    id = "cached_examples"
    name = "Cached examples"
    model_name = None
    model_version = None
    license = "CC-BY-4.0"
    commercial_use = True
    capabilities = (Capability.MONOMER, Capability.PLDDT)
    execution_mode = ExecutionMode.RETRIEVAL
    structure_origin = StructureOrigin.PREDICTED_INTERNAL
    limitations = (
        "Runs no model. It returns stored outputs of earlier real runs, each labelled with the "
        "provider, model version, date and run that produced it.",
        "Only the sequences of the stored examples are available; any other input is refused.",
    )
    job_kinds = ("structure_prediction", "variant_comparison")

    async def check_availability(self) -> Availability:
        examples = load_examples()
        if not examples:
            return Availability(
                available=False,
                reason=f"No cached examples are stored under {get_settings().examples_dir.name}/.",
            )
        origins = sorted(
            {
                f"{example.origin.provider_name or example.origin.provider_id}, "
                f"{example.origin.generated_at:%Y-%m-%d}"
                for example in examples
            }
        )
        return Availability(
            available=True,
            reason=f"Serves {len(examples)} stored comparisons from real runs ({'; '.join(origins)}). "
            "No model is run.",
        )

    def plan(self, request: StructureRequest) -> list[StageSpec]:
        return [StageSpec(id=STAGE_READ, label="Reading the cached model output")]

    def construct_for(self, uniprot_accession: str, variant_id: str | None) -> ComparisonConstruct | None:
        """The construct of the stored comparison of this variant: the only one it can serve."""
        for example in load_examples():
            if example.uniprot_accession == uniprot_accession and example.variant_id == variant_id:
                return example.construct
        return None

    def _find(self, chain: ChainInput) -> tuple[CachedExample, str] | None:
        digest = sha256_hex(chain.sequence)
        for example in load_examples():
            if chain.uniprot_accession and example.uniprot_accession != chain.uniprot_accession:
                continue
            if example.construct.start != chain.residue_start:
                continue
            for role in ROLES:
                if example.sequence_sha256.get(role) == digest:
                    return example, role
        return None

    async def predict(self, request: StructureRequest, context: RunContext) -> StructureResult:
        if len(request.chains) != 1:
            raise ProviderError("unsupported_input", "Cached examples hold single-chain models only.")
        chain = request.chains[0]
        async with context.stage(STAGE_READ):
            found = self._find(chain)
            if found is None:
                raise ProviderError(
                    "not_cached",
                    "No cached output exists for this sequence and residue range. Cached examples "
                    "cover a fixed set of variants; run a model provider for anything else.",
                )
            example, role = found
            origin = example.origin
            cif_path = example.path(f"{role}.cif")
            if cif_path is None:
                raise ProviderError("not_cached", f"The cached {role} model file is missing.")
            stored: StructureDescriptor = getattr(example.result(), f"{role}_model")
            plddt_path = example.path(f"{role}.plddt.json")
            scores: list[float] | None = None
            if plddt_path is not None:
                scores = json.loads(plddt_path.read_text(encoding="utf-8")).get("plddt")
            await context.log(f"{origin.label} Model: {role} of {example.variant_id}.")

        descriptor = stored.model_copy(
            update={
                "id": f"of:{context.job_id or 'detached'}",
                "provider": self.id,
                "provider_name": f"{self.name} · {origin.provider_name or origin.provider_id}",
                "source_id": stored.id,
                "title": f"Cached output · {(stored.title or '').rpartition(' · ')[2]}".rstrip(" ·"),
                "limitations": [origin.label, *stored.limitations],
                "warnings": ["cached_example_output", *stored.warnings],
                "job_id": None,
            }
        )
        files = [
            ProviderFile(
                name="model_0.cif",
                role=ArtifactRole.STRUCTURE,
                media_type="chemical/x-mmcif",
                path=cif_path,
                structure_origin=StructureOrigin.PREDICTED_INTERNAL,
                sample_index=0,
            )
        ]
        if plddt_path is not None:
            files.append(
                ProviderFile(
                    name="model_0.plddt.json",
                    role=ArtifactRole.PLDDT,
                    media_type="application/json",
                    path=plddt_path,
                )
            )
        return StructureResult(
            descriptor=descriptor,
            model=ModelIdentity(
                provider=self.id,
                name=f"{origin.model_name} (cached output of {origin.provider_id})",
                version=origin.model_version or "unknown",
                license=self.license or "",
                execution_mode=self.execution_mode,
            ),
            files=files,
            sequences=[chain],
            parameters={
                "performs_inference": False,
                "cached_from": origin.model_dump(mode="json"),
                "cached_manifest_sha256": example.manifest_sha256,
                "cached_model_role": role,
            },
            confidence_samples=[
                ConfidenceSample(
                    sample_index=0,
                    structure_file="model_0.cif",
                    metrics={"plddt_mean": stored.confidence.plddt_mean if stored.confidence else None},
                )
            ],
            plddt_per_residue=scores,
            database_identifiers=[f"uniprot:{example.uniprot_accession}"],
            provider_native={"cached_from": origin.model_dump(mode="json")},
        )
