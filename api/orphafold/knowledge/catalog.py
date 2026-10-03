"""Seeded catalog: data/seed/catalog.json loaded into an in-memory index.

The API starts cleanly without the file. Catalog.status says whether the catalog is ready, missing,
still being generated or invalid, and the file is picked up as soon as it appears or changes.
A null in the seed means the source had no value; nothing here substitutes a guess.
"""

import json
import time
from collections import defaultdict
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError

from orphafold.config import get_settings
from orphafold.log import get_logger
from orphafold.schemas.common import EntityRef, EntityType, SourceState, SourceStatus

logger = get_logger(__name__)

SEED_SOURCE_ID = "orphafold_seed"
SEED_SOURCE_NAME = "OrphaFold seeded catalog"
RELOAD_CHECK_SECONDS = 2.0
PARTIAL_MARKERS = ("catalog.json.tmp", "catalog.json.partial", "catalog.json.part", ".building")
RECENT_WRITE_SECONDS = 120.0


def _to_text(value: Any) -> Any:
    return str(value) if isinstance(value, int) else value


Text = Annotated[str, BeforeValidator(_to_text)]


class SeedModel(BaseModel):
    model_config = ConfigDict(extra="ignore", json_schema_serialization_defaults_required=True)


class SeedSource(SeedModel):
    id: str
    name: str | None = None
    url: str | None = None
    release: str | None = None
    license: str | None = None
    retrieved_at: str | None = None
    sha256: str | None = None


class SeedCounts(SeedModel):
    entries: int | None = None
    diseases: int | None = None
    genes: int | None = None
    genes_with_uniprot: int | None = None
    categories: int | None = None


class SeedManifest(SeedModel):
    generated_at: str | None = None
    dataset: str | None = None
    citation: str | None = None
    doi: str | None = None
    counts: SeedCounts = Field(default_factory=SeedCounts)
    sources: list[SeedSource] = Field(default_factory=list)


class SeedSubcategory(SeedModel):
    id: str
    name: str


class SeedCategory(SeedModel):
    id: str
    table: int | None = None
    name: str
    subcategories: list[SeedSubcategory] = Field(default_factory=list)


class SeedTerm(SeedModel):
    id: str
    label: str | None = None


class SeedInheritance(SeedModel):
    raw: str | None = None
    codes: list[str] = Field(default_factory=list)
    hpo: list[SeedTerm] = Field(default_factory=list)


class SeedXrefs(SeedModel):
    mondo: list[Text] = Field(default_factory=list)
    orphanet: list[Text] = Field(default_factory=list)
    omim: list[Text] = Field(default_factory=list)


class SeedDefinition(SeedModel):
    text: str
    source_id: str | None = None
    url: str | None = None


class SeedPhenotype(SeedModel):
    hpo_id: str
    label: str | None = None
    frequency: str | None = None
    source_id: str | None = None


class SeedProvenance(SeedModel):
    source_id: str
    record_id: Text | None = None
    url: str | None = None


class SeedDisease(SeedModel):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    gene_symbol: str | None = None
    hgnc_id: str | None = None
    category_id: str | None = None
    subcategory_id: str | None = None
    inheritance: SeedInheritance = Field(default_factory=SeedInheritance)
    mechanism: list[str] = Field(default_factory=list)
    is_phenocopy: bool = False
    xrefs: SeedXrefs = Field(default_factory=SeedXrefs)
    definition: SeedDefinition | None = None
    phenotypes: list[SeedPhenotype] = Field(default_factory=list)
    provenance: list[SeedProvenance] = Field(default_factory=list)


class SeedGeneStats(SeedModel):
    experimental_structure_count: int | None = None
    has_alphafold_model: bool | None = None
    clinvar_pathogenic_count: int | None = None
    clinvar_total_count: int | None = None
    publication_count: int | None = None
    retrieved_at: str | None = None


class SeedGene(SeedModel):
    symbol: str
    hgnc_id: str | None = None
    name: str | None = None
    locus_type: str | None = None
    chromosome: Text | None = None
    ensembl_gene_id: str | None = None
    ncbi_gene_id: Text | None = None
    uniprot_accession: str | None = None
    protein_name: str | None = None
    protein_length: int | None = None
    protein_family: str | None = None
    disease_ids: list[str] = Field(default_factory=list)
    stats: SeedGeneStats = Field(default_factory=SeedGeneStats)
    provenance: list[SeedProvenance] = Field(default_factory=list)


