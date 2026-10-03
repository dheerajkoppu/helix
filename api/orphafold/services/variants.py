"""Variants of a gene (ClinVar merged with UniProt natural variants) and one variant in detail."""

import asyncio
import csv
import io
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from orphafold.errors import BadRequest, NotFound, SourceUnavailable, ValidationFailed
from orphafold.evidence import clinvar_stars, try_build_evidence
from orphafold.hgvs import (
    ProteinChange,
    ReferenceCheck,
    VariantQuery,
    check_reference,
    is_gene_symbol,
    normalise_consequence,
    parse_clinvar_title,
    parse_protein_hgvs,
    parse_variant_query,
    protein_substitution_vrs_id,
    refget_accession,
    significance_keys,
    spdi_to_gnomad_id,
    vcv_to_variation_id,
)
from orphafold.knowledge.catalog import Catalog
from orphafold.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Provenance,
)
from orphafold.schemas.variants import (
    ClinVarRecord,
    ClinVarSubmission,
    CountRow,
    CrossReference,
    GeneVariantsResponse,
    GnomadAllele,
    GnomadFrequency,
    GnomadObservation,
    ReferenceCheckResult,
    SubmissionSummary,
    UniProtAssociation,
    UniProtVariantAnnotation,
    VariantCondition,
    VariantCounts,
    VariantDetail,
    VariantFilters,
    VariantHgvs,
    VariantSummary,
    VepConsequence,
    VrsIdentifier,
)
from orphafold.sources import SourceCall, SourceResult, gather_sources
from orphafold.sources.base import Gathered
from orphafold.sources.clinvar import clinvar
from orphafold.sources.ebi_variation import ebi_variation
from orphafold.sources.ensembl_vep import ensembl_vep
from orphafold.sources.gnomad import DATASET_LABEL, gnomad

DEFAULT_SIGNIFICANCE = ("pathogenic", "likely_pathogenic")
SORTS = ("position", "stars", "last_evaluated")

_EBI_CONSEQUENCES = {
    "missense": "missense_variant",
    "stop gained": "nonsense",
    "frameshift": "frameshift_variant",
    "inframe deletion": "inframe_deletion",
    "insertion": "inframe_insertion",
    "stop lost": "stop_lost",
}

_XREF_URLS = {
    "clingen": "https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid={id}",
    "dbsnp": "https://www.ncbi.nlm.nih.gov/snp/rs{id}",
    "medgen": "https://www.ncbi.nlm.nih.gov/medgen/{id}",
    "mondo": "https://monarchinitiative.org/{id}",
    "orphanet": "https://www.orpha.net/en/disease/detail/{id}",
    "omim": "https://omim.org/entry/{id}",
}


@dataclass(slots=True)
class VariantListFilters:
    significance: list[str] = field(default_factory=lambda: list(DEFAULT_SIGNIFICANCE))
    consequence: list[str] = field(default_factory=list)
    min_stars: int | None = None
    residue_start: int | None = None
    residue_end: int | None = None
    q: str | None = None
    sort: str = "position"

    @property
    def all_significance(self) -> bool:
        return "all" in self.significance


@dataclass(slots=True)
class _Row:
    """A table row with the raw records it was built from, kept for evidence and detail."""

    summary: VariantSummary
    clinvar: dict[str, Any] | None = None
    uniprot: dict[str, Any] | None = None


@dataclass(slots=True)
class _GeneVariants:
    symbol: str
    gene: EntityRef
    protein: EntityRef | None
    accession: str | None
    sequence: str | None
    rows: list[_Row]
    counts: VariantCounts
    clinvar_release: str | None
    truncated: bool
    gathered: Gathered


def _xref(db: str, identifier: str, url: str | None = None) -> CrossReference:
    key = db.lower()
    if url is None and key == "uniprotkb" and "#" in identifier:
        url = f"https://web.expasy.org/variant_pages/{identifier.split('#', 1)[1]}.html"
    elif url is None and key == "omim":
        url = _XREF_URLS["omim"].format(id=identifier.replace(".", "#", 1))
    elif url is None and key in _XREF_URLS:
        url = _XREF_URLS[key].format(id=identifier)
    return CrossReference(db=db, id=identifier, url=url)


def _conditions(classification: dict[str, Any] | None) -> list[VariantCondition]:
    return [
        VariantCondition(name=row["name"], xrefs=[_xref(xref["db"], xref["id"]) for xref in row["xrefs"]])
        for row in (classification or {}).get("conditions", [])
    ]


def resolve_gene(symbol: str, catalog: Catalog) -> tuple[str, EntityRef, EntityRef | None, str | None]:
    """Symbol, gene reference, protein reference and UniProt accession. A gene outside the catalog
    keeps its symbol and has no protein."""
    text = symbol.strip()
    if not is_gene_symbol(text):
        raise BadRequest(f"'{symbol}' is not a gene symbol.", code="invalid_gene_symbol")
    seed = catalog.gene(text)
    if seed is None:
        normalised = text if "orf" in text else text.upper()
        return normalised, EntityRef.of(EntityType.GENE, normalised, label=normalised), None, None
    gene = EntityRef.of(
        EntityType.GENE, seed.symbol, label=seed.name or seed.symbol, curie=(seed.hgnc_id or "").lower() or None
    )
    protein = None
    if seed.uniprot_accession:
        protein = EntityRef.of(
            EntityType.PROTEIN,
            seed.uniprot_accession,
            label=seed.protein_name,
            curie=f"uniprot:{seed.uniprot_accession}",
        )
    return seed.symbol, gene, protein, seed.uniprot_accession


