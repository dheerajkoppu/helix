# Helix lab

An agentic research lab on top of the Helix API, orchestrated by Omnigent (open source, version 0.16.0). A supervisor and eight specialist agents run one recorded discovery loop per variant:

**Question → Evidence → Hypothesis → Experiment → Result → Updated decision → Candidates**

The question of every run: for a pathogenic missense variant in an immune-deficiency gene, which molecular mechanism best explains the loss of function, does a targeted computational test change the conclusion that the starting evidence suggested, and what could a drug act on if that mechanism is right?

The loop does not end on the decision. It ends on candidates: the proteins a molecule could act on, and the molecules already known to act on them, each one carrying the chain of records it was reached through and the check that it pushes the protein the way the mechanism needs.

The bottleneck it attacks: going from a variant to a cited, ranked mechanism hypothesis, and from there to something a drug could aim at, normally means visiting many databases and tools by hand. The Helix API is the agents' tool layer; the lab automates the evidence assembly, the choice of test, the test, the updated decision and the candidate search, and keeps a record from which every decision can be reconstructed.

This is research and hypothesis generation only. The lab gives no clinical advice, no treatment recommendation and no dosing. Every recorded fact cites a database record, every mechanism hypothesis is labelled an agent-generated hypothesis, and every candidate is labelled a Helix hypothesis.

## Layout

