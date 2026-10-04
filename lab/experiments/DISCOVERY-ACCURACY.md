# Discovery accuracy on held-out known drugs

Run 2026-10-04T02:53:25Z. 226 disease-molecule pairs over 32 diseases, from a catalog of 604 diseases and 511 genes. 1342 API requests.

Ground truth is the disease-to-molecule records that `exclude_direct=true` withholds, so the engine is forbidden to use them when it is then asked. Every molecule was resolved to a ChEMBL id and an InChIKey through `GET /compounds/{id}` before any row was matched; nothing is matched on a name.

## The numbers

| Metric | Value | n |
| --- | --- | --- |
| Recall, pairs recovered as a candidate | **11 of 226** (4.9%) | 226 pairs |
| Recall, diseases with at least one known drug recovered | **2 of 32** (6.2%) | 32 diseases |
| Median rank of a recovered molecule | 5 | 11 recovered |
| Recovered within the top 10 | 10 (4.4%) | 226 pairs |
| Recovered within the top 25 | 11 (4.9%) | 226 pairs |
| **False rejection rate** (a used molecule in `ruled_out`) | **2 of 226** (0.9%) | 226 pairs, 2 diseases |
| Missed entirely | 213 | of which 53 have no ChEMBL mechanism record anywhere |

Rank range of recovered molecules: [1, 12].

The engine only ever considers a molecule ChEMBL records a mechanism for. 173 of 226 pairs are inside that universe. Restricted to those, the same figures are:

| Metric | Value | n |
| --- | --- | --- |
| Recall | 11 of 173 (6.4%) | 173 pairs |
| False rejection rate | 2 of 173 (1.2%) | 173 pairs |
| Missed | 160 | 173 pairs |

The unrestricted figure is the honest headline, because a user asking the engine for a disease treated with an immunoglobulin gets nothing useful back whatever the reason. The restricted figure is what the engine's own stated scope can be held to.

## What the numbers say

- **Recall is low and concentrated.** 11 of 226 pairs came back, and 10 of those 11 are for one disease (Cystic fibrosis). On 32 diseases the engine recovered a known drug for 2.
- **When it does recover a molecule, the rank is usable.** Median rank 5, range [1, 12], 10 of the 11 inside the top 10. The failure is finding the molecule at all, not ordering it.
- **Not one recovered molecule carried a `matches` direction verdict.** All 11 came back as `unknown`, the rank below every match, carrying the caveat 'may push the wrong way'. The engine found these drugs but could not say they push the right way.
- **`pathway_node`, `structural_analogue`, `mechanism_class` recovered nothing.** Every recovery came through `same_target` or `interaction_partner`. Part of this is the target-anchored ground truth, which can only contain drugs acting on the disease's own protein; but `pathway_node` did produce the one false rejection, so it was running.
- **160 pairs were missed with a ChEMBL mechanism record in hand** — the molecule exists in the engine's universe and still appeared in neither `candidates` nor `ruled_out`. Per-bridge caps and the requirement that the mechanism sit on the subject's own protein or a readable pathway node are the places to look.
- **The safety metric is the good one.** 2 false rejections in 226 pairs, and only one of the two is a direction error rather than a drug aimed at a symptom. That one matters a great deal and is written up below.
- **The control subject is not in this set.** APDS, the held-out positive in `DISCOVERY-CONTROLS.md`, has no Open Targets disease node and ChEMBL files leniolisib under a parent term, so no ground-truth pair exists for it under exact identifier matching. The three controls and this experiment do not overlap on a single subject.

## False rejections, every case

Each one was opened individually. A drug that treats a symptom rather than correcting the protein is a legitimate refusal and is labelled as such; a refusal of a drug that does correct the protein is an error and is labelled as such.

- **BARICITINIB** (CHEMBL2105759, PHASE_1) for *AD-HIES STAT3 deficiency (Job syndrome)* — mechanism dominant_negative / decreased_activity, ruled out on JAK1 via `pathway_node`, code `opposes_required_action`. ChEMBL action types on the protein it was ruled out on: INHIBITOR; on the subject's own protein: none; the mechanism needs more_activity.
  > AD-HIES STAT3 deficiency (Job syndrome) needs STAT3 to do more. ChEMBL records this molecule as an inhibitor of Tyrosine-protein kinase JAK1, which lowers that protein. Because this protein helps produce the active form of the subject protein, that lowers what STAT3 does. That is the opposite of what this mechanism needs, so it is ruled out.
  - **Cause — legitimate: the drug treats a symptom rather than correcting the protein.** AD-HIES is caused by dominant-negative STAT3, so the catalog direction (needs more STAT3) is right and baricitinib, a JAK1 inhibitor, does lower STAT3 phosphorylation. The Phase 1 record is not an attempt to restore STAT3; it targets the eczema and inflammatory phenotype. The engine's refusal is therefore correct about the protein and wrong about the clinical intent, because the engine has no representation of treating a symptom. It is reported here as a false rejection against this ground truth, and it is not a direction-of-effect bug.
- **PLERIXAFOR** (CHEMBL18442, PHASE_1_2) for *WHIM (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome* — mechanism gain_of_function / increased_activity, ruled out on CXCR4 via `same_target`, code `opposes_required_action`. ChEMBL action types on the protein it was ruled out on: PARTIAL AGONIST; on the subject's own protein: PARTIAL AGONIST; the mechanism needs less_activity.
  > WHIM (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome needs CXCR4 to do less. ChEMBL records this molecule as a partial agonist of C-X-C chemokine receptor type 4, which raises that protein. Because this is the protein the disease's gene encodes, that raises what CXCR4 does. That is the opposite of what this mechanism needs, so it is ruled out.
  - **Cause — a real direction-of-effect error, caused by one upstream field.** Plerixafor is the CXCR4 blocker used to correct the CXCR4 gain of function that causes WHIM; blocking CXCR4 is its entire pharmacology. ChEMBL nonetheless records its single mechanism on P61073 with action_type PARTIAL AGONIST (mechanism_of_action 'C-X-C chemokine receptor type 4 partial agonist'), confirmed through GET /compounds/CHEMBL18442. The engine reads direction from action_type alone, so it concluded the molecule raises CXCR4 and ruled it out against a mechanism that needs less. The rule fired correctly on a record that is wrong for this purpose. This is the most serious result in this experiment: it is the one disease in the evaluated set whose own specific drug the engine refuses, and no amount of care in the rule would catch it, because the rule has exactly one input and that input disagrees with the pharmacology.

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

## Bridge mix of recovered molecules

| Bridge | Pairs recovered |
| --- | --- |
| `same_target` | 10 |
| `interaction_partner` | 1 |

| Direction verdict on the recovered row | Pairs |
| --- | --- |
| `unknown` | 11 |

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
| WHIM (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome | CXCR4 | gain_of_function / increased_activity | 1 | 0 | - | 1 |
| Wiskott–Aldrich syndrome (WAS LOF) | WAS | loss_of_function / decreased_activity | 9 | 0 | - | 0 |
| γc deficiency (common gamma chain SCID, CD132 deficiency) | IL2RG | loss_of_function / decreased_activity | 3 | 0 | - | 0 |

## Threats to validity

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