def record_change(
    record: dict[str, Any],
    symbol: str,
    sequence: str | None,
    accession: str | None,
    main_transcript: str | None = None,
) -> tuple[ProteinChange | None, bool | None]:
    """Protein change of a ClinVar record in UniProt canonical numbering, and whether its reference
    residue was confirmed. ClinVar lists the change on every isoform; the one that agrees with the
    canonical sequence is used. A record titled on another transcript than the gene's main one is
    numbered on another isoform, so it is never confirmed."""
    title = parse_clinvar_title(record.get("title"))
    if title.gene_symbol and title.gene_symbol.upper() != symbol.upper():
        return None, None
    if main_transcript and title.transcript and title.transcript.split(".")[0] != main_transcript:
        return parse_protein_hgvs(title.protein), False
    candidates = [
        change
        for change in [parse_protein_hgvs(title.protein), *map(parse_protein_hgvs, record["protein_changes"])]
        if change is not None
    ]
    if not candidates:
        return None, None
    if not sequence:
        return candidates[0], None
    for change in candidates:
        if check_reference(change, sequence, accession).status == "match":
            return change, True
    return candidates[0], False


def _variant_id(symbol: str, change: ProteinChange | None, matches: bool | None, fallback: str) -> str:
    if change is not None and change.kind in ("substitution", "nonsense") and matches is not False:
        return f"{symbol}-{change.hgvs_p}"
    return fallback


def _main_transcript(records: list[dict[str, Any]]) -> str | None:
    """Transcript most ClinVar titles of the gene are written on (the MANE Select RefSeq)."""
    transcripts = Counter(
        title.transcript.split(".")[0]
        for title in (parse_clinvar_title(record.get("title")) for record in records)
        if title.transcript and title.protein
    )
    return transcripts.most_common(1)[0][0] if transcripts else None


def _clinvar_row(
    record: dict[str, Any],
    symbol: str,
    sequence: str | None,
    accession: str | None,
    main_transcript: str | None,
) -> _Row:
    change, matches = record_change(record, symbol, sequence, accession, main_transcript)
    title = parse_clinvar_title(record.get("title"))
    germline = record.get("germline") or {}
    consequences = [term for term in map(normalise_consequence, record["consequences"]) if term]
    vcv = record.get("vcv") or f"VCV{int(record['variation_id']):09d}"
    variant_id = _variant_id(symbol, change, matches, vcv)
    numbered = change if matches is not False else None
    summary = VariantSummary(
        id=variant_id,
        row_key=vcv,
        gene_symbol=symbol,
        name=record.get("title"),
        protein_change=change.hgvs_p if change else None,
        protein_change_short=change.short if change else None,
        position=numbered.position if numbered else None,
        end_position=numbered.end_position if numbered else None,
        reference_residue=numbered.reference if numbered else None,
        alternate_residue=numbered.alternate if numbered else None,
        change_kind=change.kind if change else None,
        reference_matches_uniprot=matches,
        consequence=consequences[0] if consequences else None,
        consequences=consequences,
        variant_type=record.get("variant_type"),
        hgvs=VariantHgvs(
            c=title.hgvs_c,
            p=change.hgvs_p if change else title.protein,
            g=title.hgvs_g,
            transcript=title.transcript,
            spdi=record.get("spdi"),
        ),
        clinical_significance=germline.get("description"),
        significance_keys=list(significance_keys(germline.get("description"))),
        review_status=germline.get("review_status"),
        review_stars=clinvar_stars(germline.get("review_status")),
        last_evaluated=germline.get("last_evaluated"),
        conditions=_conditions(germline),
        vcv=vcv,
        vcv_version=record.get("vcv_version"),
        variation_id=record["variation_id"],
        rsid=record.get("rsid"),
        in_clinvar=True,
        href=f"/variant/{variant_id}",
    )
    return _Row(summary=summary, clinvar=record)


def _uniprot_change(feature: dict[str, Any]) -> ProteinChange | None:
    wild, mutated, begin = feature.get("wild_type"), feature.get("mutated_type"), feature.get("begin")
    if not wild or not mutated or begin is None or begin != feature.get("end"):
        return None
    if len(wild) != 1 or len(mutated) != 1:
        return None
    return parse_protein_hgvs(f"{wild}{begin}{mutated}")


