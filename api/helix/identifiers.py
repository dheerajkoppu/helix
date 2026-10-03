"""URL-facing identifier formats shared by resolvers, routers and jobs.

gene: HGNC symbol. protein: UniProt accession. variant: GENE-p.Ref3PosAlt3 for protein
substitutions, ClinVar VCV accession otherwise. structure: pdb:<ID>, afdb:<entryId>, of:<job_id>.
Residue numbering is UniProt canonical everywhere.
"""

import re
from dataclasses import dataclass

UNIPROT_ACCESSION_PATTERN = r"[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}"
UNIPROT_ACCESSION_RE = re.compile(rf"^(?:{UNIPROT_ACCESSION_PATTERN})$")
HGNC_ID_RE = re.compile(r"^HGNC:\d+$")
CLINVAR_VCV_RE = re.compile(r"^VCV\d{9}(?:\.\d+)?$", re.IGNORECASE)
RSID_RE = re.compile(r"^rs\d+$", re.IGNORECASE)
INCHIKEY_RE = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$")
CHEMBL_ID_RE = re.compile(r"^CHEMBL\d+$", re.IGNORECASE)

AMINO_ACID_3_TO_1 = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
    "His": "H", "Ile": "I", "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
    "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V", "Sec": "U", "Pyl": "O", "Ter": "*",
}  # fmt: skip
AMINO_ACID_1_TO_3 = {one: three for three, one in AMINO_ACID_3_TO_1.items()}

_RESIDUE = "|".join([*AMINO_ACID_3_TO_1, r"[A-Z]", r"\*"])
_PROTEIN_CHANGE_RE = re.compile(rf"^(?:p\.)?\(?({_RESIDUE})(\d+)({_RESIDUE})\)?$", re.IGNORECASE)
_VARIANT_ID_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9-]*?)-p\.(.+)$")


def is_uniprot_accession(value: str) -> bool:
    return bool(UNIPROT_ACCESSION_RE.match(value))


def _one_letter(residue: str) -> str | None:
    if len(residue) == 1:
        letter = residue.upper()
        return letter if letter in AMINO_ACID_1_TO_3 else None
    return AMINO_ACID_3_TO_1.get(residue.capitalize())


@dataclass(frozen=True, slots=True)
class ProteinSubstitution:
    """Single-residue protein change in UniProt canonical numbering (one-letter codes, * for stop)."""

    reference: str
    position: int
    alternate: str
    gene_symbol: str | None = None

    @property
    def hgvs_p(self) -> str:
        """Three-letter HGVS protein change, e.g. p.Arg28His."""
        return f"p.{AMINO_ACID_1_TO_3[self.reference]}{self.position}{AMINO_ACID_1_TO_3[self.alternate]}"

    @property
    def short(self) -> str:
        """One-letter form, e.g. R28H."""
        return f"{self.reference}{self.position}{self.alternate}"

    @property
    def variant_id(self) -> str | None:
        """URL-facing variant ID, e.g. BTK-p.Arg28His. None without a gene symbol."""
        return f"{self.gene_symbol}-{self.hgvs_p}" if self.gene_symbol else None

    def apply(self, sequence: str) -> str:
        """Variant sequence. Raises ValueError when the reference residue does not match."""
        if not 1 <= self.position <= len(sequence):
            raise ValueError(f"position {self.position} is outside the sequence (length {len(sequence)})")
        found = sequence[self.position - 1]
        if found != self.reference:
            raise ValueError(f"reference residue at {self.position} is {found}, not {self.reference}")
        if self.alternate == "*":
            return sequence[: self.position - 1]
        return sequence[: self.position - 1] + self.alternate + sequence[self.position :]


def parse_protein_change(text: str, gene_symbol: str | None = None) -> ProteinSubstitution | None:
    """Parse p.Arg28His, Arg28His, R28H or p.R28H. Returns None when the text is not a substitution."""
    match = _PROTEIN_CHANGE_RE.match(text.strip())
    if not match:
        return None
    reference = _one_letter(match.group(1))
    alternate = _one_letter(match.group(3))
    if reference is None or alternate is None or reference == "*":
        return None
    return ProteinSubstitution(reference, int(match.group(2)), alternate, gene_symbol)


def parse_variant_id(variant_id: str) -> ProteinSubstitution | None:
    """Parse a GENE-p.Ref3PosAlt3 variant ID. Returns None for VCV accessions and other forms."""
    match = _VARIANT_ID_RE.match(variant_id.strip())
    if not match:
        return None
    return parse_protein_change(match.group(2), gene_symbol=match.group(1).upper())


def structure_id(kind: str, value: str) -> str:
    """Build a structure ID: structure_id('afdb', 'AF-Q06187-F1') -> 'afdb:AF-Q06187-F1'."""
    if kind not in ("pdb", "afdb", "of"):
        raise ValueError(f"unknown structure ID kind: {kind}")
    return f"{kind}:{value.upper() if kind == 'pdb' else value}"


def parse_structure_id(value: str) -> tuple[str, str] | None:
    """Split pdb:<ID>, afdb:<entryId> or of:<job_id> into (kind, identifier)."""
    kind, separator, identifier = value.partition(":")
    if not separator or kind not in ("pdb", "afdb", "of") or not identifier:
        return None
    return kind, identifier
