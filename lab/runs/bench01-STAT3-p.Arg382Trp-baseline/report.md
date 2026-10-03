## Question
What molecular mechanism best explains loss of function of STAT3 p.Arg382Trp (R382W), and which single test should check it? [E1][E2]

## Evidence
ClinVar lists R382W as pathogenic with a disease note calling it gain of function [E1]. UniProt annotates the same change as loss of function with reduced DNA-binding ability [E2]. InterPro places residue 382 in the STAT DNA-binding domain, residues 326-464 [E9]. AlphaMissense scores R382W 0.9966 [E3], ScoreCons conservation at the residue is 0.974 [E4], and EVE classes it pathogenic [E5]. Four experimental structures observe residue 382, and all carry arginine [E6]. A 2021 study found most reported AD-HIES variants are dominant negative, yet only six of 135 in-frame variants had been tested [E12]. Gaps: no direct DNA-binding measurement for R382W [G1], no record of which residues contact DNA [G2], and the gain-of-function label conflicts with UniProt [G3].

## Agent-generated hypotheses
H1 (nucleic-acid binding, rank 1) proposes that R382W removes a DNA-contacting arginine [E2][E9]. H2 (stability, rank 2) proposes that R382W destabilises the DNA-binding domain fold [E4][E5]. H3 (protein interaction, rank 3) proposes dominant-negative dimer formation with wild-type STAT3 [E8][E12].

## Tests considered and the choice
Three candidates were recorded: T1, a FoldX stability test, runnable now with no approval; T2, a structural-context test, which ProtVar already reports as having no interface [T2]; and T3, a structure comparison, which cannot run now and needs approval [T3]. T1 was chosen because it separates H2 from H1 at no compute cost [T1].

## Result
FoldX predicts a folding free-energy change of +1.96 kcal/mol for R382W, below the 2.0 kcal/mol destabilising threshold, at residue pLDDT 88.0 [T1]. At the same residue, R382Q is predicted at +2.23 kcal/mol [T1].

## Updated decision
H1 remains the favoured hypothesis, so the decision is unchanged [T1]. H2 is weakened because the predicted change is marginal and R382Q is more destabilising yet also pathogenic [T1][E10]. H3 is unchanged because this test does not measure dimer contact [T1].

## Uncertainty and validation still needed
FoldX on a predicted model carries errors near 1 kcal/mol, so the neutral call is marginal [T1]. No DNA-binding or dimerisation measurement was run, and the direction conflict [G3] is unresolved. The H1 ranking rests on the UniProt annotation [E2].

## Next experiment
Run the structure comparison T3 once a provider is available and approval is granted, to check local geometry at the DNA-facing surface [T3]. A direct DNA-binding assay in the laboratory would decide H1 [G1].
