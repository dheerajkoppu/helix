## Question
What molecular mechanism best explains loss of function of CD40LG p.Thr254Met (P29965), and which single test discriminates the leading mechanisms?

## Evidence
ClinVar records p.Thr254Met as Pathogenic for hyper-IgM syndrome type 1, with multiple submitters and no conflicts [E1]. UniProtKB lists the same change as natural variant VAR_007528 in HIGM1 [E2]. AlphaMissense scores it 0.765, classed likely pathogenic [E3]. EVE scores it 0.758, classed pathogenic, and popEVE is -5.2 [E4]. Residue 254 lies in the tumour necrosis factor domain, in a beta strand annotated at residues 253-260 [E5]. CD40 ligand is a homotrimer [E6]. All eight experimental PDB structures observe residue 254 with the reference Thr [E7]. A crystal structure places the CD40 binding site in a crevice between two CD154 subunits [E8]. Other pathogenic or likely pathogenic substitutions sit at this residue or nearby [E9]. A 2026 computational study links other CD40L variants to altered trimeric stability [E10]. No functional assay covers residue 254 [G1], and its predicted interface membership is not established [G2].

## Agent-generated hypotheses
Three agent-generated hypotheses were recorded. H1 (stability_folding, rank 1) proposes that the substitution destabilises the fold and trimer assembly [H1]. H2 (protein_interaction, rank 2) proposes loss of the CD40 contact [H2]. H3 (ligand_binding, rank 3) proposes an altered ligand pocket, with weak support [H3].

## Tests considered and the choice
Three candidates were considered: FoldX stability [T1], structural context [T2], and reference-versus-variant structure prediction [T3]. T1 was chosen because it tests H1 directly, costs no compute and needs no approval [T1]. T2 was held back because interface state is not covered for this residue [G2]. T3 costs 120 of 300 compute seconds and needs approval [T3].

## Result
FoldX predicts a folding free-energy change of +2.74 kcal/mol for T254M on the AlphaFold model [T1]. This is above the 2.0 kcal/mol destabilising threshold, at residue pLDDT 98.31 [T1]. The other substitution at this residue, T254K, is predicted at +7.55 kcal/mol [T1].

## Updated decision
H1 remains favoured, so the decision is unchanged [H1][T1]. H2 and H3 are unchanged, because a folding value does not test binding [T1].

## Uncertainty and validation still needed
The FoldX value is a prediction on a predicted model, with error near 1 kcal/mol, and the margin over threshold is 0.74 kcal/mol [T1]. These predictions are not validated for clinical use [E3]. Expression, trimer assembly and CD40 binding of the mutant protein have not been measured [G1]. The residue's interface membership is untested [G2].

## Next experiment
Run the structural context test [T2] to check whether residue 254 lies in a predicted CD40-binding or trimer interface, at zero compute cost [G2]. Then, with approval, run the reference-versus-variant structure comparison [T3]. Interface membership without a local rearrangement would weaken H1 and favour a distal folding effect [H1][H2]. A positive interface hit would keep H2 active as a parallel mechanism [H2].
