"""Geometric difference between a reference model and a variant model of the same construct.

Everything here is geometry computed from two predicted models: superposition on C-alpha atoms,
RMSD, per-residue displacement, contacts and neighbours of the substituted residue. It reports no
damage or stability score, and the pLDDT of the two models is never subtracted.
"""

from dataclasses import dataclass
from typing import Any

import gemmi
import numpy as np

from helix.analysis.properties import property_change
from helix.hashing import sha256_hex
from helix.ids import utcnow
from helix.schemas.common import ResidueRange
from helix.schemas.compare import (
    GEOMETRY_LABEL,
    ComparisonCaveat,
    ComparisonConstruct,
    ComparisonModel,
    ComparisonProvider,
    ComparisonVariant,
    ContactChanges,
    DifferencePayload,
    DifferenceSummary,
    GlobalDifference,
    LocalDifference,
    Masking,
    Neighbourhood,
    NeighbourResidue,
    ResidueDifference,
    RigidTransform,
    SiteConfidence,
    SiteContact,
    Superposition,
)

PLDDT_THRESHOLD = 70.0
CONTACT_CUTOFF = 4.0
NEIGHBOUR_RADIUS = 8.0
MIN_FIT_RESIDUES = 10

FIT_METHOD = "Least-squares rigid-body fit (Kabsch) of the variant model onto the reference model"


class DifferenceError(Exception):
    """The two models cannot be compared residue by residue."""


@dataclass(slots=True)
class ModelCoordinates:
    """One chain: per-residue C-alpha positions and heavy atoms, indexed from the construct start."""

    sequence: str
    ca: np.ndarray
    heavy: list[tuple[list[str], np.ndarray]]


@dataclass(slots=True)
class ModelInput:
    structure_id: str
    file: str
    cif_text: str
    sequence: str
    plddt: list[float]


def read_model(cif_text: str) -> ModelCoordinates:
    structure = gemmi.make_structure_from_block(gemmi.cif.read_string(cif_text).sole_block())
    if len(structure) == 0 or len(structure[0]) != 1:
        raise DifferenceError("A comparison needs models with exactly one chain.")
    names: list[str] = []
    ca: list[list[float]] = []
    heavy: list[tuple[list[str], np.ndarray]] = []
    for residue in structure[0][0]:
        atom = residue.find_atom("CA", "*")
        if atom is None:
            raise DifferenceError(f"Residue {residue.seqid.num} has no C-alpha atom.")
        names.append(residue.name)
        ca.append([atom.pos.x, atom.pos.y, atom.pos.z])
        atoms = [item for item in residue if not item.is_hydrogen()]
        heavy.append(
            (
                [item.name for item in atoms],
                np.array([[item.pos.x, item.pos.y, item.pos.z] for item in atoms], dtype=float),
            )
        )
    return ModelCoordinates(
        sequence=gemmi.one_letter_code(names).upper(), ca=np.array(ca, dtype=float), heavy=heavy
    )


