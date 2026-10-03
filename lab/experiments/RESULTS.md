# Benchmark results: specialist lab against a single agent

Batch `bench01`, run on 2026-10-03 from 22:07 to 22:34 UTC, plus two repeat batches until 22:41 UTC. Protocol: `protocol.md`. Every number below is read from `results/latest.json`, which `run_benchmark.py` builds from the run records in `lab/runs/`. The tables are the output of `render_tables.py` (`results/tables.md`).

## What was run

- 13 variants (the first-listed flagship variant of each gene in `data/seed/catalog.json`), two arms, one run per cell: 26 cells.
- 27 attempts. 25 cells succeeded on the first attempt. One lab attempt failed (STAT3 p.Arg382Trp) and its single retry succeeded. So 26 of 26 cells have a succeeded run, and all 26 records are complete by the definition in the protocol.
- Repeat study: BTK p.Arg28His twice more in each arm (4 runs, all succeeded).
- Both arms: Omnigent 0.16.0, harness `claude-sdk`, model `claude-sonnet-5` in every agent, budget 160 lab tool calls and 300 compute seconds, 3 runs in parallel with the arms interleaved. One `spec_hash` per arm for the whole batch, so the lab did not change while it ran.
- Reference labels were fixed at 22:02 UTC, before the first run (hash in `latest.json`). Commit `618d97c`, made by the platform build at 22:04 UTC, three minutes before the batch started, holds `reference/labels.json` and the rule script with exactly the hashes recorded in the results.

## Headline

**The bottleneck is the time from a variant to a complete cited record with one executed test.** Measured, specialist lab against single agent:

|                              | Specialist lab | Single agent  |
| ---------------------------- | -------------- | ------------- |
| Median wall seconds, 13 runs | 198.5          | 84.2          |
| Range                        | 172.9 to 285.8 | 75.2 to 102.3 |

Ratio single agent ÷ lab: **0.42**. The lab took longer in 13 of 13 pairs, by a median of 117.3 s; the median paired ratio lab ÷ single agent is 2.5 (exact two-sided sign test p = 0.0002).

The seven-agent organisation does not accelerate this bottleneck against one agent holding the same tools. It is about 2.4 times slower on the medians.

No human was timed. These numbers say nothing about a speed-up over manual work, and no such figure is claimed. What can be said is that every one of the 26 runs produced a complete cited record in under five minutes (longest: 285.8 s).

What the lab returned for the extra time:

- **Breadth of evidence.** 10.69 databases cited per run against 7.46, more in 12 of 13 pairs (median 3 more, p = 0.0005). 22.15 evidence items against 11.31, more in 13 of 13 pairs (p = 0.0002). The gap is already there before the first hypothesis (19.31 against 11.08 items), so it comes from the two parallel collectors, not from the lab's extra steps after the test. Of the databases a scripted pass over the same tools returned for a variant (mean 12.77), the lab cited 77% and the single agent 55%.
- **A second look.** The supervisor reopened the earlier choice in 4 of 13 lab runs and a second test ran in 3 of them. The single-agent prompt has no such step.

What did not differ:

- Hypotheses per run: 2.69 in both arms (11 ties in 13 pairs).
- The favoured mechanism class after the test was the same in both arms for 10 of 13 variants.
- Agreement with the reference: 5 of 6 for the lab, 4 of 6 for the single agent, and 3 of 3 for both on the residue-specific labels. The one-variant difference is the size of the variation seen between repeats of one cell (see "Repeat study").
- Wall seconds per lab tool call: 2.1 against 2.2.

What it cost: 41,574 output tokens per run against 13,900 (median paired ratio 2.85), and 1.01 against 0.33 USD per run in Omnigent's own accounting for the session and its sub-agent sessions.

## Arms

