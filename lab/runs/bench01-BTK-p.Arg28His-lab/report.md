## Question
What molecular mechanism best explains the loss of function of BTK p.Arg28His (Q06187), and which single computational test checks it?

## Evidence
ClinVar lists the variant as pathogenic, with multiple submitters and no conflicts [E1]. UniProt records it as a natural variant causing X-linked agammaglobulinemia [E2] and annotates residue 28 as an inositol phosphate binding site [E4]. A 2024 JBC study reports that R28H impairs BTK activation by preventing PH-TH dimerization [E5]. A 2013 MM/PBSA study classed R28C/H as binding-site mutations rather than folding mutations [E6]. Computational predictors score the variant as damaging: AlphaMissense 0.9978 [E10], popEVE -5.634 [E13] and conservation 0.962 [E12]. These are predictions, not experimental measurements. Gaps remain: no measured binding change for R28H [G1], no folding or stability data [G2], one activation study without replication [G3], and no functional assay covering residue 28 [G5].

## Agent-generated hypotheses
- H1 (ligand binding): R28 contacts the inositol phosphate head group, so loss of the charge weakens membrane recruitment [H1]. Favoured before the test.
- H2 (protein interaction): R28H disrupts PH-TH dimerization [H2]. Its direct support is E5.
- H3 (stability/folding): R28H destabilises the PH-domain fold [H3].

## Tests considered and the choice
The planner ranked T1 (ligand contact) above T2 (stability effect) and T3 (structural context) on expected learning and feasibility [T1]. T2 and T3 were not run. Safety cleared T1 with no human approval needed [T1].

## Result
T1 found residue 28 within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures. The two inositol phosphate ligands contact it directly: 4IP at 2.75 Å in 1BWN [E21] and 4PT at 2.58 Å in 2Z0P [E19]. Negative-control ligands never contact residue 28 [T1]. This is a crystal-contact observation, not a binding measurement for R28H [T1].

## Updated decision
H1 was favoured before the test and remains favoured after it, so the decision did not change [T1]. T1 gives H1 direct structural support [T1]. H2 remains a serious rival because E5 reports dimerization loss for this exact substitution [E5]. H3 is unchanged [H3]. No reopening was needed: the test completed, H1 was not refuted, and the favoured hypothesis did not change [T1].

## Uncertainty and validation still needed
The AlphaMissense, popEVE and conservation scores are computational predictions and are not validated [E10, E12, E13]. Nothing here is validated experimentally: there is no measured binding affinity for R28H [G1], no stability data [G2] and only one unreplicated activation study [G3]. Most of the 32 contacts come from synthetic ligands, so the inositol-specific evidence rests on 4IP and 4PT [T1]. The refuting threshold for H1 (binding ΔΔG under 0.5 kcal/mol) has not been checked [H1].

## Next experiment
Compute the binding ΔΔG for R28H versus wild type with Ins(1,3,4,5)P4 or the 4IP/4PT analogue on 1B55 and 1BWN, with R28C as a control [G1]. This would confirm or overturn H1. These are computational predictions only; no clinical or treatment implications are drawn.
