"""Candidate mechanisms of a single-residue variant.

Everything here is a fixed rule over records OrphaFold already retrieves. No language model, no
score combined across sources, no rule that fires without a source record. A candidate is a
question to test in the laboratory; it is never worded as a finding.

Inputs (each through its existing service, so every row keeps its Evidence and source record)
    UniProt and InterPro features of the protein     services.proteins.get_protein
    effect values at the residue (ProtVar and others) services.variant_effects.residue_effects
    experimental structures and their ligands         services.structures
    P2Rank pockets of the AlphaFold DB model          services.pockets.protein_pockets
    IntAct curated partners                           services.interactions.protein_interactions

Distances
    "at the residue"   the annotated position is the variant position
    "covering"         the residue lies inside an annotated range
    "sequence neighbour"  the annotated position is within NEIGHBOUR_WINDOW residues along the
                       sequence. Sequence distance is not spatial distance; the distance is printed
                       on every such row.
    "structure contact"   RCSB lists the residue as a neighbour of a bound ligand in a PDB entry.

Rules (ID, category, what must be true)
    S1  stability           FoldX ddG retrieved from ProtVar is at or above the lower bound of the
                            source's own "likely to be destabilising" bin. A lower value is listed
                            under "no supporting data found" with the number.
    F1  folding             Substitution to proline inside a UniProt helix or beta strand.
    F2  folding             Substitution to glycine inside a UniProt helix or beta strand, or loss
                            of glycine inside a UniProt turn.
    F3  folding             The reference residue is a cysteine of a UniProt disulfide bond.
    F4  folding             Missense3D (through ProtVar) reports structural damage; its damaging
                            feature (for example a buried substitution) is quoted.
    C1  catalytic_site      UniProt active site at the residue or a sequence neighbour.
    C2  catalytic_site      InterPro active-site signature covering the residue.
    L1  ligand_binding      UniProt binding site or DNA-binding region at, covering or next to the
                            residue.
    L2  ligand_binding      InterPro binding-site signature covering the residue.
    L3  ligand_binding      A ligand of an experimental PDB entry has the residue among its RCSB
                            neighbours. Components on the common-additive list are left out.
    L4  ligand_binding      The residue lines a predicted pocket (ProtVar pocket, P2Rank).
    P1  protein_interaction UniProt region, motif or site covering the residue whose description
                            says "interaction", or "<SYMBOL>-binding" where SYMBOL is an IntAct
                            partner of the protein.
    P2  protein_interaction The residue is in a ProtVar predicted interface.
    P0  protein_interaction IntAct partners: protein-level context shown under a raised candidate.
                            They never raise it, because IntAct does not place this residue.
    O1  localisation        Signal peptide, transit peptide, transmembrane or intramembrane region
                            covering the residue.
    O2  localisation        Lipidation at the residue or a sequence neighbour.
    O3  localisation        UniProt motif covering the residue whose description names nuclear
                            localisation, nuclear export, sorting, retention or targeting.
    G1  signalling          Modified residue, glycosylation or cross-link at the residue or a
                            sequence neighbour.
    G2  signalling          Any other UniProt motif covering the residue.
    D1  domain_interface    The residue is within DOMAIN_BOUNDARY_WINDOW residues of the start or
                            end of a UniProt domain (sequence termini excluded).
    T1  any                 A UniProt mutagenesis or natural-variant statement at this residue
                            contains a keyword of the category (_KEYWORDS). The statement is quoted
                            verbatim. A statement that says "no effect", "does not affect",
                            "unaffected" or "normal" is recorded as disputing and raises nothing.
                            A statement about another substitution at the residue is marked so.

Confidence label
    The label of a candidate is the kind of its strongest raising record:
    experimental annotation (Evidence class experimental) > curated annotation (clinical_database,
    curated_database, literature) > computational prediction. It is an ordering of record kinds,
    not a probability.

Ranking
    Candidates are ordered by label, then by the closest proximity of a raising record, then by the
    number of raising records, then by the fixed category order.

Not covered, because no retrieved source provides it
    Solvent accessibility (burial) outside Missense3D, residue contacts between protein chains of
    experimental complexes, and contacts between domains in 3D.
"""

import asyncio
import re
from collections.abc import Awaitable, Iterable
from typing import Any, get_args

from sqlalchemy.ext.asyncio import AsyncSession

from orphafold.knowledge.catalog import Catalog
from orphafold.errors import ApiError, BadRequest, NotFound
from orphafold.hgvs import parse_variant_query, three_letter
from orphafold.identity import Actor
from orphafold.log import get_logger
from orphafold.schemas.common import (
    EntityRef,
    Evidence,
    EvidenceClass,
    EvidenceDirection,
    ResidueRange,
    SourceState,
    SourceStatus,
    StructureOrigin,
)
from orphafold.schemas.mechanisms import (
    MechanismCandidate,
    MechanismCategory,
    MechanismHighlight,
    MechanismLigandRef,
    MechanismObservation,
    MechanismRule,
    MechanismsResponse,
    Proximity,
    SupportKind,
    SupportKindInfo,
    UnsupportedCategory,
)
from orphafold.schemas.proteins import Feature, ProteinResponse
from orphafold.schemas.variant_effects import EffectValue
from orphafold.services.interactions import protein_interactions
from orphafold.services.pockets import protein_pockets
from orphafold.services.proteins import get_protein
from orphafold.services.structures import protein_structures, structure_ligands
from orphafold.services.variant_effects import residue_effects
from orphafold.services.variants import resolve_gene, variant_detail

