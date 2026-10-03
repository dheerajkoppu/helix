# Benchmark protocol: specialist lab against a single agent

Written on 2026-10-03 before the first benchmark run. Results are in `RESULTS.md`; anything done differently from this protocol is listed there under "Deviations".

## 1. Question

The lab attacks one bottleneck: going from a variant to a cited, ranked mechanism hypothesis, tested once, normally means visiting many databases and tools by hand.

The benchmark asks what the multi-agent organisation adds to that. A single agent with the same tools can also assemble evidence, choose a test and update its conclusion. So the comparison is:

> For the same variant, tools, model, policies and budget, how do a supervised team of seven specialist agents and one generalist agent differ in the time to a complete cited record, in the breadth of the evidence they cite, in the conclusion they reach, and in whether the test changes that conclusion?

No human is timed. The benchmark cannot say how much faster either arm is than manual work, and `RESULTS.md` makes no such claim.

Before the benchmark, the only timings were single development runs on BTK p.Arg28His reported by the lab builder (specialist lab 188 to 310 s, single agent 93 s). They suggest the lab is slower, not faster, than one agent. The protocol therefore does not assume a speed-up; it measures the direction and size of every difference.

## 2. Arms

| Arm                     | Bundle                          | Agents                                                                                           |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `specialist_lab`        | `lab/agents/helix_lab`      | Omnigent supervisor plus literature, knowledge graph, insight, planner, safety, runner, analysis |
| `single_agent_baseline` | `lab/agents/helix_baseline` | One generalist agent holding every lab tool                                                      |

Held equal: the tool implementations (one registry), the model (read from each `run.json`), the four policies (role boundary, approval gate, claims guard, run budget), the budget (160 lab tool calls, 300 compute seconds), the objective text and subject line (built by `lab/run_lab.py`), the approval rule (section 5), the Helix API instance.

Not equal by design: the lab's supervisor may reopen the earlier choice once and run a second test; the control prompt has no reopening step. The lab also has a knowledge-graph update after the test that records the result as evidence. Counts that these steps inflate (evidence items, tests executed, decisions changed) are reported next to counts taken before the first hypothesis, which both arms produce the same way.

## 3. Variants

The first-listed flagship variant of every gene in `data/seed/catalog.json`, in catalogue order: 13 variants in 13 genes. The rule uses no property of the variant other than its position in the list. The demonstration case BTK p.Arg28His is the first-listed BTK variant.

ADA p.Arg211His, IL2RG p.Arg226Cys, BTK p.Arg28His, WAS p.Thr45Met, RAG1 p.Arg404Gln, JAK3 p.Arg103His, CYBB p.His101Arg, STAT3 p.Arg382Trp, STAT1 p.Arg274Trp, FOXP3 p.Ala384Thr, CD40LG p.Thr254Met, PIK3CD p.Glu1021Lys, CTLA4 p.Arg75Trp.

Known before the run: UniProtKB describes STAT1 p.Arg274Trp and PIK3CD p.Glu1021Lys as gain of function. The launcher's objective says "loss of function" for every variant. The two variants stay in the set, the objective is not edited, and `RESULTS.md` reports whether either arm noticed.

One run per variant and arm: 26 runs. If time or rate limits stop the batch, the smaller number is reported as it is.

## 4. Metrics

All read from `lab/runs/<run_id>/run.json` and `record.jsonl` by `run_benchmark.py`; none is typed by hand.

Primary (the bottleneck):

- **Wall seconds to a complete cited record**: `metrics.wall_seconds` of the launcher, from the start of the run to its end. It includes the start of the per-run Omnigent server and the transcript export in both arms. Compared as the median per arm and as paired differences per variant. `comparison.ratio` is baseline ÷ lab: above 1 the lab is faster.

A record is complete when it holds an objective, evidence items that each cite a database record, at least two hypotheses of different mechanism classes labelled agent-generated, at least two test candidates, a plan, an experiment result with a reproducible command, an interpretation with stated uncertainty, a decision, a next experiment and a final report.

Secondary:

- Lab tool calls (`metrics.tool_calls`; Omnigent's dispatch calls are not counted).
- Distinct databases cited by evidence and results (`metrics.distinct_sources`), and the same count over the evidence recorded before the first hypothesis.
- Evidence items, in total and before the first hypothesis.
- Hypotheses, test candidates considered, tests executed, which test was chosen first.
- Whether the test changed the favoured hypothesis (`outcome.decision_changed`: the hypothesis favoured after the last decision differs from the one ranked first on the starting evidence), and reopenings.
- Agreement of `outcome.favoured_after` with the reference (section 6), and the same for `favoured_before`, so that a change towards or away from the reference is visible.
- Approvals, policy denials, failed attempts.
- Seconds from the first record event to the first hypothesis, plan, result, decision and to the final report (record timestamps, one-second resolution).

Paired comparisons use the variants where both arms succeeded, report how many pairs go each way and the median paired difference, and give an exact two-sided sign test. With 13 pairs at most, the sign test can only detect differences that go the same way in nearly every pair.

Not measured: the correctness of individual evidence statements, the quality of the reports, any outcome in a laboratory.

## 5. Approvals

The lab's approval gate guards one action: a `structure_comparison` job, which starts an Helix `variant_comparison` job (120 compute seconds in the catalogue, capped by the run's compute budget) and sends the reference and variant sequence of a domain construct of a public UniProtKB entry to the configured prediction provider.

