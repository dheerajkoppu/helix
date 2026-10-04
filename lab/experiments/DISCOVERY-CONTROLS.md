# Discovery controls

Run 2026-10-04T01:08:36Z against the live API. 3 of 3 passed.

These three calls are the product's own evidence that the direction-of-effect filter works: one
recovery with the answer held out, one refusal, one upstream target. Every expected molecule is
resolved to a ChEMBL id and an InChIKey through a separate endpoint before any candidate row is
matched, so nothing passes on a name.

Wall time is how long this run's call took. The engine keeps assembled responses for fifteen minutes,
so a repeat call is a few milliseconds; each control's notes state whether the call was served from
that cache and how long the engine took to build the response it served.

| Control | Result | Candidates | Ruled out | Sources | Wall time |
| --- | --- | --- | --- | --- | --- |
| Held-out positive: a molecule studied for APDS, recovered without the edge that names it | PASS | 24 | 0 | 7/8 | 2.9 ms |
| Negative: no molecule that lowers BTK is offered for BTK loss of function | PASS | 4 | 33 | 8/8 | 2.2 ms |
| Upstream positive: a JAK inhibitor reached through the pathway, not through STAT1 | PASS | 23 | 4 | 6/6 | 2.3 ms |

## Held-out positive: a molecule studied for APDS, recovered without the edge that names it

- Subject: Activated p110δ syndrome (APDS), PIK3CD, gain of function
- Request: `/discovery/candidates?disease=activated-p110-delta-syndrome-pik3cd&exclude_direct=true`
- Expected: Leniolisib among the top 10 candidates, direction 'matches', no withheld edge in the chain
- Result: **PASS** — Leniolisib (CHEMBL3643413, MWKYMZXCGYXLPL-ZDUSSCGKSA-N) came back at rank 4 of 24 through a same_target bridge with the direction check 'matches', while 18 direct disease-to-molecule edges were withheld, 1 of them naming this molecule.

Chain for Leniolisib (CHEMBL3643413):

1. PIK3CD encodes UniProt O00329, Phosphatidylinositol 4,5-bisphosphate 3-kinase catalytic subunit delta isoform. — uniprot O00329
1. ChEMBL records Leniolisib as an inhibitor of Phosphatidylinositol 4,5-bisphosphate 3-kinase catalytic subunit delta isoform, described as "PI3-kinase p110-delta subunit inhibitor". — chembl mechanism:8305
1. ChEMBL holds 6 measured activities of Leniolisib against Phosphatidylinositol 4,5-bisphosphate 3-kinase catalytic subunit delta isoform, median pChEMBL 7.96. — chembl activity:18320214

What was measured:

- Identity resolved through GET /compounds before any matching: CHEMBL3643413 is LENIOLISIB (MWKYMZXCGYXLPL-ZDUSSCGKSA-N), approved 2023.
- The brief's CHEMBL4650319 is MOBOCERTINIB, a different molecule; CHEMBL3989909 is LENIOLISIB PHOSPHATE, the salt form. Both are accepted as leniolisib identifiers.
- Bridge same_target, 3 steps, 3 cited records, from_disease=None.
- The cited mechanism record is confirmed independently: GET /proteins/O00329/compounds returns mechanism 8305 (INHIBITOR) for the same molecule.
- The withheld edge is a real one: in full mode the same molecule's chain cites drug_indication:147079 ('studied or used for' the disease), and that step is gone from the held-out chain while the molecule still reaches rank 4.
- Full mode withholds 1 edge(s) against 18 in held-out mode, and ranks it 4 of 24 (3.2 ms).
- gene=PIK3CD&exclude_direct=true recovers it at rank 4 of 24 (2.7 ms).
- Bridges that fired: same_target (12 ranked, 0 refused), interaction_partner (9 ranked, 0 refused). pathway_node is empty: Reactome records 27 reactions for this protein, but none of them names a modification of it, so no direction can be read. structural_analogue is partial: No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment. mechanism_class is empty: ChEMBL records no molecule with an action on the proteins of those diseases.
- Sources that did not answer ok: open_targets: empty.
- Server-side elapsed 536.8 ms, from_cache=True; wall time 2.9 ms.

## Negative: no molecule that lowers BTK is offered for BTK loss of function

- Subject: BTK deficiency, X-linked agammaglobulinemia, loss of function
- Request: `/discovery/candidates?disease=btk-deficiency-x-linked-agammaglobulinemia`
- Expected: Every BTK inhibitor absent from candidates and present in ruled_out with verdict 'opposes'
- Result: **PASS** — None of the 20 molecules ChEMBL records as lowering BTK is offered as a candidate. Ibrutinib (CHEMBL1873475) sits in ruled_out with verdict 'opposes' and a plain reason, and so do 20 of those 20 molecules in total, within 33 ruled-out rows.

Chain for Ibrutinib (CHEMBL1873475):

1. BTK encodes Tyrosine-protein kinase BTK (UniProt Q06187). — uniprot Q06187
1. Ibrutinib: Tyrosine-protein kinase BTK inhibitor (INHIBITOR) — chembl mechanism:2242
1. Ibrutinib is recorded for neoplasm. — chembl drug_indication:23286
1. IC50 = 0.72 nM — chembl activity:16286650
1. BTK deficiency, X-linked agammaglobulinemia needs BTK to do more. ChEMBL records this molecule as an inhibitor of Tyrosine-protein kinase BTK, which lowers that protein. Because this is the protein the disease's gene encodes, that lowers what BTK does. That is the opposite of what this mechanism needs, so it is ruled out. — no record cited

What was measured:

- GET /proteins/Q06187/compounds holds 24 ChEMBL mechanism records against BTK, 24 of which lower it, covering 20 distinct molecules. Those 20 molecules, resolved to ChEMBL ids and InChIKeys, are the set this control checks; no name is written into the runner.
- Ibrutinib resolved from ChEMBL's own records to CHEMBL1873475 / XYFPWWZEPKGCCK-GOSISDBHSA-N, action INHIBITOR, confirmed back through GET /compounds/XYFPWWZEPKGCCK-GOSISDBHSA-N as IBRUTINIB.
- Of those 20 molecules, 20 appear in ruled_out and 20 of them carry verdict 'opposes'. 0 are in neither list, so the user never sees them refused: none.
- Bridges that fired: same_target (0 ranked, 20 refused), pathway_node (1 ranked, 13 refused), interaction_partner (3 ranked, 0 refused). structural_analogue is empty: No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment. mechanism_class is empty: ChEMBL records no molecule with an action on the proteins of those diseases.
- Server-side elapsed 208.5 ms, from_cache=True; wall time 2.2 ms.

## Upstream positive: a JAK inhibitor reached through the pathway, not through STAT1

- Subject: STAT1 GOF, STAT1, gain of function
- Request: `/discovery/candidates?disease=stat1-gof`
- Expected: A JAK-family inhibitor as a pathway_node candidate on a JAK protein, direction 'matches'
- Result: **PASS** — Baricitinib (CHEMBL2105759) came back at rank 2 of 23 as a pathway_node candidate on JAK1, not on STAT1, with the direction check 'matches'.

Chain for Baricitinib (CHEMBL2105759):

1. Reactome records the reaction "IFNL1:p-Y343,Y517-IFNLR1:p-JAK1:IL10RB:p-TYK2:STAT1 phosphorylates STAT1, STAT2, STAT3, STAT4 and STAT5" (R-HSA-8986985), which produces the modified form of STAT1, and names it in the entity that catalyses the reaction: JAK1. So JAK1 is upstream of STAT1. — reactome R-HSA-8986985
1. ChEMBL records Baricitinib as an inhibitor of Tyrosine-protein kinase JAK1, described as "Tyrosine-protein kinase JAK1 inhibitor". — chembl mechanism:5293

What was measured:

- JAK family resolved through GET /genes: {'JAK1': 'P23458', 'JAK3': 'P52333', 'TYK2': 'P29597'}.
- Accessions that could not be resolved independently, so rows aimed at them are not counted by this control: JAK2 (HTTP 200, in_catalog=False, ['uniprot: unavailable']).
- Expected molecules resolved from ChEMBL mechanism records on the JAK proteins: baricitinib=CHEMBL2105759/XUZMWHLSFXCVMG-UHFFFAOYSA-N, ruxolitinib=CHEMBL1789941/HFNKQEVNSGCOJV-OAHLLOKOSA-N, tofacitinib=CHEMBL221959/UJLAWZDWDVHWOW-YPMHNXCESA-N
- Winning row: rank 2, target JAK1, 2 steps, 2 cited records.
- 8 candidate rows aim at a JAK-family protein whose accession this runner resolved itself: [(1, 'Abrocitinib', 'JAK1'), (2, 'Baricitinib', 'JAK1'), (4, 'Cravacitinib', 'TYK2'), (6, 'Filgotinib', 'JAK1'), (8, 'Filgotinib', 'TYK2'), (9, 'Momelotinib', 'JAK1'), (11, 'Ruxolitinib', 'TYK2'), (12, 'Upadacitinib', 'TYK2')]
- Rows the engine labels with an unresolved symbol, reported but not counted because the label is the engine's own: [(3, 'Baricitinib', 'JAK2'), (5, 'Fedratinib', 'JAK2'), (7, 'Filgotinib', 'JAK2'), (10, 'Momelotinib', 'JAK2')].
- Resolved but absent from the candidate list: ['tofacitinib']. The control needs only one, but the per-bridge caps mean a JAK molecule can be cut.
- Candidates aimed at STAT1 itself: none.
- Bridges that fired: pathway_node (15 ranked, 3 refused), interaction_partner (6 ranked, 0 refused), mechanism_class (5 ranked, 1 refused). same_target is empty: ChEMBL records no molecule with an action on this protein. structural_analogue is empty: No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment.
- Server-side elapsed 50.6 ms, from_cache=True; wall time 2.3 ms.

## What a pass here does not prove

- Three subjects are three subjects. Each control shows the rule behaving correctly once, on one disease, against today's records. It is not a measure of how often the engine is right.
- The engine's ranking is checked for position, not for quality. Nothing here tests whether a higher-ranked molecule is a better hypothesis than a lower-ranked one.
- positive_held_out: the pathway_node bridge contributed nothing (empty) — Reactome records 27 reactions for this protein, but none of them names a modification of it, so no direction can be read.
- positive_held_out: the structural_analogue bridge ran partial and still produced 3 ranked row(s) — No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment.
- positive_held_out: the mechanism_class bridge contributed nothing (empty) — ChEMBL records no molecule with an action on the proteins of those diseases.
- positive_held_out: Open Targets Platform answered 'empty', so whatever it holds did not reach this result.
- negative_direction_filter: the structural_analogue bridge contributed nothing (empty) — No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment.
- negative_direction_filter: the mechanism_class bridge contributed nothing (empty) — ChEMBL records no molecule with an action on the proteins of those diseases.
- positive_upstream_node: the same_target bridge contributed nothing (empty) — ChEMBL records no molecule with an action on this protein.
- positive_upstream_node: the structural_analogue bridge contributed nothing (empty) — No fold-similarity source is available in this deployment, so the chain uses shared chemistry instead of a measured fold alignment.

## How to re-run

```
api/.venv/bin/python lab/experiments/run_discovery_controls.py
```

The result is served by `GET /api/v1/discovery/controls`.
