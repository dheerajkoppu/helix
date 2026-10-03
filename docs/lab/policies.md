# Policies and the human approval gate

Built on 2026-10-03T23:34:41Z by a script that reads the files named below. Every quoted block is copied from the file at the line numbers given, so it goes stale when the file changes.

Four Omnigent policies are Python functions in `lab/policies/helix_lab_policies/policies.py`. Each agent's `config.yaml` declares all four under `guardrails.policies` with the agent's own role.

| Policy | Phase | Enforces |
| --- | --- | --- |
| `role_boundary` | tool call | Deny tools outside the agent's role. |
| `approval_gate` | tool call | Deny tests that are not planned, cleared and, for compute jobs, approved by a human. |
| `claims_guard` | tool call and reply | Reject clinical or treatment wording and uncited factual statements. |
| `run_budget` | tool call | Cap the tool calls and compute seconds of a run. |

## How the policies are declared

`lab/agents/helix_lab/config.yaml`, lines 26 to 51:

```yaml
guardrails:
  policies:
    role_boundary:
      type: function
      function:
        path: helix_lab_policies.policies.role_boundary
        arguments:
          role: orchestrator
    approval_gate:
      type: function
      function:
        path: helix_lab_policies.policies.approval_gate
        arguments:
          role: orchestrator
    claims_guard:
      type: function
      function:
        path: helix_lab_policies.policies.claims_guard
        arguments:
          role: orchestrator
    run_budget:
      type: function
      function:
        path: helix_lab_policies.policies.run_budget
        arguments:
          role: orchestrator
```

The seven specialist specs and the control spec hold the same block with `role:` set to `literature`, `knowledge_graph`, `insight`, `planner`, `safety`, `runner`, `analysis` or `generalist`.

## Supervisor policies abstain on sub-agent calls

Omnigent 0.16.0 also evaluates a supervisor's policies on its sub-agents' tool calls. The supervisor's instances return no verdict there, so the sub-agent's own instance, which knows its role, decides.

`lab/policies/helix_lab_policies/policies.py`, lines 37 to 43:

```python
def _is_subagent_event(event: Event) -> bool:
    labels = (event.get("context") or {}).get("labels") or {}
    return bool(labels.get(SUBAGENT_LABEL))


def _abstains(role: str, event: Event) -> bool:
    return role == "orchestrator" and _is_subagent_event(event)
```

## Every denial is logged and written to the research record

`lab/policies/helix_lab_policies/policies.py`, lines 72 to 89:

```python
def _deny(policy: str, role: str, tool: str, reason: str) -> Verdict:
    """Deny, and leave the denial in the policy log and in the research record."""
    _log(policy, role, tool, "DENY", reason)
    directory = _run_directory()
    if directory is not None:
        record.append_event(
            "orchestrator",
            "note",
            {
                "kind": "policy_denial",
                "policy": policy,
                "calling_agent": RECORD_ROLE.get(role, role),
                "tool": tool,
                "text": reason,
            },
            directory=directory,
        )
    return {"result": "DENY", "reason": reason}
```

## 1. `role_boundary`

Denies every tool that is not in the calling agent's role. This includes tools Omnigent registers for every agent by default.

`lab/policies/helix_lab_policies/policies.py`, lines 92 to 112:

```python
def role_boundary(role: str) -> Evaluator:
    """Deny every tool that is not in the calling agent's role, including tools Omnigent registers by default."""
    permitted = allowed_tools(role)

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, _ = call
        if tool in permitted:
            if tool not in HARNESS_TOOLS:
                _log("role_boundary", role, tool, "ALLOW")
            return {"result": "ALLOW"}
        return _deny(
            "role_boundary",
            role,
            tool,
            f"{tool} is outside the {role} role. Tools of this role: {', '.join(sorted(permitted - HARNESS_TOOLS))}.",
        )

    return evaluate
```

## 2. `approval_gate`

A test tool runs only when four conditions hold in the record: a plan exists, the call is the plan's chosen test, the safety agent cleared that test for that plan, and, for a tool that starts a compute job, an `approval_decision` with `decision: approved` exists.

`lab/policies/helix_lab_policies/policies.py`, lines 115 to 178:

