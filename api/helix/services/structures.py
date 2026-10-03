"""Structure ledger of a protein and the per-structure views (descriptor, file, confidence,
residue map, ligands). Experimental entries, existing predictions and Helix predictions stay in
separate groups with their origin on every record."""

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from helix.artifacts.store import ArtifactStore
from helix.db.models import Actor, Artifact, GeneratedStructure
from helix.errors import BadRequest, NotFound, SourceUnavailable
from helix.evidence import try_build_evidence
from helix.hashing import sha256_hex
from helix.identifiers import is_uniprot_accession, parse_structure_id, structure_id
from helix.log import get_logger
from helix.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    EvidenceObject,
    PlddtFractions,
    Provenance,
    ResidueRange,
    SourceState,
    SourceStatus,
    StructureCoverage,
    StructureDescriptor,
    StructureFiles,
    StructureOrigin,
)
from helix.schemas.structures import (
    BindingResidue,
    BoundLigand,
    EngineeredMutations,
    ExperimentalStructure,
    ExternalModel,
    LedgerChain,
    LigandInstance,
    LigandSummary,
    PaeMatrix,
    PlddtTrack,
    RecommendedStructure,
    ResidueMap,
    ResidueMapSegment,
    StructureConfidence,
    StructureFileFormat,
    StructureLedger,
    StructureLigands,
)
from helix.sources import SourceCall, gather_sources
from helix.sources.afdb import MODEL_LIMITATIONS, AfdbEntry, afdb
from helix.sources.base import SourceResult
from helix.sources.pdbe import SiftsChain, SiftsSegment, pdbe
from helix.sources.rcsb import rcsb
from helix.sources.three_d_beacons import three_d_beacons

logger = get_logger(__name__)

API_PREFIX = "/api/v1"
MEDIA_TYPES = {"cif": "chemical/x-mmcif", "pdb": "chemical/x-pdb", "bcif": "application/octet-stream"}
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
# PDB entries can be remediated, so their files are cached long but not forever
PDB_CACHE = "public, max-age=2592000"
PDB_ID_RE = re.compile(r"^[0-9][A-Za-z0-9]{3}$")
AFDB_ENTRY_RE = re.compile(r"^AF-([A-Z0-9]+?)(?:-\d+)?-F\d+$")

# Recommended default: an experimental entry must cover at least this share of the sequence
MIN_EXPERIMENTAL_FRACTION = 0.5
RECOMMENDATION_RULE = (
    "Experimental entry ranked highest by PDBe SIFTS among those covering at least half of the "
    "UniProt sequence; otherwise the AlphaFold DB model of the canonical sequence; otherwise the "
    "highest-ranked experimental entry; otherwise the most recent Helix prediction."
)

COMMON_ADDITIVES = frozenset(
    "GOL EDO PEG PGE PG4 1PE P6G MPD SO4 PO4 ACT ACY DMS CL NA K BR IOD TRS FMT BME IPA EOH NO3 CIT "
    "MES EPE IMD SCN NH4 DTT".split()
)
PLDDT_BANDS = {"D": "very_low", "L": "low", "M": "confident", "H": "very_high"}
NEIGHBOUR_DEFINITION = (
    "Polymer residues RCSB PDB lists as neighbours of the ligand instance (rcsb_target_neighbors), "
    "with the shortest distance it reports. Mapped to UniProt numbering through the RCSB entity alignment."
)


def file_path(identifier: str, file_format: str) -> str:
    return f"{API_PREFIX}/structures/{identifier}/file?format={file_format}"


def _proxied_files(identifier: str, formats: tuple[str, ...] = ("cif", "bcif", "pdb")) -> dict[str, str]:
    return {f"{file_format}_url": file_path(identifier, file_format) for file_format in formats}


