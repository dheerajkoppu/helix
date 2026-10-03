"""Source digest: the cited records for the current entity, assembled without a model.

It runs the same lookups the assistant would and prints each record's own statement. Nothing is
inferred, so every line is a database fact, a paper or a computational result with its source.
"""

import asyncio
import json
from typing import Any

from helix.assistant.registry import EvidenceRegistry
from helix.assistant.tools import ToolContext, merge_statuses, run_tool, tool_label
from helix.assistant.validation import cited_keys, is_computation, is_fact
from helix.hgvs import parse_variant_query
from helix.schemas.assistant import AnswerSegment, AssistantAnswer, AssistantContext, Lookup, SegmentKind
from helix.schemas.common import Evidence, EvidenceClass

SECTION_LIMIT = 6

SECTIONS: dict[str, str] = {
    "get_variant": "Variant",
    "get_variant_effects": "Predicted effects",
    "get_residue": "Residue",
    "get_disease": "Disease",
    "get_gene": "Gene",
    "get_protein": "Protein",
    "list_structures": "Structures",
    "get_comparison": "Model comparison",
    "get_compound": "Compound",
    "search_literature": "Literature",
}


def _words(value: str) -> str:
    return value.replace("_", " ").replace(".", " ")


def describe(evidence: Evidence) -> str | None:
    """The record in words: its own statement when it has one, otherwise its subject, relation and value.
    None when the record only points at a source and states nothing."""
    citation = evidence.citations[0] if evidence.citations else None
    if evidence.evidence_class == EvidenceClass.LITERATURE and citation and citation.title:
        year = f" ({citation.year})" if citation.year else ""
        reference = f" PMID {citation.pmid}." if citation.pmid else ""
        return f"{citation.title.rstrip('.')}{year}.{reference}"
    if evidence.id.startswith("ev_seed_"):
        return None
    if evidence.statement:
        return _sentence(evidence.statement.strip())

    item = evidence.object
    if evidence.subject is None or not evidence.predicate or item is None:
        return None
    relation = _words(evidence.predicate)
    described = _words(item.type)
    if described in relation:
        described = ""
    named = f"{item.label} ({item.id})" if item.label and item.id else item.label or item.id
    if item.value is not None:
        value = f"{item.value}{item.unit or ''}"
        named = f"{value} ({named})" if named else value
    if not named:
        return None
    subject = evidence.subject.label or evidence.subject.id
    return _sentence(" ".join(part for part in (f"{subject}:", relation, described, named) if part))


def _sentence(text: str) -> str:
    return text if text[-1:] in ".!?" else f"{text}."


def strength_note(evidence: Evidence) -> str | None:
    strength = evidence.strength
    if strength is None or strength.value is None:
        return None
    return f"{_words(strength.scheme)}: {strength.value}{strength.unit or ''}"


def gene_disease_rows(content: str) -> list[tuple[str, list[str]]]:
    """Gene-disease links of the IUIS classification, read from the gene lookup as the model sees it."""
    try:
        payload = json.loads(content)
    except ValueError:
        return []
    symbol = payload.get("symbol")
    rows: list[tuple[str, list[str]]] = []
    for disease in (payload.get("diseases") or [])[:3]:
        if not isinstance(disease, dict) or not disease.get("name"):
            continue
        cited = [row for row in disease.get("sources") or [] if isinstance(row, dict) and row.get("cite")]
        keys = [row["cite"] for row in cited if str(row.get("source", "")).startswith("iuis")] or [
            row["cite"] for row in cited[:1]
        ]
        if not keys:
            continue
        text = f"{symbol} is listed for {disease['name']}"
        if disease.get("category_name"):
            text += f" in the IUIS category {disease['category_name']}"
        if disease.get("inheritance_raw"):
            text += f", inheritance {disease['inheritance_raw']}"
        rows.append((f"{text}.", keys))
    return rows


def segment_kind(evidence: Evidence) -> SegmentKind:
    if is_fact(evidence):
        return "database_fact"
    if evidence.evidence_class == EvidenceClass.LITERATURE:
        return "paper_finding"
    if is_computation(evidence):
        return "computational_result"
    return "reasoning_hypothesis"