Rule for the benchmark: every run of both arms is launched with `--approve`. Whoever starts `run_benchmark.py` approves that one action in advance for every run of the batch. Nothing else is pre-approved; the role boundary, the claims guard and the budget stay enforced. Each granted approval is written to the run's record as an `approval_decision` with `by` set to the `--operator` text, which names this rule and who started the batch.

This batch is started by an automated build agent in the repository owner's session. The operator text says so. No human reviews individual requests during the batch; that is the documented exception an unattended benchmark needs, and it is why the pre-approval covers a single, bounded action.

## 6. Reference

A label per variant, derived by `reference_labels.py` from data the lab does not serve, before any benchmark run, and never passed to an agent in a prompt or a tool result.

Source: the UniProtKB entry fetched directly from `rest.uniprot.org` (entry version recorded), with the raw response kept in `reference/snapshots/`. Rules, in this order:

| Rule | UniProtKB annotation                                                                                                                                                                      | Label                                                                     | Tier             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| R1   | Active-site feature at the residue (span of 10 residues or fewer)                                                                                                                         | `catalytic_site`                                                          | residue-specific |
| R2   | Binding-site feature at the residue (span of 10 or fewer)                                                                                                                                 | `ligand_binding`, or `nucleic_acid_binding` when the ligand is DNA or RNA | residue-specific |
| R3   | Site feature at the residue that names an interaction                                                                                                                                     | `protein_interaction`                                                     | residue-specific |
| R4   | Natural-variant or mutagenesis feature for this exact substitution whose description names a molecular effect (keyword patterns in the script; clauses that negate an effect are skipped) | the class the pattern names                                               | residue-specific |
| R5   | Residue inside a DNA-binding region feature                                                                                                                                               | `nucleic_acid_binding`                                                    | region-level     |
| R6   | Residue inside a region feature described as an interaction or dimerisation region                                                                                                        | `protein_interaction`                                                     | region-level     |

A residue-specific label wins over a region-level one. Annotations of the same tier that name different classes give no label. A substitution UniProtKB describes as gain of function gets no label, because the lab's classes describe ways to lose function. A variant with no label is left out of the agreement metric.

Each label also records whether experimental structures corroborate it: PDBe-KB residue-level interface and ligand-site annotations for the same UniProt accession (the residue contacts DNA, a ligand, or another protein in a deposited structure). This does not set or change the label.

Result of the derivation (`reference/labels.json`), fixed before the first run:

| Variant                                                                                  | Reference              | Tier             | UniProtKB annotation                                         | Structures                    |
| ---------------------------------------------------------------------------------------- | ---------------------- | ---------------- | ------------------------------------------------------------ | ----------------------------- |
| BTK p.Arg28His                                                                           | `ligand_binding`       | residue-specific | Binding site 28, inositol 1,3,4,5-tetrakisphosphate          | corroborated                  |
| CYBB p.His101Arg                                                                         | `ligand_binding`       | residue-specific | Binding site 101, heme b, axial residue                      | corroborated                  |
| STAT3 p.Arg382Trp                                                                        | `nucleic_acid_binding` | residue-specific | VAR_037367: "reduced DNA-binding ability"                    | corroborated                  |
| FOXP3 p.Ala384Thr                                                                        | `nucleic_acid_binding` | region-level     | DNA-binding region 337 to 423                                | corroborated                  |
| RAG1 p.Arg404Gln                                                                         | `nucleic_acid_binding` | region-level     | DNA-binding region 392 to 459                                | no human structure in PDBe-KB |
| JAK3 p.Arg103His                                                                         | `protein_interaction`  | region-level     | Region 1 to 223, interaction with cytokine receptors         | not observed                  |
| ADA p.Arg211His, IL2RG p.Arg226Cys, WAS p.Thr45Met, CD40LG p.Thr254Met, CTLA4 p.Arg75Trp | none                   |                  | No functional-site feature and no described molecular effect |                               |
| STAT1 p.Arg274Trp, PIK3CD p.Glu1021Lys                                                   | none                   |                  | Described as gain of function                                |                               |

So agreement is measured on 6 variants, 3 of them with a residue-specific label. Agreement on all 6 and on the 3 residue-specific ones are both reported.

