## Question
Which molecular mechanism best explains the loss of function of STAT3 p.Arg382Trp (UniProt P40763), and does one targeted computational test change the starting conclusion? [E4]

## Evidence
ClinVar lists the variant as pathogenic for hyper-IgE recurrent infection syndrome 1 [E2]. UniProt records loss of function with reduced DNA-binding ability [E4]. The only R382W-specific study, in airway epithelial cells, reports reduced CFTR and impaired ciliogenesis with suppressed IL1R1 [E1][E3]. Residue 382 lies in the DNA-binding domain [E13] and is observed in the DNA-bound structure 6QHD [E16]. AlphaMissense gives a computational pathogenicity score of 0.9966 [E8]. No retrieved study measured R382W biochemically or structurally [G1], and none of the four experimental structures carries R382W [G5]. Whether the effect is dominant-negative or haploinsufficient is unresolved [G3][E5].

## Agent-generated hypotheses
Three agent-generated hypotheses were recorded: H1, DNA-binding loss (rank 1); H2, weakened dimer or partner contacts (rank 2); and H3, destabilised fold (rank 3) [H1][H2][H3].

## Tests considered and the choice
T1, a FoldX stability test, was chosen: expected learning 0.6, zero compute seconds, no approval needed [T1]. T2, a structural-context test with expected learning 0.4, was rejected as lower-yield. T3, a structure comparison costing 120 compute seconds and needing approval, was rejected for low expected learning and feasibility [T1]. Safety cleared T1 with no approval needed [T1].

## Result
FoldX predicts a ΔΔG of +1.96 kcal/mol for R382W on the AlphaFold model, just below the 2.0 kcal/mol destabilising bin, at residue pLDDT 88.0 [T1][E22]. Other substitutions at residue 382 give +0.80 (R382L), +1.79 (R382P) and +2.23 kcal/mol (R382Q) under the same predictor [E23]. This weakly supports H3 [T1]. T1 does not bear on H1 or H2 [T1].

## Updated decision
Favoured before the test: H1. Favoured after: H1. Decision changed: no [H1]. The reopening rule did not trigger, because T1 completed, H1 was not weakened and the favourite did not change, so no reopening was recorded.

## Uncertainty and validation still needed
All three hypotheses remain agent-generated hypotheses. The FoldX value is a computational prediction, not validated experimentally, and it sits close to the destabilising threshold [E22], so it is not decisive on its own. Functional-assay coverage at residue 382 is absent [G4]. Still needed: the DNA-contact check for H1, the interface check for H2 (T2), and wet-lab measurements of R382W stability and DNA binding.

## Next experiment
Measure the distances from the R382 side chain to DNA atoms in 6QHD [E16], then model W382 into that complex and count clashes. This tests H1 computationally only. Its outcome is a prediction and is not validated experimentally (recorded next experiment, seq 56).