def _uniprot_row(feature: dict[str, Any], change: ProteinChange, symbol: str, accession: str) -> _Row:
    consequence = _EBI_CONSEQUENCES.get(
        (feature.get("consequence") or "").lower(), normalise_consequence(feature.get("consequence"))
    )
    variant_id = f"{symbol}-{change.hgvs_p}"
    genomic = feature.get("hgvs_g") or []
    summary = VariantSummary(
        id=variant_id,
        row_key=feature.get("ft_id") or f"{accession}:{change.hgvs_p}",
        gene_symbol=symbol,
        name=feature.get("ft_id"),
        protein_change=change.hgvs_p,
        protein_change_short=change.short,
        position=change.position,
        end_position=change.end_position,
        reference_residue=change.reference,
        alternate_residue=change.alternate,
        change_kind=change.kind,
        reference_matches_uniprot=True,
        consequence=consequence,
        consequences=[consequence] if consequence else [],
        hgvs=VariantHgvs(p=change.hgvs_p, g=genomic[0] if genomic else None),
        significance_keys=["not_classified"],
        rsid=feature.get("rsid"),
        in_uniprot=True,
        uniprot_feature_id=feature.get("ft_id"),
        href=f"/variant/{variant_id}",
    )
    return _Row(summary=summary, uniprot=feature)


def _count_rows(counter: Counter[str], keys_of: Any = None) -> list[CountRow]:
    return [
        CountRow(value=value, keys=list(keys_of(value)) if keys_of else [value], count=count)
        for value, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    ]


def _counts(rows: list[_Row], clinvar_data: dict[str, Any], curated: int, not_listed: int) -> VariantCounts:
    summaries = [row.summary for row in rows]
    significance = Counter(row.clinical_significance or "No ClinVar classification" for row in summaries)
    consequence = Counter(row.consequence or "Unknown" for row in summaries)
    stars = Counter(str(row.review_stars) for row in summaries if row.review_stars is not None)
    loaded = sum(1 for row in summaries if row.in_clinvar)
    return VariantCounts(
        total=len(summaries),
        clinvar_records=loaded,
        clinvar_gene_total=clinvar_data.get("gene_total"),
        uniprot_curated=curated,
        uniprot_only=sum(1 for row in summaries if not row.in_clinvar),
        uniprot_not_listed=not_listed,
        pathogenic_or_likely_pathogenic=sum(
            1 for row in summaries if {"pathogenic", "likely_pathogenic"} & set(row.significance_keys)
        ),
        with_protein_position=sum(1 for row in summaries if row.position is not None),
        by_significance=_count_rows(
            significance,
            lambda value: significance_keys(None if value == "No ClinVar classification" else value),
        ),
        by_consequence=_count_rows(consequence),
        by_review_stars=[
            CountRow(value=value, keys=[value], count=count) for value, count in sorted(stars.items())
        ],
    )


LOADED_TTL_SECONDS = 600.0
_loaded: dict[str, tuple[float, Catalog, _GeneVariants]] = {}
_loading: dict[str, asyncio.Task[_GeneVariants]] = {}


async def load_gene_variants(symbol: str, catalog: Catalog) -> _GeneVariants:
    """Merged variants of a gene. The list, the axis and the population view of one page ask for
    the same gene at once, so they share one load, and a complete load is kept for ten minutes."""
    key = symbol.strip().upper()
    remembered = _loaded.get(key)
    if remembered and remembered[0] > time.monotonic() and remembered[1] is catalog:
        return remembered[2]
    task = _loading.get(key)
    if task is None:
        task = asyncio.get_running_loop().create_task(_load_gene_variants(symbol, catalog))
        _loading[key] = task
        task.add_done_callback(lambda done: (_loading.pop(key, None), done.cancelled() or done.exception()))
    loaded = await asyncio.shield(task)
    if all(result.answered for result in loaded.gathered.results.values()):
        if len(_loaded) >= 64:
            _loaded.pop(next(iter(_loaded)))
        _loaded[key] = (time.monotonic() + LOADED_TTL_SECONDS, catalog, loaded)
    return loaded


async def _load_gene_variants(symbol: str, catalog: Catalog) -> _GeneVariants:
    """ClinVar records of the gene merged with UniProt-curated natural variants."""
    resolved, gene, protein, accession = resolve_gene(symbol, catalog)
    calls: dict[str, SourceCall] = {
        "clinvar": SourceCall(clinvar, clinvar.gene_records(resolved), timeout=90),
    }
    if accession:
        calls["uniprot"] = SourceCall(ebi_variation, ebi_variation.variation(accession), timeout=40)
    gathered = await gather_sources(calls)
    clinvar_data = gathered.data("clinvar", {}) or {}
    records = clinvar_data.get("records") or []
    if protein is None and not records and gathered["clinvar"].answered:
        raise NotFound(
            f"No gene {resolved} in the catalog and no ClinVar records under that symbol.",
            code="gene_not_found",
        )
    uniprot_data = gathered.data("uniprot", {}) if accession else {}
    sequence = uniprot_data.get("sequence")

    main_transcript = _main_transcript(records)
    rows = [_clinvar_row(record, resolved, sequence, accession, main_transcript) for record in records]
    by_key: dict[tuple[int, str, str], list[_Row]] = {}
    for row in rows:
        summary = row.summary
        if summary.position is not None and summary.reference_residue and summary.alternate_residue:
            key = (summary.position, summary.reference_residue, summary.alternate_residue)
            by_key.setdefault(key, []).append(row)
    curated = uniprot_data.get("curated") or []
    not_listed = 0
    for feature in curated:
        change = _uniprot_change(feature)
        if change is None or change.key is None or accession is None:
            not_listed += 1
            continue
        matched = by_key.get(change.key)
        if matched:
            for row in matched:
                row.uniprot = feature
                row.summary.in_uniprot = True
                row.summary.uniprot_feature_id = feature.get("ft_id")
        else:
            rows.append(_uniprot_row(feature, change, resolved, accession))
    rows.sort(key=lambda row: (row.summary.position is None, row.summary.position or 0, row.summary.row_key))
    return _GeneVariants(
        symbol=resolved,
        gene=gene,
        protein=protein,
        accession=accession,
        sequence=sequence,
        rows=rows,
        counts=_counts(rows, clinvar_data, len(curated), not_listed),
        clinvar_release=clinvar_data.get("release"),
        truncated=bool(clinvar_data.get("truncated")),
        gathered=gathered,
    )


