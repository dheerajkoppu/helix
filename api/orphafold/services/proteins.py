"""Protein knowledge: the UniProt entry as names, sequence, annotations and feature tracks, with
InterPro entries as a second set of tracks. Every feature keeps the ECO code its source gave it."""

from collections import OrderedDict
from typing import Any

from orphafold.errors import BadRequest, NotFound, SourceUnavailable
from orphafold.evidence import try_build_evidence
from orphafold.hashing import md5_hex
from orphafold.identifiers import is_uniprot_accession, parse_protein_change
from orphafold.knowledge.catalog import Catalog
from orphafold.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    Provenance,
    SourceStatus,
)
from orphafold.schemas.proteins import (
    CrossReference,
    CrossReferenceGroup,
    Feature,
    FeatureLigand,
    FeatureTrack,
    InterProEntry,
    Isoform,
    ProteinNames,
    ProteinResponse,
    ProteinSequence,
    ResidueResponse,
    SubcellularLocation,
    TextAnnotation,
)
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.base import SourceResult
from orphafold.sources.interpro import interpro
from orphafold.sources.uniprot import uniprot

# (track id, label, UniProt feature types)
UNIPROT_TRACKS: list[tuple[str, str, tuple[str, ...]]] = [
    ("domains", "Domains", ("Domain",)),
    ("regions", "Regions", ("Region", "Coiled coil", "Compositional bias")),
    ("repeats", "Repeats", ("Repeat",)),
    ("motifs", "Motifs", ("Motif",)),
    ("zinc_fingers", "Zinc fingers", ("Zinc finger",)),
    ("dna_binding", "DNA binding", ("DNA binding",)),
    ("active_sites", "Active sites", ("Active site",)),
    ("binding_sites", "Binding sites", ("Binding site",)),
    ("sites", "Sites", ("Site",)),
    ("modified_residues", "Modified residues", ("Modified residue", "Lipidation", "Glycosylation", "Cross-link")),
    ("disulfides", "Disulfide bonds", ("Disulfide bond",)),
    ("signal_transit", "Signal and transit peptides", ("Signal", "Transit peptide", "Propeptide", "Initiator methionine")),
    ("chains", "Chains and peptides", ("Chain", "Peptide")),
    ("topology", "Topology", ("Topological domain", "Transmembrane", "Intramembrane")),
    ("secondary_structure", "Secondary structure", ("Helix", "Beta strand", "Turn")),
    ("natural_variants", "Natural variants", ("Natural variant",)),
    ("mutagenesis", "Mutagenesis", ("Mutagenesis",)),
    ("other", "Other sequence annotations", ()),
]
_TRACK_OF_TYPE = {kind: track for track, _, kinds in UNIPROT_TRACKS for kind in kinds}

# (track id, label, InterPro entry types)
INTERPRO_TRACKS: list[tuple[str, str, tuple[str, ...]]] = [
    ("interpro_families", "InterPro families", ("family",)),
    ("interpro_domains", "InterPro domains", ("domain", "repeat")),
    ("interpro_superfamilies", "InterPro homologous superfamilies", ("homologous_superfamily",)),
    ("interpro_sites", "InterPro sites", ("active_site", "binding_site", "conserved_site", "ptm")),
    ("interpro_other", "InterPro other entries", ()),
]
_INTERPRO_TRACK_OF_TYPE = {kind: track for track, _, kinds in INTERPRO_TRACKS for kind in kinds}

# Endpoint-only features: the residues between the two ends are not annotated
_LINK_TYPES = {"Disulfide bond", "Cross-link"}

AMINO_ACIDS: dict[str, tuple[str, str]] = {
    "A": ("Ala", "Alanine"),
    "R": ("Arg", "Arginine"),
    "N": ("Asn", "Asparagine"),
    "D": ("Asp", "Aspartate"),
    "C": ("Cys", "Cysteine"),
    "Q": ("Gln", "Glutamine"),
    "E": ("Glu", "Glutamate"),
    "G": ("Gly", "Glycine"),
    "H": ("His", "Histidine"),
    "I": ("Ile", "Isoleucine"),
    "L": ("Leu", "Leucine"),
    "K": ("Lys", "Lysine"),
    "M": ("Met", "Methionine"),
    "F": ("Phe", "Phenylalanine"),
    "P": ("Pro", "Proline"),
    "S": ("Ser", "Serine"),
    "T": ("Thr", "Threonine"),
    "W": ("Trp", "Tryptophan"),
    "Y": ("Tyr", "Tyrosine"),
    "V": ("Val", "Valine"),
    "U": ("Sec", "Selenocysteine"),
    "O": ("Pyl", "Pyrrolysine"),
}

