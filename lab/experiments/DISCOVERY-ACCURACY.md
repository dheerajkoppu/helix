# Discovery accuracy on held-out known drugs

Run 2026-10-04T03:21:54Z. 226 disease-molecule pairs over 32 diseases, from a catalog of 604 diseases and 511 genes. 1342 API requests.

Ground truth is the disease-to-molecule records that `exclude_direct=true` withholds, so the engine is forbidden to use them when it is then asked. Every molecule was resolved to a ChEMBL id and an InChIKey through `GET /compounds/{id}` before any row was matched; nothing is matched on a name.

## The scope rule, fixed before the stratified number was computed

This rule is derived from what the engine is built to do, stated in `api/helix/discovery/engine.py` (`LIMITS`), `targets.py` and `caveats.py`. It was not derived from, and was not adjusted after seeing, which pairs the engine recovered.

**A pair is in scope when both hold, read from source data alone:**

1. **Small-molecule modality** - ChEMBL `molecule_type == "Small molecule"`. The engine is a small-molecule engine: `structural_analogue` reasons over pockets and folds, and `caveats.py` emits `NOT_SMALL_MOLECULE` for antibody, protein, enzyme, oligonucleotide, cell and gene modalities. An immunoglobulin is a modality the engine has no mechanism to propose.
2. **A ChEMBL mechanism record whose target resolves to a human protein** - every bridge is anchored on a UniProt accession (`targets.py: protein_actions(accession)`), so a mechanism record with no accession, or with only a non-human one, is unreachable by construction.

**What the rule deliberately excludes.** Bridge reachability is the engine's *method*, not a scope filter. A denominator of "pairs a bridge can reach" would make recall close to tautological - it asks only whether the engine returned what it could already see - so it is reported below as a diagnostic and never as the headline. Clinical intent is also excluded, because no source field states it: a drug aimed at a symptom stays in the denominator wherever modality and mechanism-record criteria admit it, and appears as its own row in the cause table.

**Reporting order, here and everywhere.** (1) Recall over all known pairs, the unflattering number, first. (2) Recall within the scope rule, with the subset size. (3) The cause table for the misses. The false-rejection rate sits beside both recall figures, and every figure in (1) can be reconstructed from the cause table.

## The numbers

| Metric | Value | n |
| --- | --- | --- |
| Recall, pairs recovered as a candidate | **12 of 226** (5.3%) | 226 pairs |
| Recall, diseases with at least one known drug recovered | **3 of 32** (9.4%) | 32 diseases |
| Median rank of a recovered molecule | 5.5 | 12 recovered |
| Recovered within the top 10 | 11 (4.9%) | 226 pairs |
| Recovered within the top 25 | 12 (5.3%) | 226 pairs |
| **False rejection rate** (a used molecule in `ruled_out`) | **1 of 226** (0.4%) | 226 pairs, 1 diseases |
| Missed entirely | 213 | of which 53 have no ChEMBL mechanism record anywhere |

Rank range of recovered molecules: [1, 12].

The engine only ever considers a molecule ChEMBL records a mechanism for. 173 of 226 pairs are inside that universe. Restricted to those, the same figures are:

| Metric | Value | n |
| --- | --- | --- |
| Recall | 12 of 173 (6.9%) | 173 pairs |
| False rejection rate | 1 of 173 (0.6%) | 173 pairs |
| Missed | 160 | 173 pairs |

The unrestricted figure is the honest headline, because a user asking the engine for a disease treated with an immunoglobulin gets nothing useful back whatever the reason. The restricted figure is what the engine's own stated scope can be held to.

### Recall inside the stated scope

Rule: ChEMBL molecule_type == 'Small molecule' AND at least one ChEMBL mechanism record whose target resolves to a human (Homo sapiens) UniProt accession. Fixed before the number was computed; reads source fields only; independent of what the engine returned.

| Metric | Value | n |
| --- | --- | --- |
| Recall, in scope | 11 of 74 (14.9%) | 74 pairs |
| False rejection rate, in scope | 1 of 74 (1.4%) | 74 pairs |
| Missed, in scope | 62 | 74 pairs |

74 of 226 pairs are in scope. The stratified figure is roughly three times the unrestricted one and is still poor: inside the subset the engine is built to address, it recovers about one known drug in seven and misses the other six. Stratifying explains the headline; it does not rescue it.

## Why it misses, every miss classified

