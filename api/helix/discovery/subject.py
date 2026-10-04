"""Subject resolution: a gene symbol, a catalog disease slug or a variant id becomes a subject.

MECHANISM CLASS AND DIRECTION, IN PRECEDENCE ORDER

1. The mechanism field of the catalog disease records in scope (IUIS states it). When every record
   that states one points the same way, that is the class and the direction, and the confidence is
   `stated_in_the_catalog`.
2. Only when no record states one: the words of the IUIS disease label and its aliases. A label that
   says deficiency, defect, absence, aplasia, agammaglobulinemia or a -penia states that the protein
   does too little; a label that says activated, activating or gain of function states that it does
   too much. The confidence is `named_in_the_disease_label`.
3. Anything else, and every conflict inside one tier, is `unknown`. The conflicting records are
   listed in `disagreements` and nothing is ruled out on direction.

A variant's mechanism endpoint is read when a variant was asked for. Its candidate categories can
corroborate a decreased activity (a stability or folding candidate) but never set a direction on
their own, because the endpoint reports what a residue sits in, not which way the activity moves.
"""

import asyncio
import re
from dataclasses import dataclass, field

from helix.discovery.evidence import seed_provenance
from helix.discovery.rules import CLASS_DIRECTION
from helix.errors import BadRequest, NotFound
from helix.evidence import try_build_evidence
from helix.hgvs import parse_variant_query
from helix.knowledge.catalog import Catalog, SeedDisease, SeedGene
from helix.log import get_logger
from helix.schemas.common import EntityRef, EntityType, Evidence, EvidenceObject, SourceStatus
from helix.schemas.discovery import Direction, MechanismClass, Subject, SubjectMechanism

logger = get_logger(__name__)

GENE_SYMBOL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,39}$")
VARIANT_MECHANISM_TIMEOUT = 25.0

KNOWN_CLASSES: tuple[MechanismClass, ...] = (
    "gain_of_function",
    "loss_of_function",
    "dominant_negative",
    "haploinsufficiency",
    "neomorph",
)

# Words of an IUIS disease label that state which way the protein's activity moves.
LESS_ACTIVITY_WORDS = (
    "deficiency",
    "deficient",
    "insufficiency",
    "defect",
    "absence",
    "aplasia",
    "hypoplasia",
    "agammaglobulinemia",
    "agammaglobulinaemia",
    "hypogammaglobulinemia",
    "hypogammaglobulinaemia",
    "loss of function",
    "loss-of-function",
)
MORE_ACTIVITY_WORDS = (
    "activated",
    "activating",
    "gain of function",
    "gain-of-function",
    " gof",
    "constitutively active",
    "hyperactive",
    "overactivity",
)
_PENIA = re.compile(r"\b\w+penia\b", re.I)

# Variant mechanism categories that are consistent with a protein doing too little
LESS_ACTIVITY_CATEGORIES = frozenset({"stability", "folding"})


@dataclass(slots=True)
class ResolvedSubject:
    subject: Subject
    gene: SeedGene | None
    disease: SeedDisease | None
    diseases_in_scope: list[SeedDisease]
    sources: list[SourceStatus] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _gene_ref(gene: SeedGene) -> EntityRef:
    return EntityRef.of(
        EntityType.GENE,
        gene.symbol,
        label=gene.name or gene.symbol,
        curie=(gene.hgnc_id or "").lower() or None,
    )


def _disease_ref(disease: SeedDisease) -> EntityRef:
    curie = disease.xrefs.mondo[0] if disease.xrefs.mondo else None
    return EntityRef.of(
        EntityType.DISEASE, disease.id, label=disease.name, curie=str(curie) if curie else None
    )


def _label_direction(disease: SeedDisease) -> Direction:
    """Which way the IUIS label and its aliases say the activity moves. unknown when unclear."""
    text = " ".join([disease.name, *disease.aliases]).lower()
    less = any(word in text for word in LESS_ACTIVITY_WORDS) or bool(_PENIA.search(text))
    more = any(word in text for word in MORE_ACTIVITY_WORDS)
    if less and not more:
        return "decreased_activity"
    if more and not less:
        return "increased_activity"
    return "unknown"


def _matched_words(disease: SeedDisease) -> list[str]:
    text = " ".join([disease.name, *disease.aliases]).lower()
    found = [word.strip() for word in (*LESS_ACTIVITY_WORDS, *MORE_ACTIVITY_WORDS) if word in text]
    found.extend(match.group(0).lower() for match in _PENIA.finditer(text))
    return sorted(set(found))


def _class_evidence(catalog: Catalog, disease: SeedDisease, statement: str) -> Evidence | None:
    provenance = seed_provenance(catalog, disease.provenance, "iuis")
    if provenance is None:
        return None
    return try_build_evidence(
        provenance,
        record_type="classification",
        subject=_disease_ref(disease),
        predicate="has_mechanism_class",
        object=EvidenceObject(type="mechanism", label=statement),
        statement=statement,
    )