| Measure                                                       | Specialist lab | Single agent  |
| ------------------------------------------------------------- | -------------- | ------------- |
| Runs succeeded / planned                                      | 13 / 13        | 13 / 13       |
| Failed attempts                                               | 1              | 0             |
| Complete cited records                                        | 13             | 13            |
| Median wall seconds                                           | 198.5          | 84.2          |
| Wall seconds, min to max                                      | 172.9 to 285.8 | 75.2 to 102.3 |
| Median seconds to first hypothesis                            | 68             | 35            |
| Median seconds to first plan                                  | 104            | 52            |
| Median seconds to first result                                | 132            | 60            |
| Median seconds to first decision                              | 158            | 65            |
| Median seconds to final report                                | 195            | 76            |
| Mean lab tool calls                                           | 99.62          | 39.62         |
| Median wall seconds per lab tool call                         | 2.1            | 2.2           |
| Mean output tokens (Omnigent accounting, sub-agents included) | 41573.8        | 13900.2       |
| Mean cost as reported by Omnigent, USD                        | 1.01           | 0.33          |
| Mean distinct databases cited                                 | 10.69          | 7.46          |
| Mean distinct databases cited before the first hypothesis     | 10.38          | 7.23          |
| Mean databases returned by the scripted pass                  | 12.77          | 12.77         |
| Mean share of those databases cited                           | 0.77           | 0.55          |
| Mean evidence items                                           | 22.15          | 11.31         |
| Mean evidence items before the first hypothesis               | 19.31          | 11.08         |
| Mean hypotheses                                               | 2.69           | 2.69          |
| Mean tests considered                                         | 3.77           | 3.31          |
| Mean tests executed                                           | 1.23           | 1             |
| Runs with a reopening                                         | 4              | 0             |
| Runs where the favoured hypothesis changed                    | 4              | 5             |
| Approvals granted / rejected                                  | 1 / 0          | 0 / 0         |
| Policy denials                                                | 12             | 7             |
| Safety reviews with verdict blocked                           | 2              | 0             |
| Plans whose test did not run                                  | 2              | 0             |
| Agreement with the reference after the test                   | 5 of 6         | 4 of 6        |
| Agreement with the reference before the test                  | 5 of 6         | 4 of 6        |
| Agreement, residue-specific reference only                    | 3 of 3         | 3 of 3        |

Medians and means use the 13 succeeded runs of each arm. The failed lab attempt (482.9 s) is not in them.

### Paired comparison (lab minus single agent, 13 pairs)

| Metric                    | Pairs | Lab higher | Single agent higher | Ties | Median difference | Median ratio lab ÷ single agent | Sign test p |
| ------------------------- | ----- | ---------- | ------------------- | ---- | ----------------- | ------------------------------- | ----------- |
| wall_seconds              | 13    | 13         | 0                   | 0    | 117.3             | 2.5                             | 0.0002      |
| tool_calls                | 13    | 13         | 0                   | 0    | 53                | 2.33                            | 0.0002      |
| distinct_sources          | 13    | 12         | 0                   | 1    | 3                 | 1.43                            | 0.0005      |
| evidence_items            | 13    | 13         | 0                   | 0    | 11                | 2                               | 0.0002      |
| starting_evidence_items   | 13    | 13         | 0                   | 0    | 9                 | 1.8                             | 0.0002      |
| starting_distinct_sources | 13    | 13         | 0                   | 0    | 3                 | 1.38                            | 0.0002      |
| hypotheses                | 13    | 1          | 1                   | 11   | 0                 | 1                               | 1           |
| tests_considered          | 13    | 6          | 0                   | 7    | 0                 | 1                               | 0.0312      |
| output_tokens             | 13    | 13         | 0                   | 0    | 23944             | 2.85                            | 0.0002      |

The sign test only uses the direction of each pair. For time, tool calls, evidence and tokens the direction is the same in every pair, which is the strongest statement 13 pairs can support. It says nothing about the size of the difference on other variants.

## Where the time goes

The tools are not the limit. `preflight.py` called 11 retrieval tools and the 3 retrieval-only tests for each variant without an agent: median 1.74 s on the first pass and 0.56 s on the second, against 84.2 s and 198.5 s for the agent runs. The scripted pass is under 1% of either arm's median wall time; the rest is model turns.

Both arms spend about the same wall time per lab tool call (2.2 and 2.1 s). The lab is slower because it makes 2.5 times as many calls:

| Purpose (mean calls per run) | Specialist lab | Single agent |
| ---------------------------- | -------------- | ------------ |
| retrieval                    | 14.62          | 9.77         |
| evidence_record              | 28             | 14.31        |
| reasoning_record             | 13.38          | 11.46        |
| safety                       | 3              | 2            |
| test                         | 4.92           | 2.15         |
| coordination                 | 36.38          | 0.15         |
| omnigent_dispatch            | 19.85          | 0            |

