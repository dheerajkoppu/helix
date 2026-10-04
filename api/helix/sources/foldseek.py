"""Foldseek Search Server: structure (fold) similarity of a protein against the PDB and AlphaFold DB.

Helix calls the hosted service over HTTP and bundles no Foldseek code (Foldseek itself is GPL-3.0).

Protocol, verified live on 2026-10-03 (docs/research/structure-models.md section 4.9):

    POST /api/ticket            multipart: q=<query structure file>, mode, database[]  -> {id, status}
    GET  /api/ticket/{id}       -> {status: PENDING | RUNNING | COMPLETE | ERROR | UNKNOWN}
    GET  /api/result/{id}/0     -> {type, queries[], mode, results[{db, alignments[[row]]}]}
                                (read by `hits()`; `result()` is the base class's own factory)

The submission rate limit is advertised on the response as x-rate-limit-limit: 0.02 over
x-rate-limit-duration: 1, i.e. **one submission per 50 s per IP**. The base class rate limiter
would honour that by sleeping inside the request, which would block a Helix page for most of a
minute, so this module gates submissions itself with a non-blocking clock: when the next submission
is not due yet, `submission_due_in()` returns the wait and the caller reports a pending state
instead of queueing. Nothing here ever sleeps for the rate limit.

Result bodies are large: a 659 aa query against two databases returned 25.8 MB because every row
carries the target's coordinates (`tCa`) and sequence (`tSeq`). Both are dropped on parse before
anything is stored, and rows are capped per database.
"""

import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from helix.evidence import EvidenceRule, register_evidence_rule
from helix.log import get_logger
from helix.schemas.common import EvidenceClass, SourceState
from helix.sources.base import SourceAdapter, SourceResult

logger = get_logger(__name__)

register_evidence_rule(
    EvidenceRule(
        database="foldseek",
        record_type="fold_similarity",
        evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
        eco="ECO:0007669",
        scheme="foldseek_evalue",
    )
)

FoldseekStatus = Literal["PENDING", "RUNNING", "COMPLETE", "ERROR", "UNKNOWN"]
PENDING_STATUSES = frozenset({"PENDING", "RUNNING"})

# pdb100 is the PDB at 100% identity clustering; afdb-swissprot is the reviewed AlphaFold DB subset
DATABASE_PDB = "pdb100"
DATABASE_AFDB_SWISSPROT = "afdb-swissprot"
DEFAULT_DATABASES = (DATABASE_PDB, DATABASE_AFDB_SWISSPROT)

DATABASE_LABELS = {
    DATABASE_PDB: "Protein Data Bank (pdb100)",
    DATABASE_AFDB_SWISSPROT: "AlphaFold DB, reviewed entries (afdb-swissprot)",
    "afdb50": "AlphaFold DB clustered at 50% identity (afdb50)",
    "afdb-proteome": "AlphaFold DB reference proteomes (afdb-proteome)",
    "cath50": "CATH domains (cath50)",
}

# 3diaa is the default structural alphabet + amino acid mode. It reports an E-value, a bit score and
# a homology probability. It does NOT report a TM-score; only mode=tmalign does, and that costs a
# second submission against the 50 s limit. Helix reports only what the mode it ran actually returned.
MODE_3DIAA = "3diaa"
MODE_TMALIGN = "tmalign"

# One submission per 50 s per IP; a little headroom so a retry is never refused by the service
SUBMISSION_INTERVAL_SECONDS = 52.0
TICKET_TTL_SECONDS = 7 * 24 * 3600
RESULT_TTL_SECONDS = 180 * 24 * 3600
MAX_HITS_PER_DATABASE = 120

# target looks like "AF-Q06187-F1-model_v6 Tyrosine-protein kinase BTK"
_AFDB_TARGET_RE = re.compile(r"^AF-([A-Z0-9]+(?:-\d+)?)-F(\d+)-model_v(\d+)")
# target looks like "3ihy-assembly5.cif.gz_E Human PIK3C3 crystal structure"
_PDB_TARGET_RE = re.compile(r"^([0-9][A-Za-z0-9]{3})(?:-assembly(\d+))?[^\s_]*_([A-Za-z0-9]+)")


