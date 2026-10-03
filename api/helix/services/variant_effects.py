"""Effect evidence at one residue, grouped by what kind of statement each value is.

Four groups, never merged: computational predictions, experimental functional evidence (MaveDB),
curated annotation (UniProt through ProtVar) and predicted pocket / interface membership. Each
value keeps its source's scale and class string; there is no composite score.
"""

import asyncio
from statistics import median
from typing import Any

from helix.errors import BadRequest
from helix.evidence import try_build_evidence
from helix.identifiers import (
    AMINO_ACID_1_TO_3,
    AMINO_ACID_3_TO_1,
    ProteinSubstitution,
    is_uniprot_accession,
)
from helix.knowledge.catalog import get_catalog
from helix.providers.alphamissense_afdb import (
    ISOFORM_NOTE,
    SCALE,
    THRESHOLDS,
    AlphaMissenseAfdbProvider,
)
from helix.providers.base import get_provider
from helix.providers.protvar_effects import PLDDT_FLAG, STABILITY_SCOPE, ProtVarEffectsProvider
from helix.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    EvidenceClass,
    EvidenceObject,
    SourceState,
    SourceStatus,
)
from helix.schemas.variant_effects import (
    EffectFlag,
    EffectGroup,
    EffectMapResponse,
    EffectQuery,
    EffectThreshold,
    EffectValue,
    MaveScoreSet,
    ResidueContext,
    ResidueEffectsResponse,
)
from helix.sources.afdb import MUTATION_CAVEAT, AfdbEntry, afdb
from helix.sources.alphamissense import CLASS_VOCABULARY, CLINICAL_DISCLAIMER
from helix.sources.base import SourceResult
from helix.sources.mavedb import mavedb

MAVE_SCOPE = (
    "MaveDB scores are assay-specific in scale and direction. Many score sets measure stability or abundance "
    "of an isolated domain, which is distinct from function in the full-length protein."
)
NO_COMPOSITE = (
    "Values from different sources are shown in their own scales and are not combined into one score."
)
MAVE_DOI = "10.1186/s13059-025-03476-y"
_STANDARD_RESIDUES = "ACDEFGHIKLMNPQRSTVWY"


def _protein(accession: str) -> tuple[EntityRef, str | None]:
    gene = get_catalog().gene_by_uniprot(accession)
    symbol = gene.symbol if gene else None
    return EntityRef.of(EntityType.PROTEIN, accession, label=symbol, curie=f"uniprot:{accession}"), symbol


def _accession(accession: str) -> str:
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.", code="invalid_accession")
    return accession


def _residue(text: str | None, name: str) -> str | None:
    if text is None or not text.strip():
        return None
    text = text.strip()
    letter = AMINO_ACID_3_TO_1.get(text.capitalize()) if len(text) == 3 else text.upper()
    if letter not in _STANDARD_RESIDUES or len(letter) != 1:
        raise BadRequest(f"{name} must be one of the 20 standard amino acids.", code="invalid_residue")
    return letter


def _providers() -> tuple[ProtVarEffectsProvider, AlphaMissenseAfdbProvider]:
    protvar_provider = get_provider("protvar_effects")
    alphamissense_provider = get_provider("alphamissense_afdb")
    assert isinstance(protvar_provider, ProtVarEffectsProvider)
    assert isinstance(alphamissense_provider, AlphaMissenseAfdbProvider)
    return protvar_provider, alphamissense_provider


def _number(text: str | None) -> float | None:
    try:
        return float(text) if text not in (None, "", "NA") else None
    except ValueError:
        return None


