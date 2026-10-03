"""Reactome pathways of a protein."""

from orphafold.evidence import try_build_evidence
from orphafold.knowledge.catalog import Catalog
from orphafold.schemas.common import EntityRef, EntityType, EvidenceObject
from orphafold.schemas.interactions import Pathway, PathwaysResponse
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.base import SourceResult
from orphafold.sources.reactome import reactome


def protein_refs(accession: str, catalog: Catalog) -> tuple[EntityRef, EntityRef | None]:
    gene = catalog.gene_by_uniprot(accession)
    protein = EntityRef.of(
        EntityType.PROTEIN, accession, label=gene.protein_name if gene else None, curie=f"uniprot:{accession}"
    )
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
    return protein, gene_ref


def build_pathways(result: SourceResult, protein: EntityRef) -> list[Pathway]:
    pathways = []
    for row in result.data or [] if result.ok else []:
        url = reactome.record_url(row["id"]) or ""
        evidence = (
            try_build_evidence(
                result.provenance,
                record_type="pathway",
                record_id=row["id"],
                record_version=row["version"],
                url=url,
                subject=protein,
                predicate="participates_in",
                object=EvidenceObject(type="pathway", id=f"reactome:{row['id']}", label=row["name"]),
            )
            if result.provenance
            else None
        )
        pathways.append(
            Pathway(
                id=row["id"],
                version=row["version"],
                name=row["name"],
                in_disease=row["in_disease"],
                inferred=row["inferred"],
                has_diagram=row["has_diagram"],
                doi=row["doi"],
                url=url,
                diagram_url=f"https://reactome.org/PathwayBrowser/#/{row['id']}"
                if row["has_diagram"]
                else None,
                evidence=evidence,
            )
        )
    return pathways


async def protein_pathways(accession: str, catalog: Catalog) -> PathwaysResponse:
    accession = accession.strip().upper()
    gathered = await gather_sources(
        {"pathways": SourceCall(reactome, reactome.pathways(accession), timeout=20)}
    )
    protein, gene = protein_refs(accession, catalog)
    pathways = build_pathways(gathered["pathways"], protein)
    return PathwaysResponse(
        protein=protein,
        gene=gene,
        total=len(pathways),
        disease_pathway_count=sum(1 for pathway in pathways if pathway.in_disease),
        pathways=pathways,
        sources=gathered.sources,
    )