def _matches(summary: VariantSummary, filters: VariantListFilters) -> bool:
    if not filters.all_significance and not set(filters.significance) & set(summary.significance_keys):
        return False
    if filters.consequence and not set(filters.consequence) & set(summary.consequences):
        return False
    if filters.min_stars and (summary.review_stars is None or summary.review_stars < filters.min_stars):
        return False
    if filters.residue_start is not None or filters.residue_end is not None:
        if summary.position is None:
            return False
        end = summary.end_position or summary.position
        if filters.residue_start is not None and end < filters.residue_start:
            return False
        if filters.residue_end is not None and summary.position > filters.residue_end:
            return False
    if filters.q:
        needle = filters.q.strip().lower()
        haystack = " ".join(
            value
            for value in (
                summary.id,
                summary.name,
                summary.protein_change,
                summary.protein_change_short,
                summary.vcv,
                summary.rsid,
                summary.hgvs.c,
                summary.clinical_significance,
                summary.uniprot_feature_id,
                *(condition.name for condition in summary.conditions),
            )
            if value
        ).lower()
        if needle not in haystack:
            return False
    return True


def _filtered(loaded: _GeneVariants, filters: VariantListFilters) -> list[_Row]:
    rows = [row for row in loaded.rows if _matches(row.summary, filters)]
    if filters.sort == "stars":
        rows.sort(key=lambda row: -(row.summary.review_stars if row.summary.review_stars is not None else -1))
    elif filters.sort == "last_evaluated":
        rows.sort(key=lambda row: row.summary.last_evaluated or "", reverse=True)
    return rows


def _variant_ref(summary: VariantSummary) -> EntityRef:
    return EntityRef.of(
        EntityType.VARIANT,
        summary.id,
        label=f"{summary.gene_symbol} {summary.protein_change or summary.name or summary.id}",
        curie=f"clinvar:{summary.vcv}" if summary.vcv else None,
    )


def _clinvar_evidence(
    provenance: Provenance | None, record: dict[str, Any], subject: EntityRef
) -> Evidence | None:
    germline = record.get("germline")
    if provenance is None or not germline:
        return None
    vcv = record.get("vcv") or record["variation_id"]
    version = (record.get("vcv_version") or "").partition(".")[2] or None
    return try_build_evidence(
        provenance,
        record_id=vcv,
        record_version=version,
        url=clinvar.record_url(record["variation_id"]),
        subject=subject,
        predicate="has_germline_classification",
        object=EvidenceObject(type="clinical_significance", value=germline["description"]),
        statement=f"{record.get('title') or vcv}: {germline['description']}",
        strength_value=germline.get("review_status"),
        asserted_at=germline.get("last_evaluated"),
    )


def _pmids(evidences: list[dict[str, Any]]) -> list[str]:
    seen: list[str] = []
    for row in evidences:
        if (row.get("source") or "").lower() == "pubmed" and row.get("id") and row["id"] not in seen:
            seen.append(row["id"])
    return seen


def _uniprot_evidence(
    provenance: Provenance | None, feature: dict[str, Any], accession: str, subject: EntityRef
) -> Evidence | None:
    if provenance is None:
        return None
    feature_id = feature.get("ft_id")
    codes = [row["code"] for row in feature.get("evidences", [])]
    described = "; ".join(row["value"] for row in feature.get("descriptions", [])) or None
    associations = ", ".join(row["name"] for row in feature.get("associations", [])) or None
    return try_build_evidence(
        provenance,
        database="uniprot",
        eco=codes[0] if codes else None,
        record_type=None if codes else "feature_without_evidence",
        record_id=feature_id or f"{accession}:{subject.id}",
        url=(
            f"https://web.expasy.org/variant_pages/{feature_id}.html"
            if feature_id
            else ebi_variation.record_url(accession)
        ),
        subject=subject,
        predicate="has_natural_variant_annotation",
        object=EvidenceObject(type="uniprot_natural_variant", id=feature_id, label=associations),
        statement=described,
        citations=[Citation(pmid=pmid) for pmid in _pmids(feature.get("evidences", []))],
    )


def _with_evidence(row: _Row, loaded: _GeneVariants) -> VariantSummary:
    summary = row.summary
    subject = _variant_ref(summary)
    evidence = []
    if row.clinvar is not None:
        evidence.append(_clinvar_evidence(loaded.gathered["clinvar"].provenance, row.clinvar, subject))
    if row.uniprot is not None and loaded.accession:
        evidence.append(
            _uniprot_evidence(loaded.gathered["uniprot"].provenance, row.uniprot, loaded.accession, subject)
        )
    return summary.model_copy(update={"evidence": [item for item in evidence if item is not None]})


