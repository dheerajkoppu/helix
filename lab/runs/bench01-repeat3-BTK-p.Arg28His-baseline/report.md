## Question
What molecular mechanism best explains the loss of function of BTK p.Arg28His (Q06187), and which single computational test discriminates the leading candidates? [E1] [E2]

## Evidence
ClinVar lists R28H as Pathogenic with multiple submitters and no conflicts [E1], and UniProtKB annotates it as a natural variant in X-linked agammaglobulinemia [E2]. UniProtKB annotates residue 28 as a binding site for inositol 1,3,4,5-tetrakisphosphate from experimental evidence [E3], and the bound-IP4 PH-domain structure 1B55 observes this residue [E7]. AlphaMissense scores R28H at 0.9978 and ScoreCons conservation is 0.962 [E4] [E5]. A molecular dynamics study examined the ligand-binding site of R28C and R28H [E9]. Residue 28 has no functional assay coverage and no retrieved R28H structure [G1] [G2].

## Agent-generated hypotheses
H1 (ligand_binding, rank 1): loss of the Arg28 charge removes inositol phosphate contact in the PH domain, impairing membrane recruitment [H1]. H2 (stability_folding, rank 2): R28H destabilises the PH fold [H2].

## Tests considered and the choice
Two zero-cost tests were recorded: FoldX stability [T1] and ligand contact in experimental structures [T2]. T1 was chosen because it directly tests the folding hypothesis and needs no approval; T2 mostly confirms a premise already given by the binding-site annotation [E3]. [T1]

## Result
FoldX predicts a ΔΔG of -0.76 kcal/mol for R28H, below the 2.0 kcal/mol destabilising threshold, at residue pLDDT 94.31 [T1]. The same predictor gives -0.17 kcal/mol for R28C and -1.57 kcal/mol for R28L [T1].

## Updated decision
H2 is refuted as stated [T1]. H1 remains favoured, though only by elimination and the binding-site annotation [E3]; the favoured hypothesis did not change [H1].

## Uncertainty and validation still needed
FoldX errors are near 1 kcal/mol and the prediction uses the AlphaFold model, so a neutral value does not show the variant is tolerated [T1]. No test so far measures inositol phosphate binding by R28H [G1]. The ligand-binding mechanism is supported by annotation and prediction, not by a measured variant effect [H1].

## Next experiment
Run the ligand contact test on the 39 structures observing residue 28 [T2]. Contact with inositol phosphate in 1B55 and related structures would support H1; absence of ligand neighbours would weaken it [E7]. A laboratory IP4 binding assay with the R28H PH domain would be the decisive follow-up [G1].
