"""Model provider interfaces and registry.

A provider is a replaceable compute adapter: retrieval of an existing prediction, a remote API, a
local command-line model or a GPU worker. Providers never touch the job tables or the HTTP layer;
they receive a RunContext for logging, stages and cancellation, and return files plus metadata.
Job handlers store the files and write the manifest.
"""

from abc import ABC, abstractmethod
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, ClassVar, Literal, Protocol

from pydantic import Field

from orphafold.ids import utcnow
from orphafold.log import get_logger
from orphafold.schemas.common import (
    Citation,
    ConfidenceSummary,
    EntityRef,
    Evidence,
    Schema,
    SourceStatus,
    StructureDescriptor,
    StructureOrigin,
)
from orphafold.schemas.jobs import ArtifactRole, StageSpec

logger = get_logger(__name__)


class ExecutionMode(StrEnum):
    RETRIEVAL = "retrieval"
    REMOTE_API = "remote_api"
    LOCAL_CLI = "local_cli"
    GPU_WORKER = "gpu_worker"


class ProviderKind(StrEnum):
    STRUCTURE_PREDICTOR = "structure_predictor"
    BINDING_PREDICTOR = "binding_predictor"
    VARIANT_EFFECT = "variant_effect"
    POCKET = "pocket"
    LITERATURE = "literature"


class Capability(StrEnum):
    MONOMER = "monomer"
    COMPLEX = "complex"
    LIGAND = "ligand"
    AFFINITY = "affinity"
    PLDDT = "plddt"
    PAE = "pae"
    PTM = "ptm"
    IPTM = "iptm"
    VARIANT_EFFECT = "variant_effect"
    POCKETS = "pockets"
    LITERATURE_SEARCH = "literature_search"


class Availability(Schema):
    available: bool
    reason: str = Field(description="Human-readable: why the provider can or cannot run here")
    checked_at: datetime = Field(default_factory=utcnow)


class ProviderInfo(Schema):
    id: str
    name: str
    kind: ProviderKind
    model_name: str | None = None
    model_version: str | None = Field(default=None, description="Null when not known on this deployment")
    license: str | None = None
    license_url: str | None = None
    commercial_use: bool | None = Field(
        default=None, description="Whether the license permits commercial use"
    )
    capabilities: list[str] = Field(default_factory=list)
    execution_mode: ExecutionMode
    performs_inference: bool = Field(description="False for retrieval of an existing prediction")
    structure_origin: StructureOrigin | None = Field(
        default=None, description="Origin carried by structures this provider returns"
    )
    max_residues: int | None = None
    requires_api_key: bool = False
    requires_gpu: bool = False
    availability: Availability
    limitations: list[str] = Field(default_factory=list)
    citation: list[Citation] = Field(default_factory=list)
    attribution: str | None = None
    homepage: str | None = None
    job_kinds: list[str] = Field(default_factory=list, description="Job kinds that run this provider")