def _iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _merge_ranges(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _span_length(spans: list[tuple[int, int]]) -> int:
    return sum(end - start + 1 for start, end in _merge_ranges(spans))


def parse_id(identifier: str) -> tuple[str, str]:
    parsed = parse_structure_id(identifier)
    if parsed is None:
        raise BadRequest(
            f"'{identifier}' is not a structure ID. Use pdb:<ID>, afdb:<entryId> or of:<job_id>.",
            code="invalid_structure_id",
        )
    kind, value = parsed
    if kind == "pdb":
        if not PDB_ID_RE.match(value):
            raise BadRequest(f"'{value}' is not a PDB ID.", code="invalid_structure_id")
        value = value.upper()
    return kind, value


def _origin(kind: str) -> StructureOrigin:
    return {
        "pdb": StructureOrigin.EXPERIMENTAL,
        "afdb": StructureOrigin.PREDICTED_EXTERNAL,
        "of": StructureOrigin.PREDICTED_INTERNAL,
    }[kind]


# Experimental entries


def _citation(entry: dict[str, Any]) -> Citation | None:
    raw = entry.get("rcsb_primary_citation")
    if not raw:
        return None
    pmid = raw.get("pdbx_database_id_PubMed")
    doi = raw.get("pdbx_database_id_DOI")
    authors = raw.get("rcsb_authors") or []
    author_text = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
    parts = [part for part in (author_text, raw.get("journal_abbrev"), raw.get("year")) if part]
    return Citation(
        text=" ".join(str(part) for part in parts) or None,
        title=raw.get("title"),
        year=raw.get("year"),
        pmid=str(pmid) if pmid and pmid > 0 else None,
        doi=doi,
        url=f"https://doi.org/{doi}"
        if doi
        else (f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid and pmid > 0 else None),
    )


def _ligand_summaries(entry: dict[str, Any]) -> list[LigandSummary]:
    ligands = []
    for entity in entry.get("nonpolymer_entities") or []:
        ligands.append(LigandSummary(**_ligand_fields(entity)))
    return ligands


def _ligand_fields(entity: dict[str, Any]) -> dict[str, Any]:
    component = entity.get("nonpolymer_comp") or {}
    chem = component.get("chem_comp") or {}
    descriptor = component.get("rcsb_chem_comp_descriptor") or {}
    identifiers = entity.get("rcsb_nonpolymer_entity_container_identifiers") or {}
    comp_id = chem.get("id") or "UNKNOWN"
    return {
        "comp_id": comp_id,
        "name": chem.get("name"),
        "formula": chem.get("formula"),
        "formula_weight": chem.get("formula_weight"),
        "inchikey": descriptor.get("InChIKey"),
        "smiles": descriptor.get("SMILES"),
        "chains": identifiers.get("auth_asym_ids") or [],
        "common_additive": comp_id in COMMON_ADDITIVES,
        "url": f"https://www.rcsb.org/ligand/{comp_id}",
    }


def _mutations(entry: dict[str, Any], accession: str | None) -> list[EngineeredMutations]:
    rows = []
    for entity in entry.get("polymer_entities") or []:
        identifiers = entity.get("rcsb_polymer_entity_container_identifiers") or {}
        if accession and accession not in (identifiers.get("uniprot_ids") or []):
            continue
        details = entity.get("rcsb_polymer_entity") or {}
        text = details.get("pdbx_mutation")
        count = (entity.get("entity_poly") or {}).get("rcsb_mutation_count")
        if not text and not count:
            continue
        rows.append(
            EngineeredMutations(
                entity_id=entity.get("rcsb_id") or "",
                description=details.get("pdbx_description"),
                mutations=[item.strip() for item in text.split(",") if item.strip()] if text else [],
                mutation_count=count,
            )
        )
    return rows


def _experimental_descriptor(
    pdb_id: str,
    entry: dict[str, Any] | None,
    coverage: StructureCoverage | None,
    provenance: Provenance | None,
    *,
    fallback_method: str | None = None,
    fallback_resolution: float | None = None,
) -> StructureDescriptor:
    entry = entry or {}
    info = entry.get("rcsb_entry_info") or {}
    methods = [row.get("method") for row in entry.get("exptl") or [] if row.get("method")]
    resolutions = info.get("resolution_combined") or []
    from_rcsb = bool(entry)
    source = rcsb if from_rcsb else pdbe
    return StructureDescriptor(
        id=structure_id("pdb", pdb_id),
        origin=StructureOrigin.EXPERIMENTAL,
        title=(entry.get("struct") or {}).get("title"),
        provider=source.id,
        provider_name=source.name,
        source_id=pdb_id,
        source_url=source.record_url(pdb_id),
        method="; ".join(methods) if methods else fallback_method,
        resolution=resolutions[0] if resolutions else fallback_resolution,
        coverage=coverage,
        license=source.license,
        attribution=source.attribution,
        files=StructureFiles(**_proxied_files(structure_id("pdb", pdb_id))),
        created_date=_iso_date((entry.get("rcsb_accession_info") or {}).get("deposit_date")),
        retrieved_at=provenance.retrieved_at if provenance else None,
        provenance=provenance.model_copy(
            update={"record_id": pdb_id, "record_url": source.record_url(pdb_id)}
        )
        if provenance
        else None,
    )


def _chain_coverage(
    accession: str, chains: list[SiftsChain], sequence_length: int | None
) -> StructureCoverage:
    ranges: list[ResidueRange] = []
    spans: list[tuple[int, int]] = []
    for chain in chains:
        regions = [(region.unp_start, region.unp_end) for region in chain.observed_regions] or [
            (chain.unp_start, chain.unp_end)
        ]
        spans.extend(regions)
        ranges.extend(ResidueRange(start=start, end=end, chain=chain.chain_id) for start, end in regions)
    covered = _span_length(spans)
    return StructureCoverage(
        uniprot_accession=accession,
        ranges=ranges,
        covered_residues=covered,
        sequence_length=sequence_length,
        fraction=round(covered / sequence_length, 4) if sequence_length else None,
    )


def _experimental_rows(
    accession: str,
    protein: EntityRef,
    sifts: SourceResult[list[SiftsChain]],
    entries: SourceResult[dict[str, dict[str, Any]]] | None,
    sequence_length: int | None,
) -> list[ExperimentalStructure]:
    by_entry: dict[str, list[SiftsChain]] = {}
    for chain in sifts.data or []:
        by_entry.setdefault(chain.pdb_id, []).append(chain)
    metadata = (entries.data if entries and entries.data else None) or {}
    rows = []
    for pdb_id, chains in by_entry.items():
        entry = metadata.get(pdb_id)
        provenance = entries.provenance if entry and entries else sifts.provenance
        best = chains[0]
        descriptor = _experimental_descriptor(
            pdb_id,
            entry,
            _chain_coverage(accession, chains, sequence_length),
            provenance,
            fallback_method=best.experimental_method,
            fallback_resolution=best.resolution,
        )
        citation = _citation(entry) if entry else None
        accession_info = (entry or {}).get("rcsb_accession_info") or {}
        refine = (entry or {}).get("refine") or []
        evidence = None
        if descriptor.provenance is not None:
            evidence = try_build_evidence(
                descriptor.provenance,
                record_type="entry",
                record_id=pdb_id,
                url=descriptor.source_url,
                subject=protein,
                predicate="has_experimental_structure",
                object=EvidenceObject(type="structure", id=descriptor.id, label=descriptor.title),
                strength_value=descriptor.resolution,
                citations=[citation] if citation else [],
            )
        rows.append(
            ExperimentalStructure(
                structure=descriptor,
                chains=[
                    LedgerChain(
                        chain_id=chain.chain_id,
                        entity_id=chain.entity_id,
                        unp_start=chain.unp_start,
                        unp_end=chain.unp_end,
                        observed_regions=[
                            ResidueRange(start=region.unp_start, end=region.unp_end, chain=chain.chain_id)
                            for region in chain.observed_regions
                        ],
                        coverage=chain.coverage,
                        sifts_rank=chain.rank,
                    )
                    for chain in chains
                ],
                ligands=_ligand_summaries(entry) if entry else [],
                engineered_mutations=_mutations(entry, accession) if entry else [],
                citation=citation,
                deposit_date=_iso_date(accession_info.get("deposit_date")),
                release_date=_iso_date(accession_info.get("initial_release_date")),
                r_free=next(
                    (
                        row["ls_R_factor_R_free"]
                        for row in refine
                        if row.get("ls_R_factor_R_free") is not None
                    ),
                    None,
                ),
                sifts_rank=best.rank,
                evidence=evidence,
            )
        )
    return rows


# Predicted models


def _afdb_descriptor(entry: AfdbEntry, provenance: Provenance | None) -> StructureDescriptor:
    if provenance is not None:
        provenance = provenance.model_copy(
            update={"record_id": entry.entry_id, "record_url": afdb.record_url(entry.entry_id)}
        )
    descriptor = afdb.descriptor(entry, provenance)
    identifier = descriptor.id
    available = tuple(
        file_format
        for file_format, url in (("cif", entry.cif_url), ("bcif", entry.bcif_url), ("pdb", entry.pdb_url))
        if url
    )
    files = descriptor.files.model_copy(update=_proxied_files(identifier, available))
    return descriptor.model_copy(update={"files": files})


async def _generated(session: AsyncSession, job_id: str) -> GeneratedStructure:
    row = await session.get(GeneratedStructure, structure_id("of", job_id))
    if row is None:
        raise NotFound(f"No Helix structure of:{job_id}.", code="structure_not_found")
    return row


def _generated_descriptor(row: GeneratedStructure) -> StructureDescriptor | None:
    try:
        return StructureDescriptor.model_validate(row.descriptor)
    except ValueError:
        logger.warning("Stored descriptor of %s is not readable", row.id)
        return None


async def _generated_for(
    session: AsyncSession, accession: str, actor: Actor | None
) -> list[StructureDescriptor]:
    owner = GeneratedStructure.actor_id.is_(None)
    if actor is not None:
        owner = or_(owner, GeneratedStructure.actor_id == actor.id)
    rows = await session.scalars(
        select(GeneratedStructure)
        .where(GeneratedStructure.uniprot_accession == accession, owner)
        .order_by(GeneratedStructure.created_at.desc())
    )
    return [descriptor for row in rows if (descriptor := _generated_descriptor(row)) is not None]


async def _afdb_entry(entry_id: str) -> tuple[AfdbEntry, SourceResult[list[AfdbEntry]]]:
    match = AFDB_ENTRY_RE.match(entry_id)
    if not match or not is_uniprot_accession(match.group(1)):
        raise BadRequest(f"'{entry_id}' is not an AlphaFold DB entry ID.", code="invalid_structure_id")
    result = await afdb.predictions(match.group(1))
    if result.state is not SourceState.EMPTY:
        result.unwrap()
    entry = next((item for item in result.data or [] if item.entry_id == entry_id), None)
    if entry is None:
        raise NotFound(f"AlphaFold DB has no model {entry_id}.", code="structure_not_found")
    return entry, result


# Ledger


def _recommend(
    experimental: list[ExperimentalStructure],
    predicted: list[StructureDescriptor],
    generated: list[StructureDescriptor],
) -> RecommendedStructure | None:
    def describe(row: ExperimentalStructure) -> str:
        descriptor = row.structure
        coverage = descriptor.coverage
        parts = [f"PDB {descriptor.source_id}"]
        if descriptor.method:
            parts.append(descriptor.method)
        if descriptor.resolution is not None:
            parts.append(f"{descriptor.resolution:g} Å")
        if coverage and coverage.fraction is not None:
            parts.append(
                f"{coverage.covered_residues} residues observed ({coverage.fraction:.0%} of the sequence)"
            )
        return ", ".join(parts)

    wide = [
        row
        for row in experimental
        if row.structure.coverage
        and row.structure.coverage.fraction is not None
        and row.structure.coverage.fraction >= MIN_EXPERIMENTAL_FRACTION
    ]
    if wide:
        row = wide[0]
        return RecommendedStructure(
            structure_id=row.structure.id,
            origin=StructureOrigin.EXPERIMENTAL,
            reason=f"Experimental structure covering at least half of the sequence, ranked highest by "
            f"PDBe SIFTS: {describe(row)}.",
            rule=RECOMMENDATION_RULE,
        )
    if predicted:
        model = predicted[0]
        mean = model.confidence.plddt_mean if model.confidence else None
        confidence = f", mean pLDDT {mean:.1f}" if mean is not None else ""
        if experimental:
            lead = (
                f"None of the {len(experimental)} experimental entries covers half of the sequence"
                if all(
                    row.structure.coverage and row.structure.coverage.fraction is not None
                    for row in experimental
                )
                else "Experimental coverage of the full sequence could not be established"
            )
        else:
            lead = "No experimental structure found"
        return RecommendedStructure(
            structure_id=model.id,
            origin=StructureOrigin.PREDICTED_EXTERNAL,
            reason=f"{lead}. The AlphaFold DB model {model.source_id} "
            f"({model.model_version or 'version unknown'}{confidence}) spans the canonical sequence. "
            "It is a prediction, not an experimental structure.",
            rule=RECOMMENDATION_RULE,
        )
    if experimental:
        row = experimental[0]
        return RecommendedStructure(
            structure_id=row.structure.id,
            origin=StructureOrigin.EXPERIMENTAL,
            reason=f"Experimental structure ranked highest by PDBe SIFTS: {describe(row)}. "
            "No AlphaFold DB model of the canonical sequence was found.",
            rule=RECOMMENDATION_RULE,
        )
    if generated:
        model = generated[0]
        return RecommendedStructure(
            structure_id=model.id,
            origin=StructureOrigin.PREDICTED_INTERNAL,
            reason="No experimental structure and no AlphaFold DB model found. This is the most recent "
            "Helix prediction for the protein.",
            rule=RECOMMENDATION_RULE,
        )
    return None


async def protein_structures(
    session: AsyncSession, accession: str, actor: Actor | None, *, external_models: bool = True
) -> StructureLedger:
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"'{accession}' is not a UniProt accession.", code="invalid_accession")
    protein = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")

    calls: dict[str, SourceCall] = {
        "sifts": SourceCall(pdbe, pdbe.best_structures(accession), timeout=25),
        "afdb": SourceCall(afdb, afdb.model(accession), timeout=25),
    }
    if external_models:
        calls["beacons"] = SourceCall(three_d_beacons, three_d_beacons.summary(accession), timeout=30)
    gathered = await gather_sources(calls)
    sifts: SourceResult[list[SiftsChain]] = gathered["sifts"]
    selection = gathered.data("afdb")
    statuses: list[SourceStatus] = list(gathered.sources)

    entries = None
    if sifts.ok and sifts.data:
        entries = await rcsb.entries([chain.pdb_id for chain in sifts.data])
        statuses.insert(1, entries.status())

    canonical: AfdbEntry | None = selection.canonical if selection else None
    sequence_length = len(canonical.sequence) if canonical else None
    afdb_provenance = gathered["afdb"].provenance
    predicted = [_afdb_descriptor(canonical, afdb_provenance)] if canonical else []
    isoforms = [
        _afdb_descriptor(entry, afdb_provenance) for entry in (selection.isoforms if selection else [])
    ]

    experimental = _experimental_rows(accession, protein, sifts, entries, sequence_length) if sifts.ok else []
    others = [
        ExternalModel(**model.model_dump(exclude={"model_format", "experimental_method", "resolution"}))
        for model in (gathered.data("beacons", []) if external_models else []) or []
        if model.provider not in ("PDBe", "AlphaFold DB")
        and (model.model_category or "").upper() != "EXPERIMENTALLY DETERMINED"
    ]
    generated = await _generated_for(session, accession, actor)

    return StructureLedger(
        protein=protein,
        sequence_length=sequence_length,
        experimental=experimental,
        predicted_external=predicted,
        isoform_models=isoforms,
        other_external_models=others,
        predicted_internal=generated,
        recommended=_recommend(experimental, predicted, generated),
        sources=statuses,
    )