def kabsch(mobile: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Rotation and translation that place mobile on target: x' = R . x + t."""
    mobile_centre = mobile.mean(axis=0)
    target_centre = target.mean(axis=0)
    covariance = (mobile - mobile_centre).T @ (target - target_centre)
    left, _, right_transposed = np.linalg.svd(covariance)
    handedness = np.sign(np.linalg.det(right_transposed.T @ left.T))
    rotation = right_transposed.T @ np.diag([1.0, 1.0, handedness]) @ left.T
    return rotation, target_centre - rotation @ mobile_centre


def _rmsd(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.sqrt(((first - second) ** 2).sum(axis=1).mean()))


def _band(score: float) -> str:
    if score >= 90:
        return "very_high"
    if score >= PLDDT_THRESHOLD:
        return "confident"
    return "low" if score >= 50 else "very_low"


def _ranges(positions: list[int]) -> list[ResidueRange]:
    ranges: list[ResidueRange] = []
    for position in positions:
        if ranges and position == ranges[-1].end + 1:
            ranges[-1].end = position
        else:
            ranges.append(ResidueRange(start=position, end=position))
    return ranges


def _site_contacts(
    model: ModelCoordinates, site: int, start: int, plddt: list[float]
) -> dict[int, SiteContact]:
    """Residues with a heavy atom within the cutoff of a heavy atom of the site residue. The two
    residues bonded to the site in sequence are left out: they are always within the cutoff."""
    site_names, site_atoms = model.heavy[site]
    contacts: dict[int, SiteContact] = {}
    for index, (names, atoms) in enumerate(model.heavy):
        if abs(index - site) <= 1 or len(atoms) == 0:
            continue
        distances = np.linalg.norm(site_atoms[:, None, :] - atoms[None, :, :], axis=2)
        closest = np.unravel_index(int(distances.argmin()), distances.shape)
        minimum = float(distances[closest])
        if minimum <= CONTACT_CUTOFF:
            contacts[start + index] = SiteContact(
                position=start + index,
                residue=model.sequence[index],
                min_distance=round(minimum, 2),
                site_atom=site_names[closest[0]],
                partner_atom=names[closest[1]],
                plddt=plddt[index],
            )
    return contacts


def compute_difference(
    *,
    reference: ModelInput,
    variant_model: ModelInput,
    variant: ComparisonVariant,
    construct: ComparisonConstruct,
    provider: ComparisonProvider,
    caveats: list[ComparisonCaveat],
    job_id: str | None = None,
) -> DifferencePayload:
    first = read_model(reference.cif_text)
    second = read_model(variant_model.cif_text)
    count = construct.length
    if len(first.ca) != count or len(second.ca) != count:
        raise DifferenceError(
            f"The models have {len(first.ca)} and {len(second.ca)} residues; the construct has {count}."
        )
    if len(reference.plddt) != count or len(variant_model.plddt) != count:
        raise DifferenceError("Both models need one pLDDT value per residue of the construct.")
    if first.sequence != reference.sequence or second.sequence != variant_model.sequence:
        raise DifferenceError("The coordinates do not match the sequences that were submitted.")
    site = variant.position - construct.start
    if not 0 <= site < count:
        raise DifferenceError(f"Residue {variant.position} is outside the construct.")
    mismatches = [index for index in range(count) if first.sequence[index] != second.sequence[index]]
    if mismatches != [site]:
        raise DifferenceError("The two sequences must differ at the variant position only.")
    if first.sequence[site] != variant.reference or second.sequence[site] != variant.alternate:
        raise DifferenceError("The residues at the variant position do not match the variant.")

    plddt_reference = np.array(reference.plddt, dtype=float)
    plddt_variant = np.array(variant_model.plddt, dtype=float)
    confident = (plddt_reference >= PLDDT_THRESHOLD) & (plddt_variant >= PLDDT_THRESHOLD)
    confident_count = int(confident.sum())
    masked = ~confident

    if confident_count >= MIN_FIT_RESIDUES:
        fit_set = confident
        scope_rule = "confident_in_both"
        scope = (
            f"C-alpha atoms of the {confident_count} residues with pLDDT of at least "
            f"{PLDDT_THRESHOLD:g} in both models"
        )
    else:
        fit_set = np.ones(count, dtype=bool)
        scope_rule = "all_residues"
        scope = (
            f"C-alpha atoms of all {count} residues: fewer than {MIN_FIT_RESIDUES} residues reach "
            f"pLDDT {PLDDT_THRESHOLD:g} in both models"
        )
    rotation, translation = kabsch(second.ca[fit_set], first.ca[fit_set])
    placed = second.ca @ rotation.T + translation
    displacement = np.linalg.norm(placed - first.ca, axis=1)

    reference_distance = np.linalg.norm(first.ca - first.ca[site], axis=1)
    variant_distance = np.linalg.norm(second.ca - second.ca[site], axis=1)
    near_reference = reference_distance <= NEIGHBOUR_RADIUS
    near_variant = variant_distance <= NEIGHBOUR_RADIUS

    local_fit: float | None = None
    if int(near_reference.sum()) >= 3:
        local_rotation, local_translation = kabsch(second.ca[near_reference], first.ca[near_reference])
        local_fit = _rmsd(
            second.ca[near_reference] @ local_rotation.T + local_translation, first.ca[near_reference]
        )

    start = construct.start
    reference_contacts = _site_contacts(first, site, start, reference.plddt)
    variant_contacts = _site_contacts(second, site, start, variant_model.plddt)
    gained = sorted(set(variant_contacts) - set(reference_contacts))
    lost = sorted(set(reference_contacts) - set(variant_contacts))
    kept = sorted(set(reference_contacts) & set(variant_contacts))
    contact_positions = sorted(set(reference_contacts) | set(variant_contacts))

    def rounded(value: float) -> float:
        return round(float(value), 3)

    masked_positions = [start + index for index in range(count) if masked[index]]
    site_masked = bool(masked[site])
    global_difference = GlobalDifference(
        rmsd_ca_all=rounded(_rmsd(placed, first.ca)),
        residues_all=count,
        rmsd_ca_confident=rounded(_rmsd(placed[confident], first.ca[confident])) if confident_count else None,
        residues_confident=confident_count,
    )
    local_difference = LocalDifference(
        radius=NEIGHBOUR_RADIUS,
        centre_position=variant.position,
        scope=(
            f"C-alpha atoms within {NEIGHBOUR_RADIUS:g} angstroms of the C-alpha of residue "
            f"{variant.position} in the reference model, the site included"
        ),
        residues=int(near_reference.sum()),
        rmsd_ca_global_fit=rounded(_rmsd(placed[near_reference], first.ca[near_reference])),
        rmsd_ca_local_fit=rounded(local_fit) if local_fit is not None else None,
    )
    site_confidence = SiteConfidence(
        position=variant.position,
        plddt_reference=reference.plddt[site],
        plddt_variant=variant_model.plddt[site],
        band_reference=_band(reference.plddt[site]),  # type: ignore[arg-type]
        band_variant=_band(variant_model.plddt[site]),  # type: ignore[arg-type]
        confident_in_both=not site_masked,
        ca_displacement=None if site_masked else rounded(displacement[site]),
    )
    summary = DifferenceSummary(
        rmsd_ca_all=global_difference.rmsd_ca_all,
        rmsd_ca_confident=global_difference.rmsd_ca_confident,
        residues_confident=confident_count,
        local_rmsd_ca=local_difference.rmsd_ca_global_fit,
        plddt_site_reference=site_confidence.plddt_reference,
        plddt_site_variant=site_confidence.plddt_variant,
        contacts_gained=len(gained),
        contacts_lost=len(lost),
        masked_residues=len(masked_positions),
        total_residues=count,
    )

    return DifferencePayload(
        generated_at=utcnow(),
        job_id=job_id,
        variant=variant,
        construct=construct,
        provider=provider,
        models=[
            ComparisonModel(
                role="reference",
                structure_id=reference.structure_id,
                file=reference.file,
                sequence_sha256=sha256_hex(reference.sequence),
                residues=count,
                plddt_mean=round(float(plddt_reference.mean()), 2),
            ),
            ComparisonModel(
                role="variant",
                structure_id=variant_model.structure_id,
                file=variant_model.file,
                sequence_sha256=sha256_hex(variant_model.sequence),
                residues=count,
                plddt_mean=round(float(plddt_variant.mean()), 2),
            ),
        ],
        superposition=Superposition(
            method=FIT_METHOD,
            scope_rule=scope_rule,  # type: ignore[arg-type]
            scope=scope,
            residues_used=int(fit_set.sum()),
            rmsd=rounded(_rmsd(placed[fit_set], first.ca[fit_set])),
            transform=RigidTransform(
                rotation=[[round(float(value), 6) for value in row] for row in rotation],
                translation=[round(float(value), 4) for value in translation],
            ),
        ),
        global_difference=global_difference,
        local_difference=local_difference,
        site=site_confidence,
        contacts=ContactChanges(
            cutoff=CONTACT_CUTOFF,
            exclusion="The residues bonded to the site in sequence (positions -1 and +1) are left out.",
            label=GEOMETRY_LABEL,
            reference=[reference_contacts[position] for position in sorted(reference_contacts)],
            variant=[variant_contacts[position] for position in sorted(variant_contacts)],
            gained=gained,
            lost=lost,
            kept=kept,
            low_confidence_positions=[position for position in contact_positions if masked[position - start]],
        ),
        neighbours=Neighbourhood(
            radius=NEIGHBOUR_RADIUS,
            label=GEOMETRY_LABEL,
            residues=[
                NeighbourResidue(
                    position=start + index,
                    residue=first.sequence[index],
                    ca_distance_reference=rounded(reference_distance[index]),
                    ca_distance_variant=rounded(variant_distance[index]),
                    within_reference=bool(near_reference[index]),
                    within_variant=bool(near_variant[index]),
                    plddt_reference=reference.plddt[index],
                    plddt_variant=variant_model.plddt[index],
                    masked=bool(masked[index]),
                )
                for index in range(count)
                if index != site and (near_reference[index] or near_variant[index])
            ],
        ),
        masking=Masking(
            plddt_threshold=PLDDT_THRESHOLD,
            rule=(
                f"A residue is masked when either model has pLDDT below {PLDDT_THRESHOLD:g} there. "
                "Masked residues carry no displacement."
            ),
            masked_residues=len(masked_positions),
            total_residues=count,
            masked_ranges=_ranges(masked_positions),
        ),
        per_residue=[
            ResidueDifference(
                position=start + index,
                reference_residue=first.sequence[index],
                variant_residue=second.sequence[index],
                plddt_reference=reference.plddt[index],
                plddt_variant=variant_model.plddt[index],
                masked=bool(masked[index]),
                ca_displacement=None if masked[index] else rounded(displacement[index]),
            )
            for index in range(count)
        ],
        property_change=_properties(variant),
        summary=summary,
        caveats=caveats,
        software={"gemmi": gemmi.__version__, "numpy": np.__version__},
    )


def _properties(variant: ComparisonVariant) -> Any:
    change = property_change(variant.reference, variant.alternate)
    if change is None:
        raise DifferenceError("Property tables cover the 20 standard amino acids only.")
    return change