@dataclass(frozen=True, slots=True)
class FoldHit:
    """One Foldseek alignment, with every number the service reported and nothing added."""

    database: str
    target: str
    target_label: str | None
    uniprot_accession: str | None
    pdb_id: str | None
    pdb_chain: str | None
    afdb_entry_id: str | None
    evalue: float | None
    bit_score: float | None
    homology_probability: float | None
    sequence_identity_percent: float | None
    aligned_length: int | None
    mismatches: int | None
    gaps_opened: int | None
    query_start: int | None
    query_end: int | None
    target_start: int | None
    target_end: int | None
    query_length: int | None
    target_length: int | None
    tax_id: int | None
    tax_name: str | None
    query_alignment: str | None = None
    target_alignment: str | None = None

    @property
    def is_self_hit(self) -> bool:
        """A query always finds its own AlphaFold DB entry; that is not a similar protein."""
        return self.sequence_identity_percent == 100 and self.query_length == self.target_length

    def residue_map(self) -> dict[int, tuple[int, str, str]]:
        """Subject position -> (target position, subject residue, target residue).

        Walks the two gapped alignment strings in step from the start positions Foldseek reported.
        Positions are 1-based in both. Only columns where neither side is a gap are returned, so no
        correspondence is ever invented across an insertion or a deletion.
        """
        if not self.query_alignment or not self.target_alignment:
            return {}
        if len(self.query_alignment) != len(self.target_alignment):
            return {}
        query_position = self.query_start or 1
        target_position = self.target_start or 1
        mapping: dict[int, tuple[int, str, str]] = {}
        for query_residue, target_residue in zip(self.query_alignment, self.target_alignment, strict=True):
            query_gap = query_residue == "-"
            target_gap = target_residue == "-"
            if not query_gap and not target_gap:
                mapping[query_position] = (target_position, query_residue, target_residue)
            if not query_gap:
                query_position += 1
            if not target_gap:
                target_position += 1
        return mapping


@dataclass(frozen=True, slots=True)
class FoldSearch:
    """A completed Foldseek search: the hits per database, with the mode and databases named."""

    uniprot_accession: str
    query_structure_id: str
    mode: str
    databases: tuple[str, ...]
    ticket: str | None
    query_length: int | None
    hits: tuple[FoldHit, ...]
    total_hits: dict[str, int]
    from_cached_example: bool = False
    retrieved_at: str | None = None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None


def parse_target(database: str, target: str) -> dict[str, Any]:
    """Split a Foldseek target name into the identifiers it carries. Nothing is guessed: a name that
    matches neither pattern yields no identifiers and the row is still reported with its metrics."""
    name, _, label = target.partition(" ")
    found: dict[str, Any] = {
        "target_label": label.strip() or None,
        "uniprot_accession": None,
        "pdb_id": None,
        "pdb_chain": None,
        "afdb_entry_id": None,
    }
    afdb = _AFDB_TARGET_RE.match(name)
    if afdb is not None:
        found["uniprot_accession"] = afdb.group(1).split("-")[0]
        found["afdb_entry_id"] = f"AF-{afdb.group(1)}-F{afdb.group(2)}"
        return found
    pdb = _PDB_TARGET_RE.match(name)
    if pdb is not None and database != DATABASE_AFDB_SWISSPROT:
        found["pdb_id"] = pdb.group(1).upper()
        found["pdb_chain"] = pdb.group(3)
    return found


def parse_hit(database: str, row: dict[str, Any]) -> FoldHit:
    target = str(row.get("target") or "")
    return FoldHit(
        database=database,
        target=target,
        **parse_target(database, target),
        evalue=_number(row.get("eval")),
        bit_score=_number(row.get("score")),
        homology_probability=_number(row.get("prob")),
        sequence_identity_percent=_number(row.get("seqId")),
        aligned_length=_integer(row.get("alnLength")),
        mismatches=_integer(row.get("missmatches")),
        gaps_opened=_integer(row.get("gapsopened")),
        query_start=_integer(row.get("qStartPos")),
        query_end=_integer(row.get("qEndPos")),
        target_start=_integer(row.get("dbStartPos")),
        target_end=_integer(row.get("dbEndPos")),
        query_length=_integer(row.get("qLen")),
        target_length=_integer(row.get("dbLen")),
        tax_id=_integer(row.get("taxId")),
        tax_name=(str(row["taxName"]) if row.get("taxName") else None),
        query_alignment=(str(row["qAln"]) if row.get("qAln") else None),
        target_alignment=(str(row["dbAln"]) if row.get("dbAln") else None),
    )