class ProviderError(Exception):
    """An expected failure with a message fit for the interface: no model exists, input out of
    range, executable missing, remote service down. The job fails with this code and message."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


class RunContext(Protocol):
    """What a provider may use while it runs. JobContext implements it."""

    job_id: str | None

    @property
    def workdir(self) -> Path: ...

    def stage(self, stage_id: str) -> AbstractAsyncContextManager[None]: ...

    async def log(self, message: str, *, level: str = "info", **data: Any) -> None: ...

    async def progress(
        self,
        completed: float,
        total: float | None = None,
        *,
        unit: str | None = None,
        detail: str | None = None,
    ) -> None: ...

    async def check_cancelled(self) -> None: ...


class DetachedRunContext:
    """RunContext for calling a provider outside a job (scripts, one-off checks)."""

    job_id: str | None = None

    def __init__(self, workdir: Path | None = None) -> None:
        self._workdir = workdir

    @property
    def workdir(self) -> Path:
        if self._workdir is None:
            import tempfile

            self._workdir = Path(tempfile.mkdtemp(prefix="orphafold-"))
        return self._workdir

    @asynccontextmanager
    async def _stage(self, stage_id: str):
        logger.info("stage %s", stage_id)
        yield

    def stage(self, stage_id: str) -> AbstractAsyncContextManager[None]:
        return self._stage(stage_id)

    async def log(self, message: str, *, level: str = "info", **data: Any) -> None:
        logger.log({"warning": 30, "error": 40}.get(level, 20), message)

    async def progress(
        self,
        completed: float,
        total: float | None = None,
        *,
        unit: str | None = None,
        detail: str | None = None,
    ) -> None:
        return None

    async def check_cancelled(self) -> None:
        return None


# Requests


class ChainInput(Schema):
    entity_id: str = "A"
    molecule_type: Literal["protein", "dna", "rna"] = "protein"
    sequence: str
    uniprot_accession: str | None = None
    residue_start: int = Field(default=1, description="UniProt position of the first residue of the sequence")
    applied_variant_ids: list[str] = Field(default_factory=list)
    msa_artifact: str | None = None


class LigandInput(Schema):
    entity_id: str = "L"
    smiles: str | None = None
    ccd: str | None = None
    inchikey: str | None = None
    label: str | None = None
    xrefs: list[str] = Field(default_factory=list)


class StructureRequest(Schema):
    """Input of StructurePredictor.predict. Retrieval providers read uniprot_accession; inference
    providers read chains and ligands."""

    uniprot_accession: str | None = None
    chains: list[ChainInput] = Field(default_factory=list)
    ligands: list[LigandInput] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    seed: int | None = None


class BindingRequest(Schema):
    chains: list[ChainInput]
    ligand: LigandInput
    pocket_residues: list[int] = Field(default_factory=list, description="UniProt canonical positions")
    parameters: dict[str, Any] = Field(default_factory=dict)
    seed: int | None = None


class VariantEffectRequest(Schema):
    uniprot_accession: str
    position: int
    reference: str = Field(description="One-letter reference residue")
    alternate: str = Field(description="One-letter variant residue")
    variant_id: str | None = None
    sequence: str | None = None


class PocketRequest(Schema):
    structure_id: str
    structure_path: str | None = None
    structure_format: Literal["mmcif", "pdb"] = "mmcif"
    chain: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class LiteratureRequest(Schema):
    entity: EntityRef | None = None
    query: str | None = None
    terms: list[str] = Field(default_factory=list)
    limit: int = 20
    offset: int = 0


# Results


@dataclass(slots=True)
class ProviderFile:
    """A file a provider produced or retrieved. Give content or path, never neither."""

    name: str
    role: ArtifactRole
    media_type: str
    content: bytes | None = None
    path: Path | None = None
    structure_origin: StructureOrigin | None = None
    sample_index: int | None = None
    source_url: str | None = None


class ModelWeights(Schema):
    name: str
    uri: str | None = None
    revision: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None


class ModelCode(Schema):
    repository: str | None = None
    revision: str | None = None
    package: str | None = None


class ModelIdentity(Schema):
    """What exactly produced an output: recorded verbatim in the run manifest."""

    provider: str
    name: str
    version: str
    license: str
    execution_mode: ExecutionMode
    code: ModelCode | None = None
    weights: list[ModelWeights] = Field(default_factory=list)


class DatasetVersion(Schema):
    name: str
    version: str
    retrieved_at: datetime | None = None
    license: str | None = None
    url: str | None = None


class ConfidenceSample(Schema):
    """Model-reported confidence of one sample, verbatim."""

    sample_index: int = 0
    structure_file: str | None = Field(default=None, description="Name of the ProviderFile it describes")
    metrics: dict[str, Any] = Field(default_factory=dict)


@dataclass(slots=True)
class StructureResult:
    """Output of StructurePredictor.predict."""

    descriptor: StructureDescriptor
    model: ModelIdentity
    files: list[ProviderFile] = field(default_factory=list)
    sequences: list[ChainInput] = field(default_factory=list)
    parameters: dict[str, Any] = field(default_factory=dict)
    confidence_samples: list[ConfidenceSample] = field(default_factory=list)
    ranking_metric: str | None = None
    plddt_per_residue: list[float] | None = None
    source_datasets: list[DatasetVersion] = field(default_factory=list)
    database_identifiers: list[str] = field(default_factory=list)
    argv: list[str] | None = None
    exit_code: int | None = None
    provider_native: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BindingResult:
    """Output of BindingPredictor.predict. Metrics keep the provider's own names and units."""

    model: ModelIdentity
    metrics: dict[str, Any]
    metric_units: dict[str, str] = field(default_factory=dict)
    structure: StructureResult | None = None
    confidence: ConfidenceSummary | None = None
    files: list[ProviderFile] = field(default_factory=list)
    parameters: dict[str, Any] = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    provider_native: dict[str, Any] = field(default_factory=dict)


