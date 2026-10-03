# OrphaFold: submission

Hack-Nation x Databricks, Challenge 03 "Agentic Scientific Discovery". Everything below is read from files in this repository. Where something is not done or not measured, this document says so.

## 1. Summary

OrphaFold is an open-source research tool for rare immune diseases (inborn errors of immunity). A user searches a gene, picks a mutation and sees it on the 3D protein, with every value traced to a database record. On top of it sits the Lab: a supervisor and seven specialist agents, orchestrated by Omnigent 0.16.0 (open source, `claude-sdk` harness, model `claude-sonnet-5`), that take one mutation through a recorded loop: question, evidence, hypothesis, experiment, result, updated decision. In the reference run on BTK p.Arg28His the agents recorded 23 cited facts from 11 databases, proposed 3 competing explanations, weighed 4 tests and ran 2. The first test changed the favoured explanation from "the mutation removes a contact with a partner protein" to "the mutation removes a contact with a bound molecule". A benchmark compares the team with one generalist agent that holds the same tools, model, policies and budget. On 26 of 26 planned runs, 13 team and 13 single agent, the team took a median of 198.5 s per mutation against 84.2 s for the single agent, so it was slower by a factor of 2.4. In the 13 variants where both finished, the team recorded a median of 2 times the evidence items and cited 1.43 times the databases. No human was timed, so no speed-up over manual work is claimed. The Lab does research and hypothesis generation only. It gives no clinical advice. Nothing here has been validated in a laboratory.

## 2. The scientific question

From `question` in every `run.json`:

> For a pathogenic missense variant in an immune-deficiency gene, which molecular mechanism best explains the loss of function, and does a targeted computational test change the conclusion that the starting evidence suggested?

The reference case is BTK p.Arg28His (UniProt Q06187). ClinVar classifies it as pathogenic for X-linked agammaglobulinemia (record line 4, ClinVar VCV000011348.55).

Measured outcome of a run: the mechanism class favoured before the test and after it, and whether it changed (`outcome.favoured_before`, `outcome.favoured_after`, `outcome.decision_changed` in `run.json`). The mechanism classes are defined in `lab/tools/orphafold_lab_tools/catalogue.py`: `stability_folding`, `ligand_binding`, `catalytic_site`, `protein_interaction`, `nucleic_acid_binding`, `domain_interface`, `other`.

## 3. The bottleneck

Going from a variant to a cited, ranked mechanism hypothesis that has been tested once normally means visiting many databases and tools by hand (`lab/README.md`, `lab/experiments/protocol.md` section 1). The reference run cites ClinVar, UniProtKB, gnomAD, Ensembl VEP, AlphaMissense, EBI ProtVar, Europe PMC, PDBe SIFTS, RCSB PDB, AlphaFold DB and PrankWeb.

The OrphaFold API is the agents' tool layer. The Lab automates four steps: assembling the evidence, choosing a test, running it and updating the decision. It keeps a record from which every decision can be reconstructed.

What "faster" means here: wall seconds from the launch of a run to a complete cited record. A record is complete when it holds an objective, evidence items that each cite a database record, at least two hypotheses of different mechanism classes, at least two test candidates, a plan, a result with a reproducible command, an interpretation with stated uncertainty, a decision, a next experiment and a final report (`protocol.md` section 4).

What was not measured: no human was timed. This submission makes no claim about a speed-up over manual work.

## 4. How Omnigent orchestrates the Lab

`lab/run_lab.py` creates a run directory and starts the Omnigent bundle `lab/agents/orphafold_lab` headlessly through `lab/omnigent_driver.py`. The supervisor dispatches a specialist with Omnigent's `sys_session_send` and reads the reply with `sys_read_inbox`. Each specialist runs in its own Omnigent sub-agent session. The reference run's `run.json` records Omnigent 0.16.0, harness `claude-sdk`, model `claude-sonnet-5` for all eight agents, one supervisor session and 13 sub-agent sessions. The session transcripts are in `lab/runs/reference-BTK-p.Arg28His/transcript.jsonl` and `transcripts/`.

This is the open-source Omnigent on a local machine. The managed Databricks route was not used.

Agents pass IDs through one shared research record (`record.jsonl`, append-only). The handoff contract says: "A handoff passes IDs, never prose facts" (`lab/agents/orphafold_lab/skills/discovery-loop/SKILL.md`). No agent declares `os_env`, so no agent has a shell or file access.

### Agents

| Agent                               | Decision it owns                                                                                                 | Tools                                                                                                                                                                                                                                                                                                  | Input                                                                      | Output                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor (principal investigator) | The order of the loop, when a result reopens an earlier choice, when the run is complete                         | `sys_session_send`, `sys_read_inbox`, `read_record`, `get_budget_status`, `record_handoff`, `record_reopening`, `record_final_report`                                                                                                                                                                  | Objective and budget set by the scientist                                  | Handoffs, reopening notes, the final cited report                                                                                     |
| Literature                          | Which published findings count as evidence about the mechanism, and what the literature leaves unanswered        | `search_literature` (Europe PMC), `get_publication`, `search_openalex`, `read_record`, `record_evidence`, `record_gap`, `record_handoff`                                                                                                                                                               | Subject                                                                    | Evidence of class literature with Europe PMC or OpenAlex record IDs; gaps                                                             |
| Knowledge graph                     | Which database records enter the evidence graph, how each is classed and linked, whether the graph is consistent | `search_entities`, `get_gene`, `get_protein`, `get_variant`, `list_variants_near`, `get_residue_annotations`, `get_variant_effect_values`, `get_structure_ledger`, `get_interactions`, `get_test_result`, `read_record`, `record_evidence`, `record_gap`, `check_record_consistency`, `record_handoff` | Subject; after a test, the stored result                                   | Evidence with database record IDs; gaps; after a test, result evidence linked to the test and the hypotheses                          |
| Insight                             | Which competing mechanisms are worth testing, which one the starting evidence favours, what would refute each    | `read_record`, `record_hypothesis`, `record_handoff`                                                                                                                                                                                                                                                   | Evidence and gaps                                                          | At least two hypotheses of different mechanism classes, each with supporting evidence IDs, a refutation criterion and a starting rank |
| Experiment planner                  | Which single test runs next within the remaining budget                                                          | `read_record`, `list_available_tests`, `get_budget_status`, `record_test_candidate`, `record_plan`, `record_handoff`                                                                                                                                                                                   | Hypotheses, test catalogue with live availability, budget, earlier results | At least two scored test candidates; a plan with the chosen test and a reason for each rejected one                                   |
| Safety                              | Whether the plan and the recorded claims may proceed, and whether a human must approve                           | `read_record`, `review_claims`, `record_safety_review`, `request_approval`, `record_handoff`                                                                                                                                                                                                           | Plan and every recorded statement                                          | A safety review; for a compute job an approval request and the human decision                                                         |
| Experiment runner                   | None about science: it executes exactly the chosen and cleared test                                              | `read_record`, `run_ligand_contact_test`, `run_stability_test`, `run_structural_context_test`, `run_structure_comparison`, `get_job_status`, `get_comparison_result`, `record_result`, `record_handoff`                                                                                                | Plan, safety review, approval                                              | `experiment_started` and `experiment_result` with values, controls, sources and a reproducible command                                |
| Analysis                            | What the result means for each hypothesis, which is favoured now, what to test next                              | `read_record`, `get_test_result`, `record_interpretation`, `record_decision`, `record_next_experiment`, `record_handoff`                                                                                                                                                                               | Hypotheses, plan, stored result                                            | A verdict per hypothesis with stated uncertainty; the updated decision; the next experiment                                           |

