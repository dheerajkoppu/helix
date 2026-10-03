"""Server-side check of an answer: a segment keeps a factual label only when the evidence it cites
supports that label. The model's own labelling is never trusted."""

from pydantic import BaseModel, ConfigDict, Field

from orphafold.assistant.registry import EvidenceRegistry
from orphafold.schemas.assistant import AnswerSegment, SegmentKind
from orphafold.schemas.common import Evidence, EvidenceClass

FACT_CLASSES = frozenset(
    {EvidenceClass.EXPERIMENTAL, EvidenceClass.CLINICAL_DATABASE, EvidenceClass.CURATED_DATABASE}
)

KIND_LABELS: dict[SegmentKind, str] = {
    "database_fact": "database fact",
    "paper_finding": "paper finding",
    "computational_result": "computational result",
    "reasoning_hypothesis": "reasoning",
}


class SegmentInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: SegmentKind
    text: str = Field(min_length=1, max_length=4000)
    citations: list[str] = Field(default_factory=list, max_length=24)


class AnswerInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    segments: list[SegmentInput] = Field(min_length=1, max_length=40)


def is_fact(evidence: Evidence) -> bool:
    return evidence.evidence_class in FACT_CLASSES


def is_paper(evidence: Evidence) -> bool:
    return evidence.evidence_class == EvidenceClass.LITERATURE or any(
        citation.pmid or citation.doi for citation in evidence.citations
    )


def is_computation(evidence: Evidence) -> bool:
    return evidence.evidence_class == EvidenceClass.COMPUTATIONAL_PREDICTION or evidence.generated_by is not None


def supported_kind(records: list[Evidence]) -> SegmentKind:
    """The label a set of cited records supports when the claimed one does not hold."""
    if any(is_fact(record) for record in records):
        return "database_fact"
    if any(record.evidence_class == EvidenceClass.LITERATURE for record in records):
        return "paper_finding"
    if any(is_computation(record) for record in records):
        return "computational_result"
    return "reasoning_hypothesis"


def kind_holds(kind: SegmentKind, records: list[Evidence]) -> bool:
    if kind == "database_fact":
        return any(is_fact(record) for record in records)
    if kind == "paper_finding":
        return any(is_paper(record) for record in records)
    if kind == "computational_result":
        return any(is_computation(record) for record in records)
    return True


def validate_segment(segment: SegmentInput, registry: EvidenceRegistry) -> AnswerSegment:
    keys: list[str] = []
    unknown: list[str] = []
    for key in segment.citations:
        key = key.strip().lstrip("[").rstrip("]")
        if registry.get(key) is None:
            unknown.append(key)
        elif key not in keys:
            keys.append(key)
    records = [record for record in (registry.get(key) for key in keys) if record is not None]
    notes: list[str] = []
    if unknown:
        notes.append(
            f"{len(unknown)} citation{'s' if len(unknown) != 1 else ''} did not match a record read in this "
            "answer and was removed."
        )

    kind: SegmentKind = segment.kind
    if segment.kind != "reasoning_hypothesis":
        if not records:
            kind = "reasoning_hypothesis"
            notes.append(
                f"Labelled {KIND_LABELS[segment.kind]} by the model without a source record. Shown as reasoning."
            )
        elif not kind_holds(segment.kind, records):
            kind = supported_kind(records)
            notes.append(
                f"Labelled {KIND_LABELS[segment.kind]} by the model; the cited records support "
                f"{KIND_LABELS[kind]}."
            )
    return AnswerSegment(
        kind=kind,
        text=segment.text.strip(),
        citations=keys,
        claimed_kind=segment.kind if kind != segment.kind else None,
        note=" ".join(notes) or None,
    )


def validate_answer(answer: AnswerInput, registry: EvidenceRegistry) -> list[AnswerSegment]:
    return [validate_segment(segment, registry) for segment in answer.segments]


def cited_keys(segments: list[AnswerSegment]) -> list[str]:
    keys: list[str] = []
    for segment in segments:
        for key in segment.citations:
            if key not in keys:
                keys.append(key)
    return keys