class VariantEffectScore(Schema):
    """One source-native score. Never combined with scores from another source."""

    name: str
    value: float | str | None
    unit: str | None = None
    classification: str | None = Field(default=None, description="Class label as the source states it")
    scheme: str | None = None


class VariantEffectResult(Schema):
    scores: list[VariantEffectScore] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    sources: list[SourceStatus] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class PocketResidue(Schema):
    chain: str
    position: int = Field(description="UniProt canonical position")
    residue: str | None = None


class Pocket(Schema):
    id: str
    rank: int
    residues: list[PocketResidue]
    score: float | None = None
    score_name: str | None = None
    volume: float | None = None
    center: tuple[float, float, float] | None = None
    provider_native: dict[str, Any] = Field(default_factory=dict)


class PocketResult(Schema):
    pockets: list[Pocket] = Field(default_factory=list)
    model: ModelIdentity | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class Publication(Schema):
    pmid: str | None = None
    pmcid: str | None = None
    doi: str | None = None
    title: str
    journal: str | None = None
    year: int | None = None
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = Field(default=None, description="Fetched live; never stored in the seed")
    url: str | None = None
    is_open_access: bool | None = None
    relevance: dict[str, Any] = Field(default_factory=dict, description="Why it matched, in source terms")


class LiteratureResult(Schema):
    publications: list[Publication] = Field(default_factory=list)
    total: int | None = None
    sources: list[SourceStatus] = Field(default_factory=list)


# Interfaces


