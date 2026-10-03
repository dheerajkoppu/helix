"""Per-gene statistics for the Explore page, each from one source lookup.

A lookup that fails yields None. Zero is recorded only when the source answered
and reported no records.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from urllib.parse import quote

from .fetch import Cached, Fetcher, LookupFailed, utc_now

PDBE_URL = "https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/{accession}"
RCSB_URL = "https://search.rcsb.org/rcsbsearch/v2/query"
ALPHAFOLD_URL = "https://alphafold.ebi.ac.uk/api/prediction/{accession}"
EUTILS_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EINFO_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi"
EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
PATHOGENIC = '("clinsig pathogenic"[Properties] OR "clinsig likely pathogenic"[Properties])'
TOOL = "orphafold-seed-builder"


@dataclass
class GeneStats:
    experimental_structure_count: int | None = None
    has_alphafold_model: bool | None = None
    clinvar_pathogenic_count: int | None = None
    clinvar_total_count: int | None = None
    publication_count: int | None = None
    retrieved_at: str = ""
    provenance: list[dict] = field(default_factory=list)
    responses: dict[str, list[Cached]] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    alphafold_version: int | None = None
    europe_pmc_version: str | None = None

    def record(self, source_id: str, cached: Cached, record_id: str, url: str) -> None:
        self.responses.setdefault(source_id, []).append(cached)
        self.provenance.append({"source_id": source_id, "record_id": record_id, "url": url})


def clinvar_term(symbol: str, pathogenic_only: bool) -> str:
    return f"{symbol}[gene] AND {PATHOGENIC}" if pathogenic_only else f"{symbol}[gene]"


def publication_query(accession: str) -> str:
    return f"UNIPROT_PUBS:{accession}"


def rcsb_query(accession: str) -> dict:
    attribute = "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers"
    return {
        "query": {
            "type": "group",
            "logical_operator": "and",
            "nodes": [
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": f"{attribute}.database_accession",
                        "operator": "exact_match",
                        "value": accession,
                    },
                },
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": f"{attribute}.database_name",
                        "operator": "exact_match",
                        "value": "UniProt",
                    },
                },
            ],
        },
        "return_type": "entry",
        "request_options": {"paginate": {"start": 0, "rows": 0}, "results_content_type": ["experimental"]},
    }


def structure_count(fetcher: Fetcher, accession: str, stats: GeneStats) -> None:
    """Distinct PDB entries mapped to the protein by SIFTS; RCSB Search is asked when PDBe is unreachable."""
    try:
        cached = fetcher.get(
            "pdbe_sifts", f"{accession}.json", PDBE_URL.format(accession=accession), empty_statuses=(404,)
        )
        rows = cached.json().get(accession, []) if cached.status == 200 else []
        stats.experimental_structure_count = len({row["pdb_id"] for row in rows})
        stats.record(
            "pdbe_sifts", cached, accession, f"https://www.ebi.ac.uk/pdbe/pdbe-kb/proteins/{accession}"
        )
        return
    except (LookupFailed, ValueError, KeyError) as error:
        stats.failures.append(f"pdbe_sifts: {error}")
    try:
        cached = fetcher.get(
            "rcsb_search",
            f"{accession}.json",
            RCSB_URL,
            json_body=rcsb_query(accession),
            empty_statuses=(204,),
        )
        stats.experimental_structure_count = cached.json()["total_count"] if cached.status == 200 else 0
        stats.record("rcsb_search", cached, accession, f"https://www.rcsb.org/uniprot/{accession}")
    except (LookupFailed, ValueError, KeyError) as error:
        stats.failures.append(f"rcsb_search: {error}")


def alphafold_model(fetcher: Fetcher, accession: str, stats: GeneStats) -> None:
    try:
        cached = fetcher.get(
            "alphafold_db",
            f"{accession}.json",
            ALPHAFOLD_URL.format(accession=accession),
            empty_statuses=(404,),
        )
        models = cached.json() if cached.status == 200 else []
        canonical = [
            model
            for model in models
            if isinstance(model, dict) and model.get("uniprotAccession") == accession
        ]
        stats.has_alphafold_model = bool(canonical)
        if canonical:
            stats.alphafold_version = canonical[0].get("latestVersion")
        stats.record("alphafold_db", cached, accession, f"https://alphafold.ebi.ac.uk/entry/{accession}")
    except (LookupFailed, ValueError) as error:
        stats.failures.append(f"alphafold_db: {error}")


def clinvar_count(fetcher: Fetcher, symbol: str, pathogenic_only: bool, stats: GeneStats) -> None:
    term = clinvar_term(symbol, pathogenic_only)
    kind = "pathogenic" if pathogenic_only else "total"
    try:
        cached = fetcher.get(
            "clinvar",
            f"{symbol}.{kind}.json",
            EUTILS_URL,
            params={"db": "clinvar", "term": term, "retmode": "json", "retmax": 0, "tool": TOOL},
        )
        result = cached.json()["esearchresult"]
        if "ERROR" in result:
            raise ValueError(result["ERROR"])
        count = int(result["count"])
        if count == 0 and result.get("errorlist", {}).get("phrasesnotfound"):
            raise ValueError("ClinVar did not recognise the gene symbol")
    except (LookupFailed, ValueError, KeyError) as error:
        stats.failures.append(f"clinvar {kind}: {error}")
        return
    if pathogenic_only:
        stats.clinvar_pathogenic_count = count
    else:
        stats.clinvar_total_count = count
    stats.record("clinvar", cached, term, "https://www.ncbi.nlm.nih.gov/clinvar/?term=" + quote(term))


def publication_count(fetcher: Fetcher, accession: str, stats: GeneStats) -> None:
    query = publication_query(accession)
    try:
        cached = fetcher.get(
            "europe_pmc",
            f"{accession}.json",
            EUROPE_PMC_URL,
            params={"query": query, "format": "json", "resultType": "idlist", "pageSize": 1},
        )
        body = cached.json()
        if "errCode" in body:
            raise ValueError(body.get("errMsg", "Europe PMC error"))
        stats.publication_count = int(body["hitCount"])
        stats.europe_pmc_version = body.get("version")
        stats.record("europe_pmc", cached, query, "https://europepmc.org/search?query=" + quote(query))
    except (LookupFailed, ValueError, KeyError) as error:
        stats.failures.append(f"europe_pmc: {error}")


def gene_stats(fetcher: Fetcher, symbol: str, accession: str | None) -> GeneStats:
    stats = GeneStats()
    if accession:
        structure_count(fetcher, accession, stats)
        alphafold_model(fetcher, accession, stats)
        publication_count(fetcher, accession, stats)
    clinvar_count(fetcher, symbol, False, stats)
    clinvar_count(fetcher, symbol, True, stats)
    retrieved = [cached.retrieved_at for responses in stats.responses.values() for cached in responses]
    stats.retrieved_at = max(retrieved) if retrieved else utc_now()
    return stats


def collect(
    fetcher: Fetcher, genes: list[tuple[str, str | None]], workers: int, progress
) -> dict[str, GeneStats]:
    results: dict[str, GeneStats] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(gene_stats, fetcher, symbol, accession): symbol for symbol, accession in genes}
        for done, future in enumerate(as_completed(futures), start=1):
            results[futures[future]] = future.result()
            if done % 25 == 0 or done == len(futures):
                progress(done, len(futures))
    return results


def clinvar_release(fetcher: Fetcher) -> str | None:
    try:
        cached = fetcher.get(
            "clinvar", "einfo.json", EINFO_URL, params={"db": "clinvar", "retmode": "json", "tool": TOOL}
        )
        return cached.json()["einforesult"]["dbinfo"][0]["lastupdate"]
    except LookupFailed, ValueError, KeyError, IndexError:
        return None
