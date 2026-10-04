"""Structure similarity routes.

This module sorts before `structures`, so `/structures/similar` is registered before
`/structures/{structure_id}` and is matched as a literal path rather than as a structure ID.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from helix.errors import PROBLEM_RESPONSES
from helix.schemas.structure_similarity import PocketSimilarity, SimilarStructures
from helix.services.structure_similarity import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    pocket_similarity,
    similar_structures,
)

router = APIRouter(prefix="/structures", tags=["structure similarity"], responses=PROBLEM_RESPONSES)

AccessionQuery = Annotated[str, Query(description="UniProt accession of the protein, e.g. O00329")]


@router.get(
    "/similar",
    response_model=SimilarStructures,
    summary="Proteins with a similar fold (Foldseek against the PDB and AlphaFold DB)",
)
async def get_similar_structures(
    accession: AccessionQuery,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="How many hits to return")] = DEFAULT_LIMIT,
) -> SimilarStructures:
    """Fold neighbours of a protein, each row carrying every measure Foldseek reported, by name.

    Answers immediately. A protein whose search is still running comes back with status `pending`
    and `retry_after_seconds`; the flagship proteins and the control subjects are served from a
    stored copy, flagged with `from_cached_example`.
    """
    return await similar_structures(accession, limit)


@router.get(
    "/{structure_id}/pocket-similarity",
    response_model=PocketSimilarity,
    summary="Compare the pockets of this structure with those of a structurally similar protein",
)
async def get_pocket_similarity(
    structure_id: str,
    accession: Annotated[
        str, Query(description="UniProt accession of the similar protein to compare against")
    ],
) -> PocketSimilarity:
    """Residue-by-residue pocket comparison between a subject structure and one similar protein.

    Subject positions are mapped onto the similar protein through the Foldseek alignment of the two
    models, and compared against the pockets P2Rank predicts on the similar protein and the
    molecules RCSB PDB records as bound in an experimental entry of it.
    """
    return await pocket_similarity(structure_id, accession)
