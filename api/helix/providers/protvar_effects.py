"""ProtVar retrieval provider: third-party predictions and UniProt annotation at one residue.

Every value keeps the source's scale and class string. Thresholds are ProtVar's own display bins
(docs/research/variant-effect.md section 3.1) and are attached for reading, never applied here.
"""

from dataclasses import dataclass, field
from typing import Any

from helix.config import get_settings
from helix.evidence import try_build_evidence
from helix.providers.base import (
    Availability,
    Capability,
    ExecutionMode,
    RunContext,
    VariantEffectProvider,
    VariantEffectRequest,
    VariantEffectResult,
    VariantEffectScore,
    register_provider,
)
from helix.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    Evidence,
    EvidenceObject,
    SourceState,
    SourceStatus,
    StructureOrigin,
)
from helix.schemas.variant_effects import (
    EffectFlag,
    EffectQuery,
    EffectStructureBasis,
    EffectThreshold,
    EffectValue,
)
from helix.sources import SourceCall, gather_sources
from helix.sources.base import SourceResult
from helix.sources.protvar import protvar

PROTVAR_DOI = "10.1093/nar/gkae413"
_UI = "ProtVar display bins"
_README = "ProtVar FTP README"

FOLDX_THRESHOLDS = [
    EffectThreshold(label="likely to be destabilising", lower=2.0, defined_by=_UI),
    EffectThreshold(label="unlikely to be destabilising", upper=2.0, defined_by=_UI),
]
POPEVE_THRESHOLDS = [
    EffectThreshold(label="severe", upper=-5.056, defined_by=_UI),
    EffectThreshold(label="moderately deleterious", lower=-5.056, upper=-4.617, defined_by=_UI),
    EffectThreshold(label="unlikely deleterious", lower=-4.617, defined_by=_UI),
]
ESM_THRESHOLDS = [
    EffectThreshold(label="likely benign", lower=-5.0, upper=0.0, defined_by=_UI),
    EffectThreshold(label="uncertain", lower=-10.0, upper=-5.0, defined_by=_UI),
    EffectThreshold(label="likely pathogenic", lower=-25.0, upper=-10.0, defined_by=_UI),
]
CADD_THRESHOLDS = [
    EffectThreshold(label="likely benign", upper=15.0, defined_by=_UI),
    EffectThreshold(label="potentially deleterious", lower=15.0, upper=19.9, defined_by=_UI),
    EffectThreshold(label="quite likely deleterious", lower=20.0, upper=24.9, defined_by=_UI),
    EffectThreshold(label="probably deleterious", lower=25.0, upper=29.9, defined_by=_UI),
    EffectThreshold(label="highly likely deleterious", lower=29.9, defined_by=_UI),
]
POCKET_THRESHOLDS = [
    EffectThreshold(label="high confidence", lower=800.0, defined_by=_README),
    EffectThreshold(label="very high confidence", lower=900.0, defined_by=_README),
]
INTERFACE_THRESHOLDS = [EffectThreshold(label="high-confidence set", lower=0.23, defined_by=_README)]

PLDDT_FLAG = "pLDDT at this residue is below 70: the AlphaFold model is low-confidence here."
GAP_FLAG = "Gap frequency above 0.5: the alignment column is mostly gaps (ProtVar marks this low confidence)."
NONCOMMERCIAL = (
    "Restricted to non-commercial use. Set HELIX_ENABLE_NONCOMMERCIAL_SOURCES=true to enable it."
)
STABILITY_SCOPE = (
    "A stability prediction says nothing about variants that act through binding, catalysis or regulation."
)


@dataclass(slots=True)
class ProtVarEffects:
    predictions: list[EffectValue] = field(default_factory=list)
    structural: list[EffectValue] = field(default_factory=list)
    curated: list[EffectValue] = field(default_factory=list)
    disabled: list[EffectValue] = field(default_factory=list)
    sources: list[SourceStatus] = field(default_factory=list)
    curated_state: SourceState = SourceState.EMPTY
    curated_message: str | None = None
    # AlphaMissense as ProtVar reports it, kept for the cross-check against the AFDB file
    alphamissense: dict[str, Any] | None = None
    foldx_wild_type: str | None = None


