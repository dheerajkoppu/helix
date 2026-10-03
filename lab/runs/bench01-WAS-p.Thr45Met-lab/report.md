## Question
Which molecular mechanism best explains the loss of function of WAS p.Thr45Met (UniProt P42768), and which targeted computational tests check it? [E2] [G1]

## Evidence
Residue 45 lies in the WH1/EVH1 domain annotated by UniProt and InterPro [E5] [E6]. ClinVar lists the change as pathogenic with multiple submitters [E1], and UniProt records it as a natural variant in WAS-related disorder [E2]. gnomAD observed no occurrences of this allele [E3]. A literature report describes the change in an exon 2 X-linked thrombocytopenia family [E14]. No retrieved study measured WASp level, folding, or WIP binding for T45M [G4] [G5]. No functional assay covers residue 45 [G1], and no experimental structure carries the variant [G2].

## Agent-generated hypotheses
H1 (protein_interaction, rank 1) proposes that T45M weakens WASp–WIP binding [H1]. H2 (stability_folding, rank 2) proposes that T45M destabilises the fold and lowers WASp levels [H2].

## Tests considered and the choice
Round 1: T1 (stability) was chosen. T2 (structural context) was rejected, as was T3 (structure comparison, which needed approval and 120 s) and T4 (ligand contact, which could not run) [T1] [T3] [T4].
Round 2, after H1 was reopened: T2 was chosen. T3 and T4 were rejected for the same reasons as before [T2].

## Result
T1 gave a FoldX ΔΔG of +3.56 kcal/mol for T45M on the AlphaFold model, above the 2.0 kcal/mol destabilising threshold, at residue pLDDT 96.62 [T1] [E18]. The within-site control T45R gave +7.43 kcal/mol [E19]. T2 found residue 45 in two predicted pockets with buriedness 0.74 and 0.79 [E20] [E21], in no P2Rank pocket [E22], and in no predicted interface [T2].

## Updated decision
Round 1: H1 was favoured before T1 and H2 after, so the decision changed [D53]. Round 2: H2 was favoured before and after T2, so the decision did not change. T2 weakened H1 without refuting it [D74].

## Uncertainty and validation still needed
All results are computational predictions on one AlphaFold model. The FoldX value is a prediction, not a measurement [T1]. Burial and solvent accessibility are not measured, and the pocket data are predicted [E20] [E21]. H1 is not refuted, because T2 did not measure distance to the WIP surface in 9S9X [E10] [D74]. Cellular WASp levels for T45M have not been measured [G4].

## Next experiment
Computational: compute residue-45 relative solvent accessibility and distance to the WIP surface on 9S9X and on the AlphaFold model, and run a second stability predictor (next experiment, seq 75 and seq 54) [E10] [D74]. A later wet-lab check would compare cellular WASp levels for T45M and wild type.
