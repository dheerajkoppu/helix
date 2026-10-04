"""Which agent may call which tool. The agent bundles, the role policy and the API listing are generated from this."""

from typing import Any

from helix_lab_tools.catalogue import CONSEQUENTIAL_TOOLS, EXPERIMENT_TOOLS

IMPLEMENTATIONS: dict[str, str] = {
    "search_entities": "helix_lab_tools.api",
    "get_gene": "helix_lab_tools.api",
    "get_protein": "helix_lab_tools.api",
    "get_variant": "helix_lab_tools.api",
    "list_variants_near": "helix_lab_tools.api",
    "get_residue_annotations": "helix_lab_tools.api",
    "get_variant_effect_values": "helix_lab_tools.api",
    "get_structure_ledger": "helix_lab_tools.api",
    "get_interactions": "helix_lab_tools.api",
    "search_literature": "helix_lab_tools.api",
    "get_publication": "helix_lab_tools.api",
    "get_job_status": "helix_lab_tools.api",
    "get_comparison_result": "helix_lab_tools.api",
    "search_openalex": "helix_lab_tools.openalex",
    "list_candidate_targets": "helix_lab_tools.discovery",
    "get_candidate_detail": "helix_lab_tools.discovery",
    "get_target_structure": "helix_lab_tools.discovery",
    "list_available_tests": "helix_lab_tools.experiments",
    "run_ligand_contact_test": "helix_lab_tools.experiments",
    "run_stability_test": "helix_lab_tools.experiments",
    "run_structural_context_test": "helix_lab_tools.experiments",
    "run_structure_comparison": "helix_lab_tools.experiments",
    "get_budget_status": "helix_lab_tools.budget",
    "read_record": "helix_lab_tools.record",
    "record_evidence": "helix_lab_tools.record",
    "record_gap": "helix_lab_tools.record",
    "record_hypothesis": "helix_lab_tools.record",
    "record_test_candidate": "helix_lab_tools.record",
    "record_plan": "helix_lab_tools.record",
    "review_claims": "helix_lab_tools.record",
    "record_safety_review": "helix_lab_tools.record",
    "request_approval": "helix_lab_tools.record",
    "record_result": "helix_lab_tools.record",
    "get_test_result": "helix_lab_tools.record",
    "record_interpretation": "helix_lab_tools.record",
    "record_decision": "helix_lab_tools.record",
    "record_next_experiment": "helix_lab_tools.record",
    "record_target_rationale": "helix_lab_tools.candidates",
    "propose_candidates": "helix_lab_tools.candidates",
    "review_candidates": "helix_lab_tools.candidates",
    "record_candidate_review": "helix_lab_tools.candidates",
    "record_candidate": "helix_lab_tools.candidates",
    "record_handoff": "helix_lab_tools.record",
    "record_reopening": "helix_lab_tools.record",
    "record_final_report": "helix_lab_tools.record",
    "check_record_consistency": "helix_lab_tools.record",
}

RETRIEVAL_TOOLS = frozenset(
    {
        "search_entities",
        "get_gene",
        "get_protein",
        "get_variant",
        "list_variants_near",
        "get_residue_annotations",
        "get_variant_effect_values",
        "get_structure_ledger",
        "get_interactions",
        "search_literature",
        "get_publication",
        "search_openalex",
        "get_job_status",
        "get_comparison_result",
        "list_available_tests",
        "list_candidate_targets",
        "get_candidate_detail",
        "get_target_structure",
    }
)

# Tools that close a run; they stay available after the tool-call budget is spent so the record can be
# finished. The candidates step is the last step of the loop, so its tools belong here too.
CLOSING_TOOLS = frozenset(
    {
        "read_record",
        "get_budget_status",
        "record_result",
        "record_interpretation",
        "record_decision",
        "record_next_experiment",
        "list_candidate_targets",
        "get_candidate_detail",
        "record_target_rationale",
        "propose_candidates",
        "review_candidates",
        "record_candidate_review",
        "record_candidate",
        "record_handoff",
        "record_final_report",
    }
)

