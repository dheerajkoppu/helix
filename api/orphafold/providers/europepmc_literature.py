"""Literature provider backed by Europe PMC. Retrieval only: nothing is generated or summarised."""

from orphafold.knowledge.catalog import get_catalog
from orphafold.providers.base import (
    Availability,
    Capability,
    ExecutionMode,
    LiteratureProvider,
    LiteratureRequest,
    LiteratureResult,
    Publication,
    RunContext,
    register_provider,
)
from orphafold.schemas.common import EntityType
from orphafold.services.literature import LiteratureQuery, search_literature
from orphafold.sources.europepmc import europepmc


@register_provider
class EuropePmcLiteratureProvider(LiteratureProvider):
    id = "europepmc_literature"
    name = "Europe PMC literature search"
    license = europepmc.license
    license_url = europepmc.license_url
    commercial_use = True
    capabilities = (Capability.LITERATURE_SEARCH,)
    execution_mode = ExecutionMode.RETRIEVAL
    limitations = (
        "Covers records Europe PMC indexes from PubMed (SRC:MED); preprints and books are left out.",
        "Relevance is a list of fixed rules (text match in title or abstract, UniProt citation list, "
        "publication type, citation count), each reported separately. No language model reads the papers.",
        "A variant or residue is matched in the notations R28H and Arg28His only.",
    )
    attribution = europepmc.attribution
    homepage = europepmc.homepage

    async def check_availability(self) -> Availability:
        return Availability(available=True, reason="Keyless public API; no local model is run.")

    async def search(self, request: LiteratureRequest, context: RunContext) -> LiteratureResult:
        limit = min(max(request.limit, 1), 100)
        query = LiteratureQuery(
            q=" ".join(part for part in [request.query, *request.terms] if part) or None,
            page=request.offset // limit + 1,
            page_size=limit,
        )
        entity = request.entity
        if entity is not None:
            if entity.type is EntityType.GENE:
                query.gene = entity.id
            elif entity.type is EntityType.PROTEIN:
                query.accession = entity.id
            elif entity.type is EntityType.DISEASE:
                query.disease = entity.id
            elif entity.type is EntityType.VARIANT:
                query.variant = entity.id
        response = await search_literature(query, get_catalog())
        return LiteratureResult(
            publications=[
                Publication(
                    pmid=item.pmid,
                    pmcid=item.pmcid,
                    doi=item.doi,
                    title=item.title,
                    journal=item.journal,
                    year=item.year,
                    authors=item.authors,
                    abstract=item.abstract,
                    url=item.url,
                    is_open_access=item.is_open_access,
                    relevance={reason.code: reason.detail or True for reason in item.relevance},
                )
                for item in response.items
            ],
            total=response.total,
            sources=response.sources,
        )