RESIDUE_WINDOW = 7
_CACHE_SIZE = 64
_parsed: OrderedDict[tuple[str, str | None, str | None], ProteinResponse] = OrderedDict()


def normalise_accession(accession: str) -> str:
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.", code="invalid_accession")
    return accession


def protein_ref(accession: str, label: str | None = None) -> EntityRef:
    return EntityRef.of(EntityType.PROTEIN, accession, label=label, curie=f"uniprot:{accession}")


def entry_names(entry: dict[str, Any]) -> ProteinNames:
    description = entry.get("proteinDescription") or {}
    recommended = description.get("recommendedName") or {}
    submitted = description.get("submissionNames") or []
    full = (recommended.get("fullName") or {}).get("value")
    if full is None and submitted:
        full = (submitted[0].get("fullName") or {}).get("value")
    alternative_names = description.get("alternativeNames") or []
    return ProteinNames(
        recommended=full,
        short_names=[name["value"] for name in recommended.get("shortNames") or []],
        alternative=[
            name["fullName"]["value"] for name in alternative_names if name.get("fullName")
        ]
        + [short["value"] for name in alternative_names for short in name.get("shortNames") or []],
        ec_numbers=[number["value"] for number in recommended.get("ecNumbers") or []],
    )


def entry_gene_symbol(entry: dict[str, Any]) -> str | None:
    for gene in entry.get("genes") or []:
        symbol = (gene.get("geneName") or {}).get("value")
        if symbol:
            return symbol
    return None


def entry_xrefs(entry: dict[str, Any], database: str) -> list[dict[str, Any]]:
    return [row for row in entry.get("uniProtKBCrossReferences") or [] if row.get("database") == database]


def entry_comment_texts(entry: dict[str, Any], comment_type: str) -> list[dict[str, Any]]:
    """Text rows of one comment type: {value, evidences, molecule}."""
    rows = []
    for comment in entry.get("comments") or []:
        if comment.get("commentType") != comment_type:
            continue
        for text in comment.get("texts") or []:
            rows.append({**text, "molecule": comment.get("molecule")})
    return rows


def uniprot_evidence(
    provenance: Provenance | None,
    accession: str,
    raw_evidences: list[dict[str, Any]] | None,
    *,
    predicate: str,
    evidence_object: EvidenceObject | None = None,
    statement: str | None = None,
) -> list[Evidence]:
    """One Evidence row per ECO code the entry attaches to an annotation, citations merged. An
    annotation without a code is a curated-database statement."""
    if provenance is None:
        return []
    subject = protein_ref(accession)
    grouped: OrderedDict[str, list[Citation]] = OrderedDict()
    for row in raw_evidences or []:
        code = row.get("evidenceCode")
        if not code:
            continue
        citations = grouped.setdefault(code, [])
        source, source_id = row.get("source"), row.get("id")
        if source == "PubMed" and source_id:
            citations.append(Citation(pmid=str(source_id), url=f"https://pubmed.ncbi.nlm.nih.gov/{source_id}"))
        elif source and source_id:
            citations.append(Citation(text=f"{source}:{source_id}"))
    common: dict[str, Any] = {
        "record_id": accession,
        "subject": subject,
        "predicate": predicate,
        "object": evidence_object,
        "statement": statement,
    }
    if not grouped:
        evidence = try_build_evidence(provenance, record_type="feature_without_evidence", **common)
        return [evidence] if evidence else []
    rows = []
    for code, citations in grouped.items():
        evidence = try_build_evidence(provenance, record_type="feature", eco=code, citations=citations, **common)
        if evidence:
            rows.append(evidence)
    return rows