class Provider(ABC):
    """Common base. Subclass one of the five interfaces below, set the class attributes and
    decorate the class with @register_provider."""

    id: ClassVar[str]
    name: ClassVar[str]
    kind: ClassVar[ProviderKind]
    model_name: ClassVar[str | None] = None
    model_version: ClassVar[str | None] = None
    license: ClassVar[str | None] = None
    license_url: ClassVar[str | None] = None
    commercial_use: ClassVar[bool | None] = None
    capabilities: ClassVar[tuple[str, ...]] = ()
    execution_mode: ClassVar[ExecutionMode]
    structure_origin: ClassVar[StructureOrigin | None] = None
    max_residues: ClassVar[int | None] = None
    requires_api_key: ClassVar[bool] = False
    requires_gpu: ClassVar[bool] = False
    limitations: ClassVar[tuple[str, ...]] = ()
    citation: ClassVar[tuple[Citation, ...]] = ()
    attribution: ClassVar[str | None] = None
    homepage: ClassVar[str | None] = None
    job_kinds: ClassVar[tuple[str, ...]] = ()

    async def check_availability(self) -> Availability:
        """Whether the provider can run on this deployment, with the reason. Override to check an
        executable, an API key or the reachability of a remote service."""
        return Availability(available=True, reason="Ready.")

    async def current_model_version(self) -> str | None:
        """Model version to report. Override when it is only known at runtime."""
        return self.model_version

    async def _checked_availability(self) -> Availability:
        """A check that raises is reported as unavailable instead of breaking the listing."""
        try:
            return await self.check_availability()
        except Exception as error:
            logger.exception("Availability check of provider %s failed", self.id)
            return Availability(
                available=False, reason=f"The availability check failed ({type(error).__name__})."
            )

    async def describe(self) -> ProviderInfo:
        availability = await self._checked_availability()
        return ProviderInfo(
            id=self.id,
            name=self.name,
            kind=self.kind,
            model_name=self.model_name,
            model_version=await self.current_model_version(),
            license=self.license,
            license_url=self.license_url,
            commercial_use=self.commercial_use,
            capabilities=[str(capability) for capability in self.capabilities],
            execution_mode=self.execution_mode,
            performs_inference=self.execution_mode is not ExecutionMode.RETRIEVAL,
            structure_origin=self.structure_origin,
            max_residues=self.max_residues,
            requires_api_key=self.requires_api_key,
            requires_gpu=self.requires_gpu,
            availability=availability,
            limitations=list(self.limitations),
            citation=list(self.citation),
            attribution=self.attribution,
            homepage=self.homepage,
            job_kinds=list(self.job_kinds),
        )


class StructurePredictor(Provider):
    """predict(sequence | complex) -> prediction."""

    kind = ProviderKind.STRUCTURE_PREDICTOR

    def plan(self, request: StructureRequest) -> list[StageSpec]:
        """Stages predict will really enter, in order. The job handler declares them up front."""
        return [StageSpec(id="run_model", label="Running model")]

    @abstractmethod
    async def predict(self, request: StructureRequest, context: RunContext) -> StructureResult: ...


class BindingPredictor(Provider):
    """predict(protein, ligand) -> interaction prediction."""

    kind = ProviderKind.BINDING_PREDICTOR

    def plan(self, request: BindingRequest) -> list[StageSpec]:
        return [StageSpec(id="run_model", label="Running model")]

    @abstractmethod
    async def predict(self, request: BindingRequest, context: RunContext) -> BindingResult: ...


class VariantEffectProvider(Provider):
    """analyze(reference, mutation) -> effect data."""

    kind = ProviderKind.VARIANT_EFFECT

    @abstractmethod
    async def analyze(self, request: VariantEffectRequest, context: RunContext) -> VariantEffectResult: ...


class PocketProvider(Provider):
    """find(structure) -> pockets."""

    kind = ProviderKind.POCKET

    @abstractmethod
    async def find(self, request: PocketRequest, context: RunContext) -> PocketResult: ...


class LiteratureProvider(Provider):
    """search(entity) -> publications."""

    kind = ProviderKind.LITERATURE

    @abstractmethod
    async def search(self, request: LiteratureRequest, context: RunContext) -> LiteratureResult: ...


# Registry

_providers: dict[str, Provider] = {}


def register_provider[P: type[Provider]](provider_class: P) -> P:
    """Class decorator: instantiate the provider and add it to the registry under its id."""
    provider = provider_class()
    existing = _providers.get(provider.id)
    if existing is not None and type(existing) is not provider_class:
        raise ValueError(f"provider id {provider.id!r} is already registered by {type(existing).__name__}")
    _providers[provider.id] = provider
    return provider_class


def get_provider(provider_id: str) -> Provider | None:
    return _providers.get(provider_id)


def all_providers() -> list[Provider]:
    return sorted(_providers.values(), key=lambda provider: provider.id)


def providers_of_kind(kind: ProviderKind) -> list[Provider]:
    return [provider for provider in all_providers() if provider.kind is kind]


def load_providers() -> None:
    """Import every module in orphafold.providers so that each registers itself."""
    from orphafold.plugins import import_submodules

    import_submodules("orphafold.providers")
