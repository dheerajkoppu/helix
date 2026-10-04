---
name: discovery-loop
description: The Helix lab's discovery loop and handoff contract. Question, evidence, hypothesis, experiment, result, decision, candidates, with the record items each agent must write before it hands over.
---

# Discovery loop

Question -> Evidence -> Hypothesis -> Experiment -> Result -> Decision -> Candidates.

The question of every run: for a pathogenic missense variant in an immune-deficiency gene, which molecular mechanism best explains its effect on the protein, does a targeted computational test change the conclusion the starting evidence suggested, and what could a drug act on if that mechanism is right?

The loop does not end on the decision. It ends on candidates: the proteins a molecule could act on, and the molecules already known to act on them. A candidate is a hypothesis Helix generated. It is never a recommendation, and it carries no treatment or dosing wording.

## Shared research record

One append-only record per run. Agents write to it only through record tools and read it with `read_record`. IDs: evidence `E`, gap `G`, hypothesis `H`, test candidate `T`, approval `A`, target rationale `R`, candidate `C`. A handoff passes IDs, never prose facts.

## Handoff contract

| Step | Agent                     | Reads                                               | Must write before handing back                                                                                                                          |
| ---- | ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a   | literature                | subject                                             | 4 to 7 `evidence` (class literature, Europe PMC or OpenAlex record), 1 to 3 `gap`, `handoff`                                                            |
| 1b   | knowledge_graph (COLLECT) | subject                                             | 10 to 16 `evidence` with database record IDs, `gap`, `handoff`                                                                                          |
| 2    | insight                   | evidence, gaps                                      | at least 2 `hypothesis` of different mechanism classes, each with supporting evidence IDs, a refutation criterion and a starting rank; `handoff`        |
| 3    | planner                   | hypotheses, test catalogue, budget, earlier results | at least 2 `test_candidate` with expected learning, feasibility and cost; one `plan` with the chosen test and a reason for each rejected one; `handoff` |
| 4    | safety                    | plan, every recorded statement                      | a safety review `note` (cleared or blocked); for a test that starts a compute job an `approval_request` and the human `approval_decision`; `handoff`    |
| 5    | runner                    | plan, safety review, approval                       | `experiment_started`, `experiment_result` with values, controls, sources, reproducible command, job ID and manifest for jobs; `handoff`                 |
| 6a   | analysis                  | hypotheses, result                                  | `interpretation` with a verdict per hypothesis and the uncertainty; `decision`; `next_experiment`; `handoff`                                            |
| 6b   | knowledge_graph (UPDATE)  | result                                              | result `evidence` linked to the test and the hypotheses; consistency report; `handoff`                                                                  |
| 7    | supervisor                | decisions, budget                                   | `note` of kind reopened_assumption when the result reopens the earlier choice, then steps 3 to 6 once more                                              |
| 8a   | translator                | the decision, the favoured mechanism and direction  | one `target_rationale`; a `note` of kind candidates_proposed; after the review, one `candidate` per cleared row; `handoff`                              |
| 8b   | safety (CANDIDATES)       | the proposal, each direction check                  | a `note` of kind candidate_review, with one `candidate_rejected` note per rejected row; `handoff`                                                       |
| 9    | supervisor                | whole record                                        | final report `note`                                                                                                                                     |

Steps 1a and 1b run in parallel. Steps 6a and 6b run in parallel. Step 8b runs between the proposal and the candidates of step 8a: nothing is recorded as a candidate until the review clears it.

## Rules every agent follows

- Research and hypothesis generation only. No clinical advice, no treatment recommendations, no dosing.
- Evidence is recorded only with the database, record ID and URL a tool returned in this run. Memory is not a source.
- A hypothesis is an agent-generated hypothesis until a test bears on it, and stays labelled as one afterwards.
- A prediction is stated as a prediction. What has not been validated experimentally is said so.
- The runner executes exactly the chosen test. Policies deny a test that is not planned, not cleared by safety or, for a compute job, not approved by a human.
- The budget (tool calls, compute seconds) is enforced by policy. The planner chooses within what remains.
- No molecule name is ever typed by an agent. A molecule enters the record only by the `candidate_ref` a tool returned.

## Candidates and the direction of effect

The whole step turns on one rule. A disease caused by too much activity of a protein needs that activity reduced; a disease caused by too little needs it restored. A molecule that reduces activity applies to the first and would make the second worse. So the direction of effect is a filter, not a score:

- `matches`: the molecule's action is the action the mechanism needs. Recordable as a candidate.
- `opposes`: the molecule pushes the protein the way the disease already pushes it. Rejected, with the reason, and the rejection stays visible in the record.
- `unknown`: the direction is not established. Rejected in this lab, labelled as unknown rather than guessed.

A candidate's bridge is how the molecule was reached: `same_target`, `pathway_node` (a druggable protein upstream or downstream whose action corrects the direction), `interaction_partner`, `structural_analogue` or `mechanism_class`. Each step of the bridge is a separate claim with its own record.

## Reopening

A result reopens the earlier choice when the test did not complete, when the hypothesis favoured before the test is weakened or refuted, or when the favoured hypothesis changed. The supervisor records the reopening with the hypothesis that was favoured before the test, the planner chooses again among tests not yet executed, taking the result into account, and the loop continues from safety. One reopening per run.
