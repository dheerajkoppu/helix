"""Disease bundle: the catalog record, its gene and protein, sourced treatments, research status
built from single-source counts, and a relationship graph whose every edge carries evidence."""

import re
from datetime import UTC, datetime
from typing import Any

from helix.errors import NotFound
from helix.evidence import try_build_evidence
from helix.knowledge.catalog import Catalog, SeedDisease, SeedGene, SeedProvenance
from helix.schemas.common import (
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Provenance,
    entity_href,
)
from helix.schemas.diseases import (
    CrossReference,
    DiseaseCategory,
    DiseaseCategoryFacet,
    DiseaseDefinition,
    DiseaseGeneSummary,
    DiseaseInheritance,
    DiseaseListItem,
    DiseaseListResponse,
    DiseasePhenotype,
    DiseaseProteinSummary,
    DiseaseResponse,
    DiseaseTerm,
    GraphEdge,
    GraphNode,
    RelationshipGraph,
    ResearchStatusItem,
)
from helix.schemas.genes import RecordSource
from helix.schemas.interactions import CuratedLayer, Pathway, StringLayer
from helix.services.genes import STATISTICS
from helix.services.interactions import build_curated, build_string, interaction_calls
from helix.services.pathways import build_pathways
from helix.services.treatments import build_treatments
from helix.sources import SourceCall, gather_sources
from helix.sources.base import Gathered, SourceResult
from helix.sources.monarch import monarch
from helix.sources.open_targets import open_targets
from helix.sources.reactome import reactome

GRAPH_PATHWAY_LIMIT = 8
GRAPH_CURATED_LIMIT = 8
GRAPH_STRING_LIMIT = 6
TARGET_DRUG_LIMIT = 25

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")
_XREF_URLS = {
    "MONDO": "https://monarchinitiative.org/{curie}",
    "ORPHA": "https://www.orpha.net/en/disease/detail/{local}",
    "OMIM": "https://omim.org/entry/{local}",
}


def first_sentence(text: str) -> str:
    return _SENTENCE_END.split(text.strip(), maxsplit=1)[0]


def _record_source(
    catalog: Catalog, source_id: str, record_id: Any = None, url: str | None = None
) -> RecordSource:
    seed = catalog.seed_source(source_id)
    return RecordSource(
        source_id=source_id,
        name=seed.name if seed else None,
        record_id=str(record_id) if record_id is not None else None,
        url=url,
        release=seed.release if seed else None,
        license=seed.license if seed else None,
        retrieved_at=seed.retrieved_at if seed else None,
    )


def _from_provenance(catalog: Catalog, item: SeedProvenance | None) -> RecordSource | None:
    return _record_source(catalog, item.source_id, item.record_id, item.url) if item else None


def _find(items: list[SeedProvenance], source_id: str) -> SeedProvenance | None:
    return next((item for item in items if item.source_id == source_id), None)


def _seed_provenance(catalog: Catalog, item: SeedProvenance, database: str) -> Provenance | None:
    """Provenance envelope of a seeded record, so that it can back an Evidence row."""
    seed = catalog.seed_source(item.source_id)
    if seed is None or item.record_id is None:
        return None
    try:
        retrieved_at = datetime.fromisoformat((seed.retrieved_at or "").replace("Z", "+00:00"))
    except ValueError:
        retrieved_at = catalog.status.loaded_at or datetime.now(UTC)
    return Provenance(
        source=database,
        source_name=seed.name or database,
        release=seed.release,
        request_url=seed.url or item.url or "",
        retrieved_at=retrieved_at,
        record_id=str(item.record_id),
        record_url=item.url,
        license=seed.license,
        response_sha256=seed.sha256,
        from_cache=True,
    )


def disease_ref(disease: SeedDisease) -> EntityRef:
    curie = disease.xrefs.mondo[0] if disease.xrefs.mondo else None
    return EntityRef.of(
        EntityType.DISEASE, disease.id, label=disease.name, curie=str(curie) if curie else None
    )