Spec files:

- Supervisor: `lab/agents/orphafold_lab/config.yaml`, prompt `lab/agents/orphafold_lab/AGENTS.md`
- Specialists: `lab/agents/orphafold_lab/agents/<role>/config.yaml` and `AGENTS.md`, for `literature`, `knowledge_graph`, `insight`, `planner`, `safety`, `runner`, `analysis`
- Handoff contract: `lab/agents/orphafold_lab/skills/discovery-loop/SKILL.md`
- Control (one generalist agent with every tool): `lab/agents/orphafold_baseline/config.yaml`
- Tool permissions, the single source the specs are generated from: `lab/tools/orphafold_lab_tools/registry.py`
- The same specifications as data: `lab/agents/agents.json`, served by `GET /api/v1/lab/agents`
- Quoted line by line: `docs/lab/agent-specs.md`

How the workflow uses Omnigent, with the record lines that show it (reference run):

- **Parallel search.** The supervisor hands off to literature and to knowledge graph in the same second (lines 2 and 3, both at 21:30:40Z). Their evidence lines interleave (lines 4 to 26). After the test, analysis and knowledge graph are dispatched together (lines 48 and 49, both at 21:32:50Z).
- **Structured handoffs.** Every `handoff` event carries `refs`, the IDs it passes on. Line 33 (insight to supervisor) passes `H1, H2, H3, E9, E13, E6, E17, E7, G1, G3, G4`.
- **A planner with a budget.** The budget is 160 lab tool calls and 300 compute seconds (line 1). The plan records what remains: "T1 costs nothing, so the 300 compute-second budget (109 tool calls left) is untouched" (line 39).
- **A result reopens an earlier assumption.** Line 58, supervisor, `reopened_assumption` for H1; lines 59 to 75 are the second round.

### Policies

Four Omnigent policies in `lab/policies/orphafold_lab_policies/policies.py` are declared under `guardrails.policies` in every agent's `config.yaml`, each with the role of the agent. Quoted in full in `docs/lab/policies.md`.