| Path                            | Contents                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/helix_lab/`             | Omnigent agent bundle: supervisor `config.yaml` and `AGENTS.md`, `skills/discovery-loop/SKILL.md`, eight sub-agents under `agents/<role>/`, one file per permitted tool under `tools/python/` |
| `agents/helix_baseline/`        | The control: one generalist agent with every tool, the same model and the same policies                                                                                                       |
| `agents/agents.json`            | Agent specifications and policies as data (served by `GET /api/v1/lab/agents`)                                                                                                                |
| `tools/helix_lab_tools/`        | Function tools: Helix API wrappers, OpenAlex search, the tests, the research record, the budget ledger, the registry of who may call what                                                     |
| `tools/generate_agent_tools.py` | Generates every `config.yaml`, every tool file and `agents.json` from the registry                                                                                                            |
| `policies/helix_lab_policies/`  | Omnigent policies: role boundary, approval gate, claims guard, run budget                                                                                                                     |
| `run_lab.py`                    | Launcher: creates a run, starts Omnigent headlessly, streams the record, finalises `run.json`                                                                                                 |
| `omnigent_driver.py`            | Runs one bundle on a per-run Omnigent server and exports the session transcripts                                                                                                              |
| `verify_policies.py`            | Checks with real Omnigent sessions that denied calls are blocked                                                                                                                              |
| `runs/<run_id>/`                | One directory per run: `run.json`, `record.jsonl`, results, transcripts                                                                                                                       |
| `policy_checks/latest/`         | Output of the last `verify_policies.py` run                                                                                                                                                   |

## Agents

Every agent runs on the `claude-sdk` harness with model `claude-sonnet-5`. An agent has no shell and no file access (`os_env` is not declared). Its capabilities are the tools listed here; the role policy denies everything else.

| Agent                               | Scientific decision it owns                                                                                      | Tools                                                                                                                                                                                                                                                                                                  | Inputs                                                                                                    | Output                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor (principal investigator) | The order of the loop, when a result reopens an earlier choice, when the run is complete                         | `sys_session_send`, `sys_read_inbox`, `read_record`, `get_budget_status`, `record_handoff`, `record_reopening`, `record_final_report`                                                                                                                                                                  | Objective and budget set by the scientist                                                                 | Handoffs, reopening notes, the final cited report                                                                                                                     |
| Literature                          | Which published findings count as evidence about the mechanism, and what the literature leaves unanswered        | `search_literature` (Europe PMC), `get_publication`, `search_openalex`, `read_record`, `record_evidence`, `record_gap`, `record_handoff`                                                                                                                                                               | Subject                                                                                                   | Evidence of class literature with Europe PMC or OpenAlex record IDs; gaps                                                                                             |
| Knowledge graph                     | Which database records enter the evidence graph, how each is classed and linked, whether the graph is consistent | `search_entities`, `get_gene`, `get_protein`, `get_variant`, `list_variants_near`, `get_residue_annotations`, `get_variant_effect_values`, `get_structure_ledger`, `get_interactions`, `get_test_result`, `read_record`, `record_evidence`, `record_gap`, `check_record_consistency`, `record_handoff` | Subject; after a test, the stored result                                                                  | Evidence with database record IDs; gaps; after a test, result evidence linked to the test and the hypotheses                                                          |
| Insight                             | Which competing mechanisms are worth testing, which one the starting evidence favours, what would refute each    | `read_record`, `record_hypothesis`, `record_handoff`                                                                                                                                                                                                                                                   | Evidence and gaps                                                                                         | At least two hypotheses of different mechanism classes, each with supporting evidence IDs, a refutation criterion and a starting rank                                 |
| Experiment planner                  | Which single test runs next within the remaining budget                                                          | `read_record`, `list_available_tests`, `get_budget_status`, `record_test_candidate`, `record_plan`, `record_handoff`                                                                                                                                                                                   | Hypotheses, test catalogue with live availability, budget, earlier results                                | At least two scored test candidates; a plan with the chosen test and a reason for each rejected one                                                                   |
| Safety                              | Whether the plan, the recorded claims and the proposed candidates may proceed, and whether a human must approve  | `read_record`, `review_claims`, `record_safety_review`, `request_approval`, `review_candidates`, `record_candidate_review`, `record_handoff`                                                                                                                                                           | Plan, every recorded statement, the candidate proposal with each direction check                          | A safety review; for a compute job an approval request and the human decision; a candidate review that rejects every candidate whose direction check is not `matches` |
| Experiment runner                   | None about science: it executes exactly the chosen and cleared test                                              | `read_record`, `run_ligand_contact_test`, `run_stability_test`, `run_structural_context_test`, `run_structure_comparison`, `get_job_status`, `get_comparison_result`, `record_result`, `record_handoff`                                                                                                | Plan, safety review, approval                                                                             | `experiment_started` and `experiment_result` with values, controls, sources, a reproducible command and, for jobs, job ID and manifest                                |
| Analysis                            | What the result means for each hypothesis, which is favoured now, what to test next                              | `read_record`, `get_test_result`, `record_interpretation`, `record_decision`, `record_next_experiment`, `record_handoff`                                                                                                                                                                               | Hypotheses, plan, stored result                                                                           | A verdict per hypothesis with stated uncertainty; the updated decision; the next experiment                                                                           |
| Translator                          | Given the favoured mechanism and its direction, what a drug could act on, and whether a molecule already does it | `read_record`, `list_candidate_targets`, `get_candidate_detail`, `get_target_structure`, `record_target_rationale`, `propose_candidates`, `record_candidate`, `record_gap`, `record_handoff`                                                                                                           | The favoured mechanism and direction after the decision; the candidate response of the discovery endpoint | A target rationale; a candidate proposal; one candidate per cleared row with its bridge, direction check, evidence and the label Helix hypothesis                     |

Literature and knowledge graph run in parallel (two `sys_session_send` calls in one supervisor turn). Analysis and the knowledge graph update run in parallel after the test. The translator runs last, and the safety agent runs a second time between its proposal and its candidates.

The table is generated data: `tools/helix_lab_tools/registry.py` is the single source for tool permissions, models and descriptions. Prompts are in `AGENTS.md` next to each `config.yaml`.

## The loop

1. **Evidence.** Literature and knowledge graph record evidence and gaps.
2. **Hypotheses.** Insight records competing hypotheses and ranks them on the starting evidence. Rank 1 is `favoured_before`.
3. **Plan.** The planner records at least two test candidates with expected learning (0 to 1), feasibility (0 to 1) and cost, and one plan.
4. **Safety.** The safety agent reviews the plan and every recorded statement. A test that starts a compute job needs a human decision.
5. **Experiment.** The runner executes the chosen test.
6. **Learn.** Analysis records the interpretation, the decision and the next experiment. The knowledge graph agent records the result as evidence.
7. **Reopen.** When the test did not complete, the hypothesis favoured before the test was weakened or refuted, or the favoured hypothesis changed, the supervisor records a reopening and steps 3 to 6 run once more with the remaining budget.
8. **Candidates.** The translator retrieves what a drug could act on for the favoured mechanism, records a target rationale, and proposes candidates. The safety agent reviews the proposal and rejects every row whose direction check is not `matches`. The translator then records one candidate per cleared row.
9. **Report.** The supervisor records a cited report, with a Candidates heading.

### Candidates and the direction of effect

The candidates step answers the question the decision leaves open: if this mechanism is right, what could a drug aim at, and does a molecule that does it already exist? It calls `GET /api/v1/discovery/candidates`, which returns candidates with a bridge each (`same_target`, `pathway_node`, `interaction_partner`, `structural_analogue`, `mechanism_class`), the molecules ChEMBL records an action for, and the rows its direction filter refused.

The whole step turns on one rule, and the rule is a filter rather than a ranking factor. A disease caused by a protein doing too much needs that activity reduced; a disease caused by it doing too little needs the activity restored. A molecule that reduces activity suits the first and would make the second worse. The lab therefore records:

| Direction check | What the lab does                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `matches`       | Recordable as a candidate once the safety review clears it                                                      |
| `opposes`       | Rejected in the safety review, with the reason the check gives, and kept visible as a `candidate_rejected` note |
| `unknown`       | Rejected the same way: an unestablished direction is not a direction                                            |

Two guarantees are enforced by the tools, not by the prompts:

- **No invented molecule.** `list_candidate_targets` stores the full response under `runs/<run_id>/candidates/lookup-N.json` and returns a `candidate_ref` per row. `record_candidate` takes only that reference and one plain sentence; the target, molecule, bridge, bridge steps, direction check, structure and evidence are attached from the stored response. The agent's own sentence is additionally refused when it names a molecule that no tool returned for that candidate (`claims.unknown_molecule_names`, matched on international-nonproprietary-name suffixes).
- **No candidate before the review.** `record_candidate` is refused until a `candidate_review` note of verdict `cleared` lists the reference, and refused outright for any direction check that is not `matches`. The rejections are written by the review tool from the direction check itself, so they do not depend on the safety agent's judgement of the chemistry.

The claims guard also rejects treatment and dosing wording in a candidate's text: "use X to treat this disease", "would be effective", "25 mg twice a day" and the like are refused at the tool call, and the refusal is recorded.

New record events: `target_rationale` (ID `R`) and `candidate` (ID `C`), plus notes of kind `candidates_proposed`, `candidate_review` and `candidate_rejected`. The candidate tools are in `tools/helix_lab_tools/candidates.py`, the retrieval tools in `tools/helix_lab_tools/discovery.py`.

**The baseline was updated to match.** `agents/helix_baseline/AGENTS.md` now runs the same candidates step with the same tools, reviewing its own proposal, so the measured comparison between the specialist lab and the single generalist agent stays matched. The run budget rose from 160 to 200 tool calls for the extra step, and the candidate tools count as closing tools so the step can finish when the cap is reached.

### Starting evidence and tests

The starting evidence is what a variant page offers: clinical classification, curated annotation, population frequency, pathogenicity and conservation predictors, the list of structures, literature. Structure-based measurements that discriminate between mechanisms are withheld from the starting evidence and exposed as tests, so the planner has something to choose and the result is new information:

| Test kind              | Tool                          | Measures                                                                                                                                                        | Cost                      | Approval  |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------- |
| `ligand_contact`       | `run_ligand_contact_test`     | In every experimental structure that observes the residue and holds a non-solvent ligand: is the residue among the ligand's neighbours (RCSB), at what distance | 0 compute seconds         | no        |
| `stability_effect`     | `run_stability_test`          | FoldX ΔΔG of the substitution on the AlphaFold model (EBI ProtVar), residue pLDDT, the same value for other disease substitutions at the residue                | 0 compute seconds         | no        |
| `structural_context`   | `run_structural_context_test` | Membership of a P2Rank or ProtVar predicted pocket and of a predicted protein interface                                                                         | 0 compute seconds         | no        |
| `structure_comparison` | `run_structure_comparison`    | Helix `variant_comparison` job: reference and variant construct predicted with the same provider, RMSD, site pLDDT, contact changes                             | about 120 compute seconds | **human** |

Each test documents its controls and limitations (`tools/helix_lab_tools/catalogue.py`); they are copied into the result. The planner sees live availability: how many structures qualify, whether a prediction provider answers.

Mechanism classes: `stability_folding`, `ligand_binding`, `catalytic_site`, `protein_interaction`, `nucleic_acid_binding`, `domain_interface`, `other`.

## Policies and approval gates

Four Omnigent policies (`policies/helix_lab_policies/policies.py`) are declared under `guardrails.policies` in every agent's `config.yaml`, each with the role of the agent.

| Policy          | Phase               | Enforces                                                                                                                                                                                                                                                           |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `role_boundary` | tool call           | A tool outside the agent's role is denied. This includes tools Omnigent registers for every agent by default (embedded browser, `sys_add_policy`, scheduled tasks).                                                                                                |
| `approval_gate` | tool call           | A test runs only when it is the chosen test of the latest plan, the safety agent cleared it for that plan and, for a tool that starts a compute job, the record holds an approved `approval_decision` for it. Retrieval-only tests need no approval.               |
| `claims_guard`  | tool call, response | Record tools, `propose_candidates` and replies are refused when they hold clinical, treatment or dosing wording, cite a record ID that does not exist, or state a measured value or database classification without a record ID. A refused reply is not persisted. |
| `run_budget`    | tool call           | Caps the lab tool calls and compute seconds of the whole run. After the cap only the tools that close a run stay available.                                                                                                                                        |

Every denial is written to `policy_log.jsonl` and as a `note` of kind `policy_denial` to the research record.

**Human approval.** The safety agent calls `request_approval`, which writes an `approval_request` and waits. A human answers through `POST /api/v1/lab/runs/{run_id}/approvals/{approval_id}` (the lab page calls it), or the operator passes `--approve` to the launcher for an unattended, documented run. Either way the `approval_decision` is written to the record with who decided. Without a decision before the timeout (15 minutes by default) the request counts as rejected.

Omnigent's own `ASK` verdict needs an attached interactive client to answer it. Lab runs are headless, so the approval state lives in the shared record and the policy returns `DENY` until an approved decision is there. This was the mechanism that worked headlessly on Omnigent 0.16.0.

**The tool boundary, as verified on this machine.**

- `skills: none` in every spec keeps host skills and settings out of the agents.
- The launcher sets `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Without it the `claude-sdk` harness exposed the signed-in account's connectors (mail, calendar, drive) to the agents.
- Omnigent applies a supervisor's policies to its sub-agents' calls too. The supervisor's instances abstain there, and the sub-agent's own instances, which know its role, decide.
- A local tool is granted by file name, so each tool is one file under `tools/python/` that defines the function itself.

