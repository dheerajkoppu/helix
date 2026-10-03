"""Schemas for /proteins: entry, feature tracks, residue lookup."""

from typing import Any

from pydantic import Field

from helix.schemas.common import Aggregated, EntityRef, Evidence, Provenance, Schema


class ProteinNames(Schema):
    recommended: str | None = None
    short_names: list[str] = Field(default_factory=list)
    alternative: list[str] = Field(default_factory=list)
    ec_numbers: list[str] = Field(default_factory=list)


class ProteinSequence(Schema):
    value: str
    length: int
    mass_da: int | None = Field(default=None, description="Molecular weight in daltons, as UniProt states it")
    md5: str = Field(description="MD5 of the sequence, lower-case hex")
    crc64: str | None = None
    version: int | None = Field(default=None, description="UniProt sequence version")


class TextAnnotation(Schema):
    """A statement in the source's own words, with the evidence the source attaches to it."""

    text: str
    molecule: str | None = Field(default=None, description="Isoform or chain the statement applies to")
    evidence: list[Evidence] = Field(default_factory=list)


class SubcellularLocation(Schema):
    location: str
    location_id: str | None = Field(default=None, description="UniProt subcellular location ID, e.g. SL-0086")
    topology: str | None = None
    molecule: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class Isoform(Schema):
    id: str = Field(description="UniProt isoform ID, e.g. Q06187-1")
    name: str | None = None
    synonyms: list[str] = Field(default_factory=list)
    sequence_status: str | None = Field(default=None, description="Displayed, Described, External or Not described")
    is_canonical: bool = False
    note: str | None = None


class CrossReference(Schema):
    id: str
    properties: dict[str, str] = Field(default_factory=dict)
    isoform_id: str | None = None


class CrossReferenceGroup(Schema):
    database: str
    count: int
    items: list[CrossReference]


class FeatureLigand(Schema):
    name: str
    id: str | None = Field(default=None, description="ChEBI CURIE when UniProt gives one")
    label: str | None = None
    note: str | None = None
    url: str | None = None


class Feature(Schema):
    """One positional annotation. Positions are UniProt canonical residue numbers."""

    id: str
    track: str
    source: str = Field(description="Source adapter ID: uniprot or interpro")
    type: str = Field(description="The source's own feature type, e.g. Domain, Binding site, family")
    start: int | None = None
    end: int | None = None
    start_modifier: str | None = Field(default=None, description="EXACT, OUTSIDE or UNKNOWN (UniProt)")
    end_modifier: str | None = None
    description: str | None = None
    source_feature_id: str | None = Field(default=None, description="e.g. VAR_006216, PRO_0000088065, IPR000719")
    url: str | None = None
    ligand: FeatureLigand | None = None
    original: str | None = Field(default=None, description="Reference residues of a variant or mutagenesis")
    alternatives: list[str] = Field(default_factory=list)
    variant_id: str | None = Field(default=None, description="GENE-p.Ref3PosAlt3 for a single substitution")
    cross_references: list[str] = Field(default_factory=list, description="CURIEs the source attaches, e.g. dbSNP:rs128620183")
    signatures: list[dict[str, Any]] = Field(default_factory=list, description="InterPro member database signatures")
    evidence: list[Evidence] = Field(default_factory=list)


class FeatureTrack(Schema):
    id: str
    label: str
    source: str
    source_name: str
    count: int
    features: list[Feature]


class InterProEntry(Schema):
    accession: str
    name: str | None = None
    type: str | None = None
    url: str | None = None
    locations: list[dict[str, Any]] = Field(default_factory=list)
    signatures: list[dict[str, Any]] = Field(default_factory=list)
    go_terms: list[dict[str, Any]] = Field(default_factory=list)
    evidence: Evidence | None = None


class ProteinResponse(Aggregated):
    protein: EntityRef
    accession: str
    secondary_accessions: list[str] = Field(default_factory=list)
    entry_name: str | None = None
    reviewed: bool | None = Field(default=None, description="Swiss-Prot (true) or TrEMBL (false)")
    annotation_score: float | None = None
    protein_existence: str | None = None
    entry_version: int | None = None
    last_annotation_update: str | None = None
    names: ProteinNames
    gene: EntityRef | None = None
    gene_synonyms: list[str] = Field(default_factory=list)
    in_catalog: bool = False
    organism: str | None = None
    taxon_id: int | None = None
    sequence: ProteinSequence
    function: list[TextAnnotation] = Field(default_factory=list)
    catalytic_activity: list[TextAnnotation] = Field(default_factory=list)
    subunit: list[TextAnnotation] = Field(default_factory=list)
    family: list[TextAnnotation] = Field(
        default_factory=list, description="UniProt sequence similarity statements ('Belongs to the ...')"
    )
    subcellular_locations: list[SubcellularLocation] = Field(default_factory=list)
    isoforms: list[Isoform] = Field(default_factory=list)
    cross_references: list[CrossReferenceGroup] = Field(default_factory=list)
    tracks: list[FeatureTrack] = Field(
        default_factory=list, description="UniProt feature tracks, then InterPro tracks. Empty tracks are omitted"
    )
    interpro_entries: list[InterProEntry] = Field(default_factory=list)
    interpro_family: list[InterProEntry] = Field(
        default_factory=list, description="InterPro entries of type family"
    )
    provenance: Provenance | None = Field(default=None, description="The UniProt entry request")
    interpro_provenance: Provenance | None = None


class ResidueResponse(Aggregated):
    protein: EntityRef
    gene: EntityRef | None = None
    position: int
    sequence_length: int
    amino_acid: str = Field(description="One-letter code at this position of the canonical sequence")
    amino_acid_three: str | None = None
    amino_acid_name: str | None = None
    window_start: int
    window: str = Field(description="Canonical sequence around the position, starting at window_start")
    feature_count: int
    tracks: list[FeatureTrack] = Field(
        default_factory=list, description="Features covering the position, grouped as on the protein"
    )
    interpro_entries: list[InterProEntry] = Field(default_factory=list)
    provenance: Provenance | None = None
