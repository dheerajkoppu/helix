"""The effort the discovery engine removes, and how long the engine itself takes.

    lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase engine --label before
    lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase engine --label after
    lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase manual

THE UNIT OF WORK, and it is the only thing this script counts.

One unit is ONE MOLECULE-TARGET PAIR whose recorded action has to be looked up and whose direction
has to be judged against the subject's mechanism. Concretely, one unit is the triple

    (molecule, the protein target a record says it acts on, the subject's required direction)

and settling it needs three things, every one of which is a record and not an opinion:

  1. what the mechanism needs (less activity, or more) - from the disease record;
  2. what the molecule does to that protein - from the ChEMBL mechanism `action_type`;
  3. how an effect on that protein carries over to the subject - from the bridge's own record
     (same protein / upstream producer / brake / binds it / similar pocket / another disease).

The engine makes one such judgment per (molecule, target) pair every bridge proposes. That count is
read from `bridges[].candidate_count + bridges[].ruled_out_count`, which the engine reports per
bridge BEFORE the response is de-duplicated and before the 40-row display caps, so it is the number
of judgments actually made rather than the number displayed.

WHAT THIS SCRIPT DOES NOT MEASURE. No scientist was timed. Nothing here is a claim about human
minutes, and the manual phase is a machine doing the same lookups one at a time, which is a LOWER
BOUND on the manual path: a person also has to read each record, decide, and write the decision down.
Every figure is reported as requests issued and wall seconds to reach the same set of judgments.

Writes lab/experiments/results/discovery-effort.json.
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
REPO = EXPERIMENTS.parent.parent
OUTPUT_JSON = EXPERIMENTS / "results" / "discovery-effort.json"
CATALOG = REPO / "data" / "seed" / "catalog.json"
DEFAULT_BASE_URL = "http://localhost:8000"

# The three subjects the controls already cover, measured here too so the effort figures and the
# correctness figures describe the same requests.
CONTROL_SUBJECTS: list[dict[str, Any]] = [
    {
        "name": "APDS (held out)",
        "params": {"disease": "activated-p110-delta-syndrome-pik3cd", "exclude_direct": "true"},
        "accession": "O00329",
        "gene": "PIK3CD",
        "kind": "control",
    },
    {
        "name": "X-linked agammaglobulinemia",
        "params": {"disease": "btk-deficiency-x-linked-agammaglobulinemia"},
        "accession": "Q06187",
        "gene": "BTK",
        "kind": "control",
    },
    {
        "name": "STAT1 gain of function",
        "params": {"disease": "stat1-gof"},
        "accession": "P42224",
        "gene": "STAT1",
        "kind": "control",
    },
]

# Caps copied from the engine so the manual emulation reaches the same judgment set and no further.
# They are read here, not chosen here: changing them would change what is being compared.
MAX_MOLECULES_PER_PROTEIN = 60
MAX_REACTIONS_READ = 16
MAX_REACTIONS_EXPANDED = 8
MAX_NODES = 8
MAX_PARTNERS = 5
MAX_ANALOGUES = 3
MIN_MI_SCORE = 0.45

MODIFICATION_WORDS = (
    "phosphorylat",
    "dephosphorylat",
    "ubiquitinat",
    "deubiquitinat",
    "acetylat",
    "deacetylat",
    "methylat",
)

CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
REACTOME = "https://reactome.org/ContentService"
INTACT = "https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search"
UNIPROT = "https://rest.uniprot.org"


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def flagship_subjects() -> list[dict[str, Any]]:
    catalog = json.loads(CATALOG.read_text())
    return [
        {
            "name": entry["gene_symbol"],
            "params": {"gene": entry["gene_symbol"]},
            "accession": entry.get("uniprot_accession"),
            "kind": "flagship",
        }
        for entry in catalog["flagship"]
    ]


class Api:
    """The local Helix API. Records every call so the request count is read, not asserted."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.calls: list[dict[str, Any]] = []

    def get(self, path: str, **params: Any) -> tuple[dict[str, Any], float, int]:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{self.base_url}/api/v1{path}" + (f"?{query}" if query else "")
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                status = response.status
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8")
            try:
                body = json.loads(raw)
            except ValueError:
                body = {"detail": raw[:400]}
        wall_ms = round((time.monotonic() - started) * 1000, 1)
        self.calls.append({"url": url, "status": status, "wall_ms": wall_ms})
        return body, wall_ms, status