def plan(context: AssistantContext, tool_context: ToolContext) -> list[tuple[str, dict[str, Any]]]:
    """The lookups for the open entities, most specific first."""
    gene = context.gene
    accession = context.accession
    position = context.residue
    alternate: str | None = None
    change: str | None = None

    if context.variant:
        query = parse_variant_query(context.variant)
        if query is not None and query.kind == "protein" and query.change is not None:
            gene = gene or query.gene_symbol
            position = position or query.change.position
            alternate = query.change.alternate if query.change.is_single_residue else None
            change = query.change.hgvs_p
    if gene and not accession:
        seed_gene = tool_context.catalog.gene(gene) or tool_context.catalog.gene(gene.upper())
        accession = seed_gene.uniprot_accession if seed_gene else None
    if accession and not gene:
        seed_gene = tool_context.catalog.gene_by_uniprot(accession)
        gene = seed_gene.symbol if seed_gene else None

    calls: list[tuple[str, dict[str, Any]]] = []
    if context.variant:
        calls.append(("get_variant", {"variant_id": context.variant}))
    if accession and position:
        effects: dict[str, Any] = {"accession": accession, "position": position}
        if alternate and alternate.isalpha() and len(alternate) == 1:
            effects["alt"] = alternate
        calls.append(("get_variant_effects", effects))
        calls.append(("get_residue", {"accession": accession, "position": position}))
    if context.disease:
        calls.append(("get_disease", {"disease_id": context.disease}))
    if gene:
        calls.append(("get_gene", {"symbol": gene}))
    if accession:
        calls.append(("get_protein", {"accession": accession}))
        calls.append(("list_structures", {"accession": accession}))
    if gene and change and context.comparison:
        calls.append(("get_comparison", {"gene": gene, "change": change, "result_id": context.comparison}))
    if context.compound:
        calls.append(("get_compound", {"identifier": context.compound}))
    literature = {
        name: value
        for name, value in (("gene", gene), ("disease", context.disease), ("variant", context.variant))
        if value
    }
    if literature:
        calls.append(("search_literature", {**literature, "page_size": 4}))
    return calls


async def build_digest(context: AssistantContext, tool_context: ToolContext) -> AssistantAnswer:
    calls = plan(context, tool_context)
    registry: EvidenceRegistry = tool_context.registry
    outcomes = await asyncio.gather(*(run_tool(name, arguments, tool_context) for name, arguments in calls))

    segments: list[AnswerSegment] = []
    lookups: list[Lookup] = []
    for index, ((name, arguments), outcome) in enumerate(zip(calls, outcomes, strict=True)):
        lookups.append(
            Lookup(
                id=f"digest-{index}",
                tool=name,
                label=tool_label(name, arguments),
                ok=outcome.ok,
                message=outcome.message,
                evidence_count=len(outcome.keys),
            )
        )
        section = SECTIONS.get(name, name)
        rows: dict[str, AnswerSegment] = {}
        if name == "get_gene" and outcome.ok:
            for text, keys in gene_disease_rows(outcome.content):
                cited = registry.get(keys[0])
                if cited is not None:
                    rows[text] = AnswerSegment(kind=segment_kind(cited), text=text, citations=keys)
        for key in outcome.keys:
            evidence = registry.get(key)
            text = describe(evidence) if evidence is not None else None
            if evidence is None or not text:
                continue
            row = rows.get(text)
            if row is None:
                if len(rows) == SECTION_LIMIT:
                    continue
                rows[text] = AnswerSegment(kind=segment_kind(evidence), text=text, citations=[key])
            elif key not in row.citations:
                # The same statement asserted by a second record: one line, both citations
                row.citations.append(key)
                if is_fact(evidence):
                    row.kind = "database_fact"
        for index_in_section, row in enumerate(rows.values()):
            notes = {
                note
                for note in (strength_note(registry.get(key)) for key in row.citations)  # type: ignore[arg-type]
                if note and note.split(": ", 1)[1] not in row.text
            }
            if len(notes) == 1:
                row.text = f"{row.text.rstrip('.')} ({notes.pop()})."
            row.heading = section if index_in_section == 0 else None
            segments.append(row)
    return AssistantAnswer(
        segments=segments,
        evidence=registry.cited(cited_keys(segments)),
        lookups=lookups,
        generated_by="source_digest",
        sources=merge_statuses(tool_context.sources),
    )