def resolve_disease(disease_id: str, catalog: Catalog) -> SeedDisease:
    """A slug, or any exact name, alias or cross-reference of one catalog disease."""
    disease = catalog.disease(disease_id) or catalog.disease(disease_id.lower())
    if disease is None:
        matches = {ref.id for ref in catalog.lookup(disease_id) if ref.type is EntityType.DISEASE}
        if len(matches) == 1:
            disease = catalog.disease(matches.pop())
    if disease is None:
        raise NotFound(f"No disease {disease_id} in the catalog.")
    return disease


def _category(catalog: Catalog, disease: SeedDisease) -> DiseaseCategory | None:
    category = catalog.category(disease.category_id) if disease.category_id else None
    if category is None:
        return None
    found = catalog.subcategory(disease.subcategory_id) if disease.subcategory_id else None
    return DiseaseCategory(
        id=category.id,
        name=category.name,
        table=category.table,
        subcategory_id=disease.subcategory_id,
        subcategory_name=found[1].name if found else None,
    )


def _xrefs(disease: SeedDisease) -> list[CrossReference]:
    rows = []
    for value in [*disease.xrefs.mondo, *disease.xrefs.orphanet, *disease.xrefs.omim]:
        curie = str(value)
        prefix, _, local = curie.partition(":")
        template = _XREF_URLS.get(prefix.upper())
        rows.append(
            CrossReference(
                database=prefix, id=curie, url=template.format(curie=curie, local=local) if template else None
            )
        )
    return rows


def _phenotypes(catalog: Catalog, disease: SeedDisease) -> list[DiseasePhenotype]:
    rows = []
    for phenotype in disease.phenotypes:
        record = _find(disease.provenance, phenotype.source_id) if phenotype.source_id else None
        source = _from_provenance(catalog, record)
        if source is None and phenotype.source_id:
            source = _record_source(catalog, phenotype.source_id)
        rows.append(
            DiseasePhenotype(
                hpo_id=phenotype.hpo_id,
                label=phenotype.label,
                frequency=phenotype.frequency,
                url=f"https://hpo.jax.org/browse/term/{phenotype.hpo_id}",
                source=source,
            )
        )
    return rows


def _status_from_seed(catalog: Catalog, gene: SeedGene) -> list[ResearchStatusItem]:
    rows = []
    for key, label, definition, source_id, index in STATISTICS:
        records = [item for item in gene.provenance if item.source_id == source_id]
        record = records[index] if index < len(records) else None
        rows.append(
            ResearchStatusItem(
                key=key,
                label=label,
                value=getattr(gene.stats, key),
                definition=definition,
                retrieved_at=gene.stats.retrieved_at,
                source=_from_provenance(catalog, record),
            )
        )
    return rows


def _live_source(
    result: SourceResult, record_id: str | None = None, url: str | None = None
) -> RecordSource | None:
    provenance = result.provenance
    if provenance is None:
        return None
    return RecordSource(
        source_id=provenance.source,
        name=provenance.source_name,
        record_id=record_id or provenance.record_id,
        url=url or provenance.record_url,
        release=provenance.release,
        license=provenance.license,
        retrieved_at=provenance.retrieved_at.isoformat(),
    )


def _count_or_none(result: SourceResult, count: int) -> int | None:
    """A count only when the source answered: an unavailable source is unknown, not zero."""
    return count if result.answered else None


def _validity_item(result: SourceResult | None, subject: EntityRef, gene: SeedGene) -> ResearchStatusItem:
    definition = (
        "ClinGen gene-disease validity classification for this gene and disease, as carried by Open "
        "Targets. Null means Open Targets holds no ClinGen curation for the pair."
    )
    item = ResearchStatusItem(
        key="gene_disease_validity", label="Gene-disease validity (ClinGen)", definition=definition
    )
    if result is None or not result.ok:
        return item
    rows = ((result.data or {}).get("evidences") or {}).get("rows") or []
    row = next((row for row in rows if row.get("datasourceId") == "clingen" and row.get("confidence")), None)
    if row is None:
        item.source = _live_source(result)
        return item
    url = next((link.get("url") for link in row.get("urls") or [] if link.get("url")), None)
    item.value = row["confidence"]
    item.source = _live_source(result, record_id=row["id"], url=url)
    item.retrieved_at = item.source.retrieved_at if item.source else None
    item.evidence = try_build_evidence(
        result.provenance,
        record_type="clingen",
        record_id=row["id"],
        url=url,
        subject=subject,
        predicate="has_gene_disease_validity",
        object=EvidenceObject(type="gene", id=(gene.hgnc_id or gene.symbol).lower(), label=gene.symbol),
        statement=f"{row['confidence']} ({row.get('studyId')})" if row.get("studyId") else row["confidence"],
        strength_value=row["confidence"],
        strength_scheme="clingen_gene_validity",
    )
    return item