# Descriptor


def _segment_coverage(segments: list[SiftsSegment], accession: str | None) -> StructureCoverage | None:
    if not segments:
        return None
    if accession is None:
        totals: dict[str, int] = {}
        for segment in segments:
            totals[segment.uniprot_accession] = (
                totals.get(segment.uniprot_accession, 0) + segment.unp_end - segment.unp_start + 1
            )
        accession = max(totals, key=lambda key: totals[key])
    own = [segment for segment in segments if segment.uniprot_accession == accession]
    if not own:
        return None
    return StructureCoverage(
        uniprot_accession=accession,
        ranges=[
            ResidueRange(start=segment.unp_start, end=segment.unp_end, chain=segment.chain_id)
            for segment in own
        ],
        covered_residues=_span_length([(segment.unp_start, segment.unp_end) for segment in own]),
    )


async def structure_descriptor(
    session: AsyncSession, identifier: str, accession: str | None = None
) -> StructureDescriptor:
    kind, value = parse_id(identifier)
    if kind == "of":
        descriptor = _generated_descriptor(await _generated(session, value))
        if descriptor is None:
            raise NotFound(f"No Helix structure of:{value}.", code="structure_not_found")
        return descriptor
    if kind == "afdb":
        entry, result = await _afdb_entry(value)
        return _afdb_descriptor(entry, result.provenance)

    gathered = await gather_sources(
        {
            "entry": SourceCall(rcsb, rcsb.entries([value]), timeout=25),
            "segments": SourceCall(pdbe, pdbe.uniprot_mappings(value), timeout=25),
        }
    )
    entries = gathered["entry"]
    entry = (entries.data or {}).get(value) if entries.data else None
    if entry is None:
        if entries.state is SourceState.UNAVAILABLE:
            raise SourceUnavailable(rcsb.name, entries.message)
        raise NotFound(f"RCSB PDB has no entry {value}.", code="structure_not_found")
    coverage = _segment_coverage(
        gathered.data("segments", []) or [], accession.upper() if accession else None
    )
    descriptor = _experimental_descriptor(value, entry, coverage, entries.provenance)
    if not gathered["segments"].answered:
        descriptor.warnings.append("PDBe SIFTS did not answer: UniProt coverage of this entry is unknown.")
    return descriptor