def resolve_mechanism(catalog: Catalog, diseases: list[SeedDisease], gene_symbol: str) -> SubjectMechanism:
    """Mechanism class and direction over the catalog records in scope. Never guesses."""
    stated: dict[MechanismClass, list[SeedDisease]] = {}
    for disease in diseases:
        for value in disease.mechanism:
            key = value.strip().lower()
            if key in KNOWN_CLASSES:
                stated.setdefault(key, []).append(disease)  # type: ignore[arg-type]

    evidence: list[Evidence] = []
    disagreements: list[str] = []

    if stated:
        directions = {CLASS_DIRECTION[key] for key in stated}
        for key, rows in stated.items():
            for disease in rows:
                statement = f"IUIS records the mechanism of {disease.name} as {key.replace('_', ' ')}."
                row = _class_evidence(catalog, disease, statement)
                if row is not None:
                    evidence.append(row)
        if len(directions) > 1:
            readable = ", ".join(
                f"{disease.name} ({key.replace('_', ' ')})"
                for key, rows in stated.items()
                for disease in rows
            )
            disagreements.append(
                f"The catalog records different mechanisms for {gene_symbol}: {readable}. "
                "Ask for one disease to get a direction."
            )
            return SubjectMechanism(
                mechanism_class="unknown",
                direction="unknown",
                confidence="unknown",
                basis="Two catalog records state mechanisms that point in opposite directions, so no "
                "direction is used.",
                disagreements=disagreements,
                evidence=evidence,
            )
        chosen: MechanismClass = sorted(stated, key=lambda key: (-len(stated[key]), key))[0]
        for disease in diseases:
            if not disease.mechanism and _label_direction(disease) not in (
                "unknown",
                CLASS_DIRECTION[chosen],
            ):
                disagreements.append(
                    f"The catalog also lists {disease.name} for {gene_symbol}; it states no "
                    "mechanism and its "
                    "name points the other way."
                )
        names = ", ".join(sorted({disease.name for rows in stated.values() for disease in rows}))
        return SubjectMechanism(
            mechanism_class=chosen,
            direction=CLASS_DIRECTION[chosen],
            confidence="stated_in_the_catalog",
            basis=f"IUIS states the mechanism of {names} as {chosen.replace('_', ' ')}.",
            disagreements=disagreements,
            evidence=evidence,
        )

    directions = {_label_direction(disease) for disease in diseases} - {"unknown"}
    if len(directions) == 1:
        direction = directions.pop()
        chosen = "gain_of_function" if direction == "increased_activity" else "loss_of_function"
        labelled = [disease for disease in diseases if _label_direction(disease) == direction]
        for disease in labelled:
            words = ", ".join(f'"{word}"' for word in _matched_words(disease))
            statement = (
                f"IUIS names this disease {disease.name!r}. The label says {words}, which states that the "
                f"protein does {'too little' if direction == 'decreased_activity' else 'too much'}."
            )
            row = _class_evidence(catalog, disease, statement)
            if row is not None:
                evidence.append(row)
        words = ", ".join(f'"{word}"' for disease in labelled for word in _matched_words(disease))
        return SubjectMechanism(
            mechanism_class=chosen,
            direction=direction,
            confidence="named_in_the_disease_label",
            basis=(
                f"No catalog record states a mechanism class for {gene_symbol}. The IUIS disease label says "
                f"{words}, which states that the protein does "
                f"{'too little' if direction == 'decreased_activity' else 'too much'}."
            ),
            disagreements=disagreements,
            evidence=evidence,
        )
    if len(directions) > 1:
        disagreements.append(
            f"The IUIS labels of the {gene_symbol} diseases point in opposite directions, so no "
            "direction is used."
        )
    return SubjectMechanism(
        mechanism_class="unknown",
        direction="unknown",
        confidence="unknown",
        basis=(
            f"No catalog record states a mechanism class for {gene_symbol} and its disease labels do not say "
            "which way the activity moves."
        ),
        disagreements=disagreements,
        evidence=evidence,
    )


def _find_disease(catalog: Catalog, value: str) -> SeedDisease:
    disease = catalog.disease(value) or catalog.disease(value.lower())
    if disease is None:
        matches = {ref.id for ref in catalog.lookup(value) if ref.type is EntityType.DISEASE}
        if len(matches) == 1:
            disease = catalog.disease(matches.pop())
    if disease is None:
        raise NotFound(f"No disease {value} in the catalog.", code="disease_not_found")
    return disease


