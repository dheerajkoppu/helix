## Question
What molecular mechanism best explains loss of function of ADA p.Arg211His (UniProt P00813), and which single computational test checks it? [E1, E2]

## Evidence
ClinVar classifies this substitution as Pathogenic, reviewed by an expert panel [E1]. UniProtKB lists it as an ADASCID natural variant [E2]. Predictors are mixed: AlphaMissense gives 0.5475, classed ambiguous [E3]; EVE gives 0.837, classed pathogenic [E4]; popEVE gives -3.678 [E5]. The AlphaFold model covers the full chain with mean pLDDT 96.56 [E8]. Two experimental structures observe residue 211 [E6, E7]. No functional assay covers the residue [G1], and whether it contacts a ligand or a partner surface is unknown [G2]. A 1998 study uses expressed activity of 29 ADA alleles for genotype-phenotype correlation [E12], but the record does not tie it to R211H.

## Agent-generated hypotheses
H1 (stability_folding, rank 1): the substitution destabilises the fold [H1]. H2 (ligand_binding, rank 2): Arg211 contacts the active-site ligand or metal [H2]. H3 (protein_interaction, rank 3): the substitution disrupts the DPP4 or PLG surface [H3].

## Tests considered and the choice
Three tests were costed: stability_effect [T1], ligand_contact [T2] and structural_context [T3]. T1 was chosen because it tests the top-ranked H1 directly, needs no approval and uses no compute time [T1]. The structure comparison was not chosen because it needs human approval and 120 compute seconds.

## Result
FoldX predicts a folding ΔΔG of +8.21 kcal/mol for R211H, above the 2.0 kcal/mol threshold, at a residue with pLDDT 98.94 [T1]. The same predictor gives R211S +3.89 and R211C +1.28 at this residue [T1].

## Updated decision
H1 remains favoured [T1]. The decision did not change. H2 and H3 are unchanged, since a folding value says nothing about binding or interfaces [T1].

## Uncertainty and validation still needed
FoldX has errors near 1 kcal/mol and this is one prediction on a model, not a measurement [T1]. No measured activity or stability exists for R211H [G1]. The UniProt 4%-activity annotation at residue 211 [E13] does not name the substitution. Evidence record E1 contains a typo in its statement ("Arg211High"); the source is the R211H ClinVar record [E1].

## Next experiment
Run the ligand contact test [T2] to check whether Arg211 neighbours the ligands in 3IAR and 7RTG [E6, E7]. Then, with approval, run the reference-versus-variant structure comparison to look for a local rearrangement [T1].
