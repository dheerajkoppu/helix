"""Literature search over Europe PMC.

The relevance indicator is a list of fixed rules (string matches in title and abstract, membership
of the UniProt entry's citation list, publication type, citation count). No language model and no
combined score: each rule that fired is reported with the text or count behind it.
"""

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

from helix.errors import BadRequest, NotFound
from helix.evidence import try_build_evidence
from helix.identifiers import (
    AMINO_ACID_1_TO_3,
    AMINO_ACID_3_TO_1,
    is_uniprot_accession,
    parse_protein_change,
    parse_variant_id,
)
from helix.knowledge.catalog import Catalog
from helix.schemas.common import Citation, EntityRef, EntityType, Provenance, SourceStatus
from helix.schemas.literature import (
    LiteratureContext,
    LiteratureKind,
    LiteraturePublication,
    LiteratureRecordResponse,
    LiteratureResponse,
    LiteratureSort,
    RelevanceReason,
)
from helix.sources.base import SourceResult
from helix.sources.europepmc import MAX_PAGE_SIZE, MAX_QUERY_LENGTH, europepmc
from helix.sources.uniprot import uniprot

PAGE_SIZE = 25
HIGHLY_CITED_THRESHOLD = 100
SORTS = {"relevance": None, "cited": "CITED desc", "date": "P_PBDATE_D desc"}
REVIEW_TYPES = {"review", "review-article", "systematic review", "meta-analysis"}
_RESIDUE_RE = re.compile(r"^(?:p\.)?([A-Za-z]{1,3})?(\d{1,5})$")
_BOUNDARY_START = r"(?<![A-Za-z0-9])"


@dataclass(slots=True)
class LiteratureQuery:
    gene: str | None = None
    disease: str | None = None
    variant: str | None = None
    accession: str | None = None
    residue: str | None = None
    q: str | None = None
    kind: LiteratureKind = "all"
    sort: LiteratureSort = "relevance"
    page: int = 1
    page_size: int = PAGE_SIZE


@dataclass(slots=True)
class _Resolved:
    context: LiteratureContext
    clauses: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    sources: list[SourceStatus] = field(default_factory=list)
    variant_pattern: re.Pattern[str] | None = None
    residue_pattern: re.Pattern[str] | None = None
    disease_names: list[str] = field(default_factory=list)
    variant_label: str | None = None
    residue_label: str | None = None


def _quoted(text: str) -> str:
    return '"' + text.replace('"', " ").strip() + '"'


def _any_of(terms: list[str]) -> str:
    return "(" + " OR ".join(_quoted(term) for term in terms) + ")"


def _sequence(fasta: str) -> str:
    return "".join(line.strip() for line in fasta.splitlines() if not line.startswith(">"))


async def _resolve(query: LiteratureQuery, catalog: Catalog) -> _Resolved:
    gene = query.gene.strip().upper() if query.gene else None
    accession = query.accession.strip().upper() if query.accession else None
    if accession and not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.")

    substitution = None
    variant_text = query.variant.strip() if query.variant else None
    if variant_text:
        substitution = parse_variant_id(variant_text) or parse_protein_change(variant_text, gene)
        if substitution and substitution.gene_symbol and not gene:
            gene = substitution.gene_symbol

    if catalog.ready:
        if gene and not accession:
            seed = catalog.gene(gene)
            accession = seed.uniprot_accession if seed else None
        elif accession and not gene:
            seed = catalog.gene_by_uniprot(accession)
            gene = seed.symbol if seed else None

    resolved = _Resolved(
        context=LiteratureContext(
            gene=gene,
            disease=query.disease,
            variant=variant_text,
            accession=accession,
            residue=query.residue,
            q=query.q.strip() if query.q else None,
            kind=query.kind,
            sort=query.sort,
        )
    )

    if gene:
        # Text-mined gene annotations reach full text, which is where most variant mentions are
        fields = ["TITLE", "ABSTRACT", "GENE_PROTEIN"] if variant_text or query.residue else ["TITLE", "ABSTRACT"]
        parts = [f"{name}:{_quoted(gene)}" for name in fields]
        if accession:
            parts.append(f"UNIPROT_PUBS:{accession}")
        resolved.clauses.append("(" + " OR ".join(parts) + ")")
    elif accession:
        resolved.clauses.append(f"(UNIPROT_PUBS:{accession} OR ACCESSION_ID:{accession})")

    if query.disease:
        slug = query.disease.strip()
        seed_disease = catalog.disease(slug) if catalog.ready else None
        if seed_disease:
            names = [seed_disease.name, *[alias for alias in seed_disease.aliases if len(alias) >= 6][:3]]
            resolved.context.disease_name = seed_disease.name
        else:
            names = [slug.replace("-", " ")]
            resolved.notes.append(
                f"No catalog disease has the ID {slug}; it was searched as the text {names[0]!r}."
            )
        resolved.disease_names = names
        resolved.clauses.append(_any_of(names))

    if variant_text:
        if substitution and substitution.alternate != "*":
            three = substitution.hgvs_p.removeprefix("p.")
            terms = [substitution.short, three]
            resolved.variant_label = substitution.short
            resolved.variant_pattern = re.compile(
                _BOUNDARY_START
                + r"(?:p\.)?(?:"
                + re.escape(substitution.short)
                + "|"
                + re.escape(three)
                + r")(?![A-Za-z0-9])",
                re.IGNORECASE,
            )
        else:
            terms = [variant_text]
            resolved.variant_label = variant_text
            resolved.variant_pattern = re.compile(re.escape(variant_text), re.IGNORECASE)
            resolved.notes.append(
                "The variant is not a single-residue substitution; it was searched as written."
            )
        resolved.context.variant_terms = terms
        resolved.clauses.append(_any_of(terms))

    if query.residue:
        await _resolve_residue(query.residue.strip(), accession, substitution, resolved)

    if resolved.context.q:
        resolved.clauses.append("(" + resolved.context.q.replace("(", " ").replace(")", " ") + ")")

    return resolved