| Policy          | Phase            | Enforces                                                                                                                                                                                              |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role_boundary` | tool call        | A tool outside the agent's role is denied, including tools Omnigent registers for every agent by default                                                                                              |
| `approval_gate` | tool call        | A test runs only when it is the chosen test of the latest plan, the safety agent cleared it for that plan and, for a tool that starts a compute job, the record holds an approved `approval_decision` |
| `claims_guard`  | tool call, reply | Record tools and replies are refused when they hold clinical or treatment wording, cite a record ID that does not exist, or state a measured value or database classification without a record ID     |
| `run_budget`    | tool call        | Caps the lab tool calls and compute seconds of the whole run                                                                                                                                          |

Every denial is written to `policy_log.jsonl` and as a `note` of kind `policy_denial` to the research record.

`lab/verify_policies.py` checks the policies with real Omnigent sessions. The last run passed 9 of 9 checks (`lab/policy_checks/latest/report.json`, generated 2026-10-03T21:44:17Z). Among them: `browser_navigate` is denied for the runner, an unplanned test is denied, `run_structure_comparison` is denied without an approved decision and allowed after one, the third tool call under a budget of two is denied, and a reply with treatment wording is refused.

### Human approval gate

One action needs a human: `run_structure_comparison`. It starts a compute job (about 120 compute seconds) and sends the reference and variant sequence of a domain construct to a prediction provider. The safety agent calls `request_approval`, which writes an `approval_request` to the record and waits. A human answers on the run page (Approve or Reject), which calls `POST /api/v1/lab/runs/{run_id}/approvals/{approval_id}`. The `approval_decision` is written to the record with who decided. Without a decision before the timeout the request counts as rejected.

What the kept runs show:

- `lab/runs/reference-BTK-p.Arg28His/` needed no approval. Both tests it ran are retrieval-only (lines 42 and 63: `"requires_approval": false`). 0 approvals, 0 policy denials.
- `lab/runs/approval-gate-demo-BTK-p.Arg28His/` shows the gate holding. Its objective, set by the build agent, names the structure prediction as the test. Line 45: approval request A1, risk "the PH-domain sequence (BTK residues 1-143, UniProt Q06187 variant p.Arg28His) is sent to an external structure-prediction inference service". Line 46: decision `rejected` by "approval timeout (no human decision)". No compute job started. Line 49: the planner chose the contact test and wrote "I have not re-requested approval and I have not treated the timeout as a grant."

Stated plainly: no kept run holds a decision made by a human on the page. The approved path is covered by `verify_policies.py` (denied without a decision, allowed after an approved one). `lab/README.md` reports that an approval through the API was exercised end to end during development and that run was not kept, because the approval was given by the build agent. In the benchmark the one gated action was approved in advance under a written rule (`protocol.md` section 5), and each such decision is recorded with the operator text.

## 5. One complete loop: the reference run, told from its record

Run: `lab/runs/reference-BTK-p.Arg28His/`. Line numbers are `seq` in `record.jsonl`. Started 2026-10-03T21:30:31Z, finished 21:35:28Z, 297.0 s wall time, 121 lab tool calls, 78 record lines.

**Question (line 1, agent `human`).** "Find the molecular mechanism that best explains the loss of function of BTK-p.Arg28His (BTK, UniProt Q06187) and test it with one targeted computational test." Budget: 160 tool calls, 300 compute seconds.

**Evidence (lines 4 to 26).** 18 evidence items and 5 gaps before the first hypothesis. Each evidence line carries `sources` with database, record ID and URL. The items the later decisions lean on:

| Line | ID  | Source                          | What it states                                                                                                                    |
| ---- | --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 4    | E1  | ClinVar VCV000011348.55         | Pathogenic; criteria provided, multiple submitters, no conflicts; 8 submissions                                                   |
| 5    | E2  | UniProtKB VAR_006220            | Natural variant R to H at residue 28, X-linked agammaglobulinemia                                                                 |
| 6    | E3  | gnomAD X-101375202-C-T          | Observed 1 time in 1,097,783 alleles                                                                                              |
| 8    | E5  | UniProtKB Q06187                | Residues 3 to 133 are the PH domain                                                                                               |
| 9    | E6  | UniProtKB Q06187                | Residue 28 is a binding site for 1D-myo-inositol 1,3,4,5-tetrakisphosphate (experimental evidence, PubMed 10196129)               |
| 11   | E8  | AlphaMissense AF-Q06187-F1:R28H | Pathogenicity 0.9978 (computational prediction)                                                                                   |
| 12   | E9  | Europe PMC PMID:38971313        | R28H "impairs BTK activation at the membrane and in the cytosol by preventing PH-TH dimerization"                                 |
| 14   | E11 | Europe PMC PMID:38971313        | The E41K mutation activates BTK by stabilising an IP6-dependent PH-TH dimer                                                       |
| 16   | E13 | Europe PMC PMID:24307874        | Molecular dynamics classed R28C/H as "functional mutations" that alter binding to Ins(1,3,4,5)P4, rather than "folding mutations" |
| 17   | E14 | PDBe SIFTS Q06187               | 39 of 170 experimental structures observe residue 28                                                                              |
| 20   | E17 | RCSB PDB 1B55                   | PH domain in complex with inositol 1,3,4,5-tetrakisphosphate, 2.4 Å                                                               |
| 21   | E18 | AlphaFold DB AF-Q06187-F1       | Full-length model, mean pLDDT 84.44                                                                                               |

The other starting items are E4 (Ensembl VEP), E7 (UniProtKB, beta strand 25 to 32), E10 and E12 (EBI ProtVar: conservation 0.962, popEVE -5.634), E15 (Europe PMC PMID:24307874) and E16 (RCSB PDB 6TT2, the R28C mutant).

Gaps, also recorded: G1 (line 22) "The retrieved literature does not measure how R28H changes binding of PIP3 or inositol phosphates [...] experimentally"; G3 (line 24) no retrieved paper gives the structural basis of R28H; G4 (line 25) the starting evidence holds no ligand-contact or stability measurement for residue 28.

**Hypotheses (lines 30 to 32, agent `insight`).** Each is stored with `"label": "agent-generated hypothesis"` and a refutation criterion.

| Line | ID  | Class                 | Starting rank | Statement (shortened)                                                                                                       | Would be refuted by                                                                                                                                                        |
| ---- | --- | --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30   | H1  | `protein_interaction` | 1             | R28H disrupts the IP6-dependent PH-TH dimer interface                                                                       | A dimer model shows residue 28 with no atom within about 5 Å of the partner protomer, and R28H does not alter the interface contact count                                  |
| 31   | H2  | `ligand_binding`      | 2             | R28 is part of the inositol-phosphate pocket; histidine removes the charge and geometry needed to hold the phosphate groups | In ligand-bound structures residue 28 has no atom within about 4 Å of a ligand phosphate oxygen, and an R28H model shows the same contacts and binding energy as wild type |
| 32   | H3  | `stability_folding`   | 3             | R28H destabilises the PH domain fold                                                                                        | Predicted ΔΔG below about 1 kcal/mol and residue 28 solvent-exposed with no buried partner                                                                                 |

Why H1 ranked first (line 30): "E9 is the only record item that states a mechanism for this exact substitution (R28H impairs PH-TH dimerization), so it carries the most weight."

**Tests weighed (lines 35 to 38, agent `planner`).** Cost and the approval requirement come from the test catalogue, the two scores from the planner.

| Line | ID  | Test                                                                               | Expected learning | Feasibility | Cost                              | Approval |
| ---- | --- | ---------------------------------------------------------------------------------- | ----------------- | ----------- | --------------------------------- | -------- |
| 35   | T1  | `ligand_contact`: is residue 28 next to a bound ligand in experimental structures  | 0.6               | 0.9         | 0 compute seconds, 2 tool calls   | no       |
| 36   | T2  | `structural_context`: is residue 28 in a predicted pocket or a predicted interface | 0.4               | 0.9         | 0 compute seconds, 2 tool calls   | no       |
| 37   | T3  | `stability_effect`: FoldX predicted stability change                               | 0.3               | 0.9         | 0 compute seconds, 2 tool calls   | no       |
| 38   | T4  | `structure_comparison`: predict reference and variant, compare                     | 0.15              | 0.6         | 120 compute seconds, 3 tool calls | human    |

**Choice (line 39, `plan`).** T1. "T1 gives the most learning per unit of cost and is the only candidate that can change the top two ranks (H1 favourite vs H2) with experimental data." Rejected: T2 "Kept as the next test after T1"; T3 "Tests only H3 (rank 3). Its outcome cannot change the H1 vs H2 ranking"; T4 "Needs human approval and 120 compute seconds for low learning (0.15)."

**Safety (line 42).** Verdict `cleared`, 40 statements checked, "It starts no compute job", `"requires_approval": false`.

**Experiment and result (lines 45 and 46, agent `runner`).** Line 45 records the command and the controls before the test runs. Line 46, with 39 RCSB PDB entries as sources: "Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound experimental structures, with the closest contact at 2.58 Å to 4PT in PDB 2Z0P (chain A and C). Negative-control ligands (3IS, 72V, A1JS1, IS7, MG, NYQ, Q1B, ZN) never contacted the residue [...] In the four structures carrying the R28C mutation (6TT2, 6TSE, 1BTK, 6YYF), no ligand instance contacted residue 28." The values are copied from the stored tool output (`results/T1.json`), not typed by the agent. The knowledge graph agent adds the result as evidence E19 to E21 (lines 50 to 52); E20: inositol 1,3,4,5-tetrakisphosphate at 2.75 Å in PDB 1BWN.

**Interpretation (line 54, agent `analysis`).** H1 `unchanged`, H2 `supported`, H3 `unchanged`. Stated uncertainty: "It does not show that R28H changes ligand binding, because it contains no variant-protein measurement. [...] The ligands contacting residue 28 are mostly synthetic benzofuran compounds, and the crystal contacts may be soluble-analogue artefacts. The 4.5 Å threshold is to any ligand atom, not specifically phosphate oxygens."

**Decision before and after (line 55).** `"favoured_before": "protein_interaction", "favoured_after": "ligand_binding", "changed": true`. "H2 now has the stronger direct support, so the favourite changes from H1 to H2. The margin is small. H2's refute criterion is not met, but the R28H-specific binding test is still pending, and H1 is not excluded."

**Reopening (line 58, supervisor).** `reopened_assumption` for H1: "T1 does not directly test H1, so H1 is unchanged but not excluded. Reconsider the test choice so that H1 and H2 are discriminated." 74 tool calls and 300 compute seconds remained.

**Second round (lines 60 to 75).** The planner chose T2 and lowered its own score: "expected learning 0.3 (recorded 0.4, lowered because ProtVar interface state for residue 28 is not_covered, so the H1 arm can't move much)" (line 60). Safety cleared it (line 63). Result (line 67): "Residue 28 [...] lies in none of the 13 P2Rank pockets, but it lies in 1 ProtVar predicted pocket (pocket 8, score 889.4, buriedness 0.8, mean pLDDT of pocket residues 86.3 [...]). Residue 28 is in no ProtVar predicted protein-protein interface." Interpretation (line 74): H1 `weakened`, "a weak negative: the test used the monomer AF-Q06187-F1 model, so it cannot see a PH-TH dimer"; H2 `supported`, "weak and model-dependent". Decision (line 75): `ligand_binding` before and after, `"changed": false`.

**Next experiment (line 76) and report (line 78).** See section 8. The final report cites record IDs after every factual sentence and is stored as `report.md`.

Three things a reader should know about this result:

1. The first test measures where the reference residue (arginine) sits in crystal structures. It does not measure binding by the variant protein. The record says so (line 54).
2. UniProtKB already annotates residue 28 as a binding site for this ligand (E6, line 9). The test confirms a curated annotation with 39 structures. It is not a new finding about BTK.
3. The change of the favoured explanation is not stable across runs. Of the 6 completed team runs on BTK p.Arg28His kept in `lab/runs/`, 1 changed its favoured explanation (`reference-BTK-p.Arg28His`). The other 5 did not (`20261003T220751Z-BTK-p.Arg28His-lab`, `approval-gate-demo-BTK-p.Arg28His`, `bench01-BTK-p.Arg28His-lab`, `bench01-repeat2-BTK-p.Arg28His-lab`, `bench01-repeat3-BTK-p.Arg28His-lab`). Final answers across those runs: `ligand_binding` in 5, `protein_interaction` in 1.

## 6. The measured comparison, as observed

Source: `lab/experiments/results/latest.json`, generated 2026-10-03T22:48:08Z, batch `bench01`, started 2026-10-03T22:07:39Z. Protocol, written before the first run: `lab/experiments/protocol.md`. No number below is typed by hand; this section is rendered from that file.

**Coverage.** The batch is complete: 26 of 26 planned runs succeeded, one of them on its second attempt. Failed attempts: 1 team, 0 single agent. The batch's own write-up is `lab/experiments/RESULTS.md`.

**What is compared.** For the same variant: a supervised team of seven specialist agents (`lab/agents/orphafold_lab`) against one generalist agent holding every lab tool (`lab/agents/orphafold_baseline`). One run per variant and arm. Variants: the first-listed flagship variant of each of the 13 genes in `data/seed/catalog.json`.

**Conditions.** Budget 160 lab tool calls and 300 compute seconds per run. 3 runs in parallel in one worker pool. Model: claude-sonnet-5. Run timeout 1500 s. Approvals: Pre-approved with --approve under protocol.md section 5; every decision is written to the record with the operator below. Operator text written to each record: "benchmark pre-approval rule (lab/experiments/protocol.md section 5), batch started by an automated build agent in dheeraj's session".

**Primary metric.** Median wall seconds from launch to a complete cited record (launcher clock). Team 198.5 s, single agent 84.2 s. Ratio single agent ÷ team = 0.42 (above 1 the team is faster, below 1 slower). The team was slower by a factor of 2.36.

| Measured | Team of agents | Single agent |
| --- | --- | --- |
| Succeeded runs | 13 | 13 |
| Complete records | 13 | 13 |
| Median wall seconds | 198.5 | 84.2 |
| Fastest run, seconds | 172.9 | 75.2 |
| Slowest run, seconds | 285.8 | 102.3 |
| Median seconds to first hypothesis | 68 | 35 |
| Median seconds to first decision | 158 | 65 |
| Median lab tool calls | 93 | 40 |
| Median databases cited | 11 | 7 |
| Median evidence items | 22 | 11 |
| Mean evidence items before the first hypothesis | 19.31 | 11.08 |
| Mean databases cited before the first hypothesis | 10.38 | 7.23 |
| Mean hypotheses | 2.69 | 2.69 |
| Mean tests considered | 3.77 | 3.31 |
| Mean tests executed | 1.23 | 1 |
| Runs with a reopening | 4 | 0 |
| Runs where the test changed the favoured hypothesis | 4 | 5 |
| Policy denials, all runs | 12 | 7 |
| Approvals approved / rejected | 1 / 0 | 0 / 0 |
| Final answer equals the reference label | 5 of 6 | 4 of 6 |
| Starting answer equals the reference label | 5 of 6 | 4 of 6 |
| Final answer equals a residue-specific reference label | 3 of 3 | 3 of 3 |
| First test chosen | ligand_contact 2, stability_effect 10, structural_context 1 | stability_effect 8, ligand_contact 3, structural_context 2 |

**Paired comparison.** Variants where both arms succeeded (13 pairs). Difference and ratio are team minus single agent and team over single agent. The p value is an exact two-sided sign test.

| Metric | Pairs | Team higher | Single agent higher | Ties | Median difference | Median ratio | Sign test p |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `wall_seconds` | 13 | 13 | 0 | 0 | 117.3 | 2.5 | 0.0002 |
| `tool_calls` | 13 | 13 | 0 | 0 | 53 | 2.33 | 0.0002 |
| `distinct_sources` | 13 | 12 | 0 | 1 | 3 | 1.43 | 0.0005 |
| `evidence_items` | 13 | 13 | 0 | 0 | 11 | 2 | 0.0002 |
| `starting_evidence_items` | 13 | 13 | 0 | 0 | 9 | 1.8 | 0.0002 |
| `starting_distinct_sources` | 13 | 13 | 0 | 0 | 3 | 1.38 | 0.0002 |
| `hypotheses` | 13 | 1 | 1 | 11 | 0 | 1 | 1 |
| `tests_considered` | 13 | 6 | 0 | 7 | 0 | 1 | 0.0312 |
| `output_tokens` | 13 | 13 | 0 | 0 | 23944 | 2.85 | 0.0002 |

**Failed attempts** (kept in `lab/runs/`, retried once under a run ID ending in `-r2`, not counted in the medians):

- STAT3-p.Arg382Trp, team: `bench01-STAT3-p.Arg382Trp-lab` failed after 482.9 s. Error: "The run ended without a recorded decision. See omnigent.log and final_reply.txt."

**Per variant.** Reference is the label derived from UniProtKB before the batch; a dash means no label or no run yet.

| Variant | Arm | Status | Wall s | Tool calls | Databases | Evidence | Favoured before | Favoured after | Changed | Reference | Agrees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADA-p.Arg211His | team | succeeded | 246.6 | 104 | 11 | 20 | `ligand_binding` | `stability_folding` | yes | – | – |
| ADA-p.Arg211His | single agent | succeeded | 93.2 | 42 | 7 | 13 | `stability_folding` | `stability_folding` | no | – | – |
| IL2RG-p.Arg226Cys | team | succeeded | 272.2 | 122 | 13 | 25 | `stability_folding` | `protein_interaction` | yes | – | – |
| IL2RG-p.Arg226Cys | single agent | succeeded | 75.2 | 36 | 7 | 10 | `stability_folding` | `protein_interaction` | yes | – | – |
| BTK-p.Arg28His | team | succeeded | 179 | 87 | 10 | 21 | `ligand_binding` | `ligand_binding` | no | `ligand_binding` | yes |
| BTK-p.Arg28His | single agent | succeeded | 84.2 | 39 | 8 | 13 | `ligand_binding` | `ligand_binding` | no | `ligand_binding` | yes |
| WAS-p.Thr45Met | team | succeeded | 248.2 | 118 | 13 | 22 | `protein_interaction` | `stability_folding` | yes | – | – |
| WAS-p.Thr45Met | single agent | succeeded | 88.7 | 41 | 7 | 11 | `stability_folding` | `stability_folding` | no | – | – |
| RAG1-p.Arg404Gln | team | succeeded | 252.7 | 105 | 11 | 22 | `nucleic_acid_binding` | `nucleic_acid_binding` | no | `nucleic_acid_binding` | yes |
| RAG1-p.Arg404Gln | single agent | succeeded | 93.3 | 36 | 6 | 10 | `nucleic_acid_binding` | `nucleic_acid_binding` | no | `nucleic_acid_binding` | yes |
| JAK3-p.Arg103His | team | succeeded | 172.9 | 87 | 10 | 22 | `stability_folding` | `stability_folding` | no | `protein_interaction` | no |
| JAK3-p.Arg103His | single agent | succeeded | 81.2 | 41 | 8 | 12 | `stability_folding` | `stability_folding` | no | `protein_interaction` | no |
| CYBB-p.His101Arg | team | succeeded | 189.5 | 91 | 7 | 22 | `ligand_binding` | `ligand_binding` | no | `ligand_binding` | yes |
| CYBB-p.His101Arg | single agent | succeeded | 82.7 | 39 | 5 | 10 | `ligand_binding` | `ligand_binding` | no | `ligand_binding` | yes |
| STAT3-p.Arg382Trp | team | succeeded | 212.1 | 92 | 11 | 23 | `nucleic_acid_binding` | `nucleic_acid_binding` | no | `nucleic_acid_binding` | yes |
| STAT3-p.Arg382Trp | single agent | succeeded | 82.7 | 40 | 8 | 12 | `nucleic_acid_binding` | `nucleic_acid_binding` | no | `nucleic_acid_binding` | yes |
| STAT1-p.Arg274Trp | team | succeeded | 198.5 | 94 | 9 | 23 | `protein_interaction` | `protein_interaction` | no | – | – |
| STAT1-p.Arg274Trp | single agent | succeeded | 102.3 | 45 | 9 | 12 | `protein_interaction` | `domain_interface` | yes | – | – |
| FOXP3-p.Ala384Thr | team | succeeded | 183.5 | 88 | 10 | 22 | `nucleic_acid_binding` | `nucleic_acid_binding` | no | `nucleic_acid_binding` | yes |
| FOXP3-p.Ala384Thr | single agent | succeeded | 91.7 | 40 | 9 | 13 | `protein_interaction` | `stability_folding` | yes | `nucleic_acid_binding` | no |
| CD40LG-p.Thr254Met | team | succeeded | 285.8 | 123 | 10 | 22 | `protein_interaction` | `stability_folding` | yes | – | – |
| CD40LG-p.Thr254Met | single agent | succeeded | 82.7 | 39 | 7 | 10 | `stability_folding` | `stability_folding` | no | – | – |
| PIK3CD-p.Glu1021Lys | team | succeeded | 186.6 | 93 | 13 | 23 | `ligand_binding` | `ligand_binding` | no | – | – |
| PIK3CD-p.Glu1021Lys | single agent | succeeded | 97.8 | 40 | 9 | 11 | `ligand_binding` | `protein_interaction` | yes | – | – |
| CTLA4-p.Arg75Trp | team | succeeded | 195.6 | 91 | 11 | 21 | `protein_interaction` | `protein_interaction` | no | – | – |
| CTLA4-p.Arg75Trp | single agent | succeeded | 78.3 | 37 | 7 | 10 | `stability_folding` | `protein_interaction` | yes | – | – |

**Repeat study** (`protocol.md` section 10, added while the batch was running): BTK p.Arg28His run two more times in each arm under the same conditions, reported apart from the 13-variant comparison and not pooled into it. When this was written 4 of 4 repeat runs had finished. `latest.json` holds a `repeat_study` block. The rows below are read from each run's `run.json`.

| Run | Arm | Status | Wall s | Tool calls | Databases | Evidence | Favoured before | Favoured after | Changed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bench01-BTK-p.Arg28His-baseline` | single agent | succeeded | 84.2 | 39 | 8 | 13 | `ligand_binding` | `ligand_binding` | no |
| `bench01-BTK-p.Arg28His-lab` | team | succeeded | 179 | 87 | 10 | 21 | `ligand_binding` | `ligand_binding` | no |
| `bench01-repeat2-BTK-p.Arg28His-baseline` | single agent | succeeded | 85.7 | 41 | 8 | 14 | `ligand_binding` | `ligand_binding` | no |
| `bench01-repeat2-BTK-p.Arg28His-lab` | team | succeeded | 192.5 | 89 | 10 | 21 | `protein_interaction` | `protein_interaction` | no |
| `bench01-repeat3-BTK-p.Arg28His-baseline` | single agent | succeeded | 78.2 | 36 | 7 | 12 | `ligand_binding` | `ligand_binding` | no |
| `bench01-repeat3-BTK-p.Arg28His-lab` | team | succeeded | 206.1 | 88 | 9 | 23 | `ligand_binding` | `ligand_binding` | no |