def _graph(
    catalog: Catalog,
    disease: SeedDisease,
    subject: EntityRef,
    gene: SeedGene | None,
    pathways: list[Pathway],
    curated: CuratedLayer | None,
    string_layer: StringLayer | None,
    monarch_result: SourceResult | None,
    gathered: Gathered | None,
) -> RelationshipGraph:
    disease_node = f"disease:{disease.id}"
    graph = RelationshipGraph(
        nodes=[GraphNode(id=disease_node, type="disease", label=disease.name, ref=subject, in_catalog=True)]
    )
    if gene is None:
        return graph

    gene_ref = EntityRef.of(
        EntityType.GENE, gene.symbol, label=gene.name, curie=gene.hgnc_id.lower() if gene.hgnc_id else None
    )
    gene_node = f"gene:{gene.symbol}"
    graph.nodes.append(GraphNode(id=gene_node, type="gene", label=gene.symbol, ref=gene_ref, in_catalog=True))
    gene_object = EvidenceObject(type="gene", id=(gene.hgnc_id or gene.symbol).lower(), label=gene.symbol)

    causal: list[Evidence] = []
    iuis = next((item for item in disease.provenance if item.source_id.startswith("iuis")), None)
    provenance = _seed_provenance(catalog, iuis, "iuis") if iuis else None
    if provenance:
        row = try_build_evidence(
            provenance,
            record_type="classification",
            subject=subject,
            predicate="caused_by",
            object=gene_object,
        )
        if row:
            causal.append(row)
    if monarch_result is not None and monarch_result.ok and monarch_result.provenance:
        for association in monarch_result.data or []:
            if association["gene_id"] != gene.hgnc_id or not association["id"]:
                continue
            mondo = monarch_result.provenance.record_id
            row = try_build_evidence(
                monarch_result.provenance,
                record_type="causal_gene",
                record_id=association["id"],
                url=monarch.record_url(mondo) if mondo else None,
                subject=subject,
                predicate="caused_by",
                object=gene_object,
                modifiers=[association["primary_knowledge_source"]]
                if association["primary_knowledge_source"]
                else [],
            )
            if row:
                causal.append(row)
    graph.edges.append(
        GraphEdge(
            id=f"{disease_node}>{gene_node}",
            source=disease_node,
            target=gene_node,
            type="caused_by",
            label="caused by variants in",
            layer="iuis",
            evidence=causal,
        )
    )

    accession = gene.uniprot_accession
    if not accession:
        return graph
    protein_ref = EntityRef.of(
        EntityType.PROTEIN, accession, label=gene.protein_name, curie=f"uniprot:{accession}"
    )
    protein_node = f"protein:{accession}"
    graph.nodes.append(
        GraphNode(
            id=protein_node,
            type="protein",
            label=gene.protein_name or accession,
            ref=protein_ref,
            in_catalog=True,
        )
    )
    encodes: list[Evidence] = []
    uniprot_record = _find(gene.provenance, "uniprot")
    provenance = _seed_provenance(catalog, uniprot_record, "uniprot") if uniprot_record else None
    if provenance:
        row = try_build_evidence(
            provenance,
            record_type="entry",
            subject=gene_ref,
            predicate="encodes",
            object=EvidenceObject(type="protein", id=f"uniprot:{accession}", label=gene.protein_name),
        )
        if row:
            encodes.append(row)
    graph.edges.append(
        GraphEdge(
            id=f"{gene_node}>{protein_node}",
            source=gene_node,
            target=protein_node,
            type="encodes",
            label="encodes",
            layer="uniprot",
            evidence=encodes,
        )
    )

    if gathered is not None:
        graph.pathway_total = _count_or_none(gathered["pathways"], len(pathways))
    for pathway in pathways[:GRAPH_PATHWAY_LIMIT]:
        node = f"pathway:{pathway.id}"
        graph.nodes.append(
            GraphNode(
                id=node,
                type="pathway",
                label=pathway.name,
                ref=EntityRef.of(
                    EntityType.PATHWAY, pathway.id, label=pathway.name, curie=f"reactome:{pathway.id}"
                ),
                url=pathway.url,
            )
        )
        graph.edges.append(
            GraphEdge(
                id=f"{protein_node}>{node}",
                source=protein_node,
                target=node,
                type="participates_in",
                label="participates in",
                layer="reactome",
                evidence=[pathway.evidence] if pathway.evidence else [],
            )
        )

    node_by_symbol: dict[str, str] = {}
    if curated is not None and gathered is not None:
        graph.curated_partner_total = _count_or_none(gathered["intact"], len(curated.partners))
        for partner in curated.partners[:GRAPH_CURATED_LIMIT]:
            node = f"protein:{partner.partner_id}"
            if partner.partner_symbol:
                node_by_symbol[partner.partner_symbol.upper()] = node
            graph.nodes.append(
                GraphNode(
                    id=node,
                    type="interactor",
                    label=partner.partner_symbol or partner.partner_id,
                    ref=partner.partner,
                    url=partner.url,
                    in_catalog=partner.in_catalog,
                )
            )
            graph.edges.append(
                GraphEdge(
                    id=f"{protein_node}>{node}:intact",
                    source=protein_node,
                    target=node,
                    type="interacts_with",
                    label="interacts with (IntAct, curated)",
                    layer="intact",
                    evidence=[partner.evidence] if partner.evidence else [],
                )
            )
    if string_layer is not None and gathered is not None:
        graph.string_partner_total = _count_or_none(gathered["string"], len(string_layer.partners))
        for partner in string_layer.partners[:GRAPH_STRING_LIMIT]:
            symbol = (partner.partner_symbol or "").upper()
            node = node_by_symbol.get(symbol)
            if node is None:
                node = f"protein:{partner.partner.id}" if partner.partner else f"string:{partner.string_id}"
                if all(existing.id != node for existing in graph.nodes):
                    graph.nodes.append(
                        GraphNode(
                            id=node,
                            type="interactor",
                            label=partner.partner_symbol or partner.string_id,
                            ref=partner.partner,
                            url=partner.url,
                            in_catalog=partner.in_catalog,
                        )
                    )
            graph.edges.append(
                GraphEdge(
                    id=f"{protein_node}>{node}:string",
                    source=protein_node,
                    target=node,
                    type="physically_associated_with",
                    label="physical association (STRING, combined score)",
                    layer="string",
                    evidence=[partner.evidence] if partner.evidence else [],
                )
            )
    return graph