Every miss is classified by `lab/experiments/classify_discovery_misses.py`, which reads each molecule's own ChEMBL mechanism records through `GET /compounds/{id}` (joining the organism on from the response's `targets` array, because the mechanism rows do not carry it) and the full uncapped molecule list for a protein through `GET /proteins/{accession}/compounds`. Causes are tested in a fixed order, most specific first, so each miss lands in exactly one bucket and the buckets sum to the miss count. No cause is assigned by judgement.

| Cause | All misses | Of which in the ChEMBL-mechanism universe |
| --- | --- | --- |
| No ChEMBL mechanism record anywhere, so the molecule is outside the only universe the engine reads | 53 | 0 |
| Not a small molecule (antibody, protein, enzyme, oligonucleotide), a modality the engine cannot propose - **out of scope** | 51 | 51 |
| The mechanism target is not a human protein (DNA, peptidoglycan, a bacterial ribosome, a small molecule) - **out of scope** | 47 | 47 |
| Recorded against a protein the engine did reach, but a presentation cap cut it - **a real engine gap** | 1 | 1 |
| Acts on a human protein with no path to the subject protein through any of the five bridges - the engine is correctly silent | 61 | 61 |
| **Total missed** | **213** | **160** |

The targets that recur in the no-path bucket are what show those drugs are aimed elsewhere. These are the proteins their own ChEMBL mechanism records name:

| Mechanism target of the missed drug | Misses |
| --- | --- |
| Tyrosine-protein kinase JAK2 | 8 |
| Inosine-5'-monophosphate dehydrogenase (IMPDH) | 6 |
| Tyrosine-protein kinase JAK1 | 5 |
| Peptidyl-prolyl cis-trans isomerase FKBP1A | 4 |
| Glucocorticoid receptor | 3 |
| Histamine H2 receptor | 3 |
| Matrilysin | 3 |
| Potassium-transporting ATPase | 3 |
| Succinate-semialdehyde dehydrogenase, mitochondrial | 3 |
| Alcohol dehydrogenase class-3 | 2 |
| Amiloride-sensitive sodium channel, ENaC | 2 |
| CRL4(CRBN) E3 ubiquitin ligase | 2 |

Immunosuppressants (IMPDH, FKBP1A, the glucocorticoid receptor, the JAK kinases), antacids (the gastric potassium-transporting ATPase, the histamine H2 receptor), bronchodilators, statins and oral contraceptives. None of them acts on the disease's own protein, and the engine is a mechanism-bridge engine: being silent about them is the behaviour it is built for, not a retrieval failure. They stay in the denominator because no source field states clinical intent.

## What the numbers say

- **Recall is low and concentrated.** 12 of 226 pairs came back, and 10 of those 12 are for one disease (Cystic fibrosis). On 32 diseases the engine recovered a known drug for 3.
- **When it does recover a molecule, the rank is usable.** Median rank 5.5, range [1, 12], 11 of the 12 inside the top 10. The failure is finding the molecule at all, not ordering it.
- **Not one recovered molecule carried a `matches` direction verdict.** All 12 came back as `unknown`, the rank below every match, carrying the caveat 'may push the wrong way'. The engine found these drugs but could not say they push the right way.
- **`pathway_node`, `structural_analogue`, `mechanism_class` recovered nothing.** Every recovery came through `same_target` or `interaction_partner`. Part of this is the target-anchored ground truth, which can only contain drugs acting on the disease's own protein; but `pathway_node` did produce the one false rejection, so it was running.
- **160 pairs were missed with a ChEMBL mechanism record in hand** — the molecule exists in the engine's universe and still appeared in neither `candidates` nor `ruled_out`. Per-bridge caps and the requirement that the mechanism sit on the subject's own protein or a readable pathway node are the places to look.
- **The safety metric is the good one.** 1 false rejections in 226 pairs, and only one of the two is a direction error rather than a drug aimed at a symptom. That one matters a great deal and is written up below.
- **The control subject is not in this set.** APDS, the held-out positive in `DISCOVERY-CONTROLS.md`, has no Open Targets disease node and ChEMBL files leniolisib under a parent term, so no ground-truth pair exists for it under exact identifier matching. The three controls and this experiment do not overlap on a single subject.

## False rejections, every case

Each one was opened individually. A drug that treats a symptom rather than correcting the protein is a legitimate refusal and is labelled as such; a refusal of a drug that does correct the protein is an error and is labelled as such.