# Files


@dataclass(slots=True)
class StructureFile:
    content: bytes
    media_type: str
    filename: str
    etag: str
    cache_control: str


def _format_unavailable(identifier: str, file_format: str, detail: str | None = None) -> NotFound:
    message = f"{identifier} is not available as {file_format}."
    return NotFound(f"{message} {detail}" if detail else message, code="format_unavailable")


async def _cached_download(
    store: ArtifactStore,
    key: str,
    media_type: str,
    identifier: str,
    file_format: str,
    fetch: Any,
) -> bytes:
    if await store.exists(key):
        return await store.get_bytes(key)
    result: SourceResult[bytes] = await fetch()
    if result.state is SourceState.EMPTY or (result.ok and not result.data):
        raise _format_unavailable(identifier, file_format, f"{result.name} has no such file.")
    content = result.unwrap()
    assert content is not None
    await store.put_bytes(key, content, media_type)
    return content


async def structure_file(
    session: AsyncSession, store: ArtifactStore, identifier: str, file_format: StructureFileFormat
) -> StructureFile:
    kind, value = parse_id(identifier)
    media_type = MEDIA_TYPES[file_format]

    if kind == "pdb":
        content = await _cached_download(
            store,
            f"structure-cache/pdb/{value}.{file_format}",
            media_type,
            identifier,
            file_format,
            lambda: rcsb.file(value, file_format),
        )
        return StructureFile(content, media_type, f"{value}.{file_format}", sha256_hex(content), PDB_CACHE)

    if kind == "afdb":
        entry, _ = await _afdb_entry(value)
        url = {"cif": entry.cif_url, "bcif": entry.bcif_url, "pdb": entry.pdb_url}[file_format]
        if not url:
            raise _format_unavailable(identifier, file_format, "AlphaFold DB lists no such file.")
        version = entry.version_label or "unversioned"
        content = await _cached_download(
            store,
            f"structure-cache/afdb/{value}-{version}.{file_format}",
            media_type,
            identifier,
            file_format,
            lambda: afdb.get_bytes(url, record_id=value, ttl=0, timeout=60.0),
        )
        filename = f"{value}-model_{version}.{file_format}"
        # the version is part of the file, so a given response never changes
        cache = IMMUTABLE_CACHE if entry.latest_version is not None else PDB_CACHE
        return StructureFile(content, media_type, filename, sha256_hex(content), cache)

    row = await _generated(session, value)
    artifacts = list(
        await session.scalars(
            select(Artifact)
            .where(Artifact.job_id == row.job_id, Artifact.role == "structure")
            .order_by(Artifact.name)
        )
    )
    matching = [
        artifact
        for artifact in artifacts
        if PurePosixPath(artifact.name).suffix.lower() == f".{file_format}"
        and artifact.sample_index in (None, 0)
    ]
    if not matching:
        formats = sorted({PurePosixPath(artifact.name).suffix.lower().lstrip(".") for artifact in artifacts})
        detail = f"Stored formats: {', '.join(formats)}." if formats else "The job stored no structure file."
        raise _format_unavailable(identifier, file_format, detail)
    artifact = next((item for item in matching if item.id == row.structure_artifact_id), matching[0])
    content = await store.get_bytes(artifact.storage_key)
    return StructureFile(content, media_type, f"{value}.{file_format}", artifact.sha256, IMMUTABLE_CACHE)


