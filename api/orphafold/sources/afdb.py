"""AlphaFold Protein Structure Database: retrieval of existing predicted models.

Rules from docs/research/structure-models.md section 6.2: the prediction endpoint returns an array
that is not canonical-first, so the canonical model is the entry whose uniprotAccession equals the
requested accession exactly; file URLs are read from the response and never constructed; a 404
means no model exists.
"""

from dataclasses import replace
from datetime import datetime
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from orphafold.hashing import md5_hex
from orphafold.identifiers import is_uniprot_accession, structure_id
from orphafold.schemas.common import (
    ConfidenceSummary,
    PlddtFractions,
    Provenance,
    ResidueRange,
    SourceState,
    StructureCoverage,
    StructureDescriptor,
    StructureFiles,
    StructureOrigin,
)
from orphafold.sources.base import SourceAdapter, SourceResult

MUTATION_CAVEAT = (
    "AlphaFold has not been validated for predicting the effect of mutations. In particular, AlphaFold "
    "is not expected to produce an unfolded protein structure given a sequence containing a "
    "destabilising point mutation."
)
CLINICAL_DISCLAIMER = (
    "The AlphaFold and AlphaMissense Data have not been validated for, and are not approved for, "
    "any clinical use."
)
PLDDT_SCOPE = (
    "pLDDT is a per-residue local confidence estimate. It says nothing about the relative placement "
    "of domains; a confident domain arrangement needs low inter-domain PAE."
)
LOW_CONFIDENCE_NOTE = (
    "Regions with pLDDT below 50 often have a ribbon-like appearance and should not be interpreted."
)
MODEL_LIMITATIONS = [PLDDT_SCOPE, LOW_CONFIDENCE_NOTE, MUTATION_CAVEAT, CLINICAL_DISCLAIMER]

# confidenceCategory codes in the pLDDT document
_CATEGORY_BANDS = {"D": "very_low", "L": "low", "M": "confident", "H": "very_high"}