logger = get_logger(__name__)

NEIGHBOUR_WINDOW = 4
DOMAIN_BOUNDARY_WINDOW = 5
MAX_LIGAND_STRUCTURES = 8
MAX_CONTEXT_PARTNERS = 5
CALL_TIMEOUT = 40.0
POCKET_TIMEOUT = 12.0

CATEGORIES: tuple[MechanismCategory, ...] = get_args(MechanismCategory)

LABELS: dict[MechanismCategory, str] = {
    "stability": "Protein stability",
    "folding": "Local folding",
    "catalytic_site": "Catalytic site",
    "ligand_binding": "Ligand binding",
    "protein_interaction": "Protein-protein interaction",
    "localisation": "Localisation",
    "signalling": "Signalling and modification",
    "domain_interface": "Domain boundary",
}

CLAIMS: dict[MechanismCategory, str] = {
    "stability": "{change} might lower the thermodynamic stability of the folded protein.",
    "folding": "{change} might disturb local folding around {residue}.",
    "catalytic_site": "{change} might alter catalytic activity through {residue}.",
    "ligand_binding": "{change} might alter ligand binding at or around {residue}.",
    "protein_interaction": "{change} might alter a protein-protein interaction that involves {residue}.",
    "localisation": "{change} might alter targeting or membrane insertion of the protein.",
    "signalling": "{change} might alter a modification site or signalling motif at or next to {residue}.",
    "domain_interface": "{change} might alter the boundary or packing between domains near {residue}.",
}

TESTS: dict[MechanismCategory, list[str]] = {
    "stability": [
        "Thermal or chemical denaturation of purified reference and variant protein (differential "
        "scanning fluorimetry, circular dichroism).",
        "Steady-state protein level and half-life in cells (immunoblot, cycloheximide chase).",
    ],
    "folding": [
        "Secondary-structure and aggregation readouts of the purified variant (circular dichroism, "
        "size-exclusion chromatography).",
        "Soluble against insoluble fraction of the variant expressed in cells.",
    ],
    "catalytic_site": [
        "Enzyme kinetics of purified reference and variant protein with the physiological substrate.",
        "Activity readout in cells that carry the variant.",
    ],
    "ligand_binding": [
        "Binding measurement of the named ligand with reference and variant protein (isothermal "
        "titration calorimetry, surface plasmon resonance).",
        "A structure of the variant with the ligand.",
    ],
    "protein_interaction": [
        "Co-immunoprecipitation or a proximity assay of the named partner with reference and variant protein.",
        "Affinity of the purified pair (surface plasmon resonance, bio-layer interferometry).",
    ],
    "localisation": [
        "Imaging of tagged reference and variant protein with compartment markers.",
        "Subcellular fractionation followed by immunoblot.",
    ],
    "signalling": [
        "Site-specific modification readout (phospho-specific antibody, mass spectrometry) with and "
        "without the variant.",
        "Downstream pathway readout after stimulation in cells that carry the variant.",
    ],
    "domain_interface": [
        "A structure or small-angle scattering profile of the multi-domain variant protein.",
        "Limited proteolysis or hydrogen-deuterium exchange of reference and variant protein.",
    ],
}

CHECKED: dict[MechanismCategory, list[str]] = {
    "stability": ["FoldX ddG from ProtVar", "UniProt mutagenesis and variant statements"],
    "folding": [
        "UniProt helix, strand and turn with a proline or glycine change",
        "UniProt disulfide bonds",
        "Missense3D from ProtVar",
        "UniProt mutagenesis and variant statements",
    ],
    "catalytic_site": ["UniProt active sites", "InterPro active-site signatures", "UniProt statements"],
    "ligand_binding": [
        "UniProt binding sites",
        "InterPro binding-site signatures",
        "Ligand neighbours in experimental PDB entries",
        "Predicted pockets (ProtVar, P2Rank)",
        "UniProt statements",
    ],
    "protein_interaction": [
        "UniProt interaction regions, motifs and sites",
        "ProtVar predicted interfaces",
        "UniProt statements",
    ],
    "localisation": [
        "UniProt signal and transit peptides",
        "UniProt transmembrane regions",
        "UniProt lipidation",
        "UniProt targeting motifs",
        "UniProt statements",
    ],
    "signalling": ["UniProt modified residues, glycosylation and cross-links", "UniProt motifs", "UniProt statements"],
    "domain_interface": ["UniProt domain boundaries"],
}

