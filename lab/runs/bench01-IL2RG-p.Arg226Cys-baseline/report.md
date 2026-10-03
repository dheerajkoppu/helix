## Question
What molecular mechanism best explains the loss of function of IL2RG p.Arg226Cys (P31785), and which single computational test discriminates between candidate mechanisms? ClinVar lists this variant as Pathogenic with expert-panel review [E1].

## Evidence
UniProtKB annotates R226C as an X-linked SCID natural variant [E2]. Three predictors score it as deleterious: AlphaMissense 0.5785 [E3], and EVE 0.853 with popEVE -5.048 [E4]. Conservation at residue 226 is 0.717 [E5]. Residue 226 lies in a beta strand (219-226) of the fibronectin type-III domain (156-253) [E7]. None of the 14 experimental structures that observe the residue carries the mutation [E6]. The AlphaFold model gives residue 226 a pLDDT of 96.69 [T1]. A 2026 in-silico paper names R226C, but its conclusions were not retrieved [E10, G2]. No functional assay covers the residue [G1].

## Agent-generated hypotheses
H1 (stability_folding, rank 1) proposes that R226C destabilises the fibronectin fold, based on the strand location and the predictor scores [E7, E3, E4]. H2 (protein_interaction, rank 2) proposes that R226C removes a partner-chain contact, based on the recurrent disease substitutions at the residue and the absence of a mapped contact [E1, E9, E6].

## Tests considered and the choice
T1 (FoldX stability) directly tests H1, needs no approval and no compute seconds [T1]. T2 (structural context) tests H2 at the same cost [T2]. T3 (structure comparison) was blocked, since its ESM Atlas provider did not answer and it needs 120 compute seconds and approval [T3]. T1 was chosen because it discriminates the leading hypothesis and can run now.

## Result
FoldX predicts a folding free-energy change of +0.51 kcal/mol for R226C, below the 2.0 kcal/mol destabilising threshold [T1]. R226H at the same residue gives +10.76 kcal/mol, so the site can destabilise, but R226C does not [T1].

## Updated decision
H1 is weakened by the neutral R226C value [T1]. H2 is now favoured, a change from H1 [T1]. H2 remains untested, because no structure maps a contact at residue 226 [E6, G3].

## Uncertainty and validation still needed
FoldX on a predicted model has errors near 1 kcal/mol, and a single prediction was made without replicates [T1]. A neutral value does not show the variant is tolerated. Neither mechanism is confirmed by functional data [G1].

## Next experiment
Run T2, the structural-context test, as a computational step with no compute cost and no approval [T2]. If residue 226 lies in a predicted interface, H2 is strengthened. If it sits in the core with no interface, H2 is weakened and a fold-independent mechanism needs reconsidering.