class AfdbEntry(BaseModel):
    """One model of the /prediction response. Unknown fields are kept in `raw`."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    entry_id: str = Field(validation_alias=AliasChoices("modelEntityId", "entryId"))
    uniprot_accession: str = Field(validation_alias="uniprotAccession")
    uniprot_id: str | None = Field(default=None, validation_alias="uniprotId")
    gene: str | None = None
    description: str | None = Field(default=None, validation_alias="uniprotDescription")
    tax_id: int | None = Field(default=None, validation_alias="taxId")
    organism: str | None = Field(default=None, validation_alias="organismScientificName")
    tool_used: str | None = Field(default=None, validation_alias="toolUsed")
    provider_id: str | None = Field(default=None, validation_alias="providerId")
    latest_version: int | None = Field(default=None, validation_alias="latestVersion")
    model_created_date: datetime | None = Field(default=None, validation_alias="modelCreatedDate")
    sequence: str = Field(validation_alias=AliasChoices("sequence", "uniprotSequence"))
    sequence_start: int = Field(validation_alias=AliasChoices("sequenceStart", "uniprotStart"))
    sequence_end: int = Field(validation_alias=AliasChoices("sequenceEnd", "uniprotEnd"))
    sequence_checksum: str | None = Field(default=None, validation_alias="sequenceChecksum")
    global_metric_value: float | None = Field(default=None, validation_alias="globalMetricValue")
    fraction_plddt_very_low: float | None = Field(default=None, validation_alias="fractionPlddtVeryLow")
    fraction_plddt_low: float | None = Field(default=None, validation_alias="fractionPlddtLow")
    fraction_plddt_confident: float | None = Field(default=None, validation_alias="fractionPlddtConfident")
    fraction_plddt_very_high: float | None = Field(default=None, validation_alias="fractionPlddtVeryHigh")
    is_complex: bool = Field(default=False, validation_alias="isComplex")
    cif_url: str | None = Field(default=None, validation_alias="cifUrl")
    bcif_url: str | None = Field(default=None, validation_alias="bcifUrl")
    pdb_url: str | None = Field(default=None, validation_alias="pdbUrl")
    plddt_doc_url: str | None = Field(default=None, validation_alias="plddtDocUrl")
    pae_doc_url: str | None = Field(default=None, validation_alias="paeDocUrl")
    pae_image_url: str | None = Field(default=None, validation_alias="paeImageUrl")
    am_annotations_url: str | None = Field(default=None, validation_alias="amAnnotationsUrl")
    raw: dict[str, Any] = Field(default_factory=dict, exclude=True)

    @property
    def version_label(self) -> str | None:
        return f"v{self.latest_version}" if self.latest_version is not None else None

    @property
    def checksum_matches(self) -> bool | None:
        """Whether sequenceChecksum equals the MD5 of the sequence. None when no checksum is given."""
        if not self.sequence_checksum:
            return None
        return md5_hex(self.sequence) == self.sequence_checksum.lower()


class AfdbSelection(BaseModel):
    """Canonical model for an accession, with isoform models listed separately."""

    accession: str
    canonical: AfdbEntry | None
    isoforms: list[AfdbEntry] = Field(default_factory=list)


class PlddtProfile(BaseModel):
    """Per-residue pLDDT (0-100) from the AFDB confidence document."""

    residue_numbers: list[int]
    scores: list[float]
    categories: list[str]

    @property
    def mean(self) -> float | None:
        return sum(self.scores) / len(self.scores) if self.scores else None

    @property
    def fractions(self) -> PlddtFractions | None:
        """Band shares from the confidenceCategory the source supplies for each residue."""
        if not self.categories:
            return None
        counts = dict.fromkeys(_CATEGORY_BANDS.values(), 0)
        for category in self.categories:
            band = _CATEGORY_BANDS.get(category)
            if band is None:
                return None
            counts[band] += 1
        total = len(self.categories)
        return PlddtFractions(**{band: round(count / total, 4) for band, count in counts.items()})


def _parse_entries(payload: Any) -> list[AfdbEntry]:
    entries = []
    for item in payload:
        entry = AfdbEntry.model_validate(item)
        entry.raw = item
        entries.append(entry)
    return entries


class AlphaFoldDBSource(SourceAdapter):
    id = "afdb"
    name = "AlphaFold DB"
    base_url = "https://alphafold.ebi.ac.uk/api"
    homepage = "https://alphafold.ebi.ac.uk"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    attribution = "AlphaFold Protein Structure Database (EMBL-EBI / Google DeepMind), CC-BY-4.0"
    timeout = 20.0
    empty_statuses = frozenset({204, 404})

    def record_url(self, record_id: str) -> str | None:
        return f"https://alphafold.ebi.ac.uk/entry/{record_id}"

    def extract_release(self, headers: Any, payload: Any) -> str | None:
        """AFDB reports its version per model: latestVersion of the first entry in the response."""
        if isinstance(payload, list) and payload and isinstance(payload[0], dict):
            version = payload[0].get("latestVersion")
            if version is not None:
                return f"v{version}"
        return None

    async def predictions(self, accession: str, *, ttl: int | None = None) -> SourceResult[list[AfdbEntry]]:
        """Every non-complex model for a UniProt accession, in the order the API returns them."""
        accession = accession.strip().upper()
        if not is_uniprot_accession(accession):
            return self.result(SourceState.EMPTY, message=f"{accession} is not a UniProt accession.")
        raw = await self.get_json(
            f"/prediction/{accession}",
            params={"include_complexes": "false"},
            record_id=accession,
            record_url=f"https://alphafold.ebi.ac.uk/search/text/{accession}",
            ttl=ttl,
        )
        return raw.map(lambda payload: [entry for entry in _parse_entries(payload) if not entry.is_complex])

    async def model(self, accession: str, *, ttl: int | None = None) -> SourceResult[AfdbSelection]:
        """The canonical model: the entry whose uniprotAccession equals the accession exactly.

        State is 'empty' when AFDB has no canonical model. Isoform models, when present, are
        listed in data.isoforms and are never substituted for the canonical one.
        """
        accession = accession.strip().upper()
        result = await self.predictions(accession, ttl=ttl)
        if not result.ok or result.data is None:
            message = result.message
            if result.is_empty and message is None:
                message = "No AlphaFold DB model (sequence outside 16-2,700 aa or not covered)."
            return replace(result, data=None, message=message)  # type: ignore[arg-type]
        entries = result.data
        canonical = next((entry for entry in entries if entry.uniprot_accession == accession), None)
        isoforms = [entry for entry in entries if entry.uniprot_accession != accession]
        selection = AfdbSelection(accession=accession, canonical=canonical, isoforms=isoforms)
        if canonical is None:
            listed = ", ".join(entry.entry_id for entry in isoforms)
            return replace(  # type: ignore[arg-type]
                result,
                state=SourceState.EMPTY,
                data=selection,
                message=f"No AlphaFold DB model for the canonical sequence of {accession}. "
                f"Isoform models exist: {listed}.",
            )
        selected = replace(result, data=selection)  # type: ignore[arg-type]
        return selected.with_record(canonical.entry_id, self.record_url(canonical.entry_id))

    async def file(self, url: str, entry_id: str) -> SourceResult[bytes]:
        """Download a model file from a URL given in the prediction response."""
        return await self.get_bytes(url, record_id=entry_id)

    async def plddt(self, entry: AfdbEntry) -> SourceResult[PlddtProfile]:
        if not entry.plddt_doc_url:
            return self.result(
                SourceState.EMPTY, message="AlphaFold DB lists no pLDDT document for this model."
            )
        raw = await self.get_json(entry.plddt_doc_url, record_id=entry.entry_id)
        return raw.map(
            lambda payload: PlddtProfile(
                residue_numbers=payload["residueNumber"],
                scores=payload["confidenceScore"],
                categories=payload.get("confidenceCategory", []),
            )
        )

    async def pae(self, entry: AfdbEntry) -> SourceResult[dict[str, Any]]:
        """PAE document: {predicted_aligned_error: [[...]], max_predicted_aligned_error: float}."""
        if not entry.pae_doc_url:
            return self.result(
                SourceState.EMPTY, message="AlphaFold DB lists no PAE document for this model."
            )
        raw = await self.get_json(entry.pae_doc_url, record_id=entry.entry_id)
        return raw.map(lambda payload: payload[0] if isinstance(payload, list) else payload)

    def descriptor(
        self,
        entry: AfdbEntry,
        provenance: Provenance | None = None,
        *,
        plddt: PlddtProfile | None = None,
        pae_max: float | None = None,
        warnings: list[str] | None = None,
    ) -> StructureDescriptor:
        """StructureDescriptor of an AFDB model: origin predicted_external, files as AFDB lists them."""
        fractions = plddt.fractions if plddt else None
        if fractions is None and entry.fraction_plddt_very_high is not None:
            fractions = PlddtFractions(
                very_low=entry.fraction_plddt_very_low or 0.0,
                low=entry.fraction_plddt_low or 0.0,
                confident=entry.fraction_plddt_confident or 0.0,
                very_high=entry.fraction_plddt_very_high,
            )
        covered = entry.sequence_end - entry.sequence_start + 1
        return StructureDescriptor(
            id=structure_id("afdb", entry.entry_id),
            origin=StructureOrigin.PREDICTED_EXTERNAL,
            title=entry.description,
            provider=self.id,
            provider_name=self.name,
            source_id=entry.entry_id,
            source_url=self.record_url(entry.entry_id),
            model_name=entry.tool_used,
            model_version=entry.version_label,
            method=entry.tool_used,
            resolution=None,
            coverage=StructureCoverage(
                uniprot_accession=entry.uniprot_accession,
                ranges=[ResidueRange(start=entry.sequence_start, end=entry.sequence_end, chain="A")],
                covered_residues=covered,
                sequence_length=len(entry.sequence),
                fraction=covered / len(entry.sequence) if entry.sequence else None,
            ),
            confidence=ConfidenceSummary(
                plddt_mean=entry.global_metric_value,
                plddt_native_scale="0-100",
                plddt_fractions=fractions,
                pae_available=bool(entry.pae_doc_url),
                pae_max=pae_max,
                provider_native={
                    key: entry.raw[key]
                    for key in (
                        "globalMetricValue",
                        "fractionPlddtVeryLow",
                        "fractionPlddtLow",
                        "fractionPlddtConfident",
                        "fractionPlddtVeryHigh",
                    )
                    if key in entry.raw
                },
            ),
            license=self.license,
            attribution=self.attribution,
            files=StructureFiles(
                cif_url=entry.cif_url,
                bcif_url=entry.bcif_url,
                pdb_url=entry.pdb_url,
                plddt_url=entry.plddt_doc_url,
                pae_url=entry.pae_doc_url,
                pae_image_url=entry.pae_image_url,
            ),
            created_date=entry.model_created_date.date() if entry.model_created_date else None,
            retrieved_at=provenance.retrieved_at if provenance else None,
            limitations=list(MODEL_LIMITATIONS),
            warnings=list(warnings or []),
            provenance=provenance,
        )


afdb = AlphaFoldDBSource()
