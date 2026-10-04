"""interaction_partner: a curated physical partner of this protein that is druggable.

The partners come from the existing interactions service, so the same IntAct and STRING records the
protein page shows are the ones used here. IntAct partners are preferred because each row is a
curated experiment; a STRING partner is used only when it is in the physical subnetwork.

A partner's direction is NOT assumed. IntAct says two proteins bind; it does not say whether one
switches the other on or off. So every candidate from this bridge gets a direction verdict of
"unknown" unless Reactome also places the partner as an activator or a brake, which the pathway_node
bridge covers. That is deliberate: a partner that might be an activator and might be an inhibitor
cannot be ranked as a match.
"""

import asyncio

from helix.discovery.build import build_rows
from helix.discovery.context import BridgeContext, BridgeOutput
from helix.discovery.rules import UNKNOWN_RELATION
from helix.discovery.targets import protein_actions
from helix.log import get_logger
from helix.schemas.discovery import BridgeStep

logger = get_logger(__name__)

MAX_PARTNERS = 5
MAX_ROWS_PER_PARTNER = 3
PARTNER_TIMEOUT = 25.0
INTERACTIONS_TIMEOUT = 35.0
MIN_MI_SCORE = 0.45


async def run(context: BridgeContext) -> BridgeOutput:
    from helix.services.interactions import protein_interactions

    accession, symbol = context.accession, context.subject.gene_symbol
    output = BridgeOutput()
    if accession is None:
        output.message = "The catalog gives no protein for this gene."
        return output

    try:
        response = await asyncio.wait_for(
            protein_interactions(accession, context.catalog), INTERACTIONS_TIMEOUT
        )
    except Exception as error:  # noqa: BLE001 - a bridge never fails the request
        logger.info("Interactions for %s were not read: %s", accession, error)
        output.message = "The interaction records could not be read."
        return output

    output.statuses.extend(response.sources)
    curated = [
        partner
        for partner in response.curated.partners
        if partner.partner is not None
        and partner.partner.id != accession
        and (partner.mi_score is None or partner.mi_score >= MIN_MI_SCORE)
    ]
    physical = [
        partner
        for partner in response.string_physical.partners
        if partner.partner is not None and not partner.also_in_intact
    ]
    chosen: list[tuple[str, str | None, str, int, float | None, object]] = []
    for partner in curated[:MAX_PARTNERS]:
        chosen.append(
            (
                partner.partner.id,
                partner.partner_symbol,
                "IntAct",
                partner.evidence_count,
                partner.mi_score,
                partner.evidence,
            )
        )
    for partner in physical[: max(0, MAX_PARTNERS - len(chosen))]:
        assert partner.partner is not None
        chosen.append(
            (
                partner.partner.id,
                partner.partner_symbol,
                "STRING physical",
                0,
                partner.score,
                partner.evidence,
            )
        )
    if not chosen:
        output.message = "No curated physical partner of this protein was recorded."
        return output

    found = await asyncio.gather(
        *(asyncio.wait_for(protein_actions(row[0]), PARTNER_TIMEOUT) for row in chosen),
        return_exceptions=True,
    )
    for row, actions in zip(chosen, found, strict=True):
        partner_accession, partner_symbol, source_name, count, score, evidence_row = row
        if isinstance(actions, BaseException):
            logger.info("Partner %s was not read: %s", partner_accession, actions)
            output.partial = True
            output.partial_reason = "ChEMBL did not answer for every partner."
            continue
        for key, result in actions.results.items():
            output.results.setdefault(f"{key}:{partner_accession}", result)
        if not actions.actions:
            continue
        detail = (
            f"{count} curated experiment{'s' if count != 1 else ''}, IntAct score {score:g}"
            if source_name == "IntAct" and score is not None
            else f"{count} curated experiment{'s' if count != 1 else ''}"
            if source_name == "IntAct"
            else f"combined score {score:g} in the physical subnetwork"
            if score is not None
            else "physical subnetwork"
        )
        statement = (
            f"{source_name} records {partner_symbol or partner_accession} as a physical partner of {symbol} "
            f"({detail}). Neither record says whether the partner switches {symbol} on or off."
        )
        candidates, ruled_out = build_rows(
            context,
            bridge_kind="interaction_partner",
            actions=actions,
            target_symbol=partner_symbol,
            target_name=None,
            relation=UNKNOWN_RELATION,
            steps_before=[
                BridgeStep(statement=statement, evidence=[evidence_row] if evidence_row else [])  # type: ignore[list-item]
            ],
            max_rows=MAX_ROWS_PER_PARTNER,
            extra_sources={"intact" if source_name == "IntAct" else "string"},
            druggability_note=f"{partner_symbol or partner_accession} binds {symbol}.",
        )
        output.candidates.extend(candidates)
        output.ruled_out.extend(ruled_out)
    if not output.candidates and not output.ruled_out:
        output.message = "ChEMBL records no molecule with an action on any curated partner of this protein."
    return output