async def gene_variants(
    symbol: str, catalog: Catalog, filters: VariantListFilters, limit: int, offset: int
) -> GeneVariantsResponse:
    loaded = await load_gene_variants(symbol, catalog)
    rows = _filtered(loaded, filters)
    return GeneVariantsResponse(
        items=[_with_evidence(row, loaded) for row in rows[offset : offset + limit]],
        total=len(rows),
        limit=limit,
        offset=offset,
        gene=loaded.gene,
        protein=loaded.protein,
        summary=loaded.counts,
        filters=VariantFilters(
            significance=filters.significance,
            consequence=filters.consequence,
            min_stars=filters.min_stars,
            residue_start=filters.residue_start,
            residue_end=filters.residue_end,
            q=filters.q,
            sort=filters.sort,
        ),
        clinvar_release=loaded.clinvar_release,
        truncated=loaded.truncated,
        sources=loaded.gathered.sources,
    )


CSV_COLUMNS = (
    "id",
    "gene",
    "protein_change",
    "protein_change_short",
    "position",
    "reference_residue",
    "alternate_residue",
    "consequence",
    "hgvs_c",
    "hgvs_p",
    "hgvs_g",
    "spdi",
    "clinical_significance",
    "review_status",
    "review_stars",
    "last_evaluated",
    "conditions",
    "clinvar_vcv",
    "rsid",
    "uniprot_feature",
    "reference_matches_uniprot",
    "sources",
    "clinvar_release",
    "uniprot_accession",
    "retrieved_at",
)


async def gene_variants_csv(symbol: str, catalog: Catalog, filters: VariantListFilters) -> tuple[str, str]:
    """CSV of the filtered variant table and its file name."""
    loaded = await load_gene_variants(symbol, catalog)
    provenance = loaded.gathered["clinvar"].provenance
    retrieved_at = provenance.retrieved_at.isoformat() if provenance else ""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for row in _filtered(loaded, filters):
        summary = row.summary
        writer.writerow(
            [
                summary.id,
                summary.gene_symbol,
                summary.protein_change or "",
                summary.protein_change_short or "",
                summary.position if summary.position is not None else "",
                summary.reference_residue or "",
                summary.alternate_residue or "",
                summary.consequence or "",
                summary.hgvs.c or "",
                summary.hgvs.p or "",
                summary.hgvs.g or "",
                summary.hgvs.spdi or "",
                summary.clinical_significance or "",
                summary.review_status or "",
                summary.review_stars if summary.review_stars is not None else "",
                summary.last_evaluated or "",
                "; ".join(condition.name for condition in summary.conditions),
                summary.vcv_version or summary.vcv or "",
                summary.rsid or "",
                summary.uniprot_feature_id or "",
                "" if summary.reference_matches_uniprot is None else str(summary.reference_matches_uniprot).lower(),
                "+".join(
                    name
                    for name, present in (("ClinVar", summary.in_clinvar), ("UniProt", summary.in_uniprot))
                    if present
                ),
                loaded.clinvar_release or "",
                loaded.accession or "",
                retrieved_at,
            ]
        )
    return buffer.getvalue(), f"{loaded.symbol}-variants.csv"


def _clinvar_record(
    record: dict[str, Any],
    provenance: Provenance | None,
    subject: EntityRef,
    submissions: SourceResult[Any] | None = None,
) -> ClinVarRecord:
    germline = record.get("germline") or {}
    title = parse_clinvar_title(record.get("title"))
    loaded = bool(submissions is not None and submissions.ok and submissions.data)
    rows = [ClinVarSubmission(**row) for row in (submissions.data if loaded and submissions else [])]
    summary = SubmissionSummary(
        scv_count=len(record["scv"]),
        rcv_count=len(record["rcv"]),
        scv_accessions=record["scv"],
        rcv_accessions=record["rcv"],
        submissions_loaded=loaded,
        by_classification=_count_rows(Counter(row.classification or "Not provided" for row in rows)),
        submissions=rows,
    )
    return ClinVarRecord(
        vcv=record.get("vcv"),
        vcv_version=record.get("vcv_version"),
        variation_id=record["variation_id"],
        title=record.get("title"),
        variant_type=record.get("variant_type"),
        classification=germline.get("description"),
        significance_keys=list(significance_keys(germline.get("description"))),
        review_status=germline.get("review_status"),
        review_stars=clinvar_stars(germline.get("review_status")),
        last_evaluated=germline.get("last_evaluated"),
        conditions=_conditions(germline),
        consequences=[term for term in map(normalise_consequence, record["consequences"]) if term],
        oncogenicity_classification=(record.get("oncogenicity") or {}).get("description"),
        clinical_impact_classification=(record.get("clinical_impact") or {}).get("description"),
        rsid=record.get("rsid"),
        hgvs_c=title.hgvs_c,
        protein_changes=record["protein_changes"],
        spdi=record.get("spdi"),
        url=clinvar.record_url(record["variation_id"]),
        submission_summary=summary,
        evidence=_clinvar_evidence(provenance, record, subject),
    )