def _state(result: SourceResult[Any]) -> str:
    return "unavailable" if result.state is not SourceState.EMPTY and not result.ok else "not_covered"


def _evidence(
    result: SourceResult[Any],
    query: EffectQuery,
    record_type: str,
    key: str,
    value: float | str | None,
    *,
    unit: str | None = None,
    record_id: str | None = None,
    scheme: str | None = None,
) -> Evidence | None:
    if result.provenance is None:
        return None
    return try_build_evidence(
        result.provenance,
        record_type=record_type,
        record_id=record_id or query.record,
        subject=query.subject,
        predicate="has_predicted_effect",
        object=EvidenceObject(type=key, value=value, unit=unit),
        strength_value=value if scheme else None,
        strength_scheme=scheme,
        strength_unit=unit,
    )


def _afdb_structure(accession: str, fragment: str | None, plddt: float | None) -> EffectStructureBasis:
    return EffectStructureBasis(
        id=f"afdb:AF-{accession}-{fragment or 'F1'}",
        origin=StructureOrigin.PREDICTED_EXTERNAL,
        fragment=fragment,
        residue_plddt=plddt,
    )


def _plddt_flags(plddt: float | None) -> list[EffectFlag]:
    return [EffectFlag(code="plddt_below_70", message=PLDDT_FLAG)] if plddt is not None and plddt < 70 else []


