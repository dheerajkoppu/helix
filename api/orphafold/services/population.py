"""Variants of a gene in the slim form the sequence axis draws: ClinVar and UniProt rows with a
UniProt position, and gnomAD single-residue protein variants."""

import asyncio
from typing import Any

from pydantic import Field

from orphafold.hgvs import parse_protein_hgvs
from orphafold.knowledge.catalog import Catalog
from orphafold.schemas.common import Aggregated, EntityRef, Provenance, Schema
from orphafold.services.variants import load_gene_variants, resolve_gene
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.gnomad import DATASET_LABEL, gnomad

FREQUENCY_BASIS = (
    "Allele count and allele number are the sums of gnomAD's exome and genome call sets; "
    "allele_frequency is that count divided by that number. The per-call-set values are returned unchanged."
)
SCOPE_NOTE = (
    "Variants on the gnomAD canonical transcript whose protein consequence gnomAD reports as a "
    "single-residue change. Positions are the transcript's protein positions as gnomAD reports them; "
    "they match UniProt canonical numbering only where that transcript encodes the canonical sequence."
)


class PopulationCallSet(Schema):
    allele_count: int | None = None
    allele_number: int | None = None
    allele_frequency: float | None = None
    homozygote_count: int | None = None
    hemizygote_count: int | None = None


class PopulationVariant(Schema):
    gnomad_id: str
    """gnomAD variant ID, chrom-pos-ref-alt on GRCh38"""
    variant_id: str | None = None
    """GENE-p.Ref3PosAlt3 for a single-residue change"""
    hgvs_p: str
    position: int
    reference_residue: str | None = None
    alternate_residue: str | None = None
    change_kind: str
    consequence: str | None = None
    rsids: list[str] = Field(default_factory=list)
    flags: list[str] = Field(default_factory=list)
    allele_count: int | None = None
    allele_number: int | None = None
    allele_frequency: float | None = None
    exome: PopulationCallSet | None = None
    genome: PopulationCallSet | None = None
    url: str | None = None


class PopulationVariantsResponse(Aggregated):
    gene: EntityRef
    protein: EntityRef | None = None
    dataset: str
    transcript_id: str | None = None
    x_linked: bool | None = None
    total_in_gene: int | None = None
    """every gnomAD variant of the gene, before the protein-level filter"""
    items: list[PopulationVariant] = Field(default_factory=list)
    frequency_basis: str = FREQUENCY_BASIS
    scope_note: str = SCOPE_NOTE
    provenance: Provenance | None = None


def _call_set(block: dict[str, Any] | None) -> PopulationCallSet | None:
    if not block:
        return None
    return PopulationCallSet(
        allele_count=block.get("ac"),
        allele_number=block.get("an"),
        allele_frequency=block.get("af"),
        homozygote_count=block.get("homozygote_count"),
        hemizygote_count=block.get("hemizygote_count"),
    )


def _row(symbol: str, row: dict[str, Any]) -> PopulationVariant | None:
    change = parse_protein_hgvs(row.get("hgvsp"))
    if change is None or change.position is None or not change.is_single_residue:
        return None
    blocks = [block for block in (row.get("exome"), row.get("genome")) if block]
    count = sum(block.get("ac") or 0 for block in blocks)
    number = sum(block.get("an") or 0 for block in blocks)
    return PopulationVariant(
        gnomad_id=row["variant_id"],
        variant_id=change.variant_id(symbol) if change.kind != "synonymous" else None,
        hgvs_p=change.hgvs_p,
        position=change.position,
        reference_residue=change.reference,
        alternate_residue=change.alternate,
        change_kind=change.kind,
        consequence=row.get("consequence"),
        rsids=list(row.get("rsids") or []),
        flags=list(row.get("flags") or []),
        allele_count=count if blocks else None,
        allele_number=number if blocks else None,
        allele_frequency=count / number if number else None,
        exome=_call_set(row.get("exome")),
        genome=_call_set(row.get("genome")),
        url=gnomad.record_url(row["variant_id"]),
    )