def _frequency(block: dict[str, Any] | None) -> GnomadFrequency | None:
    if not block:
        return None
    return GnomadFrequency(
        allele_count=block.get("ac"),
        allele_number=block.get("an"),
        allele_frequency=block.get("af"),
        homozygote_count=block.get("homozygote_count"),
        hemizygote_count=block.get("hemizygote_count"),
        filters=list(block.get("filters") or []),
    )


def _gnomad_observation(
    result: SourceResult[Any] | None,
    records: list[dict[str, Any]],
    change: ProteinChange | None,
    subject: EntityRef,
) -> GnomadObservation:
    if result is None or not result.ok or result.data is None:
        reason = result.message if result is not None and result.message else "gnomAD was not queried."
        return GnomadObservation(
            status="unknown",
            label=f"Unknown: {reason}" if result is None or not result.is_empty else "No gnomAD gene record found",
            dataset=DATASET_LABEL,
        )
    data = result.data
    variants: dict[str, Any] = data["variants"]
    matched: dict[str, dict[str, Any]] = {}
    matched_by = None
    for record in records:
        joined = data["clinvar"].get(record["variation_id"])
        candidates = [
            (joined or {}).get("variant_id"),
            spdi_to_gnomad_id(record.get("spdi"), record.get("chromosome") or data.get("chromosome")),
        ]
        for index, variant_id in enumerate(candidates):
            if variant_id and variant_id in variants:
                matched[variant_id] = variants[variant_id]
                matched_by = matched_by or ("clinvar_variation_id" if index == 0 else "genomic_position")
    if change is not None and change.is_single_residue:
        for variant_id, row in variants.items():
            if row.get("hgvsp") == change.hgvs_p and row.get("transcript_id") == data.get(
                "canonical_transcript_id"
            ):
                matched.setdefault(variant_id, row)
                matched_by = matched_by or "protein_change"
    chromosome = data.get("chromosome")
    x_linked = chromosome == "X" if chromosome else None
    if not matched:
        return GnomadObservation(
            status="not_observed",
            label=f"Not observed in {DATASET_LABEL}",
            dataset=DATASET_LABEL,
            x_linked=x_linked,
        )
    alleles = []
    for variant_id, row in matched.items():
        evidence = None
        if result.provenance is not None:
            evidence = try_build_evidence(
                result.provenance,
                record_id=variant_id,
                url=gnomad.record_url(variant_id),
                subject=subject,
                predicate="observed_in_population",
                object=EvidenceObject(type="gnomad_variant", id=variant_id, label=row.get("hgvsp")),
            )
        alleles.append(
            GnomadAllele(
                variant_id=variant_id,
                hgvsc=row.get("hgvsc"),
                hgvsp=row.get("hgvsp"),
                consequence=row.get("consequence"),
                transcript_id=row.get("transcript_id"),
                rsids=list(row.get("rsids") or []),
                flags=list(row.get("flags") or []),
                exome=_frequency(row.get("exome")),
                genome=_frequency(row.get("genome")),
                url=gnomad.record_url(variant_id),
                evidence=evidence,
            )
        )
    return GnomadObservation(
        status="observed",
        label=f"Observed in {DATASET_LABEL}",
        dataset=DATASET_LABEL,
        matched_by=matched_by,
        x_linked=x_linked,
        alleles=alleles,
    )


def _uniprot_annotation(
    feature: dict[str, Any], accession: str, provenance: Provenance | None, subject: EntityRef
) -> UniProtVariantAnnotation:
    feature_id = feature.get("ft_id")
    return UniProtVariantAnnotation(
        feature_id=feature_id,
        accession=accession,
        position=feature.get("begin"),
        wild_type=feature.get("wild_type"),
        mutated_type=feature.get("mutated_type"),
        consequence=feature.get("consequence"),
        source_type=feature.get("source_type"),
        descriptions=[row["value"] for row in feature.get("descriptions", [])],
        associations=[
            UniProtAssociation(
                name=row["name"],
                is_disease=row["is_disease"],
                xrefs=[_xref(xref["db"], xref["id"], xref.get("url")) for xref in row["xrefs"] if xref.get("id")],
                pmids=_pmids(row["evidences"]),
            )
            for row in feature.get("associations", [])
        ],
        eco_codes=sorted({row["code"] for row in feature.get("evidences", [])}),
        pmids=_pmids(feature.get("evidences", [])),
        hgvs_g=feature.get("hgvs_g") or [],
        url=(
            f"https://web.expasy.org/variant_pages/{feature_id}.html"
            if feature_id
            else ebi_variation.record_url(accession)
        ),
        evidence=_uniprot_evidence(provenance, feature, accession, subject),
    )


def _reference_result(check: ReferenceCheck, accession: str | None) -> ReferenceCheckResult:
    return ReferenceCheckResult(
        status=check.status,
        accession=accession,
        position=check.position,
        expected=check.expected,
        found=check.found,
        sequence_length=check.sequence_length,
        message=check.message,
    )


