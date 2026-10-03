"""AlphaMissense retrieval provider, read from the per-protein file AlphaFold DB publishes.

The class string of the file is kept verbatim; only the vocabulary is normalised. The class is
never recomputed from the score.
"""

from dataclasses import dataclass, field
from statistics import fmean

from orphafold.evidence import try_build_evidence
from orphafold.providers.base import (
    Availability,
    Capability,
    ExecutionMode,
    ProviderError,
    RunContext,
    VariantEffectProvider,
    VariantEffectRequest,
    VariantEffectResult,
    VariantEffectScore,
    register_provider,
)
from orphafold.schemas.common import (
    Citation,
    EntityRef,
    EntityType,
    EvidenceObject,
    SourceState,
    SourceStatus,
)
from orphafold.schemas.variant_effects import (
    EffectFlag,
    EffectMapResidue,
    EffectMatrix,
    EffectQuery,
    EffectThreshold,
    EffectValue,
)
from orphafold.sources.afdb import AfdbEntry, afdb
from orphafold.sources.alphamissense import (
    CLASS_VOCABULARY,
    CLINICAL_DISCLAIMER,
    AlphaMissenseTable,
    alphamissense,
)
from orphafold.sources.base import SourceResult

ALPHAMISSENSE_DOI = "10.1126/science.adg7492"
_ZENODO = "AlphaMissense Zenodo record 10813168"
THRESHOLDS = [
    EffectThreshold(label="likely_benign", upper=0.34, defined_by=_ZENODO),
    EffectThreshold(label="ambiguous", lower=0.34, upper=0.564, defined_by=_ZENODO),
    EffectThreshold(label="likely_pathogenic", lower=0.564, defined_by=_ZENODO),
]
SCALE = "0 to 1; higher = more likely pathogenic"
ALTERNATES = "ACDEFGHIKLMNPQRSTVWY"
ISOFORM_NOTE = (
    "Scores are for the UniProt canonical isoform as of UniProt release 2021_02; "
    "other isoforms score differently."
)


@dataclass(slots=True)
class AlphaMissenseEffects:
    value: EffectValue
    sources: list[SourceStatus] = field(default_factory=list)
    table: SourceResult[AlphaMissenseTable] | None = None


def _base(result: SourceResult[AlphaMissenseTable] | None) -> dict:
    return {
        "key": "alphamissense.pathogenicity",
        "label": "AlphaMissense pathogenicity",
        "kind": "pathogenicity",
        "scale": SCALE,
        "direction": "higher_more_damaging",
        "thresholds": THRESHOLDS,
        "tool": "AlphaMissense",
        "tool_version": "2023 release (hg38, UniProt 2021_02 canonical isoforms)",
        "input_basis": "sequence, alignment and predicted structure context",
        "license": "CC-BY-4.0",
        "commercial_use": "allowed",
        "citation_doi": ALPHAMISSENSE_DOI,
        "provenance": result.provenance if result else None,
    }


