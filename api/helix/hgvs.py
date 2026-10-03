"""Parsing and normalisation of protein changes and variant identifiers. Pure functions only.

Protein positions are UniProt canonical numbering once a change has been checked against the
canonical sequence with check_reference(). Three-letter HGVS (p.Arg28His) is the stored form;
one-letter input (R28H) is accepted and normalised.
"""

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from helix.identifiers import AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1, CLINVAR_VCV_RE, RSID_RE

ChangeKind = Literal[
    "substitution",
    "nonsense",
    "synonymous",
    "frameshift",
    "deletion",
    "duplication",
    "insertion",
    "delins",
    "extension",
    "start_lost",
    "other",
]

_THREE = "|".join(AMINO_ACID_3_TO_1)
_AA = rf"(?:{_THREE}|[A-Z*])"
_SUBSTITUTION_RE = re.compile(rf"^({_AA})(\d+)({_AA}|=|\?)$")
_FRAMESHIFT_RE = re.compile(rf"^({_AA})(\d+)({_AA})?fs(.*)$")
_RANGE_RE = re.compile(rf"^({_AA})(\d+)(?:_({_AA})(\d+))?(delins|del|dup|ins)(.*)$")
_EXTENSION_RE = re.compile(rf"^({_AA})(\d+)({_AA})?ext(.*)$")
_THREE_TOKEN_RE = re.compile(_THREE)
_TITLE_RE = re.compile(
    r"^(?P<transcript>[A-Z]{2}_\d+(?:\.\d+)?)(?:\((?P<gene>[^)]+)\))?:(?P<change>\S+)(?:\s+\((?P<protein>p\.[^)]+)\))?$"
)
_GENE_SYMBOL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,39}$")
_SPDI_RE = re.compile(r"^(?P<sequence>[^:]+):(?P<position>\d+):(?P<deleted>[ACGTN]*):(?P<inserted>[ACGTN]*)$")


def one_letter(residue: str) -> str | None:
    """One-letter code for Arg, arg, R or *. None for anything else."""
    if len(residue) == 1:
        letter = residue.upper()
        return letter if letter in AMINO_ACID_1_TO_3 else None
    return AMINO_ACID_3_TO_1.get(residue.capitalize())


def three_letter(residue: str) -> str | None:
    letter = one_letter(residue)
    return AMINO_ACID_1_TO_3[letter] if letter else None


def to_one_letter(hgvs_p: str) -> str:
    """p.Arg28His -> R28H, p.Asn526GlufsTer5 -> N526Efs*5. The p. prefix is dropped."""
    body = hgvs_p.removeprefix("p.").strip("()")
    return _THREE_TOKEN_RE.sub(lambda match: AMINO_ACID_3_TO_1[match.group(0)], body)


def _canonical_case(body: str) -> str:
    """Give three-letter codes typed in any case their HGVS capitalisation."""
    return re.sub(
        _THREE,
        lambda match: match.group(0).capitalize(),
        body,
        flags=re.IGNORECASE,
    )


@dataclass(frozen=True, slots=True)
class ProteinChange:
    """A protein-level change. Residues are one-letter codes, * for stop."""

    kind: ChangeKind
    hgvs_p: str
    short: str
    position: int | None = None
    end_position: int | None = None
    reference: str | None = None
    alternate: str | None = None

    @property
    def is_single_residue(self) -> bool:
        """Missense, nonsense or synonymous change at one residue with a known alternate."""
        return self.kind in ("substitution", "nonsense", "synonymous") and self.alternate is not None

    @property
    def key(self) -> tuple[int, str, str] | None:
        """Join key between sources for single-residue changes."""
        if not self.is_single_residue or self.position is None:
            return None
        return (self.position, self.reference or "", self.alternate or "")

    def variant_id(self, gene_symbol: str) -> str | None:
        """GENE-p.Ref3PosAlt3 for single-residue changes, None otherwise."""
        return f"{gene_symbol}-{self.hgvs_p}" if self.is_single_residue else None


