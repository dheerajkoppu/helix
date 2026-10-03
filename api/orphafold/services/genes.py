"""Gene knowledge: the catalog record and its IUIS entries, transcripts from Ensembl and a protein
summary from UniProt. A gene outside the catalog is resolved live from Ensembl and UniProt."""

from typing import Any

from orphafold.errors import NotFound, SourceUnavailable
from orphafold.evidence import try_build_evidence
from orphafold.knowledge.catalog import Catalog, SeedDisease, SeedGene, SeedProvenance
from orphafold.schemas.common import (
    EntityRef,
    EntityType,
    EvidenceObject,
    Provenance,
    SourceState,
    entity_href,
)
from orphafold.schemas.genes import (
    GeneDisease,
    GeneDiseaseTerm,
    GeneProteinSummary,
    GeneResponse,
    GeneStatistic,
    GeneTranscripts,
    GenomicLocation,
    RecordSource,
    Transcript,
)
from orphafold.schemas.proteins import TextAnnotation
from orphafold.services.proteins import (
    entry_comment_texts,
    entry_gene_symbol,
    entry_names,
    entry_xrefs,
    protein_ref,
    uniprot_evidence,
)
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.base import SourceResult
from orphafold.sources.ensembl import ensembl
from orphafold.sources.uniprot import uniprot

# key, label, definition (data/seed/README.md), seed source, index among that source's records
STATISTICS: list[tuple[str, str, str, str, int]] = [
    (
        "experimental_structure_count",
        "Experimental structures",
        "Distinct PDB entries in PDBe SIFTS for the UniProt accession.",
        "pdbe_sifts",
        0,
    ),
    (
        "has_alphafold_model",
        "AlphaFold DB model",
        "AlphaFold DB has a model for the canonical accession. Proteins longer than 2,700 residues have none.",
        "alphafold_db",
        0,
    ),
    (
        "clinvar_total_count",
        "ClinVar records",
        "ClinVar records for SYMBOL[gene]. Multi-gene copy-number variants are included, as on the ClinVar website.",
        "clinvar",
        0,
    ),
    (
        "clinvar_pathogenic_count",
        "ClinVar pathogenic or likely pathogenic",
        "ClinVar records for SYMBOL[gene] classified pathogenic or likely pathogenic. Multi-gene copy-number "
        "variants are included, as on the ClinVar website.",
        "clinvar",
        1,
    ),
    (
        "publication_count",
        "Publications linked to the UniProtKB entry",
        "Europe PMC records for UNIPROT_PUBS:<accession>, the publications linked to the UniProtKB entry. "
        "It measures curated literature, not every paper that mentions the gene.",
        "europe_pmc",
        0,
    ),
]


def _record_source(catalog: Catalog, provenance: SeedProvenance) -> RecordSource:
    seed = catalog.seed_source(provenance.source_id)
    return RecordSource(
        source_id=provenance.source_id,
        name=seed.name if seed else None,
        record_id=str(provenance.record_id) if provenance.record_id is not None else None,
        url=provenance.url,
        release=seed.release if seed else None,
        license=seed.license if seed else None,
        retrieved_at=seed.retrieved_at if seed else None,
    )


def _statistics(catalog: Catalog, gene: SeedGene) -> list[GeneStatistic]:
    rows = []
    for key, label, definition, source_id, index in STATISTICS:
        records = [item for item in gene.provenance if item.source_id == source_id]
        record = records[index] if index < len(records) else None
        rows.append(
            GeneStatistic(
                key=key,
                label=label,
                value=getattr(gene.stats, key),
                definition=definition,
                retrieved_at=gene.stats.retrieved_at,
                source=_record_source(catalog, record) if record else None,
            )
        )
    return rows


def _disease(catalog: Catalog, disease: SeedDisease) -> GeneDisease:
    category = catalog.category(disease.category_id) if disease.category_id else None
    found = catalog.subcategory(disease.subcategory_id) if disease.subcategory_id else None
    return GeneDisease(
        id=disease.id,
        name=disease.name,
        href=entity_href(EntityType.DISEASE, disease.id) or f"/disease/{disease.id}",
        category_id=disease.category_id,
        category_name=category.name if category else None,
        category_table=category.table if category else None,
        subcategory_id=disease.subcategory_id,
        subcategory_name=found[1].name if found else None,
        inheritance_raw=disease.inheritance.raw,
        inheritance_codes=disease.inheritance.codes,
        inheritance_terms=[GeneDiseaseTerm(id=term.id, label=term.label) for term in disease.inheritance.hpo],
        mechanism=disease.mechanism,
        is_phenocopy=disease.is_phenocopy,
        mondo=[str(value) for value in disease.xrefs.mondo],
        orphanet=[str(value) for value in disease.xrefs.orphanet],
        omim=[str(value) for value in disease.xrefs.omim],
        sources=[_record_source(catalog, item) for item in disease.provenance],
    )


