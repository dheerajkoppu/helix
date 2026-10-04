"""What every bridge is given, and what every bridge hands back.

A bridge is one function. It receives a BridgeContext (the resolved subject, the required-action
rule, the direct edges that may have to be withheld) and returns a BridgeOutput: rows that passed
the direction filter, rows the filter removed, the SourceResults it consulted, and whether it ran
partially. A bridge never raises for an upstream failure and never fails the request.
"""

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from helix.knowledge.catalog import Catalog, SeedDisease
from helix.schemas.common import Evidence, SourceStatus
from helix.schemas.discovery import (
    ActionRule,
    Bridge,
    BridgeKind,
    CandidateMolecule,
    CandidateStructure,
    CandidateTarget,
    DirectionCheck,
    Subject,
    WithheldEdge,
)
from helix.sources.base import Gathered, SourceResult

if TYPE_CHECKING:
    from helix.discovery.targets import ProteinActions

BRIDGE_LABELS: dict[BridgeKind, str] = {
    "same_target": "A molecule that acts on this very protein",
    "pathway_node": "A druggable protein up or down the pathway",
    "interaction_partner": "A druggable protein this one binds",
    "structural_analogue": "A protein with a similar pocket that has a known binder",
    "mechanism_class": "A disease with the same mechanism where a drug class is established",
}

# How directly the bridge connects the molecule to the subject. Used for ranking only.
BRIDGE_DIRECTNESS: dict[BridgeKind, int] = {
    "same_target": 0,
    "pathway_node": 1,
    "interaction_partner": 2,
    "structural_analogue": 3,
    "mechanism_class": 4,
}


@dataclass(slots=True)
class DirectEdge:
    """An edge that links the subject disease straight to a molecule."""

    edge: WithheldEdge
    molecule_chembl_id: str | None


@dataclass(slots=True)
class BridgeContext:
    subject: Subject
    rule: ActionRule
    catalog: Catalog
    diseases_in_scope: list[SeedDisease]
    exclude_direct: bool
    direct_edges: list[DirectEdge] = field(default_factory=list)
    # Populated by the engine once, so several bridges can read the subject's own ChEMBL records
    shared: dict[str, Any] = field(default_factory=dict)

    @property
    def accession(self) -> str | None:
        return self.subject.accession

    @property
    def subject_label(self) -> str:
        disease = self.subject.disease
        if disease is not None and disease.label:
            return disease.label
        return self.subject.gene_symbol

    def direct_molecules(self) -> set[str]:
        return {edge.molecule_chembl_id for edge in self.direct_edges if edge.molecule_chembl_id}

    def direct_edge_for(self, chembl_id: str) -> DirectEdge | None:
        return next((edge for edge in self.direct_edges if edge.molecule_chembl_id == chembl_id), None)

    async def protein_actions(self, accession: str) -> "ProteinActions":
        """ChEMBL's records for one protein, fetched once per request however many bridges ask.

        Bridges land on the same protein often: the subject's own protein is wanted by two of them,
        and a pathway node is frequently also a curated partner. Each asker gets the same object.
        The task is shielded, so one bridge's timeout never cancels the fetch another is waiting on.
        """
        from helix.discovery.targets import protein_actions

        tasks: dict[str, asyncio.Task[ProteinActions]] = self.shared.setdefault("protein_action_tasks", {})
        task = tasks.get(accession)
        if task is None:
            task = asyncio.ensure_future(protein_actions(accession))
            task.add_done_callback(lambda done: done.cancelled() or done.exception())
            tasks[accession] = task
        return await asyncio.shield(task)

    def release_protein_actions(self) -> None:
        """Drop any fetch no bridge waited for, once the bridges are done."""
        for task in (self.shared.get("protein_action_tasks") or {}).values():
            if not task.done():
                task.cancel()


@dataclass(slots=True)
class CandidateRow:
    """A candidate before ranking. The engine fills in id and rank."""

    key: str
    target: CandidateTarget
    molecule: CandidateMolecule | None
    bridge: Bridge
    direction_check: DirectionCheck
    structure: CandidateStructure | None = None
    caveats: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    # Ranking inputs, never published as a score
    source_count: int = 1
    max_phase: float | None = None
    target_is_exact_protein: bool = False
    affinity: float | None = None


@dataclass(slots=True)
class RuledOutRow:
    key: str
    molecule: CandidateMolecule
    target: CandidateTarget
    bridge_kind: BridgeKind
    reason: str
    direction_check: DirectionCheck
    evidence: list[Evidence] = field(default_factory=list)


@dataclass(slots=True)
class BridgeOutput:
    candidates: list[CandidateRow] = field(default_factory=list)
    ruled_out: list[RuledOutRow] = field(default_factory=list)
    results: dict[str, SourceResult[Any]] = field(default_factory=dict)
    # Rows an existing service already built, for bridges that reuse one
    statuses: list[SourceStatus] = field(default_factory=list)
    partial: bool = False
    partial_reason: str | None = None
    message: str | None = None

    @property
    def sources(self) -> list[SourceStatus]:
        return [*Gathered(self.results).sources, *self.statuses]
