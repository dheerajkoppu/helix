# Discovery accuracy on held-out known drugs

Run 2026-10-04T02:25:52Z. 8 disease-molecule pairs over 5 diseases, from a catalog of 40 diseases and 511 genes. 85 API requests.

Ground truth is the disease-to-molecule records that `exclude_direct=true` withholds, so the engine is forbidden to use them when it is then asked. Every molecule was resolved to a ChEMBL id and an InChIKey through `GET /compounds/{id}` before any row was matched; nothing is matched on a name.

## The numbers

| Metric | Value | n |
| --- | --- | --- |
| Recall, pairs recovered as a candidate | **0 of 8** (0.0%) | 8 pairs |
| Recall, diseases with at least one known drug recovered | **0 of 5** (0.0%) | 5 diseases |
| Median rank of a recovered molecule | None | 0 recovered |
| Recovered within the top 10 | 0 (0.0%) | 8 pairs |
| Recovered within the top 25 | 0 (0.0%) | 8 pairs |
| **False rejection rate** (a used molecule in `ruled_out`) | **1 of 8** (12.5%) | 8 pairs, 1 diseases |
| Missed entirely | 7 | of which 7 have no ChEMBL mechanism on the subject's protein |

Rank range of recovered molecules: None.

## False rejections, every case

- **BARICITINIB** (CHEMBL2105759, PHASE_1) for *AD-HIES STAT3 deficiency (Job syndrome)* — mechanism dominant_negative / decreased_activity, ruled out on JAK1 via `pathway_node`, code `opposes_required_action`. ChEMBL action types on the subject's protein: none; the mechanism needs more_activity.
  > AD-HIES STAT3 deficiency (Job syndrome) needs STAT3 to do more. ChEMBL records this molecule as an inhibitor of Tyrosine-protein kinase JAK1, which lowers that protein. Because this protein helps produce the active form of the subject protein, that lowers what STAT3 does. That is the opposite of what this mechanism needs, so it is ruled out.

## Direction agreement

For each pair, whether the action the mechanism requires agrees with the molecule's recorded
ChEMBL action type on the subject's protein.

| Verdict | Pairs |
| --- | --- |
| `no_chembl_mechanism_on_the_subject_protein` | 8 |

## Bridge mix of recovered molecules

| Bridge | Pairs recovered |
| --- | --- |

| Direction verdict on the recovered row | Pairs |
| --- | --- |

## Coverage

| Outcome | Diseases |
| --- | --- |
| Evaluated (at least one known molecule) | 5 |
| No ground truth (no known drug in either source) | 35 |

Reasons a disease could not be evaluated:

| Reason | Diseases |
| --- | --- |
| `no_known_drug_in_either_source` | 29 |
| `no_mondo_or_orphanet_cross_reference_to_match_on` | 4 |
| `no_gene_in_the_catalog` | 2 |

A disease that returns candidates but has no known drug is **not** a failure and is not counted as one. It is in the `no_ground_truth` row above.

## Per-disease results

| Disease | Gene | Mechanism | Known molecules | Recovered | Best rank | Ruled out |
| --- | --- | --- | --- | --- | --- | --- |
| AD STING-associated vasculopathy, infantile-onset (SAVI) | STING1 | unknown / unknown | 1 | 0 | - | 0 |
| AD-HIES STAT3 deficiency (Job syndrome) | STAT3 | dominant_negative / decreased_activity | 3 | 0 | - | 1 |
| ADA deficiency | ADA | loss_of_function / decreased_activity | 2 | 0 | - | 0 |
| APECED (APS-1), autoimmune polyendocrinopathy with candidiasis and ectodermal dystrophy | AIRE | loss_of_function / decreased_activity | 1 | 0 | - | 0 |
| AR STING-associated vasculopathy, infantile-onset (SAVI) | STING1 | gain_of_function / increased_activity | 1 | 0 | - | 0 |

## Threats to validity

- Ground truth comes from Open Targets only. ChEMBL drug_indication is retrievable by molecule in this deployment, not by disease, so it corroborates pairs rather than creating them; a molecule ChEMBL records for a disease that Open Targets does not is absent from the ground truth entirely.
- Source B is target-anchored: it only finds a known drug that acts on the disease gene's own protein. That structurally favours the same_target bridge and cannot test whether the pathway or structural bridges recover drugs they alone could reach. Source A is disease-anchored and does not have this bias, but returns far fewer rows.
- Indication matching is an exact MONDO or ORPHA identifier match. ChEMBL and Open Targets often file a rare disease under a parent term (leniolisib sits under 'inborn error of immunity'), and every such pair is missed by this ground truth, so the evaluable set is a lower bound on what exists.
- A molecule for which ChEMBL records no mechanism cannot appear in either list, so pairs like an immunoglobulin replacement are counted as missed although the engine never had a record to find them with. They are reported separately as outside the engine's universe.
- Recall here is recovery of a molecule already known to be used. It says nothing about whether the candidates the engine ranks above it are good hypotheses.
- A disease with no stated mechanism gets no required action, so nothing is ruled out on direction for it. Those diseases cannot produce a false rejection, which flatters the safety figure; the mechanism-confidence mix is reported beside it.
- Both the API and the engine cache for fifteen minutes, so the wall times here are not cold times. Accuracy figures are unaffected.
- The sources are live. A source changing its records changes these numbers without anything failing loudly.

## Reproducing it

```bash
lab/.venv/bin/python lab/experiments/run_discovery_accuracy.py
```

Thresholds were declared in the runner before any result was seen: top-10 and top-25. No engine threshold, ranking key or rule was changed by this work.