RULES: list[MechanismRule] = [
    MechanismRule(id="S1", category="stability", data="ProtVar FoldX", description="FoldX ddG at or above the source's destabilising bin."),
    MechanismRule(id="F1", category="folding", data="UniProt secondary structure", description="Substitution to proline inside a helix or beta strand."),
    MechanismRule(id="F2", category="folding", data="UniProt secondary structure", description="Substitution to glycine inside a helix or strand, or loss of glycine inside a turn."),
    MechanismRule(id="F3", category="folding", data="UniProt disulfide bond", description="The reference residue is a disulfide-bonded cysteine."),
    MechanismRule(id="F4", category="folding", data="ProtVar Missense3D", description="Missense3D reports structural damage."),
    MechanismRule(id="C1", category="catalytic_site", data="UniProt active site", description="Active site at the residue or a sequence neighbour."),
    MechanismRule(id="C2", category="catalytic_site", data="InterPro site", description="Active-site signature covering the residue."),
    MechanismRule(id="L1", category="ligand_binding", data="UniProt binding site", description="Binding site or DNA-binding region at, covering or next to the residue."),
    MechanismRule(id="L2", category="ligand_binding", data="InterPro site", description="Binding-site signature covering the residue."),
    MechanismRule(id="L3", category="ligand_binding", data="RCSB PDB ligand neighbours", description="A co-crystallised ligand has the residue among its neighbours."),
    MechanismRule(id="L4", category="ligand_binding", data="ProtVar pockets, P2Rank", description="The residue lines a predicted pocket."),
    MechanismRule(id="P1", category="protein_interaction", data="UniProt region, motif, site", description="Annotated interaction region covering the residue."),
    MechanismRule(id="P2", category="protein_interaction", data="ProtVar interfaces", description="The residue is in a predicted interface."),
    MechanismRule(id="P0", category="protein_interaction", data="IntAct", description="Curated partners of the protein, shown as context only."),
    MechanismRule(id="O1", category="localisation", data="UniProt signal, transit, topology", description="Signal, transit, transmembrane or intramembrane region covering the residue."),
    MechanismRule(id="O2", category="localisation", data="UniProt lipidation", description="Lipidation at the residue or a sequence neighbour."),
    MechanismRule(id="O3", category="localisation", data="UniProt motif", description="Targeting motif covering the residue."),
    MechanismRule(id="G1", category="signalling", data="UniProt modified residue", description="Modification site at the residue or a sequence neighbour."),
    MechanismRule(id="G2", category="signalling", data="UniProt motif", description="Short motif covering the residue."),
    MechanismRule(id="D1", category="domain_interface", data="UniProt domain", description="The residue is next to a domain boundary."),
    *[
        MechanismRule(
            id="T1",
            category=category,
            data="UniProt mutagenesis and natural variants",
            description="A statement at this residue contains a keyword of the category.",
        )
        for category in CATEGORIES
        if category != "domain_interface"
    ],
]

SUPPORT_ORDER: list[SupportKindInfo] = [
    SupportKindInfo(
        key="experimental_annotation",
        label="Experimental annotation",
        description="At least one raising record is an experimental observation: a structure, an assay or "
        "an annotation with experimental evidence.",
    ),
    SupportKindInfo(
        key="curated_annotation",
        label="Curated annotation",
        description="The strongest raising record is a curated database annotation without an experimental "
        "evidence code.",
    ),
    SupportKindInfo(
        key="computational_prediction",
        label="Computational prediction",
        description="Every raising record is a prediction or a sequence-signature match.",
    ),
]
_SUPPORT_RANK: dict[SupportKind, int] = {info.key: index for index, info in enumerate(SUPPORT_ORDER)}
_SUPPORT_LABEL: dict[SupportKind, str] = {info.key: info.label for info in SUPPORT_ORDER}
_PROXIMITY_RANK: dict[Proximity, int] = {
    "at_residue": 0,
    "structure_contact": 0,
    "covering_region": 1,
    "sequence_neighbour": 2,
    "protein_level": 3,
}

_KEYWORDS: dict[MechanismCategory, tuple[str, ...]] = {
    "stability": ("stability", "unstable", "degradation", "protein level", "expression", "half-life", "abundance"),
    "folding": ("folding", "misfold", "aggregat"),
    "catalytic_site": ("activity", "catalytic"),
    "ligand_binding": ("binding",),
    "protein_interaction": ("interaction", "interacts", "dimer", "oligomer", "complex"),
    "localisation": ("locali", "membrane", "translocation", "nuclear", "secretion", "trafficking", "cell surface"),
    "signalling": ("phosphorylation", "ubiquitin", "signaling", "signalling", "activation"),
}
_NEGATION = re.compile(r"\b(no effect|does not affect|do not affect|not affect|unaffected|no change|normal)\b", re.I)
_TARGETING = re.compile(r"nuclear locali[sz]ation|nuclear export|\bNLS\b|\bNES\b|sorting|retention|targeting", re.I)
_INTERACTION = re.compile(r"\binteract", re.I)
_PARTNER_BINDING = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-binding\b")


def _support(evidence_class: EvidenceClass) -> SupportKind:
    if evidence_class is EvidenceClass.EXPERIMENTAL:
        return "experimental_annotation"
    if evidence_class is EvidenceClass.COMPUTATIONAL_PREDICTION:
        return "computational_prediction"
    return "curated_annotation"


def _best_evidence(rows: Iterable[Evidence]) -> Evidence | None:
    return min(rows, key=lambda row: _SUPPORT_RANK[_support(row.evidence_class)], default=None)


def _distance(feature: Feature, position: int, *, linked: bool = False) -> int | None:
    """Residues between the variant and a feature; 0 inside it. A link feature is its two ends."""
    if feature.start is None or feature.end is None:
        return None
    if linked:
        return min(abs(position - feature.start), abs(position - feature.end))
    if feature.start <= position <= feature.end:
        return 0
    return min(abs(position - feature.start), abs(position - feature.end))