def parse_result(payload: dict[str, Any], *, max_per_database: int = MAX_HITS_PER_DATABASE) -> dict[str, Any]:
    """Trim a Foldseek result to the fields Helix keeps. Drops tCa and tSeq, which are most of the body."""
    query = (payload.get("queries") or [{}])[0]
    sequence = query.get("sequence")
    hits: list[FoldHit] = []
    totals: dict[str, int] = {}
    for block in payload.get("results") or []:
        database = str(block.get("db") or "")
        rows = (block.get("alignments") or [[]])[0] or []
        totals[database] = len(rows)
        hits.extend(parse_hit(database, row) for row in rows[:max_per_database])
    return {
        "mode": payload.get("mode"),
        "query_header": query.get("header"),
        "query_length": len(sequence) if isinstance(sequence, str) else None,
        "hits": hits,
        "total_hits": totals,
    }


class FoldseekSource(SourceAdapter):
    """Hosted Foldseek search. Submissions are gated by this module, not by the base rate limiter."""

    id = "foldseek"
    name = "Foldseek Search Server"
    base_url = "https://search.foldseek.com/api"
    homepage = "https://search.foldseek.com"
    license = "LicenseRef-Foldseek-Server"
    license_url = "https://github.com/steineggerlab/foldseek"
    attribution = (
        "Foldseek Search Server (Steinegger lab); van Kempen et al., Nat Biotechnol 2024. "
        "Targets are the Protein Data Bank and the AlphaFold Protein Structure Database."
    )
    timeout = 25.0
    max_concurrency = 1
    cache_ttl = RESULT_TTL_SECONDS
    empty_cache_ttl = 300
    empty_statuses = frozenset({204, 404})
    # The service is slow under load; one retry is enough and keeps a page from waiting twice
    max_retries = 1

    _last_submission_at: float = 0.0

    def record_url(self, record_id: str) -> str | None:
        """Foldseek results live behind a ticket, so the record page is the search front end."""
        return f"https://search.foldseek.com/queries/{record_id}" if record_id else None

    def submission_due_in(self) -> float:
        """Seconds until a new submission is allowed. 0 when one may be sent now.

        The service advertises one submission per 50 s per IP. Callers must treat a positive value
        as 'not now' and report a pending state; nothing in Helix waits out this interval.
        """
        if not self._last_submission_at:
            return 0.0
        return max(0.0, SUBMISSION_INTERVAL_SECONDS - (time.monotonic() - self._last_submission_at))

    async def submit(
        self,
        structure_bytes: bytes,
        *,
        filename: str,
        databases: tuple[str, ...] = DEFAULT_DATABASES,
        mode: str = MODE_3DIAA,
    ) -> SourceResult[dict[str, Any]]:
        """Start a search. The response is cached for a week, so the same query file reuses its
        ticket instead of spending another submission against the 50 s limit."""
        if self.submission_due_in() > 0:
            return self.result(
                SourceState.UNAVAILABLE,
                message=(
                    "Foldseek accepts one search every 50 seconds from one address and the last one "
                    f"was sent {SUBMISSION_INTERVAL_SECONDS - self.submission_due_in():.0f} seconds ago."
                ),
            )
        content, content_type = _multipart(structure_bytes, filename=filename, databases=databases, mode=mode)
        type(self)._last_submission_at = time.monotonic()
        return await self.post_json(
            "/ticket",
            content=content,
            headers={"Content-Type": content_type, "Accept": "application/json"},
            ttl=TICKET_TTL_SECONDS,
            timeout=60.0,
        )

    async def ticket(self, ticket_id: str) -> SourceResult[dict[str, Any]]:
        """Poll one ticket. Never cached: the status is the thing that changes."""
        return await self.get_json(f"/ticket/{ticket_id}", record_id=ticket_id, ttl=0, timeout=15.0)

    async def hits(self, ticket_id: str, entry: int = 0) -> SourceResult[dict[str, Any]]:
        """Hits of a completed search, trimmed on parse. Cached for six months: a fold does not move.

        Named `hits` rather than `result` because `SourceAdapter.result` is the base class's factory
        for a SourceResult and must not be shadowed.

        A caller that gives up waiting does not cancel the download (the base class shields it), so
        the body still reaches the cache and the next request reads it from there.
        """
        raw = await self.get_json(
            f"/result/{ticket_id}/{entry}", record_id=ticket_id, ttl=RESULT_TTL_SECONDS, timeout=120.0
        )
        return raw.map(parse_result)

    async def databases(self) -> SourceResult[list[dict[str, Any]]]:
        """Target databases the service currently offers, with their versions."""
        return await self.get_json("/databases/all", ttl=24 * 3600)


