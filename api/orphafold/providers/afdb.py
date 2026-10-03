"""AlphaFold DB provider: retrieval of an existing predicted model.

This is lookup, never inference. Structures it returns carry origin predicted_external.
"""

import asyncio
import time
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlsplit

import gemmi

from orphafold.hashing import md5_hex
from orphafold.knowledge.catalog import get_catalog
from orphafold.providers.base import (
    Availability,
    Capability,
    ChainInput,
    ConfidenceSample,
    DatasetVersion,
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
from orphafold.schemas.common import Citation, SourceState, StructureOrigin
from orphafold.schemas.jobs import ArtifactRole, StageSpec
from orphafold.sources.afdb import MODEL_LIMITATIONS, AfdbEntry, PlddtProfile, afdb
from orphafold.sources.base import SourceResult

AVAILABILITY_TTL_SECONDS = 300.0

RETRIEVAL_NOTE = (
    "Retrieval of a precomputed model from AlphaFold DB. This is lookup, never inference: "
    "OrphaFold ran no model."
)
COVERAGE_NOTE = (
    "AlphaFold DB covers sequences of 16 to 2,700 amino acids for proteomes and Swiss-Prot, and up "
    "to 1,280 for the rest of UniProt. Sequences with non-standard residues are excluded, and long "
    "proteins can have isoform models only."
)

STAGE_RESOLVE = "resolve_model"
STAGE_DOWNLOAD = "download_files"
STAGE_VERIFY = "verify_model"
STAGE_CONFIDENCE = "read_confidence"


def _file_name(url: str) -> str:
    return PurePosixPath(urlsplit(url).path).name


def _inspect_model(cif_text: str) -> dict[str, Any]:
    """Read the coordinates: residue count, one-letter sequence and mean B-factor of CA atoms
    (AFDB stores pLDDT in the B-factor column)."""
    block = gemmi.cif.read_string(cif_text).sole_block()
    structure = gemmi.make_structure_from_block(block)
    if len(structure) == 0:
        raise ValueError("the mmCIF file contains no model")
    model = structure[0]
    names: list[str] = []
    ca_b_factors: list[float] = []
    chains = 0
    for chain in model:
        chains += 1
        for residue in chain:
            names.append(residue.name)
            atom = residue.find_atom("CA", "*")
            if atom is not None:
                ca_b_factors.append(atom.b_iso)
    return {
        "chains": chains,
        "residues": len(names),
        "sequence": gemmi.one_letter_code(names).upper(),
        "ca_b_factor_mean": sum(ca_b_factors) / len(ca_b_factors) if ca_b_factors else None,
    }


@register_provider
class AlphaFoldDBProvider(StructurePredictor):
    id = "afdb"
    name = "AlphaFold DB"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    commercial_use = True
    capabilities = (Capability.MONOMER, Capability.PLDDT, Capability.PAE)
    execution_mode = ExecutionMode.RETRIEVAL
    structure_origin = StructureOrigin.PREDICTED_EXTERNAL
    limitations = (RETRIEVAL_NOTE, COVERAGE_NOTE, *MODEL_LIMITATIONS)
    citation = (
        Citation(text="Jumper J et al., Nature (2021)"),
        Citation(text="Fleming J et al., J Mol Biol (2025)"),
        Citation(text="Bertoni D et al., Nucleic Acids Res (2025)"),
    )
    attribution = "AlphaFold Data Copyright (2022) DeepMind Technologies Limited. " + (afdb.attribution or "")
    homepage = afdb.homepage
    job_kinds = ("structure_retrieval",)

    def __init__(self) -> None:
        self._observed_tool: str | None = None
        self._observed_version: str | None = None
        self._availability: Availability | None = None
        self._availability_checked = 0.0

    def _observe(self, entry: AfdbEntry) -> None:
        self._observed_tool = entry.tool_used or self._observed_tool
        self._observed_version = entry.version_label or self._observed_version

    async def check_availability(self) -> Availability:
        """Ask AlphaFold DB for one catalog protein, at most every five minutes. No key is needed,
        so the provider is unavailable only when the service does not answer."""
        if self._availability and time.monotonic() - self._availability_checked < AVAILABILITY_TTL_SECONDS:
            return self._availability
        catalog = get_catalog()
        probe = next(
            (
                gene.uniprot_accession
                for gene in catalog.genes
                if gene.uniprot_accession and gene.stats.has_alphafold_model
            ),
            None,
        )
        if probe is None:
            # No catalog protein to ask for: the API description still shows the service answers
            result = await afdb.get_json("/openapi.json", ttl=0)
            answered = "AlphaFold DB API answered."
        else:
            result = await afdb.predictions(probe, ttl=0)
            answered = f"AlphaFold DB answered a lookup of {probe}."
            for entry in result.data or []:
                self._observe(entry)
        if result.state is SourceState.UNAVAILABLE:
            availability = Availability(
                available=False, reason=result.message or "AlphaFold DB did not answer."
            )
        else:
            availability = Availability(available=True, reason=f"{answered} No key or GPU required.")
        self._availability = availability
        self._availability_checked = time.monotonic()
        return availability

    async def current_model_version(self) -> str | None:
        return self._observed_version

    async def describe(self):
        info = await super().describe()
        info.model_name = self._observed_tool
        info.model_version = self._observed_version
        return info

    def plan(self, request: StructureRequest) -> list[StageSpec]:
        return [
            StageSpec(id=STAGE_RESOLVE, label="Querying AlphaFold DB"),
            StageSpec(id=STAGE_DOWNLOAD, label="Downloading model files"),
            StageSpec(id=STAGE_VERIFY, label="Verifying sequence and coordinates"),
            StageSpec(id=STAGE_CONFIDENCE, label="Reading confidence"),
        ]

    async def _download(self, url: str, entry: AfdbEntry) -> SourceResult[bytes]:
        return await afdb.file(url, entry.entry_id)

    async def predict(self, request: StructureRequest, context: RunContext) -> StructureResult:
        accession = (request.uniprot_accession or "").strip().upper()
        if not accession:
            raise ProviderError("invalid_input", "AlphaFold DB retrieval needs a UniProt accession.")
        warnings: list[str] = []

        async with context.stage(STAGE_RESOLVE):
            selection = await afdb.model(accession)
            if selection.state is SourceState.UNAVAILABLE:
                raise ProviderError("source_unavailable", selection.message or "AlphaFold DB did not answer.")
            if not selection.ok or selection.data is None or selection.data.canonical is None:
                isoforms = [entry.entry_id for entry in selection.data.isoforms] if selection.data else []
                raise ProviderError(
                    "not_available",
                    selection.message or f"No AlphaFold DB model for {accession}.",
                    {"uniprot_accession": accession, "isoform_models": isoforms},
                )
            entry = selection.data.canonical
            provenance = selection.provenance
            self._observe(entry)
            await context.log(
                f"Selected {entry.entry_id} ({entry.version_label}), residues "
                f"{entry.sequence_start}-{entry.sequence_end}, by exact accession match.",
                entry_id=entry.entry_id,
                isoform_models=[isoform.entry_id for isoform in selection.data.isoforms],
            )

        async with context.stage(STAGE_DOWNLOAD):
            if not entry.cif_url:
                raise ProviderError(
                    "not_available", f"AlphaFold DB lists no mmCIF file for {entry.entry_id}."
                )
            wanted: list[tuple[str, ArtifactRole, str, bool]] = [
                (entry.cif_url, ArtifactRole.STRUCTURE, "chemical/x-mmcif", True),
            ]
            if entry.bcif_url:
                wanted.append((entry.bcif_url, ArtifactRole.STRUCTURE, "application/octet-stream", False))
            if entry.plddt_doc_url:
                wanted.append((entry.plddt_doc_url, ArtifactRole.PLDDT, "application/json", False))
            if entry.pae_doc_url:
                wanted.append((entry.pae_doc_url, ArtifactRole.PAE, "application/json", False))

            files: list[ProviderFile] = []
            contents: dict[ArtifactRole, bytes] = {}
            for index, (url, role, media_type, required) in enumerate(wanted, start=1):
                await context.check_cancelled()
                fetched = await self._download(url, entry)
                if fetched.is_empty and required:
                    # A 404 on a listed file means the version rolled: ask the API again, once
                    await context.log("Model file not found; re-querying AlphaFold DB.", level="warning")
                    refreshed = await afdb.model(accession, ttl=0)
                    if (
                        refreshed.ok
                        and refreshed.data
                        and refreshed.data.canonical
                        and refreshed.data.canonical.cif_url
                    ):
                        entry = refreshed.data.canonical
                        provenance = refreshed.provenance
                        url = entry.cif_url
                        fetched = await self._download(url, entry)
                if not fetched.ok or fetched.data is None:
                    if required:
                        raise ProviderError(
                            "source_unavailable",
                            fetched.message or f"AlphaFold DB did not return {_file_name(url)}.",
                        )
                    warnings.append(f"afdb_file_missing:{_file_name(url)}")
                    await context.log(f"{_file_name(url)} could not be downloaded.", level="warning")
                else:
                    files.append(
                        ProviderFile(
                            name=_file_name(url),
                            role=role,
                            media_type=media_type,
                            content=fetched.data,
                            structure_origin=StructureOrigin.PREDICTED_EXTERNAL
                            if role is ArtifactRole.STRUCTURE
                            else None,
                            sample_index=0 if role is ArtifactRole.STRUCTURE else None,
                            source_url=url,
                        )
                    )
                    if media_type != "application/octet-stream":
                        contents[role] = fetched.data
                await context.progress(index, len(wanted), unit="files")

        async with context.stage(STAGE_VERIFY):
            checksum_matches = entry.checksum_matches
            if checksum_matches is False:
                warnings.append("afdb_checksum_mismatch")
                await context.log("sequenceChecksum does not equal the MD5 of the sequence.", level="warning")
            expected_md5 = request.parameters.get("expected_sequence_md5")
            if expected_md5 and expected_md5.lower() != md5_hex(entry.sequence):
                warnings.append("afdb_sequence_differs_from_uniprot")
                await context.log(
                    "The modelled sequence differs from the current UniProt canonical sequence.",
                    level="warning",
                )
            try:
                inspection = await asyncio.to_thread(
                    _inspect_model, contents[ArtifactRole.STRUCTURE].decode("utf-8")
                )
            except Exception as error:
                raise ProviderError(
                    "invalid_model_file", f"The mmCIF file could not be read: {error}"
                ) from error
            if inspection["sequence"] != entry.sequence:
                raise ProviderError(
                    "invalid_model_file",
                    "The coordinates do not match the sequence AlphaFold DB reports for this model.",
                    {"residues_in_file": inspection["residues"], "sequence_length": len(entry.sequence)},
                )
            await context.log(
                f"Coordinates match the reported sequence: {inspection['residues']} residues, "
                f"{inspection['chains']} chain.",
            )

        profile: PlddtProfile | None = None
        pae_max: float | None = None
        metrics: dict[str, Any] = {
            key: entry.raw[key]
            for key in (
                "globalMetricValue",
                "fractionPlddtVeryLow",
                "fractionPlddtLow",
                "fractionPlddtConfident",
                "fractionPlddtVeryHigh",
            )
            if key in entry.raw
        }
        async with context.stage(STAGE_CONFIDENCE):
            if ArtifactRole.PLDDT in contents:
                document = await afdb.plddt(entry)
                profile = document.data if document.ok else None
            if profile is not None:
                if len(profile.scores) != inspection["residues"]:
                    warnings.append("afdb_plddt_length_mismatch")
                metrics["plddt_mean_per_residue"] = (
                    round(profile.mean, 2) if profile.mean is not None else None
                )
            else:
                warnings.append("afdb_plddt_unavailable")
            if inspection["ca_b_factor_mean"] is not None:
                metrics["plddt_mean_ca_b_factor"] = round(inspection["ca_b_factor_mean"], 2)
            if ArtifactRole.PAE in contents:
                pae_document = await afdb.pae(entry)
                if pae_document.ok and pae_document.data:
                    pae_max = pae_document.data.get("max_predicted_aligned_error")
                    matrix = pae_document.data.get("predicted_aligned_error") or []
                    metrics["pae_max"] = pae_max
                    metrics["pae_matrix_size"] = len(matrix)
            else:
                warnings.append("afdb_pae_unavailable")
            mean_text = (
                f"{entry.global_metric_value:g}" if entry.global_metric_value is not None else "not reported"
            )
            await context.log(
                f"Mean pLDDT {mean_text}; PAE cap {pae_max if pae_max is not None else 'not provided'}."
            )

        descriptor = afdb.descriptor(entry, provenance, plddt=profile, pae_max=pae_max, warnings=warnings)
        descriptor.limitations = [RETRIEVAL_NOTE, *descriptor.limitations]
        version = entry.version_label or "unknown"
        return StructureResult(
            descriptor=descriptor,
            model=ModelIdentity(
                provider=self.id,
                name=entry.tool_used or "AlphaFold DB model",
                version=version,
                license=self.license or "",
                execution_mode=self.execution_mode,
            ),
            files=files,
            sequences=[
                ChainInput(
                    entity_id="A",
                    sequence=entry.sequence,
                    uniprot_accession=entry.uniprot_accession,
                    residue_start=entry.sequence_start,
                )
            ],
            parameters={
                "uniprot_accession": accession,
                "include_complexes": False,
                "selection": "exact_accession",
            },
            confidence_samples=[
                ConfidenceSample(sample_index=0, structure_file=_file_name(entry.cif_url), metrics=metrics)
            ],
            plddt_per_residue=profile.scores if profile else None,
            source_datasets=[
                DatasetVersion(
                    name=afdb.name,
                    version=version,
                    retrieved_at=provenance.retrieved_at if provenance else None,
                    license=afdb.license,
                    url=provenance.request_url if provenance else afdb.base_url,
                )
            ],
            database_identifiers=[f"uniprot:{entry.uniprot_accession}", f"afdb:{entry.entry_id}"],
            provider_native=entry.raw,
        )