`verify_policies.py` runs a probe agent with the runner's tools and policies and asserts nine things, among them: `browser_navigate` is denied for the runner, an unplanned test is denied, `run_structure_comparison` is denied without approval and starts no experiment, the same call is allowed after an approved decision, the third tool call under a budget of two is denied, and a reply with treatment wording is refused. The last run passed 9 of 9 (`policy_checks/latest/report.json`).

## Run it

Requirements: the Helix API on `http://localhost:8000`, and Omnigent 0.16.0 in `lab/.venv` with a Claude login configured for the `claude-sdk` harness.

```bash
python3 -m venv lab/.venv
lab/.venv/bin/pip install omnigent==0.16.0
lab/.venv/bin/pip install -e lab/tools && lab/.venv/bin/pip install --no-deps -e lab/policies
lab/.venv/bin/python lab/tools/generate_agent_tools.py      # after changing the registry or a prompt
```

```bash
# The specialist lab
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His

# Unattended: approve consequential actions in advance, recorded with the operator's name
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --approve

# The control: one generalist agent, same tools, model, policies and budget
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --mode single_agent_baseline --approve

# Options: --objective TEXT  --max-tool-calls N  --max-compute-seconds N  --run-id ID  --api-url URL
```

Through the API (the API spawns the launcher; it never imports Omnigent):

