## Question
What molecular mechanism best explains loss of function of JAK3 p.Arg103His (P52333), and which single targeted test discriminates it? [E1]

## Evidence
ClinVar classifies R103H as Pathogenic for T-B+ severe combined immunodeficiency, with criteria provided and no conflicts [E1]. Residue 103 lies in the FERM domain (residues 24-356) [E2], and the UniProt receptor-interaction region spans residues 1-223 [E3]. AlphaMissense (0.84), EVE (0.83) and ScoreCons (0.898) all predict the substitution is damaging or conserved [E4, E8]. No experimental structure in the PDB observes residue 103 [E5], so the AlphaFold model (mean pLDDT 85.69) is the only structural basis [E6]. A JAK2 FERM-SH2 crystal structure shows the two domains interact intimately [E9]. No study of R103H itself was found [G2].

## Agent-generated hypotheses
- H1 (stability_folding): R103H destabilises the FERM fold and lowers cellular JAK3 levels. Starting rank 1 [H1].
- H2 (domain_interface): R103H disrupts FERM contact with the SH2 or kinase domain of the same chain. Starting rank 2 [H2].
- H3 (protein_interaction): R103H weakens receptor binding through the 1-223 region. Starting rank 3 [H3].

## Tests considered and the choice
Three tests were runnable or considered: a FoldX stability test [T1], a structural-context test [T2], and a reference-versus-variant structure comparison [T3] [T1, T2, T3]. T1 was chosen because it runs now with no approval and tests H1 directly [T1]. T3 was blocked because the ESM Atlas provider did not respond, and it needs approval for 120 compute seconds [T3]. T2 bears only weakly on H2 and H3 [T2].

## Result
FoldX predicts a folding free-energy change of +4.15 kcal/mol for R103H, above the 2.0 kcal/mol destabilising threshold, at residue pLDDT 95.88 [T1]. The other substitution at this residue, R103C, gives +2.02 kcal/mol [T1].

## Updated decision
H1 remains favoured [T1, E4]. The decision did not change, but H1 is better supported than before [T1]. H2 and H3 are unchanged because a stability value does not measure interface or binding loss [T1].

## Uncertainty and validation still needed
FoldX on a predicted model has errors near 1 kcal/mol, and a predicted destabilisation is not a measured cellular effect [T1]. No experimental structure covers residue 103, so contacts are unverified [G1]. Whether the variant reduces JAK3 protein levels is untested. The stability result cannot exclude H2 or H3 [T1].

## Next experiment
A laboratory differential scanning fluorimetry comparison of wild-type and R103H FERM constructs (residues 14-366) measuring melting temperature and soluble yield. A lower melting temperature or yield for R103H would support H1; equal values would point toward H2 or H3 [T1, G1].
