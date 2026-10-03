"""Evidence registry of one conversation turn, and the compaction that feeds tool results to the model.

Every Evidence record inside a service response is replaced by a short citation key before the
model sees it. The model can cite only those keys, and the server resolves them back to the records.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from orphafold.evidence import UnmappedEvidence, classify_evidence, try_build_evidence
from orphafold.schemas.assistant import CitedEvidence
from orphafold.schemas.common import Evidence, Provenance, SourceRecord

DROP_KEYS = frozenset({"href", "license_url", "response_sha256", "elapsed_ms", "from_cache"})
SCALAR_LIST_LIMIT = 40
EVIDENCE_LIST_LIMIT = 4
LIMIT_STEPS = (None, 12, 6, 3)


@dataclass
class EvidenceRegistry:
    """Citation keys handed to the model, in the order the records were first seen."""

    _keys: dict[str, str] = field(default_factory=dict)
    _records: dict[str, Evidence] = field(default_factory=dict)
    _tools: dict[str, str] = field(default_factory=dict)

    def add(self, evidence: Evidence, tool: str) -> str:
        key = self._keys.get(evidence.id)
        if key is None:
            key = f"e{len(self._keys) + 1}"
            self._keys[evidence.id] = key
            self._records[key] = evidence
            self._tools[key] = tool
        return key

    def get(self, key: str) -> Evidence | None:
        return self._records.get(key)

    def __len__(self) -> int:
        return len(self._records)

    def mark(self) -> int:
        return len(self._records)

    def rollback(self, mark: int) -> None:
        """Forget records added after `mark`: the model never saw them."""
        for evidence_id, key in list(self._keys.items()):
            if int(key[1:]) > mark:
                del self._keys[evidence_id]
                del self._records[key]
                del self._tools[key]

    def keys_since(self, mark: int) -> list[str]:
        return [key for key in self._records if int(key[1:]) > mark]

    def cited(self, keys: list[str]) -> list[CitedEvidence]:
        return [
            CitedEvidence(key=key, tool=self._tools.get(key), evidence=self._records[key])
            for key in keys
            if key in self._records
        ]


def is_evidence(node: Any) -> bool:
    return isinstance(node, dict) and "evidence_class" in node and "created_by" in node and "direction" in node


def is_provenance(node: Any) -> bool:
    return isinstance(node, dict) and "request_url" in node and "retrieved_at" in node and "source_name" in node


def is_seed_source(node: Any) -> bool:
    return isinstance(node, dict) and "source_id" in node and "record_id" in node and "retrieved_at" in node


def _seed_evidence(node: dict[str, Any]) -> Evidence | None:
    """Evidence for a record of the seed catalog (IUIS, Mondo, HGNC), which carries its own source block."""
    source_id = str(node["source_id"])
    for database in (source_id, re.sub(r"_\d{4}$", "", source_id)):
        try:
            classification = classify_evidence(database)
        except UnmappedEvidence:
            continue
        try:
            record = SourceRecord(
                database=database,
                record_id=str(node["record_id"]),
                release=node.get("release"),
                license=node.get("license"),
                url=node.get("url"),
                retrieved_at=node["retrieved_at"],
            )
        except ValidationError:
            return None
        return Evidence(
            id=f"ev_seed_{database}_{re.sub(r'[^A-Za-z0-9]+', '_', record.record_id)}"[:80],
            evidence_class=classification.evidence_class,
            source=record,
            statement=node.get("name"),
        )
    return None


def _stub(key: str, evidence: Evidence) -> dict[str, Any]:
    stub: dict[str, Any] = {"cite": key, "class": str(evidence.evidence_class.value)}
    if evidence.source is not None:
        stub["source"] = evidence.source.database
        stub["record"] = evidence.source.record_id
    if evidence.strength is not None and evidence.strength.value is not None:
        stub["strength"] = f"{evidence.strength.scheme}: {evidence.strength.value}"
    return stub


@dataclass
class Compaction:
    registry: EvidenceRegistry
    tool: str
    limits: dict[str, int] = field(default_factory=dict)
    default_limit: int = 20
    max_string: int = 900

    def run(self, node: Any, key: str | None = None) -> Any:
        if is_evidence(node):
            try:
                evidence = Evidence.model_validate(node)
            except ValidationError:
                return None
            return _stub(self.registry.add(evidence, self.tool), evidence)
        if is_provenance(node):
            try:
                evidence = try_build_evidence(Provenance.model_validate(node))
            except ValidationError:
                evidence = None
            return _stub(self.registry.add(evidence, self.tool), evidence) if evidence else None
        if is_seed_source(node):
            evidence = _seed_evidence(node)
            if evidence is None:
                return {"source": node.get("name"), "record": node.get("record_id"), "citable": False}
            return _stub(self.registry.add(evidence, self.tool), evidence)
        if isinstance(node, dict):
            compacted = {}
            for child_key, value in node.items():
                if child_key in DROP_KEYS or self.limits.get(child_key) == 0:
                    continue
                child = self.run(value, child_key)
                if child is None or child == "" or child == [] or child == {}:
                    continue
                compacted[child_key] = child
            return compacted
        if isinstance(node, list):
            if node and all(not isinstance(item, (dict, list)) for item in node):
                limit = self.limits.get(key or "", SCALAR_LIST_LIMIT)
            elif node and all(is_evidence(item) for item in node):
                limit = EVIDENCE_LIST_LIMIT
            else:
                limit = self.limits.get(key or "", self.default_limit)
            items = [child for child in (self.run(item, key) for item in node[:limit]) if child not in (None, {}, [])]
            if len(node) > limit:
                items.append({"_not_shown": len(node) - limit})
            return items
        if isinstance(node, str) and len(node) > self.max_string:
            return node[: self.max_string] + " [text cut]"
        return node


def compact_for_model(
    payload: Any,
    registry: EvidenceRegistry,
    tool: str,
    *,
    limits: dict[str, int] | None = None,
    default_limit: int = 20,
    max_string: int = 900,
    max_chars: int = 28000,
) -> tuple[str, list[str]]:
    """JSON for the model, within `max_chars`, plus the citation keys it contains.

    Lists are shortened step by step until the result fits; what was left out is counted in
    `_not_shown`, so the model can say the list is partial instead of treating it as complete.
    """
    text = ""
    for step in LIMIT_STEPS:
        mark = registry.mark()
        step_limits = dict(limits or {})
        step_default = default_limit
        if step is not None:
            step_default = min(default_limit, step)
            step_limits = {name: min(value, step) for name, value in step_limits.items()}
        compaction = Compaction(registry, tool, step_limits, step_default, max_string)
        text = json.dumps(compaction.run(payload), ensure_ascii=False, separators=(",", ":"), default=str)
        if len(text) <= max_chars:
            return text, registry.keys_since(mark)
        registry.rollback(mark)
    return (
        json.dumps(
            {
                "error": "result_too_large",
                "detail": "The record is too large to read at once. Ask for a narrower range or a single item.",
            }
        ),
        [],
    )