Coordination (`record_handoff`, `read_record`, `get_budget_status`, `check_record_consistency`) is 36.38 of the lab's 99.62 lab tool calls, and Omnigent's dispatch calls add 19.85 more that the tool-call metric does not count. Recording evidence takes one call per item in both arms. The scientific calls (retrieval, hypotheses and plans, tests) differ less: 32.92 against 23.38.

The lab's parallel evidence phase does not make up for this: the first hypothesis appears after a median of 68 s in the lab and 35 s for the single agent.

## Did the test change the conclusion

|                                             | Specialist lab  | Single agent    |
| ------------------------------------------- | --------------- | --------------- |
| Runs where the favoured hypothesis changed  | 4 of 13         | 5 of 13         |
| Of the 6 variants with a reference          | 0 of 6          | 1 of 6          |
| Agreement with the reference before → after | 5 of 6 → 5 of 6 | 4 of 6 → 4 of 6 |

On the six variants with a reference, the test did not change the lab's favoured class once, and it did not change either arm's agreement. In all 12 runs on those variants, the UniProtKB annotation the reference is built from was recorded as evidence before the first hypothesis.

The nine changes are all on variants where the favourite was not settled by a residue-level annotation, and eight of them are on variants without a reference, so the benchmark cannot say whether they are improvements.

Reading the test verdicts in the records: in 2 of the 9 changes the test gave a positive result for the new favourite (FoldX above the destabilising threshold for WAS p.Thr45Met and CD40LG p.Thr254Met, both in the lab). In the other 7 the test went against the previous favourite and the next-ranked hypothesis moved up without a test of its own. One single-agent record says this itself: its new ranking "rests on elimination rather than a positive measurement".

### Cases where the result reopened the starting hypothesis (lab)

| Variant            | Favoured on starting evidence | First test and verdict                                    | Reopened                           | Second round                                                                                                                                                | Final                         |
| ------------------ | ----------------------------- | --------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| ADA p.Arg211His    | `ligand_binding`              | `ligand_contact`: no contact in 2 ligand-bound structures | H1, weakened                       | Planner chose `stability_effect`. Safety cleared it, then asked for approval, did not accept the automated pre-approval and blocked it. No second test ran. | `stability_folding`, untested |
| IL2RG p.Arg226Cys  | `stability_folding`           | `stability_effect`: not predicted destabilising           | H1, weakened                       | `structural_context`: in a predicted pocket, in no predicted interface                                                                                      | `protein_interaction`, kept   |
| WAS p.Thr45Met     | `protein_interaction`         | `stability_effect`: predicted destabilising               | H1, displaced by a supported rival | `structural_context`: in a predicted pocket, in no predicted interface                                                                                      | `stability_folding`, kept     |
| CD40LG p.Thr254Met | `protein_interaction`         | `stability_effect`: predicted destabilising               | H1, displaced by a supported rival | `structural_context`: in a predicted pocket, in no predicted interface                                                                                      | `stability_folding`, kept     |

In the three runs where the second test ran, it did not move the decision again.

On the same four variants the single agent started from `stability_folding` in all four, and ended on the same class as the lab in all four (`stability_folding`, `protein_interaction`, `stability_folding`, `stability_folding`). The two arms named the same favoured class for 8 of 13 variants before the test and for 10 of 13 after it.

## Agreement with the reference

| Variant           | Reference (tier)                 | Lab, before → after                             | Single agent, before → after                    |
| ----------------- | -------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| BTK p.Arg28His    | `ligand_binding` (residue)       | `ligand_binding` → `ligand_binding`             | `ligand_binding` → `ligand_binding`             |
| CYBB p.His101Arg  | `ligand_binding` (residue)       | `ligand_binding` → `ligand_binding`             | `ligand_binding` → `ligand_binding`             |
| STAT3 p.Arg382Trp | `nucleic_acid_binding` (residue) | `nucleic_acid_binding` → `nucleic_acid_binding` | `nucleic_acid_binding` → `nucleic_acid_binding` |
| RAG1 p.Arg404Gln  | `nucleic_acid_binding` (region)  | `nucleic_acid_binding` → `nucleic_acid_binding` | `nucleic_acid_binding` → `nucleic_acid_binding` |
| FOXP3 p.Ala384Thr | `nucleic_acid_binding` (region)  | `nucleic_acid_binding` → `nucleic_acid_binding` | `protein_interaction` → `stability_folding`     |
| JAK3 p.Arg103His  | `protein_interaction` (region)   | `stability_folding` → `stability_folding`       | `stability_folding` → `stability_folding`       |

