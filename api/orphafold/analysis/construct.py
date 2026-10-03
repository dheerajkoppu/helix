"""Choice of the residue range submitted to a structure predictor.

A protein within the provider limit is predicted full length. A longer one is predicted as a
window around the variant site: the UniProt domain containing the site with a short flank, or a
window centred on the site when no domain fits.
"""

from orphafold.schemas.compare import ComparisonConstruct, ConstructDomain

DOMAIN_FLANK = 10


def choose_construct(
    *,
    protein_length: int,
    position: int,
    domains: list[ConstructDomain],
    max_residues: int | None,
    uniprot_accession: str | None = None,
) -> ComparisonConstruct:
    if max_residues is None or protein_length <= max_residues:
        limit = f"the provider limit of {max_residues}" if max_residues else "no provider length limit"
        return ComparisonConstruct(
            uniprot_accession=uniprot_accession,
            start=1,
            end=protein_length,
            length=protein_length,
            protein_length=protein_length,
            full_length=True,
            rule="full_length",
            rationale=f"Full-length protein: {protein_length} residues, within {limit}.",
            max_residues=max_residues,
        )

    containing = sorted(
        (domain for domain in domains if domain.start <= position <= domain.end),
        key=lambda domain: domain.end - domain.start,
    )
    fitting = [domain for domain in containing if domain.end - domain.start + 1 <= max_residues]
    if fitting:
        domain = fitting[0]
        spare = max_residues - (domain.end - domain.start + 1)
        flank = min(DOMAIN_FLANK, spare // 2)
        start = max(1, domain.start - flank)
        end = min(protein_length, domain.end + flank)
        return ComparisonConstruct(
            uniprot_accession=uniprot_accession,
            start=start,
            end=end,
            length=end - start + 1,
            protein_length=protein_length,
            full_length=False,
            rule="uniprot_domain",
            rationale=(
                f"The protein has {protein_length} residues, above the provider limit of {max_residues}. "
                f"Residue {position} lies in the UniProt domain {domain.name} ({domain.start}-{domain.end}); "
                f"the construct is that domain with up to {flank} flanking residues on each side."
            ),
            domain=domain,
            flank=flank,
            max_residues=max_residues,
        )

    start = max(1, position - max_residues // 2)
    end = min(protein_length, start + max_residues - 1)
    start = max(1, end - max_residues + 1)
    reason = (
        f"the UniProt domain containing it ({containing[0].name}, {containing[0].start}-{containing[0].end}) "
        "is longer than the limit"
        if containing
        else "no UniProt domain feature contains it"
    )
    return ComparisonConstruct(
        uniprot_accession=uniprot_accession,
        start=start,
        end=end,
        length=end - start + 1,
        protein_length=protein_length,
        full_length=False,
        rule="centred_window",
        rationale=(
            f"The protein has {protein_length} residues, above the provider limit of {max_residues}. "
            f"For residue {position} {reason}, so the construct is a window of {end - start + 1} residues "
            "centred on the site. Its ends do not follow domain boundaries."
        ),
        max_residues=max_residues,
    )


def user_construct(
    *,
    protein_length: int,
    start: int,
    end: int,
    max_residues: int | None,
    uniprot_accession: str | None = None,
) -> ComparisonConstruct:
    return ComparisonConstruct(
        uniprot_accession=uniprot_accession,
        start=start,
        end=end,
        length=end - start + 1,
        protein_length=protein_length,
        full_length=start == 1 and end == protein_length,
        rule="user_window",
        rationale=f"Residue window {start}-{end} chosen in the request.",
        max_residues=max_residues,
    )