def _span(feature: Feature) -> str:
    return str(feature.start) if feature.start == feature.end else f"{feature.start}-{feature.end}"


class _Collector:
    """Observations per category, in rule order."""

    def __init__(self, position: int, reference: str, alternate: str | None) -> None:
        self.position = position
        self.reference = reference
        self.alternate = alternate
        self.rows: dict[MechanismCategory, list[MechanismObservation]] = {category: [] for category in CATEGORIES}

    def add(
        self,
        category: MechanismCategory,
        rule: str,
        key: str,
        summary: str,
        evidence: Evidence | None,
        proximity: Proximity,
        **fields: Any,
    ) -> None:
        if evidence is None:
            # No source record, no row: every statement must be traceable
            return
        self.rows[category].append(
            MechanismObservation(
                id=f"{category}:{rule}:{key}",
                rule=rule,
                summary=summary,
                proximity=proximity,
                support=_support(evidence.evidence_class),
                evidence_class=evidence.evidence_class,
                evidence=evidence,
                **fields,
            )
        )

    def feature(
        self,
        category: MechanismCategory,
        rule: str,
        feature: Feature,
        summary: str,
        *,
        window: int = 0,
        linked: bool = False,
        **fields: Any,
    ) -> bool:
        """Add a feature when it is at, covering or within `window` residues of the variant."""
        distance = _distance(feature, self.position, linked=linked)
        if distance is None or distance > window:
            return False
        single = feature.start == feature.end or linked
        proximity: Proximity = (
            "sequence_neighbour" if distance else ("at_residue" if single else "covering_region")
        )
        positions = (
            sorted({feature.start, feature.end})
            if linked
            else list(range(feature.start, feature.end + 1))
            if feature.end - feature.start < 60
            else []
        )
        where = (
            f", {distance} residue{'s' if distance != 1 else ''} from position {self.position} in sequence"
            if distance
            else ""
        )
        self.add(
            category,
            rule,
            feature.id,
            f"{summary}{where}.",
            _best_evidence(feature.evidence),
            proximity,
            source_statement=feature.description,
            sequence_distance=distance,
            positions=positions,
            range=None if linked else ResidueRange(start=feature.start, end=feature.end),
            **fields,
        )
        return True


def _features(protein: ProteinResponse) -> dict[str, list[Feature]]:
    by_type: dict[str, list[Feature]] = {}
    for track in protein.tracks:
        for feature in track.features:
            by_type.setdefault(f"{feature.source}:{feature.type}", []).append(feature)
    return by_type


