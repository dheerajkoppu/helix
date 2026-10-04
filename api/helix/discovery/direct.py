"""Edges that link the subject disease straight to a molecule, and the held-out mode.

Three kinds of edge are a shortcut from the subject's disease to a molecule:

| kind                      | source                               | how it is handled           |
| ------------------------- | ------------------------------------ | --------------------------- |
| open_targets_disease_drug | Open Targets drugs for the disease   | read, then withheld or used |
| chembl_indication         | ChEMBL drug_indication for it        | read, then withheld or used |
| literature_co_mention     | a paper naming disease and molecule  | never read, always withheld |

None of the five bridges ever sources a candidate from one of these edges: a candidate always comes
from a protein-to-molecule record. So `exclude_direct=true` really removes the shortcut rather than
reordering it - with the edges gone, a molecule can only appear if a bridge found it.

With `exclude_direct=false` the edges are used, but only to ADD a claim to a chain a bridge already
built ("this molecule is studied for this disease") and to name the disease the molecule comes from.
They never create a candidate and never change the order.
"""

import asyncio
from typing import Any

from helix.discovery.context import DirectEdge
from helix.evidence import try_build_evidence
from helix.knowledge.catalog import SeedDisease, SeedGene
from helix.log import get_logger
from helix.schemas.common import EntityRef, Evidence, EvidenceObject
from helix.schemas.discovery import WithheldEdge
from helix.sources.base import SourceResult
from helix.sources.open_targets import open_targets

logger = get_logger(__name__)

OPEN_TARGETS_TIMEOUT = 25.0
MAX_IDENTIFIERS = 2

LITERATURE_EDGE = WithheldEdge(
    kind="literature_co_mention",
    source="Europe PMC",
    detail=(
        "Papers that name this disease and a molecule together are not read by the discovery engine at all, "
        "in either mode, so they can never be the reason a molecule is suggested."
    ),
)


async def disease_drug_edges(
    disease: SeedDisease | None, gene: SeedGene | None
) -> tuple[list[DirectEdge], dict[str, SourceResult[Any]], dict[str, dict[str, Any]], list[WithheldEdge]]:
    """Open Targets drugs indicated for the subject's own disease, through every cross-reference it has."""
    if disease is None:
        return [], {}, {}, []
    identifiers = [str(value) for value in (*disease.xrefs.mondo, *disease.xrefs.orphanet) if value][
        :MAX_IDENTIFIERS
    ]
    if not identifiers:
        return [], {}, {}, []
    results: dict[str, SourceResult[Any]] = {}
    rows: list[dict[str, Any]] = []
    identifier = identifiers[0]
    provenance = None
    targets = [gene.ensembl_gene_id] if gene and gene.ensembl_gene_id else []
    for candidate in identifiers:
        try:
            result = await asyncio.wait_for(
                open_targets.disease_drugs(candidate, targets), OPEN_TARGETS_TIMEOUT
            )
        except Exception as error:  # noqa: BLE001 - never fails the request
            logger.info("Open Targets disease drugs for %s were not read: %s", candidate, error)
            continue
        results[f"open_targets_disease_drugs:{candidate}"] = result
        if result.ok and result.data:
            rows = ((result.data.get("drugAndClinicalCandidates") or {}).get("rows")) or []
            identifier = candidate
            provenance = result.provenance
            if rows:
                break
    if not rows:
        return (
            [],
            results,
            {},
            [
                WithheldEdge(
                    kind="open_targets_disease_drug",
                    source="Open Targets Platform",
                    disease_id=identifier,
                    disease_name=disease.name,
                    detail=(
                        f"Open Targets was asked for drugs recorded against this disease "
                        f"({', '.join(identifiers)}) and holds none, so there was no such record to drop."
                    ),
                )
            ],
        )
    edges: list[DirectEdge] = []
    by_molecule: dict[str, dict[str, Any]] = {}
    for row in rows:
        drug = row.get("drug") or {}
        drug_id = drug.get("id")
        if not drug_id:
            continue
        stage = row.get("maxClinicalStage")
        edges.append(
            DirectEdge(
                edge=WithheldEdge(
                    kind="open_targets_disease_drug",
                    source="Open Targets Platform",
                    disease_id=identifier,
                    disease_name=disease.name,
                    molecule_chembl_id=drug_id,
                    molecule_name=(drug.get("name") or drug_id).title(),
                    detail=(
                        f"Open Targets lists {(drug.get('name') or drug_id).title()} for {disease.name}"
                        f"{f' at {stage.replace("_", " ").lower()}' if stage else ''}. This row links the "
                        "disease straight to the molecule."
                    ),
                ),
                molecule_chembl_id=drug_id,
            )
        )
        by_molecule[drug_id] = {"name": drug.get("name"), "stage": stage, "provenance": provenance}
    return edges, results, by_molecule, []


def direct_step_evidence(
    provenance: Any, drug_id: str, name: str | None, disease: EntityRef | None, disease_name: str | None
) -> Evidence | None:
    if provenance is None:
        return None
    return try_build_evidence(
        provenance,
        record_type="clinical_candidate",
        record_id=drug_id,
        url=open_targets.record_url(drug_id),
        subject=disease,
        predicate="has_indicated_drug",
        object=EvidenceObject(type="drug", id=f"chembl:{drug_id}", label=(name or drug_id).title()),
        statement=f"Open Targets lists {(name or drug_id).title()} for {disease_name}.",
    )
