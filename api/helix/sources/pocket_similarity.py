"""Pocket-level comparison between a protein and a structurally similar one.

This module registers no adapter of its own. It is the comparison step that sits on top of what the
other adapters report, and it is kept here, beside `foldseek`, because it is part of the same
structural-similarity source: Foldseek says the folds are alike, this says what the pockets share.

What it compares, and on what evidence:

- the residue correspondence comes from the Foldseek alignment of the two structures
  (`FoldHit.residue_map`), never from guessing that two proteins use the same numbering;
- pocket residues on both sides come from PrankWeb's P2Rank prediction on the AlphaFold DB model of
  each protein, which is already in UniProt numbering;
- the ligands come from RCSB PDB: molecules actually observed bound in an experimental entry of the
  similar protein, with the residues RCSB lists as contacting them.

It produces no similarity score. It counts residues and names what is shared in plain sentences.
"""

from dataclasses import dataclass, field

# Side-chain chemistry groups, used only to say what kind of residue a shared position is
RESIDUE_GROUPS: dict[str, str] = {
    **dict.fromkeys("AVLIMFWPG", "hydrophobic"),
    **dict.fromkeys("STNQCY", "polar"),
    **dict.fromkeys("KRH", "positively charged"),
    **dict.fromkeys("DE", "negatively charged"),
}
AROMATIC = frozenset("FWYH")


@dataclass(frozen=True, slots=True)
class PocketResidueMatch:
    """One residue of the subject pocket and the residue of the similar protein it aligns to."""

    subject_position: int
    subject_residue: str | None
    analogue_position: int
    analogue_residue: str | None
    in_analogue_pocket: bool
    ligand_comp_ids: tuple[str, ...] = ()

    @property
    def same_residue(self) -> bool:
        return (
            self.subject_residue is not None
            and self.analogue_residue is not None
            and self.subject_residue.upper() == self.analogue_residue.upper()
        )


@dataclass(slots=True)
class PocketMatch:
    """One subject pocket matched against the best-aligning pocket of the similar protein."""

    subject_pocket_id: str
    subject_pocket_probability: float | None
    subject_positions: list[int]
    analogue_pocket_id: str | None = None
    analogue_pocket_probability: float | None = None
    analogue_positions: list[int] = field(default_factory=list)
    matches: list[PocketResidueMatch] = field(default_factory=list)

    @property
    def aligned_count(self) -> int:
        return len(self.matches)

    @property
    def in_pocket_count(self) -> int:
        return sum(1 for match in self.matches if match.in_analogue_pocket)

    @property
    def identical_count(self) -> int:
        return sum(1 for match in self.matches if match.same_residue)

    @property
    def ligand_contact_count(self) -> int:
        return sum(1 for match in self.matches if match.ligand_comp_ids)

    @property
    def ligand_comp_ids(self) -> list[str]:
        return sorted({comp_id for match in self.matches for comp_id in match.ligand_comp_ids})


def residue_chemistry(residues: list[str | None]) -> list[str]:
    """Plain description of the side-chain chemistry present, most common first."""
    counts: dict[str, int] = {}
    aromatic = 0
    for residue in residues:
        if not residue:
            continue
        letter = residue.upper()
        group = RESIDUE_GROUPS.get(letter)
        if group:
            counts[group] = counts.get(group, 0) + 1
        if letter in AROMATIC:
            aromatic += 1
    described = [f"{count} {group}" for group, count in sorted(counts.items(), key=lambda row: -row[1])]
    if aromatic:
        described.append(f"{aromatic} aromatic")
    return described


def match_pocket(
    subject_pocket_id: str,
    subject_pocket_probability: float | None,
    subject_positions: list[int],
    subject_residues: dict[int, str | None],
    correspondence: dict[int, tuple[int, str, str]],
    analogue_pockets: list[tuple[str, float | None, set[int]]],
    ligand_positions: dict[int, tuple[str, ...]],
) -> PocketMatch:
    """Map one subject pocket onto the similar protein and pick the analogue pocket it best overlaps.

    correspondence: subject position -> (analogue position, subject residue, analogue residue), from
    the Foldseek alignment. analogue_pockets: (pocket id, probability, positions) for the analogue.
    ligand_positions: analogue position -> component IDs of ligands observed in contact with it.
    "Best" means the analogue pocket holding the most of the aligned subject pocket residues; ties
    go to the higher P2Rank probability. No pocket is chosen when none holds any of them.
    """
    aligned: dict[int, tuple[int, str, str]] = {
        position: correspondence[position] for position in subject_positions if position in correspondence
    }
    best_id: str | None = None
    best_probability: float | None = None
    best_positions: set[int] = set()
    best_overlap = 0
    for pocket_id, probability, positions in analogue_pockets:
        overlap = sum(1 for mapped, _, _ in aligned.values() if mapped in positions)
        if overlap > best_overlap or (
            overlap == best_overlap and overlap > 0 and (probability or 0) > (best_probability or 0)
        ):
            best_id, best_probability, best_positions, best_overlap = (
                pocket_id,
                probability,
                positions,
                overlap,
            )
    matches = [
        PocketResidueMatch(
            subject_position=position,
            subject_residue=subject_residues.get(position) or subject_letter,
            analogue_position=mapped,
            analogue_residue=analogue_letter,
            in_analogue_pocket=mapped in best_positions,
            ligand_comp_ids=ligand_positions.get(mapped, ()),
        )
        for position, (mapped, subject_letter, analogue_letter) in sorted(aligned.items())
    ]
    return PocketMatch(
        subject_pocket_id=subject_pocket_id,
        subject_pocket_probability=subject_pocket_probability,
        subject_positions=sorted(subject_positions),
        analogue_pocket_id=best_id if best_overlap else None,
        analogue_pocket_probability=best_probability if best_overlap else None,
        analogue_positions=sorted(best_positions) if best_overlap else [],
        matches=matches,
    )


