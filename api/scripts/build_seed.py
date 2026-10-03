"""Build the seeded IEI dataset that the Helix API loads at startup.

    api/.venv/bin/python api/scripts/build_seed.py

Imports the IUIS 2024 classification, maps every entry to MONDO, Orphanet and OMIM
identifiers, adds openly licensed definitions and phenotypes, resolves genes and
proteins, collects per-gene statistics and writes data/seed/catalog.json,
data/seed/SOURCES.json, data/seed/build_report.json and ATTRIBUTION.md.

The build resumes: every download and API response is cached under data/.cache
and reused on the next run. Pass --refresh <source_id> (or "all") to fetch again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed import stats as gene_statistics  # noqa: E402
from seed.assemble import Annotator, DiseaseUnit, categories  # noqa: E402
from seed.clingen import load_clingen  # noqa: E402
from seed.fetch import Cached, Fetcher, LookupFailed, utc_now  # noqa: E402
from seed.flagship import build_flagship  # noqa: E402
from seed.gencc import load_gencc  # noqa: E402
from seed.hgnc import Hgnc, load_hgnc, split_multi  # noqa: E402
from seed.hpo import load_hpoa  # noqa: E402
from seed.iuis import Article, Entry, parse_jats  # noqa: E402
from seed.mapping import Mapper, Unit, load_cross_references, sssom_version  # noqa: E402
from seed.obo import load_obo  # noqa: E402
from seed.orphadata import load_orphadata  # noqa: E402
from seed.proteins import Protein, fetch_proteins  # noqa: E402
from seed.slugs import SlugInput, assign_slugs  # noqa: E402
from seed.sources import BULK_SOURCES, IUIS_FALLBACK_URL, RUNTIME_NOTICES, SOURCE_BY_ID, SOURCES  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[2]
DATASET = "iuis_2024"
EXPECTED_ROWS = {1: 73, 2: 87, 3: 57, 4: 73, 5: 45, 6: 90, 7: 78, 8: 36, 9: 47, 10: 17}
EXPECTED_GERMLINE_GENES = 508
EXPECTED_GERMLINE_PROTEINS = 503
HOMEPAGE_EXAMPLES = ("ADA", "IL2RG", "BTK", "WAS", "RAG1")
STAT_FIELDS = (
    "experimental_structure_count",
    "has_alphafold_model",
    "clinvar_pathogenic_count",
    "clinvar_total_count",
    "publication_count",
)
HGNC_URL = "https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/{hgnc_id}"
UNIPROT_URL = "https://www.uniprot.org/uniprotkb/{accession}/entry"
STARTED = time.monotonic()


class BuildError(SystemExit):
    def __init__(self, message: str):
        super().__init__(f"\nbuild_seed: {message}")


def say(step: str, message: str) -> None:
    print(f"[{time.monotonic() - STARTED:6.1f}s] {step:<10} {message}", flush=True)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--cache-dir", type=Path, default=REPOSITORY / "data" / ".cache")
    parser.add_argument("--output-dir", type=Path, default=REPOSITORY / "data" / "seed")
    parser.add_argument("--attribution", type=Path, default=REPOSITORY / "ATTRIBUTION.md")
    parser.add_argument(
        "--offline", action="store_true", help="use cached responses only; uncached lookups become null"
    )
    parser.add_argument(
        "--refresh",
        action="append",
        default=[],
        metavar="SOURCE_ID",
        help='fetch this source again instead of using its cache (repeatable; "all" for every source)',
    )
    parser.add_argument(
        "--workers", type=int, default=6, help="concurrent per-gene lookups (rate limits still apply)"
    )
    parser.add_argument(
        "--accept-count-change",
        action="store_true",
        help="continue when the IUIS row or gene counts differ from the documented ones",
    )
    return parser.parse_args()


def acquire(fetcher: Fetcher) -> dict[str, Cached]:
    """Download every bulk source, falling back to its cached copy when a refresh fails."""
    files: dict[str, Cached] = {}
    for source in BULK_SOURCES:
        try:
            files[source.id] = fetcher.get(source.id, source.file_name, source.url, timeout=600)
        except LookupFailed as error:
            cached = fetcher.read_cached(source.id, source.file_name)
            if source.id == "iuis_2024" and cached is None:
                say("sources", f"Europe PMC unavailable ({error}); trying the NCBI mirror")
                try:
                    cached = fetcher.get(source.id, source.file_name, IUIS_FALLBACK_URL, timeout=600)
                except LookupFailed as second:
                    raise BuildError(f"IUIS article XML unavailable from both mirrors: {second}") from second
            if cached is None:
                raise BuildError(f"required source {source.id} could not be downloaded: {error}") from error
            say("sources", f"{source.id}: download failed, using the copy cached {cached.retrieved_at}")
            files[source.id] = cached
        cached = files[source.id]
        origin = "cache" if cached.from_cache else "fetched"
        say("sources", f"{source.id:<24} {cached.size:>11,d} bytes  sha256 {cached.sha256[:12]}  ({origin})")
    return files


def assert_documented_counts(entries: list[Entry], hgnc: Hgnc, accept: bool) -> dict:
    rows = dict(sorted(Counter(entry.table for entry in entries).items()))
    germline = sorted({symbol for entry in entries if entry.table != 10 for symbol in entry.symbols})
    proteins = [symbol for symbol in germline if split_multi(hgnc.approved[symbol]["uniprot_ids"])]
    problems = []
    if rows != EXPECTED_ROWS:
        problems.append(f"rows per table {rows}, documented {EXPECTED_ROWS}")
    if len(germline) != EXPECTED_GERMLINE_GENES:
        problems.append(f"{len(germline)} genes in Tables 1 to 9, documented {EXPECTED_GERMLINE_GENES}")
    if len(proteins) != EXPECTED_GERMLINE_PROTEINS:
        problems.append(
            f"{len(proteins)} of them with a UniProt accession, documented {EXPECTED_GERMLINE_PROTEINS}"
        )
    if problems and not accept:
        raise BuildError(
            "the IUIS import no longer matches the documented counts, so the upstream source changed and "
            "needs review "
            "(rerun with --accept-count-change after reviewing):\n  " + "\n  ".join(problems)
        )
    for problem in problems:
        say("iuis", f"WARNING accepted count change: {problem}")
    return {
        "rows_per_table": rows,
        "germline_genes": len(germline),
        "germline_genes_with_uniprot": len(proteins),
    }


def citation(article: Article) -> str:
    def initials(given: str) -> str:
        return "".join(part[0] for part in re.split(r"[\s.-]+", given) if part)

    authors = ", ".join(f"{surname} {initials(given)}" for surname, given in article.authors[:3])
    if len(article.authors) > 3:
        authors += ", et al"
    return (
        f"{authors}. {article.title}. {article.journal_abbreviation}. {article.year};"
        f"{article.volume}({article.issue}):{article.elocation_id}. doi:{article.doi}"
    )


def chromosome(location: str) -> str | None:
    if location.lower().startswith("mito"):
        return "MT"
    match = re.match(r"^(\d{1,2}|X|Y)(?=[pq]|cen|$|\s)", location)
    return match.group(1) if match else None


def header_date(cached: Cached) -> str | None:
    value = cached.headers.get("last-modified")
    return parsedate_to_datetime(value).date().isoformat() if value else None


def orphadata_release(path: Path) -> str:
    with open(path, encoding="utf-8") as handle:
        match = re.search(r'date="(\d{4}-\d{2}-\d{2})', handle.read(600))
    return match.group(1) if match else ""


def response_set_digest(responses: list[Cached]) -> str:
    lines = sorted({f"{cached.path.name} {cached.sha256}" for cached in responses})
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def write_json(path: Path, document: dict) -> None:
    """Write through a .part file so the API never reads a half-written catalog."""
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(document, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(partial, path)


def build_genes(
    hgnc: Hgnc,
    symbols: list[str],
    proteins: dict[str, Protein],
    disease_ids: dict[str, list[str]],
    statistics: dict,
) -> list[dict]:
    genes = []
    for symbol in symbols:
        row = hgnc.approved[symbol]
        accessions = split_multi(row["uniprot_ids"])
        if len(accessions) > 1:
            raise BuildError(f"HGNC lists several UniProt accessions for {symbol}: {accessions}")
        accession = accessions[0] if accessions else None
        protein = proteins.get(accession) if accession else None
        stats = statistics[symbol]
        provenance = [
            {"source_id": "hgnc", "record_id": row["hgnc_id"], "url": HGNC_URL.format(hgnc_id=row["hgnc_id"])}
        ]
        if protein is not None:
            provenance.append(
                {
                    "source_id": "uniprot",
                    "record_id": accession,
                    "url": UNIPROT_URL.format(accession=accession),
                }
            )
        genes.append(
            {
                "symbol": symbol,
                "hgnc_id": row["hgnc_id"],
                "name": row["name"],
                "locus_type": row["locus_type"],
                "chromosome": chromosome(row["location"]),
                "ensembl_gene_id": row["ensembl_gene_id"] or None,
                "ncbi_gene_id": row["entrez_id"] or None,
                "uniprot_accession": accession,
                "protein_name": protein.name if protein else None,
                "protein_length": protein.length if protein else None,
                "protein_family": protein.family if protein else None,
                "disease_ids": disease_ids[symbol],
                "stats": {name: getattr(stats, name) for name in STAT_FIELDS}
                | {"retrieved_at": stats.retrieved_at},
                "provenance": provenance + stats.provenance,
            }
        )
    return genes


def source_records(
    files: dict[str, Cached], responses: dict[str, list[Cached]], releases: dict[str, str | None]
) -> list[dict]:
    records = []
    for source in SOURCES:
        if source.id in files:
            cached = files[source.id]
            retrieved_at, digest, scope, size, count = (
                cached.retrieved_at,
                cached.sha256,
                "file",
                cached.size,
                1,
            )
            url = cached.url
        elif responses.get(source.id):
            used = responses[source.id]
            retrieved_at = max(cached.retrieved_at for cached in used)
            digest, scope = response_set_digest(used), "response_set"
            size, count, url = sum(cached.size for cached in used), len(used), source.url
        else:
            continue
        release = releases.get(source.id) or f"rolling (retrieved {retrieved_at[:10]})"
        records.append(
            {
                "id": source.id,
                "name": source.name,
                "url": url,
                "release": release,
                "license": source.license,
                "license_url": source.license_url,
                "citation": source.citation.format(release=release, retrieved=retrieved_at[:10]),
                "used_for": source.used_for,
                "retrieved_at": retrieved_at,
                "sha256": digest,
                "checksum_scope": scope,
                "bytes": size,
                "responses": count,
            }
        )
    return records


def attribution(records: list[dict], article: Article, generated_at: str) -> str:
    lines = [
        "# Attribution",
        "",
        "Helix is licensed under Apache-2.0. Third-party data is not covered by that licence: every",
        "source below keeps its own terms. Helix is a research and hypothesis-generation tool and is",
        "not clinical decision software.",
        "",
        f"This file is generated by `api/scripts/build_seed.py` (last build {generated_at[:10]}).",
        "The machine-readable version with checksums is `data/seed/SOURCES.json`.",
        "",
        "## Sources in the seeded dataset (`data/seed/catalog.json`)",
        "",
        "| Source | Used for | Licence | Release | Retrieved |",
        "| --- | --- | --- | --- | --- |",
    ]
    for record in records:
        lines.append(
            f"| [{record['name']}]({record['url'].split('{')[0]}) | {record['used_for']} | "
            f"[{record['license']}]({record['license_url']}) | {record['release']} | "
            f"{record['retrieved_at'][:10]} |"
        )
    lines += ["", "## Required citations and notices", ""]
    for record in records:
        lines += [f"**{record['name']}**", "", record["citation"], ""]
    lines += [
        "## IUIS classification: what is and is not stored",
        "",
        f"The IUIS 2024 update ({article.journal}, doi:{article.doi}) is published under CC BY-ND 4.0,",
        "which does not allow sharing adapted material. Helix therefore stores only identifiers, codes",
        "and short labels taken from it: table and subtable, disease label, gene, inheritance code and OMIM",
        "number. The clinical free-text columns of the published tables are never extracted, stored or",
        "displayed.",
        "Descriptions, synonyms and phenotypes come from Orphadata, Mondo and HPO. The article XML is",
        "downloaded at build time into `data/.cache`, which is not committed. Whether CC BY-ND permits",
        "publishing this derived index is a legal judgement that the maintainers still need to confirm with",
        "the IUIS committee or the publisher.",
        "",
        "## Changes made to source data",
        "",
        "- Every source is subset to the entries of the IUIS classification and reformatted as JSON.",
        "- HPO terms and annotations are reproduced with their identifiers and labels unchanged.",
        "  Annotations marked as excluded or absent are left out of the phenotype lists.",
        "- Orphanet and Mondo definitions are reproduced verbatim with a link to the source record.",
        "- Mondo synonyms whose only stated provenance is OMIM are not used.",
        "- No cross-source composite score is computed.",
        "",
        "## Sources queried by the application at run time",
        "",
        "The application reads the sources above live and may also query:",
        "",
    ]
    for name, notice in RUNTIME_NOTICES:
        lines.append(f"- **{name}**: {notice}")
    return "\n".join(lines) + "\n"


def validate(catalog: dict) -> dict:
    """Checks the written catalog must pass; returns the null distribution of the gene statistics."""
    diseases, genes = catalog["diseases"], catalog["genes"]
    slugs = [disease["id"] for disease in diseases]
    problems = []
    if len(set(slugs)) != len(slugs):
        problems.append("disease slugs are not unique")
    if any(not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) for slug in slugs):
        problems.append("a disease slug is not kebab-case")
    counts = catalog["manifest"]["counts"]
    actual = {
        "diseases": len(diseases),
        "genes": len(genes),
        "genes_with_uniprot": sum(bool(gene["uniprot_accession"]) for gene in genes),
        "categories": len(catalog["categories"]),
    }
    for name, value in actual.items():
        if counts[name] != value:
            problems.append(f"manifest count {name}={counts[name]} but the catalog has {value}")
    symbols = {gene["symbol"] for gene in genes}
    slug_set = set(slugs)
    source_ids = {source["id"] for source in catalog["manifest"]["sources"]}
    category_ids = {category["id"] for category in catalog["categories"]}
    subcategory_ids = {item["id"] for category in catalog["categories"] for item in category["subcategories"]}
    for disease in diseases:
        if disease["gene_symbol"] is not None and disease["gene_symbol"] not in symbols:
            problems.append(f"{disease['id']}: gene {disease['gene_symbol']} is not in genes")
        if disease["category_id"] not in category_ids:
            problems.append(f"{disease['id']}: unknown category")
        if disease["subcategory_id"] is not None and disease["subcategory_id"] not in subcategory_ids:
            problems.append(f"{disease['id']}: unknown subcategory")
        used = {record["source_id"] for record in disease["provenance"]}
        used |= {row["source_id"] for row in disease["phenotypes"]}
        if disease["definition"]:
            used.add(disease["definition"]["source_id"])
        if used - source_ids:
            problems.append(
                f"{disease['id']}: source ids missing from the manifest: {sorted(used - source_ids)}"
            )
    for gene in genes:
        if set(gene["disease_ids"]) - slug_set:
            problems.append(f"{gene['symbol']}: unknown disease ids")
        if {record["source_id"] for record in gene["provenance"]} - source_ids:
            problems.append(f"{gene['symbol']}: source ids missing from the manifest")
    for symbol in HOMEPAGE_EXAMPLES:
        gene = next((gene for gene in genes if gene["symbol"] == symbol), None)
        if gene is None or not gene["uniprot_accession"]:
            problems.append(f"homepage example {symbol} is missing or has no UniProt accession")
    for item in catalog["flagship"]:
        if item["gene_symbol"] not in symbols:
            problems.append(f"flagship gene {item['gene_symbol']} is not in genes")
    if problems:
        raise BuildError("the catalog failed validation:\n  " + "\n  ".join(problems[:40]))
    return {
        name: {
            "null": sum(gene["stats"][name] is None for gene in genes),
            "null_with_protein": sum(
                gene["stats"][name] is None and bool(gene["uniprot_accession"]) for gene in genes
            ),
        }
        for name in STAT_FIELDS
    }


def main() -> None:
    arguments = parse_arguments()
    refresh = (
        frozenset(source.id for source in SOURCES)
        if "all" in arguments.refresh
        else frozenset(arguments.refresh)
    )
    unknown = refresh - set(SOURCE_BY_ID)
    if unknown:
        raise BuildError(f"unknown source id for --refresh: {sorted(unknown)}; known: {sorted(SOURCE_BY_ID)}")
    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher(arguments.cache_dir, offline=arguments.offline, refresh=refresh)
    generated_at = utc_now()

    say("sources", f"cache {arguments.cache_dir}")
    files = acquire(fetcher)
    previous = arguments.output_dir / "SOURCES.json"
    if previous.exists():
        known = {
            item["id"]: item["sha256"] for item in json.loads(previous.read_text(encoding="utf-8"))["sources"]
        }
        if known.get("iuis_2024") not in (None, files["iuis_2024"].sha256):
            say("sources", "WARNING the IUIS article XML changed since the previous build; review the import")

    say("iuis", "parsing HGNC and the IUIS tables")
    hgnc = load_hgnc(files["hgnc"].path)
    article, tables, entries = parse_jats(files["iuis_2024"].path, hgnc)
    documented = assert_documented_counts(entries, hgnc, arguments.accept_count_change)
    say(
        "iuis",
        f"{len(entries)} rows, {documented['germline_genes']} genes in Tables 1 to 9 "
        f"({documented['germline_genes_with_uniprot']} with UniProt); documented counts hold",
    )

    say("mapping", "loading Mondo, HPO, GenCC, ClinGen and Orphadata")
    mondo = load_obo(files["mondo"].path)
    hpo = load_obo(files["hpo_ontology"].path)
    hpoa = load_hpoa(files["hpo_annotations"].path)
    gencc = load_gencc(files["gencc"].path)
    clingen = load_clingen(files["clingen"].path)
    orphadata = load_orphadata(
        files["orphadata_product1"].path,
        files["orphadata_product4"].path,
        files["orphadata_product6"].path,
        files["orphadata_product9_ages"].path,
    )
    cross = load_cross_references(files["mondo_sssom_omim"].path, files["mondo_sssom_orphanet"].path)

    units: list[DiseaseUnit] = []
    for entry in entries:
        for symbol in entry.symbols or [None]:
            hgnc_id = hgnc.approved[symbol]["hgnc_id"] if symbol else None
            units.append(DiseaseUnit(key=len(units), entry=entry, symbol=symbol, hgnc_id=hgnc_id))
    mapper = Mapper(hgnc, mondo, cross, gencc, clingen, orphadata, hpo, hpoa)
    mapped = mapper.map_units(
        [
            Unit(
                key=unit.key,
                label=unit.entry.disease_label,
                hgnc_id=unit.hgnc_id,
                symbol=unit.symbol,
                inheritance_codes=unit.entry.inheritance_codes,
                mechanism=unit.entry.mechanism,
                mim_numbers=unit.entry.mim_numbers,
                is_phenocopy=unit.entry.table == 10,
            )
            for unit in units
        ]
    )
    routes = Counter(result.route for result in mapped.values())
    say(
        "mapping",
        f"{len(units)} diseases: " + ", ".join(f"{route} {count}" for route, count in sorted(routes.items())),
    )

    slugs = assign_slugs(
        [
            SlugInput(
                key=unit.key,
                label=unit.entry.disease_label,
                symbol=unit.symbol,
                inheritance_codes=tuple(unit.entry.inheritance_codes),
                mechanism=tuple(unit.entry.mechanism),
                table=unit.entry.table,
                is_phenocopy=unit.entry.table == 10,
            )
            for unit in units
        ]
    )
    annotator = Annotator(mondo, hpo, hpoa, orphadata, cross)
    diseases = [annotator.disease(unit, slugs[unit.key], mapped[unit.key]) for unit in units]
    say(
        "diseases",
        f"{sum(bool(d['definition']) for d in diseases)} with a definition, "
        f"{sum(bool(d['phenotypes']) for d in diseases)} with phenotypes, "
        f"{sum(bool(d['aliases']) for d in diseases)} with aliases",
    )

    symbols = sorted({unit.symbol for unit in units if unit.symbol})
    disease_ids: dict[str, list[str]] = defaultdict(list)
    for unit in units:
        if unit.symbol:
            disease_ids[unit.symbol].append(slugs[unit.key])
    accession_by_symbol = {
        symbol: (split_multi(hgnc.approved[symbol]["uniprot_ids"]) or [None])[0] for symbol in symbols
    }
    accessions = [accession for accession in accession_by_symbol.values() if accession]
    say(
        "genes",
        f"{len(symbols)} genes, {len(accessions)} with a UniProt accession; fetching UniProtKB entries",
    )
    proteins, uniprot_responses, protein_failures = fetch_proteins(fetcher, accessions)
    for failure in protein_failures:
        say("genes", f"WARNING UniProt lookup failed: {failure}")
    say("genes", f"{len(proteins)} UniProtKB entries resolved")

    say("stats", "structures (PDBe SIFTS), AlphaFold DB, ClinVar and Europe PMC for every gene")
    statistics = gene_statistics.collect(
        fetcher,
        [(symbol, accession_by_symbol[symbol]) for symbol in symbols],
        arguments.workers,
        lambda done, total: say(
            "stats",
            f"{done}/{total} genes ({fetcher.network_requests} requests, {fetcher.cache_hits} cached)",
        ),
    )
    clinvar_release = gene_statistics.clinvar_release(fetcher)

    say("flagship", "checking the flagship variants against ClinVar and UniProt")
    flagship, flagship_responses, flagship_notes = build_flagship(fetcher, accession_by_symbol, proteins)
    for note in flagship_notes:
        say("flagship", f"note: {note}")

    responses: dict[str, list[Cached]] = defaultdict(list)
    responses["uniprot"] += uniprot_responses
    responses["clinvar"] += flagship_responses
    for stats in statistics.values():
        for source_id, used in stats.responses.items():
            responses[source_id] += used
    alphafold_versions = {stats.alphafold_version for stats in statistics.values() if stats.alphafold_version}
    europe_pmc_versions = {
        stats.europe_pmc_version for stats in statistics.values() if stats.europe_pmc_version
    }
    uniprot_releases = {cached.headers.get("x-uniprot-release") for cached in uniprot_responses} - {None}
    releases = {
        "iuis_2024": article.published,
        "hgnc": header_date(files["hgnc"]),
        "gencc": gencc.release,
        "clingen": clingen.release,
        "mondo": mondo.version.rsplit("/", 1)[-1],
        "mondo_sssom_omim": sssom_version(files["mondo_sssom_omim"].path),
        "mondo_sssom_orphanet": sssom_version(files["mondo_sssom_orphanet"].path),
        "hpo_ontology": hpo.version.rsplit("/", 1)[-1],
        "hpo_annotations": hpoa.version,
        "uniprot": ", ".join(sorted(uniprot_releases)) or None,
        "alphafold_db": ", ".join(f"v{version}" for version in sorted(alphafold_versions)) or None,
        "clinvar": clinvar_release,
        "europe_pmc": ", ".join(f"API {version}" for version in sorted(europe_pmc_versions)) or None,
    }
    for source_id in (
        "orphadata_product1",
        "orphadata_product4",
        "orphadata_product6",
        "orphadata_product9_ages",
    ):
        releases[source_id] = orphadata_release(files[source_id].path)
    records = source_records(files, responses, releases)

    genes = build_genes(hgnc, symbols, proteins, disease_ids, statistics)
    catalog = {
        "manifest": {
            "generated_at": generated_at,
            "dataset": DATASET,
            "citation": citation(article),
            "doi": article.doi,
            "counts": {
                "entries": len(entries),
                "diseases": len(diseases),
                "genes": len(genes),
                "genes_with_uniprot": sum(bool(gene["uniprot_accession"]) for gene in genes),
                "categories": len(tables),
            },
            "sources": [
                {
                    key: record[key]
                    for key in ("id", "name", "url", "release", "license", "retrieved_at", "sha256")
                }
                for record in records
            ],
        },
        "categories": categories(tables),
        "diseases": diseases,
        "genes": genes,
        "flagship": flagship,
    }
    null_statistics = validate(catalog)

    phenocopy_only = sorted(set(symbols) - {s for e in entries if e.table != 10 for s in e.symbols})
    unmapped = [d["id"] for d in diseases if not any(d["xrefs"].values())]
    report = {
        "generated_at": generated_at,
        "counts": catalog["manifest"]["counts"]
        | {
            "phenocopies": sum(d["is_phenocopy"] for d in diseases),
            "diseases_without_gene": sum(d["gene_symbol"] is None for d in diseases),
            "genes_in_tables_1_to_9": documented["germline_genes"],
            "genes_in_tables_1_to_9_with_uniprot": documented["germline_genes_with_uniprot"],
            "genes_only_in_table_10": phenocopy_only,
            "rows_per_table": documented["rows_per_table"],
        },
        "mapping": {
            "routes": dict(sorted(routes.items())),
            "with_mondo": sum(bool(d["xrefs"]["mondo"]) for d in diseases),
            "with_orphanet": sum(bool(d["xrefs"]["orphanet"]) for d in diseases),
            "with_omim": sum(bool(d["xrefs"]["omim"]) for d in diseases),
            "with_definition": sum(bool(d["definition"]) for d in diseases),
            "with_phenotypes": sum(bool(d["phenotypes"]) for d in diseases),
            "with_aliases": sum(bool(d["aliases"]) for d in diseases),
            "unmapped": unmapped,
            "notes": {slugs[unit.key]: mapped[unit.key].notes for unit in units if mapped[unit.key].notes},
        },
        "gene_statistics": {
            "null_counts": null_statistics,
            "lookup_failures": {
                symbol: stats.failures for symbol, stats in sorted(statistics.items()) if stats.failures
            },
            "definitions": {
                "experimental_structure_count": "distinct PDB entries in PDBe SIFTS for the accession",
                "has_alphafold_model": "AlphaFold DB has a model for the canonical UniProt accession",
                "clinvar_total_count": "ClinVar records for SYMBOL[gene], multi-gene variants included",
                "clinvar_pathogenic_count": "the same query restricted to pathogenic or likely pathogenic",
                "publication_count": "Europe PMC records for UNIPROT_PUBS:<accession>",
                "null": "no protein to query (non-coding gene) or the lookup failed; never means zero",
            },
        },
        "protein_failures": protein_failures,
        "flagship_notes": flagship_notes,
    }

    write_json(arguments.output_dir / "catalog.json", catalog)
    write_json(
        arguments.output_dir / "SOURCES.json",
        {"generated_at": generated_at, "dataset": DATASET, "sources": records},
    )
    write_json(arguments.output_dir / "build_report.json", report)
    arguments.attribution.write_text(attribution(records, article, generated_at), encoding="utf-8")
    fetcher.close()

    counts = catalog["manifest"]["counts"]
    catalog_path = arguments.output_dir / "catalog.json"
    say("done", f"{catalog_path} ({catalog_path.stat().st_size:,d} bytes)")
    say("done", "counts " + ", ".join(f"{name} {value}" for name, value in counts.items()))
    say("done", f"{len(unmapped)} diseases without any cross-reference; details in build_report.json")
    for name, value in null_statistics.items():
        say("done", f"null {name}: {value['null']} ({value['null_with_protein']} for genes with a protein)")
    say("done", f"{fetcher.network_requests} network requests, {fetcher.cache_hits} cache hits")


if __name__ == "__main__":
    main()