@register_provider
class ProtVarEffectsProvider(VariantEffectProvider):
    id = "protvar_effects"
    name = "ProtVar residue annotations"
    model_name = "ProtVar"
    model_version = "API 2.0, data release 2.1"
    license = "CC-BY-4.0"
    license_url = "https://ftp.ebi.ac.uk/pub/databases/ProtVar/LICENCE"
    commercial_use = True
    capabilities = (Capability.VARIANT_EFFECT, Capability.POCKETS)
    execution_mode = ExecutionMode.RETRIEVAL
    limitations = (
        "Retrieval of third-party predictions; Helix runs no model here.",
        "FoldX values were computed by ProtVar on AlphaFold models and inherit the uncertainty "
        "of those models.",
        STABILITY_SCOPE,
        "Third-party scores redistributed by ProtVar keep their own licences; ESM-1b and CADD values are "
        "withheld unless non-commercial sources are enabled.",
    )
    citation = (
        Citation(text="Stephenson et al., Nucleic Acids Res 2024", doi=PROTVAR_DOI),
        Citation(text="Orenbuch et al., Nat Genet 2025 (popEVE)", doi="10.1038/s41588-025-02400-1"),
        Citation(text="Frazer et al., Nature 2021 (EVE)", doi="10.1038/s41586-021-04043-8"),
    )
    attribution = protvar.attribution
    homepage = protvar.homepage

    async def check_availability(self) -> Availability:
        return Availability(available=True, reason="Keyless public API; no local model is run.")

    async def collect(self, query: EffectQuery) -> ProtVarEffects:
        accession, position, alternate = query.accession, query.position, query.alternate
        noncommercial = get_settings().enable_noncommercial_sources
        calls: dict[str, SourceCall] = {
            "scores": SourceCall(protvar, protvar.scores(accession, position, alternate)),
            "pockets": SourceCall(protvar, protvar.pockets(accession, position)),
            "interfaces": SourceCall(protvar, protvar.interfaces(accession, position)),
            "function": SourceCall(protvar, protvar.function(accession, position, alternate)),
        }
        if alternate:
            calls["foldx"] = SourceCall(protvar, protvar.foldx(accession, position, alternate))
            if noncommercial and query.reference:
                calls["cadd"] = SourceCall(
                    protvar, protvar.cadd(accession, query.reference, position, alternate)
                )
        gathered = await gather_sources(calls, timeout=20)
        effects = ProtVarEffects(sources=gathered.sources)

        self._scores(effects, query, gathered["scores"], noncommercial)
        if alternate:
            self._foldx(effects, query, gathered["foldx"])
            self._cadd(effects, query, gathered.results.get("cadd"))
        self._pockets(effects, query, gathered["pockets"])
        self._interfaces(effects, query, gathered["interfaces"])
        self._function(effects, query, gathered["function"])
        return effects

    def _scores(
        self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any], noncommercial: bool
    ) -> None:
        by_type = {row.get("type"): row for row in (result.data or [])} if result.ok else {}
        missing = _state(result) if not result.ok else "not_covered"
        common = {"provenance": result.provenance, "citation_doi": PROTVAR_DOI}

        conservation = by_type.get("CONSERV")
        effects.predictions.append(
            EffectValue(
                key="conservation.scorecons",
                label="Conservation (ScoreCons, UniRef90)",
                kind="conservation",
                state="ok" if conservation else missing,
                value=conservation.get("score") if conservation else None,
                scale="0 to 1; higher = more conserved across species",
                message=None
                if conservation
                else (result.message or "ProtVar has no conservation score here."),
                tool="ScoreCons",
                input_basis="alignment (UniRef90)",
                license="CC-BY-4.0",
                commercial_use="allowed",
                evidence=_evidence(
                    result,
                    query,
                    "conservation",
                    "conservation.scorecons",
                    conservation.get("score"),
                    record_id=query.residue_record,
                )
                if conservation
                else None,
                **common,
            )
        )
        if not query.alternate:
            return

        effects.alphamissense = by_type.get("AM")

        esm_base = {
            "key": "esm1b.llr",
            "label": "ESM-1b log-likelihood ratio",
            "kind": "language_model_llr",
            "scale": "log-likelihood ratio of variant vs reference residue; more negative = more damaging",
            "direction": "lower_more_damaging",
            "tool": "ESM-1b",
            "input_basis": "sequence",
            "thresholds": ESM_THRESHOLDS,
            "license": "CC-BY-NC-4.0 (upstream precomputed file)",
            "commercial_use": "restricted",
        }
        if not noncommercial:
            effects.disabled.append(
                EffectValue(state="disabled_by_license", message=NONCOMMERCIAL, **esm_base)
            )
        else:
            esm = by_type.get("ESM")
            effects.predictions.append(
                EffectValue(
                    state="ok" if esm else missing,
                    value=esm.get("score") if esm else None,
                    message=None
                    if esm
                    else (result.message or "ProtVar has no ESM-1b score for this substitution."),
                    evidence=_evidence(result, query, "esm1b", "esm1b.llr", esm.get("score"))
                    if esm
                    else None,
                    **esm_base,
                    **common,
                )
            )

        popeve = by_type.get("POPEVE")
        gap_frequency = popeve.get("gapFreq") if popeve else None
        gap_flags = (
            [EffectFlag(code="gap_frequency_above_0.5", message=GAP_FLAG)]
            if gap_frequency is not None and gap_frequency > 0.5
            else []
        )
        effects.predictions.append(
            EffectValue(
                key="popeve.score",
                label="popEVE",
                kind="pathogenicity",
                state="ok" if popeve else missing,
                value=popeve.get("popeve") if popeve else None,
                scale="proteome-wide scale; more negative = more deleterious",
                direction="lower_more_damaging",
                thresholds=POPEVE_THRESHOLDS,
                flags=gap_flags,
                details={
                    "gap_frequency": gap_frequency,
                    "popped_eve": popeve.get("poppedEve"),
                    "popped_esm1v": popeve.get("poppedEsm1v"),
                    "eve": popeve.get("eve"),
                    "esm1v": popeve.get("esm1v"),
                }
                if popeve
                else {},
                message=None
                if popeve
                else (result.message or "ProtVar has no popEVE score for this substitution."),
                tool="popEVE",
                tool_version="2025.03",
                input_basis="alignment and sequence",
                license="not stated by the source",
                commercial_use="unknown",
                evidence=_evidence(result, query, "popeve", "popeve.score", popeve.get("popeve"))
                if popeve
                else None,
                provenance=result.provenance,
                citation_doi="10.1038/s41588-025-02400-1",
            )
        )

        eve = by_type.get("EVE")
        effects.predictions.append(
            EffectValue(
                key="eve.score",
                label="EVE",
                kind="pathogenicity",
                state="ok" if eve else missing,
                value=eve.get("score") if eve else None,
                scale="0 to 1; higher = more pathogenic",
                direction="higher_more_damaging",
                source_class=eve.get("eveClass") if eve else None,
                class_label=f"{eve['eveClass'].lower()} (EVE class)" if eve and eve.get("eveClass") else None,
                message=None if eve else (result.message or "ProtVar returns no EVE score at this position."),
                tool="EVE",
                input_basis="alignment",
                license="MIT",
                commercial_use="allowed",
                evidence=_evidence(result, query, "eve", "eve.score", eve.get("score")) if eve else None,
                provenance=result.provenance,
                citation_doi="10.1038/s41586-021-04043-8",
            )
        )

        missense3d = by_type.get("M3D")
        effects.predictions.append(
            EffectValue(
                key="missense3d.prediction",
                label="Missense3D structural assessment",
                kind="structural_feature",
                state="ok" if missense3d else missing,
                value=missense3d.get("prediction") if missense3d else None,
                source_class=missense3d.get("prediction") if missense3d else None,
                details={"damaging_feature": missense3d.get("damagingFeature")} if missense3d else {},
                message=None
                if missense3d
                else (result.message or "ProtVar has no Missense3D prediction for this substitution."),
                tool="Missense3D",
                tool_version="2026.02",
                input_basis="structure",
                license="CC-BY-4.0",
                commercial_use="allowed",
                evidence=_evidence(
                    result, query, "missense3d", "missense3d.prediction", missense3d.get("prediction")
                )
                if missense3d
                else None,
                **common,
            )
        )

    def _foldx(self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any]) -> None:
        rows = result.data if result.ok and result.data else []
        base = {
            "key": "foldx.ddg",
            "label": "FoldX ΔΔG (precomputed on the AlphaFold model)",
            "kind": "stability_ddg",
            "unit": "kcal/mol",
            "scale": "ΔΔG of folding; positive = destabilising",
            "direction": "positive_destabilising",
            "thresholds": FOLDX_THRESHOLDS,
            "tool": "FoldX",
            "tool_version": "5.0",
            "input_basis": "structure (AlphaFold2 model)",
            "license": "CC-BY-4.0",
            "commercial_use": "allowed",
            "citation_doi": PROTVAR_DOI,
            "provenance": result.provenance,
        }
        if not rows:
            effects.predictions.append(
                EffectValue(
                    state=_state(result),
                    message=result.message or "ProtVar has no precomputed FoldX value for this substitution.",
                    **base,
                )
            )
            return
        for row in rows:
            plddt = row.get("plddt")
            effects.foldx_wild_type = row.get("wildType") or effects.foldx_wild_type
            flags = _plddt_flags(plddt)
            if query.reference and row.get("wildType") and row["wildType"] != query.reference:
                flags.append(
                    EffectFlag(
                        code="reference_residue_mismatch",
                        message=f"FoldX was run on {row['wildType']} at this position; the sequence has "
                        f"{query.reference}.",
                    )
                )
            effects.predictions.append(
                EffectValue(
                    state="ok",
                    value=row.get("foldxDdg"),
                    flags=flags,
                    details={
                        "wild_type": row.get("wildType"),
                        "mutated_type": row.get("mutatedType"),
                        "fragment_position": row.get("afPos"),
                        "num_fragments": row.get("numFragments"),
                    },
                    message=STABILITY_SCOPE,
                    structure=_afdb_structure(query.accession, row.get("afId"), plddt),
                    evidence=_evidence(
                        result,
                        query,
                        "foldx",
                        "foldx.ddg",
                        row.get("foldxDdg"),
                        unit="kcal/mol",
                        record_id=row.get("variantKey"),
                        scheme="foldx_ddg",
                    ),
                    **base,
                )
            )

    def _cadd(self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any] | None) -> None:
        base = {
            "key": "cadd.phred",
            "label": "CADD PHRED",
            "kind": "pathogenicity",
            "scale": "PHRED-scaled rank; higher = more deleterious",
            "direction": "higher_more_damaging",
            "thresholds": CADD_THRESHOLDS,
            "tool": "CADD",
            "tool_version": "v1.7",
            "input_basis": "genomic position",
            "license": "LicenseRef-CADD-non-commercial",
            "commercial_use": "restricted",
            "citation_doi": "10.1093/nar/gkad989",
        }
        if result is None:
            if not get_settings().enable_noncommercial_sources:
                effects.disabled.append(
                    EffectValue(state="disabled_by_license", message=NONCOMMERCIAL, **base)
                )
            return
        rows = result.data if result.ok and result.data else []
        if not rows:
            effects.predictions.append(
                EffectValue(
                    state=_state(result),
                    message=result.message or "ProtVar maps no CADD score to this substitution.",
                    provenance=result.provenance,
                    **base,
                )
            )
            return
        for row in rows:
            effects.predictions.append(
                EffectValue(
                    state="ok",
                    value=row["phred"],
                    details={"genomic_variant": row["genomic_variant"], "assembly": "GRCh38"},
                    evidence=_evidence(result, query, "cadd", "cadd.phred", row["phred"]),
                    provenance=result.provenance,
                    **base,
                )
            )

    def _pockets(self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any]) -> None:
        base = {
            "kind": "structural_feature",
            "scale": "combined pocket score, 0 to 1000",
            "thresholds": POCKET_THRESHOLDS,
            "tool": "ProtVar pocket prediction on the AlphaFold model",
            "tool_version": "2024.05.28",
            "input_basis": "structure (AlphaFold2 model)",
            "license": "CC-BY-4.0",
            "commercial_use": "allowed",
            "citation_doi": PROTVAR_DOI,
            "provenance": result.provenance,
        }
        rows = result.data if result.ok and result.data else []
        if not rows:
            effects.structural.append(
                EffectValue(
                    key="pocket.membership",
                    label="Predicted pocket membership",
                    state=_state(result),
                    message=result.message
                    if not result.answered
                    else "No predicted pocket contains this residue.",
                    **base,
                )
            )
            return
        for row in rows:
            mean_plddt = row.get("meanPlddt")
            effects.structural.append(
                EffectValue(
                    key=f"pocket.{row.get('pocketId')}",
                    label=f"Predicted pocket {row.get('pocketId')}",
                    state="ok",
                    value=round(row["score"], 1) if isinstance(row.get("score"), float) else row.get("score"),
                    details={
                        "pocket_id": row.get("pocketId"),
                        "buriedness": row.get("buriedness"),
                        "radius_of_gyration": row.get("radGyration"),
                        "energy_per_volume": row.get("energyPerVol"),
                        "mean_plddt": mean_plddt,
                        "residues": row.get("resid") or [],
                    },
                    structure=EffectStructureBasis(
                        id=f"afdb:AF-{row.get('structId') or query.accession}-F1",
                        origin=StructureOrigin.PREDICTED_EXTERNAL,
                    ),
                    evidence=_evidence(
                        result,
                        query,
                        "pocket",
                        "pocket.score",
                        row.get("score"),
                        record_id=f"{query.accession}:pocket:{row.get('pocketId')}",
                    ),
                    **base,
                )
            )

    def _interfaces(self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any]) -> None:
        base = {
            "kind": "structural_feature",
            "scale": "pDockQ of the predicted complex, 0 to 1",
            "thresholds": INTERFACE_THRESHOLDS,
            "tool": "ProtVar predicted protein-protein interfaces (AlphaFold2 complexes)",
            "tool_version": "2024.05.28",
            "input_basis": "structure (predicted complex)",
            "license": "CC-BY-4.0",
            "commercial_use": "allowed",
            "citation_doi": PROTVAR_DOI,
            "provenance": result.provenance,
        }
        rows = result.data if result.ok and result.data else []
        if not rows:
            effects.structural.append(
                EffectValue(
                    key="interface.membership",
                    label="Predicted interface membership",
                    state=_state(result),
                    message=result.message
                    if not result.answered
                    else "No predicted interface contains this residue.",
                    **base,
                )
            )
            return
        for row in rows:
            this_is_a = row.get("a") == query.accession
            partner = row.get("b") if this_is_a else row.get("a")
            effects.structural.append(
                EffectValue(
                    key=f"interface.{partner}",
                    label=f"Predicted interface with {partner}",
                    state="ok",
                    value=row.get("pdockq"),
                    details={
                        "partner_accession": partner,
                        "residues": row.get("aresidues" if this_is_a else "bresidues") or [],
                        "partner_residues": row.get("bresidues" if this_is_a else "aresidues") or [],
                    },
                    evidence=_evidence(
                        result,
                        query,
                        "interface",
                        "interface.pdockq",
                        row.get("pdockq"),
                        record_id=f"{row.get('a')}:{row.get('b')}",
                    ),
                    **base,
                )
            )

    def _function(self, effects: ProtVarEffects, query: EffectQuery, result: SourceResult[Any]) -> None:
        effects.curated_state = result.state
        effects.curated_message = result.message
        if not result.ok or not result.data or result.provenance is None:
            return
        entry_url = f"https://www.uniprot.org/uniprotkb/{query.accession}/entry"
        for feature in result.data["features"]:
            feature_type = feature.get("type") or "FEATURE"
            if feature_type == "CHAIN":
                continue
            begin, end = feature.get("begin"), feature.get("end")
            evidences = [item for item in feature.get("evidences") or [] if isinstance(item, dict)]
            eco = next((item["code"] for item in evidences if item.get("code")), None)
            references = [item.get("source") or {} for item in evidences]
            citations = [
                Citation(pmid=str(reference["id"]), url=reference.get("url"))
                for reference in references
                if reference.get("name") == "PubMed" and reference.get("id")
            ]
            record_id = feature.get("ftId") or f"{query.accession}:{feature_type}:{begin}-{end}"
            description = feature.get("description") or None
            alternative = feature.get("alternativeSequence")
            evidence = try_build_evidence(
                result.provenance,
                database="uniprot",
                record_type=None if eco else "feature_without_evidence",
                eco=eco,
                record_id=record_id,
                url=entry_url,
                subject=EntityRef.of(EntityType.RESIDUE, query.residue_record),
                predicate="has_annotation",
                object=EvidenceObject(type=f"uniprot.{feature_type.lower()}", value=description),
                statement=description,
                citations=citations,
            )
            effects.curated.append(
                EffectValue(
                    key=f"uniprot.{feature_type.lower()}.{record_id}",
                    label=f"UniProt {feature_type.replace('_', ' ').lower()}",
                    kind="curated_feature",
                    state="ok",
                    value=description,
                    details={
                        "feature_type": feature_type,
                        "category": feature.get("category"),
                        "feature_id": feature.get("ftId"),
                        "begin": begin,
                        "end": end,
                        "alternative_sequence": alternative,
                        "matches_alternate": bool(alternative) and alternative == query.alternate,
                        "eco_codes": sorted({item["code"] for item in evidences if item.get("code")}),
                        "references": [
                            {
                                "database": reference.get("name"),
                                "id": reference.get("id"),
                                "url": reference.get("url"),
                            }
                            for reference in references
                            if reference.get("id")
                        ],
                        "uniprot_last_updated": result.data.get("last_updated"),
                    },
                    tool="UniProtKB (through ProtVar)",
                    license="CC-BY-4.0",
                    commercial_use="allowed",
                    evidence=evidence,
                    provenance=result.provenance,
                )
            )
        # Annotations of the queried substitution first, then the narrowest features
        effects.curated.sort(
            key=lambda value: (
                not value.details["matches_alternate"],
                int(value.details["end"] or 0) - int(value.details["begin"] or 0),
            )
        )

    async def analyze(self, request: VariantEffectRequest, context: RunContext) -> VariantEffectResult:
        subject = EntityRef.of(
            EntityType.VARIANT,
            request.variant_id or f"{request.uniprot_accession}:{request.position}:{request.alternate}",
        )
        query = EffectQuery(
            accession=request.uniprot_accession,
            position=request.position,
            reference=request.reference,
            alternate=request.alternate,
            subject=subject,
        )
        effects = await self.collect(query)
        values = [
            value
            for value in [*effects.predictions, *effects.structural, *effects.curated]
            if value.state == "ok"
        ]
        return VariantEffectResult(
            scores=[
                VariantEffectScore(
                    name=value.key,
                    value=value.value,
                    unit=value.unit,
                    classification=value.source_class,
                    scheme=value.tool,
                )
                for value in values
            ],
            evidence=[value.evidence for value in values if value.evidence is not None],
            sources=effects.sources,
            limitations=list(self.limitations),
        )
