"""The three discovery controls, run against the live Helix API.

    api/.venv/bin/python lab/experiments/run_discovery_controls.py

Checks that GET /api/v1/discovery/candidates recovers a molecule studied for the subject disease when the
edge that names it is withheld (positive), refuses every molecule that pushes the subject's protein the wrong
way (negative), and reaches an upstream druggable node when the broken protein itself is not druggable
(second positive).

Three rules this runner holds itself to:

  1. No molecule is identified by the name the discovery endpoint printed. Every expected molecule is
     resolved to a ChEMBL id and an InChIKey through a different endpoint first (GET /compounds/{id},
     GET /proteins/{accession}/compounds), and candidate rows are then matched on those identifiers.
  2. The negative control's "every other BTK inhibitor" is a set read from ChEMBL mechanism records through
     GET /proteins/{accession}/compounds, not a list of names written here.
  3. Nothing is special-cased. A control's checks are written against the response contract, and a failure
     is recorded with the bridge, source or rule that produced it.

Writes lab/experiments/results/discovery-controls.json (the shape GET /api/v1/discovery/controls serves) and
lab/experiments/DISCOVERY-CONTROLS.md.
"""

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXPERIMENTS = Path(__file__).resolve().parent
OUTPUT_JSON = EXPERIMENTS / "results" / "discovery-controls.json"
OUTPUT_MARKDOWN = EXPERIMENTS / "DISCOVERY-CONTROLS.md"
DEFAULT_BASE_URL = "http://localhost:8000"

# "Among the top candidates" needs a number. Ten is the threshold this runner declares up front and prints in
# the result; it is not derived from where the molecule actually landed.
TOP_N = 10

# ChEMBL action_type values that lower what a protein does. A molecule whose recorded action is one of these
# is an inhibitory molecule for the direction filter's purposes.
LOWERING_ACTIONS = {
    "INHIBITOR",
    "ANTAGONIST",
    "NEGATIVE ALLOSTERIC MODULATOR",
    "BLOCKER",
    "DISRUPTING AGENT",
    "DEGRADER",
    "INVERSE AGONIST",
}

JAK_FAMILY = ("JAK1", "JAK2", "JAK3", "TYK2")


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class Api:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.calls: list[dict[str, Any]] = []

    def get(self, path: str, **params: Any) -> tuple[dict[str, Any], float, int]:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{self.base_url}/api/v1{path}" + (f"?{query}" if query else "")
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                status = response.status
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8")
            try:
                body = json.loads(raw)
            except ValueError:
                body = {"detail": raw[:500]}
        wall_ms = round((time.monotonic() - started) * 1000, 1)
        self.calls.append({"url": url, "status": status, "wall_ms": wall_ms})
        return body, wall_ms, status


def molecule_keys(molecule: dict[str, Any] | None) -> set[str]:
    """Every identifier a row can be matched on. Names are deliberately not included."""
    if not molecule:
        return set()
    return {str(molecule[k]).upper() for k in ("chembl_id", "inchikey") if molecule.get(k)}


def resolve_compound(api: Api, identifier: str) -> dict[str, Any]:
    """ChEMBL's own record for an identifier, so a ChEMBL id in a brief can be checked rather than trusted."""
    body, _, status = api.get(f"/compounds/{identifier}")
    compound = body.get("compound") or {}
    return {
        "asked_for": identifier,
        "status": status,
        "chembl_id": compound.get("chembl_id"),
        "inchikey": compound.get("inchikey"),
        "name": compound.get("name"),
        "max_phase": compound.get("max_phase"),
        "first_approval": compound.get("first_approval"),
    }


def molecules_acting_on(api: Api, accession: str) -> list[dict[str, Any]]:
    """Every molecule ChEMBL records an action on `accession` for, with that action's own mechanism record."""
    body, _, status = api.get(f"/proteins/{accession}/compounds")
    if status != 200:
        return []
    rows: list[dict[str, Any]] = []
    for compound in body.get("compounds") or []:
        for mechanism in compound.get("mechanisms") or []:
            if accession.upper() not in {str(a).upper() for a in mechanism.get("target_accessions") or []}:
                continue
            rows.append(
                {
                    "chembl_id": compound.get("chembl_id"),
                    "inchikey": compound.get("inchikey"),
                    "name": (compound.get("name") or "").upper(),
                    "action_type": (mechanism.get("action_type") or "").upper(),
                    "mechanism_id": mechanism.get("mechanism_id"),
                    "mechanism_of_action": mechanism.get("mechanism_of_action"),
                    "max_phase": compound.get("max_phase"),
                }
            )
    return rows


def find_by_chembl_name(rows: list[dict[str, Any]], inn: str) -> dict[str, Any] | None:
    """Pick one molecule out of ChEMBL's own records by the name ChEMBL gives it, then use its identifiers."""
    wanted = inn.upper()
    for row in rows:
        if row["name"] == wanted:
            return row
    return None