def _slug(text: str) -> str:
    return text.strip().lower().replace(" ", "_").replace("-", "_")


def _uniprot_features(entry: dict[str, Any], accession: str, provenance: Provenance | None) -> list[Feature]:
    gene_symbol = entry_gene_symbol(entry)
    seen: dict[str, int] = {}
    features = []
    for row in entry.get("features") or []:
        kind = row.get("type") or "Unknown"
        location = row.get("location") or {}
        start, end = location.get("start") or {}, location.get("end") or {}
        start_value, end_value = start.get("value"), end.get("value")
        base_id = f"uniprot:{_slug(kind)}:{start_value}-{end_value}"
        seen[base_id] = seen.get(base_id, 0) + 1
        feature_id = base_id if seen[base_id] == 1 else f"{base_id}:{seen[base_id]}"

        ligand = None
        raw_ligand = row.get("ligand")
        if raw_ligand and raw_ligand.get("name"):
            ligand_id = (raw_ligand.get("id") or "").removeprefix("ChEBI:") or None
            ligand = FeatureLigand(
                name=raw_ligand["name"],
                id=ligand_id,
                label=raw_ligand.get("label"),
                note=raw_ligand.get("note"),
                url=f"https://www.ebi.ac.uk/chebi/searchId.do?chebiId={ligand_id}" if ligand_id else None,
            )

        alternative = row.get("alternativeSequence") or {}
        original = alternative.get("originalSequence")
        alternatives = list(alternative.get("alternativeSequences") or [])
        variant_id = None
        if (
            kind == "Natural variant"
            and gene_symbol
            and original
            and len(original) == 1
            and len(alternatives) == 1
            and len(alternatives[0]) == 1
            and start_value is not None
            and start_value == end_value
        ):
            substitution = parse_protein_change(f"{original}{start_value}{alternatives[0]}", gene_symbol)
            variant_id = substitution.variant_id if substitution else None

        description = row.get("description") or None
        features.append(
            Feature(
                id=feature_id,
                track=_TRACK_OF_TYPE.get(kind, "other"),
                source=uniprot.id,
                type=kind,
                start=start_value,
                end=end_value,
                start_modifier=start.get("modifier"),
                end_modifier=end.get("modifier"),
                description=description,
                source_feature_id=row.get("featureId"),
                url=f"https://www.uniprot.org/uniprotkb/{accession}/entry#{'sequences' if kind in ('Natural variant', 'Mutagenesis') else 'family_and_domains'}",
                ligand=ligand,
                original=original,
                alternatives=alternatives,
                variant_id=variant_id,
                cross_references=[
                    f"{reference['database']}:{reference['id']}"
                    for reference in row.get("featureCrossReferences") or []
                    if reference.get("database") and reference.get("id")
                ],
                evidence=uniprot_evidence(
                    provenance,
                    accession,
                    row.get("evidences"),
                    predicate="has_feature",
                    evidence_object=EvidenceObject(
                        type=_slug(kind), id=feature_id, label=description or (ligand.name if ligand else kind)
                    ),
                ),
            )
        )
    return features


def _interpro_entries(
    rows: list[dict[str, Any]], accession: str, provenance: Provenance | None
) -> list[InterProEntry]:
    entries = []
    for row in rows:
        evidence = None
        if provenance is not None:
            evidence = try_build_evidence(
                provenance,
                record_type="entry",
                record_id=row["accession"],
                url=interpro.record_url(row["accession"]),
                subject=protein_ref(accession),
                predicate="matches",
                object=EvidenceObject(type=row.get("type") or "entry", id=f"interpro:{row['accession']}", label=row.get("name")),
            )
        entries.append(
            InterProEntry(
                accession=row["accession"],
                name=row.get("name"),
                type=row.get("type"),
                url=interpro.record_url(row["accession"]),
                locations=row.get("locations") or [],
                signatures=row.get("signatures") or [],
                go_terms=row.get("go_terms") or [],
                evidence=evidence,
            )
        )
    return entries