async def _resolve_residue(residue: str, accession: str | None, substitution: Any, resolved: _Resolved) -> None:
    match = _RESIDUE_RE.match(residue)
    if not match:
        raise BadRequest("residue is a UniProt canonical position, optionally with its residue: 28, R28, Arg28.")
    letters, position = match.group(1), int(match.group(2))
    reference = None
    if letters:
        reference = letters.upper() if len(letters) == 1 else AMINO_ACID_3_TO_1.get(letters.capitalize())
        if reference not in AMINO_ACID_1_TO_3 or reference == "*":
            raise BadRequest(f"{letters} is not an amino acid code.")
    elif substitution and substitution.position == position:
        reference = substitution.reference
    elif accession:
        fasta = await uniprot.fasta(accession)
        resolved.sources.append(fasta.status())
        sequence = _sequence(fasta.data) if fasta.ok and fasta.data else ""
        if 1 <= position <= len(sequence):
            reference = sequence[position - 1]
    if reference is None:
        resolved.notes.append(
            f"The reference residue at position {position} is unknown, so papers could not be "
            "narrowed to this residue. Give the residue with its letter (for example R28) or an accession."
        )
        return
    three = AMINO_ACID_1_TO_3[reference]
    if resolved.context.variant_terms:
        # The variant terms already narrow the search to this residue
        if substitution and substitution.position == position:
            resolved.context.residue_terms = [f"{reference}{position}", f"{three}{position}"]
            resolved.residue_label = f"{three}{position}"
            resolved.residue_pattern = _residue_pattern(reference, three, position)
            return
    alternates = [letter for letter in "ACDEFGHIKLMNPQRSTVWY" if letter != reference]
    terms = [f"{reference}{position}", f"{three}{position}"]
    terms += [f"{reference}{position}{alternate}" for alternate in alternates]
    terms += [f"{three}{position}{AMINO_ACID_1_TO_3[alternate]}" for alternate in alternates]
    resolved.context.residue_terms = terms[:2]
    resolved.residue_label = f"{three}{position}"
    resolved.residue_pattern = _residue_pattern(reference, three, position)
    resolved.clauses.append(_any_of(terms))
    resolved.notes.append(
        f"Residue search covers {reference}{position}, {three}{position} and every substitution written "
        f"at that position (for example {reference}{position}{alternates[0]}); other notations are not matched."
    )


def _residue_pattern(reference: str, three: str, position: int) -> re.Pattern[str]:
    return re.compile(
        _BOUNDARY_START + rf"(?:p\.)?(?:{reference}|{three})[\s-]?{position}(?![0-9])",
        re.IGNORECASE,
    )


def _first_match(pattern: re.Pattern[str] | None, text: str | None) -> str | None:
    if pattern is None or not text:
        return None
    found = pattern.search(text)
    return found.group(0) if found else None


def _word_in(term: str, text: str | None) -> bool:
    if not text:
        return False
    term, text = term.replace("-", " "), text.replace("-", " ")
    return bool(re.search(_BOUNDARY_START + re.escape(term) + r"(?![A-Za-z0-9])", text, re.IGNORECASE))


def _strip_markup(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"[ \t]+", " ", cleaned).strip() or None


