"""Predicted pockets of a protein structure."""

from typing import Literal

from pydantic import Field

from helix.schemas.common import (
    Aggregated,
    EntityRef,
    Evidence,
    EvidenceClass,
    Schema,
    StructureOrigin,
)

PocketStatus = Literal["ready", "pending", "failed", "unavailable"]


class PocketResidueRef(Schema):
    position: int = Field(description="UniProt canonical position")
    residue: str | None = Field(default=None, description="One-letter code as PrankWeb read it")
    chain: str = Field(description="Chain of the analysed structure")


class PocketMethod(Schema):
    provider: str
    provider_name: str
    model_name: str
    model_version: str | None = None
    service_url: str | None = None


class PredictedPocket(Schema):
    id: str
    rank: int
    name: str
    evidence_class: EvidenceClass = EvidenceClass.COMPUTATIONAL_PREDICTION
    probability: float | None = Field(default=None, description="P2Rank calibrated probability, 0 to 1")
    score: float | None = Field(default=None, description="P2Rank raw score")
    center: tuple[float, float, float] | None = Field(
        default=None, description="Pocket centre in the coordinate frame of the analysed structure, Å"
    )
    residues: list[PocketResidueRef]
    positions: list[int] = Field(description="Distinct UniProt positions lining the pocket, ascending")
    structure_residues: list[str] = Field(description="Residues as PrankWeb names them: chain_authSeqId")
    unmapped_residue_count: int = 0
    mean_plddt: float | None = Field(
        default=None, description="Mean pLDDT of the pocket residues; AlphaFold DB models only"
    )
    contains_residue: bool | None = Field(
        default=None, description="Whether the residue asked for lines this pocket; null when none was asked"
    )
    evidence: Evidence | None = None


class PocketsResponse(Aggregated):
    protein: EntityRef
    structure_id: str
    structure_origin: StructureOrigin
    status: PocketStatus
    status_detail: str | None = None
    retry_after_seconds: int | None = Field(
        default=None, description="Set while pending: ask again after this many seconds"
    )
    evidence_class: EvidenceClass = EvidenceClass.COMPUTATIONAL_PREDICTION
    method: PocketMethod
    queried_residue: int | None = None
    pockets: list[PredictedPocket]
    limitations: list[str]
    warnings: list[str]
