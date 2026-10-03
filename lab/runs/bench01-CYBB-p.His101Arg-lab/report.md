## Question
For CYBB p.His101Arg (gp91phox, UniProt P04839), which molecular mechanism best explains loss of function, and does one targeted computational test change the conclusion? [E1] [E2]

## Evidence
ClinVar classifies the variant as pathogenic, with criteria provided and no conflicts [E1]. UniProt annotates residue 101 as an axial heme b binding site [E3], and cryo-EM structures 8WEJ, 8X2L and 7U8G observe residue 101 with heme bound [E15] [E17] [E18]. Computational predictors score the change as damaging: AlphaMissense 0.9975 [E8] and EVE 0.815 [E13]. These are predictions, not experimental results. No retrieved abstract names His101 [G1], and no functional assay covers residue 101 [G4].

## Agent-generated hypotheses
H1, ligand_binding (starting rank 1): loss of the heme axial ligand [H1]. H2, stability_folding (rank 2): destabilised transmembrane fold [H2]. H3, protein_interaction (rank 3): disrupted gp91phox–p22phox contact [H3]. All three are agent-generated hypotheses. H1 was favoured before the test [H1].

## Tests considered and the choice
Four candidates were considered: T1 stability_effect, expected learning 0.6, no approval, 0 compute seconds [T1]; T2 ligand_contact, 0.35 [T2]; T3 structural_context, 0.3 [T3]; T4 structure_comparison, not runnable and needs approval [T4]. T1 was chosen and cleared by safety. T2 to T4 were rejected with reasons [T1] [T2] [T3] [T4].

## Result
FoldX predicts a ΔΔG of −1.04 kcal/mol for H101R on the AlphaFold model, below the 2.0 kcal/mol destabilising threshold, with residue pLDDT 97.0 [T1] [E21]. The H101Y control gave −0.87 kcal/mol [E22]. This is a computational prediction and has not been validated experimentally.

## Updated decision
H1 remains favoured. H2 is weakened but not refuted, and H3 is unchanged [T1]. Favoured before: H1. Favoured after: H1. Decision changed: no [T1]. No reopening was needed, because the favoured hypothesis neither changed nor was weakened.

## Uncertainty and validation still needed
FoldX error is near 1 kcal/mol, and the H101Y control shows near-neutral values at this site, so the test has little power here [T1]. It used the AlphaFold model, not the cryo-EM structures [T1]. H1's refutation criterion, the heme-iron distance, has not been measured [H1]. The interface question for H3 is untested [H3]. No experimental expression or maturation data exist [G2] [G3].

## Next experiment
T2, a ligand-contact test: measure the His101 side-chain distance to the heme iron in 8WEJ, 8X2L and 7U8G [T2]. Prediction, not a result: the NE2 atom sits about 2.0–2.5 Å from the iron, which would support H1 [T2].
