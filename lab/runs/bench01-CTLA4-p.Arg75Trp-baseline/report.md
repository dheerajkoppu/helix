## Question
What molecular mechanism best explains the loss of function of CTLA4 p.Arg75Trp (UniProt P16410), and which single computational test discriminates between candidate mechanisms? [E1]

## Evidence
ClinVar classifies the variant as Pathogenic with 3 of 4 review stars, for CTLA4 haploinsufficiency [E1]. Predictors disagree: AlphaMissense gives 0.2572 (likely benign) [E2], while EVE gives 0.658 (pathogenic) and popEVE -4.839 [E3]. Residue 75 has ScoreCons conservation of 0.823 [E4]. It lies in the UniProt-annotated beta strand 68-77 of the Ig-like V domain [E5]. CTLA-4 is a disulfide-linked homodimer that acts as a decoy for CD80 and CD86 [E6], and the CTLA-4/B7-2 complex is crystallised (1I85) [E7]. Twenty of 22 PDB structures observe residue 75, none with it mutated, and the only ligands are glycan or citrate types [E8]. No functional assay covers residue 75 [G1], and no paper reports the biochemical mechanism of R75W [G2]. Heterozygous CTLA-4 point mutations show variable penetrance in a family study [E9].

## Agent-generated hypotheses
H1 (stability_folding): the tryptophan destabilises the beta strand, reducing surface CTLA-4 [H1]. H2 (protein_interaction): R75W removes a CD80/CD86-facing contact [H2]. Both are agent-generated hypotheses.

## Tests considered and the choice
Three tests were considered: FoldX stability (T1), predicted interface and pocket membership (T2), and ligand contact (T3) [T1, T2, T3]. T1 was chosen because it directly discriminates H1, needs no approval and is feasible now [T1]. T2 was rejected because the interface state is not covered, and T3 was rejected because the ligands are not binding-relevant [T2, T3].

## Result
FoldX predicts ΔΔG of -0.11 kcal/mol for R75W, below the 2.0 kcal/mol threshold, at residue pLDDT 95.38 [T1].

## Updated decision
H1 is weakened, and H2 is now the favoured agent-generated hypothesis, which is a change from H1 [T1]. H2 is still untested, so this is a change in ranking rather than confirmation [H2].

## Uncertainty and validation still needed
FoldX on a monomer model has errors near 1 kcal/mol, and it cannot detect trafficking or dimerisation defects [T1]. Experimental surface expression, B7 binding and thermal stability assays of R75W are needed, and T2 is the next computational check [G1].

## Next experiment
Run the structural context test (T2) to check whether residue 75 lies in a predicted CD80/CD86 interface. Membership would support H2; absence would leave both mechanisms unsupported [T2].