def _relevance(
    publication: LiteraturePublication,
    resolved: _Resolved | None,
    uniprot_pmids: set[str],
) -> list[RelevanceReason]:
    reasons: list[RelevanceReason] = []
    if resolved is not None:
        title, abstract = publication.title, publication.abstract
        variant_found = False
        if resolved.variant_pattern is not None:
            in_title = _first_match(resolved.variant_pattern, title)
            in_abstract = _first_match(resolved.variant_pattern, abstract)
            variant_found = bool(in_title or in_abstract)
            if in_title:
                reasons.append(
                    RelevanceReason(code="variant_in_title", label="Variant in title", detail=in_title)
                )
            if in_abstract:
                reasons.append(
                    RelevanceReason(code="variant_in_abstract", label="Variant in abstract", detail=in_abstract)
                )
        residue_found = False
        if resolved.residue_pattern is not None:
            in_title = _first_match(resolved.residue_pattern, title)
            in_abstract = _first_match(resolved.residue_pattern, abstract)
            residue_found = bool(in_title or in_abstract)
            if in_title and not variant_found:
                reasons.append(
                    RelevanceReason(code="residue_in_title", label="Residue in title", detail=in_title)
                )
            if in_abstract and not variant_found:
                reasons.append(
                    RelevanceReason(code="residue_in_abstract", label="Residue in abstract", detail=in_abstract)
                )
        narrowed = resolved.variant_pattern is not None or bool(
            resolved.residue_pattern is not None and not resolved.context.variant_terms
        )
        if narrowed and not variant_found and not residue_found:
            label = resolved.variant_label or resolved.residue_label
            reasons.append(
                RelevanceReason(
                    code="matched_outside_abstract",
                    label="Match outside title and abstract",
                    detail=f"Europe PMC matched {label} in its index (full text or annotations), "
                    "not in the title or abstract shown here.",
                )
            )
        gene = resolved.context.gene
        if gene and _word_in(gene, title):
            reasons.append(RelevanceReason(code="gene_in_title", label="Gene in title", detail=gene))
        for name in resolved.disease_names:
            if _word_in(name, title):
                reasons.append(RelevanceReason(code="disease_in_title", label="Disease in title", detail=name))
                break
        if publication.pmid and publication.pmid in uniprot_pmids and resolved.context.accession:
            reasons.append(
                RelevanceReason(
                    code="uniprot_linked",
                    label="Cited by UniProt entry",
                    detail=resolved.context.accession,
                )
            )
    if publication.is_review:
        reasons.append(RelevanceReason(code="review", label="Review", detail=None))
    if publication.cited_by_count is not None and publication.cited_by_count >= HIGHLY_CITED_THRESHOLD:
        reasons.append(
            RelevanceReason(
                code="highly_cited",
                label="Highly cited",
                detail=f"{publication.cited_by_count} citations in Europe PMC "
                f"(rule: {HIGHLY_CITED_THRESHOLD} or more)",
            )
        )
    return reasons


def _publication(row: dict[str, Any], provenance: Provenance | None, subject: EntityRef | None) -> LiteraturePublication:
    journal = ((row.get("journalInfo") or {}).get("journal")) or {}
    authors = [
        author.get("fullName") or author.get("collectiveName")
        for author in (row.get("authorList") or {}).get("author") or []
    ]
    types = list((row.get("pubTypeList") or {}).get("pubType") or [])
    pmid = str(row["pmid"]) if row.get("pmid") else None
    doi = row.get("doi")
    pmcid = row.get("pmcid")
    year = row.get("pubYear")
    open_access = row.get("isOpenAccess")
    full_text = None
    for link in (row.get("fullTextUrlList") or {}).get("fullTextUrl") or []:
        if link.get("availabilityCode") in ("OA", "F") and link.get("url"):
            full_text = link["url"]
            break
    record_url = f"https://europepmc.org/article/{row.get('source', 'MED')}/{row.get('id')}"
    title = _strip_markup(row.get("title")) or "Untitled record"
    citation = Citation(
        title=title, year=int(year) if year else None, pmid=pmid, pmcid=pmcid, doi=doi, url=record_url
    )
    evidence = None
    if provenance is not None and pmid:
        evidence = try_build_evidence(
            provenance,
            record_type="article",
            record_id=pmid,
            url=record_url,
            subject=subject,
            predicate="mentioned_in" if subject else None,
            citations=[citation],
        )
    return LiteraturePublication(
        pmid=pmid,
        pmcid=pmcid,
        doi=doi,
        title=title,
        journal=journal.get("title") or row.get("bookOrReportDetails", {}).get("publisher"),
        journal_abbreviation=journal.get("isoabbreviation") or journal.get("medlineAbbreviation"),
        year=int(year) if year else None,
        published=row.get("firstPublicationDate"),
        authors=[author for author in authors if author],
        author_string=row.get("authorString"),
        abstract=_strip_markup(row.get("abstractText")),
        is_open_access={"Y": True, "N": False}.get(open_access),
        license=row.get("license"),
        cited_by_count=row.get("citedByCount"),
        publication_types=types,
        is_review=any(kind.lower() in REVIEW_TYPES for kind in types),
        url=record_url,
        pubmed_url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
        doi_url=f"https://doi.org/{doi}" if doi else None,
        full_text_url=full_text,
        evidence=evidence,
    )


