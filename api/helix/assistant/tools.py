"""The lookups the assistant can make. Each one calls an Helix service, so every fact the model
reads comes from a source record that carries its own Evidence."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from helix.artifacts.store import ArtifactStore
from helix.assistant.registry import EvidenceRegistry, compact_for_model
from helix.db.models import Actor
from helix.errors import ApiError
from helix.evidence import UnmappedEvidence, build_job_evidence
from helix.knowledge.catalog import Catalog
from helix.schemas.common import EntityRef, EntityType, EvidenceObject, SourceState, SourceStatus
from helix.services import compare as compare_service
from helix.services import projects as project_service
from helix.services.compounds import compound_detail, protein_compounds
from helix.services.diseases import get_disease
from helix.services.genes import get_gene
from helix.services.interactions import protein_interactions
from helix.services.literature import LiteratureQuery, get_publication, search_literature
from helix.services.pathways import protein_pathways
from helix.services.proteins import get_protein, get_residue
from helix.services.search import search
from helix.services.structures import (
    parse_id,
    protein_structures,
    structure_confidence,
    structure_descriptor,
)
from helix.services.treatments import gene_treatments
from helix.services.variant_effects import residue_effects
from helix.services.variants import VariantListFilters, gene_variants, variant_detail

logger = logging.getLogger(__name__)

ANSWER_TOOL = "submit_answer"
CONFIDENCE_WINDOW = 60
SKIPPED_PROTEIN_TRACKS = frozenset({"secondary_structure", "natural_variants", "chains"})


STATE_ORDER = (
    SourceState.OK,
    SourceState.EMPTY,
    SourceState.NOT_CONFIGURED,
    SourceState.DISABLED_BY_LICENSE,
    SourceState.UNAVAILABLE,
)


def merge_statuses(rows: list[SourceStatus]) -> list[SourceStatus]:
    """One row per source; the least healthy state wins."""
    merged: dict[str, SourceStatus] = {}
    for row in rows:
        current = merged.get(row.source)
        if current is None or STATE_ORDER.index(row.state) > STATE_ORDER.index(current.state):
            merged[row.source] = row
    return list(merged.values())


@dataclass
class ToolContext:
    session: AsyncSession
    catalog: Catalog
    store: ArtifactStore
    actor: Actor | None
    registry: EvidenceRegistry
    max_chars: int = 28000
    # One AsyncSession cannot run two statements at once
    session_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    sources: list[SourceStatus] = field(default_factory=list)


@dataclass
class Shaped:
    payload: Any
    limits: dict[str, int] = field(default_factory=dict)
    default_limit: int = 20
    max_string: int = 900


@dataclass
class ToolOutcome:
    ok: bool
    content: str
    keys: list[str] = field(default_factory=list)
    message: str | None = None


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass
class Tool:
    name: str
    description: str
    args: type[Args]
    handler: Callable[[Any, ToolContext], Awaitable[Shaped]]
    label: Callable[[Any], str]

    def definition(self) -> dict[str, Any]:
        schema = self.args.model_json_schema()
        schema.pop("title", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": schema,
            "eager_input_streaming": True,
        }


def _dump(model: Any) -> dict[str, Any]:
    return model.model_dump(mode="json")


def _note_sources(payload: dict[str, Any], context: ToolContext) -> None:
    for row in payload.pop("sources", None) or []:
        try:
            context.sources.append(SourceStatus.model_validate(row))
        except ValidationError:
            continue


def _slim_feature(feature: dict[str, Any]) -> dict[str, Any]:
    keep = ("type", "start", "end", "description", "ligand", "original", "alternatives", "evidence")
    return {name: feature.get(name) for name in keep}


def _slim_descriptor(descriptor: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "id",
        "origin",
        "title",
        "provider_name",
        "model_name",
        "model_version",
        "method",
        "resolution",
        "coverage",
        "confidence",
        "created_date",
        "job_id",
        "limitations",
        "warnings",
        "provenance",
    )
    slim = {name: descriptor.get(name) for name in keep}
    if isinstance(slim.get("confidence"), dict):
        slim["confidence"].pop("provider_native", None)
    return slim


class GeneArgs(Args):
    symbol: str = Field(description="HGNC gene symbol, e.g. BTK")


async def _gene(args: GeneArgs, context: ToolContext) -> Shaped:
    payload = _dump(await get_gene(args.symbol, context.catalog))
    _note_sources(payload, context)
    transcripts = payload.get("transcripts") or {}
    payload["transcripts"] = {
        "mane_select": transcripts.get("mane_select"),
        "total": transcripts.get("total"),
    }
    payload.pop("record_sources", None)
    return Shaped(payload, limits={"sources": 3})


class ProteinArgs(Args):
    accession: str = Field(description="UniProt accession, e.g. Q06187")


async def _protein(args: ProteinArgs, context: ToolContext) -> Shaped:
    payload = _dump(await get_protein(args.accession, context.catalog))
    _note_sources(payload, context)
    if isinstance(payload.get("sequence"), dict):
        payload["sequence"].pop("value", None)
    payload.pop("cross_references", None)
    payload["tracks"] = [
        {
            "track": track.get("label"),
            "count": track.get("count"),
            "features": [_slim_feature(feature) for feature in track.get("features") or []],
        }
        for track in payload.get("tracks") or []
        if track.get("id") not in SKIPPED_PROTEIN_TRACKS
    ]
    payload["numbering"] = "UniProt canonical, 1-based"
    return Shaped(payload, limits={"tracks": 20, "features": 16, "interpro_entries": 16}, default_limit=12)


class ResidueArgs(Args):
    accession: str = Field(description="UniProt accession")
    position: int = Field(ge=1, description="Residue position in UniProt canonical numbering")


async def _residue(args: ResidueArgs, context: ToolContext) -> Shaped:
    payload = _dump(await get_residue(args.accession, args.position, context.catalog))
    _note_sources(payload, context)
    payload["tracks"] = [
        {
            "track": track.get("label"),
            "features": [_slim_feature(feature) for feature in track.get("features") or []],
        }
        for track in payload.get("tracks") or []
    ]
    return Shaped(payload, limits={"tracks": 20, "features": 12})


class VariantsArgs(Args):
    symbol: str = Field(description="HGNC gene symbol")
    residue_start: int | None = Field(default=None, ge=1, description="First residue of a range")
    residue_end: int | None = Field(default=None, ge=1, description="Last residue of a range")
    significance: list[str] | None = Field(
        default=None,
        description="ClinVar classes to include: pathogenic, likely_pathogenic, uncertain_significance, "
        "likely_benign, benign, conflicting, or all. Default: pathogenic and likely pathogenic.",
    )
    q: str | None = Field(default=None, description="Text filter on the variant name or condition")
    limit: int = Field(default=15, ge=1, le=25)


async def _variants(args: VariantsArgs, context: ToolContext) -> Shaped:
    filters = VariantListFilters(residue_start=args.residue_start, residue_end=args.residue_end, q=args.q)
    if args.significance:
        filters.significance = list(args.significance)
    payload = _dump(await gene_variants(args.symbol, context.catalog, filters, args.limit, 0))
    _note_sources(payload, context)
    keep = (
        "id",
        "protein_change",
        "position",
        "consequence",
        "clinical_significance",
        "review_status",
        "review_stars",
        "last_evaluated",
        "vcv",
        "in_clinvar",
        "in_uniprot",
        "reference_matches_uniprot",
        "evidence",
    )
    payload["items"] = [
        {
            **{name: item.get(name) for name in keep},
            "conditions": [condition.get("name") for condition in (item.get("conditions") or [])[:4]],
        }
        for item in payload.get("items") or []
    ]
    return Shaped(payload, limits={"items": 25})


class VariantArgs(Args):
    variant_id: str = Field(description="GENE-p.Arg28His, GENE-R28H, a ClinVar VCV accession or an rsID")


async def _variant(args: VariantArgs, context: ToolContext) -> Shaped:
    payload = _dump(await variant_detail(args.variant_id, context.catalog))
    _note_sources(payload, context)
    return Shaped(payload, limits={"xrefs": 0, "conditions": 6, "other_clinvar_records": 3}, default_limit=8)


async def _mechanisms(args: VariantArgs, context: ToolContext) -> Shaped:
    from helix.services.mechanisms import variant_mechanisms

    async with context.session_lock:
        response = await variant_mechanisms(args.variant_id, context.catalog, context.session, context.actor)
    payload = _dump(response)
    _note_sources(payload, context)
    payload["note"] = (
        "Candidate mechanisms are Helix hypotheses raised by rules over the cited records. "
        "Report them as hypotheses, never as established mechanisms."
    )
    return Shaped(payload, default_limit=8)


class EffectsArgs(Args):
    accession: str = Field(description="UniProt accession")
    position: int = Field(ge=1, description="Residue position in UniProt canonical numbering")
    alt: str | None = Field(
        default=None, description="Substituted amino acid, one-letter code. Omit for residue-level values only."
    )


async def _effects(args: EffectsArgs, context: ToolContext) -> Shaped:
    payload = _dump(await residue_effects(args.accession, args.position, args.alt, None))
    _note_sources(payload, context)
    payload["disabled_by_license"] = [
        row.get("name") or row.get("label") or row.get("id") for row in payload.get("disabled_by_license") or []
    ]
    return Shaped(payload, default_limit=10)


class StructuresArgs(Args):
    accession: str = Field(description="UniProt accession")


async def _structures(args: StructuresArgs, context: ToolContext) -> Shaped:
    async with context.session_lock:
        ledger = await protein_structures(context.session, args.accession, context.actor, external_models=False)
    payload = _dump(ledger)
    _note_sources(payload, context)
    experimental = sorted(
        payload.get("experimental") or [],
        key=lambda row: row.get("sifts_rank") if row.get("sifts_rank") is not None else 10**6,
    )
    return Shaped(
        {
            "protein": payload.get("protein"),
            "sequence_length": payload.get("sequence_length"),
            "experimental_total": len(experimental),
            "experimental": [
                {
                    "structure": _slim_descriptor(row.get("structure") or {}),
                    "ligands": [ligand.get("id") or ligand.get("name") for ligand in (row.get("ligands") or [])[:6]],
                    "sifts_rank": row.get("sifts_rank"),
                    "release_date": row.get("release_date"),
                    "evidence": row.get("evidence"),
                }
                for row in experimental
            ],
            "predicted_external": [_slim_descriptor(row) for row in payload.get("predicted_external") or []],
            "isoform_models": [_slim_descriptor(row) for row in payload.get("isoform_models") or []],
            "predicted_internal": [_slim_descriptor(row) for row in payload.get("predicted_internal") or []],
            "recommended": payload.get("recommended"),
            "note": "Experimental, externally predicted and Helix-generated structures are separate "
            "groups and are never equivalent. Experimental entries are ordered by PDBe SIFTS rank.",
        },
        limits={"experimental": 12, "ranges": 6},
    )


class ConfidenceArgs(Args):
    structure_id: str = Field(description="afdb:<entryId> or of:<job_id>; experimental entries have no pLDDT")
    accession: str | None = Field(default=None, description="UniProt accession the structure belongs to")
    residue_start: int | None = Field(default=None, ge=1, description="First residue of the window to read")
    residue_end: int | None = Field(default=None, ge=1, description="Last residue of the window to read")


async def _confidence(args: ConfidenceArgs, context: ToolContext) -> Shaped:
    async with context.session_lock:
        descriptor = await structure_descriptor(context.session, args.structure_id, args.accession)
        confidence = await structure_confidence(
            context.session, context.store, args.structure_id, include_pae=False
        )
    payload = _dump(confidence)
    _note_sources(payload, context)
    described = _slim_descriptor(_dump(descriptor))
    kind, value = parse_id(args.structure_id)
    if kind == "of":
        described["evidence"] = _dump(
            build_job_evidence(
                value,
                "structure_prediction",
                statement=f"Helix structure prediction {args.structure_id}",
                object=EvidenceObject(type="structure", id=args.structure_id),
            )
        )
    plddt = payload.get("plddt") or {}
    numbers, scores, categories = (
        plddt.get("residue_numbers") or [],
        plddt.get("scores") or [],
        plddt.get("categories") or [],
    )
    window: list[dict[str, Any]] = []
    if args.residue_start is not None:
        end = args.residue_end if args.residue_end is not None else args.residue_start
        end = min(end, args.residue_start + CONFIDENCE_WINDOW - 1)
        window = [
            {"residue": number, "plddt": score, "band": category}
            for number, score, category in zip(numbers, scores, categories, strict=False)
            if args.residue_start <= number <= end
        ]
    return Shaped(
        {
            "structure": described,
            "available": payload.get("available"),
            "message": payload.get("message"),
            "plddt_mean": plddt.get("mean"),
            "plddt_fractions": plddt.get("fractions"),
            "plddt_scale": plddt.get("native_scale"),
            "window": window,
            "pae_available": payload.get("pae_available"),
            "limitations": payload.get("limitations"),
            "citing": "Cite the key under structure for every confidence value from this result.",
        },
        limits={"window": CONFIDENCE_WINDOW},
    )


class ComparisonArgs(Args):
    gene: str = Field(description="HGNC gene symbol")
    change: str = Field(description="Protein change, e.g. p.Arg28His or R28H")
    result_id: str | None = Field(default=None, description="A specific comparison result (job) ID")


async def _comparison(args: ComparisonArgs, context: ToolContext) -> Shaped:
    async with context.session_lock:
        plan = _dump(
            await compare_service.plan_comparison(
                context.session, context.actor, context.catalog, args.gene, args.change
            )
        )
        _note_sources(plan, context)
        results = plan.get("results") or []
        result_id = args.result_id or (results[0].get("result_id") if results else None)
        detail = None
        if result_id:
            detail = _dump(await compare_service.comparison_result(context.session, context.store, result_id))
    variant = plan.get("variant") or {}
    payload: dict[str, Any] = {
        "variant": variant,
        "reference_check": plan.get("reference_check"),
        "property_change": plan.get("property_change"),
        "proposed_construct": plan.get("proposed_construct"),
        "available_results": [
            {name: row.get(name) for name in ("result_id", "origin", "label")} for row in results
        ],
        "caveats": plan.get("caveats"),
    }
    if detail is None:
        payload["result"] = None
        payload["note"] = "No comparison has been run for this variant. Nothing computational can be reported."
    else:
        _note_sources(detail, context)
        for name in ("files", "artifacts"):
            detail.pop(name, None)
        subject = None
        if variant.get("variant_id"):
            subject = EntityRef.of(EntityType.VARIANT, variant["variant_id"])
        try:
            evidence = build_job_evidence(
                result_id,
                "structure_prediction",
                subject=subject,
                predicate="compared_with_reference_model",
                statement=f"Predicted reference and variant models of {variant.get('variant_id') or args.change} "
                f"(comparison {result_id}). Both models are predictions.",
            )
            payload["evidence"] = _dump(evidence)
        except UnmappedEvidence:
            payload["evidence"] = None
        payload["result"] = detail
        payload["citing"] = "Cite the top-level evidence key for every value from this comparison."
    return Shaped(payload, default_limit=12, limits={"residue_numbers": 0, "per_residue": 30})


class AccessionArgs(Args):
    accession: str = Field(description="UniProt accession")


async def _interactions(args: AccessionArgs, context: ToolContext) -> Shaped:
    payload = _dump(await protein_interactions(args.accession, context.catalog))
    _note_sources(payload, context)
    curated = payload.get("curated") or {}
    partners = sorted(curated.get("partners") or [], key=lambda row: row.get("mi_score") or 0, reverse=True)
    curated["partners"] = [
        {
            "partner_symbol": row.get("partner_symbol"),
            "partner_accession": row.get("partner_id"),
            "mi_score": row.get("mi_score"),
            "evidence_count": row.get("evidence_count"),
            "methods": [method.get("label") for method in (row.get("methods") or [])[:4]],
            "pmids": (row.get("pmids") or [])[:5],
            "measured_with_mutant": row.get("measured_with_mutant"),
            "evidence": row.get("evidence"),
        }
        for row in partners
    ]
    curated["partner_total"] = len(partners)
    string = payload.get("string_physical") or {}
    string["partners"] = [
        {
            name: row.get(name)
            for name in ("partner_symbol", "score", "dominant_channel", "also_in_intact", "evidence")
        }
        for row in string.get("partners") or []
    ]
    payload["note"] = (
        "IntAct MI score and STRING score are separate scales from separate sources. Do not combine them."
    )
    return Shaped(payload, limits={"partners": 20})


async def _pathways(args: AccessionArgs, context: ToolContext) -> Shaped:
    payload = _dump(await protein_pathways(args.accession, context.catalog))
    _note_sources(payload, context)
    return Shaped(payload, limits={"pathways": 30})


async def _compounds(args: AccessionArgs, context: ToolContext) -> Shaped:
    payload = _dump(await protein_compounds(args.accession))
    _note_sources(payload, context)
    payload.pop("related_targets", None)
    return Shaped(payload, limits={"compounds": 14}, default_limit=5, max_string=400)


class CompoundArgs(Args):
    identifier: str = Field(description="InChIKey or ChEMBL ID, e.g. CHEMBL1873475")


async def _compound(args: CompoundArgs, context: ToolContext) -> Shaped:
    payload = _dump(await compound_detail(args.identifier))
    _note_sources(payload, context)
    return Shaped(payload, default_limit=10)


async def _treatments(args: GeneArgs, context: ToolContext) -> Shaped:
    payload = _dump(await gene_treatments(args.symbol, context.catalog))
    _note_sources(payload, context)
    payload["note"] = (
        "Database records of drugs and clinical candidates and their recorded mechanisms. "
        "They describe what sources record, not what anyone should take."
    )
    return Shaped(payload, limits={"treatments": 15}, default_limit=6, max_string=400)


class DiseaseArgs(Args):
    disease_id: str = Field(description="Catalog disease slug, or a MONDO, Orphanet or OMIM identifier")


async def _disease(args: DiseaseArgs, context: ToolContext) -> Shaped:
    payload = _dump(await get_disease(args.disease_id, context.catalog))
    _note_sources(payload, context)
    payload.pop("graph", None)
    return Shaped(
        payload,
        limits={"phenotypes": 25, "target_drugs": 8, "treatments": 8, "research_status": 10, "aliases": 10},
        default_limit=8,
    )


class LiteratureArgs(Args):
    gene: str | None = Field(default=None, description="HGNC symbol")
    disease: str | None = Field(default=None, description="Catalog disease slug")
    variant: str | None = Field(default=None, description="Variant ID or protein change")
    accession: str | None = Field(default=None, description="UniProt accession")
    residue: str | None = Field(default=None, description="UniProt position, optionally with the residue: 28, R28")
    q: str | None = Field(default=None, description="Free text added to the search")
    kind: Literal["all", "review", "primary"] = "all"
    sort: Literal["relevance", "cited", "date"] = "relevance"
    page_size: int = Field(default=6, ge=1, le=8)


async def _literature(args: LiteratureArgs, context: ToolContext) -> Shaped:
    query = LiteratureQuery(
        gene=args.gene,
        disease=args.disease,
        variant=args.variant,
        accession=args.accession,
        residue=args.residue,
        q=args.q,
        kind=args.kind,
        sort=args.sort,
        page=1,
        page_size=args.page_size,
    )
    payload = _dump(await search_literature(query, context.catalog))
    _note_sources(payload, context)
    payload["note"] = (
        "Search hits show that a paper exists and what its abstract says. Read the abstract with "
        "get_abstract before reporting a finding from it."
    )
    return Shaped(payload, limits={"items": 8, "authors": 4}, default_limit=6, max_string=700)


class AbstractArgs(Args):
    pmid: str = Field(pattern=r"^\d{1,9}$", description="PubMed ID")


async def _abstract(args: AbstractArgs, context: ToolContext) -> Shaped:
    payload = _dump(await get_publication(args.pmid))
    _note_sources(payload, context)
    return Shaped(payload, limits={"authors": 8}, default_limit=8, max_string=5000)


class ProjectArgs(Args):
    project_id: str = Field(description="Project ID")


async def _project(args: ProjectArgs, context: ToolContext) -> Shaped:
    async with context.session_lock:
        project = await project_service.readable_project(context.session, args.project_id, context.actor)
        payload = _dump(await project_service.project_detail(context.session, project, context.actor))
    items = [
        {name: item.get(name) for name in ("id", "kind", "ref", "label", "note", "hypothesis", "evidence")}
        for item in payload.get("items") or []
    ]
    return Shaped(
        {
            "id": payload.get("id"),
            "title": payload.get("title"),
            "description": payload.get("description"),
            "items": items,
            "note": "Notes and hypotheses in a project were written by its authors. They are not source facts.",
        },
        limits={"items": 40},
    )


class SearchArgs(Args):
    query: str = Field(min_length=1, max_length=200, description="A name, symbol, accession or variant")


async def _search(args: SearchArgs, context: ToolContext) -> Shaped:
    async with context.session_lock:
        response = await search(
            context.catalog, args.query, limit=8, session=context.session, actor=context.actor
        )
    payload = _dump(response)
    _note_sources(payload, context)
    return Shaped(payload, default_limit=8, max_string=300)


TOOLS: tuple[Tool, ...] = (
    Tool(
        "search_entities",
        "Resolve a name, alias, symbol, accession or variant written in free text to Helix entities "
        "(disease, gene, protein, variant, compound). Use it when the question names something that is "
        "not in the workspace context.",
        SearchArgs,
        _search,
        lambda args: f"Search {args.query}",
    ),
    Tool(
        "get_disease",
        "A disease of the catalog: definition, IUIS category, inheritance, phenotypes, the gene and "
        "protein involved, gene-disease validity and recorded drugs.",
        DiseaseArgs,
        _disease,
        lambda args: f"Disease {args.disease_id}",
    ),
    Tool(
        "get_gene",
        "A gene: names, location, the diseases it is linked to in the IUIS classification, its "
        "canonical transcript and a summary of its protein with the UniProt function text.",
        GeneArgs,
        _gene,
        lambda args: f"Gene {args.symbol}",
    ),
    Tool(
        "get_protein",
        "A protein from UniProtKB and InterPro: function, catalytic activity, subunit structure, "
        "family, location, and domains, regions, sites and modified residues with their positions.",
        ProteinArgs,
        _protein,
        lambda args: f"Protein {args.accession}",
    ),
    Tool(
        "get_residue",
        "One residue of a protein: the amino acid, its sequence window and every annotated feature "
        "that covers the position (domain, binding site, active site, modification, mutagenesis).",
        ResidueArgs,
        _residue,
        lambda args: f"Residue {args.position} of {args.accession}",
    ),
    Tool(
        "list_variants",
        "ClinVar and UniProt variants of a gene, optionally limited to a residue range or a "
        "classification. Use it to see what is recorded at or near a position.",
        VariantsArgs,
        _variants,
        lambda args: f"Variants of {args.symbol}"
        + (f" at {args.residue_start}-{args.residue_end or args.residue_start}" if args.residue_start else ""),
    ),
    Tool(
        "get_variant",
        "One variant: ClinVar classification with review status and conditions, the UniProt natural "
        "variant annotation, gnomAD allele counts and the Ensembl VEP consequence.",
        VariantArgs,
        _variant,
        lambda args: f"Variant {args.variant_id}",
    ),
    Tool(
        "get_mechanisms",
        "Candidate molecular mechanisms of a single-residue variant, each raised by a rule over source "
        "records (features at the residue, predictions, structures). They are hypotheses.",
        VariantArgs,
        _mechanisms,
        lambda args: f"Candidate mechanisms of {args.variant_id}",
    ),
    Tool(
        "get_variant_effects",
        "Computed effect predictions at a residue or for one substitution (AlphaMissense and the other "
        "predictors Helix reads), each in its own scale, plus the pLDDT of the residue. These are "
        "predictions, never classifications.",
        EffectsArgs,
        _effects,
        lambda args: f"Predicted effects at {args.position}{args.alt or ''} of {args.accession}",
    ),
    Tool(
        "list_structures",
        "Structures of a protein grouped by origin: experimental PDB entries, the AlphaFold DB model "
        "and Helix-generated models, with method, resolution, coverage and the recommended one.",
        StructuresArgs,
        _structures,
        lambda args: f"Structures of {args.accession}",
    ),
    Tool(
        "get_structure_confidence",
        "Confidence of a predicted structure: mean pLDDT, the fraction of residues per pLDDT band and, "
        "for a residue window, the per-residue values.",
        ConfidenceArgs,
        _confidence,
        lambda args: f"Confidence of {args.structure_id}",
    ),
    Tool(
        "get_comparison",
        "The reference-versus-variant comparison of a substitution: the physicochemical change, and, "
        "when a comparison has been run, both predicted models and the difference between them.",
        ComparisonArgs,
        _comparison,
        lambda args: f"Comparison {args.gene} {args.change}",
    ),
    Tool(
        "get_interactions",
        "Interaction partners of a protein: curated binary interactions from IntAct with methods and "
        "PMIDs, and physical associations from STRING.",
        AccessionArgs,
        _interactions,
        lambda args: f"Interactions of {args.accession}",
    ),
    Tool(
        "get_pathways",
        "Reactome pathways a protein takes part in.",
        AccessionArgs,
        _pathways,
        lambda args: f"Pathways of {args.accession}",
    ),
    Tool(
        "get_treatments",
        "Drugs and clinical candidates recorded against a gene's product, with the mechanism of action "
        "and clinical stage each source records.",
        GeneArgs,
        _treatments,
        lambda args: f"Recorded drugs for {args.symbol}",
    ),
    Tool(
        "get_compounds",
        "Compounds recorded against a protein target in ChEMBL and the PDB: mechanism, measured "
        "affinity summaries and co-crystallised ligands.",
        AccessionArgs,
        _compounds,
        lambda args: f"Compounds for {args.accession}",
    ),
    Tool(
        "get_compound",
        "One compound: identifiers, modality, mechanisms, indications and cross-references.",
        CompoundArgs,
        _compound,
        lambda args: f"Compound {args.identifier}",
    ),
    Tool(
        "search_literature",
        "Search Europe PMC for publications about a gene, disease, variant, protein or residue. "
        "Returns titles, journals, years and why each paper matched.",
        LiteratureArgs,
        _literature,
        lambda args: "Literature "
        + " ".join(str(value) for value in (args.gene, args.variant, args.disease, args.residue, args.q) if value),
    ),
    Tool(
        "get_abstract",
        "The record of one publication by PMID, with its abstract.",
        AbstractArgs,
        _abstract,
        lambda args: f"Abstract PMID {args.pmid}",
    ),
    Tool(
        "get_project",
        "The items saved in a research project: entities, notes, model runs and hypotheses.",
        ProjectArgs,
        _project,
        lambda args: f"Project {args.project_id}",
    ),
)

TOOLS_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in TOOLS}


def tool_label(name: str, raw_input: Any) -> str:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return name
    try:
        return tool.label(tool.args.model_validate(raw_input))
    except ValidationError:
        return name.replace("_", " ")


async def run_tool(name: str, raw_input: Any, context: ToolContext) -> ToolOutcome:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return ToolOutcome(False, f"Unknown tool {name}.", message="Unknown lookup")
    try:
        args = tool.args.model_validate(raw_input)
    except ValidationError as error:
        problems = "; ".join(f"{'.'.join(str(part) for part in row['loc'])}: {row['msg']}" for row in error.errors())
        return ToolOutcome(False, f"INVALID_INPUT: {problems}", message="The lookup was called with invalid input")
    try:
        shaped = await tool.handler(args, context)
    except ApiError as error:
        detail = error.detail or error.title
        return ToolOutcome(False, f"{error.code}: {detail}", message=str(detail))
    except Exception:
        logger.exception("Assistant tool %s failed", name)
        return ToolOutcome(
            False,
            "The lookup failed inside Helix. Treat this value as not available.",
            message="The lookup failed",
        )
    content, keys = compact_for_model(
        shaped.payload,
        context.registry,
        name,
        limits=shaped.limits,
        default_limit=shaped.default_limit,
        max_string=shaped.max_string,
        max_chars=context.max_chars,
    )
    return ToolOutcome(True, content, keys)
