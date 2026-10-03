## Question
What molecular mechanism best explains the loss of function of RAG1 p.Arg404Gln (UniProt P15918), and which single computational test checks it? [E1]

## Evidence
ClinVar classifies RAG1 p.Arg404Gln as Pathogenic, reviewed by an expert panel [E1]. The other substitution at the same residue, p.Arg404Trp, is also Pathogenic/Likely pathogenic [E7]. Residue 404 lies inside the UniProt DNA-binding NBD (392–459) and the InterPro nonamer-binding domain (390–460) [E5]. ScoreCons conservation is 1.0 [E3]. AlphaMissense gives 0.9531 and EVE gives 0.673, both in the pathogenic class [E2, E4]. No experimental structure observes residue 404 [E6]. No retrieved paper measures R404Q activity or binding [G2, E10].

## Agent-generated hypotheses
H1 (nucleic acid binding, ranked first): the Arg404 side chain contacts the RSS DNA backbone, and Gln removes that contact [H1, E5]. H2 (stability): the substitution destabilises the NBD fold [H2, E2, E3]. H3 (protein interaction): residue 404 sits in the RAG1 homodimer or RAG2 interface [H3, E8]. Each has a refutation criterion recorded [H1, H2, H3].

## Tests considered and the choice
Three candidates were recorded [T1, T2, T3]. T3, a ligand-contact test, cannot run because no experimental structure covers the residue [T3]. T1, a FoldX stability test, was chosen because it runs now at no compute cost, needs no approval, and bears directly on H2 [T1]. T2, a pocket and interface test, was the alternative for H3 [T2].

## Result
FoldX predicts a folding free-energy change of -0.79 kcal/mol for R404Q on the AlphaFold model, at residue pLDDT 93.56 [T1]. The 2.0 kcal/mol destabilising threshold was not reached [T1]. R404W at the same residue gives -0.79 kcal/mol [T1].

## Updated decision
H2 is weakened by the small predicted fold cost [T1]. H1 remains favoured, as it was before the test [H1]. T1 does not measure DNA contact, so H1 is still untested [T1].

## Uncertainty and validation still needed
FoldX on a predicted model has errors near 1 kcal/mol, so a neutral value does not show that R404Q is tolerated [T1]. No experimental structure confirms the model at this residue [E6]. DNA binding, interface contact and recombination activity of R404Q were not measured, so all three hypotheses remain open [G1, G2].

## Next experiment
Run the structural context test T2 to test H3 [T2]. Then measure whether R404 contacts the RSS backbone in a DNA-bound RAG1 model or structure, to test H1 [H1]. A contact under about 4 Å would support H1; no contact would overturn it.