async def get_disease(disease_id: str, catalog: Catalog) -> DiseaseResponse:
    disease = resolve_disease(disease_id.strip(), catalog)
    subject = disease_ref(disease)
    gene = catalog.gene(disease.gene_symbol) if disease.gene_symbol else None
    accession = gene.uniprot_accession if gene else None
    mondo = str(disease.xrefs.mondo[0]) if disease.xrefs.mondo else None
    open_targets_id = mondo or (str(disease.xrefs.orphanet[0]) if disease.xrefs.orphanet else None)

    calls: dict[str, SourceCall] = {}
    if open_targets_id:
        targets = [gene.ensembl_gene_id] if gene and gene.ensembl_gene_id else []
        calls["disease_drugs"] = SourceCall(
            open_targets, open_targets.disease_drugs(open_targets_id, targets), timeout=25
        )
    if gene and gene.ensembl_gene_id:
        calls["target_drugs"] = SourceCall(
            open_targets, open_targets.target_drugs(gene.ensembl_gene_id), timeout=25
        )
    if mondo and gene:
        calls["monarch"] = SourceCall(monarch, monarch.causal_gene_associations(mondo), timeout=15)
    if accession:
        calls["pathways"] = SourceCall(reactome, reactome.pathways(accession), timeout=20)
        calls.update(interaction_calls(accession))
    gathered = await gather_sources(calls) if calls else None

    def result(key: str) -> SourceResult | None:
        return gathered[key] if gathered is not None and key in calls else None

    disease_drugs = result("disease_drugs")
    treatments, treatment_total = (
        build_treatments(disease_drugs, subject, "disease_indication") if disease_drugs else ([], None)
    )
    target_result = result("target_drugs")
    gene_ref = (
        EntityRef.of(
            EntityType.GENE,
            gene.symbol,
            label=gene.name,
            curie=gene.hgnc_id.lower() if gene.hgnc_id else None,
        )
        if gene
        else None
    )
    target_drugs, target_drug_total = (
        build_treatments(target_result, gene_ref, "target") if target_result and gene_ref else ([], None)
    )

    pathways: list[Pathway] = []
    curated: CuratedLayer | None = None
    string_layer: StringLayer | None = None
    if accession and gathered is not None:
        protein_ref = EntityRef.of(
            EntityType.PROTEIN, accession, label=gene.protein_name, curie=f"uniprot:{accession}"
        )
        pathways = build_pathways(gathered["pathways"], protein_ref)
        curated = build_curated(gathered["intact"], protein_ref, catalog)
        string_layer = build_string(gathered["string"], protein_ref, catalog, curated)

    status: list[ResearchStatusItem] = []
    if gene:
        status.extend(_status_from_seed(catalog, gene))
        status.append(_validity_item(disease_drugs, subject, gene))
    phenotype_sources = sorted({item.source_id for item in disease.phenotypes if item.source_id})
    status.append(
        ResearchStatusItem(
            key="phenotype_count",
            label="Annotated phenotypes",
            value=len(disease.phenotypes),
            definition="HPO terms annotated to the mapped disorder by Orphanet, then by HPO for terms "
            "Orphanet does not list. Annotations marked excluded are left out.",
            source=_from_provenance(catalog, _find(disease.provenance, phenotype_sources[0]))
            if phenotype_sources
            else None,
        )
    )
    status.append(
        ResearchStatusItem(
            key="indicated_drug_count",
            label="Drugs with this disease as an indication",
            value=treatment_total,
            definition="Drugs and clinical candidates that Open Targets records with this disease as an "
            "indication, at any clinical stage. Null means the disease has no mapped ID or Open Targets "
            "did not answer.",
            source=_live_source(disease_drugs) if disease_drugs else None,
        )
    )
    if accession and gathered is not None and curated is not None:
        status.append(
            ResearchStatusItem(
                key="pathway_count",
                label="Reactome pathways",
                value=_count_or_none(gathered["pathways"], len(pathways)),
                definition="Reactome pathways the UniProt accession maps to in Homo sapiens.",
                source=_live_source(gathered["pathways"]),
            )
        )
        status.append(
            ResearchStatusItem(
                key="curated_interaction_partner_count",
                label="Curated interaction partners",
                value=_count_or_none(gathered["intact"], len(curated.partners)),
                definition="Distinct human proteins with at least one curated IntAct interaction with the "
                "protein. Negative and self interactions are not counted.",
                source=_live_source(gathered["intact"]),
            )
        )

    definition = None
    if disease.definition:
        source_id = disease.definition.source_id
        definition = DiseaseDefinition(
            text=disease.definition.text,
            one_line=first_sentence(disease.definition.text),
            source=_record_source(
                catalog,
                source_id,
                getattr(_find(disease.provenance, source_id), "record_id", None),
                disease.definition.url,
            )
            if source_id
            else None,
        )

    iuis = next((item for item in disease.provenance if item.source_id.startswith("iuis")), None)
    return DiseaseResponse(
        id=disease.id,
        name=disease.name,
        ref=subject,
        aliases=disease.aliases,
        category=_category(catalog, disease),
        inheritance=DiseaseInheritance(
            raw=disease.inheritance.raw,
            codes=disease.inheritance.codes,
            terms=[
                DiseaseTerm(id=term.id, label=term.label, url=f"https://hpo.jax.org/browse/term/{term.id}")
                for term in disease.inheritance.hpo
            ],
            source=_from_provenance(catalog, iuis),
        ),
        mechanism=disease.mechanism,
        is_phenocopy=disease.is_phenocopy,
        xrefs=_xrefs(disease),
        definition=definition,
        explanation=definition.one_line if definition else None,
        phenotypes=_phenotypes(catalog, disease),
        gene=DiseaseGeneSummary(
            symbol=gene.symbol,
            name=gene.name,
            hgnc_id=gene.hgnc_id,
            chromosome=str(gene.chromosome) if gene.chromosome is not None else None,
            ensembl_gene_id=gene.ensembl_gene_id,
            ncbi_gene_id=str(gene.ncbi_gene_id) if gene.ncbi_gene_id is not None else None,
            href=entity_href(EntityType.GENE, gene.symbol) or f"/gene/{gene.symbol}",
            other_disease_count=max(len(gene.disease_ids) - 1, 0),
            source=_from_provenance(catalog, _find(gene.provenance, "hgnc")),
        )
        if gene
        else None,
        protein=DiseaseProteinSummary(
            accession=accession,
            name=gene.protein_name,
            length=gene.protein_length,
            family=gene.protein_family,
            href=entity_href(EntityType.PROTEIN, accession) or f"/protein/{accession}",
            source=_from_provenance(catalog, _find(gene.provenance, "uniprot")),
        )
        if gene and accession
        else None,
        treatments=treatments,
        treatment_total=treatment_total,
        target_drugs=target_drugs[:TARGET_DRUG_LIMIT],
        target_drug_total=target_drug_total,
        research_status=status,
        graph=_graph(
            catalog, disease, subject, gene, pathways, curated, string_layer, result("monarch"), gathered
        ),
        record_sources=[source for item in disease.provenance if (source := _from_provenance(catalog, item))],
        sources=[catalog.source_status(), *(gathered.sources if gathered is not None else [])],
    )


