"""Immutable run manifest, written once when a job reaches a terminal status.

Follows the schema in docs/research/provenance-reproducibility.md section 5.3, with the canonical
OrphaFold enums (structure origin predicted_orphafold) and three deliberate relaxations so that
retrieval and remote-API runs can be recorded truthfully: model.weights may be empty,
parameters.seed is required only for handlers that declare requires_seed, and
software.orphafold.git_commit is null when the deployment is not a git checkout.

integrity.manifest_sha256 is the SHA-256 of the RFC 8785 form of the document without that field.
"""

import copy
import importlib.metadata
import platform
import subprocess
import sys
from datetime import datetime
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field

from orphafold import __version__
from orphafold.config import API_DIR
from orphafold.hashing import canonical_sha256, md5_hex, refget_accession, sha256_hex, to_jsonable
from orphafold.providers.base import ConfidenceSample, DatasetVersion, ModelIdentity
from orphafold.schemas.common import ActorRef, Provenance, Schema, StructureOrigin
from orphafold.schemas.jobs import ArtifactRole, JobStage, JobStatus

MANIFEST_VERSION = "1.0.0"
MANIFEST_SCHEMA_ID = "urn:orphafold:schema:run-manifest:1.0.0"
MANIFEST_ARTIFACT_NAME = "manifest.json"


class RecordRef(Schema):
    database: str
    record_id: str
    record_version: str | None = None
    release: str | None = None
    url: str | None = None


class SoftwareItem(Schema):
    name: str
    version: str


class ManifestSequence(Schema):
    entity_id: str
    molecule_type: Literal["protein", "dna", "rna"] = "protein"
    sequence: str
    length: int
    sha256: str
    md5: str
    refget: str
    uniprot_start: int | None = None
    is_variant_sequence: bool = False
    applied_variant_ids: list[str] = Field(default_factory=list)
    source: RecordRef | None = None


class ProteinChange(Schema):
    position: int
    ref: str
    alt: str


class ManifestVariant(Schema):
    variant_id: str
    hgvs: dict[str, str]
    vrs_id: str | None = None
    vrs_version: str | None = None
    transcript: str | None = None
    transcript_status: Literal["MANE_Select", "MANE_Plus_Clinical", "other"] | None = None
    protein_change: ProteinChange | None = None
    xrefs: list[str] = Field(default_factory=list)


class ManifestLigand(Schema):
    entity_id: str
    ccd: str | None = None
    smiles: str | None = None
    inchikey: str | None = None
    xrefs: list[str] = Field(default_factory=list)


class ManifestInputStructure(Schema):
    origin: StructureOrigin
    source: RecordRef
    sha256: str


class ManifestInputs(Schema):
    sequences: list[ManifestSequence] = Field(default_factory=list)
    variants: list[ManifestVariant] = Field(default_factory=list)
    ligands: list[ManifestLigand] = Field(default_factory=list)
    structures: list[ManifestInputStructure] = Field(default_factory=list)
    database_identifiers: list[str] = Field(default_factory=list)


class ManifestMsa(Schema):
    mode: Literal["server", "precomputed", "single_sequence", "not_applicable"]
    server_url: str | None = None
    pairing_strategy: str | None = None
    search_tool: SoftwareItem | None = None
    databases: list[DatasetVersion] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)


class Hardware(Schema):
    accelerator: Literal["gpu", "cpu", "mps"] | None = None
    gpu_model: str | None = None
    gpu_count: int | None = None


class OrphaFoldSoftware(Schema):
    version: str
    git_commit: str | None = None


class ManifestSoftware(Schema):
    orphafold: OrphaFoldSoftware
    python: str
    os: str
    container: dict[str, str] | None = None
    cuda: str | None = None
    hardware: Hardware | None = None
    packages: list[SoftwareItem] = Field(default_factory=list)


class ManifestArtifact(Schema):
    artifact_id: str
    role: ArtifactRole
    path: str
    media_type: str
    size_bytes: int
    sha256: str
    structure_origin: StructureOrigin | None = None
    sample_index: int | None = None


class ManifestConfidenceSample(Schema):
    sample_index: int
    structure_artifact_id: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)