def _transcript(
    row: dict[str, Any], gene_ref: EntityRef, provenance: Provenance | None, mane_xref: dict[str, str]
) -> Transcript:
    mane_types = {item["type"]: item.get("refseq_match") for item in row.get("mane") or []}
    is_select = "MANE_Select" in mane_types
    is_plus_clinical = "MANE_Plus_Clinical" in mane_types
    evidence = None
    if provenance is not None:
        evidence = try_build_evidence(
            provenance,
            record_type="mane" if is_select or is_plus_clinical else "transcript",
            record_id=row["id"],
            record_version=str(row["version"]) if row.get("version") is not None else None,
            url=ensembl.record_url(row["id"]),
            subject=gene_ref,
            predicate="has_mane_select_transcript" if is_select else "has_transcript",
            object=EvidenceObject(type="transcript", id=f"ensembl:{row['id']}", label=row.get("display_name")),
        )
    return Transcript(
        id=row["id"],
        version=row.get("version"),
        display_name=row.get("display_name"),
        biotype=row.get("biotype"),
        is_canonical=row.get("is_canonical", False),
        is_mane_select=is_select,
        is_mane_plus_clinical=is_plus_clinical,
        refseq_transcript=mane_types.get("MANE_Select") or mane_types.get("MANE_Plus_Clinical"),
        refseq_protein=mane_xref.get("RefSeqProteinId") if is_select else None,
        length=row.get("length"),
        exon_count=row.get("exon_count"),
        start=row.get("start"),
        end=row.get("end"),
        protein_id=row.get("protein_id"),
        protein_version=row.get("protein_version"),
        protein_length=row.get("protein_length"),
        url=ensembl.record_url(row["id"]),
        evidence=evidence,
    )


def _mane_from_uniprot(
    entry: dict[str, Any] | None, accession: str | None, gene_ref: EntityRef, provenance: Provenance | None
) -> tuple[Transcript | None, dict[str, str]]:
    """The MANE Select cross-reference of the UniProt entry: RefSeq protein ID, and the transcript
    itself for when Ensembl did not answer."""
    rows = entry_xrefs(entry, "MANE-Select") if entry else []
    if not rows or accession is None:
        return None, {}
    row = rows[0]
    properties = {item["key"]: item["value"] for item in row.get("properties") or [] if item.get("value")}
    transcript_id, _, transcript_version = row["id"].partition(".")
    protein_id, _, protein_version = properties.get("ProteinId", "").partition(".")
    evidence = None
    if provenance is not None:
        evidence = try_build_evidence(
            provenance,
            record_type="entry",
            record_id=accession,
            subject=gene_ref,
            predicate="has_mane_select_transcript",
            object=EvidenceObject(type="transcript", id=f"ensembl:{transcript_id}"),
        )
    transcript = Transcript(
        id=transcript_id,
        version=int(transcript_version) if transcript_version.isdigit() else None,
        is_mane_select=True,
        refseq_transcript=properties.get("RefSeqNucleotideId"),
        refseq_protein=properties.get("RefSeqProteinId"),
        protein_id=protein_id or None,
        protein_version=int(protein_version) if protein_version.isdigit() else None,
        url=ensembl.record_url(transcript_id),
        evidence=evidence,
    )
    return transcript, properties


def _transcripts(
    ensembl_gene: dict[str, Any] | None,
    ensembl_provenance: Provenance | None,
    gene_ref: EntityRef,
    uniprot_mane: Transcript | None,
    mane_xref: dict[str, str],
) -> GeneTranscripts:
    if ensembl_gene is None:
        return GeneTranscripts(mane_select=uniprot_mane, total=None)
    rows = [
        _transcript(row, gene_ref, ensembl_provenance, mane_xref) for row in ensembl_gene.get("transcripts") or []
    ]
    mane_select = next((row for row in rows if row.is_mane_select), None)
    others = [row for row in rows if not row.is_mane_select and not row.is_mane_plus_clinical]
    others.sort(
        key=lambda row: (
            not row.is_canonical,
            row.biotype != "protein_coding",
            -(row.protein_length or 0),
            row.display_name or row.id,
        )
    )
    return GeneTranscripts(
        mane_select=mane_select or uniprot_mane,
        mane_plus_clinical=[row for row in rows if row.is_mane_plus_clinical and not row.is_mane_select],
        others=others,
        total=len(rows),
    )