def _calibration(calibrations: list[dict[str, Any]], score: float) -> dict[str, Any]:
    """Class of a score under the set's primary published calibration: the label as published."""
    if not calibrations:
        return {}
    chosen = next((item for item in calibrations if item.get("primary")), calibrations[0])
    title = chosen.get("title") or "MaveDB score calibration"
    thresholds, matched = [], None
    for item in chosen.get("functionalClassifications") or []:
        lower, upper = (item.get("range") or [None, None])[:2]
        thresholds.append(
            EffectThreshold(label=item.get("label") or "", lower=lower, upper=upper, defined_by=title)
        )
        above = lower is None or score > lower or (score == lower and item.get("inclusiveLowerBound", True))
        below = upper is None or score < upper or (score == upper and item.get("inclusiveUpperBound", False))
        if above and below and matched is None:
            matched = item
    return {
        "thresholds": thresholds,
        "source_class": matched.get("label") if matched else None,
        "details": {
            "calibration_title": title,
            "research_use_only": chosen.get("researchUseOnly"),
            "functional_classification": matched.get("functionalClassification") if matched else None,
        },
    }


async def _mave_measurement(
    query: EffectQuery, score_set: dict[str, Any], listing: MaveScoreSet
) -> tuple[EffectValue, SourceResult[Any], bool]:
    urn = score_set["urn"]
    scores, calibrations = await asyncio.gather(mavedb.scores(urn), mavedb.calibrations(urn))
    license_name = score_set.get("license")
    base = {
        "key": f"mavedb.{urn}",
        "label": score_set.get("title") or urn,
        "kind": "functional_assay",
        "scale": "assay-specific score; scale and direction are defined by the score set",
        "tool": score_set.get("short_description"),
        "license": license_name,
        "commercial_use": "allowed" if license_name in ("CC0", "CC BY 4.0", "CC BY-SA 4.0") else "unknown",
        "citation_doi": MAVE_DOI,
        "provenance": scores.provenance,
    }
    has_calibration = bool(calibrations.ok and calibrations.data)
    if not scores.ok or not scores.data:
        state = "not_covered" if scores.is_empty else "unavailable"
        return (
            EffectValue(state=state, message=scores.message or "The score set returned no scores.", **base),
            scores,
            has_calibration,
        )
    assert query.reference and query.alternate and listing.uniprot_start
    target_position = query.position - listing.uniprot_start + 1
    reference3, alternate3 = AMINO_ACID_1_TO_3[query.reference], AMINO_ACID_1_TO_3[query.alternate]
    wanted = f"p.{reference3}{target_position}{alternate3}"
    rows = [
        row for row in scores.data if row.get("hgvs_pro") == wanted and _number(row.get("score")) is not None
    ]
    position_details = {
        "target_hgvs_pro": wanted,
        "target_position": target_position,
        "uniprot_position": query.position,
        "numbering": "hgvs_pro is relative to the assayed target; "
        "located in the UniProt sequence by Helix",
    }
    if not rows:
        return (
            EffectValue(
                state="not_covered",
                message="The score set covers this residue but holds no measurement for this substitution.",
                details=position_details,
                **base,
            ),
            scores,
            has_calibration,
        )
    values = [_number(row["score"]) for row in rows]
    score = values[0] if len(values) == 1 else median(values)
    nonsense = [
        v
        for row in scores.data
        if (row.get("hgvs_pro") or "").endswith("Ter") and (v := _number(row.get("score"))) is not None
    ]
    synonymous = [
        v
        for row in scores.data
        if (row.get("hgvs_pro") or "").endswith("=") and (v := _number(row.get("score"))) is not None
    ]
    calibration = _calibration(calibrations.data, score) if has_calibration else {}
    details = {
        **position_details,
        "measurements": len(rows),
        "columns": {key: value for key, value in rows[0].items() if key not in ("hgvs_nt", "hgvs_splice")},
        "set_nonsense_median": round(median(nonsense), 4) if nonsense else None,
        "set_nonsense_count": len(nonsense),
        "set_synonymous_median": round(median(synonymous), 4) if synonymous else None,
        "set_synonymous_count": len(synonymous),
        **calibration.get("details", {}),
    }
    evidence = (
        try_build_evidence(
            scores.provenance,
            record_type="variant_score",
            record_id=rows[0].get("accession") or urn,
            url=mavedb.record_url(urn),
            subject=query.subject,
            predicate="has_measured_effect",
            object=EvidenceObject(type="mavedb.score", value=score, label=score_set.get("title")),
            strength_value=score,
            citations=[
                Citation(doi=item["identifier"], url=item.get("url"))
                if item.get("database") == "Crossref" or str(item.get("identifier", "")).startswith("10.")
                else Citation(pmid=str(item["identifier"]), url=item.get("url"))
                for item in score_set.get("publications") or []
                if item.get("identifier")
            ],
        )
        if scores.provenance
        else None
    )
    message = (
        None
        if calibration.get("source_class")
        else "No published calibration: the raw score is shown without a functional class."
    )
    if len(rows) > 1:
        message = f"Median of {len(rows)} measurements of this substitution. {message or ''}".strip()
    return (
        EffectValue(
            state="ok",
            value=score,
            source_class=calibration.get("source_class"),
            thresholds=calibration.get("thresholds", []),
            details=details,
            message=message,
            evidence=evidence,
            **base,
        ),
        scores,
        has_calibration,
    )