def _interpro_features(entries: list[InterProEntry]) -> list[Feature]:
    features = []
    for entry in entries:
        for index, location in enumerate(entry.locations, start=1):
            features.append(
                Feature(
                    id=f"interpro:{entry.accession}:{location['start']}-{location['end']}:{index}",
                    track=_INTERPRO_TRACK_OF_TYPE.get(entry.type or "", "interpro_other"),
                    source=interpro.id,
                    type=entry.type or "entry",
                    start=location["start"],
                    end=location["end"],
                    description=entry.name,
                    source_feature_id=entry.accession,
                    url=entry.url,
                    signatures=entry.signatures,
                    evidence=[entry.evidence] if entry.evidence else [],
                )
            )
    return features


def _tracks(
    features: list[Feature], layout: list[tuple[str, str, tuple[str, ...]]], source: str, source_name: str
) -> list[FeatureTrack]:
    grouped: dict[str, list[Feature]] = {}
    for feature in features:
        grouped.setdefault(feature.track, []).append(feature)
    tracks = []
    for track_id, label, _ in layout:
        members = grouped.get(track_id)
        if not members:
            continue
        members.sort(key=lambda feature: (feature.start or 0, feature.end or 0))
        tracks.append(
            FeatureTrack(
                id=track_id, label=label, source=source, source_name=source_name, count=len(members), features=members
            )
        )
    return tracks


def _annotations(entry: dict[str, Any], accession: str, provenance: Provenance | None, comment_type: str, predicate: str) -> list[TextAnnotation]:
    return [
        TextAnnotation(
            text=row["value"],
            molecule=row.get("molecule"),
            evidence=uniprot_evidence(
                provenance, accession, row.get("evidences"), predicate=predicate, statement=row["value"]
            ),
        )
        for row in entry_comment_texts(entry, comment_type)
        if row.get("value")
    ]


def _catalytic_activity(entry: dict[str, Any], accession: str, provenance: Provenance | None) -> list[TextAnnotation]:
    rows = []
    for comment in entry.get("comments") or []:
        reaction = comment.get("reaction") if comment.get("commentType") == "CATALYTIC ACTIVITY" else None
        if reaction and reaction.get("name"):
            rows.append(
                TextAnnotation(
                    text=reaction["name"],
                    molecule=comment.get("molecule"),
                    evidence=uniprot_evidence(
                        provenance,
                        accession,
                        reaction.get("evidences"),
                        predicate="catalyses",
                        statement=reaction["name"],
                    ),
                )
            )
    return rows


def _subcellular(entry: dict[str, Any], accession: str, provenance: Provenance | None) -> list[SubcellularLocation]:
    rows = []
    for comment in entry.get("comments") or []:
        if comment.get("commentType") != "SUBCELLULAR LOCATION":
            continue
        for item in comment.get("subcellularLocations") or []:
            location = item.get("location") or {}
            if not location.get("value"):
                continue
            rows.append(
                SubcellularLocation(
                    location=location["value"],
                    location_id=location.get("id"),
                    topology=(item.get("topology") or {}).get("value"),
                    molecule=comment.get("molecule"),
                    evidence=uniprot_evidence(
                        provenance,
                        accession,
                        location.get("evidences"),
                        predicate="located_in",
                        evidence_object=EvidenceObject(
                            type="subcellular_location", id=location.get("id"), label=location["value"]
                        ),
                    ),
                )
            )
    return rows


def _isoforms(entry: dict[str, Any], accession: str) -> list[Isoform]:
    rows = []
    for comment in entry.get("comments") or []:
        if comment.get("commentType") != "ALTERNATIVE PRODUCTS":
            continue
        for item in comment.get("isoforms") or []:
            ids = item.get("isoformIds") or []
            if not ids:
                continue
            status = item.get("isoformSequenceStatus")
            note = " ".join(text["value"] for text in (item.get("note") or {}).get("texts") or [] if text.get("value"))
            rows.append(
                Isoform(
                    id=ids[0],
                    name=(item.get("name") or {}).get("value"),
                    synonyms=[synonym["value"] for synonym in item.get("synonyms") or []],
                    sequence_status=status,
                    is_canonical=status == "Displayed",
                    note=note or None,
                )
            )
    return rows