@register_provider
class AlphaMissenseAfdbProvider(VariantEffectProvider):
    id = "alphamissense_afdb"
    name = "AlphaMissense (AlphaFold DB file)"
    model_name = "AlphaMissense"
    model_version = "2023 release"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    commercial_use = True
    capabilities = (Capability.VARIANT_EFFECT,)
    execution_mode = ExecutionMode.RETRIEVAL
    limitations = (
        CLINICAL_DISCLAIMER,
        "Retrieval of precomputed predictions; the model weights are not released, "
        "so no new prediction is run.",
        ISOFORM_NOTE,
    )
    citation = (Citation(text="Cheng et al., Science 2023", doi=ALPHAMISSENSE_DOI),)
    attribution = alphamissense.attribution
    homepage = "https://alphafold.ebi.ac.uk"

    async def check_availability(self) -> Availability:
        return Availability(available=True, reason="Keyless public file download; no local model is run.")

    async def table(self, entry: AfdbEntry | None) -> SourceResult[AlphaMissenseTable]:
        if entry is None or not entry.am_annotations_url:
            return alphamissense.result(
                SourceState.EMPTY, message="AlphaFold DB lists no AlphaMissense file for this protein."
            )
        return await alphamissense.substitutions(entry.am_annotations_url, entry.entry_id)

    async def collect(self, query: EffectQuery, entry: AfdbEntry | None) -> AlphaMissenseEffects:
        result = await self.table(entry)
        base = _base(result)
        if not result.ok or result.data is None:
            state = "not_covered" if result.is_empty else "unavailable"
            value = EffectValue(state=state, message=result.message or "No AlphaMissense score.", **base)
            return AlphaMissenseEffects(value=value, sources=[result.status()], table=result)
        table = result.data
        substitutions = table.substitutions.get(query.position, {})
        file_reference = table.references.get(query.position)
        flags = []
        if file_reference and query.reference and file_reference != query.reference:
            flags.append(
                EffectFlag(
                    code="reference_residue_mismatch",
                    message=f"The AlphaMissense file has {file_reference} at this position; the sequence has "
                    f"{query.reference}.",
                )
            )
        if not query.alternate:
            scores = [score for score, _ in substitutions.values()]
            value = EffectValue(
                state="ok" if scores else "not_covered",
                value=round(fmean(scores), 4) if scores else None,
                flags=flags,
                details={
                    "substitutions": len(scores),
                    "summary": "mean over the substitutions at this residue",
                },
                message="Mean over the substitutions at this residue, computed by OrphaFold from the "
                "source file. "
                "Give an alternate residue for the score and class of one substitution."
                if scores
                else "The AlphaMissense file has no row at this position.",
                **{**base, "key": "alphamissense.residue_mean", "label": "AlphaMissense, mean at residue"},
            )
            return AlphaMissenseEffects(value=value, sources=[result.status()], table=result)
        row = substitutions.get(query.alternate)
        if row is None:
            value = EffectValue(
                state="not_covered",
                flags=flags,
                message="The AlphaMissense file has no row for this substitution.",
                **base,
            )
            return AlphaMissenseEffects(value=value, sources=[result.status()], table=result)
        score, source_class = row
        normalized = CLASS_VOCABULARY.get(source_class)
        record_id = (
            f"{entry.entry_id}:{file_reference}{query.position}{query.alternate}" if entry else query.record
        )
        evidence = (
            try_build_evidence(
                result.provenance,
                record_id=record_id,
                subject=query.subject,
                predicate="has_predicted_effect",
                object=EvidenceObject(type="alphamissense.pathogenicity", value=score, label=source_class),
                strength_value=score,
            )
            if result.provenance
            else None
        )
        value = EffectValue(
            state="ok",
            value=score,
            source_class=source_class,
            normalized_class=normalized,
            class_label=f"{normalized.replace('_', ' ')} (AlphaMissense class)" if normalized else None,
            flags=flags,
            details={"protein_variant": f"{file_reference}{query.position}{query.alternate}"},
            message=CLINICAL_DISCLAIMER,
            evidence=evidence,
            **base,
        )
        return AlphaMissenseEffects(value=value, sources=[result.status()], table=result)

    @staticmethod
    def residue_summaries(table: AlphaMissenseTable) -> list[EffectMapResidue]:
        residues = []
        for position in sorted(table.substitutions):
            rows = table.substitutions[position].values()
            scores = [score for score, _ in rows]
            classes = [CLASS_VOCABULARY.get(source_class) for _, source_class in rows]
            residues.append(
                EffectMapResidue(
                    position=position,
                    reference=table.references[position],
                    mean_pathogenicity=round(fmean(scores), 4),
                    min_pathogenicity=min(scores),
                    max_pathogenicity=max(scores),
                    substitutions=len(scores),
                    likely_benign=classes.count("likely_benign"),
                    ambiguous=classes.count("ambiguous"),
                    likely_pathogenic=classes.count("likely_pathogenic"),
                )
            )
        return residues

    @staticmethod
    def matrix(table: AlphaMissenseTable) -> EffectMatrix:
        scores, classes = [], []
        for position in sorted(table.substitutions):
            row = table.substitutions[position]
            scores.append([row[alternate][0] if alternate in row else None for alternate in ALTERNATES])
            classes.append([row[alternate][1] if alternate in row else None for alternate in ALTERNATES])
        return EffectMatrix(alternates=ALTERNATES, scores=scores, classes=classes)

    async def analyze(self, request: VariantEffectRequest, context: RunContext) -> VariantEffectResult:
        selection = await afdb.model(request.uniprot_accession)
        entry = selection.data.canonical if selection.data else None
        if not selection.answered:
            raise ProviderError("source_unavailable", selection.message or "AlphaFold DB did not answer.")
        query = EffectQuery(
            accession=request.uniprot_accession,
            position=request.position,
            reference=request.reference,
            alternate=request.alternate,
            subject=EntityRef.of(
                EntityType.VARIANT,
                request.variant_id or f"{request.uniprot_accession}:{request.position}:{request.alternate}",
            ),
        )
        effects = await self.collect(query, entry)
        value = effects.value
        scored = value.state == "ok"
        return VariantEffectResult(
            scores=[
                VariantEffectScore(
                    name=value.key,
                    value=value.value,
                    classification=value.source_class,
                    scheme="alphamissense",
                )
            ]
            if scored
            else [],
            evidence=[value.evidence] if value.evidence is not None else [],
            sources=[selection.status(), *effects.sources],
            limitations=list(self.limitations),
        )