```bash
curl -X POST localhost:8000/api/v1/lab/runs -H 'Content-Type: application/json' \
  -d '{"variant_id": "BTK-p.Arg28His", "mode": "specialist_lab"}'
curl 'localhost:8000/api/v1/lab/runs/<run_id>/events?after=0'
curl -X POST localhost:8000/api/v1/lab/runs/<run_id>/approvals/A1 -H 'Content-Type: application/json' \
  -d '{"decision": "approved", "note": "ok to run"}'
```

| Endpoint                                                 | Returns                                                   |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/lab/agents`                                 | Agent specifications, tool permissions, policies, tests   |
| `GET /api/v1/lab/runs`                                   | Runs, newest first                                        |
| `GET /api/v1/lab/runs/{run_id}`                          | `run.json`, every event, the report                       |
| `GET /api/v1/lab/runs/{run_id}/events?after=<seq>`       | Events after a sequence number, status, pending approvals |
| `POST /api/v1/lab/runs`                                  | Starts a run in the background, returns the `run_id`      |
| `POST /api/v1/lab/runs/{run_id}/approvals/{approval_id}` | Writes the human decision to the record                   |
| `GET /api/v1/lab/benchmark`                              | `lab/experiments/results/latest.json`                     |

Other commands:

```bash
lab/.venv/bin/python lab/verify_policies.py                 # prove the policies block what they must
PYTHONPATH=lab/tools lab/.venv/bin/python -m helix_lab_tools.experiments \
  ligand_contact --accession Q06187 --position 28          # reproduce a test without any agent
