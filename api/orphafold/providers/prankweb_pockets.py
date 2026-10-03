"""PrankWeb pocket provider: P2Rank predictions for a PDB entry or an AlphaFold DB model.

AlphaFold DB models are already in UniProt numbering. PDB entries come back in author numbering
and are mapped to UniProt positions through SIFTS; a residue outside every mapped segment is
counted and left out, never guessed.
"""

from dataclasses import dataclass, field
from typing import Any

from orphafold.identifiers import parse_structure_id
from orphafold.providers.base import (
    Availability,
    Capability,
    ExecutionMode,
    ModelIdentity,
    Pocket,
    PocketProvider,
    PocketRequest,
    PocketResidue,
    PocketResult,
    ProviderError,
    RunContext,
    register_provider,
)
from orphafold.sources.base import SourceResult
from orphafold.sources.pdbe import SiftsSegment, pdbe
from orphafold.sources.prankweb import DATABASE_ALPHAFOLD, DATABASE_PDB, prankweb

PENDING_STATES = frozenset({"queued", "running"})
SIFTS_NOTE = (
    "PDB residue numbers are mapped from author numbering to UniProt positions through SIFTS; "
    "residues outside every mapped segment are left out."
)


@dataclass(slots=True)
class PocketLookup:
    status: str
    detail: str | None = None
    database: str | None = None
    identifier: str | None = None
    pockets: list[Pocket] = field(default_factory=list)
    p2rank_version: str | None = None
    results: dict[str, SourceResult[Any]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _split(residue: str) -> tuple[str, int] | None:
    chain, _, number = residue.rpartition("_")
    try:
        return chain, int(number)
    except ValueError:
        return None


def _sifts_map(segments: list[SiftsSegment], accession: str) -> dict[str, list[tuple[int, int, int]]]:
    """Per chain: (first author number, last author number, offset to UniProt numbering)."""
    by_chain: dict[str, list[tuple[int, int, int]]] = {}
    for segment in segments:
        if segment.uniprot_accession != accession:
            continue
        length = segment.unp_end - segment.unp_start
        start, end = segment.author_start, segment.author_end
        # SIFTS leaves an end null when that residue is unobserved; the other end anchors the segment
        if start is None and end is None:
            continue
        if start is not None and end is not None and end - start != length:
            continue
        first = start if start is not None else end - length  # type: ignore[operator]
        by_chain.setdefault(segment.chain_id, []).append((first, first + length, segment.unp_start - first))
    return by_chain


def _to_uniprot(chain: str, number: int, mapping: dict[str, list[tuple[int, int, int]]] | None) -> int | None:
    if mapping is None:
        return number
    for first, last, offset in mapping.get(chain, []):
        if first <= number <= last:
            return number + offset
    return None


def parse_pockets(
    payload: dict[str, Any],
    mapping: dict[str, list[tuple[int, int, int]]] | None,
    *,
    predicted_structure: bool,
) -> list[Pocket]:
    structure = payload.get("structure") or {}
    indices: list[str] = structure.get("indices") or []
    sequence: str = structure.get("sequence") or ""
    plddt: list[float] = (structure.get("scores") or {}).get("plddt") or []
    position_of = {name: index for index, name in enumerate(indices)}
    pockets = []
    for row in payload.get("pockets") or []:
        residues: list[PocketResidue] = []
        unmapped = 0
        confidences: list[float] = []
        for name in row.get("residues") or []:
            parts = _split(name)
            position = _to_uniprot(parts[0], parts[1], mapping) if parts else None
            if parts is None or position is None:
                unmapped += 1
                continue
            index = position_of.get(name)
            letter = sequence[index] if index is not None and index < len(sequence) else None
            residues.append(PocketResidue(chain=parts[0], position=position, residue=letter))
            if predicted_structure and index is not None and index < len(plddt):
                confidences.append(float(plddt[index]))
        center = [_number(value) for value in row.get("center") or []]
        rank = int(_number(row.get("rank")) or len(pockets) + 1)
        pockets.append(
            Pocket(
                id=row.get("name") or f"pocket{rank}",
                rank=rank,
                residues=sorted(residues, key=lambda residue: (residue.chain, residue.position)),
                score=_number(row.get("probability")),
                score_name="P2Rank probability",
                center=tuple(center) if len(center) == 3 and None not in center else None,  # type: ignore[arg-type]
                provider_native={
                    "name": row.get("name"),
                    "score": _number(row.get("score")),
                    "probability": _number(row.get("probability")),
                    "structure_residues": list(row.get("residues") or []),
                    "unmapped_residue_count": unmapped,
                    "mean_plddt": round(sum(confidences) / len(confidences), 2) if confidences else None,
                },
            )
        )
    return sorted(pockets, key=lambda pocket: pocket.rank)


@register_provider
class PrankWebPocketProvider(PocketProvider):
    id = "prankweb"
    name = "PrankWeb"
    model_name = "P2Rank"
    model_version = "2.5.1"
    license = "Apache-2.0"
    commercial_use = True
    capabilities = (Capability.POCKETS,)
    execution_mode = ExecutionMode.REMOTE_API
    limitations = (
        "A predicted pocket is a computational prediction, not a measured binding site.",
        "Only PDB entries and AlphaFold DB models can be analysed; OrphaFold-generated structures cannot.",
        SIFTS_NOTE,
    )
    homepage = "https://prankweb.cz"
    attribution = "PrankWeb (cusbg/prankweb), running P2Rank (rdk/p2rank)"

    async def check_availability(self) -> Availability:
        gate = prankweb.gate()
        if gate is not None:
            return Availability(available=False, reason=f"The PrankWeb source is {gate.value}.")
        return Availability(available=True, reason="Remote PrankWeb service; no local compute needed.")

    async def lookup(self, structure_id: str, accession: str) -> PocketLookup:
        """Poll or read one prediction. The first request for a structure starts it at PrankWeb."""
        parsed = parse_structure_id(structure_id)
        if parsed is None or parsed[0] == "of":
            raise ProviderError(
                "unsupported_structure",
                "PrankWeb analyses PDB entries (pdb:<ID>) and AlphaFold DB models (afdb:<entryId>) only.",
            )
        kind, value = parsed
        database, identifier = (
            (DATABASE_PDB, value.upper()) if kind == "pdb" else (DATABASE_ALPHAFOLD, accession)
        )
        task = await prankweb.task(database, identifier)
        lookup = PocketLookup(
            status="unavailable", database=database, identifier=identifier, results={"task": task}
        )
        if not task.ok or not isinstance(task.data, dict):
            lookup.detail = task.message or "PrankWeb did not answer."
            return lookup
        state = str(task.data.get("status") or "")
        if state in PENDING_STATES:
            lookup.status = "pending"
            lookup.detail = f"PrankWeb task is {state}. A prediction usually takes under a minute."
            return lookup
        if state != "successful":
            lookup.status = "failed"
            lookup.detail = f"PrankWeb reports the task as {state or 'unknown'}."
            return lookup

        prediction = await prankweb.prediction(database, identifier)
        lookup.results["prediction"] = prediction
        if not prediction.ok or prediction.data is None:
            lookup.detail = prediction.message or "PrankWeb has no prediction file for this structure."
            return lookup
        mapping = None
        if kind == "pdb":
            segments = await pdbe.uniprot_mappings(identifier)
            lookup.results["sifts"] = segments
            if not segments.ok or not segments.data:
                lookup.detail = "PDBe SIFTS did not return a residue mapping, so pockets cannot be numbered."
                return lookup
            mapping = _sifts_map(segments.data, accession)
            if not mapping:
                lookup.status = "failed"
                lookup.detail = f"PDB entry {identifier} has no chain mapped to {accession} in SIFTS."
                return lookup
        lookup.pockets = parse_pockets(prediction.data, mapping, predicted_structure=kind == "afdb")
        lookup.p2rank_version = (prediction.data.get("metadata") or {}).get("p2rank_version")
        dropped = sum(pocket.provider_native["unmapped_residue_count"] for pocket in lookup.pockets)
        if dropped:
            lookup.warnings.append(
                f"{dropped} pocket residues are outside the SIFTS mapping to {accession} and are not listed."
            )
        lookup.status = "ready"
        return lookup

    async def find(self, request: PocketRequest, context: RunContext) -> PocketResult:
        accession = str(request.parameters.get("uniprot_accession") or "")
        if not accession:
            raise ProviderError("missing_accession", "parameters.uniprot_accession is required.")
        lookup = await self.lookup(request.structure_id, accession)
        if lookup.status != "ready":
            raise ProviderError(f"pockets_{lookup.status}", lookup.detail or "No pockets available.")
        version = lookup.p2rank_version or self.model_version
        return PocketResult(
            pockets=lookup.pockets,
            model=ModelIdentity(
                provider=self.id,
                name=self.model_name,
                version=version,
                license=self.license,
                execution_mode=self.execution_mode,
            ),
            parameters={"database": lookup.database, "identifier": lookup.identifier},
            limitations=list(self.limitations),
            warnings=lookup.warnings,
        )
