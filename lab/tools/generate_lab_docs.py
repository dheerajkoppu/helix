"""Generate docs/lab/agent-specs.md and docs/lab/policies.md from the live lab sources.

Every table is read from the agent bundle and the registry, and every quoted block is cut from the
file it names with its line numbers computed at build time. Re-running after a change to the
registry, a config.yaml, a prompt, a policy or the verification report reproduces a correct
document, so the documents cannot drift from the bundle they describe.

    lab/.venv/bin/python lab/tools/generate_lab_docs.py
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LAB = Path(__file__).resolve().parents[1]
REPOSITORY = LAB.parent
sys.path.insert(0, str(LAB / "tools"))
sys.path.insert(0, str(LAB / "policies"))

from helix_lab_policies.policies import POLICY_REGISTRY  # noqa: E402
from helix_lab_tools import budget, registry  # noqa: E402
from helix_lab_tools.catalogue import TESTS  # noqa: E402

LAB_BUNDLE = LAB / "agents" / "helix_lab"
BASELINE_BUNDLE = LAB / "agents" / "helix_baseline"
SKILL = LAB_BUNDLE / "skills" / "discovery-loop" / "SKILL.md"
POLICIES_PY = LAB / "policies" / "helix_lab_policies" / "policies.py"
REGISTRY_PY = LAB / "tools" / "helix_lab_tools" / "registry.py"
CATALOGUE_PY = LAB / "tools" / "helix_lab_tools" / "catalogue.py"
CLAIMS_PY = LAB / "tools" / "helix_lab_tools" / "claims.py"
RECORD_PY = LAB / "tools" / "helix_lab_tools" / "record.py"
RUN_LAB_PY = LAB / "run_lab.py"
POLICY_REPORT = LAB / "policy_checks" / "latest" / "report.json"
KEPT_RUNS = ("reference-BTK-p.Arg28His", "approval-gate-demo-BTK-p.Arg28His")
DOCS = REPOSITORY / "docs" / "lab"
OBSERVED_WIDTH = 220

NUMBER_WORDS = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
}


def words(count: int) -> str:
    return NUMBER_WORDS.get(count, str(count))


def repository_path(path: Path) -> str:
    return str(path.relative_to(REPOSITORY))


def lines_of(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").rstrip("\n").split("\n")


def span(path: Path, first: str, last: str) -> tuple[int, int]:
    """One-based inclusive line range of the block that starts at `first` and ends at the next `last`."""
    body = lines_of(path)
    stripped = [line.strip() for line in body]
    try:
        start = stripped.index(first.strip())
    except ValueError as error:
        raise SystemExit(f"{repository_path(path)}: no line {first.strip()!r}") from error
    try:
        end = stripped.index(last.strip(), start)
    except ValueError as error:
        raise SystemExit(f"{repository_path(path)}: no line {last.strip()!r} after line {start + 1}") from error
    return start + 1, end + 1


def fence(language: str, body: str) -> str:
    return f"```{language}\n{body}\n```"


def quote(path: Path, language: str, first: str, last: str, *, caption: str | None = None) -> str:
    """A quoted block introduced by its path and the line numbers it was cut from."""
    start, end = span(path, first, last)
    body = "\n".join(lines_of(path)[start - 1 : end])
    lead = caption or f"`{repository_path(path)}`, lines {start} to {end}:"
    return f"{lead}\n\n{fence(language, body)}"


def quote_whole(path: Path, language: str) -> str:
    body = lines_of(path)
    lead = f"`{repository_path(path)}` (whole file, {len(body)} lines):"
    return f"{lead}\n\n{fence(language, chr(10).join(body))}"


def guardrails_line(path: Path) -> int:
    """One-based line of the `guardrails:` key: where the policy block of a spec starts."""
    for number, line in enumerate(lines_of(path), start=1):
        if line.startswith("guardrails:"):
            return number
    raise SystemExit(f"{repository_path(path)}: no guardrails block")


def spec_head(path: Path) -> str:
    """The identity and executor part of a spec: after the generated header, up to the policy block."""
    body = lines_of(path)
    start = 1
    while start <= len(body) and body[start - 1].startswith("#"):
        start += 1
    end = guardrails_line(path) - 1
    lead = f"`{repository_path(path)}`, lines {start} to {end}:"
    return f"{lead}\n\n{fence('yaml', chr(10).join(body[start - 1 : end]))}"


def guardrails_quote(path: Path) -> str:
    """The `guardrails.policies` block of a spec: from the `guardrails:` key to the end of the file."""
    body = lines_of(path)
    start = guardrails_line(path)
    lead = f"`{repository_path(path)}`, lines {start} to {len(body)}:"
    return f"{lead}\n\n{fence('yaml', chr(10).join(body[start - 1 :]))}"


def tool_files(directory: Path) -> list[str]:
    return sorted(path.stem for path in (directory / "tools" / "python").glob("*.py"))


def table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    out += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(out)


def tool_cell(names: list[str]) -> str:
    return ", ".join(f"`{name}`" for name in names)


def specialist_directory(role: str) -> Path:
    return LAB_BUNDLE / "agents" / role


def omnigent_version() -> str:
    return str(json.loads(POLICY_REPORT.read_text(encoding="utf-8"))["omnigent_version"])


def harness() -> str:
    return str(json.loads(POLICY_REPORT.read_text(encoding="utf-8"))["harness"])


def built_line() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------------------------------
# docs/lab/agent-specs.md


def files_table() -> str:
    rows = [
        [
            f"Supervisor (`{LAB_BUNDLE.name}`)",
            f"`{repository_path(LAB_BUNDLE / 'config.yaml')}`",
            f"`{repository_path(LAB_BUNDLE / 'AGENTS.md')}`",
            f"`{repository_path(LAB_BUNDLE / 'tools' / 'python')}/` ({len(tool_files(LAB_BUNDLE))} files)",
        ]
    ]
    for role, definition in registry.SPECIALISTS.items():
        directory = specialist_directory(role)
        rows.append(
            [
                f"{definition['title']} (`{role}`)",
                f"`{repository_path(directory / 'config.yaml')}`",
                f"`{repository_path(directory / 'AGENTS.md')}`",
                f"`{repository_path(directory / 'tools' / 'python')}/` ({len(tool_files(directory))} files)",
            ]
        )
    rows.append(
        [
            f"Control (`{BASELINE_BUNDLE.name}`)",
            f"`{repository_path(BASELINE_BUNDLE / 'config.yaml')}`",
            f"`{repository_path(BASELINE_BUNDLE / 'AGENTS.md')}`",
            f"`{repository_path(BASELINE_BUNDLE / 'tools' / 'python')}/`"
            f" ({len(tool_files(BASELINE_BUNDLE))} files)",
        ]
    )
    return table(["Agent", "Spec", "Prompt", "Tool files"], rows)


def ownership_table() -> str:
    supervisor = registry.SUPERVISOR
    rows = [
        [
            supervisor["title"],
            f"`{supervisor['model']}`",
            supervisor["decision"],
            tool_cell(list(supervisor["orchestration_tools"]) + list(supervisor["tools"])),
            supervisor["inputs"],
            supervisor["output"],
        ]
    ]
    for definition in registry.SPECIALISTS.values():
        rows.append(
            [
                definition["title"],
                f"`{definition['model']}`",
                definition["decision"],
                tool_cell(definition["tools"]),
                definition["inputs"],
                definition["output"],
            ]
        )
    baseline = registry.BASELINE
    rows.append(
        [
            baseline["title"],
            f"`{baseline['model']}`",
            baseline["decision"],
            f"all {len(baseline['tools'])} lab tools",
            baseline["inputs"],
            baseline["output"],
        ]
    )
    return table(["Agent", "Model", "Decision it owns", "Tools", "Inputs", "Output"], rows)


def specialist_section(role: str, definition: dict[str, Any]) -> str:
    directory = specialist_directory(role)
    config = directory / "config.yaml"
    policy_start = guardrails_line(config)
    policy_end = len(lines_of(config))
    present = ", ".join(f"`{name}`" for name in tool_files(directory))
    return "\n\n".join(
        [
            f"### {definition['title']} (`{role}`)",
            spec_head(config),
            f"Policy role in lines {policy_start} to {policy_end}: `{role}`.",
            f"Tool files present: {present}.",
            "Prompt:",
            quote_whole(directory / "AGENTS.md", "text"),
        ]
    )


def agent_specs_document() -> str:
    specialists = registry.SPECIALISTS
    count = len(specialists)
    config = LAB_BUNDLE / "config.yaml"
    baseline_config = BASELINE_BUNDLE / "config.yaml"
    specialist_config = specialist_directory(next(iter(specialists))) / "config.yaml"
    head_end = guardrails_line(specialist_config) - 1
    specialist_lines = len(lines_of(specialist_config))
    orchestration = registry.SUPERVISOR["orchestration_tools"]
    sections = [
        "# Agent specifications",
        f"Built on {built_line()} by `lab/tools/generate_lab_docs.py`, which reads the files named below."
        " Every quoted block is copied from the file at the line numbers given, so it goes stale when the"
        " file changes and the generator has not been run again. The tables are read from"
        " `lab/tools/helix_lab_tools/registry.py`, the file the agent bundles are generated from"
        " (`lab/tools/generate_agent_tools.py`).",
        f"The lab is one Omnigent agent bundle: a supervisor with {words(count)} sub-agents. A second bundle"
        f" holds the control, one generalist agent. Omnigent version {omnigent_version()}, harness"
        f" `{harness()}`.",
        "## Files",
        files_table(),
        f"Other files: the handoff contract `{repository_path(SKILL)}`; the same specifications as data in"
        f" `{repository_path(LAB / 'agents' / 'agents.json')}` (served by `GET /api/v1/lab/agents`).",
        "## What each agent owns",
        "Read from `SUPERVISOR`, `SPECIALISTS` and `BASELINE` in `registry.py`.",
        ownership_table(),
        f"The supervisor's first {words(len(orchestration))} tools ({tool_cell(list(orchestration))}) are"
        " Omnigent's own orchestration tools. All other tools are the lab's Python function tools, one file"
        " per tool under `tools/python/` of the agent that may call it.",
        "## Supervisor spec",
        quote_whole(config, "yaml"),
        "What the lines mean: `executor.type: omnigent` with `harness: claude-sdk` runs the agent on Omnigent"
        " driving Claude. `skills: none` keeps host skills and settings out. `tools.agents` lists the"
        f" {words(count)} sub-agents the supervisor can dispatch to. `guardrails.policies` attaches the"
        f" {words(len(POLICY_REGISTRY))} policies with the role `orchestrator` (see `docs/lab/policies.md`)."
        " No `os_env` is declared, so the agent has no shell and no file access.",
        "Supervisor prompt:",
        quote_whole(LAB_BUNDLE / "AGENTS.md", "text"),
        "## Specialist specs",
        f"Each specialist `config.yaml` has {specialist_lines} lines. Lines 1 to {head_end} are quoted for"
        f" each agent. Lines {head_end + 1} to {specialist_lines} are the `guardrails.policies` block, the"
        f" same {words(len(POLICY_REGISTRY))} policies as the supervisor with `role:` set to the agent's own"
        " name.",
    ]
    sections += [specialist_section(role, definition) for role, definition in specialists.items()]
    sections += [
        "## Control: single generalist agent",
        spec_head(baseline_config),
        f"Policy role in lines {guardrails_line(baseline_config)} to {len(lines_of(baseline_config))}:"
        f" `generalist`. It holds every lab tool ({len(tool_files(BASELINE_BUNDLE))} tool files) and no"
        " sub-agents.",
        "Prompt:",
        quote_whole(BASELINE_BUNDLE / "AGENTS.md", "text"),
        "## Handoff contract",
        "The supervisor loads this skill once per run. It names what each agent reads and what it must write"
        " to the shared record before it hands back.",
        quote_whole(SKILL, "markdown"),
        "## Who may call which tool",
        quote(
            REGISTRY_PY,
            "python",
            "def allowed_tools(role: str) -> frozenset[str]:",
            "return frozenset(role_tools(role)) | frozenset(orchestration) | HARNESS_TOOLS",
        ),
        quote(
            REGISTRY_PY,
            "python",
            'HARNESS_TOOLS = frozenset({"ToolSearch", "Skill", "sys_agent_start"})',
            'HARNESS_TOOLS = frozenset({"ToolSearch", "Skill", "sys_agent_start"})',
        ),
        "`role_boundary` (see `docs/lab/policies.md`) denies any call outside `allowed_tools(role)`.",
    ]
    return "\n\n".join(sections) + "\n"


# --------------------------------------------------------------------------------------------------
# docs/lab/policies.md

PHASE_WORDS = {"tool_call": "tool call", "response": "reply"}


def policy_table() -> str:
    rows = [
        [
            f"`{entry['handler'].rsplit('.', 1)[-1]}`",
            " and ".join(PHASE_WORDS[phase] for phase in phases_of(entry)),
            entry["description"],
        ]
        for entry in POLICY_REGISTRY
    ]
    return table(["Policy", "Phase", "Enforces"], rows)


def phases_of(entry: dict[str, Any]) -> list[str]:
    return ["tool_call", "response"] if entry["handler"].endswith("claims_guard") else ["tool_call"]


def approval_sentence() -> str:
    gated = {kind: definition for kind, definition in TESTS.items() if definition["requires_approval"]}
    free = [kind for kind, definition in TESTS.items() if not definition["requires_approval"]]
    named = ", ".join(f"`{kind}` (`{definition['tool']}`)" for kind, definition in gated.items())
    cost = ", ".join(str(definition["cost"]["compute_seconds"]) for definition in gated.values())
    return (
        f"In the catalogue only {named} has `requires_approval: True` (cost {cost} compute seconds). The"
        f" {words(len(free))} retrieval-only tests have `requires_approval: False`."
    )


def observed_cell(observed: dict[str, Any]) -> str:
    if "verdict" in observed:
        text = f"{observed['verdict']} on `{observed['tool']}`: {observed['reason']}"
    else:
        text = ", ".join(f"{key} = {value}" for key, value in observed.items())
    text = text.replace("|", "\\|").replace("\n", " ")
    return text if len(text) <= OBSERVED_WIDTH - 3 else text[: OBSERVED_WIDTH - 3] + "..."


def verification_section() -> str:
    report = json.loads(POLICY_REPORT.read_text(encoding="utf-8"))
    checks = report["checks"]
    passed = sum(1 for check in checks if check["passed"])
    rows = [
        [
            f"`{check['id']}`",
            f"`{check['policy']}`",
            check["expectation"],
            "yes" if check["passed"] else "no",
            observed_cell(check["observed"]),
        ]
        for check in checks
    ]
    return "\n\n".join(
        [
            "## Verification with real Omnigent sessions",
            "`lab/verify_policies.py` runs a probe agent"
            f" ({report['probe_agent']}) and asserts what the policy log shows. Last run:"
            f" {report['generated_at']}, Omnigent {report['omnigent_version']}, harness"
            f" `{report['harness']}`, {passed} of {len(checks)} checks passed"
            f" (`{repository_path(POLICY_REPORT)}`).",
            table(["Check", "Policy", "Expectation", "Passed", "Observed"], rows),
        ]
    )


def kept_run_paragraph(name: str) -> str:
    directory = LAB / "runs" / name
    run = json.loads((directory / "run.json").read_text(encoding="utf-8"))
    decisions = [json.loads(line) for line in (directory / "policy_log.jsonl").read_text().splitlines() if line]
    denials = sum(1 for decision in decisions if decision.get("verdict") == "DENY")
    head = (
        f"**`{repository_path(directory)}/`**: approval mode \"{run['approval_mode']}\","
        f" {run['metrics']['approvals']} approval"
        f" {'decision' if run['metrics']['approvals'] == 1 else 'decisions'},"
        f" {run['metrics']['policy_denials']} policy denials in `run.json`; `policy_log.jsonl` holds"
        f" {len(decisions)} policy decisions, {denials} of them DENY."
    )
    bullets = []
    for line in (directory / "record.jsonl").read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        event = json.loads(line)
        payload = event.get("payload", {})
        if event["type"] == "note" and payload.get("kind") == "safety_review":
            bullets.append(
                f"- seq {event['seq']}, `{event['agent']}`, safety review of {payload['test_id']} for plan"
                f" seq {payload['plan_seq']}: verdict `{payload['verdict']}`, `requires_approval:"
                f" {str(payload['requires_approval']).lower()}`."
            )
        elif event["type"] == "approval_request":
            bullets.append(
                f"- seq {event['seq']}, `{event['agent']}`, approval request {payload['id']}: action"
                f" \"{payload['action']}\"; risk \"{payload['risk']}\""
            )
        elif event["type"] == "approval_decision":
            bullets.append(
                f"- seq {event['seq']}, approval decision {payload['id']}: `{payload['decision']}` by"
                f" \"{payload['by']}\"; note \"{payload['note']}\""
            )
    return head + "\n\n" + "\n".join(bullets)


def policies_document() -> str:
    config = LAB_BUNDLE / "config.yaml"
    roles = list(registry.SPECIALISTS)
    role_list = ", ".join(f"`{role}`" for role in roles) + " or `generalist`"
    limits = {
        "tool_calls": budget.DEFAULT_MAX_TOOL_CALLS,
        "compute_seconds": budget.DEFAULT_MAX_COMPUTE_SECONDS,
    }
    reference = json.loads((LAB / "runs" / KEPT_RUNS[0] / "run.json").read_text(encoding="utf-8"))["budget"]
    sections = [
        "# Policies and the human approval gate",
        f"Built on {built_line()} by `lab/tools/generate_lab_docs.py`, which reads the files named below."
        " Every quoted block is copied from the file at the line numbers given, so it goes stale when the"
        " file changes and the generator has not been run again.",
        f"{words(len(POLICY_REGISTRY)).capitalize()} Omnigent policies are Python functions in"
        " `lab/policies/helix_lab_policies/policies.py`. Each agent's `config.yaml` declares all"
        f" {words(len(POLICY_REGISTRY))} under `guardrails.policies` with the agent's own role.",
        policy_table(),
        "## How the policies are declared",
        guardrails_quote(config),
        f"The {words(len(roles))} specialist specs and the control spec hold the same block with `role:` set"
        f" to {role_list}.",
        "## Supervisor policies abstain on sub-agent calls",
        f"Omnigent {omnigent_version()} also evaluates a supervisor's policies on its sub-agents' tool calls."
        " The supervisor's instances return no verdict there, so the sub-agent's own instance, which knows"
        " its role, decides.",
        quote(
            POLICIES_PY,
            "python",
            "def _is_subagent_event(event: Event) -> bool:",
            'return role == "orchestrator" and _is_subagent_event(event)',
        ),
        "## Every denial is logged and written to the research record",
        quote(
            POLICIES_PY,
            "python",
            "def _deny(policy: str, role: str, tool: str, reason: str) -> Verdict:",
            'return {"result": "DENY", "reason": reason}',
        ),
        "## 1. `role_boundary`",
        "Denies every tool that is not in the calling agent's role. This includes tools Omnigent registers"
        " for every agent by default.",
        quote(POLICIES_PY, "python", "def role_boundary(role: str) -> Evaluator:", "return evaluate"),
        "## 2. `approval_gate`",
        "A test tool runs only when four conditions hold in the record: a plan exists, the call is the plan's"
        " chosen test, the safety agent cleared that test for that plan, and, for a tool that starts a"
        " compute job, an `approval_decision` with `decision: approved` exists.",
        quote(POLICIES_PY, "python", "def approval_gate(role: str) -> Evaluator:", "return evaluate"),
        "Which tools are tests, and which need a human:",
        quote(
            CATALOGUE_PY,
            "python",
            'EXPERIMENT_TOOLS: dict[str, str] = {definition["tool"]: kind for kind, definition in'
            " TESTS.items()}",
            ")",
        ),
        approval_sentence(),
        "## 3. `claims_guard`",
        "Refuses record tools and replies that hold clinical or treatment wording, cite a record ID that is"
        " not in the run record, or state a measured value or database classification without a record ID.",
        quote(POLICIES_PY, "python", "def claims_guard(role: str) -> Evaluator:", "return evaluate"),
        "The text checks it calls:",
        quote(CLAIMS_PY, "python", "CLINICAL_PATTERNS = [", "]"),
        quote(CLAIMS_PY, "python", "FACT_MARKERS = [", "]"),
        quote(
            CLAIMS_PY,
            "python",
            "def check_text(text: str, known_ids: set[str] | None = None, *, require_citations: bool ="
            " False) -> list[str]:",
            "return problems",
        ),
        "## 4. `run_budget`",
        "Caps lab tool calls and compute seconds for the whole run. After the cap, only the tools that close"
        " a run stay available.",
        quote(POLICIES_PY, "python", "def run_budget(role: str) -> Evaluator:", "return evaluate"),
        quote(REGISTRY_PY, "python", "CLOSING_TOOLS = frozenset(", ")"),
        f"Launcher default budget of a run: {limits['tool_calls']} lab tool calls and"
        f" {limits['compute_seconds']} compute seconds (`DEFAULT_MAX_TOOL_CALLS` and"
        " `DEFAULT_MAX_COMPUTE_SECONDS` in `lab/tools/helix_lab_tools/budget.py`). The budget actually in"
        f" force is the `budget` block of each `run.json`; the kept reference run was given"
        f" {reference['max_tool_calls']} tool calls and {reference['max_compute_seconds']} compute seconds.",
        "## Human approval gate",
        "The safety agent calls `request_approval`. The tool writes an `approval_request` to the record and"
        " waits for an `approval_decision`. If none arrives before the timeout it writes a rejection itself.",
        quote(
            RECORD_PY,
            "python",
            'request = append_event(current_role(), "approval_request", build, refs=[test_id])',
            'return {"approval_id": approval_id, **timed_out["payload"]}',
        ),
        "A decision reaches the record in one of two ways.",
        "1. A human answers through the API, `POST /api/v1/lab/runs/{run_id}/approvals/{approval_id}`"
        " (`api/helix/routers/lab.py`). The run page calls this endpoint from its Approve and Reject"
        " buttons.\n2. The operator starts the launcher with `--approve`. The launcher then writes the"
        " decision with the operator's name:",
        quote(RUN_LAB_PY, "python", "if waiting and arguments.approve:", "waiting = []"),
        "Omnigent's own `ASK` verdict needs an attached interactive client. Lab runs are headless, so the"
        " approval state lives in the shared record and `approval_gate` returns `DENY` until an approved"
        ' decision is there (`lab/README.md`, section "Policies and approval gates").',
        "## The connector boundary",
        quote(
            RUN_LAB_PY,
            "python",
            "def child_environment(run_directory: Path, api_url: str, approval_timeout: int) ->"
            " dict[str, str]:",
            "return environment",
        ),
        "`ENABLE_CLAUDEAI_MCP_SERVERS=false` keeps the signed-in account's connectors out of the agents."
        " `lab/README.md` records that without it the `claude-sdk` harness exposed them.",
        verification_section(),
        "## What the kept runs show",
    ]
    sections += [kept_run_paragraph(name) for name in KEPT_RUNS]
    sections += [
        "In the approval demo no human answered within the 60 second timeout it was started with, the request"
        " was recorded as rejected, and the record holds no `experiment_started` event for the gated test."
        " The approved path (denied without a decision, allowed after one) is shown by the verification table"
        " above. `lab/README.md` states that an end-to-end approval through the API was exercised during"
        " development and that run was not kept, because the approval was given by the build agent.",
        "## Limits",
        "- `claims_guard` is a pattern check. It catches the listed phrasings and uncited sentences that carry"
        " a measured value or a database classification. It does not prove that no unsupported statement"
        " exists.\n- The approval state lives in the record, not in Omnigent's `ASK` verdict, because runs"
        " are headless.\n- `--approve` writes the decision before any human has read the individual request."
        " It is meant for an operator who has decided in advance, and the record names that operator.\n- The"
        " kept runs contain a rejection by timeout. They do not contain a decision made by a human through"
        " the page.",
    ]
    return "\n\n".join(sections) + "\n"


def main() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    for name, body in (
        ("agent-specs.md", agent_specs_document()),
        ("policies.md", policies_document()),
    ):
        (DOCS / name).write_text(body, encoding="utf-8")
        print(f"wrote docs/lab/{name} ({len(body.splitlines())} lines)")
    print(
        f"described 1 supervisor + {len(registry.SPECIALISTS)} specialists"
        f" = {1 + len(registry.SPECIALISTS)} agents, plus the control"
    )


if __name__ == "__main__":
    main()