- Team (`repeat_study` in `latest.json`): 3 of 3 runs succeeded, wall 179 to 206.1 s, final answers `ligand_binding`, `protein_interaction`, `ligand_binding`, decision changed in 0 runs.
- Single agent (`repeat_study` in `latest.json`): 3 of 3 runs succeeded, wall 78.2 to 85.7 s, final answers `ligand_binding`, `ligand_binding`, `ligand_binding`, decision changed in 0 runs.

With three runs per arm this shows a range, not a variance estimate (`protocol.md` section 10).

**Controls** (copied from `latest.json`):

- Same tools: the control agent holds every tool of the lab, generated from the same registry.
- Same model in every agent of both arms; the model names are read from each run.json.
- Same policies in both arms: role boundary, approval gate, claims guard, run budget.
- Same budget per run: tool calls and compute seconds, enforced by policy.
- Same objective text and subject line for a variant in both arms, built by lab/run_lab.py.
- Same approval rule in both arms: pre-approved by the documented rule of protocol.md section 5.
- Variant set fixed before any run: the first-listed flagship variant of every gene in data/seed/catalog.json.
- Reference labels derived from UniProtKB by a fixed script before any benchmark run, never shown to an agent.
- API caches filled for every variant by a scripted preflight before the first run, so neither arm pays for a cold upstream database.
- Arms interleaved in one worker pool with the starting arm alternating by variant, so both arms see the same concurrency.
- Citations can only name a database record a tool returned in that run (source ledger), in both arms.
- spec_hash of the agent bundle, policies and tool package recorded per run; a change during the batch is reported.
- Failed attempts are kept in lab/runs/ and counted; a failed run is retried at most once.