def reload_api(api: Api) -> dict[str, Any]:
    """Clear the engine's assembled-response cache by touching a watched module.

    The dev server runs `uvicorn --reload --reload-dir helix`, so touching a file under
    api/helix/discovery/ restarts the worker. That empties the in-process response cache (15 minute
    TTL, 128 entries) and leaves the database-backed HTTP cache of the source adapters untouched.
    The server is never killed.
    """
    watched = REPO / "api" / "helix" / "discovery" / "cache.py"
    watched.touch()
    started = time.monotonic()
    for _ in range(240):
        time.sleep(0.5)
        try:
            _, _, status = api.get("/health")
        except Exception:  # noqa: BLE001 - the worker is mid-restart
            continue
        if status == 200:
            # the reloaded worker answers /health before the first discovery request warms imports
            return {"reloaded": True, "wait_s": round(time.monotonic() - started, 2)}
    return {"reloaded": False, "wait_s": round(time.monotonic() - started, 2)}


# ---------------------------------------------------------------------------
# Part 1: what one request of the engine settles


def judgment_counts(body: dict[str, Any]) -> dict[str, Any]:
    """Judgments, records and databases behind one discovery response."""
    candidates = body.get("candidates") or []
    ruled_out = body.get("ruled_out") or []
    bridges = body.get("bridges") or []

    made = 0
    for bridge in bridges:
        made += int(bridge.get("candidate_count") or 0) + int(bridge.get("ruled_out_count") or 0)

    records: set[tuple[str, str]] = set()
    databases: set[str] = set()
    for row in [*candidates, *ruled_out]:
        for evidence in row.get("evidence") or []:
            source = evidence.get("source") or {}
            database = source.get("database")
            record_id = source.get("record_id")
            if database:
                databases.add(str(database))
            if database and record_id:
                records.add((str(database), str(record_id)))

    targets: dict[str, int] = {}
    for row in [*candidates, *ruled_out]:
        target = row.get("target") or {}
        accession = target.get("accession")
        if not accession:
            continue
        count = ((target.get("druggability") or {}).get("molecules_with_a_recorded_action")) or 0
        targets[str(accession)] = max(targets.get(str(accession), 0), int(count))

    sources = body.get("sources") or []
    return {
        "judgments_made": made,
        "judgments_ranked": len(candidates),
        "judgments_ruled_out": len(ruled_out),
        "judgments_dropped_before_display": max(0, made - len(candidates) - len(ruled_out)),
        "distinct_upstream_records": len(records),
        "records_by_database": {
            database: sum(1 for item in records if item[0] == database) for database in sorted(databases)
        },
        "databases_in_the_chains": sorted(databases),
        "databases_consulted": sorted({str(row.get("source")) for row in sources}),
        "databases_consulted_count": len({str(row.get("source")) for row in sources}),
        "databases_that_answered": sorted(
            {str(row.get("source")) for row in sources if row.get("state") == "ok"}
        ),
        "target_proteins_judged": len(targets),
        "molecules_with_a_recorded_action_on_those_proteins": sum(targets.values()),
        "withheld_edges": len(body.get("withheld_edges") or []),
        "bridges": [
            {
                "kind": bridge.get("kind"),
                "state": bridge.get("state"),
                "candidate_count": bridge.get("candidate_count"),
                "ruled_out_count": bridge.get("ruled_out_count"),
                "elapsed_ms": bridge.get("elapsed_ms"),
            }
            for bridge in bridges
        ],
    }