def _vrs(change: ProteinChange | None, check: ReferenceCheck, sequence: str | None, accession: str | None) -> VrsIdentifier:
    if change is None or change.kind != "substitution" or change.position is None or not change.alternate:
        return VrsIdentifier(
            message="A VRS identifier is computed for single amino-acid substitutions only."
        )
    if check.status != "match" or not sequence:
        return VrsIdentifier(
            message="No VRS identifier: the reference residue was not confirmed on the UniProt sequence."
        )
    return VrsIdentifier(
        id=protein_substitution_vrs_id(sequence, change.position, change.alternate),
        sequence_accession=refget_accession(sequence),
        reference=f"UniProt {accession} canonical sequence",
        method="GA4GH VRS 2.x sha512t24u digest, computed by OrphaFold",
    )


def _record_rank(record: dict[str, Any]) -> tuple[int, str]:
    germline = record.get("germline") or {}
    return (clinvar_stars(germline.get("review_status")) or 0, germline.get("last_evaluated") or "")


def _record_symbol(record: dict[str, Any]) -> str | None:
    title = parse_clinvar_title(record.get("title"))
    if title.gene_symbol and is_gene_symbol(title.gene_symbol):
        return title.gene_symbol
    return record["genes"][0] if record.get("genes") else None


async def _resolve_by_accession(query: VariantQuery) -> SourceResult[Any]:
    if query.kind == "rsid":
        result = await clinvar.rsid_records(query.value)
    else:
        variation_id = vcv_to_variation_id(query.value) if query.kind == "vcv" else query.value
        result = await clinvar.variation_records([variation_id])
    if not result.answered:
        raise SourceUnavailable("ClinVar", result.message)
    if not (result.data or {}).get("records"):
        raise NotFound(f"ClinVar has no record for {query.value}.", code="variant_not_found")
    return result


