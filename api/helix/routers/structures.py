from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from helix.deps import ArtifactStoreDep, OptionalActor, SessionDep
from helix.errors import PROBLEM_RESPONSES
from helix.schemas.common import StructureDescriptor
from helix.schemas.structures import (
    ResidueMap,
    StructureConfidence,
    StructureFileFormat,
    StructureLedger,
    StructureLigands,
)
from helix.services import structures as service

router = APIRouter(tags=["structures"], responses=PROBLEM_RESPONSES)

AccessionQuery = Annotated[
    str | None,
    Query(description="UniProt accession to report on when the entry contains several proteins"),
]


@router.get(
    "/proteins/{accession}/structures",
    response_model=StructureLedger,
    summary="Structure ledger of a protein, grouped by origin",
)
async def get_protein_structures(
    accession: str,
    session: SessionDep,
    actor: OptionalActor,
    external_models: Annotated[
        bool, Query(description="Also list models of other providers from 3D-Beacons")
    ] = True,
) -> StructureLedger:
    return await service.protein_structures(session, accession, actor, external_models=external_models)


@router.get("/structures/{structure_id}", response_model=StructureDescriptor, summary="Describe a structure")
async def get_structure(
    structure_id: str, session: SessionDep, accession: AccessionQuery = None
) -> StructureDescriptor:
    return await service.structure_descriptor(session, structure_id, accession)


@router.get(
    "/structures/{structure_id}/file",
    summary="Coordinate file of a structure",
    responses={
        200: {
            "content": {
                "application/octet-stream": {},
                "chemical/x-mmcif": {},
                "chemical/x-pdb": {},
            },
            "description": "The file, cached by Helix",
        },
        304: {"description": "Not modified"},
    },
)
async def get_structure_file(
    structure_id: str,
    request: Request,
    session: SessionDep,
    store: ArtifactStoreDep,
    file_format: Annotated[StructureFileFormat, Query(alias="format")] = "bcif",
    download: Annotated[bool, Query(description="Send as an attachment")] = False,
) -> Response:
    file = await service.structure_file(session, store, structure_id, file_format)
    etag = f'"{file.etag}"'
    disposition = "attachment" if download else "inline"
    headers = {
        "ETag": etag,
        "Cache-Control": file.cache_control,
        "Content-Disposition": f'{disposition}; filename="{file.filename}"',
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "ETag, Content-Disposition, Content-Length",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
    }
    if etag in request.headers.get("if-none-match", ""):
        return Response(status_code=304, headers=headers)
    return Response(content=file.content, media_type=file.media_type, headers=headers)


@router.get(
    "/structures/{structure_id}/confidence",
    response_model=StructureConfidence,
    summary="Per-residue pLDDT (0-100) and the PAE matrix of a predicted model",
)
async def get_structure_confidence(
    structure_id: str,
    session: SessionDep,
    store: ArtifactStoreDep,
    pae: Annotated[bool, Query(description="Include the PAE matrix")] = True,
) -> StructureConfidence:
    return await service.structure_confidence(session, store, structure_id, include_pae=pae)


@router.get(
    "/structures/{structure_id}/residue-map",
    response_model=ResidueMap,
    summary="UniProt numbering to chain, entity and author numbering",
)
async def get_structure_residue_map(
    structure_id: str, session: SessionDep, accession: AccessionQuery = None
) -> ResidueMap:
    return await service.structure_residue_map(session, structure_id, accession)


@router.get(
    "/structures/{structure_id}/ligands",
    response_model=StructureLigands,
    summary="Bound non-solvent ligands and their neighbouring residues in UniProt numbering",
)
async def get_structure_ligands(structure_id: str, accession: AccessionQuery = None) -> StructureLigands:
    return await service.structure_ligands(structure_id, accession)