def _cross_references(entry: dict[str, Any]) -> list[CrossReferenceGroup]:
    grouped: OrderedDict[str, list[CrossReference]] = OrderedDict()
    for row in entry.get("uniProtKBCrossReferences") or []:
        if not row.get("database") or not row.get("id"):
            continue
        grouped.setdefault(row["database"], []).append(
            CrossReference(
                id=row["id"],
                properties={
                    item["key"]: item["value"]
                    for item in row.get("properties") or []
                    if item.get("key") and item.get("value") not in (None, "-")
                },
                isoform_id=row.get("isoformId"),
            )
        )
    return [
        CrossReferenceGroup(database=database, count=len(items), items=items)
        for database, items in grouped.items()
    ]


def _require_entry(accession: str, result: SourceResult[dict[str, Any]]) -> dict[str, Any]:
    if result.is_empty:
        raise NotFound(f"UniProtKB has no entry {accession}.", code="protein_not_found")
    if not result.ok or result.data is None:
        raise SourceUnavailable(uniprot.name, result.message)
    entry = result.data
    if entry.get("entryType") == "Inactive":
        reason = entry.get("inactiveReason") or {}
        targets = ", ".join(reason.get("mergeDemergeTo") or [])
        detail = f"UniProtKB entry {accession} is inactive ({reason.get('inactiveReasonType', 'reason not stated')})."
        if targets:
            detail += f" See {targets}."
        raise NotFound(detail, code="protein_inactive")
    if not (entry.get("sequence") or {}).get("value"):
        raise NotFound(f"UniProtKB entry {accession} has no sequence.", code="protein_not_found")
    return entry


def _build(
    accession: str,
    entry: dict[str, Any],
    provenance: Provenance | None,
    interpro_result: SourceResult[list[dict[str, Any]]],
    catalog: Catalog,
) -> ProteinResponse:
    primary = entry.get("primaryAccession") or accession
    names = entry_names(entry)
    sequence = entry["sequence"]
    symbol = entry_gene_symbol(entry)
    seed_gene = catalog.gene_by_uniprot(primary) or (catalog.gene(symbol) if symbol else None)
    gene = None
    if symbol:
        hgnc = seed_gene.hgnc_id if seed_gene and seed_gene.symbol == symbol else None
        if hgnc is None:
            hgnc = next((row["id"] for row in entry_xrefs(entry, "HGNC")), None)
        gene = EntityRef.of(EntityType.GENE, symbol, label=symbol, curie=hgnc.lower() if hgnc else None)
    gene_names = (entry.get("genes") or [{}])[0]
    audit = entry.get("entryAudit") or {}
    organism = entry.get("organism") or {}

    uniprot_features = _uniprot_features(entry, primary, provenance)
    interpro_rows = interpro_result.data if interpro_result.ok and interpro_result.data else []
    interpro_entries = _interpro_entries(interpro_rows, primary, interpro_result.provenance)

    return ProteinResponse(
        protein=protein_ref(primary, names.recommended),
        accession=primary,
        secondary_accessions=entry.get("secondaryAccessions") or [],
        entry_name=entry.get("uniProtkbId"),
        reviewed="Swiss-Prot" in entry["entryType"] if entry.get("entryType") else None,
        annotation_score=entry.get("annotationScore"),
        protein_existence=entry.get("proteinExistence"),
        entry_version=audit.get("entryVersion"),
        last_annotation_update=audit.get("lastAnnotationUpdateDate"),
        names=names,
        gene=gene,
        gene_synonyms=[synonym["value"] for synonym in gene_names.get("synonyms") or []],
        in_catalog=seed_gene is not None,
        organism=organism.get("scientificName"),
        taxon_id=organism.get("taxonId"),
        sequence=ProteinSequence(
            value=sequence["value"],
            length=len(sequence["value"]),
            mass_da=sequence.get("molWeight"),
            md5=md5_hex(sequence["value"]),
            crc64=sequence.get("crc64"),
            version=audit.get("sequenceVersion"),
        ),
        function=_annotations(entry, primary, provenance, "FUNCTION", "has_function"),
        catalytic_activity=_catalytic_activity(entry, primary, provenance),
        subunit=_annotations(entry, primary, provenance, "SUBUNIT", "has_subunit_structure"),
        family=_annotations(entry, primary, provenance, "SIMILARITY", "member_of"),
        subcellular_locations=_subcellular(entry, primary, provenance),
        isoforms=_isoforms(entry, primary),
        cross_references=_cross_references(entry),
        tracks=_tracks(uniprot_features, UNIPROT_TRACKS, uniprot.id, uniprot.name)
        + _tracks(_interpro_features(interpro_entries), INTERPRO_TRACKS, interpro.id, interpro.name),
        interpro_entries=interpro_entries,
        interpro_family=[item for item in interpro_entries if item.type == "family"],
        provenance=provenance,
        interpro_provenance=interpro_result.provenance,
    )


