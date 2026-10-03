## Question
What molecular mechanism best explains the loss of function of BTK p.Arg28His (UniProt Q06187, R to H) [E2], and can one targeted computational test check it?

## Evidence
ClinVar classifies c.83G>A (p.Arg28His) as Pathogenic, with multiple submitters and no conflicts [E1]. UniProt annotates residues 3-133 as a PH domain [E5] and residue 28 as an inositol 1,3,4,5-tetrakisphosphate binding site, based on experimental evidence [E7]. A molecular dynamics study with MM/PBSA classed R28H as a functional mutant that alters Ins(1,3,4,5)P4 binding; this is a computational prediction [E3]. AlphaMissense scores the variant 0.9978 [E11], also a prediction. No retrieved paper measures R28H directly [G1]. Papers on PH-TH dimerisation and membrane recruitment do not address R28 [E6, E8, E10].

## Agent-generated hypotheses
H1 (ligand binding, rank 1): R28 contacts the inositol-phosphate headgroup, and R28H weakens this binding [H1]. H2 (protein interaction, rank 2): R28 sits at the PH-TH interface [H2]. H3 (stability, rank 3): R28H destabilises the fold [H3].

## Tests considered and the choice
T1 (ligand contact, tests H1) had the highest expected learning per cost and was chosen [T1]. T2 (stability, H3) scored lower and is the fallback. T3 (structural context) had low feasibility [T1]. Safety cleared T1 with no approval needed [T1].

## Result
T1 completed. Residue 28 lay within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, with 4IP contacting it at 2.75 Å [T1][E22]. Negative-control ligands never contacted it [T1]. The four R28C structures showed zero contacts [E23].

## Updated decision
Favoured before the test: H1. Favoured after: H1. Decision changed: no [T1]. H1 is supported, while H2 and H3 are unchanged because T1 did not test them. No reopening was triggered, since the test completed and H1 was not weakened.

## Uncertainty and validation still needed
The contacts are with wild-type R28, not R28H [T1]. Crystal contacts are not binding affinities. The R28C structures cannot stand in for R28H [E23]. Most contacting ligands are synthetic benzofuran analogues, not headgroup analogues [T1]. No experimental binding, membrane recruitment or signalling data for R28H exist [G1, G2]. The predictions E3, E11, E13 and E14 have not been validated experimentally.

## Next experiment
A computational binding free-energy comparison of R28 and R28H against Ins(1,3,4,5)P4, built from the 1BWN complex [T1]. H1 is refuted if the change is within about 0.5 kcal/mol of wild type [H1]. If this is not feasible, the FoldX stability test (T2) is the fallback [T2].
