"""Side-chain properties of the 20 standard amino acids, from published tables.

Volume: Zamyatnin (1972). Volume, charge and polarity classes: the IMGT classes of Pommie et al.
(2004), whose volume classes are ranges of the Zamyatnin volumes. Hydropathy: Kyte and Doolittle
(1982). These describe the amino acids, never a measurement on a particular protein.
"""

from orphafold.identifiers import AMINO_ACID_1_TO_3
from orphafold.schemas.common import Citation
from orphafold.schemas.compare import PropertyChange, ResidueProperties

PROPERTY_SOURCES = [
    Citation(
        text="Zamyatnin AA, Prog Biophys Mol Biol (1972) 24:107-123",
        title="Protein volume in solution",
        year=1972,
        doi="10.1016/0079-6107(72)90005-3",
    ),
    Citation(
        text="Pommie C et al., J Mol Recognit (2004) 17:17-32",
        title="IMGT standardized criteria for statistical analysis of immunoglobulin V-REGION "
        "amino acid properties",
        year=2004,
        doi="10.1002/jmr.647",
    ),
    Citation(
        text="Kyte J, Doolittle RF, J Mol Biol (1982) 157:105-132",
        title="A simple method for displaying the hydropathic character of a protein",
        year=1982,
        doi="10.1016/0022-2836(82)90515-0",
    ),
]

# residue: (volume in cubic angstroms, Kyte-Doolittle hydropathy)
_VALUES: dict[str, tuple[float, float]] = {
    "A": (88.6, 1.8), "R": (173.4, -4.5), "N": (114.1, -3.5), "D": (111.1, -3.5), "C": (108.5, 2.5),
    "Q": (143.8, -3.5), "E": (138.4, -3.5), "G": (60.1, -0.4), "H": (153.2, -3.2), "I": (166.7, 4.5),
    "L": (166.7, 3.8), "K": (168.6, -3.9), "M": (162.9, 1.9), "F": (189.9, 2.8), "P": (112.7, -1.6),
    "S": (89.0, -0.8), "T": (116.1, -0.7), "W": (227.8, -0.9), "Y": (193.6, -1.3), "V": (140.0, 4.2),
}  # fmt: skip

_VOLUME_CLASSES = {
    "very_small": "AGS",
    "small": "NDCPT",
    "medium": "QEHV",
    "large": "RILKM",
    "very_large": "FWY",
}
_CHARGE_CLASSES = {"positive": "RHK", "negative": "DE"}
_POLAR = frozenset("RNDQEHKSTY")


def residue_properties(residue: str) -> ResidueProperties | None:
    """Properties of one standard amino acid (one-letter code); None for anything else."""
    values = _VALUES.get(residue)
    if values is None:
        return None
    volume, hydropathy = values
    return ResidueProperties(
        residue=residue,
        name=AMINO_ACID_1_TO_3[residue],
        volume_a3=volume,
        volume_class=next(name for name, members in _VOLUME_CLASSES.items() if residue in members),
        charge_class=next(
            (name for name, members in _CHARGE_CLASSES.items() if residue in members), "uncharged"
        ),
        polarity_class="polar" if residue in _POLAR else "nonpolar",
        hydropathy=hydropathy,
    )


def property_change(reference: str, alternate: str) -> PropertyChange | None:
    before = residue_properties(reference)
    after = residue_properties(alternate)
    if before is None or after is None:
        return None
    return PropertyChange(
        reference=before,
        variant=after,
        volume_change_a3=round(after.volume_a3 - before.volume_a3, 1),
        hydropathy_change=round(after.hydropathy - before.hydropathy, 1),
        charge_changed=before.charge_class != after.charge_class,
        polarity_changed=before.polarity_class != after.polarity_class,
        volume_class_changed=before.volume_class != after.volume_class,
        sources=list(PROPERTY_SOURCES),
    )