def _matches(disease: SeedDisease, needle: str) -> bool:
    haystack = [disease.name, disease.id, disease.gene_symbol or "", *disease.aliases]
    haystack += [str(value) for value in (*disease.xrefs.mondo, *disease.xrefs.orphanet, *disease.xrefs.omim)]
    return any(needle in value.lower() for value in haystack)


def list_diseases(
    catalog: Catalog, *, category: str | None, q: str | None, page: int, page_size: int
) -> DiseaseListResponse:
    needle = (q or "").strip().lower()
    matched = [disease for disease in catalog.diseases if not needle or _matches(disease, needle)]
    facets = [
        DiseaseCategoryFacet(
            id=item.id,
            name=item.name,
            table=item.table,
            count=sum(1 for disease in matched if disease.category_id == item.id),
        )
        for item in catalog.categories
    ]
    if category:
        wanted = category.strip().lower()
        table = wanted.removeprefix("iuis-t") if wanted.removeprefix("iuis-t").isdigit() else None
        matched = [
            disease
            for disease in matched
            if (disease.category_id or "").lower() == wanted
            or (disease.subcategory_id or "").lower() == wanted
            or (table is not None and (disease.category_id or "").lower() == f"iuis-t{table}")
        ]
    offset = (page - 1) * page_size
    items = []
    for disease in matched[offset : offset + page_size]:
        found_category = catalog.category(disease.category_id) if disease.category_id else None
        found = catalog.subcategory(disease.subcategory_id) if disease.subcategory_id else None
        gene = catalog.gene(disease.gene_symbol) if disease.gene_symbol else None
        items.append(
            DiseaseListItem(
                id=disease.id,
                name=disease.name,
                href=entity_href(EntityType.DISEASE, disease.id) or f"/disease/{disease.id}",
                aliases=disease.aliases[:4],
                gene_symbol=disease.gene_symbol,
                category_id=disease.category_id,
                category_name=found_category.name if found_category else None,
                subcategory_id=disease.subcategory_id,
                subcategory_name=found[1].name if found else None,
                inheritance_codes=disease.inheritance.codes,
                mechanism=disease.mechanism,
                is_phenocopy=disease.is_phenocopy,
                explanation=first_sentence(disease.definition.text) if disease.definition else None,
                phenotype_count=len(disease.phenotypes),
                clinvar_pathogenic_count=gene.stats.clinvar_pathogenic_count if gene else None,
                experimental_structure_count=gene.stats.experimental_structure_count if gene else None,
            )
        )
    return DiseaseListResponse(
        items=items,
        total=len(matched),
        limit=page_size,
        offset=offset,
        page=page,
        page_size=page_size,
        categories=facets,
        sources=[catalog.source_status()],
    )