- The reference is not blind: both arms can read the UniProtKB features it is derived from. Agreement shows consistency with curated annotation.
- JAK3: both arms favoured `stability_folding` and the stability test returned "predicted destabilising" in both. The reference there is region-level (the residue lies in a 223-residue receptor-interaction region) and no structure corroborates it. The benchmark cannot say which is right.
- FOXP3 is the only variant that separates the arms.

## Repeat study: BTK p.Arg28His, three runs per arm

| Arm          | Run                                     | Wall s | Tool calls | Databases | Evidence | First test       | Favoured before     | Favoured after      | Changed |
| ------------ | --------------------------------------- | ------ | ---------- | --------- | -------- | ---------------- | ------------------- | ------------------- | ------- |
| lab          | bench01-BTK-p.Arg28His-lab              | 179    | 87         | 10        | 21       | ligand_contact   | ligand_binding      | ligand_binding      | no      |
| lab          | bench01-repeat2-BTK-p.Arg28His-lab      | 192.5  | 89         | 10        | 21       | ligand_contact   | protein_interaction | protein_interaction | no      |
| lab          | bench01-repeat3-BTK-p.Arg28His-lab      | 206.1  | 88         | 9         | 23       | ligand_contact   | ligand_binding      | ligand_binding      | no      |
| single agent | bench01-BTK-p.Arg28His-baseline         | 84.2   | 39         | 8         | 13       | ligand_contact   | ligand_binding      | ligand_binding      | no      |
| single agent | bench01-repeat2-BTK-p.Arg28His-baseline | 85.7   | 41         | 8         | 14       | ligand_contact   | ligand_binding      | ligand_binding      | no      |
| single agent | bench01-repeat3-BTK-p.Arg28His-baseline | 78.2   | 36         | 7         | 12       | stability_effect | ligand_binding      | ligand_binding      | no      |

- Wall time is stable within an arm (179 to 206.1 s; 78.2 to 85.7 s). The time difference between arms is far larger than this spread.
- The conclusion is not stable in the lab arm. In one of three runs the insight agent ranked `protein_interaction` first, because a retrieved paper (PMID:38971313) reports PH-TH dimerisation for this exact substitution. The ligand-contact result, with the same measured values as in the other runs, did not displace it: the analysis agent noted that the test used structures of the reference residue. The lab agreed with the reference in 2 of 3 runs, the single agent in 3 of 3.
- The decision did not change in any of these six runs. The kept reference run of the lab builder (`lab/runs/reference-BTK-p.Arg28His`) is one where it did; on this variant that outcome did not recur here.

## Per variant