def _subject(context: LiteratureContext) -> EntityRef | None:
    if context.gene:
        return EntityRef.of(EntityType.GENE, context.gene)
    if context.accession:
        return EntityRef.of(EntityType.PROTEIN, context.accession, curie=f"uniprot:{context.accession}")
    return None


async def search_literature(query: LiteratureQuery, catalog: Catalog) -> LiteratureResponse:
    resolved = await _resolve(query, catalog)
    if not resolved.clauses:
        raise BadRequest("Give at least one of gene, disease, variant, accession, residue or q.")
    clauses = [*resolved.clauses, "SRC:MED"]
    if query.kind == "review":
        clauses.append('PUB_TYPE:"Review"')
    elif query.kind == "primary":
        clauses.append('NOT PUB_TYPE:"Review"')
    upstream_query = " AND ".join(clauses)
    if len(upstream_query) > MAX_QUERY_LENGTH:
        raise BadRequest("The search is too long for Europe PMC (1500 characters).")

    page_size = query.page_size
    skip = (query.page - 1) * page_size
    if skip > MAX_PAGE_SIZE:
        raise BadRequest(f"Europe PMC results can be paged to {MAX_PAGE_SIZE} records; narrow the search.")
    sort = SORTS[query.sort]
    base = {
        "query": upstream_query,
        "query_url": "https://europepmc.org/search?query=" + quote(upstream_query),
        "page": query.page,
        "page_size": page_size,
        "context": resolved.context,
        "highly_cited_threshold": HIGHLY_CITED_THRESHOLD,
    }

    cursor = "*"
    if skip:
        # Europe PMC pages by cursor only: read the IDs before this page to get its cursor
        walk = await europepmc.search(upstream_query, page_size=skip, sort=sort, result_type="idlist")
        if not walk.ok or not walk.data or not walk.data.get("next_cursor"):
            return LiteratureResponse(
                **base,
                total=walk.data["hit_count"] if walk.ok and walk.data else (0 if walk.is_empty else None),
                sources=[*resolved.sources, walk.status()],
                notes=resolved.notes,
            )
        cursor = walk.data["next_cursor"]

    result = await europepmc.search(upstream_query, page_size=page_size, cursor=cursor, sort=sort)
    sources = [*resolved.sources, result.status()]
    if not result.ok or result.data is None:
        return LiteratureResponse(
            **base, total=0 if result.is_empty else None, sources=sources, notes=resolved.notes
        )

    uniprot_pmids: set[str] = set()
    if resolved.context.accession:
        linked = await europepmc.uniprot_publications(resolved.context.accession)
        if linked.ok and linked.data:
            uniprot_pmids = set(linked.data)
        elif not linked.answered:
            resolved.notes.append(
                "The UniProt citation list could not be read, so 'Cited by UniProt entry' is not marked."
            )

    subject = _subject(resolved.context)
    items = []
    for row in result.data["results"]:
        publication = _publication(row, result.provenance, subject)
        publication.relevance = _relevance(publication, resolved, uniprot_pmids)
        items.append(publication)
    total = result.data["hit_count"]
    return LiteratureResponse(
        **base,
        items=items,
        total=total,
        has_more=skip + len(items) < total,
        sources=sources,
        notes=resolved.notes,
    )


async def get_publication(pmid: str) -> LiteratureRecordResponse:
    result: SourceResult[dict[str, Any]] = await europepmc.article(pmid)
    if result.is_empty:
        raise NotFound(f"Europe PMC has no PubMed-indexed record with PMID {pmid}.")
    if not result.ok or result.data is None:
        return LiteratureRecordResponse(publication=None, sources=[result.status()])
    publication = _publication(result.data, result.provenance, None)
    publication.relevance = _relevance(publication, None, set())
    return LiteratureRecordResponse(publication=publication, sources=[result.status()])