class ManifestConfidence(Schema):
    ranking_metric: str | None = None
    samples: list[ManifestConfidenceSample] = Field(default_factory=list)


class ManifestOutputs(Schema):
    artifacts: list[ManifestArtifact] = Field(default_factory=list)
    confidence: ManifestConfidence = Field(default_factory=ManifestConfidence)


class ManifestStage(Schema):
    id: str
    label: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None


class ManifestExecution(Schema):
    worker_id: str | None = None
    attempts: int = 1
    argv: list[str] | None = None
    exit_code: int | None = None
    wall_time_seconds: float | None = None
    parent_job_id: str | None = None
    stages: list[ManifestStage] = Field(default_factory=list)
    error: dict[str, Any] | None = None


class ManifestIntegrity(Schema):
    canonicalization: Literal["RFC8785"] = "RFC8785"
    manifest_sha256: str


class ManifestProject(Schema):
    project_id: str
    snapshot_id: str | None = None


class RunManifest(Schema):
    manifest_version: Literal["1.0.0"] = MANIFEST_VERSION
    job_id: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    kind: str
    status: JobStatus
    research_use_only: Literal[True] = True
    actor: ActorRef
    project: ManifestProject | None = None
    inputs: ManifestInputs
    request: dict[str, Any] = Field(description="Job parameters exactly as submitted and validated")
    model: ModelIdentity | None
    parameters: dict[str, Any]
    msa: ManifestMsa
    source_datasets: list[DatasetVersion]
    software: ManifestSoftware
    outputs: ManifestOutputs
    execution: ManifestExecution
    integrity: ManifestIntegrity


@lru_cache
def git_commit() -> str | None:
    """Commit of the running checkout, or None when there is no commit to name."""
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=API_DIR, capture_output=True, text=True, timeout=5, check=False
        )
    except OSError, subprocess.SubprocessError:
        return None
    commit = completed.stdout.strip()
    return commit if completed.returncode == 0 and len(commit) == 40 else None


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def manifest_sha256(manifest: dict[str, Any]) -> str:
    """Hash of the manifest without integrity.manifest_sha256."""
    unsigned = copy.deepcopy(manifest)
    unsigned.get("integrity", {}).pop("manifest_sha256", None)
    return canonical_sha256(unsigned)


def verify_manifest(manifest: dict[str, Any]) -> bool:
    stated = manifest.get("integrity", {}).get("manifest_sha256")
    return bool(stated) and stated == manifest_sha256(manifest)