async def _mave(
    query: EffectQuery, sequence: str | None
) -> tuple[list[EffectValue], list[MaveScoreSet], SourceStatus, str | None]:
    search = await mavedb.score_sets(query.accession)
    status = search.status()
    if not search.ok or not search.data:
        message = (
            "No source found: MaveDB lists no score set for this protein."
            if search.is_empty
            else (search.message or "MaveDB is temporarily unavailable.")
        )
        return [], [], status, message

    listings: list[tuple[dict[str, Any], MaveScoreSet]] = []
    for score_set in search.data:
        for target in score_set["targets"] or [{}]:
            target_sequence = target.get("protein_sequence") or ""
            index = sequence.find(target_sequence) if sequence and target_sequence else -1
            start = index + 1 if index >= 0 else None
            end = index + len(target_sequence) if index >= 0 else None
            declared = next(
                (
                    item["offset"]
                    for item in target.get("declared_offsets", [])
                    if item.get("database") == "UniProt"
                ),
                None,
            )
            listings.append(
                (
                    score_set,
                    MaveScoreSet(
                        urn=score_set["urn"],
                        title=score_set.get("title"),
                        assay=score_set.get("short_description"),
                        url=mavedb.record_url(score_set["urn"]) or "",
                        license=score_set.get("license"),
                        num_variants=score_set.get("num_variants"),
                        published_date=score_set.get("published_date"),
                        publications=score_set.get("publications") or [],
                        target_name=target.get("name"),
                        mapping="located_in_uniprot_sequence" if start else "not_located",
                        uniprot_start=start,
                        uniprot_end=end,
                        declared_offset=declared,
                        covers_residue=bool(start and end and start <= query.position <= end),
                    ),
                )
            )

    covering = [(score_set, listing) for score_set, listing in listings if listing.covers_residue]
    values: list[EffectValue] = []
    if covering and query.alternate and query.reference:
        measured = await asyncio.gather(
            *(_mave_measurement(query, score_set, listing) for score_set, listing in covering)
        )
        for (_, listing), (value, scores, has_calibration) in zip(covering, measured, strict=True):
            listing.has_calibration = has_calibration
            values.append(value)
            if scores.state is SourceState.UNAVAILABLE:
                status = scores.status()

    score_sets = [listing for _, listing in listings]
    if values:
        return values, score_sets, status, None
    if covering:
        return (
            [],
            score_sets,
            status,
            "Assays cover this residue. Give an alternate residue to read the measurement.",
        )
    unlocated = sum(1 for listing in score_sets if listing.mapping == "not_located")
    message = (
        f"No assay covers this residue ({len(score_sets)} MaveDB score sets for this protein "
        "cover other regions)."
    )
    if unlocated:
        message += f" {unlocated} could not be located in the UniProt sequence."
    return [], score_sets, status, message