async def get_protein(accession: str, catalog: Catalog) -> ProteinResponse:
    accession = normalise_accession(accession)
    gathered = await gather_sources(
        {
            "uniprot": SourceCall(uniprot, uniprot.entry(accession), timeout=25),
            "interpro": SourceCall(interpro, interpro.entries(accession), timeout=25),
        }
    )
    uniprot_result, interpro_result = gathered["uniprot"], gathered["interpro"]
    entry = _require_entry(accession, uniprot_result)
    sources: list[SourceStatus] = gathered.sources

    def sha(provenance: Provenance | None) -> str | None:
        return getattr(provenance, "response_sha256", None) if provenance else None

    key = (accession, sha(uniprot_result.provenance), f"{interpro_result.state}:{sha(interpro_result.provenance)}")
    cached = _parsed.get(key)
    if cached is not None and key[1] is not None:
        _parsed.move_to_end(key)
        return cached.model_copy(update={"sources": sources})
    response = _build(accession, entry, uniprot_result.provenance, interpro_result, catalog)
    response.sources = sources
    _parsed[key] = response
    while len(_parsed) > _CACHE_SIZE:
        _parsed.popitem(last=False)
    return response


def _covers(feature: Feature, position: int) -> bool:
    if feature.start is None and feature.end is None:
        return False
    if feature.type in _LINK_TYPES:
        return position in (feature.start, feature.end)
    start = feature.start if feature.start is not None else feature.end
    end = feature.end if feature.end is not None else feature.start
    return start is not None and end is not None and start <= position <= end


async def get_residue(accession: str, position: int, catalog: Catalog) -> ResidueResponse:
    protein = await get_protein(accession, catalog)
    length = protein.sequence.length
    if position < 1 or position > length:
        raise NotFound(
            f"{protein.accession} has {length} residues; position {position} is outside the canonical sequence.",
            code="residue_out_of_range",
        )
    amino_acid = protein.sequence.value[position - 1]
    three, name = AMINO_ACIDS.get(amino_acid, (None, None))
    tracks = []
    for track in protein.tracks:
        covering = [feature for feature in track.features if _covers(feature, position)]
        if covering:
            tracks.append(track.model_copy(update={"features": covering, "count": len(covering)}))
    window_start = max(1, position - RESIDUE_WINDOW)
    return ResidueResponse(
        protein=protein.protein,
        gene=protein.gene,
        position=position,
        sequence_length=length,
        amino_acid=amino_acid,
        amino_acid_three=three,
        amino_acid_name=name,
        window_start=window_start,
        window=protein.sequence.value[window_start - 1 : min(length, position + RESIDUE_WINDOW)],
        feature_count=sum(track.count for track in tracks),
        tracks=tracks,
        interpro_entries=[
            entry
            for entry in protein.interpro_entries
            if any(location["start"] <= position <= location["end"] for location in entry.locations)
        ],
        provenance=protein.provenance,
        sources=protein.sources,
    )


async def get_fasta(accession: str) -> tuple[str, Provenance | None]:
    accession = normalise_accession(accession)
    result = await uniprot.fasta(accession)
    if result.is_empty:
        raise NotFound(f"UniProtKB has no entry {accession}.", code="protein_not_found")
    if not result.ok or not result.data:
        raise SourceUnavailable(uniprot.name, result.message)
    return result.data, result.provenance