def _protein_summary(
    entry: dict[str, Any] | None, provenance: Provenance | None, seed_gene: SeedGene | None, accession: str | None
) -> GeneProteinSummary | None:
    if entry is None:
        if seed_gene is None or accession is None:
            return None
        return GeneProteinSummary(
            protein=protein_ref(accession, seed_gene.protein_name),
            accession=accession,
            name=seed_gene.protein_name,
            length=seed_gene.protein_length,
            family=seed_gene.protein_family,
        )
    primary = entry.get("primaryAccession") or accession or ""
    names = entry_names(entry)
    sequence = entry.get("sequence") or {}
    similarity = entry_comment_texts(entry, "SIMILARITY")
    isoforms = [
        isoform
        for comment in entry.get("comments") or []
        if comment.get("commentType") == "ALTERNATIVE PRODUCTS"
        for isoform in comment.get("isoforms") or []
    ]
    return GeneProteinSummary(
        protein=protein_ref(primary, names.recommended),
        accession=primary,
        entry_name=entry.get("uniProtkbId"),
        name=names.recommended,
        reviewed="Swiss-Prot" in entry["entryType"] if entry.get("entryType") else None,
        length=sequence.get("length"),
        mass_da=sequence.get("molWeight"),
        family=similarity[0]["value"] if similarity else None,
        function=[
            TextAnnotation(
                text=row["value"],
                molecule=row.get("molecule"),
                evidence=uniprot_evidence(
                    provenance, primary, row.get("evidences"), predicate="has_function", statement=row["value"]
                ),
            )
            for row in entry_comment_texts(entry, "FUNCTION")
            if row.get("value")
        ],
        isoform_count=len(isoforms) if isoforms else None,
        provenance=provenance,
    )


def _entry(result: SourceResult[dict[str, Any]]) -> dict[str, Any] | None:
    entry = result.data if result.ok else None
    return entry if entry and entry.get("entryType") != "Inactive" else None


async def _catalog_gene(catalog: Catalog, seed_gene: SeedGene) -> GeneResponse:
    accession = seed_gene.uniprot_accession
    calls: dict[str, SourceCall] = {
        "ensembl": SourceCall(
            ensembl,
            ensembl.gene(seed_gene.ensembl_gene_id)
            if seed_gene.ensembl_gene_id
            else ensembl.gene_by_symbol(seed_gene.symbol),
            timeout=30,
        )
    }
    if accession:
        calls["uniprot"] = SourceCall(uniprot, uniprot.entry(accession), timeout=25)
    gathered = await gather_sources(calls)
    ensembl_result = gathered["ensembl"]
    ensembl_gene = ensembl_result.data if ensembl_result.ok else None
    uniprot_result = gathered["uniprot"] if accession else None
    entry = _entry(uniprot_result) if uniprot_result else None
    uniprot_provenance = uniprot_result.provenance if uniprot_result and entry else None

    gene_ref = EntityRef.of(
        EntityType.GENE,
        seed_gene.symbol,
        label=seed_gene.name,
        curie=seed_gene.hgnc_id.lower() if seed_gene.hgnc_id else None,
    )
    uniprot_mane, mane_xref = _mane_from_uniprot(entry, accession, gene_ref, uniprot_provenance)
    return GeneResponse(
        gene=gene_ref,
        symbol=seed_gene.symbol,
        in_catalog=True,
        is_flagship=catalog.flagship_for_gene(seed_gene.symbol) is not None,
        hgnc_id=seed_gene.hgnc_id,
        name=seed_gene.name,
        locus_type=seed_gene.locus_type,
        biotype=ensembl_gene.get("biotype") if ensembl_gene else None,
        chromosome=str(seed_gene.chromosome) if seed_gene.chromosome is not None else None,
        location=_location(ensembl_gene),
        ensembl_gene_id=seed_gene.ensembl_gene_id or (ensembl_gene["id"] if ensembl_gene else None),
        ensembl_gene_version=ensembl_gene.get("version") if ensembl_gene else None,
        ncbi_gene_id=str(seed_gene.ncbi_gene_id) if seed_gene.ncbi_gene_id is not None else None,
        uniprot_accession=accession,
        statistics=_statistics(catalog, seed_gene),
        diseases=[_disease(catalog, disease) for disease in catalog.diseases_for_gene(seed_gene.symbol)],
        transcripts=_transcripts(ensembl_gene, ensembl_result.provenance, gene_ref, uniprot_mane, mane_xref),
        protein=_protein_summary(entry, uniprot_provenance, seed_gene, accession),
        record_sources=[_record_source(catalog, item) for item in seed_gene.provenance],
        ensembl_provenance=ensembl_result.provenance if ensembl_gene else None,
        sources=[catalog.source_status(), *gathered.sources],
    )