```python
def approval_gate(role: str) -> Evaluator:
    """Let a test run only when it is the planned test, safety cleared it and, for a compute job, a human approved it."""

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, arguments = call
        if tool not in EXPERIMENT_TOOLS:
            return None
        directory = _run_directory()
        if directory is None:
            return _deny("approval_gate", role, tool, "No run directory, so no approval can be on record.")
        events = record.load_events(directory)
        test_id = str(arguments.get("test_id") or "")
        plan = record.latest_plan(events)
        if plan is None:
            return _deny(
                "approval_gate", role, tool, "No plan is on record. The planner must record a plan first."
            )
        chosen = plan["payload"]["chosen_test_id"]
        if test_id != chosen:
            return _deny(
                "approval_gate",
                role,
                tool,
                f"{test_id or 'This call'} is not the chosen test of the latest plan ({chosen}).",
            )
        candidate = record.by_id(events, test_id)
        if candidate is None or candidate["payload"]["tool"] != tool:
            expected = candidate["payload"]["tool"] if candidate else "none"
            return _deny("approval_gate", role, tool, f"{test_id} is executed by {expected}, not by {tool}.")
        reviews = [
            note
            for note in record.notes_of_kind(events, "safety_review")
            if note["payload"]["test_id"] == test_id and note["payload"].get("plan_seq") == plan["seq"]
        ]
        if not reviews or reviews[-1]["payload"]["verdict"] != "cleared":
            return _deny(
                "approval_gate", role, tool, f"The safety agent has not cleared {test_id} of the latest plan."
            )
        if tool in CONSEQUENTIAL_TOOLS:
            request, decision = record.approval_for(events, test_id)
            if request is None:
                return _deny(
                    "approval_gate",
                    role,
                    tool,
                    f"{tool} starts a compute job and needs human approval. No approval request for {test_id} is on record.",
                )
            if decision is None or decision["payload"].get("decision") != "approved":
                state = decision["payload"].get("decision") if decision else "pending"
                return _deny(
                    "approval_gate",
                    role,
                    tool,
                    f"{tool} needs an approved human decision; approval {request['payload']['id']} is {state}.",
                )
            _log("approval_gate", role, tool, "ALLOW", f"approved by {decision['payload'].get('by')}")
        else:
            _log("approval_gate", role, tool, "ALLOW", "retrieval-only test, cleared by safety")
        return {"result": "ALLOW"}

    return evaluate
```

Which tools are tests, and which need a human:

`lab/tools/helix_lab_tools/catalogue.py`, lines 120 to 123:

```python
EXPERIMENT_TOOLS: dict[str, str] = {definition["tool"]: kind for kind, definition in TESTS.items()}
CONSEQUENTIAL_TOOLS: frozenset[str] = frozenset(
    definition["tool"] for definition in TESTS.values() if definition["requires_approval"]
)
```

In the catalogue only `structure_comparison` (`run_structure_comparison`) has `requires_approval: True` (cost 120 compute seconds). The three retrieval-only tests have `requires_approval: False`.

## 3. `claims_guard`

Refuses record tools and replies that hold clinical or treatment wording, cite a record ID that is not in the run record, or state a measured value or database classification without a record ID.

`lab/policies/helix_lab_policies/policies.py`, lines 191 to 236:

```python
def claims_guard(role: str) -> Evaluator:
    """Reject clinical or treatment wording, citations of records that do not exist, and uncited facts."""

    def evaluate(event: Event) -> Verdict:
        if _abstains(role, event):
            return None
        directory = _run_directory()
        known = record.known_ids(record.load_events(directory)) if directory else None
        call = _tool_call(event)
        if call is not None:
            tool, arguments = call
            if not tool.startswith(("record_", "request_approval")):
                return None
            text = "\n".join(_strings(arguments))
            problems = claims.check_text(
                text,
                known if tool == "record_final_report" else None,
                require_citations=tool == "record_final_report",
            )
            if problems:
                return _deny(
                    "claims_guard",
                    role,
                    tool,
                    "Refused: " + "; ".join(problems) + ". Rewrite and call again.",
                )
            return None
        if event.get("type") != "response":
            return None
        data = event.get("data")
        text = data if isinstance(data, str) else "\n".join(_strings(data))
        if not text.strip():
            return None
        problems = claims.check_text(text, known, require_citations=True)
        if problems:
            return _deny(
                "claims_guard",
                role,
                "response",
                "Reply refused: "
                + "; ".join(problems)
                + ". Reply with record IDs only, or cite the ID next to each fact.",
            )
        return {"result": "ALLOW"}

    return evaluate
```

The text checks it calls:

`lab/tools/helix_lab_tools/claims.py`, lines 5 to 19:

```python
CLINICAL_PATTERNS = [
    r"\b(patients?|individuals?|carriers?|families|clinicians?|physicians?|doctors?)\s+(should|must|need to|ought to)\b",
    r"\b(should|must)\s+be\s+(treated|given|prescribed|administered|started|offered|screened|transplanted)\b",
    r"\b(we|i)\s+(recommend|advise)\b",
    r"\b(recommend(ed|s)?|advis(e|ed|es))\s+(treat\w*|prescrib\w*|administer\w*|starting|giving|therapy|a dose)\b",
    r"\b(recommended|preferred|appropriate|best)\s+(treatment|therapy|dose|dosage|regimen|drug)\b",
    r"\btreatment\s+(recommendation|plan|decision|advice|guidance)s?\b",
    r"\b(clinical|medical)\s+(advice|recommendation|decision|management|guidance)s?\b",
    r"\b(will|would|can|could|may|might)\s+(cure|treat|restore function in patients)\b",
    r"\b(is|are|as)\s+(a\s+|the\s+)?(cure|curative)\b",
    r"\b(prescrib\w+|dosage|dosing)\b",
    r"\b(start|begin|initiate|switch to|continue|stop)\s+(ivig|scig|immunoglobulin|ibrutinib|therapy|treatment|prophylaxis)\b",
    r"\bdiagnos(e|es|ed|ing)\s+(the|this|a|your)\s+(patient|individual|carrier)\b",
    r"\btherapeutic\s+recommendation",
]
```

`lab/tools/helix_lab_tools/claims.py`, lines 30 to 35:

```python
FACT_MARKERS = [
    r"\d+(?:\.\d+)?\s?(?:Å|angstroms?|kcal/mol|kDa)",
    r"\b(?:pLDDT|ΔΔG|ddG|RMSD|AlphaMissense|popEVE|FoldX|allele frequency|probability)\b[^.\n]{0,60}?\d+\.\d+",
    r"\b(?:ClinVar|UniProt\w*|gnomAD|InterPro|IntAct)\b[^.\n]{0,80}\b(?:classif\w+|annotat\w+|lists?|reports?|pathogenic|benign|binding site)\b",
    r"\bPDB\s?(?:entry|structure|id)?\s?[0-9][A-Za-z][A-Za-z0-9]{2}\b",
]
```

`lab/tools/helix_lab_tools/claims.py`, lines 78 to 94:

```python
def check_text(text: str, known_ids: set[str] | None = None, *, require_citations: bool = False) -> list[str]:
    """Every reason this text may not leave the lab; empty when it is acceptable."""
    problems: list[str] = []
    phrases = clinical_violations(text)
    if phrases:
        quoted = ", ".join(f'"{phrase}"' for phrase in phrases[:4])
        problems.append(f"clinical or treatment wording: {quoted}")
    if known_ids is not None:
        unknown = sorted(cited_ids(text) - known_ids)
        if unknown:
            problems.append(f"cites IDs that are not in the run record: {', '.join(unknown[:8])}")
    if require_citations:
        uncited = uncited_factual_sentences(text)
        if uncited:
            quoted = " | ".join(f'"{sentence}"' for sentence in uncited[:3])
            problems.append(f"factual statement without a recorded source ID: {quoted}")
    return problems
```

## 4. `run_budget`

Caps lab tool calls and compute seconds for the whole run. After the cap, only the tools that close a run stay available.

`lab/policies/helix_lab_policies/policies.py`, lines 239 to 275:

```python
def run_budget(role: str) -> Evaluator:
    """Cap the lab tool calls and the compute seconds of the whole run."""

    def evaluate(event: Event) -> Verdict:
        call = _tool_call(event)
        if call is None or _abstains(role, event):
            return None
        tool, _ = call
        if tool not in LAB_TOOLS:
            return None
        directory = _run_directory()
        if directory is None:
            return None
        if tool in EXPERIMENT_TOOLS:
            needed = TESTS[EXPERIMENT_TOOLS[tool]]["cost"]["compute_seconds"]
            remaining = budget.status(directory)["compute_seconds_remaining"]
            if needed > remaining:
                return _deny(
                    "run_budget",
                    role,
                    tool,
                    f"{tool} needs about {needed} compute seconds; {remaining} remain in the run budget.",
                )
        permitted, state = budget.charge_tool_call(
            RECORD_ROLE.get(role, role), directory, enforce=tool not in CLOSING_TOOLS
        )
        if not permitted:
            return _deny(
                "run_budget",
                role,
                tool,
                f"Run budget exhausted: {state['tool_calls_used']} of {state['max_tool_calls']} tool calls used. "
                f"Only these remain available: {', '.join(sorted(CLOSING_TOOLS))}.",
            )
        return {"result": "ALLOW"}

    return evaluate
```