class ManifestBuilder:
    """Collects what a run consumed and produced. Handlers fill it through JobContext.manifest."""

    def __init__(self) -> None:
        self.model: ModelIdentity | None = None
        self.parameters: dict[str, Any] = {}
        self.inputs = ManifestInputs()
        self.msa = ManifestMsa(mode="not_applicable")
        self.source_datasets: list[DatasetVersion] = []
        self.confidence = ManifestConfidence()
        self.hardware: Hardware | None = None
        self.cuda: str | None = None
        self.container: dict[str, str] | None = None
        self.argv: list[str] | None = None
        self.exit_code: int | None = None
        self._packages: dict[str, str] = {}

    def set_model(self, model: ModelIdentity) -> None:
        self.model = model

    def set_parameters(self, parameters: dict[str, Any]) -> None:
        """Every resolved parameter, including defaults the user did not set."""
        self.parameters = to_jsonable(parameters)

    def add_sequence(
        self,
        sequence: str,
        *,
        entity_id: str = "A",
        molecule_type: Literal["protein", "dna", "rna"] = "protein",
        uniprot_start: int | None = None,
        source: RecordRef | None = None,
        applied_variant_ids: list[str] | None = None,
    ) -> ManifestSequence:
        entry = ManifestSequence(
            entity_id=entity_id,
            molecule_type=molecule_type,
            sequence=sequence,
            length=len(sequence),
            sha256=sha256_hex(sequence),
            md5=md5_hex(sequence),
            refget=refget_accession(sequence),
            uniprot_start=uniprot_start,
            is_variant_sequence=bool(applied_variant_ids),
            applied_variant_ids=list(applied_variant_ids or []),
            source=source,
        )
        self.inputs.sequences.append(entry)
        return entry

    def add_variant(self, variant: ManifestVariant) -> None:
        self.inputs.variants.append(variant)

    def add_ligand(self, ligand: ManifestLigand) -> None:
        self.inputs.ligands.append(ligand)

    def add_input_structure(self, structure: ManifestInputStructure) -> None:
        self.inputs.structures.append(structure)

    def add_identifier(self, curie: str) -> None:
        if curie not in self.inputs.database_identifiers:
            self.inputs.database_identifiers.append(curie)

    def add_source_dataset(self, dataset: DatasetVersion) -> None:
        if all(
            (known.name, known.version) != (dataset.name, dataset.version) for known in self.source_datasets
        ):
            self.source_datasets.append(dataset)

    def add_provenance(self, provenance: Provenance) -> None:
        """Record the database release behind an adapter call. A source that reports no release is
        recorded with version 'unknown'."""
        self.add_source_dataset(
            DatasetVersion(
                name=provenance.source_name,
                version=provenance.release or "unknown",
                retrieved_at=provenance.retrieved_at,
                license=provenance.license,
                url=provenance.request_url,
            )
        )

    def set_msa(self, msa: ManifestMsa) -> None:
        self.msa = msa

    def add_package(self, name: str, version: str | None = None) -> None:
        """Record a Python package version. Looked up from the environment when not given."""
        resolved = version or package_version(name)
        if resolved:
            self._packages[name] = resolved

    def add_confidence_sample(
        self, sample: ConfidenceSample, structure_artifact_id: str | None = None
    ) -> None:
        self.confidence.samples.append(
            ManifestConfidenceSample(
                sample_index=sample.sample_index,
                structure_artifact_id=structure_artifact_id,
                metrics=to_jsonable(sample.metrics),
            )
        )

    def set_execution(self, argv: list[str] | None, exit_code: int | None) -> None:
        self.argv = argv
        self.exit_code = exit_code

    def build(
        self,
        *,
        job_id: str,
        kind: str,
        status: JobStatus,
        created_at: datetime,
        started_at: datetime | None,
        completed_at: datetime | None,
        actor: ActorRef,
        project_id: str | None,
        parent_job_id: str | None,
        request: dict[str, Any],
        stages: list[JobStage],
        artifacts: list[ManifestArtifact],
        worker_id: str | None,
        attempts: int,
        error: dict[str, Any] | None,
    ) -> dict[str, Any]:
        wall_time = (completed_at - started_at).total_seconds() if started_at and completed_at else None
        manifest = RunManifest(
            job_id=job_id,
            created_at=created_at,
            started_at=started_at,
            completed_at=completed_at,
            kind=kind,
            status=status,
            actor=actor,
            project=ManifestProject(project_id=project_id) if project_id else None,
            inputs=self.inputs,
            request=to_jsonable(request),
            model=self.model,
            parameters=self.parameters,
            msa=self.msa,
            source_datasets=self.source_datasets,
            software=ManifestSoftware(
                orphafold=OrphaFoldSoftware(version=__version__, git_commit=git_commit()),
                python=platform.python_version(),
                os=sys.platform,
                container=self.container,
                cuda=self.cuda,
                hardware=self.hardware,
                packages=[
                    SoftwareItem(name=name, version=version)
                    for name, version in sorted(self._packages.items())
                ],
            ),
            outputs=ManifestOutputs(artifacts=artifacts, confidence=self.confidence),
            execution=ManifestExecution(
                worker_id=worker_id,
                attempts=attempts,
                argv=self.argv,
                exit_code=self.exit_code,
                wall_time_seconds=wall_time,
                parent_job_id=parent_job_id,
                stages=[
                    ManifestStage(
                        id=stage.id,
                        label=stage.label,
                        status=stage.status.value,
                        started_at=stage.started_at,
                        completed_at=stage.completed_at,
                    )
                    for stage in stages
                ],
                error=error,
            ),
            integrity=ManifestIntegrity(manifest_sha256="0" * 64),
        )
        # Nulls are kept: null states that a value was not applicable or not known
        document = manifest.model_dump(mode="json")
        document["integrity"]["manifest_sha256"] = manifest_sha256(document)
        return document