```

## Read a run record

`runs/<run_id>/` holds:

| File                               | Contents                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.json`                         | Objective, subject, mode, status, budget, Omnigent version, harness, model of every agent, session ID, hash of the agent specs, measured metrics, outcome |
| `record.jsonl`                     | The shared research record, append-only, one event per line                                                                                               |
| `report.md`                        | The final report; every factual sentence cites record IDs                                                                                                 |
| `results/<test_id>.json`           | Full values of an executed test, its sources, controls, limitations and reproducible command                                                              |
| `candidates/lookup-N.json`         | Every candidate response the run retrieved, with the query that produced it. A candidate can only be recorded from a row listed here                      |
| `sources_seen.jsonl`               | Every database record a tool returned in the run. Evidence can only cite a record listed here                                                             |
| `policy_log.jsonl`                 | Every policy decision on a tool call: policy, agent, tool, verdict, reason                                                                                |
| `budget.json`                      | Tool calls and compute seconds allowed and used, by agent                                                                                                 |
| `transcript.jsonl`, `transcripts/` | Omnigent session transcripts of the supervisor and of every sub-agent session, in the format of `omnigent session export`                                 |
| `prompt.txt`, `final_reply.txt`    | What the supervisor was asked and its last persisted reply                                                                                                |

An event is `{ seq, at, run_id, agent, type, payload, refs, sources }`. IDs: evidence `E`, gap `G`, hypothesis `H`, test candidate `T`, approval `A`, target rationale `R`, candidate `C`.

To reconstruct a run, read `record.jsonl` in order of `seq`:

1. `objective` (agent `human`): what the scientist asked, the subject and the budget.
2. `handoff` from `orchestrator`: what each specialist was asked to do. Two handoffs in a row to `literature` and `knowledge_graph` are the parallel search.
3. `evidence` and `gap`: every item carries `sources: [{database, record_id, url}]`, an evidence class and the source's own strength.
4. `hypothesis`: `mechanism_class`, `supports` (evidence IDs), `would_refute`, `starting_rank`, `label: "agent-generated hypothesis"`.
5. `test_candidate`: `expected_learning` and `feasibility` are numbers from 0 to 1 with `expected_learning_reasoning` and `feasibility_reasoning`; `cost` and `requires_approval` come from the test catalogue, not from the agent.
6. `plan`: `chosen_test_id`, `rationale`, `rejected` (one reason per other candidate), `budget_remaining`, and `scores` with the numbers that were compared.
7. `note` of kind `safety_review`, then `approval_request` and `approval_decision` (with `by`) when the test starts a compute job.
8. `experiment_started` and `experiment_result`: `values` are copied from the stored tool output, not typed by an agent; `reproducible_command`, `controls`, `limitations`, and `job_id` and `manifest_url` for jobs.
9. `interpretation`: one verdict per hypothesis (`supported`, `weakened`, `refuted`, `unchanged`) with the measured value behind it, and `uncertainty`.
10. `decision`: `favoured_before` and `favoured_after` are mechanism classes; `favoured_before_hypothesis` and `favoured_after_hypothesis` are the IDs; `changed`; `why`.
11. `next_experiment`: `description`, `kind` (`computational` or `laboratory`), `why_now`.
12. `note` of kind `reopened_assumption` when the result reopened the earlier choice; a second plan, result and decision follow.
13. `target_rationale`: `direction`, `required_actions`, `rule` and `rule_why` attached from the candidate response, plus the translator's `what_to_act_on` and `why`.
14. `note` of kind `candidates_proposed`, then `candidate_review` with `cleared` and `rejected`, then one `note` of kind `candidate_rejected` per rejected row with its `reason_code` and `reason`.
15. `candidate`: `target`, `molecule`, `bridge` with its `steps` and their records, `direction_check`, `structure`, `caveats`, `evidence`, the agent's `what_would_have_to_be_true`, and `label: "Helix hypothesis"`.
16. `note` of kind `final_report`.

Additions to the shared contract, all optional for a reader: `subject` also carries `position`, `reference_residue`, `alternate_residue` and `protein_change`; `metrics` also carries `tests_executed`, `compute_seconds`, `tool_calls_by_agent`, `policy_denials`, `reopenings`, `candidates`, `candidates_rejected_by_safety`, `ruled_out_by_direction` and `bridge_kinds`; `outcome` also carries the hypothesis IDs, the candidate IDs and their molecule names; `omnigent` also carries `models`, `bundle` and `sub_agent_sessions`.

`metrics.approvals` counts approval decisions, approved or rejected. `metrics.tool_calls` counts calls to lab tools (retrieval, tests, record). Omnigent's orchestration calls (`sys_session_send`, `sys_read_inbox`) are not counted. `metrics.distinct_sources` counts the databases cited by evidence and results.

## Reference run

`runs/reference-BTK-p.Arg28His/` is the reference run on BTK p.Arg28His (UniProt Q06187). The numbers below are read from its `run.json` and `record.jsonl`.

Launched with `lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --approve --run-id reference-BTK-p.Arg28His` on 2026-10-03 by the build agent (the run needed no approval). Omnigent 0.16.0, harness `claude-sdk`, model `claude-sonnet-5` for all eight agents, one supervisor session and 13 sub-agent sessions exported.

| Measured                    | Value                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wall time                   | 297.0 s                                                                                                                                                               |
| Lab tool calls              | 121 (knowledge graph 38, supervisor 18, planner 17, literature 14, analysis 13, safety 8, runner 8, insight 5)                                                        |
| Evidence                    | 23 items and 5 gaps, from 11 databases: AlphaFold DB, AlphaMissense, ClinVar, EBI ProtVar, Ensembl VEP, Europe PMC, PDBe SIFTS, PrankWeb, RCSB PDB, UniProtKB, gnomAD |
| Hypotheses                  | 3                                                                                                                                                                     |
| Tests considered / executed | 4 / 2                                                                                                                                                                 |
| Approvals, policy denials   | 0, 0                                                                                                                                                                  |
| Reopenings                  | 1                                                                                                                                                                     |
| Decision                    | `protein_interaction` before the tests, `ligand_binding` after. Changed.                                                                                              |

What the record shows, in order:

1. **Hypotheses.** H1 `protein_interaction` (rank 1): R28H disrupts the IP6-dependent PH-TH dimer. It ranked first because one retrieved paper reports that mechanism for this exact substitution. H2 `ligand_binding` (rank 2): the substitution weakens the inositol-phosphate pocket, where UniProtKB annotates residue 28 as a binding site. H3 `stability_folding` (rank 3).
2. **Tests considered.** T1 `ligand_contact` (expected learning 0.6, feasibility 0.9, 0 compute seconds), T2 `structural_context` (0.4, 0.9, 0), T3 `stability_effect` (0.3, 0.9, 0), T4 `structure_comparison` (0.15, 0.6, 120 compute seconds, human approval).
3. **Choice.** T1, because it gives the most learning per cost and is the only candidate that can change the order of the top two hypotheses with experimental data. T2 was kept as the follow-up, T3 was rejected because it only tests the third-ranked hypothesis, T4 because it costs 120 compute seconds and an approval for the lowest expected learning.
4. **Result of T1.** Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound experimental structures that observe it. Closest contact 2.58 Å to an inositol-phosphate analogue in PDB 2Z0P; inositol 1,3,4,5-tetrakisphosphate at 2.75 Å in PDB 1BWN. Controls: eight ligands in the same structures never list the residue as a neighbour; the four structures with the residue mutated to cysteine show no ligand contact.
5. **Decision 1.** H2 supported, H1 and H3 unchanged. The favoured hypothesis changed from H1 to H2, with the stated caveat that the test measures proximity of the reference residue, not binding by the variant.
6. **Reopening.** Because the favourite changed and T1 did not test H1, the supervisor reopened H1. The planner chose T2 for the second round, as the only catalogue test that places the residue in a predicted interface or a predicted pocket, and lowered its expected learning to 0.3 in the rationale.
7. **Result of T2.** Residue 28 lies in none of the 13 P2Rank pockets, in one ProtVar predicted pocket, and in no predicted protein-protein interface.
8. **Decision 2.** H1 weakened (a weak negative from a monomer model), H2 weakly supported. `ligand_binding` stays favoured.
9. **Next experiment.** Computational: model R28H on the inositol-phosphate-bound structure 1B55 and compare contacts and binding free energy with the reference residue, and count partner contacts in a PH-TH dimer model. The record states that laboratory binding data for R28H is still missing.

Reproduce the first test without agents: `PYTHONPATH=lab/tools lab/.venv/bin/python -m helix_lab_tools.experiments ligand_contact --accession Q06187 --position 28`.

The reference run's `spec_hash` predates one later edit: the mechanism-class definitions were added to the docstring of `record_hypothesis`.

The reference run predates the candidates step, so its record ends on the decision.

## The candidates run

`runs/candidates-PIK3CD-p.Glu1021Lys/` is the first run of the extended loop, on PIK3CD p.Glu1021Lys (UniProt O00329), launched with `--approve`. 273.8 s, 116 lab tool calls, 23 evidence items from 11 databases, 4 tests considered, 1 executed, `ligand_binding` favoured before and after.

What the candidates step recorded:

1. **Target rationale R1.** The catalogue states the mechanism of this gene's APDS entry as `gain_of_function` with direction `increased_activity`, so the attached rule is `gain_of_function + increased_activity -> reduce the activity` and the required actions are `inhibit`, `antagonise`, `block_upstream`. The translator's own contribution is where to act: the ATP-binding pocket of the catalytic subunit.
2. **Proposal and review.** The translator proposed four rows. The safety agent read `direction_of_the_mechanism` with the records the catalogue states it from, checked each molecule's recorded action, and cleared four with 0 rejected on direction.
3. **Candidates C1 to C4.** Duvelisib (rank 1, from lymphoma), Idelalisib (rank 2, chronic lymphocytic leukemia), Leniolisib (rank 4, inborn error of immunity) and Zandelisib (rank 11, neoplasm of mature B-cells). All `same_target` bridges with direction `matches` and molecule action `INHIBITOR`; three or four bridge steps each, citing UniProtKB O00329 and ChEMBL mechanism, indication and activity records; all pointing at the AlphaFold model `AF-O00329-F1`. Each carries the same stated assumption: it holds only if the variant protein keeps the ATP-binding pocket the molecule would occupy and E1021K acts through increased membrane association.
4. **Gap G6.** The catalogue holds a second PIK3CD entry, for p110-delta deficiency, whose direction disagrees with the one used. The translator recorded the disagreement rather than resolving it.
5. **Two policy denials.** The claims guard refused a handoff that used the phrase "clinical recommendation", and refused a first report draft that stated a predictor's error without citing a record. Both were rewritten and recorded.

The lab reached leniolisib, the molecule studied for this disease, through the general direction rule and the same-target bridge: no rule names it, and the ranking is the endpoint's own.

