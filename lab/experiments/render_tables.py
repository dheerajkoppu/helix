"""Print the tables of RESULTS.md from lab/experiments/results/latest.json, so no number is typed by hand.

lab/.venv/bin/python lab/experiments/render_tables.py
"""

import json
from pathlib import Path
from typing import Any

RESULTS = Path(__file__).resolve().parent / "results"
SHORT = {"specialist_lab": "lab", "single_agent_baseline": "single agent"}


def show(value: Any) -> str:
    if value is None:
        return "–"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def table(header: list[str], rows: list[list[Any]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines.extend("| " + " | ".join(show(value) for value in row) + " |" for row in rows)
    return "\n".join(lines)


def main() -> None:
    body = json.loads((RESULTS / "latest.json").read_text(encoding="utf-8"))
    arms = {arm["id"]: arm for arm in body["arms"]}
    lab, baseline = arms["specialist_lab"], arms["single_agent_baseline"]

    print("### Arms\n")
    rows = []
    for name, key in [
        ("Runs succeeded / planned", None),
        ("Failed attempts", "failed_attempts"),
        ("Complete cited records", "complete_records"),
        ("Median wall seconds", "median_wall_seconds"),
        ("Wall seconds, min to max", None),
        ("Median seconds to first hypothesis", "median_seconds_to_first_hypothesis"),
        ("Median seconds to first plan", "median_seconds_to_first_plan"),
        ("Median seconds to first result", "median_seconds_to_first_result"),
        ("Median seconds to first decision", "median_seconds_to_first_decision"),
        ("Median seconds to final report", "median_seconds_to_final_report"),
        ("Mean lab tool calls", "mean_tool_calls"),
        ("Median wall seconds per lab tool call", "median_wall_seconds_per_lab_tool_call"),
        ("Mean output tokens (Omnigent accounting, sub-agents included)", "mean_output_tokens"),
        ("Mean cost as reported by Omnigent, USD", "mean_omnigent_reported_cost_usd"),
        ("Mean distinct databases cited", "mean_distinct_sources"),
        ("Mean distinct databases cited before the first hypothesis", "mean_starting_distinct_sources"),
        ("Mean databases returned by the scripted pass", "mean_databases_returned_by_scripted_pass"),
        ("Mean share of those databases cited", "mean_share_of_scripted_pass_databases_cited"),
        ("Mean evidence items", "mean_evidence_items"),
        ("Mean evidence items before the first hypothesis", "mean_starting_evidence_items"),
        ("Mean hypotheses", "mean_hypotheses"),
        ("Mean tests considered", "mean_tests_considered"),
        ("Mean tests executed", "mean_tests_executed"),
        ("Runs with a reopening", "runs_with_reopening"),
        ("Runs where the favoured hypothesis changed", "decision_changed"),
        ("Approvals granted / rejected", None),
        ("Policy denials", "policy_denials"),
        ("Safety reviews with verdict blocked", "safety_reviews_blocked"),
        ("Plans whose test did not run", "plans_without_result"),
    ]:
        if name.startswith("Runs succeeded"):
            values = [f"{arm['runs']} / {arm['runs_planned']}" for arm in (lab, baseline)]
        elif name.startswith("Wall seconds, min"):
            values = [f"{arm['min_wall_seconds']} to {arm['max_wall_seconds']}" for arm in (lab, baseline)]
        elif name.startswith("Approvals"):
            values = [f"{arm['approvals_approved']} / {arm['approvals_rejected']}" for arm in (lab, baseline)]
        else:
            values = [lab[key], baseline[key]]
        rows.append([name, *values])
    for label, key in [
        ("Agreement with the reference after the test", "agreement"),
        ("Agreement with the reference before the test", "agreement_before_test"),
        ("Agreement, residue-specific reference only", "agreement_residue_specific_reference"),
    ]:
        rows.append(
            [label, *[f"{arm[key]['n_agree']} of {arm[key]['n_with_reference']}" for arm in (lab, baseline)]]
        )
    print(table(["Measure", "Specialist lab", "Single agent"], rows))

    print("\n### Tool calls by purpose (mean per run)\n")
    categories = list(lab["mean_tool_calls_by_purpose"])
    print(
        table(
            ["Purpose", "Specialist lab", "Single agent"],
            [
                [
                    category,
                    lab["mean_tool_calls_by_purpose"][category],
                    baseline["mean_tool_calls_by_purpose"][category],
                ]
                for category in categories
            ],
        )
    )

    print("\n### Paired comparison (lab minus single agent, variants where both succeeded)\n")
    print(
        table(
            [
                "Metric",
                "Pairs",
                "Lab higher",
                "Single agent higher",
                "Ties",
                "Median difference",
                "Median ratio lab ÷ single agent",
                "Sign test p",
            ],
            [
                [
                    row["metric"],
                    row["n_pairs"],
                    row["lab_higher"],
                    row["baseline_higher"],
                    row["ties"],
                    row["median_difference_lab_minus_baseline"],
                    row["median_ratio_lab_over_baseline"],
                    row["sign_test_two_sided_p"],
                ]
                for row in body["comparison"]["paired"]
            ],
        )
    )

    print("\n### Per variant\n")
    rows = []
    for row in body["per_variant"]:
        rows.append(
            [
                row["variant_id"],
                SHORT[row["arm"]],
                row["status"],
                row["wall_seconds"],
                row.get("tool_calls"),
                row["distinct_sources"],
                row.get("evidence_items"),
                ", ".join(str(kind) for kind in row.get("chosen_tests") or []) or None,
                row.get("favoured_before"),
                row["favoured_after"],
                row["decision_changed"],
                row["reference_mechanism"],
                row["agrees"],
            ]
        )
    print(
        table(
            [
                "Variant",
                "Arm",
                "Status",
                "Wall s",
                "Tool calls",
                "Databases",
                "Evidence",
                "Tests chosen",
                "Favoured before",
                "Favoured after",
                "Changed",
                "Reference",
                "Agrees",
            ],
            rows,
        )
    )

    print("\n### Runs citing each database\n")
    names = sorted({name for arm in (lab, baseline) for name in arm["runs_citing_database"]})
    print(
        table(
            ["Database", "Specialist lab", "Single agent"],
            [
                [
                    name,
                    lab["runs_citing_database"].get(name, 0),
                    baseline["runs_citing_database"].get(name, 0),
                ]
                for name in names
            ],
        )
    )

    agreement = body["arm_concordance"]
    print("\n### Do the arms name the same mechanism class\n")
    print(
        table(
            ["Measure", "Variants"],
            [
                ["Pairs", agreement["n_pairs"]],
                ["Same class favoured before the test", agreement["same_favoured_before"]],
                ["Same class favoured after the test", agreement["same_favoured_after"]],
                ["Same first test chosen", agreement["same_first_test"]],
                ["Differ after the test", ", ".join(agreement["variants_differing_after"])],
            ],
        )
    )

    print("\n### First test chosen\n")
    kinds = sorted({kind for arm in (lab, baseline) for kind in arm["first_chosen_test"]}, key=str)
    print(
        table(
            ["Test", "Specialist lab", "Single agent"],
            [
                [kind, lab["first_chosen_test"].get(kind, 0), baseline["first_chosen_test"].get(kind, 0)]
                for kind in kinds
            ],
        )
    )

    failures = [
        [
            row["variant_id"],
            SHORT[row["arm"]],
            attempt["run_id"],
            attempt["status"],
            attempt["wall_seconds"],
            attempt["error"],
        ]
        for row in body["per_variant"]
        for attempt in row["failed_attempts"]
    ]
    print("\n### Attempts that did not succeed\n")
    print(table(["Variant", "Arm", "Run", "Status", "Wall s", "Error"], failures) if failures else "None.")

    if body.get("repeat_study"):
        print("\n### Repeat study\n")
        rows = []
        for cell in body["repeat_study"]:
            for run in cell["per_run"]:
                rows.append(
                    [
                        cell["variant_id"],
                        SHORT[cell["arm"]],
                        run["run_id"],
                        run["status"],
                        run["wall_seconds"],
                        run["tool_calls"],
                        run["distinct_sources"],
                        run["evidence_items"],
                        ", ".join(str(kind) for kind in run.get("chosen_tests") or []) or None,
                        run["favoured_before"],
                        run["favoured_after"],
                        run["decision_changed"],
                    ]
                )
        print(
            table(
                [
                    "Variant",
                    "Arm",
                    "Run",
                    "Status",
                    "Wall s",
                    "Tool calls",
                    "Databases",
                    "Evidence",
                    "Tests chosen",
                    "Favoured before",
                    "Favoured after",
                    "Changed",
                ],
                rows,
            )
        )


if __name__ == "__main__":
    main()