# Confidence


def _plddt_track(
    residue_numbers: list[int],
    scores: list[float],
    categories: list[str] | None = None,
    chain: str | None = None,
) -> PlddtTrack:
    native = "0-100"
    if scores and max(scores) <= 1.0:
        native = "0-1"
        scores = [round(score * 100, 2) for score in scores]
    bands = (
        [PLDDT_BANDS[category] for category in categories]
        if categories and all(category in PLDDT_BANDS for category in categories)
        else [
            "very_high"
            if score >= 90
            else "confident"
            if score >= 70
            else "low"
            if score >= 50
            else "very_low"
            for score in scores
        ]
    )
    total = len(bands)
    fractions = (
        PlddtFractions(**{band: round(bands.count(band) / total, 4) for band in PLDDT_BANDS.values()})
        if total
        else None
    )
    return PlddtTrack(
        chain=chain,
        residue_numbers=residue_numbers,
        scores=scores,
        categories=bands,  # type: ignore[arg-type]
        native_scale=native,  # type: ignore[arg-type]
        mean=round(sum(scores) / total, 2) if total else None,
        fractions=fractions,
    )


def _pae_matrix(document: Any, residue_start: int) -> PaeMatrix | None:
    if isinstance(document, list) and document and isinstance(document[0], dict):
        document = document[0]
    if not isinstance(document, dict):
        return None
    matrix = document.get("predicted_aligned_error") or document.get("pae")
    if not isinstance(matrix, list) or not matrix or not isinstance(matrix[0], list):
        return None
    return PaeMatrix(
        matrix=matrix,
        size=len(matrix),
        residue_start=residue_start,
        max=document.get("max_predicted_aligned_error") or document.get("max_pae"),
    )


