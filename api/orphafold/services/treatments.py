"""Drugs and clinical candidates from Open Targets. A row exists only when Open Targets has a
record for it; stages and modalities are the source's own values."""

from typing import Any

from orphafold.errors import NotFound
from orphafold.evidence import try_build_evidence
from orphafold.knowledge.catalog import Catalog
from orphafold.schemas.common import EntityRef, EntityType, EvidenceObject, SourceState
from orphafold.schemas.diseases import (
    ClinicalReport,
    StageCount,
    Treatment,
    TreatmentIndication,
    TreatmentMechanism,
    TreatmentsResponse,
)
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.base import SourceResult
from orphafold.sources.open_targets import open_targets

# Open Targets clinical stages, latest first. Used to order rows inside this one scheme.
STAGE_LABELS: dict[str, str] = {
    "APPROVAL": "Approved",
    "PREAPPROVAL": "Preapproval",
    "PHASE_4": "Phase 4",
    "PHASE_3": "Phase 3",
    "PHASE_2_3": "Phase 2/3",
    "PHASE_2": "Phase 2",
    "PHASE_1_2": "Phase 1/2",
    "PHASE_1": "Phase 1",
    "EARLY_PHASE_1": "Early phase 1",
    "PRECLINICAL": "Preclinical",
}
_STAGE_ORDER = {stage: index for index, stage in enumerate(STAGE_LABELS)}
REPORT_LIMIT = 12


def stage_label(stage: str | None) -> str | None:
    if not stage:
        return None
    return STAGE_LABELS.get(stage, stage.replace("_", " ").capitalize())


def build_treatments(
    result: SourceResult, subject: EntityRef, scope: str
) -> tuple[list[Treatment], int | None]:
    """Rows of a drugAndClinicalCandidates block. The total is null when the source did not answer."""
    if not result.ok:
        return [], 0 if result.state is SourceState.EMPTY else None
    block: dict[str, Any] = (result.data or {}).get("drugAndClinicalCandidates") or {}
    treatments = []
    for row in block.get("rows") or []:
        drug = row.get("drug") or {}
        if not drug.get("id"):
            continue
        drug_id = drug["id"]
        modality = drug.get("drugType")
        small_molecule = (modality or "").lower() == "small molecule"
        source_url = open_targets.record_url(drug_id) or ""
        mechanisms = [
            TreatmentMechanism(
                mechanism=item.get("mechanismOfAction"),
                action_type=item.get("actionType"),
                target_name=item.get("targetName"),
                reference_urls=[url for ref in item.get("references") or [] for url in ref.get("urls") or []][
                    :6
                ],
            )
            for item in (drug.get("mechanismsOfAction") or {}).get("rows") or []
        ]
        indications: dict[tuple[str | None, str | None], TreatmentIndication] = {}
        for item in row.get("diseases") or []:
            disease = item.get("disease") or {}
            key = (disease.get("id"), item.get("diseaseFromSource"))
            indications[key] = TreatmentIndication(
                id=disease.get("id"), name=disease.get("name"), from_source=item.get("diseaseFromSource")
            )
        reports = row.get("clinicalReports") or []
        stage = row.get("maxClinicalStage")
        evidence = (
            try_build_evidence(
                result.provenance,
                record_type="clinical_candidate",
                record_id=drug_id,
                url=source_url,
                subject=subject,
                predicate="has_indicated_drug" if scope == "disease_indication" else "is_target_of",
                object=EvidenceObject(type="drug", id=f"chembl:{drug_id}", label=drug.get("name")),
                strength_value=stage,
                strength_scheme="open_targets_clinical_stage",
            )
            if result.provenance
            else None
        )
        treatments.append(
            Treatment(
                drug_id=drug_id,
                name=drug.get("name"),
                drug=EntityRef.of(
                    EntityType.COMPOUND if small_molecule else EntityType.DRUG,
                    drug_id,
                    label=drug.get("name"),
                    curie=f"chembl:{drug_id}",
                ),
                modality=modality,
                is_small_molecule=small_molecule,
                clinical_stage=stage,
                clinical_stage_label=stage_label(stage),
                drug_max_clinical_stage=drug.get("maximumClinicalStage"),
                mechanisms=mechanisms,
                indications=list(indications.values()),
                reports=[
                    ClinicalReport(
                        id=report.get("id"),
                        source=report.get("source"),
                        url=report.get("url"),
                        clinical_stage=report.get("clinicalStage"),
                        title=report.get("title"),
                        type=report.get("type"),
                        year=report.get("year"),
                    )
                    for report in reports[:REPORT_LIMIT]
                ],
                report_total=len(reports),
                source_url=source_url,
                scope=scope,
                evidence=evidence,
            )
        )
    treatments.sort(key=lambda item: (_STAGE_ORDER.get(item.clinical_stage or "", 99), item.name or ""))
    return treatments, block.get("count", len(treatments))


async def gene_treatments(symbol: str, catalog: Catalog) -> TreatmentsResponse:
    symbol = symbol.strip()
    gene = catalog.gene(symbol) or catalog.gene(symbol.upper())
    sources = []
    if gene:
        target_id = gene.ensembl_gene_id
        gene_ref = EntityRef.of(
            EntityType.GENE,
            gene.symbol,
            label=gene.name,
            curie=gene.hgnc_id.lower() if gene.hgnc_id else None,
        )
    else:
        gene_ref = EntityRef.of(EntityType.GENE, symbol.upper())
        resolved = await open_targets.target_id(symbol.upper())
        if resolved.state is SourceState.EMPTY:
            raise NotFound(f"No gene {symbol} in the catalog or in Open Targets.")
        target_id = resolved.data if resolved.ok else None
        if target_id is None:
            sources = [resolved.status()]
    if target_id is None:
        return TreatmentsResponse(gene=gene_ref, sources=sources or [open_targets.describe()])

    gathered = await gather_sources(
        {"drugs": SourceCall(open_targets, open_targets.target_drugs(target_id), timeout=25)}
    )
    treatments, total = build_treatments(gathered["drugs"], gene_ref, "target")
    counts: dict[str, int] = {}
    for treatment in treatments:
        if treatment.clinical_stage:
            counts[treatment.clinical_stage] = counts.get(treatment.clinical_stage, 0) + 1
    return TreatmentsResponse(
        gene=gene_ref,
        target_id=target_id,
        total=total,
        stage_counts=[
            StageCount(stage=stage, label=stage_label(stage) or stage, count=count)
            for stage, count in sorted(counts.items(), key=lambda item: _STAGE_ORDER.get(item[0], 99))
        ],
        treatments=treatments,
        sources=gathered.sources,
    )
