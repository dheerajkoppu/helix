"""Evidence classification and construction.

classify_evidence is a pure function of (database, record type, ECO code). It implements the
mapping tables in docs/research/provenance-reproducibility.md section 2.4 and
docs/research/ux-research.md section 7.3, and it fails closed: an input with no rule raises
UnmappedEvidence, so nothing reaches the interface under a guessed class.

Where the two tables disagree, the UX table's explicit per-ECO rows win over the provenance table's
"any other ECO" catch-all, and the provenance table wins for Open Targets `orphanet`
(clinical_database, the same class as Orphadata itself).

No cross-source score exists anywhere in this module. Ranks order values inside one scheme only.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from orphafold import __version__
from orphafold.config import API_PREFIX
from orphafold.hashing import canonical_sha256
from orphafold.ids import HYPOTHESIS_PREFIX, new_id, utcnow
from orphafold.log import get_logger
from orphafold.schemas.common import (
    SYSTEM_ACTOR,
    ActorRef,
    Authoring,
    Citation,
    EcoRef,
    EntityRef,
    Evidence,
    EvidenceClass,
    EvidenceDirection,
    EvidenceObject,
    EvidenceStrength,
    Provenance,
    SourceRecord,
    StructureOrigin,
)

logger = get_logger(__name__)

ORPHAFOLD_DATABASE = "orphafold"

ECO_LABELS: dict[str, str] = {
    "ECO:0000006": "experimental evidence",
    "ECO:0000180": "clinical study evidence",
    "ECO:0000250": "sequence similarity evidence used in manual assertion",
    "ECO:0000255": "match to sequence model evidence used in manual assertion",
    "ECO:0000256": "match to sequence model evidence used in automatic assertion",
    "ECO:0000269": "experimental evidence used in manual assertion",
    "ECO:0000303": "author statement without traceable support used in manual assertion",
    "ECO:0000304": "author statement supported by traceable reference used in manual assertion",
    "ECO:0000305": "curator inference used in manual assertion",
    "ECO:0000313": "imported information used in automatic assertion",
    "ECO:0000314": "direct assay evidence used in manual assertion",
    "ECO:0000315": "mutant phenotype evidence used in manual assertion",
    "ECO:0000322": "imported manually asserted information used in automatic assertion",
    "ECO:0000323": "imported automatically asserted information used in automatic assertion",
    "ECO:0000353": "physical interaction evidence used in manual assertion",
    "ECO:0001823": "x-ray crystallography evidence",
    "ECO:0005031": "structure determination evidence",
    "ECO:0006163": "nuclear magnetic resonance spectroscopy evidence",
    "ECO:0006181": "cryogenic electron microscopy evidence",
    "ECO:0007669": "computational evidence used in automatic assertion",
    "ECO:0007744": "combinatorial computational and experimental evidence used in manual assertion",
    "ECO:0007829": "combinatorial computational and experimental evidence used in automatic assertion",
    "ECO:0008006": "deep learning neural network method evidence used in automatic assertion",
}

_EXP = EvidenceClass.EXPERIMENTAL
_CLIN = EvidenceClass.CLINICAL_DATABASE
_LIT = EvidenceClass.LITERATURE
_CUR = EvidenceClass.CURATED_DATABASE
_PRED = EvidenceClass.COMPUTATIONAL_PREDICTION
_HYP = EvidenceClass.ORPHAFOLD_HYPOTHESIS

# UniProt carries an ECO code per annotation. Explicit rows first; any other code is curated.
_UNIPROT_ECO: dict[str, tuple[EvidenceClass, tuple[str, ...]]] = {
    "ECO:0000269": (_EXP, ()),
    "ECO:0000314": (_EXP, ()),
    "ECO:0000315": (_EXP, ()),
    "ECO:0000353": (_EXP, ()),
    "ECO:0007744": (_EXP, ()),
    "ECO:0007829": (_EXP, ("auto",)),
    "ECO:0000303": (_LIT, ()),
    "ECO:0000304": (_LIT, ()),
    "ECO:0000305": (_CUR, ("manual",)),
    "ECO:0000250": (_CUR, ("by similarity",)),
    "ECO:0000312": (_CUR, ("manual",)),
    "ECO:0000313": (_CUR, ("auto",)),
    "ECO:0000255": (_PRED, ("curator-verified",)),
    "ECO:0000256": (_PRED, ("auto",)),
    "ECO:0000259": (_PRED, ("auto",)),
    "ECO:0008006": (_PRED, ("auto",)),
}

_UNIPROT_ECO_RANK: dict[str, int] = {
    "ECO:0000269": 3,
    "ECO:0007744": 2,
    "ECO:0000314": 1,
    "ECO:0000315": 1,
    "ECO:0000353": 1,
    "ECO:0000250": 1,
    "ECO:0000255": 1,
    "ECO:0000303": 1,
    "ECO:0000304": 1,
    "ECO:0000305": 1,
    "ECO:0000312": 1,
    "ECO:0007829": 0,
    "ECO:0000256": 0,
    "ECO:0000259": 0,
    "ECO:0000313": 0,
    "ECO:0008006": 0,
}

_RCSB_METHOD_ECO: dict[str, str] = {
    "X-RAY DIFFRACTION": "ECO:0001823",
    "ELECTRON MICROSCOPY": "ECO:0006181",
    "SOLUTION NMR": "ECO:0006163",
    "SOLID-STATE NMR": "ECO:0006163",
}

CLINVAR_REVIEW_STARS: dict[str, int] = {
    "practice guideline": 4,
    "reviewed by expert panel": 3,
    "criteria provided, multiple submitters, no conflicts": 2,
    "criteria provided, multiple submitters": 2,
    "criteria provided, conflicting classifications": 1,
    "criteria provided, single submitter": 1,
    "no assertion criteria provided": 0,
    "no classification provided": 0,
    "no classification for the individual variant": 0,
}

CLINGEN_VALIDITY_RANK: dict[str, int] = {
    "definitive": 4,
    "strong": 3,
    "moderate": 2,
    "limited": 1,
    "no known disease relationship": 0,
}
_CLINGEN_DISPUTING = frozenset({"disputed", "refuted"})

# Numeric schemes carry no rank: the number is shown with its unit and source.
NUMERIC_SCHEMES: dict[str, str | None] = {
    "open_targets_score": None,
    "plddt": None,
    "boltz_confidence": None,
    "string_score": None,
    "pchembl": None,
    "pdb_resolution": "Å",
    "alphamissense": None,
    "chembl_assay_confidence": None,
}


class UnmappedEvidence(ValueError):
    """No rule maps this (database, record type, ECO) to an evidence class."""

    def __init__(self, database: str, record_type: str | None, eco: str | None) -> None:
        super().__init__(
            f"no evidence mapping for database={database!r} record_type={record_type!r} eco={eco!r}"
        )
        self.database = database
        self.record_type = record_type
        self.eco = eco


@dataclass(frozen=True, slots=True)
class EvidenceRule:
    """One row of the mapping table. record_type None matches every record of the database."""

    database: str
    record_type: str | None
    evidence_class: EvidenceClass
    eco: str | None = None
    scheme: str | None = None
    modifiers: tuple[str, ...] = ()
    structure_origin: StructureOrigin | None = None


@dataclass(frozen=True, slots=True)
class EvidenceClassification:
    evidence_class: EvidenceClass
    eco: EcoRef | None
    scheme: str | None
    modifiers: tuple[str, ...] = ()
    structure_origin: StructureOrigin | None = None


def _rule(
    database: str,
    record_type: str | None,
    evidence_class: EvidenceClass,
    eco: str | None = None,
    scheme: str | None = None,
    modifiers: tuple[str, ...] = (),
    structure_origin: StructureOrigin | None = None,
) -> EvidenceRule:
    return EvidenceRule(database, record_type, evidence_class, eco, scheme, modifiers, structure_origin)


_EXTERNAL = StructureOrigin.PREDICTED_EXTERNAL
_OWN = StructureOrigin.PREDICTED_ORPHAFOLD

_BUILTIN_RULES: tuple[EvidenceRule, ...] = (
    # Experimental
    _rule("rcsb_pdb", "entry", _EXP, "ECO:0005031", "pdb_resolution"),
    _rule("pdbe", "entry", _EXP, "ECO:0005031", "pdb_resolution"),
    _rule("three_d_beacons", "experimentally_determined", _EXP, "ECO:0005031"),
    _rule("chembl", "activity", _EXP, "ECO:0000006", "pchembl"),
    _rule("pubchem", "bioassay", _EXP, "ECO:0000006"),
    _rule("string", "escore", _EXP, "ECO:0000006", "string_score"),
    _rule("open_targets", "impc", _EXP, "ECO:0000006", "open_targets_score"),
    # Clinical databases
    _rule("clinvar", None, _CLIN, "ECO:0000322", "clinvar_review_status"),
    _rule("clingen", "gene_validity", _CLIN, "ECO:0000322", "clingen_gene_validity"),
    _rule("clingen", "variant_interpretation", _CLIN, "ECO:0000322", "acmg_criteria"),
    _rule("orphadata", None, _CLIN, "ECO:0000322"),
    _rule("hpo", "disease_phenotype", _CLIN, "ECO:0000322"),
    _rule("omim", "xref", _CLIN, "ECO:0000322"),
    _rule("open_targets", "eva", _CLIN, "ECO:0000322", "open_targets_score"),
    _rule("open_targets", "clingen", _CLIN, "ECO:0000322", "open_targets_score"),
    _rule("open_targets", "genomics_england", _CLIN, "ECO:0000322", "open_targets_score"),
    _rule("open_targets", "orphanet", _CLIN, "ECO:0000322", "open_targets_score"),
    # Literature
    _rule("pubmed", "article", _LIT),
    _rule("europepmc", "article", _LIT),
    _rule("pubmed", "citation", _LIT, "ECO:0000304"),
    _rule("europepmc", "citation", _LIT, "ECO:0000304"),
    _rule("doi", "citation", _LIT, "ECO:0000304"),
    _rule("europepmc", "text_mined", _LIT, "ECO:0000323", None, ("text_mining",)),
    _rule("iuis", None, _LIT, "ECO:0000322"),
    _rule("open_targets", "europepmc", _LIT, "ECO:0000323", "open_targets_score", ("text_mining",)),
    _rule("string", "tscore", _LIT, "ECO:0000323", "string_score", ("text_mining",)),
    # Curated databases
    _rule("uniprot", "feature_without_evidence", _CUR, "ECO:0000322", None, ("no evidence code",)),
    _rule("uniprot", "entry", _CUR, "ECO:0000322"),
    _rule("reactome", None, _CUR, "ECO:0000322"),
    _rule("mondo", None, _CUR, "ECO:0000322"),
    _rule("ordo", None, _CUR, "ECO:0000322"),
    _rule("hpo", "term", _CUR, "ECO:0000322"),
    _rule("hgnc", None, _CUR, "ECO:0000322"),
    _rule("ensembl", "gene", _CUR, "ECO:0000322"),
    _rule("ensembl", "transcript", _CUR, "ECO:0000322"),
    _rule("ensembl", "mane", _CUR, "ECO:0000322"),
    _rule("chembl", "mechanism", _CUR, "ECO:0000322"),
    _rule("chembl", "indication", _CUR, "ECO:0000322"),
    _rule("string", "dscore", _CUR, "ECO:0000322", "string_score"),
    _rule("gnomad", None, _CUR, "ECO:0000322", None, ("population",)),
    _rule("open_targets", "uniprot_variants", _CUR, "ECO:0000322", "open_targets_score"),
    _rule("open_targets", "uniprot_literature", _CUR, "ECO:0000322", "open_targets_score"),
    # Computational predictions made by third parties
    _rule("afdb", "model", _PRED, "ECO:0008006", "plddt", (), _EXTERNAL),
    _rule("afdb", "pae", _PRED, "ECO:0008006", None, (), _EXTERNAL),
    _rule("afdb", "alphamissense", _PRED, "ECO:0008006", "alphamissense"),
    _rule("alphamissense", None, _PRED, "ECO:0008006", "alphamissense"),
    _rule("three_d_beacons", "template_based", _PRED, "ECO:0007669", None, (), _EXTERNAL),
    _rule("three_d_beacons", "ab_initio", _PRED, "ECO:0007669", None, (), _EXTERNAL),
    _rule("ensembl", "vep", _PRED, "ECO:0007669", "vep_impact"),
    _rule("string", "nscore", _PRED, "ECO:0007669", "string_score"),
    _rule("string", "fscore", _PRED, "ECO:0007669", "string_score"),
    _rule("string", "pscore", _PRED, "ECO:0007669", "string_score"),
    _rule("string", "ascore", _PRED, "ECO:0007669", "string_score"),
    _rule("protvar", "foldx", _PRED, "ECO:0007669"),
    _rule("protvar", "conservation", _PRED, "ECO:0007669"),
    _rule("protvar", "eve", _PRED, "ECO:0007669"),
    # OrphaFold run output
    _rule(ORPHAFOLD_DATABASE, "structure_prediction", _PRED, "ECO:0008006", None, (), _OWN),
    _rule(ORPHAFOLD_DATABASE, "complex_prediction", _PRED, "ECO:0008006", None, (), _OWN),
    _rule(ORPHAFOLD_DATABASE, "affinity_prediction", _PRED, "ECO:0008006"),
    _rule(ORPHAFOLD_DATABASE, "variant_effect", _PRED, "ECO:0007669"),
    _rule(ORPHAFOLD_DATABASE, "pocket_detection", _PRED, "ECO:0007669"),
    _rule(ORPHAFOLD_DATABASE, "docking", _PRED, "ECO:0007669"),
    _rule(ORPHAFOLD_DATABASE, "structure_comparison", _PRED, "ECO:0007669"),
    # Statements authored in OrphaFold
    _rule(ORPHAFOLD_DATABASE, "hypothesis", _HYP),
)

_rules: dict[tuple[str, str | None], EvidenceRule] = {
    (rule.database, rule.record_type): rule for rule in _BUILTIN_RULES
}


def _normalise(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def register_evidence_rule(rule: EvidenceRule) -> EvidenceRule:
    """Add a mapping row for a source the built-in table does not cover. Call it at module level in
    the source adapter module. A row that contradicts an existing one is rejected."""
    key = (_normalise(rule.database) or "", _normalise(rule.record_type))
    existing = _rules.get(key)
    if existing is not None and existing != rule:
        raise ValueError(f"evidence rule for {key} already exists with a different mapping")
    _rules[key] = rule
    return rule


def evidence_rules() -> list[EvidenceRule]:
    return list(_rules.values())


def _eco_ref(code: str | None, assigned_by: str) -> EcoRef | None:
    if code is None:
        return None
    return EcoRef(id=code, label=ECO_LABELS.get(code), assigned_by=assigned_by)  # type: ignore[arg-type]


def classify_evidence(
    database: str,
    record_type: str | None = None,
    eco: str | None = None,
) -> EvidenceClassification:
    """Map a source record to its evidence class. Raises UnmappedEvidence when no rule applies.

    database: source adapter ID (uniprot, clinvar, rcsb_pdb, afdb, open_targets, string, orphafold).
    record_type: record kind inside that database (Open Targets datasource ID, STRING channel,
        RCSB 'entry', OrphaFold job kind). For RCSB entries pass the experimental method as eco=None
        and use rcsb_method_eco for the ECO code.
    eco: ECO code supplied by the source itself (UniProt). It is kept as assigned by the source.
    """
    database_key = _normalise(database) or ""
    record_key = _normalise(record_type)

    if database_key == "uniprot" and eco is not None:
        if eco in _UNIPROT_ECO:
            evidence_class, modifiers = _UNIPROT_ECO[eco]
        elif eco.startswith("ECO:") and eco[4:].isdigit() and len(eco) == 11:
            evidence_class, modifiers = _CUR, ()
        else:
            raise UnmappedEvidence(database, record_type, eco)
        return EvidenceClassification(evidence_class, _eco_ref(eco, "source"), "uniprot_eco", modifiers)

    rule = _rules.get((database_key, record_key)) or _rules.get((database_key, None))
    if rule is None:
        raise UnmappedEvidence(database, record_type, eco)
    code = eco or rule.eco
    return EvidenceClassification(
        rule.evidence_class,
        _eco_ref(code, "source" if eco else "orphafold_mapping"),
        rule.scheme,
        rule.modifiers,
        rule.structure_origin,
    )


def rcsb_method_eco(method: str | None) -> str:
    """ECO code for an RCSB experimental method (exptl[].method)."""
    return _RCSB_METHOD_ECO.get((method or "").strip().upper(), "ECO:0005031")


def clinvar_stars(review_status: str | None) -> int | None:
    """Stars 0-4 for a ClinVar review status string. None for a string outside the published table."""
    if review_status is None:
        return None
    return CLINVAR_REVIEW_STARS.get(review_status.strip().lower())


def strength_for(
    scheme: str | None,
    value: str | float | int | None,
    *,
    unit: str | None = None,
    criteria: Sequence[str] = (),
) -> EvidenceStrength | None:
    """Source-native strength. Ranks exist only for the ordinal schemes and never cross schemes."""
    if scheme is None:
        return None
    rank: int | None = None
    max_rank: int | None = None
    if scheme == "clinvar_review_status" and isinstance(value, str):
        rank, max_rank = clinvar_stars(value), 4
    elif scheme == "clingen_gene_validity" and isinstance(value, str):
        rank, max_rank = CLINGEN_VALIDITY_RANK.get(value.strip().lower()), 4
    elif scheme == "uniprot_eco" and isinstance(value, str):
        rank, max_rank = _UNIPROT_ECO_RANK.get(value), 3
    return EvidenceStrength(
        scheme=scheme,
        value=value,
        unit=unit if unit is not None else NUMERIC_SCHEMES.get(scheme),
        rank=rank,
        max_rank=max_rank,
        criteria=list(criteria),
    )


def clingen_direction(classification: str | None) -> EvidenceDirection:
    """Disputed and Refuted gene-disease classifications dispute the relationship."""
    if classification and classification.strip().lower() in _CLINGEN_DISPUTING:
        return EvidenceDirection.DISPUTES
    return EvidenceDirection.SUPPORTS


def source_record(
    provenance: Provenance,
    *,
    record_id: str | None = None,
    record_version: str | None = None,
    url: str | None = None,
    database: str | None = None,
) -> SourceRecord:
    """Source record of an Evidence row, from the provenance envelope of an adapter call."""
    resolved_id = record_id or provenance.record_id
    if not resolved_id:
        raise ValueError("an evidence source needs a record ID")
    return SourceRecord(
        database=database or provenance.source,
        record_id=resolved_id,
        record_version=record_version,
        release=provenance.release,
        license=provenance.license,
        url=url or provenance.record_url,
        retrieved_at=provenance.retrieved_at,
        request=f"{provenance.method} {provenance.request_url}",
        response_sha256=provenance.response_sha256,
    )


def evidence_id(
    evidence_class: EvidenceClass,
    source: SourceRecord,
    subject: EntityRef | None,
    predicate: str | None,
    evidence_object: EvidenceObject | None,
    statement: str | None,
) -> str:
    """Deterministic ID: the same source record making the same claim always gets the same ID."""
    identity = {
        "class": evidence_class.value,
        "database": source.database,
        "record_id": source.record_id,
        "record_version": source.record_version,
        "release": source.release,
        "subject": [subject.type.value, subject.id] if subject else None,
        "predicate": predicate,
        "object": evidence_object.model_dump(mode="json") if evidence_object else None,
        "statement": statement,
    }
    return "ev_" + canonical_sha256(identity)[:26]


def build_evidence(
    provenance: Provenance,
    *,
    record_type: str | None = None,
    record_id: str | None = None,
    record_version: str | None = None,
    url: str | None = None,
    database: str | None = None,
    eco: str | None = None,
    subject: EntityRef | None = None,
    predicate: str | None = None,
    object: EvidenceObject | None = None,
    statement: str | None = None,
    strength_value: str | float | int | None = None,
    strength_unit: str | None = None,
    strength_scheme: str | None = None,
    criteria: Sequence[str] = (),
    direction: EvidenceDirection = EvidenceDirection.SUPPORTS,
    citations: Sequence[Citation] = (),
    modifiers: Sequence[str] = (),
    asserted_at: str | None = None,
) -> Evidence:
    """Evidence row for a record fetched through a source adapter. Raises UnmappedEvidence when the
    (database, record type, ECO) has no rule."""
    record = source_record(
        provenance, record_id=record_id, record_version=record_version, url=url, database=database
    )
    classification = classify_evidence(record.database, record_type, eco)
    scheme = strength_scheme or classification.scheme
    if scheme == "uniprot_eco" and strength_value is None:
        strength_value = eco
    strength = None
    if strength_value is not None or criteria:
        strength = strength_for(scheme, strength_value, unit=strength_unit, criteria=criteria)
    return Evidence(
        id=evidence_id(classification.evidence_class, record, subject, predicate, object, statement),
        evidence_class=classification.evidence_class,
        subject=subject,
        predicate=predicate,
        object=object,
        statement=statement,
        direction=direction,
        eco=classification.eco,
        strength=strength,
        source=record,
        modifiers=[*classification.modifiers, *modifiers],
        citations=list(citations),
        asserted_at=asserted_at,
        structure_origin=classification.structure_origin,
    )


def try_build_evidence(provenance: Provenance, **fields: Any) -> Evidence | None:
    """build_evidence that returns None for an unmapped source, so the claim is left out instead of
    being shown under a guessed class. The gap is logged for a rule to be added."""
    try:
        return build_evidence(provenance, **fields)
    except UnmappedEvidence as error:
        logger.warning("Evidence left out: %s", error)
        return None


def build_job_evidence(
    job_id: str,
    job_kind: str,
    *,
    completed_at: datetime | None = None,
    subject: EntityRef | None = None,
    predicate: str | None = None,
    object: EvidenceObject | None = None,
    statement: str | None = None,
    strength_scheme: str | None = None,
    strength_value: str | float | int | None = None,
    strength_unit: str | None = None,
    modifiers: Sequence[str] = (),
    derived_from: Sequence[str] = (),
) -> Evidence:
    """Evidence row for the output of an OrphaFold job. The source record is the run manifest."""
    classification = classify_evidence(ORPHAFOLD_DATABASE, job_kind)
    record = SourceRecord(
        database=ORPHAFOLD_DATABASE,
        record_id=job_id,
        release=__version__,
        url=f"{API_PREFIX}/jobs/{job_id}/manifest",
        retrieved_at=completed_at or utcnow(),
    )
    scheme = strength_scheme or classification.scheme
    return Evidence(
        id=evidence_id(classification.evidence_class, record, subject, predicate, object, statement),
        evidence_class=classification.evidence_class,
        subject=subject,
        predicate=predicate,
        object=object,
        statement=statement,
        eco=classification.eco,
        strength=strength_for(scheme, strength_value, unit=strength_unit)
        if strength_value is not None
        else None,
        source=record,
        modifiers=[f"origin orphafold:{job_id}", *modifiers],
        structure_origin=classification.structure_origin,
        generated_by=job_id,
        derived_from=list(derived_from),
    )


def build_hypothesis(
    statement: str,
    *,
    derived_from: Sequence[str],
    created_by: ActorRef = SYSTEM_ACTOR,
    authoring: Authoring,
    subject: EntityRef | None = None,
    predicate: str | None = None,
    object: EvidenceObject | None = None,
    direction: EvidenceDirection = EvidenceDirection.SUPPORTS,
    hypothesis_id: str | None = None,
) -> Evidence:
    """A statement authored in OrphaFold. It must rest on at least one evidence or job ID and never
    carries a source, an ECO code or a strength."""
    return Evidence(
        id=hypothesis_id or new_id(HYPOTHESIS_PREFIX),
        evidence_class=_HYP,
        subject=subject,
        predicate=predicate,
        object=object,
        statement=statement,
        direction=direction,
        derived_from=list(derived_from),
        created_by=created_by,
        authoring=authoring,
    )