| Variant             | Arm          | Status    | Wall s | Tool calls | Databases | Evidence | Tests chosen                         | Favoured before      | Favoured after       | Changed | Reference            | Agrees |
| ------------------- | ------------ | --------- | ------ | ---------- | --------- | -------- | ------------------------------------ | -------------------- | -------------------- | ------- | -------------------- | ------ |
| ADA-p.Arg211His     | lab          | succeeded | 246.6  | 104        | 11        | 20       | ligand_contact, stability_effect     | ligand_binding       | stability_folding    | yes     | –                    | –      |
| ADA-p.Arg211His     | single agent | succeeded | 93.2   | 42         | 7         | 13       | stability_effect                     | stability_folding    | stability_folding    | no      | –                    | –      |
| IL2RG-p.Arg226Cys   | lab          | succeeded | 272.2  | 122        | 13        | 25       | stability_effect, structural_context | stability_folding    | protein_interaction  | yes     | –                    | –      |
| IL2RG-p.Arg226Cys   | single agent | succeeded | 75.2   | 36         | 7         | 10       | stability_effect                     | stability_folding    | protein_interaction  | yes     | –                    | –      |
| BTK-p.Arg28His      | lab          | succeeded | 179    | 87         | 10        | 21       | ligand_contact                       | ligand_binding       | ligand_binding       | no      | ligand_binding       | yes    |
| BTK-p.Arg28His      | single agent | succeeded | 84.2   | 39         | 8         | 13       | ligand_contact                       | ligand_binding       | ligand_binding       | no      | ligand_binding       | yes    |
| WAS-p.Thr45Met      | lab          | succeeded | 248.2  | 118        | 13        | 22       | stability_effect, structural_context | protein_interaction  | stability_folding    | yes     | –                    | –      |
| WAS-p.Thr45Met      | single agent | succeeded | 88.7   | 41         | 7         | 11       | stability_effect                     | stability_folding    | stability_folding    | no      | –                    | –      |
| RAG1-p.Arg404Gln    | lab          | succeeded | 252.7  | 105        | 11        | 22       | stability_effect, stability_effect   | nucleic_acid_binding | nucleic_acid_binding | no      | nucleic_acid_binding | yes    |
| RAG1-p.Arg404Gln    | single agent | succeeded | 93.3   | 36         | 6         | 10       | stability_effect                     | nucleic_acid_binding | nucleic_acid_binding | no      | nucleic_acid_binding | yes    |
| JAK3-p.Arg103His    | lab          | succeeded | 172.9  | 87         | 10        | 22       | stability_effect                     | stability_folding    | stability_folding    | no      | protein_interaction  | no     |
| JAK3-p.Arg103His    | single agent | succeeded | 81.2   | 41         | 8         | 12       | stability_effect                     | stability_folding    | stability_folding    | no      | protein_interaction  | no     |
| CYBB-p.His101Arg    | lab          | succeeded | 189.5  | 91         | 7         | 22       | stability_effect                     | ligand_binding       | ligand_binding       | no      | ligand_binding       | yes    |
| CYBB-p.His101Arg    | single agent | succeeded | 82.7   | 39         | 5         | 10       | ligand_contact                       | ligand_binding       | ligand_binding       | no      | ligand_binding       | yes    |
| STAT3-p.Arg382Trp   | lab          | succeeded | 212.1  | 92         | 11        | 23       | stability_effect                     | nucleic_acid_binding | nucleic_acid_binding | no      | nucleic_acid_binding | yes    |
| STAT3-p.Arg382Trp   | single agent | succeeded | 82.7   | 40         | 8         | 12       | stability_effect                     | nucleic_acid_binding | nucleic_acid_binding | no      | nucleic_acid_binding | yes    |
| STAT1-p.Arg274Trp   | lab          | succeeded | 198.5  | 94         | 9         | 23       | stability_effect                     | protein_interaction  | protein_interaction  | no      | –                    | –      |
| STAT1-p.Arg274Trp   | single agent | succeeded | 102.3  | 45         | 9         | 12       | structural_context                   | protein_interaction  | domain_interface     | yes     | –                    | –      |
| FOXP3-p.Ala384Thr   | lab          | succeeded | 183.5  | 88         | 10        | 22       | stability_effect                     | nucleic_acid_binding | nucleic_acid_binding | no      | nucleic_acid_binding | yes    |
| FOXP3-p.Ala384Thr   | single agent | succeeded | 91.7   | 40         | 9         | 13       | structural_context                   | protein_interaction  | stability_folding    | yes     | nucleic_acid_binding | no     |
| CD40LG-p.Thr254Met  | lab          | succeeded | 285.8  | 123        | 10        | 22       | stability_effect, structural_context | protein_interaction  | stability_folding    | yes     | –                    | –      |
| CD40LG-p.Thr254Met  | single agent | succeeded | 82.7   | 39         | 7         | 10       | stability_effect                     | stability_folding    | stability_folding    | no      | –                    | –      |
| PIK3CD-p.Glu1021Lys | lab          | succeeded | 186.6  | 93         | 13        | 23       | structural_context                   | ligand_binding       | ligand_binding       | no      | –                    | –      |
| PIK3CD-p.Glu1021Lys | single agent | succeeded | 97.8   | 40         | 9         | 11       | ligand_contact                       | ligand_binding       | protein_interaction  | yes     | –                    | –      |
| CTLA4-p.Arg75Trp    | lab          | succeeded | 195.6  | 91         | 11        | 21       | stability_effect                     | protein_interaction  | protein_interaction  | no      | –                    | –      |
| CTLA4-p.Arg75Trp    | single agent | succeeded | 78.3   | 37         | 7         | 10       | stability_effect                     | stability_folding    | protein_interaction  | yes     | –                    | –      |