async def _artifact_json(store: ArtifactStore, artifact: Artifact) -> Any:
    try:
        return json.loads(await store.get_bytes(artifact.storage_key))
    except ValueError, OSError:
        return None


async def structure_confidence(
    session: AsyncSession, store: ArtifactStore, identifier: str, *, include_pae: bool = True
) -> StructureConfidence:
    kind, value = parse_id(identifier)
    origin = _origin(kind)

    if kind == "pdb":
        return StructureConfidence(
            structure_id=identifier,
            origin=origin,
            available=False,
            message="pLDDT and PAE are confidence estimates of predicted models. An experimental entry "
            "has none; see its resolution and validation report.",
        )

    if kind == "afdb":
        entry, _ = await _afdb_entry(value)
        calls = {"plddt": SourceCall(afdb, afdb.plddt(entry), timeout=25)}
        if include_pae:
            calls["pae"] = SourceCall(afdb, afdb.pae(entry), timeout=40)
        gathered = await gather_sources(calls)
        profile = gathered.data("plddt")
        track = (
            _plddt_track(profile.residue_numbers, profile.scores, profile.categories, chain="A")
            if profile
            else None
        )
        pae = _pae_matrix(gathered.data("pae"), entry.sequence_start) if include_pae else None
        return StructureConfidence(
            structure_id=identifier,
            origin=origin,
            available=track is not None or pae is not None,
            message=None
            if track
            else gathered["plddt"].message or "AlphaFold DB returned no pLDDT document.",
            plddt=track,
            pae=pae,
            pae_available=bool(entry.pae_doc_url),
            limitations=list(MODEL_LIMITATIONS),
            sources=gathered.sources,
        )

    row = await _generated(session, value)
    descriptor = _generated_descriptor(row)
    artifacts = list(await session.scalars(select(Artifact).where(Artifact.job_id == row.job_id)))
    start = row.residue_start or 1
    track = None
    pae = None
    has_pae = False
    for artifact in artifacts:
        if artifact.sample_index not in (None, 0) or not artifact.name.lower().endswith(".json"):
            continue
        if artifact.role == "plddt" and track is None:
            document = await _artifact_json(store, artifact)
            if isinstance(document, dict) and "confidenceScore" in document:
                track = _plddt_track(
                    document.get("residueNumber")
                    or list(range(start, start + len(document["confidenceScore"]))),
                    document["confidenceScore"],
                    document.get("confidenceCategory"),
                )
            else:
                scores = document.get("plddt") if isinstance(document, dict) else document
                if (
                    isinstance(scores, list)
                    and scores
                    and all(isinstance(score, int | float) for score in scores)
                ):
                    track = _plddt_track(list(range(start, start + len(scores))), scores)
        elif artifact.role == "pae":
            has_pae = True
            if include_pae and pae is None:
                pae = _pae_matrix(await _artifact_json(store, artifact), start)
    return StructureConfidence(
        structure_id=identifier,
        origin=origin,
        available=track is not None or pae is not None,
        message=None
        if track is not None
        else "This job stored no per-residue pLDDT document Helix can read. pLDDT may still be in the "
        "B-factor column of the structure file.",
        plddt=track,
        pae=pae,
        pae_available=has_pae,
        limitations=list(descriptor.limitations) if descriptor else [],
    )