SPECIALISTS: dict[str, dict[str, Any]] = {
    "literature": {
        "title": "Literature agent",
        "model": "claude-sonnet-5",
        "decision": "Which published findings count as evidence about the variant's mechanism, and what the literature leaves unanswered.",
        "inputs": "Objective and subject (gene, variant, protein, residue) from the supervisor.",
        "output": "Evidence items of class literature with Europe PMC or OpenAlex record IDs; gaps.",
        "tools": [
            "search_literature",
            "get_publication",
            "search_openalex",
            "read_record",
            "record_evidence",
            "record_gap",
            "record_handoff",
        ],
    },
    "knowledge_graph": {
        "title": "Knowledge graph agent",
        "model": "claude-sonnet-5",
        "decision": "Which database records enter the evidence graph, how each is classed and linked, and whether the graph is consistent.",
        "inputs": "Objective and subject from the supervisor; after a test, the recorded result.",
        "output": "Evidence items with database record IDs for variant, residue, protein and structures; gaps; after a test, result evidence linked to hypotheses and a consistency report.",
        "tools": [
            "search_entities",
            "get_gene",
            "get_protein",
            "get_variant",
            "list_variants_near",
            "get_residue_annotations",
            "get_variant_effect_values",
            "get_structure_ledger",
            "get_interactions",
            "read_record",
            "get_test_result",
            "record_evidence",
            "record_gap",
            "check_record_consistency",
            "record_handoff",
        ],
    },
    "insight": {
        "title": "Insight agent",
        "model": "claude-sonnet-5",
        "decision": "Which competing mechanisms are worth testing, which one the starting evidence favours, and what would refute each.",
        "inputs": "Evidence and gaps in the record.",
        "output": "At least two hypotheses of different mechanism classes, each labelled agent-generated hypothesis, with supporting evidence IDs, a refutation criterion and a starting rank.",
        "tools": ["read_record", "record_hypothesis", "record_handoff"],
    },
    "planner": {
        "title": "Experiment planner",
        "model": "claude-sonnet-5",
        "decision": "Which single test to run next within the remaining budget.",
        "inputs": "Hypotheses, the test catalogue with live availability, the remaining budget, earlier results.",
        "output": "At least two test candidates scored for expected learning, feasibility and cost; a plan naming the chosen test and why each other candidate was rejected.",
        "tools": [
            "read_record",
            "list_available_tests",
            "get_budget_status",
            "record_test_candidate",
            "record_plan",
            "record_handoff",
        ],
    },
    "safety": {
        "title": "Safety agent",
        "model": "claude-sonnet-5",
        "decision": "Whether the plan, the recorded claims and the proposed candidates may proceed, and whether a human must approve the action.",
        "inputs": "The plan, the chosen test candidate, every statement in the record, and the candidate proposal with each direction check.",
        "output": "A safety review (cleared or blocked) with findings; an approval request and the human decision for a consequential test; a candidate review that rejects every candidate whose direction check is not matches.",
        "tools": [
            "read_record",
            "review_claims",
            "record_safety_review",
            "request_approval",
            "review_candidates",
            "record_candidate_review",
            "record_handoff",
        ],
    },
    "runner": {
        "title": "Experiment runner",
        "model": "claude-sonnet-5",
        "decision": "None about science: it executes exactly the chosen and cleared test and reports what was measured.",
        "inputs": "The plan, the safety review and the approval decision in the record.",
        "output": "experiment_started and experiment_result events with values, controls, sources, a reproducible command and, for jobs, the job ID and manifest URL.",
        "tools": [
            "read_record",
            "run_ligand_contact_test",
            "run_stability_test",
            "run_structural_context_test",
            "run_structure_comparison",
            "get_job_status",
            "get_comparison_result",
            "record_result",
            "record_handoff",
        ],
    },
    "analysis": {
        "title": "Analysis agent",
        "model": "claude-sonnet-5",
        "decision": "What the result means for each hypothesis, which hypothesis is favoured now, and what to test next.",
        "inputs": "Hypotheses, the plan and the stored result values.",
        "output": "An interpretation with a verdict per hypothesis and stated uncertainty; the updated decision; the next experiment.",
        "tools": [
            "read_record",
            "get_test_result",
            "record_interpretation",
            "record_decision",
            "record_next_experiment",
            "record_handoff",
        ],
    },
    "translator": {
        "title": "Translator agent",
        "model": "claude-sonnet-5",
        "decision": "Given the favoured mechanism and its direction, what a drug could act on, and whether a molecule that does it already exists.",
        "inputs": "The favoured mechanism and its direction after the decision; the candidate response of the discovery endpoint.",
        "output": "A target rationale with the direction rule, a candidate proposal for the safety review, and one candidate per cleared row carrying its bridge, direction check, evidence and the label Helix hypothesis.",
        "tools": [
            "read_record",
            "list_candidate_targets",
            "get_candidate_detail",
            "get_target_structure",
            "record_target_rationale",
            "propose_candidates",
            "record_candidate",
            "record_gap",
            "record_handoff",
        ],
    },
}

SUPERVISOR: dict[str, Any] = {
    "title": "Principal investigator (supervisor)",
    "model": "claude-sonnet-5",
    "decision": "The order of the loop, when a result reopens an earlier assumption, and when the run is complete.",
    "inputs": "The objective and budget set by the scientist.",
    "output": "Handoffs to every specialist, reopening notes, and the final cited report.",
    "tools": [
        "read_record",
        "get_budget_status",
        "record_handoff",
        "record_reopening",
        "record_final_report",
    ],
    "orchestration_tools": ["sys_session_send", "sys_read_inbox", "sys_session_get_history", "load_skill"],
}

BASELINE: dict[str, Any] = {
    "title": "Single generalist agent (control)",
    "model": "claude-sonnet-5",
    "decision": "Every decision of the loop, alone.",
    "inputs": "The objective and budget set by the scientist.",
    "output": "The same record as the lab, written by one agent.",
    "tools": sorted(IMPLEMENTATIONS),
    "orchestration_tools": [],
}

# Tools of the CLI harness itself; they only load tool schemas and bundle skills
HARNESS_TOOLS = frozenset({"ToolSearch", "Skill", "sys_agent_start"})


def role_tools(role: str) -> list[str]:
    if role == "orchestrator":
        return list(SUPERVISOR["tools"])
    if role == "generalist":
        return list(BASELINE["tools"])
    return list(SPECIALISTS[role]["tools"])


def allowed_tools(role: str) -> frozenset[str]:
    orchestration: list[str] = []
    if role == "orchestrator":
        orchestration = SUPERVISOR["orchestration_tools"]
    return frozenset(role_tools(role)) | frozenset(orchestration) | HARNESS_TOOLS


LAB_TOOLS = frozenset(IMPLEMENTATIONS)

__all__ = [
    "BASELINE",
    "CLOSING_TOOLS",
    "CONSEQUENTIAL_TOOLS",
    "EXPERIMENT_TOOLS",
    "HARNESS_TOOLS",
    "IMPLEMENTATIONS",
    "LAB_TOOLS",
    "RETRIEVAL_TOOLS",
    "SPECIALISTS",
    "SUPERVISOR",
    "allowed_tools",
    "role_tools",
]