The STAT3 lab row is the retry `bench01-STAT3-p.Arg382Trp-lab-r2`. "Tests chosen" lists every plan; for ADA and RAG1 in the lab one of the two plans did not lead to a result (see "Failure cases").

### Runs citing each database (of 13)

| Database                 | Specialist lab | Single agent |
| ------------------------ | -------------- | ------------ |
| AlphaFold DB             | 11             | 7            |
| AlphaMissense            | 13             | 13           |
| ClinVar                  | 13             | 13           |
| EBI ProtVar              | 13             | 12           |
| Ensembl VEP              | 6              | 0            |
| Europe PMC               | 13             | 13           |
| IUIS 2024 classification | 3              | 0            |
| IntAct                   | 5              | 0            |
| InterPro                 | 10             | 1            |
| OpenAlex                 | 10             | 7            |
| PDBe SIFTS               | 7              | 8            |
| PrankWeb                 | 4              | 2            |
| RCSB PDB                 | 11             | 8            |
| UniProtKB                | 13             | 13           |
| gnomAD                   | 7              | 0            |

The single agent never cited gnomAD, IntAct, Ensembl VEP or the IUIS classification, and cited InterPro once.

### First test chosen

| Test               | Specialist lab | Single agent |
| ------------------ | -------------- | ------------ |
| ligand_contact     | 2              | 3            |
| stability_effect   | 10             | 8            |
| structural_context | 1              | 2            |

`structure_comparison`, the only test that needs approval and compute, was scored as a candidate and never chosen. Compute seconds were 0 in all 26 runs. The two arms chose the same first test for 8 of 13 variants.

## The two gain-of-function variants

UniProtKB describes STAT1 p.Arg274Trp and PIK3CD p.Glu1021Lys as gain of function, while the launcher's objective says "loss of function". All four runs on these variants (both arms) recorded the gain-of-function annotation as evidence and wrote hypotheses about gained activity. The STAT1 lab record states that its favoured mechanism "is a gain of function, not the loss of function named in the objective". The mechanism classes describe ways to lose a contact, so the runs fitted gain-of-function mechanisms into them: the PIK3CD lab run filed stronger membrane association under `ligand_binding`.

## Failure cases

1. **STAT3 p.Arg382Trp, lab, first attempt: failed after 482.9 s with no test and no decision.** The claims guard's pattern list (`lab/tools/orphafold_lab_tools/claims.py`) matches the bare word "dosage". The literature agent wrote "a dosage mechanism (like the nonsense haploinsufficiency case)" in a gap statement, a genetics term, and the guard refused the call. Each refusal is written to the record as a `policy_denial` note whose text quotes the matched word, and `review_claims` scans those notes as statements. The safety agent blocked the plan twice because of the notes, the record is append-only so they cannot be removed, the analysis agent could not record a decision without a result, and the run stalled. 11 policy denials were recorded in that attempt. The retry succeeded in 212.1 s. This can recur on any variant whose literature uses a matched word.
2. **ADA p.Arg211His, lab: the second test did not run.** After the reopening, the safety agent cleared `stability_effect`, then asked for approval although the catalogue marks that test as needing none. The pre-approval rule answered. The safety agent wrote that the approval "was granted by an automated build agent under a pre-approval rule, not by a human, so I do not treat it as valid", and blocked the test. The run ended with `stability_folding` favoured and untested. Two things follow. The safety agent holds the human-approval boundary against an automated approver even when the record says "approved". And the benchmark never exercised an approved compute job.
3. **RAG1 p.Arg404Gln, lab: 9 claims-guard refusals.** Six were for the phrase "treatment advice". In the transcripts the phrase is the supervisor telling the safety agent to check the record "for clinical wording or treatment advice", and the safety agent reporting that none reached the record. The first safety review was blocked because the refusal notes were flagged; a second review cleared the same test and it ran. The run took 252.7 s.
4. **Claims-guard false positives in general.** 19 refusals in the 26 succeeded runs: 11 for a factual statement without a record ID (the agent then rewrote it with a citation) and 8 for matched phrases ("treatment advice" 6, "clinical advice" 2). The two "clinical advice" refusals were for a report sentence saying "nothing here is clinical advice". None of the 8 was advice. With the failed attempt, the matched words also include "dosage".
5. **Stability first.** The stability prediction was the first test in 18 of 26 runs. For RAG1, STAT3 and FOXP3 the lab favoured a nucleic-acid-binding hypothesis and tested stability. No test in the catalogue measures contact with DNA. A "not destabilising" result then counted against the rival and left the favourite untested.
6. **Unstable starting rank.** BTK p.Arg28His in the lab: `ligand_binding` first in two runs, `protein_interaction` first in one (see "Repeat study").