def pocket_shares(match: PocketMatch, analogue_label: str) -> list[str]:
    """What the two pockets share, one plain sentence per claim. Says nothing it did not count."""
    total = len(match.subject_positions)
    shares: list[str] = []
    if not match.matches:
        shares.append(
            f"No residue of {match.subject_pocket_id} lines up with a residue of {analogue_label} "
            "in this alignment, so the two pockets cannot be compared residue by residue."
        )
        return shares
    shares.append(
        f"{match.aligned_count} of the {total} residues lining {match.subject_pocket_id} line up with "
        f"a residue of {analogue_label} in the fold alignment."
    )
    if match.analogue_pocket_id:
        shares.append(
            f"{match.in_pocket_count} of them land in {match.analogue_pocket_id}, a pocket predicted "
            f"on {analogue_label}."
        )
    if match.identical_count:
        shares.append(f"{match.identical_count} of them are the same amino acid in both proteins.")
    chemistry = residue_chemistry([item.analogue_residue for item in match.matches])
    if chemistry:
        shares.append(f"The matching residues on {analogue_label} are {', '.join(chemistry)}.")
    if match.ligand_comp_ids:
        shares.append(
            f"{match.ligand_contact_count} of them contact "
            f"{_list_phrase(match.ligand_comp_ids)}, observed bound to {analogue_label} in an "
            "experimental structure."
        )
    return shares


def fold_shares(
    analogue_label: str,
    *,
    evalue: float | None,
    bit_score: float | None,
    sequence_identity: float | None,
    aligned_length: int | None,
    subject_length: int | None,
    mode: str,
    query_start: int | None = None,
    query_end: int | None = None,
) -> list[str]:
    """What the two folds share, naming each measure. One plain sentence per claim."""
    shares: list[str] = []
    if aligned_length:
        # alnLength counts alignment columns, gaps included, so it can exceed the subject's length
        covered = (
            f" covering residues {query_start} to {query_end} of the subject"
            if query_start and query_end
            else ""
        )
        of_length = f", a protein of {subject_length} residues" if subject_length else ""
        shares.append(
            f"Foldseek's alignment to {analogue_label} spans {int(aligned_length)} columns"
            f"{covered}{of_length}."
        )
    if evalue is not None:
        shares.append(
            f"Foldseek reports an E-value of {_format_evalue(evalue)} for that alignment "
            f"(lower means less likely to be a chance resemblance) and search mode {mode}."
        )
    if bit_score is not None:
        shares.append(f"Its bit score is {bit_score:g} (higher means a stronger alignment).")
    if sequence_identity is not None:
        shares.append(
            f"The two sequences are {sequence_identity:g}% identical over the aligned part, so the "
            "resemblance is "
            + (
                "expected from sequence alone."
                if sequence_identity >= 30
                else "structural rather than sequence-level."
            )
        )
    return shares


def _format_evalue(value: float) -> str:
    if value == 0:
        return "0 (below the smallest value the service reports)"
    if value < 1e-4:
        return f"{value:.1e}"
    return f"{value:g}"


def _list_phrase(items: list[str]) -> str:
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + f" and {items[-1]}"


CAVEATS = (
    "A resemblance of fold or pocket is not a measured binding event: no molecule has been tested "
    "against the subject protein here.",
    "Pockets on both sides are P2Rank predictions on predicted structures, not observed binding sites.",
    "Two proteins can share a pocket and still differ at the residues that decide whether a molecule binds.",
    "The residue correspondence comes from one structural alignment; a different alignment can pair "
    "different residues.",
)

RESIDUE_CORRESPONDENCE_RULE = (
    "Subject positions were mapped onto the similar protein through the Foldseek structural "
    "alignment of the two models, column by column, skipping every column where either side has a "
    "gap. Both proteins are numbered as in their UniProt canonical sequence, which is the numbering "
    "of their AlphaFold DB models."
)