def chain_of(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    """The bridge's steps flattened to one row per cited record."""
    chain: list[dict[str, Any]] = []
    steps = candidate.get("bridge", {}).get("steps") or []
    if not steps and candidate.get("reason_code"):
        # A ruled-out row carries no bridge steps: its chain is the records behind the refusal, each with its
        # own statement, closed by the direction rule that threw it out.
        steps = [
            {"statement": item.get("statement"), "evidence": [item]}
            for item in candidate.get("evidence") or []
        ]
        steps.append(
            {
                "statement": (candidate.get("direction_check") or {}).get("why") or candidate.get("reason"),
                "evidence": [],
            }
        )
    for step in steps:
        evidence = step.get("evidence") or []
        if not evidence:
            chain.append(
                {"statement": step.get("statement"), "source": None, "record_id": None, "record_url": None}
            )
            continue
        for item in evidence:
            source = item.get("source") or {}
            chain.append(
                {
                    "statement": step.get("statement"),
                    "source": source.get("database"),
                    "record_id": source.get("record_id"),
                    "record_url": source.get("url"),
                }
            )
    return chain


def uncited_steps(candidate: dict[str, Any]) -> list[str]:
    """Steps with no evidence row carrying both a database and a record id."""
    missing: list[str] = []
    for step in candidate.get("bridge", {}).get("steps") or []:
        cited = [
            item
            for item in step.get("evidence") or []
            if (item.get("source") or {}).get("database") and (item.get("source") or {}).get("record_id")
        ]
        if not cited:
            missing.append(str(step.get("statement"))[:120])
    return missing


def bridge_note(response: dict[str, Any]) -> str:
    """Which bridges fired for this subject and what the quiet ones said."""
    fired = []
    quiet = []
    for bridge in response.get("bridges") or []:
        if bridge.get("state") == "ok":
            fired.append(
                f"{bridge.get('kind')} ({bridge.get('candidate_count')} ranked, {bridge.get('ruled_out_count')} refused)"
            )
        else:
            quiet.append(f"{bridge.get('kind')} is {bridge.get('state')}: {bridge.get('message')}")
    return "Bridges that fired: " + (", ".join(fired) or "none") + ". " + (" ".join(quiet) or "")


def source_counts(response: dict[str, Any]) -> tuple[int, int, list[str]]:
    sources = response.get("sources") or []
    answered = [s for s in sources if s.get("state") == "ok"]
    other = [f"{s.get('source')}: {s.get('state')}" for s in sources if s.get("state") != "ok"]
    return len(answered), len(sources), other


def control_one(api: Api) -> dict[str, Any]:
    """POSITIVE, held out. APDS is gain of function in PIK3CD; the edge naming its molecule is withheld."""
    failures: list[str] = []
    notes: list[str] = []

    # Resolve the expected molecule through ChEMBL before looking at any candidate, and check the identifier
    # the brief supplied rather than trusting it.
    expected = resolve_compound(api, "CHEMBL3643413")
    salt = resolve_compound(api, "CHEMBL3989909")
    brief_identifier = resolve_compound(api, "CHEMBL4650319")
    notes.append(
        f"Identity resolved through GET /compounds before any matching: CHEMBL3643413 is "
        f"{expected['name']} ({expected['inchikey']}), approved {expected['first_approval']}."
    )
    if (expected["name"] or "").upper() != "LENIOLISIB":
        failures.append(f"CHEMBL3643413 resolves to {expected['name']}, not leniolisib.")
    notes.append(
        f"The brief's CHEMBL4650319 is {brief_identifier['name']}, a different molecule; "
        f"CHEMBL3989909 is {salt['name']}, the salt form. Both are accepted as leniolisib identifiers."
    )
    accepted = molecule_keys(expected) | molecule_keys(salt)

    request = "/discovery/candidates?disease=activated-p110-delta-syndrome-pik3cd&exclude_direct=true"
    response, wall_ms, status = api.get(
        "/discovery/candidates", disease="activated-p110-delta-syndrome-pik3cd", exclude_direct="true"
    )
    if status != 200:
        return {
            "id": "positive_held_out",
            "kind": "positive",
            "title": "Held-out positive: a molecule studied for APDS, recovered without the edge that names it",
            "subject": "Activated p110δ syndrome (APDS), PIK3CD, gain of function",
            "request": request,
            "expected": "Leniolisib among the top 10 candidates, direction matches, no withheld edge in the chain",
            "passed": False,
            "detail": f"The endpoint answered {status}: {json.dumps(response)[:300]}",
            "elapsed_ms": wall_ms,
            "notes": notes,
        }

    candidates = response.get("candidates") or []
    ruled_out = response.get("ruled_out") or []
    withheld = response.get("withheld_edges") or []
    answered, total_sources, other_states = source_counts(response)

    if response.get("exclude_direct") is not True:
        failures.append(
            "The response does not echo exclude_direct=true, so the held-out mode may not have run."
        )
    if not withheld:
        failures.append("No withheld edges are listed, so nothing was actually held out.")

    # The edge that would give the answer away must be among the withheld rows.
    withheld_for_expected = [
        edge
        for edge in withheld
        if str(edge.get("molecule_chembl_id") or "").upper() in accepted
        or (edge.get("molecule_name") or "").upper() == "LENIOLISIB"
    ]
    if not withheld_for_expected:
        failures.append(
            "No withheld edge names the expected molecule, so the recovery may not have been held out at all."
        )

    hit = next((c for c in candidates if molecule_keys(c.get("molecule")) & accepted), None)
    if hit is None:
        in_ruled_out = [r for r in ruled_out if molecule_keys(r.get("molecule")) & accepted]
        where = (
            f"it is in ruled_out with code {in_ruled_out[0].get('reason_code')}"
            if in_ruled_out
            else "it is in neither list"
        )
        failures.append(f"The expected molecule is not among the {len(candidates)} candidates: {where}.")
        chain: list[dict[str, Any]] = []
        rank = None
    else:
        rank = hit.get("rank")
        chain = chain_of(hit)
        verdict = (hit.get("direction_check") or {}).get("verdict")
        if rank is None or rank > TOP_N:
            failures.append(f"The expected molecule is ranked {rank}, outside the declared top {TOP_N}.")
        if verdict != "matches":
            failures.append(f"The direction check reads {verdict!r}, not 'matches'.")
        if hit.get("bridge", {}).get("from_disease"):
            failures.append(
                "The bridge travels from another disease; a held-out recovery must not lean on a disease edge "
                "while indication rows are withheld."
            )
        missing = uncited_steps(hit)
        if missing:
            failures.append(f"{len(missing)} bridge step(s) cite no record: {missing}")
        indication_records = [row for row in chain if "indication" in str(row.get("record_id") or "").lower()]
        if indication_records:
            failures.append(
                f"The chain cites a disease-to-molecule indication record, which is the withheld edge: "
                f"{indication_records[0]}"
            )
        notes.append(
            f"Bridge {hit.get('bridge', {}).get('kind')}, {len(hit.get('bridge', {}).get('steps') or [])} steps, "
            f"{len(chain)} cited records, from_disease={hit.get('bridge', {}).get('from_disease')}."
        )

        # Corroborate the cited ChEMBL mechanism record through a different endpoint.
        acting = molecules_acting_on(api, response["subject"]["accession"])
        corroborated = [row for row in acting if str(row.get("chembl_id") or "").upper() in accepted]
        if corroborated:
            notes.append(
                f"The cited mechanism record is confirmed independently: GET /proteins/"
                f"{response['subject']['accession']}/compounds returns mechanism "
                f"{corroborated[0]['mechanism_id']} ({corroborated[0]['action_type']}) for the same molecule."
            )
        else:
            failures.append(
                "The cited ChEMBL mechanism could not be confirmed through GET /proteins/{accession}/compounds."
            )

    # The withheld edge has to be a real edge, or holding it out proves nothing. The same subject in full mode
    # must cite a disease-to-molecule record for this molecule that the held-out chain does not.
    full, full_wall_ms, full_status = api.get(
        "/discovery/candidates", disease="activated-p110-delta-syndrome-pik3cd", exclude_direct="false"
    )
    if full_status == 200:
        full_hit = next(
            (c for c in full.get("candidates") or [] if molecule_keys(c.get("molecule")) & accepted), None
        )
        full_records = {str(row.get("record_id")) for row in chain_of(full_hit)} if full_hit else set()
        held_out_records = {str(row.get("record_id")) for row in chain}
        dropped = sorted(r for r in full_records - held_out_records if "indication" in r.lower())
        if dropped:
            notes.append(
                f"The withheld edge is a real one: in full mode the same molecule's chain cites "
                f"{', '.join(dropped)} ('studied or used for' the disease), and that step is gone from the "
                f"held-out chain while the molecule still reaches rank {rank}."
            )
        else:
            failures.append(
                "Full mode cites no disease-to-molecule record for this molecule, so the held-out mode removed "
                f"nothing that mattered. Records only in full mode: {sorted(full_records - held_out_records)}."
            )
        notes.append(
            f"Full mode withholds {len(full.get('withheld_edges') or [])} edge(s) against "
            f"{len(withheld)} in held-out mode, and ranks it {full_hit.get('rank') if full_hit else None} "
            f"of {len(full.get('candidates') or [])} ({full_wall_ms} ms)."
        )
    else:
        failures.append(
            f"exclude_direct=false answered {full_status}, so the withheld edge could not be shown real."
        )

    # The same subject asked for by gene rather than by disease must recover it too, or the control is
    # resting on one spelling of the request.
    by_gene, gene_wall_ms, gene_status = api.get(
        "/discovery/candidates", gene="PIK3CD", exclude_direct="true"
    )
    if gene_status == 200:
        gene_hit = next(
            (c for c in by_gene.get("candidates") or [] if molecule_keys(c.get("molecule")) & accepted), None
        )
        notes.append(
            f"gene=PIK3CD&exclude_direct=true recovers it at rank {gene_hit.get('rank') if gene_hit else None} "
            f"of {len(by_gene.get('candidates') or [])} ({gene_wall_ms} ms)."
        )
        if gene_hit is None:
            failures.append("Asking by gene=PIK3CD instead of by disease loses the expected molecule.")
    else:
        failures.append(f"gene=PIK3CD&exclude_direct=true answered {gene_status}.")

    notes.append(bridge_note(response))
    if other_states:
        notes.append(f"Sources that did not answer ok: {', '.join(other_states)}.")
    notes.append(
        f"Server-side elapsed {response.get('elapsed_ms')} ms, from_cache={response.get('from_cache')}; "
        f"wall time {wall_ms} ms."
    )

    passed = not failures
    detail = (
        f"{expected['name'].title()} ({expected['chembl_id']}, {expected['inchikey']}) came back at rank {rank} "
        f"of {len(candidates)} through a {hit.get('bridge', {}).get('kind')} bridge with the direction check "
        f"'matches', while {len(withheld)} direct disease-to-molecule edges were withheld, "
        f"{len(withheld_for_expected)} of them naming this molecule."
        if passed
        else " ".join(failures)
    )
    return {
        "id": "positive_held_out",
        "kind": "positive",
        "title": "Held-out positive: a molecule studied for APDS, recovered without the edge that names it",
        "subject": "Activated p110δ syndrome (APDS), PIK3CD, gain of function",
        "request": request,
        "expected": f"Leniolisib among the top {TOP_N} candidates, direction 'matches', no withheld edge in the chain",
        "passed": passed,
        "detail": detail,
        "elapsed_ms": wall_ms,
        "sources_answered": answered,
        "source_count": total_sources,
        "candidate_count": len(candidates),
        "ruled_out_count": len(ruled_out),
        "expected_molecule": f"{expected['name'].title()} ({expected['chembl_id']})",
        "expected_molecule_rank": rank,
        "chain": chain,
        "notes": notes,
    }


def control_two(api: Api) -> dict[str, Any]:
    """NEGATIVE. XLA is BTK loss of function, so no molecule that lowers BTK may be offered."""
    failures: list[str] = []
    notes: list[str] = []

    request = "/discovery/candidates?disease=btk-deficiency-x-linked-agammaglobulinemia"
    response, wall_ms, status = api.get(
        "/discovery/candidates", disease="btk-deficiency-x-linked-agammaglobulinemia"
    )
    if status != 200:
        return {
            "id": "negative_direction_filter",
            "kind": "negative",
            "title": "Negative: no molecule that lowers BTK is offered for BTK loss of function",
            "subject": "BTK deficiency, X-linked agammaglobulinemia, loss of function",
            "request": request,
            "expected": "Every BTK inhibitor absent from candidates and present in ruled_out with verdict 'opposes'",
            "passed": False,
            "detail": f"The endpoint answered {status}: {json.dumps(response)[:300]}",
            "elapsed_ms": wall_ms,
            "notes": notes,
        }

    accession = response["subject"]["accession"]
    mechanism = response["subject"]["mechanism"]
    if mechanism.get("class") != "loss_of_function":
        failures.append(
            f"The subject's mechanism reads {mechanism.get('class')!r}; the control is only meaningful for "
            "loss of function."
        )

    # The set of molecules that lower BTK, read from ChEMBL mechanism records rather than written here.
    acting = molecules_acting_on(api, accession)
    lowering = [row for row in acting if row["action_type"] in LOWERING_ACTIONS]
    lowering_keys = {k for row in lowering for k in molecule_keys(row)}
    lowering_molecules = {str(row["chembl_id"]) for row in lowering}
    notes.append(
        f"GET /proteins/{accession}/compounds holds {len(acting)} ChEMBL mechanism records against BTK, "
        f"{len(lowering)} of which lower it, covering {len(lowering_molecules)} distinct molecules. Those "
        f"{len(lowering_molecules)} molecules, resolved to ChEMBL ids and InChIKeys, are the set this control "
        "checks; no name is written into the runner."
    )
    if len(lowering_molecules) < 5:
        failures.append(
            f"Only {len(lowering_molecules)} BTK-lowering molecules were resolved, too few for the control to "
            "mean anything; ChEMBL may not have answered."
        )

    ibrutinib = find_by_chembl_name(lowering, "ibrutinib")
    if ibrutinib is None:
        failures.append(
            "Ibrutinib is not among the BTK-lowering molecules ChEMBL returned, so it cannot be checked."
        )
        ibrutinib_keys: set[str] = set()
    else:
        ibrutinib_keys = molecule_keys(ibrutinib)
        confirm = resolve_compound(api, str(ibrutinib["inchikey"]))
        notes.append(
            f"Ibrutinib resolved from ChEMBL's own records to {ibrutinib['chembl_id']} / "
            f"{ibrutinib['inchikey']}, action {ibrutinib['action_type']}, confirmed back through "
            f"GET /compounds/{ibrutinib['inchikey']} as {confirm['name']}."
        )

    candidates = response.get("candidates") or []
    ruled_out = response.get("ruled_out") or []
    answered, total_sources, other_states = source_counts(response)

    offered = [
        (c.get("rank"), (c.get("molecule") or {}).get("name"), (c.get("target") or {}).get("gene_symbol"))
        for c in candidates
        if molecule_keys(c.get("molecule")) & lowering_keys
    ]
    if offered:
        failures.append(f"{len(offered)} molecule(s) that lower BTK are offered as candidates: {offered}")

    # Nothing acting on BTK itself may be ranked, whatever its action.
    on_btk = [
        (
            c.get("rank"),
            (c.get("molecule") or {}).get("name"),
            (c.get("direction_check") or {}).get("verdict"),
        )
        for c in candidates
        if str((c.get("target") or {}).get("accession") or "").upper() == accession.upper()
    ]
    if on_btk:
        notes.append(f"Candidates aimed at BTK itself: {on_btk} (allowed only if they raise it).")

    ibrutinib_row = next((r for r in ruled_out if molecule_keys(r.get("molecule")) & ibrutinib_keys), None)
    if ibrutinib_row is None:
        failures.append("Ibrutinib does not appear in ruled_out, so the refusal is invisible to the user.")
        verdict = None
    else:
        verdict = (ibrutinib_row.get("direction_check") or {}).get("verdict")
        if verdict != "opposes":
            failures.append(f"Ibrutinib's ruled-out row reads verdict {verdict!r}, not 'opposes'.")
        if not (ibrutinib_row.get("reason") or "").strip():
            failures.append("Ibrutinib's ruled-out row carries no reason.")

    ruled_out_keys = {k for r in ruled_out for k in molecule_keys(r.get("molecule"))}
    opposed_keys = {
        k
        for r in ruled_out
        if (r.get("direction_check") or {}).get("verdict") == "opposes"
        for k in molecule_keys(r.get("molecule"))
    }
    shown = sorted({row["chembl_id"] for row in lowering if molecule_keys(row) & ruled_out_keys})
    opposed = sorted({row["chembl_id"] for row in lowering if molecule_keys(row) & opposed_keys})
    silent = sorted({row["name"].title() for row in lowering if not (molecule_keys(row) & ruled_out_keys)})
    notes.append(
        f"Of those {len(lowering_molecules)} molecules, {len(shown)} appear in ruled_out and {len(opposed)} "
        f"of them carry verdict 'opposes'. {len(silent)} are in neither list, so the user never sees them "
        f"refused: {silent[:8] or 'none'}."
    )
    if len(opposed) < 1:
        failures.append("No BTK-lowering molecule carries verdict 'opposes', so the filter left no evidence.")

    notes.append(bridge_note(response))
    if other_states:
        notes.append(f"Sources that did not answer ok: {', '.join(other_states)}.")
    notes.append(
        f"Server-side elapsed {response.get('elapsed_ms')} ms, from_cache={response.get('from_cache')}; "
        f"wall time {wall_ms} ms."
    )

    passed = not failures
    detail = (
        f"None of the {len(lowering_molecules)} molecules ChEMBL records as lowering BTK is offered as a "
        f"candidate. Ibrutinib ({ibrutinib['chembl_id'] if ibrutinib else '?'}) sits in ruled_out with "
        f"verdict '{verdict}' and a plain reason, and so do {len(opposed)} of those "
        f"{len(lowering_molecules)} molecules in total, within {len(ruled_out)} ruled-out rows."
        if passed
        else " ".join(failures)
    )
    return {
        "id": "negative_direction_filter",
        "kind": "negative",
        "title": "Negative: no molecule that lowers BTK is offered for BTK loss of function",
        "subject": "BTK deficiency, X-linked agammaglobulinemia, loss of function",
        "request": request,
        "expected": "Every BTK inhibitor absent from candidates and present in ruled_out with verdict 'opposes'",
        "passed": passed,
        "detail": detail,
        "elapsed_ms": wall_ms,
        "sources_answered": answered,
        "source_count": total_sources,
        "candidate_count": len(candidates),
        "ruled_out_count": len(ruled_out),
        "expected_molecule": f"Ibrutinib ({ibrutinib['chembl_id']})"
        if ibrutinib
        else "Ibrutinib (unresolved)",
        "expected_molecule_rank": None,
        "chain": chain_of(ibrutinib_row) if ibrutinib_row else [],
        "notes": notes,
    }


def control_three(api: Api) -> dict[str, Any]:
    """SECOND POSITIVE. STAT1 gain of function; STAT1 is not druggable, so the target must be upstream."""
    failures: list[str] = []
    notes: list[str] = []

    # Resolve the JAK family and its inhibitors through the API, not from a list of names here.
    jak_accessions: dict[str, str] = {}
    unresolved: list[str] = []
    for symbol in JAK_FAMILY:
        gene, _, status = api.get(f"/genes/{symbol}")
        if status == 200 and gene.get("uniprot_accession"):
            jak_accessions[symbol] = str(gene["uniprot_accession"])
            continue
        states = [
            f"{s.get('source')}: {s.get('state')}"
            for s in gene.get("sources") or []
            if s.get("state") != "ok"
        ]
        unresolved.append(
            f"{symbol} (HTTP {status}, in_catalog={gene.get('in_catalog')}, {states or 'no reason given'})"
        )
    notes.append(f"JAK family resolved through GET /genes: {jak_accessions}.")
    if unresolved:
        notes.append(
            "Accessions that could not be resolved independently, so rows aimed at them are not counted by "
            f"this control: {'; '.join(unresolved)}."
        )
    if len(jak_accessions) < 2:
        failures.append(f"Only {len(jak_accessions)} JAK-family accessions resolved: {jak_accessions}")

    expected_inns = ("ruxolitinib", "baricitinib", "tofacitinib")
    resolved: dict[str, dict[str, Any]] = {}
    for accession in jak_accessions.values():
        for row in molecules_acting_on(api, accession):
            if row["action_type"] not in LOWERING_ACTIONS:
                continue
            for inn in expected_inns:
                if row["name"] == inn.upper() and inn not in resolved:
                    resolved[inn] = row
    notes.append(
        "Expected molecules resolved from ChEMBL mechanism records on the JAK proteins: "
        + ", ".join(f"{inn}={row['chembl_id']}/{row['inchikey']}" for inn, row in sorted(resolved.items()))
    )
    if not resolved:
        failures.append(
            "None of ruxolitinib, baricitinib or tofacitinib could be resolved against a JAK protein."
        )
    accepted = {k for row in resolved.values() for k in molecule_keys(row)}

    request = "/discovery/candidates?disease=stat1-gof"
    response, wall_ms, status = api.get("/discovery/candidates", disease="stat1-gof")
    if status != 200:
        return {
            "id": "positive_upstream_node",
            "kind": "positive",
            "title": "Upstream positive: a JAK inhibitor reached through the pathway, not through STAT1",
            "subject": "STAT1 GOF, STAT1, gain of function",
            "request": request,
            "expected": "A JAK-family inhibitor as a pathway_node candidate on a JAK protein, direction matches",
            "passed": False,
            "detail": f"The endpoint answered {status}: {json.dumps(response)[:300]}",
            "elapsed_ms": wall_ms,
            "notes": notes,
        }

    subject_accession = str(response["subject"]["accession"]).upper()
    candidates = response.get("candidates") or []
    ruled_out = response.get("ruled_out") or []
    answered, total_sources, other_states = source_counts(response)

    if response["subject"]["mechanism"].get("class") != "gain_of_function":
        failures.append(
            f"The subject's mechanism reads {response['subject']['mechanism'].get('class')!r}, not gain of function."
        )

    jak_set = {a.upper() for a in jak_accessions.values()}
    hits = [
        c
        for c in candidates
        if c.get("bridge", {}).get("kind") == "pathway_node"
        and str((c.get("target") or {}).get("accession") or "").upper() in jak_set
        and molecule_keys(c.get("molecule")) & accepted
        and (c.get("direction_check") or {}).get("verdict") == "matches"
    ]
    hit = min(hits, key=lambda c: c.get("rank") or 999) if hits else None

    if hit is None:
        near = [
            (
                c.get("rank"),
                (c.get("molecule") or {}).get("name"),
                c.get("bridge", {}).get("kind"),
                (c.get("target") or {}).get("gene_symbol"),
                (c.get("direction_check") or {}).get("verdict"),
            )
            for c in candidates
            if molecule_keys(c.get("molecule")) & accepted
        ]
        failures.append(
            f"No pathway_node candidate on a JAK protein carries one of the expected molecules with direction "
            f"'matches'. Rows carrying one of them at all: {near or 'none'}."
        )
        chain: list[dict[str, Any]] = []
        rank = None
        found_inn = None
    else:
        rank = hit.get("rank")
        chain = chain_of(hit)
        found_inn = next(
            (inn for inn, row in resolved.items() if molecule_keys(row) & molecule_keys(hit.get("molecule"))),
            None,
        )
        if str((hit.get("target") or {}).get("accession") or "").upper() == subject_accession:
            failures.append("The candidate aims at STAT1 itself, not at an upstream node.")
        missing = uncited_steps(hit)
        if missing:
            failures.append(f"{len(missing)} bridge step(s) cite no record: {missing}")
        notes.append(
            f"Winning row: rank {rank}, target {(hit.get('target') or {}).get('gene_symbol')}, "
            f"{len(hit.get('bridge', {}).get('steps') or [])} steps, {len(chain)} cited records."
        )

    all_jak_rows = [
        (c.get("rank"), (c.get("molecule") or {}).get("name"), (c.get("target") or {}).get("gene_symbol"))
        for c in candidates
        if str((c.get("target") or {}).get("accession") or "").upper() in jak_set
    ]
    notes.append(
        f"{len(all_jak_rows)} candidate rows aim at a JAK-family protein whose accession this runner resolved "
        f"itself: {all_jak_rows}"
    )
    if unresolved:
        labelled_only = [
            (c.get("rank"), (c.get("molecule") or {}).get("name"), (c.get("target") or {}).get("gene_symbol"))
            for c in candidates
            if str((c.get("target") or {}).get("gene_symbol") or "") in {u.split(" ")[0] for u in unresolved}
        ]
        notes.append(
            "Rows the engine labels with an unresolved symbol, reported but not counted because the label is "
            f"the engine's own: {labelled_only or 'none'}."
        )
    missing_inns = sorted(set(expected_inns) - {found_inn} if found_inn else set(expected_inns))
    absent = [
        inn
        for inn in missing_inns
        if inn in resolved
        and not any(molecule_keys(resolved[inn]) & molecule_keys(c.get("molecule")) for c in candidates)
    ]
    if absent:
        notes.append(
            f"Resolved but absent from the candidate list: {absent}. The control needs only one, but the "
            "per-bridge caps mean a JAK molecule can be cut."
        )
    on_stat1 = [
        ((c.get("molecule") or {}).get("name"), c.get("bridge", {}).get("kind"))
        for c in candidates
        if str((c.get("target") or {}).get("accession") or "").upper() == subject_accession
    ]
    notes.append(f"Candidates aimed at STAT1 itself: {on_stat1 or 'none'}.")

    notes.append(bridge_note(response))
    if other_states:
        notes.append(f"Sources that did not answer ok: {', '.join(other_states)}.")
    notes.append(
        f"Server-side elapsed {response.get('elapsed_ms')} ms, from_cache={response.get('from_cache')}; "
        f"wall time {wall_ms} ms."
    )

    passed = not failures
    detail = (
        f"{str(found_inn).title()} ({(hit.get('molecule') or {}).get('chembl_id')}) came back at rank {rank} "
        f"of {len(candidates)} as a pathway_node candidate on "
        f"{(hit.get('target') or {}).get('gene_symbol')}, not on STAT1, with the direction check 'matches'."
        if passed
        else " ".join(failures)
    )
    return {
        "id": "positive_upstream_node",
        "kind": "positive",
        "title": "Upstream positive: a JAK inhibitor reached through the pathway, not through STAT1",
        "subject": "STAT1 GOF, STAT1, gain of function",
        "request": request,
        "expected": "A JAK-family inhibitor as a pathway_node candidate on a JAK protein, direction 'matches'",
        "passed": passed,
        "detail": detail,
        "elapsed_ms": wall_ms,
        "sources_answered": answered,
        "source_count": total_sources,
        "candidate_count": len(candidates),
        "ruled_out_count": len(ruled_out),
        "expected_molecule": (
            f"{str(found_inn).title()} ({(hit.get('molecule') or {}).get('chembl_id')})"
            if hit
            else "none of " + ", ".join(expected_inns)
        ),
        "expected_molecule_rank": rank,
        "chain": chain,
        "notes": notes,
    }


def merge_sources(responses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for response in responses:
        for source in response.get("sources") or []:
            key = str(source.get("source"))
            if key not in merged or source.get("state") == "ok":
                merged[key] = source
    return [merged[k] for k in sorted(merged)]


def markdown(document: dict[str, Any]) -> str:
    lines = [
        "# Discovery controls",
        "",
        f"Run {document['generated_at']} against the live API. "
        f"{document['passed']} of {document['total']} passed.",
        "",
        "These three calls are the product's own evidence that the direction-of-effect filter works: one",
        "recovery with the answer held out, one refusal, one upstream target. Every expected molecule is",
        "resolved to a ChEMBL id and an InChIKey through a separate endpoint before any candidate row is",
        "matched, so nothing passes on a name.",
        "",
        "Wall time is how long this run's call took. The engine keeps assembled responses for fifteen minutes,",
        "so a repeat call is a few milliseconds; each control's notes state whether the call was served from",
        "that cache and how long the engine took to build the response it served.",
        "",
        "| Control | Result | Candidates | Ruled out | Sources | Wall time |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for control in document["controls"]:
        lines.append(
            f"| {control['title']} | {'PASS' if control['passed'] else 'FAIL'} "
            f"| {control.get('candidate_count')} | {control.get('ruled_out_count')} "
            f"| {control.get('sources_answered')}/{control.get('source_count')} "
            f"| {control.get('elapsed_ms')} ms |"
        )
    for control in document["controls"]:
        lines += [
            "",
            f"## {control['title']}",
            "",
            f"- Subject: {control['subject']}",
            f"- Request: `{control['request']}`",
            f"- Expected: {control['expected']}",
            f"- Result: **{'PASS' if control['passed'] else 'FAIL'}** — {control['detail']}",
        ]
        if control.get("chain"):
            lines += ["", f"Chain for {control.get('expected_molecule')}:", ""]
            seen: set[tuple[Any, Any]] = set()
            for step in control["chain"]:
                key = (step.get("statement"), step.get("record_id"))
                if key in seen:
                    continue
                seen.add(key)
                record = (
                    f" — {step['source']} {step['record_id']}" if step.get("source") else " — no record cited"
                )
                lines.append(f"1. {step['statement']}{record}")
        if control.get("notes"):
            lines += ["", "What was measured:", ""]
            lines += [f"- {note}" for note in control["notes"]]
    lines += ["", "## What a pass here does not prove", ""]
    lines += [f"- {limit}" for limit in document.get("limits") or []]
    lines += [
        "",
        "## How to re-run",
        "",
        "```",
        "api/.venv/bin/python lab/experiments/run_discovery_controls.py",
        "```",
        "",
        "The result is served by `GET /api/v1/discovery/controls`.",
        "",
    ]
    return "\n".join(lines)


def limits_of(controls: list[dict[str, Any]], responses: list[dict[str, Any]]) -> list[str]:
    """Honest limits, read from what this run actually observed rather than written in advance."""
    limits = [
        "Three subjects are three subjects. Each control shows the rule behaving correctly once, on one "
        "disease, against today's records. It is not a measure of how often the engine is right.",
        "The engine's ranking is checked for position, not for quality. Nothing here tests whether a "
        "higher-ranked molecule is a better hypothesis than a lower-ranked one.",
    ]
    for control, response in zip(controls, responses, strict=False):
        for bridge in response.get("bridges") or []:
            if bridge.get("state") == "ok" or not bridge.get("message"):
                continue
            count = bridge.get("candidate_count") or 0
            standing = (
                f"contributed nothing ({bridge.get('state')})"
                if count == 0
                else f"ran {bridge.get('state')} and still produced {count} ranked row(s)"
            )
            limits.append(
                f"{control['id']}: the {bridge.get('kind')} bridge {standing} — {bridge.get('message')}"
            )
        for source in response.get("sources") or []:
            if source.get("state") != "ok":
                limits.append(
                    f"{control['id']}: {source.get('name')} answered '{source.get('state')}'"
                    + (f" ({source.get('message')})" if source.get("message") else "")
                    + ", so whatever it holds did not reach this result."
                )
    return limits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    arguments = parser.parse_args()

    api = Api(arguments.base_url)
    started = time.monotonic()
    controls = [control_one(api), control_two(api), control_three(api)]
    responses = []
    for disease, extra in (
        ("activated-p110-delta-syndrome-pik3cd", {"exclude_direct": "true"}),
        ("btk-deficiency-x-linked-agammaglobulinemia", {}),
        ("stat1-gof", {}),
    ):
        body, _, status = api.get("/discovery/candidates", disease=disease, **extra)
        if status == 200:
            responses.append(body)

    passed = sum(1 for control in controls if control["passed"])
    document = {
        "generated_at": now(),
        "all_passed": passed == len(controls),
        "passed": passed,
        "total": len(controls),
        "engine_version": None,
        "controls": controls,
        "sources": merge_sources(responses),
        "limits": limits_of(controls, responses),
        "run_seconds": round(time.monotonic() - started, 2),
        "api_calls": len(api.calls),
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    OUTPUT_MARKDOWN.write_text(markdown(document), encoding="utf-8")

    for control in controls:
        print(f"{'PASS' if control['passed'] else 'FAIL'}  {control['id']}: {control['detail'][:200]}")
    print(f"{passed}/{len(controls)} passed in {document['run_seconds']}s -> {OUTPUT_JSON}")
    return 0 if passed == len(controls) else 1


if __name__ == "__main__":
    raise SystemExit(main())