class SeedFlagshipVariant(SeedModel):
    id: str
    protein_change: str | None = None
    clinvar_vcv: str | None = None
    rsid: str | None = None
    review_status: str | None = None


class SeedFlagship(SeedModel):
    gene_symbol: str
    uniprot_accession: str | None = None
    variants: list[SeedFlagshipVariant] = Field(default_factory=list)


class CatalogState(StrEnum):
    READY = "ready"
    MISSING = "missing"
    GENERATING = "generating"
    INVALID = "invalid"


class CatalogCounts(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    diseases: int = 0
    genes: int = 0
    genes_with_uniprot: int = 0
    categories: int = 0
    subcategories: int = 0
    flagship_genes: int = 0


class CatalogStatus(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    state: CatalogState
    message: str
    path: str
    loaded_at: datetime | None = None
    file_modified_at: datetime | None = None
    generated_at: str | None = None
    dataset: str | None = None
    counts: CatalogCounts = Field(default_factory=CatalogCounts)
    skipped_records: int = 0
    problems: list[str] = Field(default_factory=list)


def normalise_alias(text: str) -> str:
    return " ".join(text.casefold().split())


class Catalog:
    """Immutable in-memory index of one catalog.json. Build with Catalog.load(path)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.manifest: SeedManifest | None = None
        self.categories: list[SeedCategory] = []
        self.diseases: list[SeedDisease] = []
        self.genes: list[SeedGene] = []
        self.flagship: list[SeedFlagship] = []
        self.status = CatalogStatus(
            state=CatalogState.MISSING,
            message="The seeded catalog has not been generated yet.",
            path=str(path),
        )
        self._genes_by_symbol: dict[str, SeedGene] = {}
        self._genes_by_hgnc: dict[str, SeedGene] = {}
        self._genes_by_uniprot: dict[str, SeedGene] = {}
        self._diseases_by_id: dict[str, SeedDisease] = {}
        self._diseases_by_gene: dict[str, list[SeedDisease]] = defaultdict(list)
        self._diseases_by_category: dict[str, list[SeedDisease]] = defaultdict(list)
        self._categories_by_id: dict[str, SeedCategory] = {}
        self._subcategories_by_id: dict[str, tuple[SeedCategory, SeedSubcategory]] = {}
        self._flagship_by_gene: dict[str, SeedFlagship] = {}
        self._aliases: dict[str, list[EntityRef]] = defaultdict(list)
        self._seed_sources: dict[str, SeedSource] = {}

    @property
    def ready(self) -> bool:
        return self.status.state is CatalogState.READY

    @property
    def release(self) -> str | None:
        """Dataset ID and build date, e.g. `iuis_2024 2026-10-03`. None until a catalog is loaded."""
        status = self.status
        if not self.ready or not status.dataset:
            return None
        built_on = status.generated_at[:10] if status.generated_at else None
        return f"{status.dataset} {built_on}" if built_on else status.dataset

    @classmethod
    def load(cls, path: Path) -> Catalog:
        catalog = cls(path)
        if not path.exists():
            if any((path.parent / marker).exists() for marker in PARTIAL_MARKERS):
                catalog.status = CatalogStatus(
                    state=CatalogState.GENERATING,
                    message="The seeded catalog is being generated.",
                    path=str(path),
                )
            return catalog

        modified_at = datetime.fromtimestamp(path.stat().st_mtime, UTC)
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(document, dict):
                raise ValueError("top level is not an object")
        except (ValueError, OSError) as error:
            recently_written = time.time() - path.stat().st_mtime < RECENT_WRITE_SECONDS
            catalog.status = CatalogStatus(
                state=CatalogState.GENERATING if recently_written else CatalogState.INVALID,
                message=(
                    "The seeded catalog is being written."
                    if recently_written
                    else f"The seeded catalog could not be read: {error}"
                ),
                path=str(path),
                file_modified_at=modified_at,
            )
            return catalog

        problems: list[str] = []
        skipped = 0

        def parse_many[M: SeedModel](key: str, model: type[M]) -> list[M]:
            nonlocal skipped
            parsed: list[M] = []
            rows = document.get(key) or []
            if not isinstance(rows, list):
                problems.append(f"{key}: expected a list")
                return parsed
            for index, row in enumerate(rows):
                try:
                    parsed.append(model.model_validate(row))
                except ValidationError as error:
                    skipped += 1
                    if len(problems) < 10:
                        first = error.errors()[0]
                        location = ".".join(str(part) for part in first["loc"])
                        problems.append(f"{key}[{index}].{location}: {first['msg']}")
            return parsed

        try:
            catalog.manifest = SeedManifest.model_validate(document.get("manifest") or {})
        except ValidationError as error:
            problems.append(f"manifest: {error.errors()[0]['msg']}")
            catalog.manifest = SeedManifest()
        catalog.categories = parse_many("categories", SeedCategory)
        catalog.diseases = parse_many("diseases", SeedDisease)
        catalog.genes = parse_many("genes", SeedGene)
        catalog.flagship = parse_many("flagship", SeedFlagship)
        catalog._build_indexes()

        counts = CatalogCounts(
            diseases=len(catalog.diseases),
            genes=len(catalog.genes),
            genes_with_uniprot=sum(1 for gene in catalog.genes if gene.uniprot_accession),
            categories=len(catalog.categories),
            subcategories=len(catalog._subcategories_by_id),
            flagship_genes=len(catalog.flagship),
        )
        if not catalog.genes and not catalog.diseases:
            state, message = CatalogState.INVALID, "The seeded catalog contains no genes or diseases."
        elif skipped:
            state, message = CatalogState.READY, f"Loaded; {skipped} malformed records were skipped."
        else:
            state, message = CatalogState.READY, "Loaded."
        catalog.status = CatalogStatus(
            state=state,
            message=message,
            path=str(path),
            loaded_at=datetime.now(UTC),
            file_modified_at=modified_at,
            generated_at=catalog.manifest.generated_at,
            dataset=catalog.manifest.dataset,
            counts=counts,
            skipped_records=skipped,
            problems=problems,
        )
        return catalog

    def _build_indexes(self) -> None:
        for source in self.manifest.sources if self.manifest else []:
            self._seed_sources[source.id] = source
        for category in self.categories:
            self._categories_by_id[category.id] = category
            for subcategory in category.subcategories:
                self._subcategories_by_id[subcategory.id] = (category, subcategory)
        for disease in self.diseases:
            self._diseases_by_id[disease.id] = disease
            if disease.gene_symbol:
                self._diseases_by_gene[disease.gene_symbol.upper()].append(disease)
            if disease.category_id:
                self._diseases_by_category[disease.category_id].append(disease)
            reference = EntityRef.of(
                EntityType.DISEASE, disease.id, disease.name, self._disease_curie(disease)
            )
            for alias in {disease.id, disease.name, *disease.aliases, *self._disease_xref_ids(disease)}:
                self._add_alias(alias, reference)
        for gene in self.genes:
            self._genes_by_symbol[gene.symbol.upper()] = gene
            if gene.hgnc_id:
                self._genes_by_hgnc[gene.hgnc_id.upper()] = gene
            reference = EntityRef.of(
                EntityType.GENE, gene.symbol, gene.name, self._curie("hgnc", gene.hgnc_id)
            )
            for alias in (gene.symbol, gene.name, gene.hgnc_id, gene.ensembl_gene_id):
                if alias:
                    self._add_alias(alias, reference)
            if gene.uniprot_accession:
                self._genes_by_uniprot[gene.uniprot_accession.upper()] = gene
                protein = EntityRef.of(
                    EntityType.PROTEIN,
                    gene.uniprot_accession,
                    gene.protein_name,
                    f"uniprot:{gene.uniprot_accession}",
                )
                for alias in (gene.uniprot_accession, gene.protein_name):
                    if alias:
                        self._add_alias(alias, protein)
        for flagship in self.flagship:
            self._flagship_by_gene[flagship.gene_symbol.upper()] = flagship

    def _add_alias(self, alias: str, reference: EntityRef) -> None:
        references = self._aliases[normalise_alias(alias)]
        if all((known.type, known.id) != (reference.type, reference.id) for known in references):
            references.append(reference)

    @staticmethod
    def _curie(prefix: str, value: str | None) -> str | None:
        if not value:
            return None
        return value.lower() if value.upper().startswith(prefix.upper() + ":") else f"{prefix}:{value}"

    @staticmethod
    def _disease_curie(disease: SeedDisease) -> str | None:
        return disease.xrefs.mondo[0] if disease.xrefs.mondo else None

    @staticmethod
    def _disease_xref_ids(disease: SeedDisease) -> list[str]:
        return [*disease.xrefs.mondo, *disease.xrefs.orphanet, *disease.xrefs.omim]

    # Lookups

    def gene(self, symbol: str) -> SeedGene | None:
        return self._genes_by_symbol.get(symbol.strip().upper())

    def gene_by_hgnc_id(self, hgnc_id: str) -> SeedGene | None:
        return self._genes_by_hgnc.get(hgnc_id.strip().upper())

    def gene_by_uniprot(self, accession: str) -> SeedGene | None:
        return self._genes_by_uniprot.get(accession.strip().upper())

    def disease(self, disease_id: str) -> SeedDisease | None:
        return self._diseases_by_id.get(disease_id.strip())

    def diseases_for_gene(self, symbol: str) -> list[SeedDisease]:
        """Diseases of a gene: those listed in gene.disease_ids, then any other entry naming it."""
        gene = self.gene(symbol)
        found: dict[str, SeedDisease] = {}
        for disease_id in gene.disease_ids if gene else []:
            disease = self._diseases_by_id.get(disease_id)
            if disease is not None:
                found[disease.id] = disease
        for disease in self._diseases_by_gene.get(symbol.strip().upper(), []):
            found.setdefault(disease.id, disease)
        return list(found.values())

    def diseases_in_category(self, category_id: str) -> list[SeedDisease]:
        return list(self._diseases_by_category.get(category_id, []))

    def category(self, category_id: str) -> SeedCategory | None:
        return self._categories_by_id.get(category_id)

    def subcategory(self, subcategory_id: str) -> tuple[SeedCategory, SeedSubcategory] | None:
        return self._subcategories_by_id.get(subcategory_id)

    def flagship_for_gene(self, symbol: str) -> SeedFlagship | None:
        return self._flagship_by_gene.get(symbol.strip().upper())

    def lookup(self, text: str) -> list[EntityRef]:
        """Exact match (case and spacing insensitive) on any name, alias, symbol or cross-reference."""
        return list(self._aliases.get(normalise_alias(text), []))

    def aliases(self) -> dict[str, list[EntityRef]]:
        """Normalised alias -> entities, for search indexes built on top of the catalog."""
        return self._aliases

    def seed_source(self, source_id: str) -> SeedSource | None:
        return self._seed_sources.get(source_id)

    def source_status(self) -> SourceStatus:
        """The catalog as a SourceStatus row for aggregated responses."""
        state = SourceState.OK if self.ready else SourceState.UNAVAILABLE
        return SourceStatus(
            source=SEED_SOURCE_ID,
            name=SEED_SOURCE_NAME,
            state=state,
            message=None if self.ready else self.status.message,
            release=self.release,
            retrieved_at=self.status.loaded_at,
        )


_catalog: Catalog | None = None
_fingerprint: tuple[float, int] | None = None
_checked_at = 0.0


def _file_fingerprint(path: Path) -> tuple[float, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (stat.st_mtime, stat.st_size)


def load_catalog(*, force: bool = False) -> Catalog:
    """Load the catalog, or reload it when the file appeared or changed."""
    global _catalog, _fingerprint, _checked_at
    path = get_settings().catalog_path
    fingerprint = _file_fingerprint(path)
    _checked_at = time.monotonic()
    waiting = _catalog is not None and _catalog.status.state in (
        CatalogState.MISSING,
        CatalogState.GENERATING,
    )
    if _catalog is None or force or fingerprint != _fingerprint or waiting:
        previous_state = _catalog.status.state if _catalog else None
        _catalog = Catalog.load(path)
        _fingerprint = fingerprint
        status = _catalog.status
        if status.state is not previous_state or status.state is CatalogState.READY:
            logger.info(
                "Catalog %s: %s (%d genes, %d diseases)",
                status.state.value,
                status.message,
                status.counts.genes,
                status.counts.diseases,
            )
    return _catalog


def get_catalog() -> Catalog:
    """Current catalog. Checks the file for changes at most every two seconds."""
    if _catalog is None or time.monotonic() - _checked_at > RELOAD_CHECK_SECONDS:
        return load_catalog()
    return _catalog
