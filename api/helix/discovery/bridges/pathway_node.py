"""pathway_node: a druggable protein up or down the pathway from the broken one.

THE RULE, AND WHY IT GIVES A DIRECTION

Reactome records reactions, not just pathway membership, and a reaction says which molecule goes in
and which comes out. That is what makes a direction readable:

1. Every reaction the subject protein takes part in is read
   (`/data/mapping/UniProt/{accession}/reactions`).
2. A reaction is kept only when the subject appears on one side in its modified form and on the other
   side without it. Reactome writes the modified form with a `p-` prefix, as in
   "p-STAT1(Y701) bound to p-IFNGR1" against "STAT1 bound to p-IFNGR1".
   - modified form in the OUTPUT only: the reaction PRODUCES the active form of the subject, so every
     other protein in that reaction is upstream of it. Lowering such a protein lowers the subject's
     activity.
   - modified form in the INPUT only: the reaction REMOVES the active form, so every other protein in
     that reaction is a brake on the subject. Lowering a brake RAISES the subject's activity. This is
     the case the naive engine gets wrong: inhibiting a brake upstream of a weakened protein restores
     the pathway and is a match, not an opposition.
   - Anything else is dropped, because the direction cannot be read from the record.
3. The reaction's participants are read (`/data/participants/{stId}`) and their UniProt accessions
   taken. The protein that catalyses the reaction is preferred, because the reaction names it.
4. A participant is a candidate only when ChEMBL records a molecule with an action on it.

STAT1 gain of function is the model case: Reactome's "Phosphorylation of STAT1 by JAK kinases"
produces p-STAT1, so JAK1 is upstream, and a JAK inhibitor lowers STAT1 activity, which is the
direction a gain of function needs.
"""

import asyncio
import re
from typing import Any

from helix.discovery.build import build_rows
from helix.discovery.context import BridgeContext, BridgeOutput
from helix.discovery.rules import BRAKE, UPSTREAM_ACTIVATOR, Relation
from helix.discovery.targets import protein_actions
from helix.evidence import try_build_evidence
from helix.log import get_logger
from helix.schemas.common import EntityRef, EntityType, EvidenceObject
from helix.schemas.discovery import BridgeStep
from helix.sources.base import SourceResult
from helix.sources.reactome import reactome

logger = get_logger(__name__)

MAX_REACTIONS_READ = 16
MAX_REACTIONS_EXPANDED = 8
MAX_NODES = 8
MAX_ROWS_PER_NODE = 4
NODE_TIMEOUT = 25.0

MODIFICATION_WORDS = (
    "phosphorylat",
    "dephosphorylat",
    "ubiquitinat",
    "deubiquitinat",
    "acetylat",
    "deacetylat",
    "methylat",
)
PROTEIN_REFERENCE_CLASSES = frozenset({"ReferenceGeneProduct", "ReferenceIsoform"})
_CATALYST_OF = re.compile(r"\bactivity of (.+)$")


def _modified(name: str, symbol: str) -> bool:
    """Whether this Reactome entity name carries the subject protein in a phosphorylated form."""
    return re.search(rf"p-[\w()\-,.]*?{re.escape(symbol)}", name) is not None


def _names(entries: Any) -> list[str]:
    return [
        entry["displayName"]
        for entry in entries or []
        if isinstance(entry, dict) and entry.get("displayName")
    ]


async def _reactions(accession: str) -> SourceResult[list[dict[str, Any]]]:
    raw = await reactome.get_json(
        f"/data/mapping/UniProt/{accession}/reactions",
        params={"species": 9606},
        record_id=accession,
    )
    return raw.map(lambda rows: [row for row in rows if isinstance(row, dict)])


async def _reaction_details(stable_ids: list[str]) -> SourceResult[list[dict[str, Any]]]:
    """Full reaction objects in one request, so the input and output sides can be compared."""
    raw = await reactome.request(
        "POST",
        "/data/query/ids",
        content=",".join(stable_ids),
        headers={"Content-Type": "text/plain", "Accept": "application/json"},
        parse="json",
        record_id=stable_ids[0] if stable_ids else None,
        empty_if=lambda payload: not payload,
    )
    return raw.map(lambda rows: [row for row in rows if isinstance(row, dict)])


