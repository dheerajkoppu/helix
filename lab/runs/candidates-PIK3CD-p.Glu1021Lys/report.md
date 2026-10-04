## Question
What molecular mechanism best explains PIK3CD-p.Glu1021Lys (UniProt O00329, E to K at residue 1021) [E1][E2], and which candidate targets and molecules does that mechanism point to?

## Evidence
ClinVar classifies the variant as Pathogenic with expert-panel review [E1]. UniProtKB records it as a gain of function causing enhanced membrane association and kinase activity [E2]. A case series [E4] and a case report [E6] describe it as gain of function. Computational scores are AlphaMissense 0.9748 [E13] and EVE 0.681 [E14], both predictions. Residue 1021 lies in a helix annotated at 1008–1031 [E5] and is observed in 20 of 20 experimental structures [E18]. No retrieved study measures lipid kinase activity or membrane recruitment for this variant [G1], and no experimental structure carries E1021K [G4].

## Agent-generated hypotheses
Insight proposed three agent-generated hypotheses. H1 (ligand_binding) says the added positive charge increases membrane PIP2 association [H1]. H2 (protein_interaction) says the change disrupts a p85 contact [H2]. H3 (stability_folding) says the change destabilises the helix [H3]. H1 ranked first and H3 third at the start.

## Tests considered and the choice
The planner considered T1 to T4 [T1][T2][T3][T4] and chose T1, a stability test that needs no approval and costs no compute time (plan seq 42). T4 was not runnable now and needed approval [T4]. Before the test, the favoured hypothesis was H1 [H1].

## Result
FoldX predicted a folding change of −1.03 kcal/mol for E1021K, below the 2.0 kcal/mol destabilising threshold, with residue pLDDT 86.06 [T1][E22][E23]. The prediction comes from a single predictor [T1].

## Updated decision
The favoured hypothesis after the test is H1 [H1], so the decision did not change (decision seq 57). T1 weakened H3 [H3] and left H1 and H2 unchanged. H1 has not been tested directly. No reopening was needed.

## Candidates
The lab's direction rule is that gain of function with increased activity points to reducing activity, aimed at the ATP-binding pocket of the catalytic subunit [R1]. Safety cleared four candidates. C1 Duvelisib (rank 1), C2 Idelalisib (rank 2), C3 Leniolisib (rank 4) and C4 Zandelisib (rank 11) each have bridge kind same_target and direction check matches [C1][C2][C3][C4]. The direction filter ruled out 0 rows [ruled_out]. Each candidate holds only if the variant keeps that pocket and E1021K acts through membrane association [C1–C4]. The record flags a second PIK3CD catalogue entry for p110-delta deficiency whose direction disagrees, which was not used [G6]. Each candidate is a Helix hypothesis, not a recommendation.

## Uncertainty and validation still needed
The mechanism is an agent-generated hypothesis supported mainly by database and computational evidence. The FoldX value and the other scores are predictions, and none has been validated experimentally [T1][E13][E14]. Whether the pocket is retained in E1021K is unshown [C1–C4]. The membrane mechanism and the p85 mechanism both need direct tests [G1][G2][G3].

## Next experiment
A computational membrane-docking and electrostatic comparison of wild type and E1021K on the AlphaFold model [next_experiments seq 58]. Confirming H1 would show a more positive surface at 1021 and stronger PIP2 association. Refuting H1 would show no change in membrane binding, or residue 1021 more than about 10 Å from the membrane surface [H1].