def parse_protein_hgvs(text: str | None) -> ProteinChange | None:
    """Parse p.Arg28His, R28H, NP_000052.1:p.(Arg525Gln), p.Asn526GlufsTer5, p.Glu7del, p.Met1?.

    Returns None for text that is not a protein change.
    """
    if not text:
        return None
    body = text.strip()
    if ":" in body:
        body = body.rsplit(":", 1)[1]
    body = body.removeprefix("p.").removeprefix("P.").replace("(", "").replace(")", "").strip()
    if not body:
        return None
    if len(body) > 3 and not body[:3].isalpha():
        body = body[0].upper() + body[1:]
    body = _canonical_case(body) if not _SUBSTITUTION_RE.match(body) else body

    match = _SUBSTITUTION_RE.match(body)
    if match:
        reference, alternate_text = one_letter(match.group(1)), match.group(3)
        position = int(match.group(2))
        if reference is None or reference == "*":
            return None
        reference_3 = AMINO_ACID_1_TO_3[reference]
        if alternate_text == "?":
            kind: ChangeKind = "start_lost" if position == 1 else "other"
            return ProteinChange(
                kind, f"p.{reference_3}{position}?", f"{reference}{position}?", position, position, reference
            )
        alternate = reference if alternate_text == "=" else one_letter(alternate_text)
        if alternate is None:
            return None
        if alternate == reference:
            return ProteinChange(
                "synonymous",
                f"p.{reference_3}{position}=",
                f"{reference}{position}=",
                position,
                position,
                reference,
                alternate,
            )
        kind = "nonsense" if alternate == "*" else "substitution"
        return ProteinChange(
            kind,
            f"p.{reference_3}{position}{AMINO_ACID_1_TO_3[alternate]}",
            f"{reference}{position}{alternate}",
            position,
            position,
            reference,
            alternate,
        )

    for pattern, fixed_kind in ((_FRAMESHIFT_RE, "frameshift"), (_EXTENSION_RE, "extension")):
        match = pattern.match(body)
        if match:
            reference = one_letter(match.group(1))
            position = int(match.group(2))
            return ProteinChange(
                fixed_kind,  # type: ignore[arg-type]
                f"p.{_three_letter_body(body)}",
                to_one_letter(_three_letter_body(body)),
                position,
                position,
                reference,
            )

    match = _RANGE_RE.match(body)
    if match:
        kinds: dict[str, ChangeKind] = {
            "del": "deletion",
            "dup": "duplication",
            "ins": "insertion",
            "delins": "delins",
        }
        position = int(match.group(2))
        end_position = int(match.group(4)) if match.group(4) else position
        return ProteinChange(
            kinds[match.group(5)],
            f"p.{_three_letter_body(body)}",
            to_one_letter(_three_letter_body(body)),
            position,
            end_position,
            one_letter(match.group(1)),
        )
    return None


def _three_letter_body(body: str) -> str:
    """Expand a leading one-letter residue so the stored form is three-letter HGVS."""
    if _THREE_TOKEN_RE.match(body):
        return body
    expanded = AMINO_ACID_1_TO_3.get(body[0])
    return f"{expanded}{body[1:]}" if expanded else body


@dataclass(frozen=True, slots=True)
class ClinVarTitle:
    transcript: str | None
    gene_symbol: str | None
    change: str | None
    protein: str | None

    @property
    def hgvs_c(self) -> str | None:
        """Versioned transcript HGVS, e.g. NM_000061.3:c.1574G>A."""
        if self.transcript and self.change and self.change.startswith(("c.", "n.")):
            return f"{self.transcript}:{self.change}"
        return None

    @property
    def hgvs_g(self) -> str | None:
        if self.transcript and self.change and self.change.startswith(("g.", "m.")):
            return f"{self.transcript}:{self.change}"
        return None


def parse_clinvar_title(title: str | None) -> ClinVarTitle:
    """Split 'NM_000061.3(BTK):c.1574G>A (p.Arg525Gln)' into transcript, gene, change and protein."""
    match = _TITLE_RE.match((title or "").strip())
    if not match:
        return ClinVarTitle(None, None, None, None)
    return ClinVarTitle(
        match.group("transcript"), match.group("gene"), match.group("change"), match.group("protein")
    )


@dataclass(frozen=True, slots=True)
class VariantQuery:
    """What a variant identifier typed by a user or carried in a URL refers to."""

    kind: Literal["vcv", "rsid", "variation_id", "protein"]
    value: str
    gene_symbol: str | None = None
    change: ProteinChange | None = None


def is_gene_symbol(text: str) -> bool:
    return bool(_GENE_SYMBOL_RE.match(text))


def parse_variant_query(text: str) -> VariantQuery | None:
    """Recognise VCV000011342, rs128620183, a ClinVar variation ID, BTK-p.Arg28His, BTK-R28H,
    BTK:p.R28H and 'BTK p.Arg28His'. Returns None for anything else."""
    value = text.strip()
    if CLINVAR_VCV_RE.match(value):
        return VariantQuery("vcv", value.upper().split(".")[0])
    if RSID_RE.match(value):
        return VariantQuery("rsid", value.lower())
    if value.isdigit():
        return VariantQuery("variation_id", value)
    for match in re.finditer(r"[-:\s]", value):
        gene, rest = value[: match.start()], value[match.end() :].strip()
        if not gene or not is_gene_symbol(gene):
            continue
        change = parse_protein_hgvs(rest)
        if change is not None:
            symbol = gene if any(character.islower() for character in gene[1:]) and "orf" in gene else gene.upper()
            return VariantQuery("protein", change.hgvs_p, symbol, change)
    return None


def vcv_to_variation_id(vcv: str) -> str:
    """VCV000011342.16 -> 11342 (the accession number is the ClinVar Variation ID)."""
    return str(int(vcv.upper().removeprefix("VCV").split(".")[0]))