async def _corroborate_with_variant(
    variant_id: str, mechanism: SubjectMechanism, catalog: Catalog
) -> list[SourceStatus]:
    """Read the variant's mechanism endpoint and say whether it agrees. It never sets a direction."""
    from helix.db.session import session_scope
    from helix.services.mechanisms import variant_mechanisms

    try:
        async with session_scope() as session:
            response = await asyncio.wait_for(
                variant_mechanisms(variant_id, catalog, session, None), VARIANT_MECHANISM_TIMEOUT
            )
    except Exception as error:  # noqa: BLE001 - a missing corroboration never fails the request
        logger.info("Variant mechanisms for %s were not read: %s", variant_id, error)
        mechanism.disagreements.append(
            "The variant's mechanism candidates could not be read, so they neither support nor "
            "contradict the direction."
        )
        return []
    categories = {candidate.category for candidate in response.candidates}
    consistent = sorted(categories & LESS_ACTIVITY_CATEGORIES)
    if consistent and mechanism.direction == "decreased_activity":
        mechanism.basis += (
            f" The variant's own mechanism candidates ({', '.join(consistent)}) are consistent with the "
            "protein doing too little."
        )
    elif consistent and mechanism.direction == "increased_activity":
        mechanism.disagreements.append(
            f"The variant's mechanism candidates ({', '.join(consistent)}) would fit a protein that does too "
            "little, while the disease record states that it does too much. The disease record is used."
        )
    elif mechanism.direction == "unknown" and consistent:
        mechanism.disagreements.append(
            f"The variant's mechanism candidates ({', '.join(consistent)}) would fit a protein that does too "
            "little, but a residue candidate does not state which way the activity moves, so the direction "
            "stays unknown."
        )
    return response.sources


async def resolve_subject(
    catalog: Catalog,
    *,
    gene: str | None,
    disease: str | None,
    variant: str | None,
) -> ResolvedSubject:
    """Resolve the subject from whichever of gene, disease or variant was given."""
    if not any((gene, disease, variant)):
        raise BadRequest(
            "Ask for a gene, a disease or a variant: gene=PIK3CD, "
            "disease=activated-p110-delta-syndrome-pik3cd "
            "or variant=BTK-p.Arg28His.",
            code="subject_required",
        )
    seed_disease: SeedDisease | None = None
    variant_ref: EntityRef | None = None
    symbol: str | None = None

    if variant:
        query = parse_variant_query(variant)
        if query is None or not query.gene_symbol:
            raise BadRequest(
                f"{variant!r} is not a variant identifier Helix can read. Use GENE-p.Arg28His.",
                code="variant_id_not_recognised",
            )
        symbol = query.gene_symbol
        variant_ref = EntityRef.of(EntityType.VARIANT, variant, label=variant)
    if disease:
        seed_disease = _find_disease(catalog, disease)
        if seed_disease.gene_symbol is None:
            raise BadRequest(
                f"The catalog names no gene for {seed_disease.name}, so no protein can be aimed at.",
                code="disease_without_gene",
            )
        if symbol and symbol.upper() != seed_disease.gene_symbol.upper():
            raise BadRequest(
                f"{variant} is a variant of {symbol}, but {seed_disease.name} is a disease of "
                f"{seed_disease.gene_symbol}.",
                code="subject_mismatch",
            )
        symbol = seed_disease.gene_symbol
    if gene:
        if not GENE_SYMBOL_RE.match(gene.strip()):
            raise BadRequest(f"{gene!r} is not a gene symbol.", code="invalid_gene_symbol")
        if symbol and symbol.upper() != gene.strip().upper():
            raise BadRequest(
                f"gene={gene} does not match the gene of the disease or variant asked for ({symbol}).",
                code="subject_mismatch",
            )
        symbol = gene.strip()

    assert symbol is not None
    seed_gene = catalog.gene(symbol)
    if seed_gene is None:
        raise NotFound(
            f"No gene {symbol} in the Helix catalog. The discovery engine reads the catalog's mechanism "
            "records, so it works on catalog genes.",
            code="gene_not_in_catalog",
        )
    diseases = [seed_disease] if seed_disease else catalog.diseases_for_gene(seed_gene.symbol)
    mechanism = resolve_mechanism(catalog, diseases, seed_gene.symbol)

    sources: list[SourceStatus] = []
    if variant:
        sources = await _corroborate_with_variant(variant, mechanism, catalog)

    accession = seed_gene.uniprot_accession
    subject = Subject(
        gene_symbol=seed_gene.symbol,
        accession=accession,
        gene=_gene_ref(seed_gene),
        protein=(
            EntityRef.of(
                EntityType.PROTEIN, accession, label=seed_gene.protein_name, curie=f"uniprot:{accession}"
            )
            if accession
            else None
        ),
        disease=_disease_ref(seed_disease) if seed_disease else None,
        variant=variant_ref,
        mechanism=mechanism,
    )
    notes: list[str] = []
    if seed_disease is None and len(diseases) > 1:
        notes.append(
            f"The catalog lists {len(diseases)} diseases for {seed_gene.symbol}. Ask for one of "
            "them to get a "
            "mechanism and a direction for that disease."
        )
    if accession is None:
        notes.append(f"The catalog gives no protein for {seed_gene.symbol}, so no target can be aimed at.")
    return ResolvedSubject(
        subject=subject,
        gene=seed_gene,
        disease=seed_disease,
        diseases_in_scope=diseases,
        sources=sources,
        notes=notes,
    )
