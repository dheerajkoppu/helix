"""GET /literature and GET /literature/{pmid}."""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from orphafold.deps import CatalogDep
from orphafold.errors import PROBLEM_RESPONSES
from orphafold.schemas.literature import (
    LiteratureKind,
    LiteratureRecordResponse,
    LiteratureResponse,
    LiteratureSort,
)
from orphafold.services.literature import PAGE_SIZE, LiteratureQuery, get_publication, search_literature

router = APIRouter(prefix="/literature", tags=["literature"], responses=PROBLEM_RESPONSES)


@router.get(
    "",
    response_model=LiteratureResponse,
    summary="Publications for a gene, disease, variant, protein or residue, with the rules that matched",
)
async def list_literature(
    catalog: CatalogDep,
    gene: Annotated[str | None, Query(max_length=40, description="HGNC symbol, e.g. BTK")] = None,
    disease: Annotated[str | None, Query(max_length=160, description="Catalog disease ID")] = None,
    variant: Annotated[
        str | None, Query(max_length=80, description="Variant ID or protein change, e.g. BTK-p.Arg28His")
    ] = None,
    accession: Annotated[str | None, Query(max_length=20, description="UniProt accession")] = None,
    residue: Annotated[
        str | None,
        Query(max_length=12, description="UniProt canonical position, optionally with the residue: 28, R28"),
    ] = None,
    q: Annotated[str | None, Query(max_length=300, description="Free text added to the search")] = None,
    kind: Annotated[LiteratureKind, Query(description="all, review or primary research")] = "all",
    sort: Annotated[LiteratureSort, Query(description="relevance (Europe PMC), cited or date")] = "relevance",
    page: Annotated[int, Query(ge=1, le=41)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = PAGE_SIZE,
) -> LiteratureResponse:
    return await search_literature(
        LiteratureQuery(
            gene=gene,
            disease=disease,
            variant=variant,
            accession=accession,
            residue=residue,
            q=q,
            kind=kind,
            sort=sort,
            page=page,
            page_size=page_size,
        ),
        catalog,
    )


@router.get(
    "/{pmid}",
    response_model=LiteratureRecordResponse,
    summary="One publication by PMID",
)
async def read_publication(
    pmid: Annotated[str, Path(pattern=r"^\d{1,9}$", description="PubMed ID")],
) -> LiteratureRecordResponse:
    return await get_publication(pmid)
