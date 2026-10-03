## Question
Which molecular mechanism best explains the loss of function of FOXP3 p.Ala384Thr (UniProt Q9BZS1), and does one targeted computational test change the starting conclusion?

## Evidence
ClinVar lists this change as pathogenic/likely pathogenic with criteria provided and multiple submitters [E1]. UniProt annotates residues 381-391 as a helix [E3] within a forkhead DNA-binding region spanning 337-423 [E4]. AlphaMissense (0.9921) and EVE (0.785) score the substitution as pathogenic; these are computational predictions, not validated [E7, E12]. The retrieved literature does not report functional, DNA-binding, dimerisation or structural data for A384T [G1], and no abstract names it [E8, E9]. FOXP3 forms a head-to-head dimer through a linker preceding the forkhead domain [E11]. Two experimental structures observe residue 384 but neither carries the substitution [E14, E16, G6].

## Agent-generated hypotheses
- H1, nucleic-acid binding (starting rank 1): the substitution disrupts positioning of the recognition helix on DNA [H1].
- H2, stability/folding (rank 2): the substitution destabilises the 381-391 helix [H2].
- H3, protein interaction (rank 3): the substitution weakens the domain-swapped dimer interface [H3].

## Tests considered and the choice
T1 (stability_effect) was chosen for its learning-to-cost ratio and zero compute cost [T1]. T2 (structural context), T3 (structure comparison, needs approval and 120 compute seconds) and T4 (ligand contact) were rejected [T2, T3, T4]. Safety cleared T1 with no approval needed [T1].

## Result
FoldX predicts a ΔΔG of +1.16 kcal/mol for A384T on the AlphaFold model, below the 2.0 kcal/mol destabilising threshold, at residue pLDDT 95.38 [T1, E21]. The within-site control A384V gives -0.40 kcal/mol [E22].

## Updated decision
Before the test, H1 was favoured. After it, H1 is still favoured and the decision did not change. H2 was weakened [H2]. H1 was unchanged and stays favoured because it has the strongest annotation and prediction support [H1, E3, E4], not because T1 supported it. H3 was unchanged [H3]. No reopening was required, since the test completed and the favoured hypothesis was neither weakened nor replaced.

## Uncertainty and validation still needed
These are computational predictions only; nothing has been validated experimentally. FoldX error on a predicted model is near 1 kcal/mol, so +1.16 cannot exclude mild destabilisation [T1]. A neutral ΔΔG does not show DNA binding or dimerisation is intact, and T1 tests neither [H1, H3]. The solvent exposure of Ala384 that H2's refutation criterion needs was not measured [H2]. No functional assay covers residue 384 [G5].

## Next experiment
Proposed, not run: measure the distance from residue 384 to bound DNA in 4WK8 [E16]. This tests H1's own refutation criterion: no atom within about 5 Å of DNA would refute H1 [H1]. The interface check for H3 (T2) is the next candidate after that [T2].
