"""Interactions of a protein: IntAct curated records, and STRING physical associations as a
separate layer. The two are never merged into one score."""

from typing import Any

from helix.evidence import try_build_evidence
from helix.knowledge.catalog import Catalog
from helix.schemas.common import Citation, EntityRef, EntityType, EvidenceObject
from helix.schemas.interactions import (
    CuratedInteraction,
    CuratedLayer,
    InteractionsResponse,
    OntologyTerm,
    StringAssociation,
    StringLayer,
)
from helix.services.pathways import protein_refs
from helix.sources import SourceCall, gather_sources
from helix.sources.base import SourceResult
from helix.sources.intact import intact
from helix.sources.string_db import CHANNELS, string_db

INTACT_ROW_LIMIT = 500
_CHANNEL_LABELS = {
    "escore": "experiments",
    "dscore": "curated databases",
    "tscore": "text mining",
    "ascore": "coexpression",
    "nscore": "gene neighbourhood",
    "fscore": "gene fusion",
    "pscore": "phylogenetic co-occurrence",
}


def _unique_terms(rows: list[dict[str, Any]], id_key: str, label_key: str) -> list[OntologyTerm]:
    seen: dict[str, OntologyTerm] = {}
    for row in rows:
        if row[id_key] and row[id_key] not in seen:
            seen[row[id_key]] = OntologyTerm(id=row[id_key], label=row[label_key])
    return list(seen.values())


def build_curated(result: SourceResult, protein: EntityRef, catalog: Catalog) -> CuratedLayer:
    rows: list[dict[str, Any]] = (result.data or []) if result.ok else []
    layer = CuratedLayer(total_rows=len(rows), rows_truncated=len(rows) >= INTACT_ROW_LIMIT)
    by_partner: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["self_interaction"]:
            layer.self_interaction_rows += 1
        elif row["negative"]:
            layer.negative_rows += 1
        elif not row["partner_is_uniprot"] or row["partner_tax_id"] != "9606":
            layer.non_human_or_non_protein_rows += 1
        else:
            by_partner.setdefault(row["partner_id"].split("-")[0], []).append(row)

    for partner_id, partner_rows in by_partner.items():
        symbol = next((row["partner_symbol"] for row in partner_rows if row["partner_symbol"]), None)
        scores = [row["mi_score"] for row in partner_rows if row["mi_score"] is not None]
        mi_score = max(scores) if scores else None
        pmids = sorted({pmid for row in partner_rows for pmid in row["pmids"]})
        acs = [row["interaction_ac"] for row in partner_rows if row["interaction_ac"]]
        partner = EntityRef.of(EntityType.PROTEIN, partner_id, label=symbol, curie=f"uniprot:{partner_id}")
        url = f"{intact.homepage}/search?query=id:{protein.id}%20AND%20id:{partner_id}"
        methods = _unique_terms(partner_rows, "method_id", "method")
        evidence = (
            try_build_evidence(
                result.provenance,
                record_type="interaction",
                record_id=acs[0] if acs else f"{protein.id}-{partner_id}",
                url=intact.record_url(acs[0]) if acs else url,
                subject=protein,
                predicate="interacts_with",
                object=EvidenceObject(type="protein", id=f"uniprot:{partner_id}", label=symbol),
                strength_value=mi_score,
                citations=[
                    Citation(pmid=pmid, url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/") for pmid in pmids[:20]
                ],
                modifiers=[term.label for term in methods if term.label][:6],
            )
            if result.provenance
            else None
        )
        layer.partners.append(
            CuratedInteraction(
                partner_id=partner_id,
                partner_symbol=symbol,
                partner=partner,
                in_catalog=catalog.gene_by_uniprot(partner_id) is not None,
                mi_score=mi_score,
                evidence_count=len(partner_rows),
                methods=methods,
                interaction_types=_unique_terms(partner_rows, "type_id", "type"),
                pmids=pmids,
                interaction_acs=acs,
                measured_with_mutant=any(row["query_mutated"] for row in partner_rows),
                url=url,
                evidence=evidence,
            )
        )
    # IntAct's own score; ties keep the pair with more evidence rows first
    layer.partners.sort(key=lambda item: (-(item.mi_score or 0.0), -item.evidence_count, item.partner_id))
    return layer


def build_string(
    result: SourceResult, protein: EntityRef, catalog: Catalog, curated: CuratedLayer
) -> StringLayer:
    data: dict[str, Any] = (result.data or {}) if result.ok else {}
    layer = StringLayer(string_id=data.get("string_id"), required_score=data.get("required_score"))
    curated_symbols = {item.partner_symbol.upper() for item in curated.partners if item.partner_symbol}
    for row in data.get("partners", []):
        symbol = row["symbol"]
        gene = catalog.gene(symbol) if symbol else None
        partner = (
            EntityRef.of(
                EntityType.PROTEIN,
                gene.uniprot_accession,
                label=symbol,
                curie=f"uniprot:{gene.uniprot_accession}",
            )
            if gene and gene.uniprot_accession
            else None
        )
        channels = {channel: row.get(channel) for channel in CHANNELS}
        dominant = max(channels, key=lambda channel: channels[channel] or 0.0)
        if not channels[dominant]:
            dominant = None
        url = string_db.record_url(row["string_id"])
        evidence = (
            try_build_evidence(
                result.provenance,
                record_type=dominant,
                record_id=f"{data['string_id']}|{row['string_id']}",
                url=url,
                subject=protein,
                predicate="physically_associated_with",
                object=EvidenceObject(type="protein", id=f"string:{row['string_id']}", label=symbol),
                strength_value=row["score"],
                modifiers=[
                    "combined score of the physical subnetwork",
                    f"largest channel: {_CHANNEL_LABELS[dominant]}",
                ],
            )
            if result.provenance and dominant
            else None
        )
        layer.partners.append(
            StringAssociation(
                string_id=row["string_id"],
                partner_symbol=symbol,
                partner=partner,
                in_catalog=gene is not None,
                also_in_intact=bool(symbol) and symbol.upper() in curated_symbols,
                score=row["score"],
                channels=channels,
                dominant_channel=dominant,
                url=url,
                evidence=evidence,
            )
        )
    return layer


def interaction_calls(accession: str) -> dict[str, SourceCall]:
    return {
        "intact": SourceCall(intact, intact.interactions(accession, limit=INTACT_ROW_LIMIT), timeout=35),
        "string": SourceCall(string_db, string_db.physical_partners(accession), timeout=25),
    }


async def protein_interactions(accession: str, catalog: Catalog) -> InteractionsResponse:
    accession = accession.strip().upper()
    gathered = await gather_sources(interaction_calls(accession))
    protein, gene = protein_refs(accession, catalog)
    curated = build_curated(gathered["intact"], protein, catalog)
    return InteractionsResponse(
        protein=protein,
        gene=gene,
        curated=curated,
        string_physical=build_string(gathered["string"], protein, catalog, curated),
        sources=gathered.sources,
    )