def measure_engine(api: Api, subjects: list[dict[str, Any]], label: str) -> dict[str, Any]:
    """Three timing tiers per subject, each with its cache precondition stated in the result."""
    tiers: dict[str, dict[str, Any]] = {}

    first_reload = reload_api(api)
    first: dict[str, Any] = {}
    for subject in subjects:
        body, wall_ms, status = api.get("/discovery/candidates", **subject["params"])
        first[subject["name"]] = {
            "status": status,
            "server_elapsed_ms": body.get("elapsed_ms"),
            "end_to_end_ms": wall_ms,
            "from_cache": body.get("from_cache"),
            **judgment_counts(body),
        }
    tiers["first_rebuild"] = {
        "precondition": (
            "the engine's assembled-response cache was empty (the worker was reloaded just before "
            "this pass); the database-backed HTTP cache of the source adapters was in whatever state "
            "earlier use left it, so a subject never asked for before pays full upstream latency here "
            "and a subject asked for recently does not. This tier is the noisy one."
        ),
        "subjects": first,
    }

    second_reload = reload_api(api)
    warm: dict[str, Any] = {}
    for subject in subjects:
        body, wall_ms, status = api.get("/discovery/candidates", **subject["params"])
        warm[subject["name"]] = {
            "status": status,
            "server_elapsed_ms": body.get("elapsed_ms"),
            "end_to_end_ms": wall_ms,
            "from_cache": body.get("from_cache"),
            **judgment_counts(body),
        }
    tiers["warm_rebuild"] = {
        "precondition": (
            "the assembled-response cache was empty again (second reload) but the HTTP cache now holds "
            "every upstream record this subject needs, because the first_rebuild pass just fetched them. "
            "Every chain is rebuilt from scratch against local cache reads, so this tier isolates the "
            "engine's own work from upstream latency and is the fair before/after comparison."
        ),
        "subjects": warm,
    }

    cached: dict[str, Any] = {}
    for subject in subjects:
        body, wall_ms, status = api.get("/discovery/candidates", **subject["params"])
        cached[subject["name"]] = {
            "status": status,
            "server_elapsed_ms": body.get("elapsed_ms"),
            "end_to_end_ms": wall_ms,
            "from_cache": body.get("from_cache"),
        }
    tiers["served_from_cache"] = {
        "precondition": (
            "the same request repeated with no reload, so the engine returned the assembled response it "
            "had already built. No chain is rebuilt. server_elapsed_ms is the figure recorded when the "
            "response was built, not the time this call took."
        ),
        "subjects": cached,
    }

    return {
        "label": label,
        "run_at": now(),
        "n_subjects": len(subjects),
        "subjects": [{"name": s["name"], "kind": s["kind"], "params": s["params"]} for s in subjects],
        "reloads": {"before_first_rebuild": first_reload, "before_warm_rebuild": second_reload},
        "tiers": tiers,
    }


# ---------------------------------------------------------------------------
# Part 2: the same judgments reached one request at a time


class Public:
    """Direct, serial, uncached requests to the public APIs. One at a time, like a person."""

    def __init__(self, budget_s: float) -> None:
        self.requests: list[dict[str, Any]] = []
        self.budget_s = budget_s
        self.started = time.monotonic()
        self.truncated = False

    @property
    def spent_s(self) -> float:
        return time.monotonic() - self.started

    def over_budget(self) -> bool:
        if self.spent_s > self.budget_s:
            self.truncated = True
            return True
        return False

    def get(
        self, url: str, *, params: dict[str, Any] | None = None, accept: str = "application/json"
    ) -> Any:
        full = url + (f"?{urllib.parse.urlencode(params)}" if params else "")
        request = urllib.request.Request(
            full,
            headers={
                "Accept": accept,
                # a cache-busting header pair, because the point of this phase is no shared cache
                "Cache-Control": "no-cache",
                "User-Agent": "helix-lab-effort-measurement",
            },
        )
        started = time.monotonic()
        status = 0
        body: Any = None
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status = response.status
                raw = response.read().decode("utf-8", "replace")
            body = json.loads(raw) if accept == "application/json" else raw
        except urllib.error.HTTPError as error:
            status = error.code
        except Exception:  # noqa: BLE001 - a failed lookup is still a request a person issued
            status = -1
        self.requests.append(
            {"url": full, "status": status, "wall_ms": round((time.monotonic() - started) * 1000, 1)}
        )
        return body