def _location(ensembl_gene: dict[str, Any] | None) -> GenomicLocation | None:
    if ensembl_gene is None:
        return None
    return GenomicLocation(
        assembly=ensembl_gene.get("assembly"),
        chromosome=ensembl_gene.get("chromosome"),
        start=ensembl_gene.get("start"),
        end=ensembl_gene.get("end"),
        strand=ensembl_gene.get("strand"),
    )


async def _live_gene(catalog: Catalog, symbol: str) -> GeneResponse:
    gathered = await gather_sources(
        {
            "ensembl": SourceCall(ensembl, ensembl.gene_by_symbol(symbol), timeout=30),
            "uniprot": SourceCall(uniprot, uniprot.reviewed_entry_for_gene(symbol), timeout=25),
        }
    )
    ensembl_result, search_result = gathered["ensembl"], gathered["uniprot"]
    ensembl_gene = ensembl_result.data if ensembl_result.ok else None
    hit = search_result.data if search_result.ok else None
    if ensembl_gene is None and hit is None:
        if ensembl_result.state is SourceState.UNAVAILABLE and search_result.state is SourceState.UNAVAILABLE:
            raise SourceUnavailable(ensembl.name, "Neither Ensembl nor UniProtKB answered; the gene could not be resolved.")
        raise NotFound(
            f"No human gene {symbol} in the catalog, Ensembl or reviewed UniProtKB.", code="gene_not_found"
        )

    sources = [catalog.source_status(), *gathered.sources]
    accession = hit["primaryAccession"] if hit else None
    entry, uniprot_provenance = None, None
    if accession:
        entry_result = await uniprot.entry(accession)
        entry = _entry(entry_result)
        uniprot_provenance = entry_result.provenance if entry else None
        if not entry_result.ok:
            sources = [row for row in sources if row.source != uniprot.id] + [entry_result.status()]

    resolved_symbol = (
        (ensembl_gene.get("symbol") if ensembl_gene else None)
        or (entry_gene_symbol(entry) if entry else None)
        or (entry_gene_symbol(hit) if hit else None)
        or symbol
    )
    hgnc_id = None
    if ensembl_gene and ensembl_gene.get("name_source") == "HGNC Symbol":
        hgnc_id = ensembl_gene.get("name_accession")
    if hgnc_id is None and entry:
        hgnc_id = next((row["id"] for row in entry_xrefs(entry, "HGNC")), None)
    name = ensembl_gene.get("name") if ensembl_gene else None
    ncbi_gene_id = next((row["id"] for row in entry_xrefs(entry, "GeneID")), None) if entry else None

    gene_ref = EntityRef.of(
        EntityType.GENE, resolved_symbol, label=name, curie=hgnc_id.lower() if hgnc_id else None
    )
    uniprot_mane, mane_xref = _mane_from_uniprot(entry, accession, gene_ref, uniprot_provenance)
    return GeneResponse(
        gene=gene_ref,
        symbol=resolved_symbol,
        in_catalog=False,
        hgnc_id=hgnc_id,
        name=name,
        biotype=ensembl_gene.get("biotype") if ensembl_gene else None,
        chromosome=ensembl_gene.get("chromosome") if ensembl_gene else None,
        location=_location(ensembl_gene),
        ensembl_gene_id=ensembl_gene["id"] if ensembl_gene else None,
        ensembl_gene_version=ensembl_gene.get("version") if ensembl_gene else None,
        ncbi_gene_id=ncbi_gene_id,
        uniprot_accession=accession,
        transcripts=_transcripts(ensembl_gene, ensembl_result.provenance, gene_ref, uniprot_mane, mane_xref),
        protein=_protein_summary(entry, uniprot_provenance, None, accession),
        ensembl_provenance=ensembl_result.provenance if ensembl_gene else None,
        sources=sources,
    )


async def get_gene(symbol: str, catalog: Catalog) -> GeneResponse:
    symbol = symbol.strip()
    seed_gene = catalog.gene(symbol)
    if seed_gene is not None:
        return await _catalog_gene(catalog, seed_gene)
    return await _live_gene(catalog, symbol)