def _feature_rules(collector: _Collector, protein: ProteinResponse, partner_symbols: dict[str, EntityRef]) -> None:
    position, reference, alternate = collector.position, collector.reference, collector.alternate
    residue = f"{three_letter(reference) or reference}{position}"
    by_type = _features(protein)

    def uniprot(*types: str) -> list[Feature]:
        return [feature for kind in types for feature in by_type.get(f"uniprot:{kind}", [])]

    for feature in uniprot("Helix", "Beta strand", "Turn"):
        element = feature.type.lower()
        if alternate == "P" and feature.type != "Turn":
            collector.feature("folding", "F1", feature, f"Proline replaces {residue} inside a UniProt {element} ({_span(feature)})")
        if alternate == "G" and feature.type != "Turn":
            collector.feature("folding", "F2", feature, f"Glycine replaces {residue} inside a UniProt {element} ({_span(feature)})")
        if reference == "G" and feature.type == "Turn":
            collector.feature("folding", "F2", feature, f"Glycine {position} inside a UniProt turn ({_span(feature)}) is replaced")
    if reference == "C":
        for feature in uniprot("Disulfide bond"):
            collector.feature(
                "folding", "F3", feature, f"Cys{position} forms a UniProt disulfide bond ({feature.start}-{feature.end})", linked=True
            )

    for feature in uniprot("Active site"):
        role = f" ({feature.description})" if feature.description else ""
        collector.feature("catalytic_site", "C1", feature, f"UniProt active site at {_span(feature)}{role}", window=NEIGHBOUR_WINDOW)
    for feature in by_type.get("interpro:active_site", []):
        collector.feature("catalytic_site", "C2", feature, f"InterPro active-site signature {feature.source_feature_id} covers {_span(feature)}")

    for feature in uniprot("Binding site", "DNA binding"):
        ligand = feature.ligand.name if feature.ligand else feature.description
        what = "DNA-binding region" if feature.type == "DNA binding" else "binding site"
        collector.feature(
            "ligand_binding",
            "L1",
            feature,
            f"UniProt {what} at {_span(feature)}{f' for {ligand}' if ligand else ''}",
            window=NEIGHBOUR_WINDOW,
        )
    for feature in by_type.get("interpro:binding_site", []):
        collector.feature("ligand_binding", "L2", feature, f"InterPro binding-site signature {feature.source_feature_id} covers {_span(feature)}")

    for feature in uniprot("Region", "Motif", "Site"):
        description = feature.description or ""
        partner = None
        match = _PARTNER_BINDING.search(description)
        if match and match.group(1) in partner_symbols:
            partner = partner_symbols[match.group(1)]
        if _INTERACTION.search(description) or partner is not None:
            collector.feature(
                "protein_interaction",
                "P1",
                feature,
                f"UniProt {feature.type.lower()} {_span(feature)}: {description}",
                partner=partner,
            )
        elif feature.type == "Motif":
            if _TARGETING.search(description):
                collector.feature("localisation", "O3", feature, f"UniProt motif {_span(feature)}: {description}")
            else:
                collector.feature("signalling", "G2", feature, f"UniProt motif {_span(feature)}: {description}")

    for feature in uniprot("Signal", "Transit peptide", "Transmembrane", "Intramembrane"):
        collector.feature("localisation", "O1", feature, f"UniProt {feature.type.lower()} region {_span(feature)}")
    for feature in uniprot("Lipidation"):
        collector.feature("localisation", "O2", feature, f"UniProt lipidation at {_span(feature)}: {feature.description}", window=NEIGHBOUR_WINDOW)

    for feature in uniprot("Modified residue", "Glycosylation"):
        collector.feature("signalling", "G1", feature, f"UniProt {feature.type.lower()} at {_span(feature)}: {feature.description}", window=NEIGHBOUR_WINDOW)
    for feature in uniprot("Cross-link"):
        collector.feature("signalling", "G1", feature, f"UniProt cross-link {feature.start}-{feature.end}: {feature.description}", linked=True)

    length = protein.sequence.length
    for feature in uniprot("Domain"):
        if feature.start is None or feature.end is None:
            continue
        for edge, name in ((feature.start, "start"), (feature.end, "end")):
            distance = abs(position - edge)
            if distance > DOMAIN_BOUNDARY_WINDOW or edge <= 1 or edge >= length:
                continue
            collector.add(
                "domain_interface",
                "D1",
                f"{feature.id}:{name}",
                f"{residue} is {distance} residue{'s' if distance != 1 else ''} from the {name} of the "
                f"UniProt {feature.description or ''} domain ({_span(feature)}).",
                _best_evidence(feature.evidence),
                "sequence_neighbour" if distance else "at_residue",
                source_statement=feature.description,
                sequence_distance=distance,
                positions=list(range(max(1, edge - DOMAIN_BOUNDARY_WINDOW), min(length, edge + DOMAIN_BOUNDARY_WINDOW) + 1)),
                range=ResidueRange(start=feature.start, end=feature.end),
            )

    for feature in uniprot("Mutagenesis", "Natural variant"):
        statement = feature.description or ""
        if feature.start != position or feature.end != position or not statement:
            continue
        lowered = statement.lower()
        negated = bool(_NEGATION.search(statement))
        same = alternate in feature.alternatives if alternate and feature.alternatives else None
        change = f"{feature.original or reference}{position}{'/'.join(feature.alternatives) or '?'}"
        hits = {category: next((word for word in words if word in lowered), None) for category, words in _KEYWORDS.items()}
        if hits["protein_interaction"]:
            hits["ligand_binding"] = None
        for category, word in hits.items():
            if word is None:
                continue
            prefix = "this substitution" if same else f"another substitution at this residue ({change})" if same is False else change
            collector.add(
                category,
                "T1",
                f"{feature.id}:{'/'.join(feature.alternatives)}",
                f"UniProt {feature.type.lower()} statement on {prefix} mentions \"{word}\""
                f"{'; it reports no effect' if negated else ''}.",
                _best_evidence(feature.evidence),
                "at_residue",
                source_statement=statement,
                sequence_distance=0,
                positions=[position],
                direction=EvidenceDirection.DISPUTES if negated else EvidenceDirection.SUPPORTS,
                raises_candidate=not negated,
                same_substitution=same,
            )


def _effect_rules(collector: _Collector, values: list[EffectValue]) -> None:
    position = collector.position
    residue = f"{three_letter(collector.reference) or collector.reference}{position}"
    for value in values:
        if value.state != "ok" or value.evidence is None:
            continue
        structure = value.structure
        on_structure = {
            "structure_id": structure.id if structure else None,
            "structure_origin": structure.origin if structure else None,
        }
        caveat = (
            f" The model's pLDDT at this residue is {structure.residue_plddt:.0f}."
            if structure and structure.residue_plddt is not None and structure.residue_plddt < 70
            else ""
        )
        if value.kind == "stability_ddg" and isinstance(value.value, (int, float)):
            bins = [row for row in value.thresholds if row.lower is not None and "unlikely" not in row.label]
            raising = bool(bins) and value.value >= min(row.lower for row in bins if row.lower is not None)
            bin_text = (
                f"{'at or above' if raising else 'below'} the {bins[0].lower:g} {value.unit or ''} bound of the "
                f"\"{bins[0].label}\" bin ({bins[0].defined_by})"
                if bins
                else "the source publishes no bin for this value"
            )
            collector.add(
                "stability",
                "S1",
                value.key,
                f"{value.tool or value.label} predicted ΔΔG {value.value:+.2f} {value.unit or ''}, {bin_text}.{caveat}",
                value.evidence,
                "at_residue",
                sequence_distance=0,
                positions=[position],
                metric=value.key,
                value=value.value,
                unit=value.unit,
                direction=EvidenceDirection.SUPPORTS if raising else EvidenceDirection.NEUTRAL,
                raises_candidate=raising,
                **on_structure,
            )
        elif value.key == "missense3d.prediction":
            verdict = str(value.source_class or value.value or "")
            raising = "damag" in verdict.lower() and "no " not in verdict.lower()
            feature = value.details.get("damaging_feature")
            collector.add(
                "folding",
                "F4",
                value.key,
                f"Missense3D prediction: {verdict}{f' ({feature})' if feature else ''}.{caveat}",
                value.evidence,
                "at_residue",
                source_statement=str(feature) if feature else None,
                sequence_distance=0,
                positions=[position],
                metric=value.key,
                value=verdict,
                direction=EvidenceDirection.SUPPORTS if raising else EvidenceDirection.NEUTRAL,
                raises_candidate=raising,
                **on_structure,
            )
        elif value.key.startswith("pocket."):
            residues = [int(number) for number in value.details.get("residues", []) if isinstance(number, int)]
            collector.add(
                "ligand_binding",
                "L4",
                value.key,
                f"{residue} lines {value.label.lower()} of the ProtVar pocket set "
                f"({len(residues)} residues, score {value.value:g} on {value.scale}).{caveat}",
                value.evidence,
                "at_residue",
                sequence_distance=0,
                positions=residues,
                metric=value.key,
                value=value.value,
                **on_structure,
            )
        elif value.key.startswith("interface."):
            collector.add(
                "protein_interaction",
                "P2",
                value.key,
                f"{value.label}: {value.value}{f' ({value.scale})' if value.scale else ''}.{caveat}",
                value.evidence,
                "at_residue",
                sequence_distance=0,
                positions=[position],
                metric=value.key,
                value=value.value,
                **on_structure,
            )