- **BARICITINIB** (CHEMBL2105759, PHASE_1) for *AD-HIES STAT3 deficiency (Job syndrome)* — mechanism dominant_negative / decreased_activity, ruled out on JAK1 via `pathway_node`, code `opposes_required_action`. ChEMBL action types on the protein it was ruled out on: INHIBITOR; on the subject's own protein: none; the mechanism needs more_activity.
  > AD-HIES STAT3 deficiency (Job syndrome) needs STAT3 to do more. ChEMBL records this molecule as an inhibitor of Tyrosine-protein kinase JAK1, which lowers that protein. Because this protein helps produce the active form of the subject protein, that lowers what STAT3 does. That is the opposite of what this mechanism needs, so it is ruled out.
  - **Cause — legitimate: the drug treats a symptom rather than correcting the protein.** AD-HIES is caused by dominant-negative STAT3, so the catalog direction (needs more STAT3) is right and baricitinib, a JAK1 inhibitor, does lower STAT3 phosphorylation. The Phase 1 record is not an attempt to restore STAT3; it targets the eczema and inflammatory phenotype. The engine's refusal is therefore correct about the protein and wrong about the clinical intent, because the engine has no representation of treating a symptom. It is reported here as a false rejection against this ground truth, and it is not a direction-of-effect bug.

## Direction agreement

For each pair, whether the action the mechanism requires agrees with the molecule's recorded
ChEMBL action type on the subject's protein.

| Verdict | Pairs |
| --- | --- |
| `acts_on_another_protein_not_the_subject_protein` | 161 |
| `no_chembl_mechanism_record_at_all` | 53 |
| `no_required_action_derived` | 11 |
| `disagrees` | 1 |

## Where the recall comes from

Pair-level recall hides concentration. These are the diseases that contributed every recovered molecule:

| Disease | Molecules recovered |
| --- | --- |
| Cystic fibrosis | 10 |
| CD40 ligand (CD154) deficiency | 1 |
| WHIM (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome | 1 |

## Bridge mix of recovered molecules

| Bridge | Pairs recovered |
| --- | --- |
| `same_target` | 11 |
| `interaction_partner` | 1 |

| Direction verdict on the recovered row | Pairs |
| --- | --- |
| `unknown` | 12 |

## Coverage

| Outcome | Diseases |
| --- | --- |
| In the catalog | 604 |
| Eligible (at least one known molecule) | 35 |
| Evaluated (eligible and the request was served) | 32 |
| No ground truth (no known drug in either source) | 569 |

Reasons a disease is not in the evaluated set. The first rows are diseases with no ground truth; `discovery_request_failed` is a disease that *had* ground truth and could not be asked.

| Reason | Diseases |
| --- | --- |
| `no_known_drug_in_either_source` | 474 |
| `no_mondo_or_orphanet_cross_reference_to_match_on` | 73 |
| `no_gene_in_the_catalog` | 18 |
| `only_withdrawn_or_unknown_stage_drugs` | 4 |
| `discovery_request_failed` | 3 |

A disease that returns candidates but has no known drug is **not** a failure and is not counted as one. It is in the `no_ground_truth` row above.

## Per-disease results

| Disease | Gene | Mechanism | Known molecules | Recovered | Best rank | Ruled out |
| --- | --- | --- | --- | --- | --- | --- |
| AD STING-associated vasculopathy, infantile-onset (SAVI) | STING1 | unknown / unknown | 1 | 0 | - | 0 |
| AD-HIES STAT3 deficiency (Job syndrome) | STAT3 | dominant_negative / decreased_activity | 3 | 0 | - | 1 |
| ADA deficiency | ADA | loss_of_function / decreased_activity | 2 | 0 | - | 0 |
| APECED (APS-1), autoimmune polyendocrinopathy with candidiasis and ectodermal dystrophy | AIRE | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| AR STING-associated vasculopathy, infantile-onset (SAVI) | STING1 | gain_of_function / increased_activity | 1 | 0 | - | 0 |
| Ataxia–telangiectasia | ATM | unknown / unknown | 4 | 0 | - | 0 |
| Autoimmune lymphoproliferative syndrome (ALPS-SFAS) | FAS | loss_of_function / decreased_activity | 5 | 0 | - | 0 |
| BTK deficiency, X-linked agammaglobulinemia | BTK | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| Barth syndrome (3-methylglutaconic aciduria type II) | TAFAZZIN | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| CD40 ligand (CD154) deficiency | CD40LG | loss_of_function / decreased_activity | 6 | 1 | 2 | 0 |
| Comel–Netherton syndrome | SPINK5 | unknown / unknown | 6 | 0 | - | 0 |
| Cryopyrinopathy, (Muckle–Wells/CINCA/NOMID-like syndrome) | NLRP3 | unknown / unknown | 7 | 0 | - | 0 |
| Cystic fibrosis | CFTR | unknown / unknown | 128 | 10 | 1 | 0 |
| DIRA (deficiency of the interleukin-1 receptor antagonist) | IL1RN | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| DOCK8 deficiency | DOCK8 | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| DiGeorge/velocardiofacial syndrome Chromosome 22q11.2DS | TBX1 | unknown / unknown | 4 | 0 | - | 0 |
| G6PD deficiency class I | G6PD | loss_of_function / decreased_activity | 2 | 0 | - | 0 |
| GATA2 deficiency | GATA2 | loss_of_function / decreased_activity | 7 | 0 | - | 0 |
| Glycogen storage disease type 1b | SLC37A4 | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| IPEX, immune dysregulation, polyendocrinopathy, enteropathy X-linked | FOXP3 | loss_of_function / decreased_activity | 3 | 0 | - | 0 |
| IRF8 deficiency | IRF8 | loss_of_function / decreased_activity | 5 | 0 | - | 0 |
| Leukocyte adhesion deficiency type 1 (LAD1) | ITGB2 | loss_of_function / decreased_activity | 6 | 0 | - | 0 |
| Leukocyte adhesion deficiency type 2 (LAD2) | SLC35C1 | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| Muckle–Wells syndrome | NLRP3 | gain_of_function / increased_activity | 3 | 0 | - | 0 |
| Neonatal-onset multisystem inflammatory disease (NOMID)/chronic infantile neurological cutaneous and articular syndrome (CINCA) | NLRP3 | gain_of_function / increased_activity | 3 | 0 | - | 0 |
| Nijmegen breakage syndrome | NBN | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| Retinal dystrophy, optic nerve edema, splenomegaly, anhidrosis, and headache (ROSAH) | ALPK1 | unknown / unknown | 1 | 0 | - | 0 |
| TNF receptor–associated periodic syndrome (TRAPS) | TNFRSF1A | unknown / unknown | 1 | 0 | - | 0 |
| VEXAS (vacuoles, E1 enzyme, X-linked, autoinflammatory, somatic) syndrome | UBA1 | gain_of_function / increased_activity | 7 | 0 | - | 0 |
| WHIM (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome | CXCR4 | gain_of_function / increased_activity | 1 | 1 | 8 | 0 |
| Wiskott–Aldrich syndrome (WAS LOF) | WAS | loss_of_function / decreased_activity | 9 | 0 | - | 0 |
| γc deficiency (common gamma chain SCID, CD132 deficiency) | IL2RG | loss_of_function / decreased_activity | 3 | 0 | - | 0 |

## The error this measurement found in our own safety filter

The most valuable result of this work is not a recall figure. It is that the measurement caught the direction-of-effect filter rejecting the one drug WHIM syndrome is actually treated with.

**What the engine got wrong.** WHIM syndrome is a CXCR4 gain of function, so the engine correctly derived that CXCR4 must do less. Plerixafor (CHEMBL18442) blocks CXCR4 - that is its entire pharmacology and the reason it is given for WHIM. ChEMBL nonetheless files its single mechanism record on P61073 with `action_type` PARTIAL AGONIST. The filter read that one field, concluded the molecule raises CXCR4, and moved it to `ruled_out` with a fluent and completely wrong explanation. A falsely rejected drug is the dangerous error, because the user never sees it offered and the refusal reads as authoritative.

**How the measurement caught it.** Nothing in the engine or in the controls could have found this. It took holding out the direct disease-to-drug edge for every disease with a known drug and then checking whether the engine refused a drug that is really used. One of 226 pairs came back refused rather than merely missing, and opening that one case is what exposed the filter's single point of failure.

**The fix, which is not a special case.** A rejection may no longer rest on an `action_type` that another record of the same molecule against the same protein contradicts. ChEMBL holds four measured activities of plerixafor against P61073 and all four are IC50 - inhibition measurements. One field says raise, four measurements say lower, so the verdict is now `unknown`, the reason names both records, and the molecule is offered carrying the 'may push the wrong way' caveat instead of being hidden. A single-field direction call is insufficient by design: `rules.py` will not issue `opposes` on a contradicted field for any molecule, and nothing about plerixafor, CXCR4 or WHIM is named anywhere in the engine. Where nothing contradicts the field the filter is exactly as strict as before - control 2 still rejects 20 of 20 BTK-lowering molecules for BTK loss of function.

**It is now control 4.** `lab/experiments/run_discovery_controls.py` asserts that plerixafor, resolved by ChEMBL id and InChIKey, does not appear in `ruled_out` for WHIM syndrome, and that the filter still rejects elsewhere for the same subject. The bug cannot come back silently.

## Threats to validity

- The cause classification rests on ChEMBL mechanism records. A drug whose real target is known to pharmacology but unrecorded in ChEMBL is classified by what ChEMBL holds, not by what is true, so the 'no path to the subject protein' bucket is an upper bound on how legitimately silent the engine is.
- The no-path bucket is read as 'the drug is aimed elsewhere' from the recurring targets its own records name. Two members of it are not symptom drugs and are real engine gaps: ataluren, whose ChEMBL target is the 80S ribosome because it is a nonsense-readthrough agent that no protein-to-protein bridge can reach, and amiloride and idrevloride, which act on ENaC, the channel that physiologically counterbalances CFTR. ENaC is not a curated IntAct or STRING physical partner of CFTR, so the interaction bridge cannot see a relationship that is functional rather than physical.
- The scope rule was fixed before the stratified number was computed, but it was written by the same person who then measured it. It reads only ChEMBL molecule_type and mechanism target organism, both source fields, and is reproducible from `classify_discovery_misses.py` without reference to any engine output.
- Bridge-reachability was considered as a scope rule and rejected as circular: it would have put the denominator at about 12 pairs and produced a recall near 90% that measured nothing but the definition. The in-scope figure here is deliberately the harsher of the two.
- Ground truth comes from Open Targets only. ChEMBL drug_indication is retrievable by molecule in this deployment, not by disease, so it corroborates pairs rather than creating them; a molecule ChEMBL records for a disease that Open Targets does not is absent from the ground truth entirely.
- Source B is target-anchored: it only finds a known drug that acts on the disease gene's own protein. That structurally favours the same_target bridge and cannot test whether the pathway or structural bridges recover drugs they alone could reach. Source A is disease-anchored and does not have this bias, but returns far fewer rows.
- Indication matching is an exact MONDO or ORPHA identifier match. ChEMBL and Open Targets often file a rare disease under a parent term (leniolisib sits under 'inborn error of immunity'), and every such pair is missed by this ground truth, so the evaluable set is a lower bound on what exists.
- A molecule for which ChEMBL records no mechanism cannot appear in either list, so pairs like an immunoglobulin replacement are counted as missed although the engine never had a record to find them with. They are reported separately as outside the engine's universe.
- Recall here is recovery of a molecule already known to be used. It says nothing about whether the candidates the engine ranks above it are good hypotheses.
- A disease with no stated mechanism gets no required action, so nothing is ruled out on direction for it. Those diseases cannot produce a false rejection, which flatters the safety figure; the mechanism-confidence mix is reported beside it.
- Both the API and the engine cache for fifteen minutes, so `wall_seconds` here is not a cold time. The first cold run of this script took 1219 s for the same 1342 requests; a warm re-run takes about 9 s. Accuracy figures are identical in both and are unaffected.
- The sources are live. A source changing its records changes these numbers without anything failing loudly.
- The ground truth itself can be wrong. Open Targets records a Phase 1 trial as a drug for a disease without saying whether the intent was to correct the protein or to damp a symptom, and one of the two false rejections turned out to be exactly that distinction. A pair in this ground truth is a record that a molecule is being tried, not a record that it works.
- The runner was itself wrong once: an earlier version read `direction_needed` as absent only when null, while the endpoint writes the string "none", which mislabelled 11 pairs as direction disagreements. The figure in the direction-agreement table changed when that was fixed; recall and false rejection did not. Both full runs produced identical recall and false-rejection counts twenty minutes apart.

## Reproducing it

```bash
lab/.venv/bin/python lab/experiments/run_discovery_accuracy.py
```

Thresholds were declared in the runner before any result was seen: top-10 and top-25. No engine threshold, ranking key or rule was changed by this work.