`lab/tools/helix_lab_tools/registry.py`, lines 69 to 80:

```python
CLOSING_TOOLS = frozenset(
    {
        "read_record",
        "get_budget_status",
        "record_result",
        "record_interpretation",
        "record_decision",
        "record_next_experiment",
        "record_handoff",
        "record_final_report",
    }
)
```

Default budget of a run: 160 lab tool calls and 300 compute seconds (`budget` in every `run.json`).

## Human approval gate

The safety agent calls `request_approval`. The tool writes an `approval_request` to the record and waits for an `approval_decision`. If none arrives before the timeout it writes a rejection itself.

`lab/tools/helix_lab_tools/record.py`, lines 849 to 869:

```python
    request = append_event(current_role(), "approval_request", build, refs=[test_id])
    approval_id = request["payload"]["id"]
    deadline = time.monotonic() + float(os.environ.get("HELIX_LAB_APPROVAL_TIMEOUT", "900"))
    while time.monotonic() < deadline:
        for event in of_type(load_events(directory), "approval_decision"):
            if event["payload"].get("id") == approval_id:
                return {"approval_id": approval_id, **event["payload"]}
        time.sleep(2)
    timed_out = append_event(
        current_role(),
        "approval_decision",
        {
            "id": approval_id,
            "decision": "rejected",
            "by": "approval timeout (no human decision)",
            "note": "No human answered in time. Treated as rejected; the test was not run.",
        },
        refs=[test_id],
        directory=directory,
    )
    return {"approval_id": approval_id, **timed_out["payload"]}
```

A decision reaches the record in one of two ways.

1. A human answers through the API, `POST /api/v1/lab/runs/{run_id}/approvals/{approval_id}` (`api/helix/routers/lab.py`). The run page calls this endpoint from its Approve and Reject buttons.
2. The operator starts the launcher with `--approve`. The launcher then writes the decision with the operator's name:

`lab/run_lab.py`, lines 381 to 395:

```python
        if waiting and arguments.approve:
            for request in waiting:
                record.append_event(
                    "human",
                    "approval_decision",
                    {
                        "id": request["payload"]["id"],
                        "decision": "approved",
                        "by": f"{operator} (run_lab.py --approve)",
                        "note": "Approved in advance for this unattended, documented run.",
                    },
                    refs=[request["payload"].get("test_id", "")],
                    directory=run_directory,
                )
            waiting = []
```

Omnigent's own `ASK` verdict needs an attached interactive client. Lab runs are headless, so the approval state lives in the shared record and `approval_gate` returns `DENY` until an approved decision is there (`lab/README.md`, section "Policies and approval gates").

## The connector boundary

`lab/run_lab.py`, lines 130 to 145:

```python
def child_environment(run_directory: Path, api_url: str, approval_timeout: int) -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if key not in SESSION_MARKERS}
    paths = [str(LAB / "tools"), str(LAB / "policies")]
    if environment.get("PYTHONPATH"):
        paths.append(environment["PYTHONPATH"])
    environment.update(
        {
            "HELIX_LAB_RUN_DIR": str(run_directory),
            "HELIX_API_URL": api_url,
            "HELIX_LAB_APPROVAL_TIMEOUT": str(approval_timeout),
            "PYTHONPATH": os.pathsep.join(paths),
            # Connectors of the signed-in account are not tools of the lab
            "ENABLE_CLAUDEAI_MCP_SERVERS": "false",
        }
    )
    return environment
```

`ENABLE_CLAUDEAI_MCP_SERVERS=false` keeps the signed-in account's connectors out of the agents. `lab/README.md` records that without it the `claude-sdk` harness exposed them.

## Verification with real Omnigent sessions

`lab/verify_policies.py` runs a probe agent (runner tools and runner policies with a neutral prompt) and asserts what the policy log shows. Last run: 2026-10-03T21:44:17Z, Omnigent 0.16.0, harness `claude-sdk`, 9 of 9 checks passed (`lab/policy_checks/latest/report.json`).