async def gene_population_variants(symbol: str, catalog: Catalog) -> PopulationVariantsResponse:
    symbol, gene, protein, _ = resolve_gene(symbol, catalog)
    gathered = await gather_sources({"gnomad": SourceCall(gnomad, gnomad.gene_variants(symbol), timeout=45)})
    result = gathered["gnomad"]
    data = (result.data if result.ok else None) or {}
    transcript = data.get("canonical_transcript_id")
    variants: dict[str, Any] = data.get("variants") or {}
    items = [
        item
        for row in variants.values()
        if row.get("transcript_id") == transcript and (item := _row(symbol, row)) is not None
    ]
    items.sort(key=lambda item: (item.position, item.hgvs_p))
    chromosome = data.get("chromosome")
    return PopulationVariantsResponse(
        gene=gene,
        protein=protein,
        dataset=DATASET_LABEL,
        transcript_id=transcript,
        x_linked=chromosome == "X" if chromosome else None,
        total_in_gene=len(variants) if result.ok else None,
        items=items,
        provenance=result.provenance if result.ok else None,
        sources=gathered.sources,
    )


class AxisClinicalVariant(Schema):
    id: str
    row_key: str
    position: int
    reference_residue: str | None = None
    alternate_residue: str | None = None
    protein_change: str | None = None
    change_kind: str | None = None
    consequence: str | None = None
    clinical_significance: str | None = None
    significance_keys: list[str] = Field(default_factory=list)
    review_status: str | None = None
    review_stars: int | None = None
    condition: str | None = None
    vcv: str | None = None
    uniprot_feature_id: str | None = None
    in_clinvar: bool = False
    in_uniprot: bool = False


class AxisVariantsResponse(Aggregated):
    gene: EntityRef
    protein: EntityRef | None = None
    clinical: list[AxisClinicalVariant] = Field(default_factory=list)
    clinical_total: int = 0
    """every loaded ClinVar and UniProt row, including those without a UniProt position"""
    clinical_without_position: int = 0
    clinvar_release: str | None = None
    truncated: bool = False
    population: list[PopulationVariant] = Field(default_factory=list)
    population_dataset: str = DATASET_LABEL
    population_transcript_id: str | None = None
    frequency_basis: str = FREQUENCY_BASIS
    scope_note: str = (
        "Clinical rows are the gene's ClinVar and UniProt variants whose position is confirmed on the "
        "UniProt canonical sequence; rows numbered on another isoform are counted, not drawn. " + SCOPE_NOTE
    )


async def gene_axis_variants(symbol: str, catalog: Catalog) -> AxisVariantsResponse:
    loaded, population = await asyncio.gather(
        load_gene_variants(symbol, catalog), gene_population_variants(symbol, catalog)
    )
    clinical = []
    for row in loaded.rows:
        summary = row.summary
        if summary.position is None or summary.reference_matches_uniprot is False:
            continue
        named = [condition.name for condition in summary.conditions if condition.name != "not provided"]
        clinical.append(
            AxisClinicalVariant(
                id=summary.id,
                row_key=summary.row_key,
                position=summary.position,
                reference_residue=summary.reference_residue,
                alternate_residue=summary.alternate_residue,
                protein_change=summary.protein_change,
                change_kind=summary.change_kind,
                consequence=summary.consequence,
                clinical_significance=summary.clinical_significance,
                significance_keys=list(summary.significance_keys),
                review_status=summary.review_status,
                review_stars=summary.review_stars,
                condition=named[0] if named else None,
                vcv=summary.vcv,
                uniprot_feature_id=summary.uniprot_feature_id,
                in_clinvar=summary.in_clinvar,
                in_uniprot=summary.in_uniprot,
            )
        )
    clinical.sort(key=lambda item: item.position)
    return AxisVariantsResponse(
        gene=loaded.gene,
        protein=loaded.protein,
        clinical=clinical,
        clinical_total=len(loaded.rows),
        clinical_without_position=len(loaded.rows) - len(clinical),
        clinvar_release=loaded.clinvar_release,
        truncated=loaded.truncated,
        population=population.items,
        population_transcript_id=population.transcript_id,
        sources=[*loaded.gathered.sources, *population.sources],
    )