No run exceeded the tool-call budget (largest: 123 of 160). No rate-limit failure occurred at 3 runs in parallel.

## Threats to validity

- **Small n.** 13 variants in 13 genes. The direction of the time, breadth and cost differences is the same in every pair; their size on other variants is not established.
- **Single runs without repeats.** One run per cell in the main comparison. The BTK repeats show that the lab's starting favourite and final class can differ between runs of the same cell. Agreement counts (5 of 6 against 4 of 6) and counts of changed decisions (4 against 5) differ between arms by one run, which repeats alone can produce.
- **The same model in both arms.** The comparison isolates how the agents are organised. It says nothing about a stronger or weaker model in any role, and seven roles on a cheaper model were not tested here.
- **The reference is visible through tools and small.** 6 of 13 variants have a label, 3 of them only from membership of an annotated region. Both arms can read the annotation behind every label. High agreement on the residue-specific labels (3 of 3 in both arms) mostly shows that both arms use the UniProtKB site annotation.
- **Reference rules were written knowing one outcome.** Before the rules were written, the lab builder's report on BTK p.Arg28His was known (final favourite `ligand_binding` in 6 of 7 development runs). No other variant had been run.
- **Predictors that share training signal with clinical labels.** An AlphaMissense score is recorded as evidence in all 26 runs, and a popEVE score in 20. They support "damaging" for variants ClinVar already calls pathogenic and cannot arbitrate between mechanisms. FoldX on an AlphaFold model, the most-used test, is a prediction whose error the test catalogue gives as near 1 kcal/mol; STAT3 p.Arg382Trp sits at +1.96 against a threshold of 2.0.
- **Changes by elimination.** 7 of 9 changed decisions moved to a hypothesis that had no test of its own.
- **Unequal steps.** Reopening and the knowledge-graph update exist only in the lab. Counts before the first hypothesis are the like-for-like comparison of evidence.
- **Wall time on a shared machine.** Other builds used the same API server and model account during the batch. Arms were interleaved (25 of 27 attempts started with 2 other benchmark runs active). Wall time includes the per-run Omnigent server start and transcript export in both arms.
- **Objective wording.** "Loss of function" is wrong for two variants.
- **Approvals.** The pre-approval was automated and labelled as such. The compute path behind the approval gate was not exercised.
- **No human baseline, no laboratory validation.** No statement here is about time saved against a scientist, and no mechanism was validated outside a computer.

## What would be needed to approach a 10x improvement at scale

Against one agent, the lab is at 0.42x on time. What the measurements say about getting to 10x:

1. **Cut model turns, since tools are already fast.** A run costs about 2.1 s per lab tool call and the tools themselves need 0.56 s for all 14 calls. A tenth of the lab's median (about 20 s) leaves room for roughly 10 tool calls at the measured rate. The lab makes 99.62 plus 19.85 dispatch calls. That target is arithmetic from measured values; no such run exists yet.
2. **Take evidence assembly out of the agent loop.** The scripted pass returns the records of 12.77 databases per variant in under a second. Agents currently spend 14.62 retrieval calls and 28 record calls on it, and reach the first hypothesis after 68 s. Writing the scripted evidence to the record in one batch would also give every run the same starting evidence, which removes one source of the run-to-run variation seen on BTK.
3. **Shrink coordination.** 36.38 coordination calls and 19.85 dispatch calls per run produce no evidence. Handoffs that pass IDs through the record could be written by the tools instead of by a model turn.
4. **Scale across variants, where parallelism already works.** 27 attempts totalling 4,440 s of run time finished in 1,569 s with 3 workers (2.83 times the serial rate) and no rate-limit failure. Whether 30 workers hold is untested.
5. **Fix what fails before scaling.** 1 of 27 attempts failed on a guard false positive, and one more run lost its second test to an approval the safety agent would not accept.
6. **To claim acceleration over manual work**, time scientists on the same variants against the same completeness definition. Without that, a multiplier over manual work is a guess, and none is given here.
7. **To claim better conclusions**, a blind reference is needed: labels from deep mutational scanning or from annotations withheld from the tools, on enough variants that a difference of one run does not decide the comparison.