| Check | Policy | Expectation | Passed | Observed |
| --- | --- | --- | --- | --- |
| `role_boundary_denies_out_of_role_tool` | `role_boundary` | browser_navigate, a tool Omnigent registers for every agent, is denied for the runner role | yes | DENY on `browser_navigate`: browser_navigate is outside the runner role. Tools of this role: get_comparison_result, get_job_status, read_record, record_handoff, record_result, run_ligand_contact_test, run_stability_te... |
| `approval_gate_denies_unplanned_test` | `approval_gate` | run_ligand_contact_test for T1 is denied because the plan chose T2 | yes | DENY on `run_ligand_contact_test`: T1 is not the chosen test of the latest plan (T2). |
| `approval_gate_denies_job_without_approval` | `approval_gate` | run_structure_comparison is denied while no approved human decision is on record, and no experiment starts | yes | DENY on `run_structure_comparison`: run_structure_comparison starts a compute job and needs human approval. No approval request for T2 is on record. |
| `claims_guard_denies_clinical_wording` | `claims_guard` | record_handoff with treatment wording is denied | yes | DENY on `record_handoff`: Refused: clinical or treatment wording: "Patients should", "should be treated". Rewrite and call again. |
| `denials_are_written_to_the_record` | `all` | every denial is a note in the research record | yes | policy_denial_notes = 4 |
| `approval_gate_allows_approved_job` | `approval_gate` | after an approved decision the same job is allowed and starts | yes | ALLOW on `run_structure_comparison`: approved by operator of verify_policies.py |
| `run_budget_denies_calls_beyond_the_cap` | `run_budget` | with a budget of 2 tool calls the third lab tool call is denied | yes | DENY on `get_job_status`: Run budget exhausted: 2 of 2 tool calls used. Only these remain available: get_budget_status, read_record, record_decision, record_final_report, record_handoff, record_interpretation, record_... |
| `run_budget_keeps_closing_tools` | `run_budget` | read_record, a closing tool, still runs after the cap | yes | tool_calls_used = 3 |
| `claims_guard_denies_clinical_reply` | `claims_guard` | a reply with treatment wording is refused | yes | DENY on `response`: Reply refused: clinical or treatment wording: "Patients should", "should be treated". Reply with record IDs only, or cite the ID next to each fact. |

## What the kept runs show

**`lab/runs/reference-BTK-p.Arg28His/`**: approval mode "pre-approved by --approve", 0 approval decisions, 0 policy denials in `run.json`; `policy_log.jsonl` holds 151 policy decisions, 0 of them DENY.

- seq 42, `safety`, safety review of T1 for plan seq 39: verdict `cleared`, `requires_approval: false`.
- seq 63, `safety`, safety review of T2 for plan seq 60: verdict `cleared`, `requires_approval: false`.

**`lab/runs/approval-gate-demo-BTK-p.Arg28His/`**: approval mode "waits for a human decision through the API", 1 approval decisions, 0 policy denials in `run.json`; `policy_log.jsonl` holds 133 policy decisions, 0 of them DENY.

- seq 44, `safety`, safety review of T4 for plan seq 41: verdict `cleared`, `requires_approval: true`.
- seq 45, `safety`, approval request A1: action "Run run_structure_comparison (Reference versus variant structure prediction) for BTK-p.Arg28His"; risk "Compute: 120 compute seconds of 300 remaining, and 3 tool calls. External service: the PH-domain sequence (BTK residues 1-143, UniProt Q06187 variant p.Arg28His) is sent to an external structure-prediction inference service. No patient data is included. Research only."
- seq 46, approval decision A1: `rejected` by "approval timeout (no human decision)"; note "No human answered in time. Treated as rejected; the test was not run."
- seq 52, `safety`, safety review of T1 for plan seq 49: verdict `cleared`, `requires_approval: false`.

In the approval demo no human answered within the 60 second timeout it was started with, the request was recorded as rejected, and the record holds no `experiment_started` event for the gated test. The approved path (denied without a decision, allowed after one) is shown by the verification table above. `lab/README.md` states that an end-to-end approval through the API was exercised during development and that run was not kept, because the approval was given by the build agent.

## Limits

- `claims_guard` is a pattern check. It catches the listed phrasings and uncited sentences that carry a measured value or a database classification. It does not prove that no unsupported statement exists.
- The approval state lives in the record, not in Omnigent's `ASK` verdict, because runs are headless.
- `--approve` writes the decision before any human has read the individual request. It is meant for an operator who has decided in advance, and the record names that operator.
- The kept runs contain a rejection by timeout. They do not contain a decision made by a human through the page.
