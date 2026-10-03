## Question
By what molecular mechanism does WAS-p.Thr45Met (UniProt P42768) lose function, and what one computational test best discriminates the candidate mechanisms? [E1]

## Evidence
ClinVar lists c.134C>T (p.Thr45Met) as Pathogenic with multiple submitters and no conflicts [E1]. UniProtKB annotates the same change as natural variant VAR_008106 with five cited publications [E2]. Residue 45 lies in the WH1/EVH1 domain (residues 39-148) [E3]. AlphaMissense gives a score of 0.5907 and EVE gives 0.679, both computational [E4][E5]. The only experimental structure observing residue 45 (9S9X, NMR of the WASP/WIP complex) contains no ligand [E6]. The AlphaFold model has mean pLDDT 69.38 across the full chain [E7]. A primary report describes the change in an X-linked thrombocytopenia family [E8]. No functional assay covers residue 45 [G1], and no structure shows whether it contacts WIP [G2].

## Agent-generated hypotheses
H1 (stability_folding): T45M destabilises the WH1 fold [H1]. H2 (protein_interaction): T45M removes a surface contact with a partner such as WIP [H2].

## Tests considered and the choice
Four candidates were recorded [T1][T2][T3][T4]. I chose T1, the FoldX stability test, because it runs without approval and gives a numeric value for H1 [T1]. The structural context test [T2] was deferred because its interface readout is not covered for this residue. The structure comparison [T3] needs approval and the live predictor is unavailable. The ligand contact test [T4] cannot run.

## Result
FoldX predicts +3.56 kcal/mol for T45M at a confidently predicted residue (pLDDT 96.62) [E9]. The other substitution at this residue, T45R, is predicted at +7.43 kcal/mol [E11]. missense3d returns Neutral [E10].

## Updated decision
H1 stays favoured [D1]. The value exceeds the 2.0 kcal/mol threshold [E9], but the missense3d call disagrees [E10]. H2 is unchanged because a stability test cannot assess an interface [H2].

## Uncertainty and validation still needed
FoldX on a predicted model carries errors near 1 kcal/mol, and the threshold is a display bin, not a validated cutoff [T1]. The calculation is for the monomer, not the WASP/WIP complex. No measured stability or binding data exist.

## Next experiment
Run the structural context test [T2] to check whether residue 45 sits in a predicted WIP interface or in the buried core [NE1]. Consistent core placement would strengthen H1; an interface placement would move the favour to H2.