def _chembl_rows(public: Public, resource: str, key: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    body = public.get(f"{CHEMBL}/{resource}.json", params={**params, "limit": 1000})
    if not isinstance(body, dict):
        return []
    return [row for row in (body.get(key) or []) if isinstance(row, dict)]


def manual_protein_actions(public: Public, accession: str, judgments: set[tuple[str, str]]) -> None:
    """What a person has to read to judge every molecule recorded against one protein.

    The engine batches these: one request for every target of the accession, one for the mechanism
    records of all of those targets at once, one for all the parent molecules at once. A person
    working in a browser reads one target page and one molecule page at a time, which is what this
    does. Every (molecule, target) pair reached is added to `judgments`.
    """
    if public.over_budget():
        return
    targets = _chembl_rows(public, "target", "targets", {"target_components__accession": accession})
    if not targets:
        return
    mechanisms: list[dict[str, Any]] = []
    for target in targets:
        if public.over_budget():
            return
        target_id = target.get("target_chembl_id")
        if not target_id:
            continue
        # one target at a time, not target_chembl_id__in
        mechanisms.extend(
            _chembl_rows(public, "mechanism", "mechanisms", {"target_chembl_id": target_id})
        )
    parents: list[str] = []
    for row in mechanisms:
        parent = row.get("parent_molecule_chembl_id") or row.get("molecule_chembl_id")
        if parent and parent not in parents:
            parents.append(parent)
    parents = parents[:MAX_MOLECULES_PER_PROTEIN]
    for parent in parents:
        if public.over_budget():
            return
        # the molecule record carries the name, the phase and the structure a person records
        public.get(f"{CHEMBL}/molecule/{parent}.json")
    for row in mechanisms:
        parent = row.get("parent_molecule_chembl_id") or row.get("molecule_chembl_id")
        target_id = row.get("target_chembl_id")
        if parent in parents and target_id:
            judgments.add((str(parent), str(target_id)))


def manual_subject(public: Public, subject: dict[str, Any]) -> dict[str, Any]:
    """Every record one subject's judgments rest on, fetched serially from the public APIs."""
    accession = subject["accession"]
    gene = subject.get("gene") or subject["name"]
    at_start = len(public.requests)
    started = time.monotonic()
    judgments: set[tuple[str, str]] = set()
    proteins: set[str] = {accession}

    # 1. the protein the gene encodes
    public.get(
        f"{UNIPROT}/uniprotkb/search",
        params={"query": f"accession:{accession}", "fields": "accession,protein_name,gene_names"},
    )

    # 2. same_target: every molecule recorded against the subject's own protein
    manual_protein_actions(public, accession, judgments)

    # 3. pathway_node: Reactome reactions, their two sides, their participants
    reactions = public.get(f"{REACTOME}/data/mapping/UniProt/{accession}/reactions", params={"species": 9606})
    interesting: list[str] = []
    for row in reactions or []:
        if not isinstance(row, dict):
            continue
        name = (row.get("displayName") or "").lower()
        if (
            row.get("speciesName") == "Homo sapiens"
            and not row.get("isInDisease")
            and any(word in name for word in MODIFICATION_WORDS)
            and gene in (row.get("displayName") or "")
            and row.get("stId")
        ):
            interesting.append(str(row["stId"]))
    nodes: list[str] = []
    for stable_id in interesting[:MAX_REACTIONS_READ][:MAX_REACTIONS_EXPANDED]:
        if public.over_budget():
            break
        # the engine asks for all of these in one POST; a person opens one reaction page at a time
        public.get(f"{REACTOME}/data/query/{stable_id}")
        participants = public.get(f"{REACTOME}/data/participants/{stable_id}")
        for participant in participants or []:
            if not isinstance(participant, dict):
                continue
            for reference in participant.get("refEntities") or []:
                if not isinstance(reference, dict):
                    continue
                if reference.get("schemaClass") not in {"ReferenceGeneProduct", "ReferenceIsoform"}:
                    continue
                identifier = str(reference.get("identifier") or "").split("-")[0].upper()
                if identifier and identifier != accession and identifier not in nodes:
                    nodes.append(identifier)
    for node in nodes[:MAX_NODES]:
        proteins.add(node)
        manual_protein_actions(public, node, judgments)

    # 4. interaction_partner: IntAct, then every partner's molecules
    partners: list[str] = []
    table = public.get(
        f"{INTACT}/query/id:{accession}",
        params={"format": "tab27", "firstResult": 0, "maxResults": 500},
        accept="text/plain",
    )
    for line in (table or "").splitlines():
        columns = line.split("\t")
        if len(columns) < 15:
            continue
        for column in columns[:2]:
            for token in column.split("|"):
                if token.startswith("uniprotkb:"):
                    identifier = token.split(":", 1)[1].split("-")[0].upper()
                    if identifier and identifier != accession and identifier not in partners:
                        partners.append(identifier)
    for partner in partners[:MAX_PARTNERS]:
        proteins.add(partner)
        manual_protein_actions(public, partner, judgments)

    issued = len(public.requests) - at_start
    return {
        "subject": subject["name"],
        "accession": accession,
        "requests_issued": issued,
        "wall_s": round(time.monotonic() - started, 2),
        "judgments_reached": len(judgments),
        "proteins_read": len(proteins),
        "reactions_examined": len(interesting[:MAX_REACTIONS_READ][:MAX_REACTIONS_EXPANDED]),
        "intact_partners_read": len(partners[:MAX_PARTNERS]),
        "truncated_by_budget": public.truncated,
        "bridges_emulated": ["same_target", "pathway_node", "interaction_partner"],
        "bridges_not_emulated": ["structural_analogue", "mechanism_class"],
    }


def measure_manual(api: Api, subjects: list[dict[str, Any]], budget_s: float) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for subject in subjects:
        public = Public(budget_s)
        row = manual_subject(public, subject)
        statuses: dict[str, int] = {}
        for request in public.requests:
            statuses[str(request["status"])] = statuses.get(str(request["status"]), 0) + 1
        row["request_statuses"] = statuses
        row["median_request_ms"] = (
            round(
                sorted(request["wall_ms"] for request in public.requests)[len(public.requests) // 2],
                1,
            )
            if public.requests
            else None
        )
        rows.append(row)
    return {
        "run_at": now(),
        "definition": (
            "A machine doing the same lookups a person would have to do: one request at a time, no "
            "concurrency, no cache shared between items, every record fetched from the public API that "
            "holds it (ChEMBL, Reactome, IntAct, UniProt). It reaches the same (molecule, target) pairs "
            "the engine judges, under the engine's own caps."
        ),
        "lower_bound_note": (
            "This is a LOWER BOUND on the manual path and nothing more. The machine does not read, "
            "decide or record anything: it only fetches. A person doing this also has to read each "
            "record, apply the direction rule, and write the decision down. No scientist was timed, so "
            "no figure here is a claim about human time."
        ),
        "budget_s_per_subject": budget_s,
        "subjects": rows,
    }


# ---------------------------------------------------------------------------
# How many proteins one request reads, counted inside the engine rather than inferred


def measure_protein_fetches(subjects: list[dict[str, Any]]) -> dict[str, Any]:
    """Count the engine's calls for a protein's ChEMBL records, in process.

    Needs the API's interpreter (api/.venv/bin/python), because it imports the engine rather than
    calling the HTTP endpoint. `protein_actions` is wrapped with a counter, nothing is changed.
    """
    import asyncio
    import sys

    sys.path.insert(0, str(REPO / "api"))
    from helix.discovery import cache as response_cache
    from helix.discovery import targets as targets_module
    from helix.discovery.engine import discovery_candidates
    from helix.knowledge.catalog import load_catalog

    original = targets_module.protein_actions

    async def run() -> list[dict[str, Any]]:
        catalog = load_catalog()
        rows: list[dict[str, Any]] = []
        for subject in subjects:
            asks: list[str] = []

            async def counted(accession: str, **kwargs: Any) -> Any:
                asks.append(accession)
                return await original(accession, **kwargs)

            targets_module.protein_actions = counted
            response_cache.clear()
            params = {
                key: (value == "true" if key == "exclude_direct" else value)
                for key, value in subject["params"].items()
            }
            try:
                response = await discovery_candidates(catalog, **params)
            finally:
                targets_module.protein_actions = original
            rows.append(
                {
                    "subject": subject["name"],
                    "protein_record_fetches_issued": len(asks),
                    "distinct_proteins_read": len(set(asks)),
                    "duplicate_fetches_avoided_by_the_memo": len(asks) - len(set(asks)),
                    "candidates": len(response.candidates),
                    "ruled_out": len(response.ruled_out),
                }
            )
        return rows

    return {
        "run_at": now(),
        "note": (
            "One fetch is one call for everything ChEMBL records about acting on one protein: its "
            "targets, the mechanism records on those targets, and the molecules behind them. The "
            "assembled-response cache is cleared before each subject so every chain is rebuilt."
        ),
        "subjects": asyncio.run(run()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--phase", choices=["engine", "manual", "fetches", "all"], default="all")
    parser.add_argument("--label", default="run", help="which engine build this pass measures")
    parser.add_argument("--manual-budget-s", type=float, default=420.0)
    arguments = parser.parse_args()

    api = Api(arguments.base_url)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    stored: dict[str, Any] = {}
    if OUTPUT_JSON.exists():
        try:
            stored = json.loads(OUTPUT_JSON.read_text())
        except ValueError:
            stored = {}

    subjects = [*flagship_subjects(), *CONTROL_SUBJECTS]
    stored.setdefault("unit_of_work", __doc__.strip())
    stored["base_url"] = arguments.base_url
    stored["written_at"] = now()

    if arguments.phase in {"engine", "all"}:
        passes = stored.setdefault("engine_passes", {})
        passes[arguments.label] = measure_engine(api, subjects, arguments.label)
        print(f"engine pass '{arguments.label}': {len(subjects)} subjects")

    if arguments.phase in {"fetches", "all"}:
        chosen = [s for s in subjects if s["name"] in {"PIK3CD", "IL2RG", "JAK3", "STAT3"}]
        stored["protein_fetches"] = measure_protein_fetches([*chosen, *CONTROL_SUBJECTS])
        for row in stored["protein_fetches"]["subjects"]:
            print(
                f"fetches {row['subject']}: {row['protein_record_fetches_issued']} fetches over "
                f"{row['distinct_proteins_read']} proteins"
            )

    if arguments.phase in {"manual", "all"}:
        stored["manual_equivalent"] = measure_manual(api, CONTROL_SUBJECTS, arguments.manual_budget_s)
        for row in stored["manual_equivalent"]["subjects"]:
            print(
                f"manual {row['subject']}: {row['requests_issued']} requests, {row['wall_s']}s, "
                f"{row['judgments_reached']} judgments"
            )

    OUTPUT_JSON.write_text(json.dumps(stored, indent=2) + "\n")
    print(f"wrote {OUTPUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
