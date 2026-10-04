"""Structure similarity: the part of Helix nothing else does.

Two questions, both answered from records and never from a score Helix made up:

1. Which proteins have a fold like this one? Foldseek against the PDB (`pdb100`) and the reviewed
   AlphaFold DB subset (`afdb-swissprot`).
2. Does the pocket on this protein resemble a pocket on one of those, and is a molecule already
   known to sit in it? P2Rank pockets on both sides through PrankWeb, and ligands RCSB PDB records
   as observed bound in an experimental entry of the similar protein.

THE FUNCTION THE DISCOVERY ENGINE IMPORTS
-----------------------------------------

    from helix.services.structure_similarity import structural_analogue_bridges

    async def structural_analogue_bridges(
        accession: str,                     # UniProt accession of the subject protein, e.g. O00329
        *,
        limit: int = 6,                     # how many analogues to return, ordered by RANKING_RULE
        compare_pockets: int = 2,           # how many of them get residue-level pocket comparison
        deadline_seconds: float = 8.0,      # hard ceiling; never blocks longer than this
    ) -> StructuralAnalogueBridges

Ordering is `RANKING_RULE` in this module: human proteins first, then Foldseek E-value lowest first,
then bit score highest first, one row per protein. Nothing is combined into a score. Only alignments
at `MAX_BRIDGE_EVALUE` (1e-3) or better become a bridge.

`StructuralAnalogueBridges` (helix.schemas.structure_similarity) carries `subject`,
`subject_structure_id`, `status` ("ready" | "pending" | "unavailable" | "not_applicable"),
`status_detail`, `retry_after_seconds`, `analogues: list[StructuralAnalogue]`, `limits` and
`sources`. Each `StructuralAnalogue` carries the similar protein as an `EntityRef` plus
`gene_symbol`, the named `fold_metrics`, `shares` (one plain sentence per claim), the subject and
analogue structure and pocket IDs with their residue positions, `observed_ligands` (real molecules
with InChIKey and SMILES, so the engine can look them up in ChEMBL or UniChem), `pocket_compared`,
`evidence` and `caveats`.

The function never raises for an upstream failure and never waits on a cold Foldseek job: it
returns `status="pending"` with a `retry_after_seconds` and whatever it already knows.

It says nothing about direction of effect. An analogue's `observed_ligands` are molecules seen bound
to that protein, not molecules proposed for the subject: the engine must run its own direction check
on each one before ranking it, and a blocker carried across to a loss-of-function subject must be
ruled out, not ranked.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from helix.errors import BadRequest
from helix.evidence import try_build_evidence
from helix.identifiers import is_uniprot_accession, parse_structure_id
from helix.knowledge.catalog import get_catalog
from helix.log import get_logger
from helix.schemas.common import (
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Provenance,
    SourceState,
    SourceStatus,
    StructureOrigin,
)
from helix.schemas.structure_similarity import (
    AlignedRange,
    ObservedLigand,
    PocketPair,
    PocketSimilarity,
    SharedResidue,
    SimilarityMetric,
    SimilarProtein,
    SimilarStructures,
    StructuralAnalogue,
    StructuralAnalogueBridges,
)
from helix.sources.afdb import afdb
from helix.sources.base import SourceResult
from helix.sources.foldseek import (
    DATABASE_AFDB_SWISSPROT,
    DATABASE_LABELS,
    DATABASE_PDB,
    MODE_3DIAA,
    MODE_TMALIGN,
    PENDING_STATUSES,
    FoldHit,
    FoldSearch,
    cached_search,
    foldseek,
)
from helix.sources.pdbe import pdbe
from helix.sources.pocket_similarity import (
    CAVEATS,
    RESIDUE_CORRESPONDENCE_RULE,
    PocketMatch,
    fold_shares,
    match_pocket,
    pocket_shares,
)
from helix.sources.rcsb import rcsb

logger = get_logger(__name__)

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
RETRY_AFTER_SECONDS = 10
# A Helix request never waits longer than this on the external search
DEFAULT_DEADLINE_SECONDS = 6.0
# PDB entries resolved in one batched RCSB call, for accessions, titles and observed ligand IDs
MAX_PDB_ENTRIES_RESOLVED = 40
# Hits scanned per requested row, so several alignments to one protein collapse into one row
WORKING_SET_FACTOR = 12
# Gene symbols looked up on AlphaFold DB for this many analogues, concurrently
MAX_GENE_LOOKUPS = 8

MODE_NOTES = {
    MODE_3DIAA: (
        "Search mode 3diaa compares the structural alphabet and the amino acids. It reports an "
        "E-value, a bit score, a homology probability, the aligned length and the sequence identity. "
        "It does not report a TM-score, so none is shown."
    ),
    MODE_TMALIGN: (
        "Search mode tmalign superposes the two structures and reports a TM-score alongside the "
        "E-value and bit score."
    ),
}

LIMITS = [
    "Foldseek compares shapes. A shared shape is a reason to look, not evidence that a molecule "
    "binds the subject protein.",
    "The search ran against the Protein Data Bank and the reviewed part of AlphaFold DB. A protein "
    "in neither cannot appear here.",
    "The query is the AlphaFold DB model of the protein, so every position is a UniProt position, "
    "and the parts of the model with low confidence are aligned along with the rest.",
    "Foldseek accepts one search every 50 seconds from one address. A protein without a stored copy "
    "may come back as pending the first time it is asked for.",
]

METRIC_DEFINITIONS: dict[str, dict[str, Any]] = {
    "foldseek_evalue": {
        "label": "Foldseek E-value",
        "unit": None,
        "direction": "lower_is_stronger",
        "source_field": "eval",
        "meaning": "How many alignments this good the search would expect to find by chance. "
        "Smaller means the resemblance is less likely to be coincidence.",
    },
    "foldseek_bit_score": {
        "label": "Foldseek bit score",
        "unit": "bits",
        "direction": "higher_is_stronger",
        "source_field": "score",
        "meaning": "Strength of the structural alignment in Foldseek's own scoring. Higher is a "
        "stronger alignment. It is not comparable to scores from other tools.",
    },
    "foldseek_homology_probability": {
        "label": "Foldseek homology probability",
        "unit": None,
        "direction": "higher_is_stronger",
        "source_field": "prob",
        "meaning": "Foldseek's own estimate, from 0 to 1, that the two proteins are related rather "
        "than coincidentally alike.",
    },
    "sequence_identity": {
        "label": "Sequence identity over the aligned part",
        "unit": "%",
        "direction": "descriptive",
        "source_field": "seqId",
        "meaning": "Share of aligned positions holding the same amino acid. A low value with a good "
        "E-value means the resemblance is structural rather than sequence-level.",
    },
    "aligned_length": {
        "label": "Aligned length",
        "unit": "residues",
        "direction": "descriptive",
        "source_field": "alnLength",
        "meaning": "How many residues the alignment covers. A short alignment covers one part of "
        "the protein only.",
    },
    "mismatches": {
        "label": "Mismatches",
        "unit": "residues",
        "direction": "descriptive",
        "source_field": "missmatches",
        "meaning": "Aligned positions where the two amino acids differ.",
    },
    "gaps_opened": {
        "label": "Gaps opened",
        "unit": None,
        "direction": "descriptive",
        "source_field": "gapsopened",
        "meaning": "How many insertions or deletions the alignment needed. More gaps means a less "
        "continuous match.",
    },
}

HIT_METRIC_FIELDS: tuple[tuple[str, str], ...] = (
    ("foldseek_evalue", "evalue"),
    ("foldseek_bit_score", "bit_score"),
    ("foldseek_homology_probability", "homology_probability"),
    ("sequence_identity", "sequence_identity_percent"),
    ("aligned_length", "aligned_length"),
    ("mismatches", "mismatches"),
    ("gaps_opened", "gaps_opened"),
)


def _metric(name: str, value: float | int | None) -> SimilarityMetric | None:
    definition = METRIC_DEFINITIONS.get(name)
    if definition is None or value is None:
        return None
    return SimilarityMetric(
        name=name,
        label=definition["label"],
        value=float(value),
        unit=definition["unit"],
        direction=definition["direction"],
        source="foldseek",
        source_field=definition["source_field"],
        meaning=definition["meaning"],
    )


def _metrics(hit: FoldHit) -> list[SimilarityMetric]:
    found = [_metric(name, getattr(hit, attribute)) for name, attribute in HIT_METRIC_FIELDS]
    return [metric for metric in found if metric is not None]


def _merge_statuses(statuses: list[SourceStatus]) -> list[SourceStatus]:
    """One row per source, keeping the first mention of each."""
    merged: dict[str, SourceStatus] = {}
    for status in statuses:
        merged.setdefault(status.source, status)
    return list(merged.values())


@dataclass(slots=True)
class FoldLookup:
    """Outcome of asking for the fold neighbours of one protein."""

    status: str = "unavailable"
    detail: str | None = None
    search: FoldSearch | None = None
    provenance: Provenance | None = None
    statuses: list[SourceStatus] = field(default_factory=list)

    def add(self, result: SourceResult[Any]) -> SourceResult[Any]:
        self.statuses.append(result.status())
        return result


def _cached_status(search: FoldSearch) -> SourceStatus:
    return SourceStatus(
        source=foldseek.id,
        name=foldseek.name,
        state=SourceState.OK,
        message=f"Served from a stored copy of a real Foldseek search retrieved {search.retrieved_at}. "
        "No search was sent for this request.",
        retrieved_at=None,
        license=foldseek.license,
        url=foldseek.homepage,
        from_cache=True,
    )


def _cached_provenance(search: FoldSearch) -> Provenance | None:
    """Provenance of the stored copy: the real Foldseek record it came from, flagged as cached."""
    from datetime import datetime

    try:
        retrieved_at = datetime.fromisoformat(str(search.retrieved_at))
    except ValueError:
        return None
    return Provenance(
        source=foldseek.id,
        source_name=foldseek.name,
        release=f"mode {search.mode}; databases {', '.join(search.databases)}",
        method="GET",
        request_url=f"https://search.foldseek.com/api/result/{search.ticket}/0",
        retrieved_at=retrieved_at,
        record_id=search.ticket,
        record_url=foldseek.record_url(search.ticket or ""),
        license=foldseek.license,
        license_url=foldseek.license_url,
        attribution=foldseek.attribution,
        from_cache=True,
    )


async def fold_neighbours(
    accession: str, *, deadline_seconds: float = DEFAULT_DEADLINE_SECONDS
) -> FoldLookup:
    """Fold neighbours of one protein: a stored copy when there is one, otherwise the live service.

    Never waits out the 50 s submission interval and never waits longer than deadline_seconds in
    total, counting the AlphaFold DB download and the submission as well as the search itself. A
    search still running when the budget runs out comes back as status "pending".

    Every upstream call inside is a shielded single flight, so cutting this short does not cancel the
    work: the submission still registers its ticket and the result still reaches the cache, and the
    next request picks both up instead of spending another submission.
    """
    stored = cached_search(accession)
    if stored is not None:
        return FoldLookup(
            status="ready",
            search=stored,
            provenance=_cached_provenance(stored),
            statuses=[_cached_status(stored)],
        )

    lookup = FoldLookup()
    try:
        await asyncio.wait_for(_live_search(accession, lookup, deadline_seconds), deadline_seconds)
    except TimeoutError:
        lookup.status = "pending"
        lookup.detail = (
            f"Helix stopped waiting after {deadline_seconds:g} seconds. The search is still running "
            "at Foldseek; ask again in a few seconds."
        )
    return lookup


async def _live_search(accession: str, lookup: FoldLookup, deadline_seconds: float) -> None:
    """Run one live Foldseek search, recording progress on the lookup as it goes."""
    deadline = time.monotonic() + deadline_seconds

    model = lookup.add(await afdb.model(accession))
    selection = model.data if model.ok else None
    entry = selection.canonical if selection is not None else None
    if entry is None or not entry.pdb_url:
        lookup.status = "not_applicable"
        lookup.detail = (
            model.message
            or f"AlphaFold DB has no model of the canonical sequence of {accession}, so there is no "
            "structure to search with."
        )
        return

    structure = lookup.add(await afdb.file(entry.pdb_url, entry.entry_id))
    if not structure.ok or not isinstance(structure.data, bytes):
        lookup.detail = structure.message or "The AlphaFold DB model file could not be downloaded."
        return

    submission = lookup.add(await foldseek.submit(structure.data, filename=f"{entry.entry_id}.pdb"))
    if not submission.ok or not isinstance(submission.data, dict):
        wait = foldseek.submission_due_in()
        lookup.status = "pending" if wait > 0 else "unavailable"
        lookup.detail = submission.message or "Foldseek did not accept the search."
        return
    ticket = str(submission.data.get("id") or "")
    if not ticket:
        lookup.detail = "Foldseek accepted the search but returned no ticket."
        return

    while True:
        poll = lookup.add(await foldseek.ticket(ticket))
        state = str((poll.data or {}).get("status") or "") if poll.ok else ""
        if state == "COMPLETE":
            break
        if state in PENDING_STATUSES:
            if time.monotonic() >= deadline:
                lookup.status = "pending"
                lookup.detail = (
                    f"Foldseek is still searching ({state.lower()}). Helix did not wait: ask again "
                    "in a few seconds."
                )
                return
            await asyncio.sleep(1.0)
            continue
        lookup.detail = poll.message or f"Foldseek reports the search as {state or 'unknown'}."
        return

    remaining = max(0.5, deadline - time.monotonic())
    try:
        results = await asyncio.wait_for(foldseek.hits(ticket), remaining)
    except TimeoutError:
        # The download is shielded inside the adapter, so it finishes and reaches the cache
        lookup.status = "pending"
        lookup.detail = (
            "Foldseek has finished the search and Helix is still reading the result file. Ask again "
            "in a few seconds."
        )
        return
    lookup.add(results)
    if not results.ok or not isinstance(results.data, dict):
        lookup.detail = results.message or "Foldseek returned no hits Helix could read."
        return

    payload = results.data
    lookup.status = "ready"
    lookup.provenance = results.provenance
    lookup.search = FoldSearch(
        uniprot_accession=accession,
        query_structure_id=f"afdb:{entry.entry_id}",
        mode=str(payload.get("mode") or MODE_3DIAA),
        databases=(DATABASE_PDB, DATABASE_AFDB_SWISSPROT),
        ticket=ticket,
        query_length=payload.get("query_length"),
        hits=tuple(payload.get("hits") or ()),
        total_hits=dict(payload.get("total_hits") or {}),
    )


def _is_same_protein(hit: FoldHit, accession: str) -> bool:
    if hit.uniprot_accession and hit.uniprot_accession.split("-")[0] == accession:
        return True
    return hit.is_self_hit and hit.database == DATABASE_AFDB_SWISSPROT


HUMAN_TAX_NAME = "Homo sapiens"
RANKING_RULE = (
    "Human proteins first, because only a molecule that acts on a human protein could be taken "
    "further; then by Foldseek E-value, lowest first; then by Foldseek bit score, highest first. "
    "One row per protein: the best-ranked alignment is kept and an experimental entry of the same "
    "protein is attached to it when the search found one. No score is combined."
)


def _rank_key(hit: FoldHit) -> tuple[int, float, float]:
    evalue = hit.evalue if hit.evalue is not None else float("inf")
    return (0 if hit.tax_name == HUMAN_TAX_NAME else 1, evalue, -(hit.bit_score or 0.0))


def _candidate_hits(search: FoldSearch, accession: str) -> list[FoldHit]:
    """Hits ranked by RANKING_RULE across both databases, with the subject's own entries dropped.

    Foldseek returns one block per database, so the raw order is not a ranking across databases and
    the PDB entries, which are the ones carrying observed ligands, would never surface.
    """
    kept = [hit for hit in search.hits if not _is_same_protein(hit, accession)]
    return sorted(kept, key=_rank_key)


async def _resolve_pdb_entries(hits: list[FoldHit]) -> tuple[dict[str, dict[str, Any]], SourceStatus | None]:
    """One batched RCSB call for the PDB hits: title, chain accessions and observed ligand IDs."""
    pdb_ids = []
    for hit in hits:
        if hit.pdb_id and hit.pdb_id not in pdb_ids:
            pdb_ids.append(hit.pdb_id)
        if len(pdb_ids) >= MAX_PDB_ENTRIES_RESOLVED:
            break
    if not pdb_ids:
        return {}, None
    result = await rcsb.entries(pdb_ids)
    return (result.data or {}) if result.ok else {}, result.status()


def _chain_accession(entry: dict[str, Any], chain: str | None) -> str | None:
    """UniProt accession of the polymer entity that holds this author chain."""
    fallback: str | None = None
    for polymer in entry.get("polymer_entities") or []:
        identifiers = polymer.get("rcsb_polymer_entity_container_identifiers") or {}
        accessions = identifiers.get("uniprot_ids") or []
        if not accessions:
            continue
        fallback = fallback or accessions[0]
        if chain and chain in (identifiers.get("auth_asym_ids") or []):
            return accessions[0]
    return fallback


def _entry_ligands(entry: dict[str, Any]) -> list[str]:
    """Component IDs of the non-polymer molecules in this entry, crystallisation additives left out.

    Read from nonpolymer_entities rather than rcsb_entry_info.nonpolymer_bound_components, which
    comes back null on the entries checked here.
    """
    from helix.services.structures import COMMON_ADDITIVES

    found = set()
    for polymer in entry.get("nonpolymer_entities") or []:
        comp_id = ((polymer.get("nonpolymer_comp") or {}).get("chem_comp") or {}).get("id")
        if comp_id and str(comp_id) not in COMMON_ADDITIVES:
            found.add(str(comp_id))
    return sorted(found)


@dataclass(slots=True)
class ProteinGroup:
    """Every alignment to one protein, collapsed into the best one plus any experimental entry."""

    accession: str | None
    best: FoldHit
    pdb_hit: FoldHit | None = None
    pdb_entry: dict[str, Any] | None = None
    alignment_count: int = 1


def _group_by_protein(
    ranked: list[FoldHit], entries: dict[str, dict[str, Any]], subject_accession: str
) -> list[ProteinGroup]:
    """One group per protein, in ranked order. A protein found in both databases keeps its best
    alignment and gains the experimental entry, which is where observed ligands come from.

    A PDB hit only says which protein it is once RCSB has resolved it, so the subject's own
    experimental entries are dropped here rather than before resolution. Rows whose protein could
    not be resolved at all come last: nothing downstream can act on a protein it cannot name.
    """
    groups: dict[str, ProteinGroup] = {}
    order: list[str] = []
    for hit in ranked:
        entry = entries.get(hit.pdb_id or "") if hit.pdb_id else None
        accession = hit.uniprot_accession or (_chain_accession(entry, hit.pdb_chain) if entry else None)
        if accession:
            accession = accession.split("-")[0]
        if accession == subject_accession:
            continue
        # Without an accession a row can only stand for itself, keyed on the target name
        key = accession or f"target:{hit.target.split(' ')[0]}"
        group = groups.get(key)
        if group is None:
            group = groups[key] = ProteinGroup(accession=accession, best=hit)
            order.append(key)
        else:
            group.alignment_count += 1
            if group.accession is None and accession:
                group.accession = accession
        if hit.pdb_id and group.pdb_hit is None and entry is not None:
            group.pdb_hit, group.pdb_entry = hit, entry
    named = [groups[key] for key in order if groups[key].accession is not None]
    unnamed = [groups[key] for key in order if groups[key].accession is None]
    return named + unnamed


def _gene_from_catalog(accession: str) -> str | None:
    try:
        gene = get_catalog().gene_by_uniprot(accession)
    except Exception:
        return None
    return getattr(gene, "symbol", None) if gene else None


async def _gene_symbols(
    accessions: list[str],
) -> tuple[dict[str, tuple[str | None, str | None]], list[SourceStatus]]:
    """Gene symbol and protein name per accession: the Helix catalog first, then AlphaFold DB."""
    found: dict[str, tuple[str | None, str | None]] = {}
    unknown: list[str] = []
    for accession in accessions:
        symbol = _gene_from_catalog(accession)
        if symbol:
            found[accession] = (symbol, None)
        else:
            unknown.append(accession)
    statuses: list[SourceStatus] = []
    if unknown:
        results = await asyncio.gather(
            *(afdb.model(accession) for accession in unknown[:MAX_GENE_LOOKUPS]),
            return_exceptions=True,
        )
        for accession, result in zip(unknown, results, strict=False):
            if isinstance(result, BaseException) or not getattr(result, "ok", False):
                continue
            statuses.append(result.status())
            entry = getattr(result.data, "canonical", None)
            if entry is not None:
                found[accession] = (entry.gene, entry.description)
    return found, statuses


def _similar_row(
    group: ProteinGroup,
    genes: dict[str, tuple[str | None, str | None]],
    provenance: Provenance | None,
    subject: EntityRef,
    accession: str,
) -> SimilarProtein:
    hit = group.best
    entry = group.pdb_entry
    target_accession = group.accession
    gene_symbol, protein_name = genes.get(target_accession or "", (None, None))
    title = hit.target_label
    if entry is not None:
        title = (entry.get("struct") or {}).get("title") or title
    structure_id = None
    origin = None
    # An experimental entry is preferred: it is the one with molecules actually observed bound
    if group.pdb_hit is not None and group.pdb_hit.pdb_id:
        structure_id, origin = f"pdb:{group.pdb_hit.pdb_id}", StructureOrigin.EXPERIMENTAL
    elif hit.afdb_entry_id:
        structure_id, origin = f"afdb:{hit.afdb_entry_id}", StructureOrigin.PREDICTED_EXTERNAL
    protein = (
        EntityRef.of(
            EntityType.PROTEIN,
            target_accession,
            label=gene_symbol or protein_name or title,
            curie=f"uniprot:{target_accession}",
        )
        if target_accession
        else None
    )
    evidence: Evidence | None = None
    if provenance is not None:
        evidence = try_build_evidence(
            provenance,
            record_type="fold_similarity",
            record_id=f"{hit.database}/{hit.target.split(' ')[0]}",
            subject=subject,
            predicate="has_similar_fold_to",
            object=EvidenceObject(
                type="protein",
                id=f"uniprot:{target_accession}" if target_accession else structure_id,
                label=title or hit.target,
                value=hit.evalue,
                unit="E-value",
                context=[{"database": hit.database, "bit_score": hit.bit_score}],
            ),
            statement=(
                f"Foldseek aligned {hit.aligned_length} residues of {accession} to {hit.target} "
                f"with E-value {hit.evalue} and bit score {hit.bit_score}."
            ),
            strength_value=hit.evalue,
            strength_scheme="foldseek_evalue",
        )
    return SimilarProtein(
        id=f"{hit.database}:{hit.target.split(' ')[0]}",
        database=hit.database,
        database_label=DATABASE_LABELS.get(hit.database, hit.database),
        target=hit.target,
        title=title,
        protein=protein,
        gene_symbol=gene_symbol,
        structure_id=structure_id,
        structure_origin=origin,
        pdb_chain=(group.pdb_hit or hit).pdb_chain,
        organism=hit.tax_name,
        is_same_protein=_is_same_protein(hit, accession),
        alignment_count=group.alignment_count,
        metrics=_metrics(hit),
        query_aligned=(
            AlignedRange(start=hit.query_start, end=hit.query_end)
            if hit.query_start and hit.query_end
            else None
        ),
        target_aligned=(
            AlignedRange(start=hit.target_start, end=hit.target_end)
            if hit.target_start and hit.target_end
            else None
        ),
        observed_ligands=_entry_ligands(entry) if entry else [],
        evidence=evidence,
    )


async def similar_structures(
    accession: str, limit: int = DEFAULT_LIMIT, *, deadline_seconds: float = DEFAULT_DEADLINE_SECONDS
) -> SimilarStructures:
    """GET /structures/similar: fold neighbours of a protein, with every metric named."""
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.", code="invalid_accession")
    limit = max(1, min(limit, MAX_LIMIT))

    lookup = await fold_neighbours(accession, deadline_seconds=deadline_seconds)
    subject = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
    search = lookup.search
    if search is None:
        return SimilarStructures(
            protein=subject,
            query_structure_id=f"afdb:AF-{accession}-F1",
            query_structure_origin=StructureOrigin.PREDICTED_EXTERNAL,
            status=lookup.status,  # type: ignore[arg-type]
            status_detail=lookup.detail,
            retry_after_seconds=RETRY_AFTER_SECONDS if lookup.status == "pending" else None,
            service_url=foldseek.homepage,
            limits=LIMITS,
            sources=_merge_statuses(lookup.statuses),
        )

    ranked = _candidate_hits(search, accession)
    entries, rcsb_status = await _resolve_pdb_entries(ranked[: limit * WORKING_SET_FACTOR])
    groups = _group_by_protein(ranked, entries, accession)[:limit]
    genes, gene_statuses = await _gene_symbols(
        [group.accession for group in groups if group.accession is not None]
    )

    statuses = _merge_statuses(list(lookup.statuses) + gene_statuses + ([rcsb_status] if rcsb_status else []))
    return SimilarStructures(
        protein=subject,
        query_structure_id=search.query_structure_id,
        query_structure_origin=StructureOrigin.PREDICTED_EXTERNAL,
        query_length=search.query_length,
        status="ready",
        service_url=foldseek.homepage,
        mode=search.mode,
        mode_note=MODE_NOTES.get(search.mode),
        databases=[DATABASE_LABELS.get(name, name) for name in search.databases],
        from_cached_example=search.from_cached_example,
        cached_retrieved_at=search.retrieved_at,
        total_hits=search.total_hits,
        ranking_rule=RANKING_RULE,
        similar=[_similar_row(group, genes, lookup.provenance, subject, accession) for group in groups],
        metric_names=[name for name, _ in HIT_METRIC_FIELDS],
        limits=LIMITS,
        sources=statuses,
    )


# Pocket-level comparison


POCKET_PENDING_DETAIL = (
    "PrankWeb is still predicting pockets on one of the two proteins. The fold comparison above is "
    "complete; ask again in a few seconds for the pocket comparison."
)


@dataclass(slots=True)
class AnaloguePockets:
    """Pockets of one protein plus the ligands observed bound to it, ready for comparison."""

    status: str
    detail: str | None = None
    pockets: list[tuple[str, float | None, set[int]]] = field(default_factory=list)
    residues: dict[int, str | None] = field(default_factory=dict)
    structure_id: str | None = None
    experimental_structure_id: str | None = None
    ligands: list[ObservedLigand] = field(default_factory=list)
    ligand_positions: dict[int, tuple[str, ...]] = field(default_factory=dict)
    statuses: list[SourceStatus] = field(default_factory=list)


async def _pockets_of(accession: str) -> AnaloguePockets:
    """Predicted pockets of a protein, read through the existing /proteins/{accession}/pockets path."""
    from helix.services.pockets import protein_pockets

    try:
        response = await protein_pockets(accession, None, None)
    except Exception as error:
        logger.warning("Pockets for %s unavailable: %s", accession, error)
        return AnaloguePockets(status="unavailable", detail=f"Pockets for {accession} are unavailable.")
    residues: dict[int, str | None] = {}
    pockets: list[tuple[str, float | None, set[int]]] = []
    for pocket in response.pockets:
        pockets.append((pocket.id, pocket.probability, set(pocket.positions)))
        for residue in pocket.residues:
            residues.setdefault(residue.position, residue.residue)
    return AnaloguePockets(
        status=response.status,
        detail=response.status_detail,
        pockets=pockets,
        residues=residues,
        structure_id=response.structure_id,
        statuses=list(response.sources),
    )


async def _observed_ligands(
    accession: str, *, prefer: str | None = None, max_entries: int = 2
) -> AnaloguePockets:
    """Molecules RCSB PDB records as bound in an experimental entry of this protein.

    The entry Foldseek itself aligned to is read first when one is given, because that is the entry
    the fold comparison is about and it is often the one holding an inhibitor. PDBe's best_structures
    ranking supplies the rest. Ligands and the residues they contact come from the existing
    /structures/{id}/ligands path, which maps those residues to UniProt numbering.
    """
    from helix.services.structures import structure_ligands

    found = AnaloguePockets(status="ready")
    candidates: list[str] = []
    if prefer:
        kind, _, value = prefer.partition(":")
        candidates.append(f"{kind.lower()}:{value.upper()}")
    best = await pdbe.best_structures(accession)
    found.statuses.append(best.status())
    for chain in best.data or []:
        structure = f"pdb:{chain.pdb_id.upper()}"
        if structure not in candidates:
            candidates.append(structure)
    if not candidates:
        found.status = "not_applicable"
        found.detail = (
            f"PDBe lists no experimental structure of {accession}, so no bound molecule can be shown."
        )
        return found
    for structure in candidates[:max_entries]:
        try:
            ligands = await structure_ligands(structure, accession)
        except Exception as error:
            logger.warning("Ligands for %s unavailable: %s", structure, error)
            continue
        found.statuses.extend(ligands.sources)
        found.experimental_structure_id = found.experimental_structure_id or structure
        for ligand in ligands.ligands:
            positions = sorted(ligand.binding_site_positions or [])
            found.ligands.append(
                ObservedLigand(
                    comp_id=ligand.comp_id,
                    name=ligand.name,
                    inchikey=ligand.inchikey,
                    smiles=ligand.smiles,
                    formula=ligand.formula,
                    structure_id=structure,
                    common_additive=ligand.common_additive,
                    binding_site_positions=positions,
                    url=ligand.url,
                )
            )
            # Crystallisation additives stay in the list, flagged, but are kept out of the counts:
            # a glycerol in a groove is not a molecule anyone designed to bind there
            if ligand.common_additive:
                continue
            for position in positions:
                found.ligand_positions[position] = tuple(
                    sorted({*found.ligand_positions.get(position, ()), ligand.comp_id})
                )
    # Designed binders first, additives last: the list is read top-down
    found.ligands.sort(key=lambda ligand: (ligand.common_additive, -len(ligand.binding_site_positions)))
    if not found.ligands:
        found.detail = (
            f"RCSB PDB lists no non-polymer molecule bound in the experimental entries of {accession} "
            "that Helix read."
        )
    return found


def _pair(match: PocketMatch, analogue_label: str) -> PocketPair:
    return PocketPair(
        subject_pocket_id=match.subject_pocket_id,
        subject_pocket_probability=match.subject_pocket_probability,
        subject_positions=match.subject_positions,
        analogue_pocket_id=match.analogue_pocket_id,
        analogue_pocket_probability=match.analogue_pocket_probability,
        analogue_positions=match.analogue_positions,
        shared_residues=[
            SharedResidue(
                subject_position=item.subject_position,
                subject_residue=item.subject_residue,
                analogue_position=item.analogue_position,
                analogue_residue=item.analogue_residue,
                same_residue=item.same_residue,
                in_analogue_pocket=item.in_analogue_pocket,
                contacts_analogue_ligand=list(item.ligand_comp_ids),
            )
            for item in match.matches
        ],
        aligned_count=match.aligned_count,
        in_analogue_pocket_count=match.in_pocket_count,
        identical_residue_count=match.identical_count,
        ligand_contact_count=match.ligand_contact_count,
        shares=pocket_shares(match, analogue_label),
    )


def _hit_for(search: FoldSearch, analogue: str) -> FoldHit | None:
    """The best-ranked hit of this search that is the given protein, alignment strings preferred."""
    found: FoldHit | None = None
    for hit in search.hits:
        if hit.uniprot_accession and hit.uniprot_accession.split("-")[0] == analogue.upper():
            if hit.query_alignment:
                return hit
            found = found or hit
    return found


async def pocket_similarity(
    structure_id: str,
    analogue_accession: str,
    *,
    prefer_structure_id: str | None = None,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
) -> PocketSimilarity:
    """GET /structures/{structure_id}/pocket-similarity: one subject structure against one protein."""
    parsed = parse_structure_id(structure_id)
    if parsed is None:
        raise BadRequest(
            "structure_id must be pdb:<ID>, afdb:<entryId> or of:<job_id>.", code="invalid_structure_id"
        )
    kind, value = parsed
    analogue = analogue_accession.strip().upper()
    if not is_uniprot_accession(analogue):
        raise BadRequest(f"{analogue} is not a UniProt accession.", code="invalid_accession")

    subject_accession = _accession_of(kind, value)
    if subject_accession is None:
        raise BadRequest(
            "Pocket comparison needs the AlphaFold DB model of the subject protein "
            "(afdb:AF-<accession>-F1), because both sides must be numbered as in UniProt.",
            code="unsupported_structure",
        )
    subject = EntityRef.of(EntityType.PROTEIN, subject_accession, curie=f"uniprot:{subject_accession}")
    analogue_ref = EntityRef.of(
        EntityType.PROTEIN,
        analogue,
        label=_gene_from_catalog(analogue),
        curie=f"uniprot:{analogue}",
    )
    response = PocketSimilarity(
        subject=subject,
        subject_structure_id=structure_id,
        subject_structure_origin=StructureOrigin.PREDICTED_EXTERNAL,
        analogue=analogue_ref,
        status="unavailable",
        residue_correspondence=RESIDUE_CORRESPONDENCE_RULE,
        caveats=list(CAVEATS),
        limits=LIMITS,
    )

    lookup = await fold_neighbours(subject_accession, deadline_seconds=deadline_seconds)
    response.sources = list(lookup.statuses)
    if lookup.search is None:
        response.status = lookup.status  # type: ignore[assignment]
        response.status_detail = lookup.detail
        response.retry_after_seconds = RETRY_AFTER_SECONDS if lookup.status == "pending" else None
        return response

    hit = _hit_for(lookup.search, analogue)
    if hit is None:
        response.status = "not_applicable"
        response.status_detail = (
            f"The Foldseek search of {subject_accession} did not return {analogue} among its hits, so "
            "there is no structural alignment to compare pockets through."
        )
        return response
    response.fold_metrics = _metrics(hit)
    analogue_label = analogue_ref.label or analogue
    response.shares = fold_shares(
        analogue_label,
        evalue=hit.evalue,
        bit_score=hit.bit_score,
        sequence_identity=hit.sequence_identity_percent,
        aligned_length=hit.aligned_length,
        subject_length=lookup.search.query_length,
        mode=lookup.search.mode,
        query_start=hit.query_start,
        query_end=hit.query_end,
    )
    correspondence = hit.residue_map()
    if not correspondence:
        response.status = "not_applicable"
        response.status_detail = (
            "The stored copy of this search does not carry the alignment of this hit, so subject "
            "residues cannot be mapped onto the similar protein. Fold-level measures are shown above."
        )
        return response

    subject_pockets, analogue_pockets, ligands = await asyncio.gather(
        _pockets_of(subject_accession),
        _pockets_of(analogue),
        _observed_ligands(analogue, prefer=prefer_structure_id),
    )
    response.sources += subject_pockets.statuses + analogue_pockets.statuses + ligands.statuses
    response.analogue_structure_id = analogue_pockets.structure_id
    response.analogue_experimental_structure_id = ligands.experimental_structure_id
    response.observed_ligands = ligands.ligands

    if subject_pockets.status != "ready" or analogue_pockets.status != "ready":
        pending = "pending" in (subject_pockets.status, analogue_pockets.status)
        response.status = "pending" if pending else "unavailable"
        response.status_detail = (
            POCKET_PENDING_DETAIL
            if pending
            else (subject_pockets.detail or analogue_pockets.detail or "Pockets are unavailable.")
        )
        response.retry_after_seconds = RETRY_AFTER_SECONDS if pending else None
        return response

    pairs = [
        _pair(
            match_pocket(
                pocket_id,
                probability,
                sorted(positions),
                subject_pockets.residues,
                correspondence,
                analogue_pockets.pockets,
                ligands.ligand_positions,
            ),
            analogue_label,
        )
        for pocket_id, probability, positions in subject_pockets.pockets
    ]
    pairs.sort(key=lambda pair: (-pair.ligand_contact_count, -pair.in_analogue_pocket_count))
    response.pocket_pairs = pairs
    for ligand in response.observed_ligands:
        contacted = {
            residue.subject_position
            for pair in pairs
            for residue in pair.shared_residues
            if ligand.comp_id in residue.contacts_analogue_ligand
        }
        ligand.positions_shared_with_subject_pocket = sorted(contacted)
    response.status = "ready"
    return response


def _accession_of(kind: str, value: str) -> str | None:
    """UniProt accession behind an AlphaFold DB entry ID. Only AFDB models are numbered as UniProt."""
    import re

    if kind != "afdb":
        return None
    match = re.match(r"^AF-([A-Z0-9]+?)(?:-\d+)?-F\d+$", value.upper())
    return match.group(1) if match else None


# The one function the discovery engine imports


ANALOGUE_CAVEAT_NO_POCKET = (
    "Only the folds were compared for this protein, not the pockets, so nothing here says the two "
    "proteins share a place a molecule could sit."
)
ANALOGUE_CAVEAT_NO_LIGAND = (
    "No molecule has been observed bound to this protein in the experimental entries Helix read, so "
    "there is no known binder to carry across."
)
ANALOGUE_CAVEAT_ADDITIVE_ONLY = (
    "The molecules observed bound to this protein are crystallisation additives, not designed binders."
)
ANALOGUE_CAVEAT_NON_HUMAN = (
    "This protein is not human, so a molecule that binds it may not behave the same way on the human protein."
)

# A bridge is only offered for alignments at least this good. The browsing endpoint still lists
# weaker hits, each labelled with its own E-value.
MAX_BRIDGE_EVALUE = 1e-3
SIGNIFICANCE_LIMIT = (
    f"Only proteins whose Foldseek E-value is {MAX_BRIDGE_EVALUE:g} or better are offered as a "
    "structural bridge. A weaker resemblance is listed under the protein's structures but is not "
    "turned into a candidate."
)


def _significant(row: SimilarProtein) -> bool:
    evalue = next((metric.value for metric in row.metrics if metric.name == "foldseek_evalue"), None)
    return evalue is not None and evalue <= MAX_BRIDGE_EVALUE


async def structural_analogue_bridges(
    accession: str,
    *,
    limit: int = 6,
    compare_pockets: int = 2,
    deadline_seconds: float = 8.0,
) -> StructuralAnalogueBridges:
    """Structural-analogue bridges for one protein: the discovery engine's only entry point here.

    accession: UniProt accession of the subject protein, e.g. O00329 for PIK3CD.
    limit: how many analogues to return, in the order Foldseek ranked them.
    compare_pockets: how many of those get residue-level pocket comparison and bound-ligand lookup.
        The rest come back with fold measures only and `pocket_compared=False`.
    deadline_seconds: hard ceiling on the whole call. Nothing waits out Foldseek's 50 s submission
        interval, and a search that is still running comes back as status "pending" with
        `retry_after_seconds` set, never as an error.

    Every analogue is a hypothesis for the engine to test against direction of effect; this function
    makes no claim about what a molecule would do to the subject protein. The engine must still run
    its own direction check on each `observed_ligand` before a candidate is ranked.
    """
    accession = accession.strip().upper()
    subject = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
    bridges = StructuralAnalogueBridges(subject=subject, status="unavailable", limits=LIMITS)
    if not is_uniprot_accession(accession):
        bridges.status = "not_applicable"
        bridges.status_detail = f"{accession} is not a UniProt accession."
        return bridges

    started = time.monotonic()
    listing = await similar_structures(
        accession, limit=limit, deadline_seconds=min(deadline_seconds, DEFAULT_DEADLINE_SECONDS)
    )
    bridges.subject_structure_id = listing.query_structure_id
    bridges.sources = list(listing.sources)
    bridges.status = listing.status
    bridges.status_detail = listing.status_detail
    bridges.retry_after_seconds = listing.retry_after_seconds
    if listing.status != "ready":
        return bridges

    wanted = [row for row in listing.similar if row.protein is not None and _significant(row)]
    if not wanted:
        bridges.limits = [*bridges.limits, SIGNIFICANCE_LIMIT]
    compared: dict[str, PocketSimilarity] = {}
    for row in wanted[: max(0, compare_pockets)]:
        if time.monotonic() - started > deadline_seconds:
            break
        assert row.protein is not None
        detail = await pocket_similarity(
            listing.query_structure_id,
            row.protein.id,
            prefer_structure_id=row.structure_id if (row.structure_id or "").startswith("pdb:") else None,
            deadline_seconds=max(1.0, deadline_seconds - (time.monotonic() - started)),
        )
        compared[row.protein.id] = detail
        bridges.sources += detail.sources

    for row in wanted:
        assert row.protein is not None
        detail = compared.get(row.protein.id)
        bridges.analogues.append(_analogue(accession, listing, row, detail))
    bridges.status = "ready"
    bridges.sources = _merge_statuses(bridges.sources)
    return bridges


def _analogue(
    accession: str, listing: SimilarStructures, row: SimilarProtein, detail: PocketSimilarity | None
) -> StructuralAnalogue:
    assert row.protein is not None
    label = row.gene_symbol or row.protein.label or row.protein.id
    shares = fold_shares(
        label,
        evalue=next((metric.value for metric in row.metrics if metric.name == "foldseek_evalue"), None),
        bit_score=next((metric.value for metric in row.metrics if metric.name == "foldseek_bit_score"), None),
        sequence_identity=next(
            (metric.value for metric in row.metrics if metric.name == "sequence_identity"), None
        ),
        aligned_length=next(
            (metric.value for metric in row.metrics if metric.name == "aligned_length"), None
        ),
        subject_length=listing.query_length,
        mode=listing.mode or MODE_3DIAA,
        query_start=row.query_aligned.start if row.query_aligned else None,
        query_end=row.query_aligned.end if row.query_aligned else None,
    )
    caveats = list(CAVEATS)
    if row.organism and row.organism != "Homo sapiens":
        caveats.insert(0, ANALOGUE_CAVEAT_NON_HUMAN)

    best = None
    ligands: list[ObservedLigand] = []
    if detail is not None and detail.status == "ready":
        best = detail.pocket_pairs[0] if detail.pocket_pairs else None
        ligands = [ligand for ligand in detail.observed_ligands if not ligand.common_additive]
        if best is not None:
            shares += best.shares
        if not detail.observed_ligands:
            caveats.insert(0, ANALOGUE_CAVEAT_NO_LIGAND)
        elif not ligands:
            caveats.insert(0, ANALOGUE_CAVEAT_ADDITIVE_ONLY)
    else:
        caveats.insert(0, ANALOGUE_CAVEAT_NO_POCKET)
        if detail is not None and detail.status_detail:
            caveats.insert(1, detail.status_detail)

    evidence = [row.evidence] if row.evidence is not None else []
    evidence += [ligand.evidence for ligand in ligands if ligand.evidence is not None]
    return StructuralAnalogue(
        id=f"structural_analogue:{accession}:{row.id}",
        protein=row.protein,
        gene_symbol=row.gene_symbol,
        name=row.title,
        organism=row.organism,
        fold_metrics=row.metrics,
        shares=shares,
        subject_structure_id=listing.query_structure_id,
        subject_pocket_id=best.subject_pocket_id if best else None,
        subject_pocket_positions=best.subject_positions if best else [],
        analogue_structure_id=(detail.analogue_structure_id if detail else row.structure_id),
        analogue_pocket_id=best.analogue_pocket_id if best else None,
        analogue_positions=best.analogue_positions if best else [],
        observed_ligands=ligands,
        pocket_compared=best is not None,
        evidence=evidence,
        caveats=caveats,
    )