async def _participants(stable_id: str) -> SourceResult[list[dict[str, Any]]]:
    raw = await reactome.get_json(f"/data/participants/{stable_id}", record_id=stable_id)
    return raw.map(lambda rows: [row for row in rows if isinstance(row, dict)])


def _classify(reaction: dict[str, Any], symbol: str) -> Relation | None:
    """Which way this reaction moves the subject's activity, read from its two sides."""
    inputs, outputs = _names(reaction.get("input")), _names(reaction.get("output"))
    named_in = [name for name in inputs if symbol in name]
    named_out = [name for name in outputs if symbol in name]
    if not named_in or not named_out:
        return None
    modified_in = any(_modified(name, symbol) for name in named_in)
    modified_out = any(_modified(name, symbol) for name in named_out)
    if modified_out and not modified_in:
        return UPSTREAM_ACTIVATOR
    if modified_in and not modified_out:
        return BRAKE
    return None


def _catalyst_names(reaction: dict[str, Any]) -> set[str]:
    found = set()
    for entry in reaction.get("catalystActivity") or []:
        match = _CATALYST_OF.search(entry.get("displayName") or "") if isinstance(entry, dict) else None
        if match:
            found.add(match.group(1).strip())
    return found


def _accessions(rows: list[dict[str, Any]], catalyst_names: set[str]) -> list[tuple[str, str | None, bool]]:
    """(accession, gene symbol, is the catalyst) of every human protein in the reaction."""
    found: dict[str, tuple[str, str | None, bool]] = {}
    for participant in rows:
        is_catalyst = (participant.get("displayName") or "") in catalyst_names
        for reference in participant.get("refEntities") or []:
            if reference.get("schemaClass") not in PROTEIN_REFERENCE_CLASSES:
                continue
            identifier = (reference.get("identifier") or "").split("-")[0].upper()
            if not identifier:
                continue
            label = reference.get("displayName") or ""
            symbol = label.split()[-1] if " " in label else None
            current = found.get(identifier)
            if current is None or (is_catalyst and not current[2]):
                found[identifier] = (identifier, symbol, is_catalyst)
    return sorted(found.values(), key=lambda row: (not row[2], row[1] or row[0]))