## Next experiment

A third arm on the same 13 variants, three repeats per cell: evidence assembled by the scripted pass and written to the record in one batch, agents kept for hypotheses, test choice and interpretation. Prediction to test: the time before the first hypothesis (68 s lab, 35 s single agent) drops to near zero and the favoured class does not change. Three repeats per cell give a first estimate of run-to-run variation for every variant.

In the same batch, add a test of contacts with DNA and with partner proteins in experimental structures. 10 of 13 lab runs chose the stability prediction first, and 6 of 13 lab runs ended on a nucleic-acid or protein-interaction hypothesis that no catalogue test addresses. The data exist: the PDBe-KB snapshots used for the reference list STAT3 residue 382 and FOXP3 residue 384 at a DNA interface in deposited structures (`reference/labels.json`). With that test the planner has a real choice for these hypotheses, and a result can confirm or refute the favourite directly.

Before either: remove the bare-word patterns from the claims guard and stop `review_claims` from scanning `policy_denial` notes, then confirm on STAT3 p.Arg382Trp that the stall does not recur.

## Deviations from the protocol

- Section 10 (repeat study) was added seven minutes into the batch, before any aggregate was read. By then the wall times of the first seven runs and the outcomes of two single-agent runs (ADA, IL2RG) had been seen; no BTK outcome had. It is marked as added in `protocol.md`.
- Descriptive measures were added to the aggregate while the batch ran or after it: tool calls by purpose, token usage and cost from Omnigent's session accounting, databases cited per run and the share of the scripted pass, blocked safety reviews, whether the arms name the same class, and the split of changed decisions by test verdict. They are not in section 4 of the protocol and no threshold was set for them in advance.
- After the batch, `reference_labels.py` was reformatted (line wrapping only) and changed so that it checks an existing `labels.json` instead of replacing it. Its hash therefore no longer equals `rule_sha256` in `labels.json`, which is the hash of the script as it was when the labels were derived. During that edit `labels.json` was regenerated once with a new timestamp and then restored; the restored file has the SHA-256 recorded in `conditions.reference_labels` before the batch, and running the script reports that the derivation matches it.
- No code, prompt or policy in `lab/` outside `lab/experiments/` was changed, before, during or after the batch. The claims-guard defect found by the batch is reported here and left for the owner of the lab core.

## Files

| File                                                                                   | Contents                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `protocol.md`                                                                          | Question, arms, variants, metrics, approval rule, reference rules, controls, threats known in advance |
| `reference_labels.py`, `reference/labels.json`, `reference/snapshots/`                 | Reference derivation, its output, the raw UniProtKB and PDBe-KB responses it used                     |
| `preflight.py`, `results/preflight.json`                                               | Scripted retrieval per variant, with timings                                                          |
| `run_benchmark.py`                                                                     | Runs the batch (resumable, parallel) and aggregates                                                   |
| `results/latest.json`                                                                  | The aggregate, served by `GET /api/v1/lab/benchmark`                                                  |
| `results/bench01.json`, `results/bench01-repeat2.json`, `results/bench01-repeat3.json` | Aggregates per batch                                                                                  |
| `results/attempts-*.jsonl`, `results/conditions-*.json`, `results/logs/`               | Every attempt with its exit code, the conditions of each batch, one launcher log per run              |
| `interpretation.json`                                                                  | The hand-written note, caveats and next experiment that `run_benchmark.py` merges into `latest.json`  |
| `render_tables.py`, `results/tables.md`                                                | The tables above                                                                                      |
| `lab/runs/bench01-*`                                                                   | 31 run directories: record, report, results, policy log, transcripts                                  |
