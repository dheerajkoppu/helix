## Question
Which molecular mechanism best explains the loss of function of BTK p.Arg288Trp, and does one targeted computational test change the starting conclusion? [E1, E2]

## Evidence
ClinVar and UniProtKB both record R288W as pathogenic for X-linked agammaglobulinemia [E1, E2]. Residue 288 lies in the SH2 domain and in a helix at 288–298 [E3, E4, E10, E11]. AlphaMissense and EVE score the variant as pathogenic; these are computational predictions [E6, E9]. No retrieved study measures folding or expression of full-length R288W, or tests it in cells or for kinase activity [G4, G5]. Residue 288 has no functional assay on record, and the variant is absent from gnomAD v4.1 [G1, G3]. In an isolated SH2 domain, mutation of R288 cut phosphopeptide binding more than 200-fold [E15].

## Agent-generated hypotheses
- H1 (protein interaction, starting rank 1): loss of the pocket arginine stops the SH2 domain from engaging phosphotyrosine partners [H1].
- H2 (stability/folding, starting rank 2): the Arg-to-Trp change in the SH2 helix destabilises the domain and reduces folding or expression [H2].

## Tests considered and the choice
The planner chose T1, a FoldX stability test, over T2 (structural context), T3 (ligand contact, infeasible) and T4 (structure comparison, needs approval and has low learning) [plan seq 39].

## Result
Round 1, T1: FoldX predicts ΔΔG +5.68 kcal/mol for R288W on the AlphaFold model, above the 2.0 threshold, with residue pLDDT 85.06. Same-site controls were R288G +0.49 and R288Q +0.13 [T1, E20, E21]. This is a prediction, not a measurement. The favourite moved from H1 before the test to H2 after it, and the decision changed [decision seq 54]. The reopening was recorded [note seq 57].

Round 2, T2: residue 288 falls in ProtVar predicted pockets but in none of the P2Rank pockets, and in no predicted interface [T2, E22, E23, E24]. This weakens H1 without refuting it. H2 is unchanged [decision seq 75].

## Updated decision
Favoured: H2 (stability/folding), an agent-generated hypothesis supported so far only by computational predictions [H2, T1]. The favourite changed in round 1 and stayed the same in round 2 [decisions seq 54, seq 75].

## Uncertainty and validation still needed
FoldX errors on predicted models are near 1 kcal/mol [E20], so the +5.68 value is a prediction that has not been validated experimentally [T1]. missense3d calls R288W neutral, which conflicts with FoldX [E21]. ClinVar lists R288Q as pathogenic [E14], but FoldX calls R288Q near-neutral [E21], so folding alone may not explain the whole residue. The runner returned no job ID or manifest, so the run cannot be traced to a remote job [T1, T2]. Both hypotheses still need experimental testing.

## Next experiment
Computational: test whether a phosphotyrosine peptide docks near Arg288 in the reference and W288 models [next_experiments seq 55]. Laboratory: compare melting temperature and soluble yield of wild-type and R288W SH2 constructs, with a binding readout for H1 [next_experiments seq 76].