def _merge_sources(lists: Iterable[list[SourceStatus]]) -> list[SourceStatus]:
    order = [SourceState.OK, SourceState.EMPTY, SourceState.NOT_CONFIGURED, SourceState.DISABLED_BY_LICENSE, SourceState.UNAVAILABLE]
    merged: dict[str, SourceStatus] = {}
    for rows in lists:
        for row in rows:
            current = merged.get(row.source)
            if current is None or order.index(row.state) > order.index(current.state):
                merged[row.source] = row
    return list(merged.values())


async def _guard[T](label: str, call: Awaitable[T], warnings: list[str], timeout: float = CALL_TIMEOUT) -> T | None:
    try:
        return await asyncio.wait_for(call, timeout)
    except TimeoutError:
        warnings.append(f"{label} did not answer within {timeout:g} s; its rules were not applied.")
    except ApiError as error:
        warnings.append(f"{label} could not be read ({error.detail}); its rules were not applied.")
    except Exception as error:  # noqa: BLE001 - one failing input never fails the page
        logger.warning("Mechanism input %s failed: %s", label, error)
        warnings.append(f"{label} could not be read; its rules were not applied.")
    return None


def _candidate(
    category: MechanismCategory, rows: list[MechanismObservation], change: str, residue: str
) -> MechanismCandidate | None:
    raising = [row for row in rows if row.raises_candidate and row.direction is EvidenceDirection.SUPPORTS]
    if not raising:
        return None
    support = min((row.support for row in raising), key=_SUPPORT_RANK.__getitem__)
    strongest = [row for row in raising if row.support == support]
    ordered = sorted(
        rows,
        key=lambda row: (
            not (row.raises_candidate and row.direction is EvidenceDirection.SUPPORTS),
            _SUPPORT_RANK[row.support],
            _PROXIMITY_RANK[row.proximity],
        ),
    )
    ligands = [row.ligand for row in raising if row.ligand]
    contact = next((row for row in raising if row.proximity == "structure_contact"), None)
    partners: dict[str, EntityRef] = {row.partner.id: row.partner for row in rows if row.partner}
    limitations = []
    if all(row.proximity == "sequence_neighbour" for row in raising):
        limitations.append("Every raising record is a sequence neighbour; no record places it next to the residue in 3D.")
    if support == "computational_prediction":
        limitations.append("No experimental or curated record supports this candidate.")
    return MechanismCandidate(
        id=category,
        category=category,
        label=LABELS[category],
        rank=0,
        claim=CLAIMS[category].format(change=change, residue=residue),
        support=support,
        support_label=_SUPPORT_LABEL[support],
        confidence_basis=(
            f"{len(strongest)} of {len(raising)} raising record{'s' if len(raising) != 1 else ''} "
            f"{'is' if len(strongest) == 1 else 'are'} of kind \"{_SUPPORT_LABEL[support].lower()}\", "
            "the strongest kind present."
        ),
        observations=ordered,
        supporting_count=len(raising),
        disputing_count=sum(row.direction is EvidenceDirection.DISPUTES for row in rows),
        evidence_ids=list(dict.fromkeys(row.evidence.id for row in raising)),
        tests=TESTS[category],
        highlight=MechanismHighlight(
            positions=sorted({number for row in raising for number in row.positions}),
            structure_id=contact.structure_id if contact else None,
            structure_origin=contact.structure_origin if contact else None,
            ligands=ligands,
            partners=list(partners.values()),
        ),
        limitations=limitations,
    )