# Residue map


def _author_offset(segment: SiftsSegment) -> int | None:
    if segment.author_start is None or segment.author_end is None:
        return None
    start = segment.author_start - segment.unp_start
    return start if start == segment.author_end - segment.unp_end else None


async def structure_residue_map(
    session: AsyncSession, identifier: str, accession: str | None = None
) -> ResidueMap:
    kind, value = parse_id(identifier)
    origin = _origin(kind)
    if kind == "pdb":
        result = await pdbe.uniprot_mappings(value)
        segments = [
            ResidueMapSegment(
                **segment.model_dump(exclude={"uniprot_name"}), author_offset=_author_offset(segment)
            )
            for segment in result.data or []
            if accession is None or segment.uniprot_accession == accession.upper()
        ]
        return ResidueMap(
            structure_id=identifier,
            origin=origin,
            numbering="PDBe SIFTS segments. Inside a segment the entity position (label_seq_id) is "
            "entity_start + (UniProt position - unp_start). Author numbering is stated at segment ends only.",
            segments=segments,
            sources=[result.status()],
        )

    if kind == "afdb":
        entry, result = await _afdb_entry(value)
        accession_of, start, end = entry.uniprot_accession, entry.sequence_start, entry.sequence_end
        sources = [result.status()]
    else:
        row = await _generated(session, value)
        if row.uniprot_accession is None or row.residue_start is None or row.residue_end is None:
            return ResidueMap(
                structure_id=identifier,
                origin=origin,
                numbering="This job recorded no UniProt accession or residue range for its structure.",
            )
        accession_of, start, end = row.uniprot_accession, row.residue_start, row.residue_end
        sources = []
    return ResidueMap(
        structure_id=identifier,
        origin=origin,
        numbering="Predicted model of a UniProt sequence: residue numbers in the file are UniProt positions.",
        segments=[
            ResidueMapSegment(
                uniprot_accession=accession_of,
                chain_id="A",
                struct_asym_id="A",
                unp_start=start,
                unp_end=end,
                entity_start=1,
                entity_end=end - start + 1,
                author_start=start,
                author_end=end,
                author_offset=0,
            )
        ],
        sources=sources,
    )


# Ligands