`runs/candidates-r1-PIK3CD-p.Glu1021Lys/` is the run before it, kept because its outcome is also informative. It ran while the launcher's objective still said "loss of function" for every subject, which contradicted the catalogue's gain-of-function direction for this gene. The safety agent blocked the whole proposal over that conflict and recorded three rejections, so the run ends with 0 candidates and a visible ruled-out list. The objective wording was then made neutral on direction, and `review_candidates` was changed to return the catalogue's direction with the records it is stated from, so a reviewer can check the provenance instead of inferring it.

`runs/approval-gate-demo-BTK-p.Arg28His/` is a third kept run. Its objective, set by the build agent, names the structure prediction as the test.

It was launched without `--approve` and with `--approval-timeout 60`, and no human answered. What its record shows:

1. The planner chose `structure_comparison` because the objective names it, and recorded that its own scores would have chosen `ligand_contact`.
2. The safety agent cleared the plan and recorded approval request A1, stating the compute cost and that the construct sequence would go to an external inference service. `run.json` went to `awaiting_approval`.
3. After 60 seconds the request was recorded as `rejected` by `approval timeout (no human decision)`. No compute job was started.
4. The supervisor sent the rejection back to the planner, which chose `ligand_contact` and wrote that it had not treated the timeout as a grant. Safety cleared the new plan, the runner executed it, and the run finished with `ligand_binding` favoured before and after (310.4 s, 109 tool calls, 22 evidence items from 11 databases).

The approved path is covered by `verify_policies.py` (denied without a decision, allowed after an approved one). During development it was also exercised end to end through the API: a run waited in `awaiting_approval`, `POST .../approvals/A1` wrote the decision, and the comparison job then ran as an Helix job with a manifest. That run is not kept, because its approval was given by the build agent while testing the endpoint.

One more observation from development: when a run was started with `--approve` and an operator name saying that no human had reviewed the request, the safety agent and the supervisor did not treat the decision as human sign-off. They handed the request to `human` and held the runner. `--approve` is for an operator who has actually decided.

## Rigor and limits

- **Citations.** `record_evidence` refuses a source that no tool returned in the run (`sources_seen.jsonl`), and stores the database's own name and URL for it. An agent cannot cite from memory.
- **Candidates.** A candidate is a hypothesis Helix generated about a molecular action, labelled `Helix hypothesis`, never a recommendation. Its target, molecule, bridge steps, direction check and evidence are attached from the stored candidate response, so an agent cannot name a molecule that no tool returned. A candidate whose direction of effect is not `matches` is never ranked; it is rejected with its reason and stays visible in the record. The lab does not check tissue or cell type, does not model the variant protein's own pocket, and says nothing about whether a molecule would work.
- **Results.** Result values are attached from the tool output on disk. The agent writes only the summary sentence.
- **Labels and uncertainty.** Hypotheses are stored with the label `agent-generated hypothesis`. An interpretation is refused without an uncertainty statement. Predictions are recorded with evidence class `computational_prediction`.
- **Controls.** Each test reports its controls with the result: ligands that never contact the residue, the number of residues neighbouring a ligand, structures in which the residue itself is mutated, the same predictor on other substitutions at the residue.
- **What a run does not show.** A contact in a crystal structure with the reference residue is not a measurement of binding by the variant protein. A stability prediction on a predicted model has an error near 1 kcal/mol. Structure predictors are not validated for single substitutions. Laboratory validation is named in every run's `next_experiment` or report and is not performed by the lab.
- **Variation between runs.** Agents are language models. Two runs on the same variant can retrieve different papers, rank hypotheses differently and reach different decisions. The benchmark under `lab/experiments/` measures this across variants and against the single-agent control.
- **The claims guard is a pattern check.** It catches listed clinical and treatment phrasings and uncited sentences that carry a measured value or a database classification. It is not a proof that no unsupported statement exists.
- **Omnigent 0.16.0.** The headless prompt can return while a sub-agent is still running. `omnigent_driver.py` therefore keeps the per-run server alive until the final report is on record. The driver calls functions of `omnigent.chat` that are not a public API and falls back to the `omnigent` CLI when they are missing.