async def run(context: BridgeContext) -> BridgeOutput:
    accession, symbol = context.accession, context.subject.gene_symbol
    output = BridgeOutput()
    if accession is None:
        output.message = "The catalog gives no protein for this gene."
        return output

    reactions = await _reactions(accession)
    output.results["reactome_reactions"] = reactions
    if not reactions.ok or not reactions.data:
        output.message = "Reactome records no reaction for this protein."
        return output

    interesting = [
        row
        for row in reactions.data
        if row.get("speciesName") == "Homo sapiens"
        and not row.get("isInDisease")
        and any(word in (row.get("displayName") or "").lower() for word in MODIFICATION_WORDS)
        and symbol in (row.get("displayName") or "")
    ]
    if not interesting:
        output.message = (
            f"Reactome records {len(reactions.data)} reactions for this protein, but none of them names a "
            "modification of it, so no direction can be read."
        )
        return output

    details = await _reaction_details([row["stId"] for row in interesting[:MAX_REACTIONS_READ]])
    output.results["reactome_reaction_detail"] = details
    if not details.ok or not details.data:
        output.message = "Reactome did not return the two sides of these reactions, so no direction was read."
        return output

    chosen: list[tuple[dict[str, Any], Relation]] = []
    for reaction in details.data:
        relation = _classify(reaction, symbol)
        if relation is not None:
            chosen.append((reaction, relation))
    # The reactions that produce the active form first, then the reactions that remove it
    chosen.sort(key=lambda pair: (pair[1] is BRAKE, pair[0].get("displayName") or ""))
    chosen = chosen[:MAX_REACTIONS_EXPANDED]
    if not chosen:
        output.message = (
            "No Reactome reaction shows this protein with and without a modification on opposite "
            "sides, so no "
            "direction could be read."
        )
        return output

    participant_rows = await asyncio.gather(
        *(_participants(reaction["stId"]) for reaction, _ in chosen), return_exceptions=True
    )
    # A protein named in more of the reactions that modify the subject, and in the entity that
    # catalyses one of them, is the more central node. Nothing else orders them.
    nodes: dict[str, tuple[str, str | None, dict[str, Any], Relation, bool, int]] = {}
    for (reaction, relation), rows in zip(chosen, participant_rows, strict=True):
        if isinstance(rows, BaseException) or not rows.ok or not rows.data:
            continue
        output.results.setdefault("reactome_participants", rows)
        for node_accession, node_symbol, is_catalyst in _accessions(rows.data, _catalyst_names(reaction)):
            if node_accession == accession:
                continue
            current = nodes.get(node_accession)
            if current is None:
                nodes[node_accession] = (node_accession, node_symbol, reaction, relation, is_catalyst, 1)
            else:
                better = is_catalyst and not current[4]
                nodes[node_accession] = (
                    node_accession,
                    node_symbol or current[1],
                    reaction if better else current[2],
                    relation if better else current[3],
                    current[4] or is_catalyst,
                    current[5] + 1,
                )
    ordered = sorted(nodes.values(), key=lambda row: (not row[4], -row[5], row[1] or row[0]))[:MAX_NODES]
    if not ordered:
        output.message = "Reactome names no other human protein in those reactions."
        return output

    found = await asyncio.gather(
        *(asyncio.wait_for(protein_actions(node[0]), NODE_TIMEOUT) for node in ordered),
        return_exceptions=True,
    )
    reaction_provenance = details.provenance
    for node, actions in zip(ordered, found, strict=True):
        node_accession, node_symbol, reaction, relation, is_catalyst, _ = node
        if isinstance(actions, BaseException):
            logger.info("Pathway node %s was not read: %s", node_accession, actions)
            output.partial = True
            output.partial_reason = "ChEMBL did not answer for every protein in the reaction."
            continue
        for key, result in actions.results.items():
            output.results.setdefault(f"{key}:{node_accession}", result)
        if not actions.actions:
            continue
        node_ref = EntityRef.of(
            EntityType.PROTEIN, node_accession, label=node_symbol, curie=f"uniprot:{node_accession}"
        )
        produced = relation is UPSTREAM_ACTIVATOR
        role = (
            "names it in the entity that catalyses the reaction"
            if is_catalyst
            else "lists it among the reaction's participants"
        )
        statement = (
            f'Reactome records the reaction "{reaction.get("displayName")}" '
            f"({reaction.get('stId')}), which "
            f"{'produces' if produced else 'removes'} the modified form of {symbol}, and "
            f"{role}: {node_symbol or node_accession}. So {node_symbol or node_accession} is "
            f"{'upstream of' if produced else 'a brake on'} {symbol}."
        )
        evidence = []
        if reaction_provenance is not None:
            row = try_build_evidence(
                reaction_provenance,
                record_type="reaction",
                record_id=reaction.get("stId"),
                url=reactome.record_url(reaction.get("stId") or ""),
                subject=node_ref,
                predicate="produces_active_form_of" if produced else "removes_active_form_of",
                object=EvidenceObject(type="protein", id=f"uniprot:{accession}", label=symbol),
                statement=f"{reaction.get('displayName')} ({reaction.get('stId')})",
            )
            if row is not None:
                evidence.append(row)
        candidates, ruled_out = build_rows(
            context,
            bridge_kind="pathway_node",
            actions=actions,
            target_symbol=node_symbol,
            target_name=None,
            relation=relation,
            steps_before=[BridgeStep(statement=statement, evidence=evidence)],
            max_rows=MAX_ROWS_PER_NODE,
            extra_sources={"reactome"},
            druggability_note=(
                f"{node_symbol or node_accession} is "
                f"{'upstream of' if produced else 'a brake on'} {symbol} in Reactome."
            ),
        )
        output.candidates.extend(candidates)
        output.ruled_out.extend(ruled_out)
    if not output.candidates and not output.ruled_out:
        output.message = "ChEMBL records no molecule with an action on any protein in those reactions."
    return output