async def variant_detail(variant_id: str, catalog: Catalog) -> VariantDetail:
    query = parse_variant_query(variant_id)
    if query is None:
        raise BadRequest(
            f"'{variant_id}' is not a variant identifier. Use GENE-p.Arg28His, GENE-R28H, a ClinVar "
            "VCV accession or an rsID.",
            code="variant_id_not_recognised",
        )
    results: dict[str, SourceResult[Any]] = {}
    records: list[dict[str, Any]] = []
    if query.kind == "protein":
        symbol_text = query.gene_symbol or ""
    else:
        results["clinvar"] = await _resolve_by_accession(query)
        records = sorted(results["clinvar"].data["records"], key=_record_rank, reverse=True)
        symbol_text = _record_symbol(records[0]) or ""
        if not symbol_text:
            raise NotFound(
                f"The ClinVar record for {query.value} names no single gene.", code="variant_gene_unknown"
            )

    symbol, gene, protein, accession = resolve_gene(symbol_text, catalog)
    calls: dict[str, SourceCall] = {"gnomad": SourceCall(gnomad, gnomad.gene_variants(symbol), timeout=45)}
    if accession:
        calls["uniprot"] = SourceCall(ebi_variation, ebi_variation.variation(accession), timeout=40)
    if query.kind == "protein" and query.change is not None:
        calls["clinvar"] = SourceCall(
            clinvar, clinvar.protein_change_records(symbol, query.change.hgvs_p), timeout=45
        )
    first = await gather_sources(calls)
    results.update(first.results)

    uniprot_result = results.get("uniprot")
    uniprot_data = (uniprot_result.data if uniprot_result and uniprot_result.ok else None) or {}
    sequence = uniprot_data.get("sequence")

    change = query.change
    matches: bool | None = None
    if query.kind == "protein" and change is not None:
        check = check_reference(change, sequence, accession)
        if check.status == "mismatch":
            raise ValidationFailed(
                f"{symbol} {change.hgvs_p} does not fit the reference sequence. {check.message}",
                code="reference_residue_mismatch",
                position=check.position,
                expected=check.expected,
                found=check.found,
                accession=accession,
            )
        if check.status == "out_of_range":
            raise ValidationFailed(
                f"{symbol} {change.hgvs_p} does not fit the reference sequence. {check.message}",
                code="position_out_of_range",
                position=check.position,
                sequence_length=check.sequence_length,
                accession=accession,
            )
        clinvar_result = results["clinvar"]
        found = (clinvar_result.data or {}).get("records") or [] if clinvar_result.answered else []
        records = sorted(
            (
                record
                for record in found
                if (candidate := record_change(record, symbol, sequence, accession)[0]) is not None
                and candidate.key == change.key
            ),
            key=_record_rank,
            reverse=True,
        )
        if protein is None and not records and clinvar_result.answered:
            raise NotFound(
                f"No gene {symbol} in the catalog and no ClinVar record for {change.hgvs_p}.",
                code="variant_not_found",
            )
        matches = True if check.status == "match" else None
    else:
        change, matches = record_change(records[0], symbol, sequence, accession)
        check = (
            check_reference(change, sequence, accession)
            if change is not None
            else ReferenceCheck("not_checked", message="This record carries no protein-level change.")
        )

    primary = records[0] if records else None
    fallback = (primary or {}).get("vcv") or variant_id
    resolved_id = _variant_id(symbol, change, matches, fallback)
    numbered = change if matches is not False else None
    subject = EntityRef.of(
        EntityType.VARIANT,
        resolved_id,
        label=f"{symbol} {change.hgvs_p}" if change else (primary or {}).get("title"),
        curie=f"clinvar:{primary['vcv']}" if primary and primary.get("vcv") else None,
    )

    title = parse_clinvar_title(primary.get("title")) if primary else None
    if primary is not None:
        second_calls: dict[str, SourceCall] = {
            "clinvar_submissions": SourceCall(clinvar, clinvar.submissions(primary["variation_id"]), timeout=30)
        }
        if title and title.hgvs_c:
            second_calls["vep"] = SourceCall(ensembl_vep, ensembl_vep.consequence(title.hgvs_c), timeout=20)
        results.update((await gather_sources(second_calls)).results)

    clinvar_result = results["clinvar"]
    clinvar_provenance = clinvar_result.provenance
    clinvar_record = (
        _clinvar_record(primary, clinvar_provenance, subject, results.get("clinvar_submissions"))
        if primary
        else None
    )
    clinvar_message = None
    if primary is None:
        clinvar_message = (
            "No ClinVar record found"
            if clinvar_result.answered
            else clinvar_result.message or "ClinVar did not answer."
        )

    feature = None
    if change is not None and change.key is not None and matches is not False:
        feature = next(
            (
                row
                for row in uniprot_data.get("curated") or []
                if (candidate := _uniprot_change(row)) is not None and candidate.key == change.key
            ),
            None,
        )
    uniprot_annotation = (
        _uniprot_annotation(
            feature, accession, uniprot_result.provenance if uniprot_result else None, subject
        )
        if feature is not None and accession
        else None
    )

    vep_result = results.get("vep")
    vep = None
    if vep_result is not None and vep_result.ok and vep_result.data:
        vep_evidence = None
        if vep_result.provenance is not None:
            vep_evidence = try_build_evidence(
                vep_result.provenance,
                database="ensembl",
                record_type="vep",
                record_id=vep_result.data.get("input"),
                subject=subject,
                predicate="has_predicted_consequence",
                object=EvidenceObject(
                    type="molecular_consequence", value=vep_result.data.get("most_severe_consequence")
                ),
                strength_value=vep_result.data.get("impact"),
            )
        vep = VepConsequence(**vep_result.data, evidence=vep_evidence)

    gnomad_observation = _gnomad_observation(results.get("gnomad"), records, numbered, subject)

    cross_references: dict[tuple[str, str], CrossReference] = {}

    def add(reference: CrossReference) -> None:
        cross_references.setdefault((reference.db.lower(), reference.id), reference)

    for record in records:
        if record.get("vcv"):
            add(_xref("ClinVar", record["vcv_version"] or record["vcv"], clinvar.record_url(record["variation_id"])))
        for xref in record["xrefs"]:
            identifier = f"rs{xref['id']}" if xref["db"] == "dbSNP" else xref["id"]
            add(_xref(xref["db"], identifier, _XREF_URLS["dbsnp"].format(id=xref["id"]) if xref["db"] == "dbSNP" else None))
    if feature is not None:
        for xref in feature["xrefs"]:
            if xref["db"] in ("UniProt", "dbSNP", "ClinGen"):
                add(_xref(xref["db"], xref["id"], xref.get("url")))
    for allele in gnomad_observation.alleles:
        add(_xref("gnomAD", allele.variant_id, allele.url))

    consequences = clinvar_record.consequences if clinvar_record else []
    feature_consequence = (
        _EBI_CONSEQUENCES.get((feature.get("consequence") or "").lower()) if feature is not None else None
    )
    genomic = (feature or {}).get("hgvs_g") or []
    return VariantDetail(
        id=resolved_id,
        query=variant_id,
        resolved_from=query.kind,
        gene=gene,
        protein=protein,
        name=(primary or {}).get("title") or (f"{symbol} {change.hgvs_p}" if change else None),
        protein_change=change.hgvs_p if change else None,
        protein_change_short=change.short if change else None,
        position=numbered.position if numbered else None,
        end_position=numbered.end_position if numbered else None,
        reference_residue=numbered.reference if numbered else None,
        alternate_residue=numbered.alternate if numbered else None,
        change_kind=change.kind if change else None,
        consequence=consequences[0] if consequences else feature_consequence,
        hgvs=VariantHgvs(
            c=title.hgvs_c if title else None,
            p=change.hgvs_p if change else None,
            g=(title.hgvs_g if title else None) or (genomic[0] if genomic else None),
            transcript=title.transcript if title else None,
            spdi=(primary or {}).get("spdi"),
        ),
        clinvar=clinvar_record,
        clinvar_message=clinvar_message,
        other_clinvar_records=[
            _clinvar_record(record, clinvar_provenance, subject) for record in records[1:]
        ],
        clinvar_release=(clinvar_result.data or {}).get("release") if clinvar_result.answered else None,
        uniprot=uniprot_annotation,
        gnomad=gnomad_observation,
        vep=vep,
        reference_check=_reference_result(check, accession),
        vrs=_vrs(change, check, sequence, accession),
        cross_references=list(cross_references.values()),
        sources=Gathered(results).sources,
    )