CACHED_DIRECTORY = "structure-similarity"
CACHED_SCHEMA = "helix.foldseek.fold_search.v1"


def cached_search(accession: str) -> FoldSearch | None:
    """A stored copy of a completed search, from data/examples/structure-similarity/<accession>.json.

    The flagship proteins and the control subjects are pre-cached so a demo never waits on the
    external queue. A stored copy is always labelled as one, with the date it was retrieved.
    """
    from helix.config import get_settings

    path = get_settings().examples_dir / CACHED_DIRECTORY / f"{accession.upper()}.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return None
    except ValueError:
        logger.warning("Stored Foldseek search %s is not valid JSON", path)
        return None
    if document.get("schema") != CACHED_SCHEMA:
        logger.warning("Stored Foldseek search %s has schema %s", path, document.get("schema"))
        return None
    hits: list[FoldHit] = []
    totals: dict[str, int] = {}
    for block in document.get("results") or []:
        database = str(block.get("database") or "")
        totals[database] = _integer(block.get("total_hits")) or 0
        hits.extend(parse_hit(database, row) for row in block.get("hits") or [])
    return FoldSearch(
        uniprot_accession=str(document.get("uniprot_accession") or accession).upper(),
        query_structure_id=str(document.get("query_structure_id") or f"afdb:AF-{accession.upper()}-F1"),
        mode=str(document.get("mode") or MODE_3DIAA),
        databases=tuple(document.get("databases") or DEFAULT_DATABASES),
        ticket=document.get("ticket"),
        query_length=_integer(document.get("query_length")),
        hits=tuple(hits),
        total_hits=totals,
        from_cached_example=True,
        retrieved_at=document.get("retrieved_at"),
    )


def cached_accessions() -> list[str]:
    """Accessions with a stored search, for /meta and for the controls to check."""
    from helix.config import get_settings

    directory = get_settings().examples_dir / CACHED_DIRECTORY
    try:
        return sorted(path.stem.upper() for path in directory.glob("*.json") if path.name != "index.json")
    except OSError:
        return []


def _multipart(
    structure_bytes: bytes, *, filename: str, databases: tuple[str, ...], mode: str
) -> tuple[bytes, str]:
    """Build the multipart body by hand.

    The base adapter has no files= passthrough, and a fixed boundary keeps the cache key stable:
    the same query file must hash to the same key so it reuses its ticket rather than resubmitting.
    """
    boundary = "helix-foldseek-boundary"
    while boundary.encode() in structure_bytes:
        boundary = f"helix-foldseek-{uuid.uuid4().hex}"
    marker = f"--{boundary}".encode()
    parts: list[bytes] = []
    for name, value in [("mode", mode), *(("database[]", database) for database in databases)]:
        parts += [marker, f'Content-Disposition: form-data; name="{name}"'.encode(), b"", value.encode()]
    parts += [
        marker,
        f'Content-Disposition: form-data; name="q"; filename="{filename}"'.encode(),
        b"Content-Type: chemical/x-pdb",
        b"",
        structure_bytes,
        f"--{boundary}--".encode(),
        b"",
    ]
    return b"\r\n".join(parts), f"multipart/form-data; boundary={boundary}"


foldseek = FoldseekSource()