**Caveats** (copied from `latest.json`):

- Small sample: 13 variants, one run per variant and arm in the main comparison; run-to-run variation of a language-model agent is not estimated beyond the repeat study on one variant.
- Both arms use the same model, so the comparison says nothing about a different model in either role.
- The reference covers 6 of 13 variants (3 from a residue-specific UniProtKB annotation, 3 only from membership of an annotated region). The label is never shown to an agent, but the UniProtKB annotation behind it is returned by tools both arms hold, so agreement is consistency with curated annotation, not blind rediscovery.
- Pathogenicity predictors in the starting evidence (AlphaMissense, EVE, popEVE) share training signal with clinical labels; they say a variant is damaging, not by which mechanism.
- Wall time includes the start of a per-run Omnigent server and the export of session transcripts, in both arms.
- No human was timed. The benchmark does not measure a speed-up over manual work.
- The lab can run a second test after a reopening; the control prompt has no reopening step. Counts of decisions that changed are therefore not like for like.
- One of 27 attempts in the main batch failed (specialist lab, STAT3 p.Arg382Trp, 482.9 s) and was retried once; the medians use the retry. Cause: the claims guard matched the word "dosage", its refusal notes quote the matched word, and the safety agent then blocked the plan twice because of those notes.
- No approved compute job ran. The only approval request of the batch (specialist lab, ADA p.Arg211His, for a test that needs no approval) was answered by the pre-approval rule, and the safety agent did not accept an approval granted by an automated agent as a human decision. Compute seconds were 0 in all 26 runs, so the structure-comparison test is not covered by this benchmark.
- Repeats on BTK p.Arg28His (three runs per arm): the lab favoured ligand_binding in 2 runs and protein_interaction in 1; the single agent favoured ligand_binding in 3. A difference of one variant in agreement between the arms is the size of the variation seen between repeats of one cell.
- In the lab arm the test did not change the favoured class for any of the 6 variants with a reference; all 4 lab runs where it changed are variants without a reference, so whether those changes are improvements is not known.
- The lab's supervisor may run a second test after a reopening and its knowledge graph agent records each result as evidence. Evidence counts and changed decisions are therefore not like for like; the counts taken before the first hypothesis are (`protocol.md` section 2).
- Other builds used the same API server and the same model account during the batch, so wall times include that load (`protocol.md` section 8).
- The objective says "loss of function" for every variant. UniProtKB describes STAT1 p.Arg274Trp and PIK3CD p.Glu1021Lys as gain of function (`protocol.md` section 3).
- Whether a run's report mentions gain of function (`mentions_gain_of_function`): STAT1-p.Arg274Trp: team yes, single agent yes; PIK3CD-p.Glu1021Lys: team yes, single agent yes.