async def residue_effects(
    accession: str, position: int, alternate: str | None = None, reference: str | None = None
) -> ResidueEffectsResponse:
    accession = _accession(accession)
    alternate = _residue(alternate, "alt")
    stated_reference = _residue(reference, "ref")
    protein, symbol = _protein(accession)

    selection = await afdb.model(accession)
    entry: AfdbEntry | None = selection.data.canonical if selection.data else None
    sequence = entry.sequence if entry else None
    if sequence is not None and not 1 <= position <= len(sequence):
        raise BadRequest(
            f"Position {position} is outside the sequence of {accession} ({len(sequence)} residues).",
            code="position_out_of_range",
        )
    sequence_reference = sequence[position - 1] if sequence else None
    used_reference = sequence_reference or stated_reference
    if alternate and used_reference and alternate == used_reference:
        raise BadRequest(
            f"The alternate residue equals the reference residue ({used_reference}) at position {position}.",
            code="alternate_equals_reference",
        )

    variant_id = hgvs_p = None
    if alternate and used_reference:
        substitution = ProteinSubstitution(used_reference, position, alternate, symbol)
        variant_id, hgvs_p = substitution.variant_id, substitution.hgvs_p
    subject = (
        EntityRef.of(EntityType.VARIANT, variant_id or f"{accession}:{position}:{alternate}")
        if alternate
        else EntityRef.of(EntityType.RESIDUE, f"{accession}:{position}")
    )
    query = EffectQuery(accession, position, used_reference, alternate, subject)

    async def plddt_profile() -> SourceResult[Any] | None:
        return await afdb.plddt(entry) if entry else None

    protvar_provider, alphamissense_provider = _providers()
    protvar_effects, alphamissense_effects, plddt, mave = await asyncio.gather(
        protvar_provider.collect(query),
        alphamissense_provider.collect(query, entry),
        plddt_profile(),
        _mave(query, sequence),
    )
    mave_values, mave_score_sets, mave_status, mave_message = mave

    residue_plddt = None
    if plddt is not None and plddt.ok and plddt.data and position in plddt.data.residue_numbers:
        residue_plddt = plddt.data.scores[plddt.data.residue_numbers.index(position)]

    flags: list[EffectFlag] = []
    if residue_plddt is not None and residue_plddt < 70:
        flags.append(EffectFlag(code="plddt_below_70", message=PLDDT_FLAG))
    mismatches = []
    if stated_reference and sequence_reference and stated_reference != sequence_reference:
        mismatches.append(f"the request states {stated_reference}")
    foldx_reference = protvar_effects.foldx_wild_type
    if foldx_reference and sequence_reference and foldx_reference != sequence_reference:
        mismatches.append(f"the FoldX record has {foldx_reference}")
    if any(flag.code == "reference_residue_mismatch" for flag in alphamissense_effects.value.flags):
        mismatches.append("the AlphaMissense file has a different residue")
    if mismatches:
        flags.append(
            EffectFlag(
                code="reference_residue_mismatch",
                message=f"The sequence has {sequence_reference} at position {position}, but "
                + "; ".join(mismatches)
                + ". Check the isoform and numbering before reading these values.",
            )
        )

    alphamissense_value = alphamissense_effects.value
    protvar_copy = protvar_effects.alphamissense
    if protvar_copy and alphamissense_value.state == "ok" and alternate:
        copy_score = protvar_copy.get("amPathogenicity")
        agrees = (
            isinstance(copy_score, int | float)
            and abs(copy_score - float(alphamissense_value.value)) < 0.0005
        )
        alphamissense_value.details["cross_check"] = {
            "source": "EBI ProtVar",
            "value": copy_score,
            "source_class": protvar_copy.get("amClass"),
            "normalized_class": CLASS_VOCABULARY.get(protvar_copy.get("amClass") or ""),
            "agrees": agrees,
        }

    structural = protvar_effects.structural
    if residue_plddt is not None:
        for value in structural:
            if value.structure is not None:
                value.structure.residue_plddt = residue_plddt
                if residue_plddt < 70:
                    value.flags.append(EffectFlag(code="plddt_below_70", message=PLDDT_FLAG))

    curated_empty = None
    if not protvar_effects.curated:
        curated_empty = (
            "No source found: UniProt lists no feature at this residue."
            if protvar_effects.curated_state in (SourceState.OK, SourceState.EMPTY)
            else (protvar_effects.curated_message or "ProtVar is temporarily unavailable.")
        )

    groups = [
        EffectGroup(
            id="computational_predictions",
            label="Computational predictions",
            evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
            values=[alphamissense_value, *protvar_effects.predictions],
            note=NO_COMPOSITE,
        ),
        EffectGroup(
            id="experimental_functional",
            label="Experimental functional evidence (MAVE)",
            evidence_class=EvidenceClass.EXPERIMENTAL,
            values=mave_values,
            empty_message=mave_message,
            note=MAVE_SCOPE,
        ),
        EffectGroup(
            id="curated_annotation",
            label="Curated database annotation",
            evidence_class=EvidenceClass.CURATED_DATABASE,
            values=protvar_effects.curated,
            empty_message=curated_empty,
            note="UniProt features at this residue. "
            "Each row carries the evidence code UniProt assigns to it.",
        ),
        EffectGroup(
            id="structural_context",
            label="Predicted pocket and interface membership",
            evidence_class=EvidenceClass.COMPUTATIONAL_PREDICTION,
            values=structural,
            note="Computed by ProtVar on AlphaFold models; "
            "a predicted pocket or interface is not an observed one.",
        ),
    ]

    return ResidueEffectsResponse(
        protein=protein,
        position=position,
        reference=used_reference,
        alternate=alternate,
        variant_id=variant_id,
        hgvs_p=hgvs_p,
        residue=ResidueContext(
            reference=sequence_reference,
            plddt=residue_plddt,
            plddt_structure_id=f"afdb:{entry.entry_id}" if entry and residue_plddt is not None else None,
            sequence_length=len(sequence) if sequence else None,
        ),
        flags=flags,
        groups=groups,
        mave_score_sets=mave_score_sets,
        disabled_by_license=protvar_effects.disabled,
        limitations=[NO_COMPOSITE, CLINICAL_DISCLAIMER, MUTATION_CAVEAT, STABILITY_SCOPE, MAVE_SCOPE],
        sources=[selection.status(), *alphamissense_effects.sources, *protvar_effects.sources, mave_status],
    )