async def variant_mechanisms(
    variant_id: str, catalog: Catalog, session: AsyncSession, actor: Actor | None
) -> MechanismsResponse:
    query = parse_variant_query(variant_id)
    if query is None:
        raise BadRequest(
            f"'{variant_id}' is not a variant identifier. Use GENE-p.Arg28His or a ClinVar VCV accession.",
            code="variant_id_not_recognised",
        )
    base: dict[str, Any] = {
        "method": "Fixed rules over retrieved records. No language model and no score combined across sources.",
        "neighbour_window": NEIGHBOUR_WINDOW,
        "domain_boundary_window": DOMAIN_BOUNDARY_WINDOW,
        "support_order": SUPPORT_ORDER,
        "rules": RULES,
    }
    sources: list[list[SourceStatus]] = []
    if query.kind == "protein" and query.change is not None:
        symbol, gene, protein_ref, accession = resolve_gene(query.gene_symbol or "", catalog)
        change = query.change
        resolved_id = change.variant_id(symbol) or variant_id
        position, reference, alternate, hgvs_p = change.position, change.reference, change.alternate, change.hgvs_p
        single = change.kind == "substitution" and change.is_single_residue
    else:
        detail = await variant_detail(variant_id, catalog)
        sources.append(detail.sources)
        gene, protein_ref, resolved_id = detail.gene, detail.protein, detail.id
        accession = protein_ref.id if protein_ref else None
        position, reference, alternate, hgvs_p = (
            detail.position,
            detail.reference_residue,
            detail.alternate_residue,
            detail.protein_change,
        )
        single = detail.change_kind == "substitution" and alternate is not None

    identity: dict[str, Any] = {
        "variant_id": resolved_id,
        "gene": gene,
        "protein": protein_ref,
        "position": position,
        "reference": reference,
        "alternate": alternate,
        "protein_change": hgvs_p,
    }
    if accession is None:
        raise NotFound(f"{gene.id} has no UniProt accession in the catalog.", code="protein_unknown")
    if not single or position is None or reference is None or alternate in (None, "*"):
        return MechanismsResponse(
            **identity,
            **base,
            applicable=False,
            message="The rules read a single amino-acid substitution. This variant is not one, so no "
            "candidate mechanism is derived.",
            sources=_merge_sources(sources),
        )

    warnings: list[str] = []
    protein, effects, ledger, pockets, interactions = await asyncio.gather(
        _guard("UniProt and InterPro features", get_protein(accession, catalog), warnings),
        _guard("Effect values at the residue", residue_effects(accession, position, alternate, reference), warnings),
        _guard("The structure ledger", protein_structures(session, accession, actor, external_models=False), warnings),
        _guard("P2Rank pockets", protein_pockets(accession, None, position), warnings, POCKET_TIMEOUT),
        _guard("IntAct interactions", protein_interactions(accession, catalog), warnings),
    )
    if protein is not None and (position > protein.sequence.length or protein.sequence.value[position - 1] != reference):
        raise BadRequest(
            f"{hgvs_p} does not fit the UniProt sequence of {accession} at position {position}.",
            code="reference_residue_mismatch",
        )

    collector = _Collector(position, reference, alternate)
    not_checked: dict[MechanismCategory, list[str]] = {category: [] for category in CATEGORIES}

    partners = interactions.curated.partners if interactions else []
    partner_symbols = {row.partner_symbol: row.partner for row in partners if row.partner_symbol}
    if protein is not None:
        sources.append(protein.sources)
        _feature_rules(collector, protein, partner_symbols)
    else:
        for category in CATEGORIES:
            not_checked[category].append("UniProt and InterPro features")
    if effects is not None:
        sources.append(effects.sources)
        _effect_rules(collector, [value for group in effects.groups for value in group.values])
    else:
        for category in ("stability", "folding", "ligand_binding", "protein_interaction"):
            not_checked[category].append("ProtVar effect values")
    if interactions is not None:
        sources.append(interactions.sources)
    else:
        not_checked["protein_interaction"].append("IntAct partners")

    if ledger is not None:
        sources.append(ledger.sources)
        with_ligand = [
            entry
            for entry in sorted(ledger.experimental, key=lambda entry: entry.sifts_rank or 10**6)
            if any(not ligand.common_additive for ligand in entry.ligands)
            and any(
                any(region.start <= position <= region.end for region in chain.observed_regions)
                if chain.observed_regions
                else chain.unp_start <= position <= chain.unp_end
                for chain in entry.chains
            )
        ]
        covering = with_ligand[:MAX_LIGAND_STRUCTURES]
        bound = await asyncio.gather(
            *(
                _guard(f"Ligands of {entry.structure.id}", structure_ligands(entry.structure.id, accession), warnings, 25)
                for entry in covering
            )
        )
        for entry, ligands in zip(covering, bound, strict=True):
            if ligands is None:
                continue
            sources.append(ligands.sources)
            for ligand in ligands.ligands:
                if ligand.common_additive or position not in ligand.binding_site_positions:
                    continue
                nearest = min(
                    (
                        (residue.distance if residue.distance is not None else 99.0, instance)
                        for instance in ligand.instances
                        for residue in instance.residues
                        if residue.uniprot_position == position
                    ),
                    key=lambda pair: pair[0],
                    default=None,
                )
                distance = nearest[0] if nearest and nearest[0] < 99 else None
                instance = nearest[1] if nearest else None
                author_seq = instance.author_seq_id if instance else None
                reference_ligand = MechanismLigandRef(
                    structure_id=entry.structure.id,
                    comp_id=ligand.comp_id,
                    name=ligand.name,
                    chain_id=instance.chain_id if instance else None,
                    author_seq_id=int(author_seq) if author_seq and author_seq.lstrip("-").isdigit() else None,
                    distance=distance,
                    url=ligand.url,
                )
                collector.add(
                    "ligand_binding",
                    "L3",
                    f"{entry.structure.id}:{ligand.comp_id}",
                    f"In {entry.structure.id.removeprefix('pdb:')}, RCSB lists {three_letter(reference)}{position} as a "
                    f"neighbour of {ligand.comp_id}{f' ({ligand.name})' if ligand.name else ''}"
                    f"{f', shortest distance {distance:.1f} Å' if distance is not None else ''}.",
                    entry.evidence,
                    "structure_contact",
                    source_statement=entry.structure.title,
                    positions=ligand.binding_site_positions,
                    structure_id=entry.structure.id,
                    structure_origin=StructureOrigin.EXPERIMENTAL,
                    ligand=reference_ligand,
                    value=distance,
                    unit="Å" if distance is not None else None,
                )
        if len(with_ligand) > len(covering):
            warnings.append(
                f"Ligand neighbours were read for the {MAX_LIGAND_STRUCTURES} best SIFTS-ranked entries that cover "
                f"position {position} and carry a ligand; {len(with_ligand) - len(covering)} further entries were not read."
            )
    else:
        not_checked["ligand_binding"].append("Experimental structures and their ligands")

    if pockets is not None:
        sources.append(pockets.sources)
        if pockets.status == "ready":
            for pocket in pockets.pockets:
                if pocket.contains_residue:
                    probability = f", probability {pocket.probability:.2f}" if pocket.probability is not None else ""
                    collector.add(
                        "ligand_binding",
                        "L4",
                        f"p2rank:{pocket.id}",
                        f"{three_letter(reference) or reference}{position} lines P2Rank {pocket.name} of {pockets.structure_id} "
                        f"({len(pocket.positions)} residues{probability}).",
                        pocket.evidence,
                        "at_residue",
                        sequence_distance=0,
                        positions=pocket.positions,
                        metric="p2rank.probability",
                        value=pocket.probability,
                        structure_id=pockets.structure_id,
                        structure_origin=pockets.structure_origin,
                    )
        else:
            not_checked["ligand_binding"].append(f"P2Rank pockets ({pockets.status_detail or pockets.status})")
    else:
        not_checked["ligand_binding"].append("P2Rank pockets")

    if any(row.raises_candidate for row in collector.rows["protein_interaction"]):
        for partner in sorted(partners, key=lambda row: -row.evidence_count)[:MAX_CONTEXT_PARTNERS]:
            collector.add(
                "protein_interaction",
                "P0",
                f"intact:{partner.partner_id}",
                f"IntAct lists {partner.partner_symbol or partner.partner_id} as a curated partner of the protein "
                f"({partner.evidence_count} evidence row{'s' if partner.evidence_count != 1 else ''}). "
                "IntAct does not place this residue in the interaction.",
                partner.evidence,
                "protein_level",
                partner=partner.partner,
                raises_candidate=False,
                direction=EvidenceDirection.NEUTRAL,
            )

    change_text = f"{gene.id} {hgvs_p}"
    residue_text = f"{three_letter(reference) or reference}{position}"
    candidates = [
        candidate
        for category in CATEGORIES
        if (candidate := _candidate(category, collector.rows[category], change_text, residue_text)) is not None
    ]
    candidates.sort(
        key=lambda candidate: (
            _SUPPORT_RANK[candidate.support],
            min(
                _PROXIMITY_RANK[row.proximity]
                for row in candidate.observations
                if row.raises_candidate and row.direction is EvidenceDirection.SUPPORTS
            ),
            -candidate.supporting_count,
            CATEGORIES.index(candidate.category),
        )
    )
    for index, candidate in enumerate(candidates, start=1):
        candidate.rank = index
    raised = {candidate.category for candidate in candidates}
    unsupported = [
        UnsupportedCategory(
            category=category,
            label=LABELS[category],
            checked=CHECKED[category],
            not_checked=not_checked[category],
            observations=collector.rows[category],
        )
        for category in CATEGORIES
        if category not in raised
    ]

    limitations = [
        "A candidate is a question to test. It is not a finding about this variant.",
        "A category without a candidate means no retrieved record supports it; it does not rule the mechanism out.",
        f"A sequence neighbour is within {NEIGHBOUR_WINDOW} residues along the chain, which says nothing about "
        "distance in the folded protein.",
        "No retrieved source gives solvent accessibility, residue contacts between protein chains of an "
        "experimental complex, or contacts between domains, so those are not tested.",
    ]
    if effects is not None and effects.residue.plddt is not None and effects.residue.plddt < 70:
        limitations.append(
            f"The AlphaFold DB model has pLDDT {effects.residue.plddt:.0f} at this residue; predictions computed "
            "on the model are less reliable here."
        )
    return MechanismsResponse(
        **identity,
        **base,
        applicable=True,
        candidates=candidates,
        unsupported=unsupported,
        limitations=limitations,
        warnings=warnings,
        sources=_merge_sources(sources),
    )
