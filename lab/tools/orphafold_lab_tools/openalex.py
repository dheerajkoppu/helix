"""Literature search over OpenAlex, independent of the Europe PMC search the OrphaFold API offers."""

from typing import Any

from orphafold_lab_tools.context import respond
from orphafold_lab_tools.http import request_json
from orphafold_lab_tools.sources import remember_facts, source

OPENALEX_WORKS = "https://api.openalex.org/works"
FIELDS = "id,doi,title,publication_year,cited_by_count,type,primary_location,abstract_inverted_index,ids"


def _abstract(inverted_index: dict[str, list[int]] | None, limit: int) -> str:
    if not inverted_index:
        return ""
    positions = sorted((position, word) for word, places in inverted_index.items() for position in places)
    text = " ".join(word for _, word in positions)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _search_openalex(query: str, limit: int) -> dict[str, Any]:
    limit = max(1, min(int(limit), 8))
    payload = request_json(
        "GET",
        OPENALEX_WORKS,
        params={
            "search": query,
            "per-page": limit,
            "select": FIELDS,
            "mailto": "orphafold@users.noreply.github.com",
        },
        timeout=45,
    )
    works = []
    for item in payload.get("results", []):
        identifier = (item.get("id") or "").rsplit("/", 1)[-1]
        if not identifier:
            continue
        venue = ((item.get("primary_location") or {}).get("source") or {}).get("display_name")
        pmid = ((item.get("ids") or {}).get("pmid") or "").rsplit("/", 1)[-1] or None
        works.append(
            {
                "openalex_id": identifier,
                "title": item.get("title"),
                "year": item.get("publication_year"),
                "venue": venue,
                "cited_by": item.get("cited_by_count"),
                "type": item.get("type"),
                "doi": item.get("doi"),
                "pmid": pmid,
                "abstract": _abstract(item.get("abstract_inverted_index"), 420),
                "source": source("openalex", identifier, item.get("id")),
            }
        )
    return remember_facts(
        {
            "database": "OpenAlex",
            "query": query,
            "total": (payload.get("meta") or {}).get("count"),
            "works": works,
            "sources": [row["source"] for row in works],
            "how_to_cite": "Record evidence with evidence_class literature, database OpenAlex and record_id the openalex_id.",
        },
        "search_openalex",
    )


def search_openalex(query: str, limit: int = 6) -> str:
    """Search OpenAlex for scholarly works, with citation counts and abstracts.

    Args:
        query: Free text, for example "Bruton tyrosine kinase PH domain R28 inositol phosphate binding".
        limit: Number of works to return, 1 to 8.
    """
    return respond(_search_openalex, query, limit)