async def effect_map(accession: str, include_matrix: bool = False) -> EffectMapResponse:
    accession = _accession(accession)
    protein, _ = _protein(accession)
    _, provider = _providers()
    selection = await afdb.model(accession)
    entry: AfdbEntry | None = selection.data.canonical if selection.data else None
    result = await provider.table(entry)
    table = result.data if result.ok else None

    flags: list[EffectFlag] = []
    matches = None
    if table is not None and entry is not None:
        sequence = entry.sequence
        matches = all(
            position <= len(sequence) and sequence[position - 1] == residue
            for position, residue in table.references.items()
        )
        if not matches:
            flags.append(
                EffectFlag(
                    code="reference_residue_mismatch",
                    message="The AlphaMissense file and the AlphaFold DB sequence disagree at one or more "
                    "positions. "
                    "Check the isoform before reading positions.",
                )
            )
    evidence = (
        try_build_evidence(
            result.provenance,
            record_id=entry.entry_id,
            subject=protein,
            predicate="has_predicted_effect_map",
            object=EvidenceObject(
                type="alphamissense.substitution_file", label=f"{len(table.substitutions)} residues"
            ),
        )
        if table is not None and entry is not None and result.provenance
        else None
    )
    return EffectMapResponse(
        protein=protein,
        structure_id=f"afdb:{entry.entry_id}" if entry else None,
        tool="AlphaMissense",
        scale=SCALE,
        direction="higher_more_damaging",
        class_vocabulary={
            key: value for key, value in CLASS_VOCABULARY.items() if key in ("LBen", "Amb", "LPath")
        },
        thresholds=THRESHOLDS,
        summary_method="Per-residue mean, minimum, maximum and class counts over the substitutions in the "
        "source "
        "file, computed by Helix. The classes are the file's own; none is derived from the mean.",
        sequence_length=len(entry.sequence) if entry else None,
        sequence_matches_model=matches,
        flags=flags,
        residues=provider.residue_summaries(table) if table is not None else [],
        matrix=provider.matrix(table) if table is not None and include_matrix else None,
        license=result.license,
        limitations=[CLINICAL_DISCLAIMER, ISOFORM_NOTE],
        evidence=evidence,
        provenance=result.provenance,
        sources=[selection.status(), result.status()],
    )