**Not measured.** The time a person needs for the same task. The correctness of individual evidence statements. The quality of the reports. Any outcome in a laboratory.

## 7. What the Lab learned

About BTK p.Arg28His (reference run):

- The starting evidence can favour a mechanism because one paper names it for the exact substitution (E9), while curated annotation and structures point to another (E6, E17). A test that costs no compute seconds separated the two enough to change the ranking (line 55).
- The second test could only weaken H1 slightly, because no test in the catalogue sees a protein dimer (line 74). The record keeps H1 as "weakened but not refuted" (line 75).
- What is still missing is a measurement on the variant itself. The record names it as a gap (G1, line 22) and as the next experiment (line 76).

About the workflow (benchmark and kept runs):

- The team is slower than one agent. Median 198.5 s against 84.2 s; the team took longer in 13 of 13 paired variants and used a median of 2.33 times the tool calls (26 of 26 planned runs, 13 team and 13 single agent).
- The team gathers more. In 13 of 13 pairs it recorded more evidence items (median ratio 2) and in 12 of 13 it cited more databases (median ratio 1.43). This also holds for the evidence gathered before the first hypothesis (median ratio 1.8).
- The final answer equals the reference label in 5 of 6 labelled variants for the team and 4 of 6 for the single agent (the arms differ on FOXP3-p.Ala384Thr). Six labelled variants cannot separate the arms, and the annotation behind each label is visible through the tools.
- A test changed the favoured hypothesis in 4 of 13 team runs and 5 of 13 single-agent runs. Only the team can reopen a choice and run a second test (4 team runs did).
- Repeating one variant shows that the team's conclusion varies between runs. In 3 team runs on BTK p.Arg28His under the same conditions the final answers were `ligand_binding`, `protein_interaction`, `ligand_binding`; in 3 single-agent runs they were `ligand_binding`, `ligand_binding`, `ligand_binding`. No run in the repeat study changed its answer after the test, unlike the reference run.
- The test catalogue has no test that measures contact with DNA or with a partner protein in experimental structures. Hypotheses of class `nucleic_acid_binding` and `protein_interaction` can only be tested indirectly (`protocol.md` section 8).
- On Omnigent 0.16.0, three things had to be handled for a headless lab (`lab/README.md`): a supervisor's policies are also applied to its sub-agents' calls; the `ASK` verdict needs an attached interactive client, so approvals live in the shared record; and the `claude-sdk` harness exposed the signed-in account's connectors until the launcher set `ENABLE_CLAUDEAI_MCP_SERVERS=false`.

## 8. The next experiment

For BTK p.Arg28His, from the record (line 76, `kind: computational`): "R28H-specific ligand-binding check on the 1B55 PH domain with IP4 bound: model the R28H substitution in the IP4-bound structure, then compare the contacts and MM/PBSA binding free energy against the wild-type. Also count partner-protomer contacts in a PH-TH dimer model built from 1B55 and the E41K dimer to test H1. H2 is refuted if residue 28 has no phosphate-oxygen contact within 4 Å and R28H binding energy matches wild-type within MM/PBSA error. H1 is refuted if no atom of residue 28 lies within 5 Å of the partner protomer and the interface contacts are unchanged by R28H."

Why this one (line 76, `why_now`): "H2 is favoured by a small margin, and its key claim (R28H reduces IP4 binding) has not been measured for this substitution."

It has not been run. The Lab has no tool for it yet: it needs a structure-editing and binding-energy step, and a dimer model.

The laboratory step after that is named in the approval demo run (line 65 of its record, `kind: laboratory`): express the BTK PH domain (residues 1 to 143) as wild type and R28H, and measure binding to Ins(1,3,4,5)P4 by isothermal titration calorimetry or SPR, with R28C and a non-binding mutant as controls.

For the workflow:

- Repeat more cells than one. The repeat study covers BTK p.Arg28His only.
- Time a person on the same task for a subset of the variants, so that a multiplier over manual work can be stated or dropped.
- Add a test that measures contact with DNA or a partner protein in experimental structures, then rerun the variants whose reference label is `nucleic_acid_binding` or `protein_interaction`.

What would have to happen to approach 10x at scale. None of this is measured:

- Time a person doing the same task by hand on the same variants. Without that there is no baseline for any multiplier.
- Cut the time the team spends between agents. Scripted retrieval of the same data without any agent takes a median of 0.56 s per variant with warm caches (`lab/experiments/results/preflight.json`), so nearly all of a run's wall time is model turns.
- Run many variants at once. The benchmark ran 3 runs in parallel on one machine.
- Add tests that can separate the mechanisms the catalogue cannot test directly today.

## 9. What must be validated before any real-world use

- **Nothing has been validated in a laboratory.** Every hypothesis in every record is labelled agent-generated. The favoured explanation for BTK p.Arg28His needs a binding measurement on the variant protein (section 8).
- **A contact in a crystal structure is not a binding measurement.** The contact test looks at the reference residue in deposited structures.
- **Predictions are predictions.** AlphaMissense, popEVE, FoldX, P2Rank and ProtVar pocket and interface outputs are computational. FoldX on a predicted model has an error near 1 kcal/mol. Structure predictors are not validated for single-residue substitutions (`docs/scientific-limitations.md`).
- **Runs vary.** The agents are language models. Two runs on the same variant can retrieve different papers, rank hypotheses differently and reach different decisions (section 5, point 3).
- **The claims guard is a pattern check.** It catches listed clinical and treatment phrasings and uncited sentences with a measured value. It does not prove that no unsupported statement exists. The correctness of individual evidence statements was not checked by a person.
- **No clinical use.** The Lab gives no clinical advice and no treatment recommendation. It is not clinical decision software.

Known limits of the platform today:

- **Live structure predictions currently fail.** The public ESMFold server (ESM Atlas) returns errors. Three earlier real runs are stored with their manifests in `data/examples/` (BTK p.Arg28His, BTK p.Arg525Gln, WAS p.Thr45Met) and are shown, labelled as cached output. The approval demo run recorded the outage: "Real inference is unavailable (ESM Atlas did not answer)" (line 41 of its record).
- **Boltz-2 is not attached.** It needs a GPU backend. No Boltz-2 prediction has been made through OrphaFold (`README.md`, "Model providers").
- **The in-app chat assistant needs an API key.** Without `ANTHROPIC_API_KEY` it reports that it is not configured (`.env.example`).
- **Licence of the catalog.** The IUIS 2024 classification the catalog is derived from is published under CC BY-ND 4.0. OrphaFold stores only identifiers, codes and short labels from it. Whether CC BY-ND permits publishing this derived index still needs confirmation with the IUIS committee or the publisher (`ATTRIBUTION.md`, "IUIS classification: what is and is not stored").
- **Approvals.** No kept run holds an approval decided by a human on the page (section 4).

## 10. How to reproduce

The platform (commands from the `Makefile`). Needs Python 3.14, Node.js 20.9 or later and pnpm:

```bash
make setup    # creates api/.venv, installs the API and the web dependencies
make dev      # API on http://localhost:8000, web on http://localhost:3000
make check    # strict API import, generated types are current, tsc, eslint
```

The Lab (commands from `lab/README.md`). Needs the API on `http://localhost:8000` and a Claude login configured for the `claude-sdk` harness:

```bash
python3 -m venv lab/.venv
lab/.venv/bin/pip install omnigent==0.16.0
lab/.venv/bin/pip install -e lab/tools && lab/.venv/bin/pip install --no-deps -e lab/policies
lab/.venv/bin/python lab/tools/generate_agent_tools.py      # regenerates every config.yaml, tool file and agents.json

# The specialist lab
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His

# How the reference run was launched
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --approve --run-id reference-BTK-p.Arg28His

# The control: one generalist agent, same tools, model, policies and budget
lab/.venv/bin/python lab/run_lab.py --variant BTK-p.Arg28His --mode single_agent_baseline --approve

# Prove the policies block what they must
lab/.venv/bin/python lab/verify_policies.py

# Reproduce the first test of the reference run without any agent
PYTHONPATH=lab/tools lab/.venv/bin/python -m orphafold_lab_tools.experiments \
  ligand_contact --accession Q06187 --position 28
```

A new run will not repeat the reference run line for line. The agents are language models and the upstream databases change.

The benchmark (commands from `lab/experiments/protocol.md` section 9):

```bash
lab/.venv/bin/python lab/experiments/reference_labels.py      # labels from the stored UniProtKB snapshots
lab/.venv/bin/python lab/experiments/preflight.py             # scripted retrieval, warms the caches
lab/.venv/bin/python lab/experiments/run_benchmark.py         # runs what is missing, 3 in parallel, then aggregates
lab/.venv/bin/python lab/experiments/run_benchmark.py --aggregate-only
```

Read a run in the browser: `http://localhost:3000/lab` lists the runs; `http://localhost:3000/lab/reference-BTK-p.Arg28His` shows the reference run, with a Replay button and a Record view. Through the API: `GET /api/v1/lab/runs/reference-BTK-p.Arg28His`, `GET /api/v1/lab/agents`, `GET /api/v1/lab/benchmark`.

## 11. Rubric and required items

Status is one of: met, partly met, not met.

### Evaluation criteria