Limits of the reference, known in advance:

- **It is not blind.** The label is hidden, but the UniProtKB features behind it are returned by `get_residue_annotations` and `get_variant`, which both arms hold. Agreement measures whether an arm's final conclusion is consistent with curated annotation it could read, not whether it rediscovered a mechanism.
- **A region-level label is weak.** Lying inside a DNA-binding domain does not show that a substitution acts through DNA binding.
- **Strict matching.** A run agrees only when its `favoured_after` class equals the label. Near misses are listed in `RESULTS.md`, not counted.
- **The lab is not tuned to it.** No prompt, tool, class definition or policy of the lab is changed for the benchmark.

## 7. Controls

1. Same tools, model, policies, budget, objective text and approval rule in both arms (section 2).
2. Variant set and reference labels fixed before the first run; the hash of `labels.json` is stored in the results.
3. Caches warmed: `preflight.py` calls every retrieval tool and the three retrieval-only tests for every variant twice before the batch, without an agent. Neither arm pays for a cold upstream database. Its second pass also measures how long the tools take when nothing has to decide which one to call.
4. Same concurrency: both arms share one pool of 3 workers. The lab starts first on odd-numbered variants and the control on even-numbered ones.
5. Citations: `record_evidence` refuses a database record that no tool returned in the run, in both arms.
6. `spec_hash` (agent bundle, policies, tool package) is recorded per run; if another builder changes the lab during the batch, the number of distinct hashes per arm is reported.
7. Failed runs stay in `lab/runs/` and are counted. A failed run is retried once under a new run ID ending in `-r2`. Medians use succeeded runs only, and the number of failures is reported next to them.
8. Each run has a wall-clock limit of 1500 s.
9. Negative and specificity controls of the tests themselves are in each result (`controls`), as documented in `lab/tools/helix_lab_tools/catalogue.py`.

## 8. Threats to validity known before the run

- **Small n, no repeats.** 13 variants, one run per cell. Development runs on BTK p.Arg28His varied between runs in the starting favourite and in whether the decision changed. A single run per cell cannot separate a difference between arms from run-to-run variation.
- **Same model in both arms.** The comparison isolates the organisation of the agents, not model capability.
- **Shared signal.** AlphaMissense, EVE and popEVE in the starting evidence share training signal with clinical labels. They support "damaging", not a mechanism, and cannot validate one.
- **Reference visible through tools** (section 6).
- **Withheld measurements.** Structure-based values are withheld from the starting evidence and offered as tests. That design choice creates room for a decision to change.
- **Test catalogue.** No test measures contact with DNA or with a partner protein in experimental structures. Hypotheses of class `nucleic_acid_binding` and `protein_interaction` can only be tested indirectly.
- **Shared machine.** Other builds use the same API server and the same model account during the batch. Wall times include that load; interleaving the arms spreads it over both.
- **Objective wording.** "Loss of function" is wrong for the two gain-of-function variants.

## 9. Reproduce

```bash
lab/.venv/bin/python lab/experiments/reference_labels.py      # labels from the stored UniProtKB snapshots; --refresh fetches again
lab/.venv/bin/python lab/experiments/preflight.py             # scripted retrieval, warms the caches
lab/.venv/bin/python lab/experiments/run_benchmark.py         # runs what is missing, 3 in parallel, then aggregates
lab/.venv/bin/python lab/experiments/run_benchmark.py --aggregate-only
```

Outputs: `results/latest.json` (served by `GET /api/v1/lab/benchmark`), `results/<batch>.json`, `results/attempts-<batch>.jsonl`, `results/conditions-<batch>.json`, `results/preflight.json`, one log per run under `results/logs/`, and one run directory per attempt under `lab/runs/`.

## 10. Repeat study (added while the batch was running)

Added at 22:15 UTC on 2026-10-03, seven minutes after the batch started, when 7 of 26 runs had finished and before any aggregate had been read. Sections 1 to 9 are unchanged.

Reason: section 8 names single runs without repeats as the main threat. One cell can be repeated cheaply.

After the main batch, BTK p.Arg28His is run two more times in each arm under the same conditions (batches `bench01-repeat2` and `bench01-repeat3`), giving three runs per arm on the demonstration case. The repeats are reported as a separate table (`repeat_study` in `latest.json`) and are not pooled into the 13-variant comparison. With three runs per arm they show a range, not a variance estimate.

```bash
lab/.venv/bin/python lab/experiments/run_benchmark.py --batch bench01-repeat2 --variants BTK-p.Arg28His --secondary
lab/.venv/bin/python lab/experiments/run_benchmark.py --batch bench01-repeat3 --variants BTK-p.Arg28His --secondary
lab/.venv/bin/python lab/experiments/run_benchmark.py --aggregate-only
```