@dataclass(frozen=True, slots=True)
class ReferenceCheck:
    status: Literal["match", "mismatch", "out_of_range", "not_checked"]
    position: int | None = None
    expected: str | None = None
    found: str | None = None
    sequence_length: int | None = None
    message: str | None = None


def check_reference(change: ProteinChange, sequence: str | None, accession: str | None) -> ReferenceCheck:
    """Compare the reference residue of a change with the UniProt canonical sequence."""
    if not sequence or change.position is None or change.reference is None:
        return ReferenceCheck(
            "not_checked",
            position=change.position,
            expected=change.reference,
            message="No UniProt canonical sequence was available to check the reference residue.",
        )
    label = f"UniProt {accession}" if accession else "the UniProt canonical sequence"
    if not 1 <= change.position <= len(sequence):
        return ReferenceCheck(
            "out_of_range",
            position=change.position,
            expected=change.reference,
            sequence_length=len(sequence),
            message=f"Position {change.position} is outside {label}, which has {len(sequence)} residues.",
        )
    found = sequence[change.position - 1]
    if found != change.reference:
        return ReferenceCheck(
            "mismatch",
            position=change.position,
            expected=change.reference,
            found=found,
            sequence_length=len(sequence),
            message=(
                f"Residue {change.position} of {label} is {AMINO_ACID_1_TO_3.get(found, found)} ({found}), "
                f"not {AMINO_ACID_1_TO_3.get(change.reference, change.reference)} ({change.reference})."
            ),
        )
    return ReferenceCheck(
        "match",
        position=change.position,
        expected=change.reference,
        found=found,
        sequence_length=len(sequence),
    )


def spdi_to_gnomad_id(spdi: str | None, chromosome: str | None) -> str | None:
    """NC_000023.11:101354686:C:T + X -> X-101354687-C-T. Single-nucleotide changes only: an indel
    SPDI is not left-aligned with an anchor base the way a gnomAD variant ID is."""
    match = _SPDI_RE.match(spdi or "")
    if not match or not chromosome:
        return None
    deleted, inserted = match.group("deleted"), match.group("inserted")
    if len(deleted) != 1 or len(inserted) != 1:
        return None
    return f"{chromosome}-{int(match.group('position')) + 1}-{deleted}-{inserted}"


def sha512t24u(blob: bytes) -> str:
    """GA4GH truncated digest: SHA-512, first 24 bytes, base64url."""
    return base64.urlsafe_b64encode(hashlib.sha512(blob).digest()[:24]).decode("ascii")


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def refget_accession(sequence: str) -> str:
    return "SQ." + sha512t24u(sequence.encode("ascii"))


def protein_substitution_vrs_id(reference_sequence: str, position: int, alternate: str) -> str:
    """GA4GH VRS 2.x Allele ID of a single-residue substitution on a protein sequence."""
    location = {
        "type": "SequenceLocation",
        "sequenceReference": {
            "type": "SequenceReference",
            "refgetAccession": refget_accession(reference_sequence),
        },
        "start": position - 1,
        "end": position,
    }
    allele = {
        "type": "Allele",
        "location": sha512t24u(_canonical_json(location)),
        "state": {"type": "LiteralSequenceExpression", "sequence": alternate},
    }
    return "ga4gh:VA." + sha512t24u(_canonical_json(allele))


_SIGNIFICANCE_TERMS = {
    "pathogenic": "pathogenic",
    "likely pathogenic": "likely_pathogenic",
    "uncertain significance": "uncertain_significance",
    "likely benign": "likely_benign",
    "benign": "benign",
    "conflicting classifications of pathogenicity": "conflicting",
    "conflicting interpretations of pathogenicity": "conflicting",
}

SIGNIFICANCE_KEYS = (
    "pathogenic",
    "likely_pathogenic",
    "uncertain_significance",
    "likely_benign",
    "benign",
    "conflicting",
    "other",
    "not_classified",
)


def significance_keys(description: str | None) -> tuple[str, ...]:
    """Filter keys for a ClinVar germline classification. 'Pathogenic/Likely pathogenic' carries
    both keys; a description outside the five-tier terms is 'other'; no classification is
    'not_classified'."""
    if not description or not description.strip():
        return ("not_classified",)
    keys: list[str] = []
    for part in re.split(r"[/;]", description.lower()):
        term = part.split(",")[0].strip()
        key = _SIGNIFICANCE_TERMS.get(term)
        if key and key not in keys:
            keys.append(key)
    return tuple(keys) or ("other",)


def normalise_consequence(term: str | None) -> str | None:
    """Lower-case consequence term with underscores, e.g. 'missense variant' -> missense_variant."""
    if not term or not term.strip():
        return None
    return re.sub(r"[\s-]+", "_", term.strip().lower())
