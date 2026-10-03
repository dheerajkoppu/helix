"""Predicted pockets for a protein: PrankWeb on its AlphaFold DB model or on a PDB entry."""

from helix.errors import BadRequest
from helix.evidence import try_build_evidence
from helix.identifiers import is_uniprot_accession, parse_structure_id
from helix.providers.base import Pocket, ProviderError, get_provider
from helix.providers.prankweb_pockets import PocketLookup, PrankWebPocketProvider
from helix.schemas.common import EntityRef, EntityType, EvidenceObject, StructureOrigin
from helix.schemas.pockets import (
    PocketMethod,
    PocketResidueRef,
    PocketsResponse,
    PredictedPocket,
)
from helix.sources.base import Gathered

RETRY_AFTER_SECONDS = 5


def _pocket(
    pocket: Pocket, lookup: PocketLookup, protein: EntityRef, structure_id: str, residue: int | None
) -> PredictedPocket:
    native = pocket.provider_native
    positions = sorted({item.position for item in pocket.residues})
    prediction = lookup.results.get("prediction")
    evidence = None
    if prediction is not None and prediction.provenance is not None:
        evidence = try_build_evidence(
            prediction.provenance,
            record_type="pocket",
            record_id=f"{lookup.database}/{lookup.identifier}#{pocket.id}",
            subject=protein,
            predicate="has_predicted_pocket",
            object=EvidenceObject(
                type="binding_site",
                id=f"{structure_id}#{pocket.id}",
                label=f"{pocket.id} of {structure_id}",
                value=native.get("probability"),
            ),
            strength_value=native.get("probability"),
        )
    return PredictedPocket(
        id=pocket.id,
        rank=pocket.rank,
        name=native.get("name") or pocket.id,
        probability=native.get("probability"),
        score=native.get("score"),
        center=pocket.center,
        residues=[
            PocketResidueRef(position=item.position, residue=item.residue, chain=item.chain)
            for item in pocket.residues
        ],
        positions=positions,
        structure_residues=native.get("structure_residues") or [],
        unmapped_residue_count=native.get("unmapped_residue_count") or 0,
        mean_plddt=native.get("mean_plddt"),
        contains_residue=(residue in positions) if residue is not None else None,
        evidence=evidence,
    )


async def protein_pockets(accession: str, structure_id: str | None, residue: int | None) -> PocketsResponse:
    accession = accession.strip().upper()
    if not is_uniprot_accession(accession):
        raise BadRequest(f"{accession} is not a UniProt accession.", code="invalid_accession")
    structure_id = structure_id or f"afdb:AF-{accession}-F1"
    parsed = parse_structure_id(structure_id)
    if parsed is None:
        raise BadRequest("structure_id must be pdb:<ID> or afdb:<entryId>.", code="invalid_structure_id")
    kind, value = parsed
    if kind == "afdb" and accession not in value.upper():
        raise BadRequest(
            f"AlphaFold DB entry {value} is not a model of {accession}.", code="structure_mismatch"
        )
    if kind == "pdb":
        structure_id = f"pdb:{value.upper()}"

    provider = get_provider("prankweb")
    assert isinstance(provider, PrankWebPocketProvider)
    try:
        lookup = await provider.lookup(structure_id, accession)
    except ProviderError as error:
        raise BadRequest(error.message, code=error.code) from error

    protein = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
    return PocketsResponse(
        protein=protein,
        structure_id=structure_id,
        structure_origin=(
            StructureOrigin.EXPERIMENTAL if kind == "pdb" else StructureOrigin.PREDICTED_EXTERNAL
        ),
        status=lookup.status,  # type: ignore[arg-type]
        status_detail=lookup.detail,
        retry_after_seconds=RETRY_AFTER_SECONDS if lookup.status == "pending" else None,
        method=PocketMethod(
            provider=provider.id,
            provider_name=provider.name,
            model_name=provider.model_name or "P2Rank",
            model_version=lookup.p2rank_version,
            service_url=provider.homepage,
        ),
        queried_residue=residue,
        pockets=[_pocket(pocket, lookup, protein, structure_id, residue) for pocket in lookup.pockets],
        limitations=list(provider.limitations),
        warnings=lookup.warnings,
        sources=Gathered(lookup.results).sources,
    )