| Criterion (weight)                                                                       | What the brief asks                                                                                                                                            | Where it is satisfied                                                                                                                                                                                                                                                                                                                                                             | Status and reason                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omnigent orchestration (30%, mandatory)                                                  | Omnigent orchestrates the live workflow; several specialist agents exchange outputs, use tools and adapt the plan after a result                               | `lab/agents/orphafold_lab/` (supervisor and seven sub-agents); `run.json` of the reference run (`omnigent.version` 0.16.0, 13 sub-agent sessions); `transcript.jsonl` and `transcripts/`; record lines 2 to 3 and 48 to 49 (parallel dispatch), 58 to 60 (plan changed after the result)                                                                                          | **Met.** Open-source Omnigent on a local machine, run headlessly. The managed Databricks route was not used                                                                                                                                                                                                                                                       |
| Omnigent orchestration: handoff design                                                   | For each agent the decision, tools, inputs and output; structured evidence, IDs, specifications and results passed between agents; a shared record             | Section 4; `docs/lab/agent-specs.md`; `lab/agents/orphafold_lab/skills/discovery-loop/SKILL.md`; `record.jsonl`                                                                                                                                                                                                                                                                   | **Met**                                                                                                                                                                                                                                                                                                                                                           |
| Omnigent orchestration: budget and competing tests                                       | The planner has a budget and chooses between at least two tests using expected learning, feasibility and cost                                                  | Record lines 35 to 39 and 60; `run_budget` policy; `budget.json`                                                                                                                                                                                                                                                                                                                  | **Met**                                                                                                                                                                                                                                                                                                                                                           |
| Omnigent orchestration: human approval                                                   | Scientists approve consequential actions; a safety agent flags risks and requests approval; the boundary is enforced by tool permissions and Omnigent policies | `lab/policies/orphafold_lab_policies/policies.py`; `docs/lab/policies.md`; `lab/policy_checks/latest/report.json` (9 of 9); `lab/runs/approval-gate-demo-BTK-p.Arg28His/record.jsonl` lines 44 to 49                                                                                                                                                                              | **Partly met.** The gate is enforced and verified. The kept runs show a request that timed out and was rejected. No kept run holds a decision made by a human on the page. Benchmark approvals were given in advance under a written rule (`protocol.md` section 5); the batch was started by an automated build agent and no human reviewed individual requests                                                                                      |
| Breakthrough potential (25%)                                                             | An ambitious question and a meaningful, reproducible result                                                                                                    | Section 2; section 5; `lab/runs/reference-BTK-p.Arg28His/results/T1.json` with its `reproducible_command`                                                                                                                                                                                                                                                                         | **Partly met.** The launcher accepts any single amino-acid substitution the OrphaFold API knows (`resolve_subject` in `lab/run_lab.py`). The reference result is reproducible as a test (39 structures, a command that runs without agents). It confirms an existing UniProtKB annotation and is not a new finding. The change of decision was seen in 1 of 6 completed team runs on this variant. No laboratory validation |
| Discovery acceleration and learning (20%): bottleneck                                    | Identify a meaningful bottleneck                                                                                                                               | Section 3; `lab/experiments/protocol.md` section 1                                                                                                                                                                                                                                                                                                                                | **Met**                                                                                                                                                                                                                                                                                                                                                           |
| Discovery acceleration and learning (20%): measurable progress                           | Report the improvement actually observed                                                                                                                       | Section 6; `lab/experiments/results/latest.json`; `GET /api/v1/lab/benchmark`; the "Team of agents vs one agent" block on `/lab`                                                                                                                                                                                                                                                  | **Partly met.** A comparison was measured and is reported as observed (26 of 26 planned runs, 13 team and 13 single agent). It shows no speed-up: the team's median wall time is 198.5 s against 84.2 s for one agent (ratio single agent ÷ team 0.42). The measured gain is breadth: 2 times the evidence items and 1.43 times the cited databases in 13 paired variants. No human baseline was timed, so the improvement over manual work is not measured                                                                                                                                                                                                                                                                                                                                  |
| Discovery acceleration and learning (20%): next experiment justified by what was learned | Justify the next experiment from what the lab learned                                                                                                          | Record line 76 (`why_now`); section 8                                                                                                                                                                                                                                                                                                                                             | **Met.** The next experiment has not been run                                                                                                                                                                                                                                                                                                                     |
| Discovery acceleration and learning (20%): path to 10x                                   | What would need to happen to approach 10x at scale                                                                                                             | Section 8, last list                                                                                                                                                                                                                                                                                                                                                              | **Partly met.** Stated as a plan. Nothing in it is measured                                                                                                                                                                                                                                                                                                       |
| Scientific rigor (15%): citations for factual claims                                     | Require citations                                                                                                                                              | `sources` on every evidence line; `sources_seen.jsonl` (a citation must name a record a tool returned in the run); `report.md` cites record IDs; `claims_guard`                                                                                                                                                                                                                   | **Met.** The guard is a pattern check, and the correctness of each statement was not reviewed by a person                                                                                                                                                                                                                                                         |
| Scientific rigor (15%): run records, labels, uncertainty                                 | Attach run records; label agent-generated hypotheses; preserve uncertainty                                                                                     | `lab/runs/*/record.jsonl`; `"label": "agent-generated hypothesis"` (lines 30 to 32); `uncertainty` in lines 54 and 74                                                                                                                                                                                                                                                             | **Met**                                                                                                                                                                                                                                                                                                                                                           |
| Scientific rigor (15%): controls                                                         | Document controls                                                                                                                                              | `controls` in lines 45, 46, 66, 67 and in `catalogue.py`; benchmark controls in `protocol.md` section 7 and in `latest.json`                                                                                                                                                                                                                                                      | **Partly met.** Controls are documented and reported. The benchmark has one run per variant and arm. The only repeats are 4 extra runs on one variant, so run-to-run variation is not estimated. The reference labels are not blind (`protocol.md` section 6)                                                                                                                                                                                                                                                                                             |
| Scientific rigor (15%): validation still needed                                          | State the validation needed before real-world use                                                                                                              | Section 9; `uncertainty` and `next_experiment` in each record; `docs/scientific-limitations.md`                                                                                                                                                                                                                                                                                   | **Met**                                                                                                                                                                                                                                                                                                                                                           |
| Creativity and responsibility (10%)                                                      | A responsible, original design                                                                                                                                 | Structure-based measurements are withheld from the starting evidence and offered as tests, so the planner has a real choice (`lab/README.md`, "Starting evidence and tests"); research-only scope enforced by `claims_guard`; no shell, file access or account connectors for agents; plain-language screens (`docs/DESIGN_SYSTEM.md` section 0, `web/src/lib/plain-language.ts`) | **Partly met.** Open points: the CC BY-ND question on the IUIS-derived index is unconfirmed (`ATTRIBUTION.md`); no human-made approval is on record                                                                                                                                                                                                               |

### Required submission items

| Item                              | Where                                                                                                                                                                        | Status and reason                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The repository                    | This repository: `api/`, `web/`, `lab/`, `data/`, `docs/`; Apache-2.0 (`LICENSE`)                                                                                            | **Partly met.** The code and the run records are in the working tree. No git remote is configured, so the repository is not published yet. 124 paths in the working tree are not committed, among them this document and `docs/lab/`                |
| Agent specifications and policies | `lab/agents/`, `lab/policies/`, `docs/lab/agent-specs.md`, `docs/lab/policies.md`                                                                                            | **Met**                                                                                              |
| A two minute demo                 | `docs/lab/demo-script.md` (shot by shot)                                                                                                                                     | **Partly met.** The script is written against the current screens. No recording is in the repository |
| Cited evidence                    | `lab/runs/reference-BTK-p.Arg28His/record.jsonl` (23 evidence items with database record IDs and URLs), `sources_seen.jsonl`, `report.md`                                    | **Met**                                                                                              |
| Experiment code and results       | Tests: `lab/tools/orphafold_lab_tools/experiments.py`, results in `lab/runs/*/results/`. Benchmark: `lab/experiments/run_benchmark.py`, `protocol.md`, `results/latest.json` | **Met.** Test code and results are complete for the kept runs. Benchmark: 26 of 26 planned runs, 13 team and 13 single agent; `lab/experiments/RESULTS.md` exists; 4 of 4 repeat runs had finished                                                                                       |
| The measured improvement          | Section 6                                                                                                                                                                    | **Partly met.** A comparison was measured and is reported as observed (26 of 26 planned runs, 13 team and 13 single agent). It shows no speed-up: the team's median wall time is 198.5 s against 84.2 s for one agent (ratio single agent ÷ team 0.42). The measured gain is breadth: 2 times the evidence items and 1.43 times the cited databases in 13 paired variants. No human baseline was timed, so the improvement over manual work is not measured                                                                     |
| The next experiment               | Section 8; record line 76                                                                                                                                                    | **Met.** Not run                                                                                     |