def _entity_alignments(entry: dict[str, Any]) -> dict[str, list[tuple[str, int, int, int]]]:
    """entity_id -> [(accession, entity_begin, uniprot_begin, length)] from the RCSB alignment."""
    alignments: dict[str, list[tuple[str, int, int, int]]] = {}
    for entity in entry.get("polymer_entities") or []:
        entity_id = str(
            (entity.get("rcsb_polymer_entity_container_identifiers") or {}).get("entity_id") or ""
        )
        if not entity_id:
            entity_id = str(entity.get("rcsb_id") or "").rpartition("_")[2]
        for alignment in entity.get("rcsb_polymer_entity_align") or []:
            if alignment.get("reference_database_name") != "UniProt":
                continue
            for region in alignment.get("aligned_regions") or []:
                alignments.setdefault(entity_id, []).append(
                    (
                        alignment["reference_database_accession"],
                        region["entity_beg_seq_id"],
                        region["ref_beg_seq_id"],
                        region["length"],
                    )
                )
    return alignments


def _to_uniprot(
    alignments: dict[str, list[tuple[str, int, int, int]]], entity_id: str, seq_id: int | None
) -> tuple[str | None, int | None]:
    if seq_id is None:
        return None, None
    for accession, entity_begin, uniprot_begin, length in alignments.get(entity_id, []):
        if entity_begin <= seq_id < entity_begin + length:
            return accession, uniprot_begin + seq_id - entity_begin
    return None, None


async def structure_ligands(identifier: str, accession: str | None = None) -> StructureLigands:
    kind, value = parse_id(identifier)
    origin = _origin(kind)
    if kind != "pdb":
        return StructureLigands(
            structure_id=identifier,
            origin=origin,
            message="Bound ligands are listed for experimental entries. No source lists ligands for this "
            "predicted model.",
        )
    result = await rcsb.ligand_sites(value)
    if result.state is SourceState.EMPTY and result.data is None:
        raise NotFound(f"RCSB PDB has no entry {value}.", code="structure_not_found")
    entry = result.data or {}
    alignments = _entity_alignments(entry)
    accession = accession.upper() if accession else None

    ligands: list[BoundLigand] = []
    counts: dict[str, int] = {}
    for entity in entry.get("nonpolymer_entities") or []:
        instances = []
        for instance in entity.get("nonpolymer_entity_instances") or []:
            identifiers = instance.get("rcsb_nonpolymer_entity_instance_container_identifiers") or {}
            nearest: dict[tuple[str | None, int | None], BindingResidue] = {}
            for neighbour in instance.get("rcsb_target_neighbors") or []:
                seq_id = neighbour.get("target_seq_id")
                mapped_accession, position = _to_uniprot(
                    alignments, str(neighbour.get("target_entity_id") or ""), seq_id
                )
                residue = BindingResidue(
                    uniprot_accession=mapped_accession,
                    uniprot_position=position,
                    residue_name=neighbour.get("target_comp_id"),
                    struct_asym_id=neighbour.get("target_asym_id"),
                    entity_seq_id=seq_id,
                    author_seq_id=neighbour.get("target_auth_seq_id"),
                    distance=neighbour.get("distance"),
                )
                key = (residue.struct_asym_id, seq_id)
                known = nearest.get(key)
                if known is None or (residue.distance or 0) < (known.distance or 0):
                    nearest[key] = residue
                if mapped_accession:
                    counts[mapped_accession] = counts.get(mapped_accession, 0) + 1
            instances.append(
                LigandInstance(
                    chain_id=identifiers.get("auth_asym_id"),
                    struct_asym_id=identifiers.get("asym_id"),
                    author_seq_id=identifiers.get("auth_seq_id"),
                    residues=sorted(
                        nearest.values(),
                        key=lambda item: (item.struct_asym_id or "", item.entity_seq_id or 0),
                    ),
                )
            )
        ligands.append(BoundLigand(**_ligand_fields(entity), instances=instances))

    focus = accession or (max(counts, key=lambda key: counts[key]) if counts else None)
    for ligand in ligands:
        positions = sorted(
            {
                residue.uniprot_position
                for instance in ligand.instances
                for residue in instance.residues
                if residue.uniprot_position is not None and residue.uniprot_accession == focus
            }
        )
        ligand.binding_site_positions = positions
        ligand.binding_site = [
            ResidueRange(start=start, end=end)
            for start, end in _merge_ranges([(item, item) for item in positions])
        ]
    return StructureLigands(
        structure_id=identifier,
        origin=origin,
        uniprot_accession=focus,
        ligands=ligands,
        neighbour_definition=NEIGHBOUR_DEFINITION,
        message=None if ligands else "RCSB PDB lists no non-polymer ligand in this entry.",
        sources=[result.status()],
    )
