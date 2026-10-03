## Question
What molecular mechanism best explains the loss of function of CD40LG-p.Thr254Met (UniProt P29965), and does a targeted computational test change the conclusion? The variant is recorded as Pathogenic for Hyper-IgM syndrome type 1 [E1] and as natural variant VAR_007528 in UniProtKB [E2].

## Evidence
Residues 253–260 are annotated as a beta strand [E3]. Computational predictors score the substitution as pathogenic: AlphaMissense 0.7653 [E5], EVE pathogenic [E8]. No retrieved paper studies T254M directly [G1]. Literature on other XHIM CD40L mutants reports impaired CD40 catch-bond formation [E12] and association with wild-type CD40L [E14]. No experimental structure carries Met at position 254 [G2], and no functional assay covers residue 254 [G4].

## Agent-generated hypotheses
H1 (protein interaction, starting rank 1): Met disrupts trimer packing and CD40 engagement [H1]. H2 (stability/folding, starting rank 2): Met destabilises the beta-sandwich, reducing folding, secretion and trimer assembly [H2].

## Tests considered and the choice
Round 1: T1 (FoldX folding ddG, expected learning 0.6, zero compute seconds) was chosen [T1]. T2, T3 and T4 were rejected; T4 needed approval and 120 compute seconds [T4]. Round 2, after H1 was reopened: T2 (structural context) was chosen [T2]; T3 and T4 were rejected [T3, T4].

## Result
T1 predicts a folding ddG of +2.74 kcal/mol for T254M on the AlphaFold model, at residue pLDDT 98.31; the other substitution at this site, T254K, is predicted at +7.55 kcal/mol [E19]. T2 places residue 254 in two buried ProtVar pockets (buriedness 0.83 and 0.81) and in no P2Rank pocket [E20, E21, E22]. ProtVar lists no predicted protein–protein interface containing 254 [T2].

## Updated decision
H1 was favoured before the first test; after T1, H2 was favoured and the decision changed [H2]. H1 was reopened. After T2, H2 stayed favoured and H1 was weakened, with no change in the decision [H1, H2].

## Uncertainty and validation still needed
These are computational predictions from one predicted model; no stability was measured [E19]. The T2 interface result is recorded as not fully covered, so it is weak evidence against H1 [T2]. Relative solvent accessibility, a second stability predictor and CD40 contact distances have not been recorded [H2, H1]. No wet-lab data exist for T254M, so expression, secretion and CD40 binding of the mutant still need experimental validation.

## Next experiment
Compute relative solvent accessibility of residue 254 across the AlphaFold model and the eight PDB structures, and run a second stability predictor on T254M. H2 is overturned if residue 254 is exposed outside the strand core, or if the second predictor gives |ΔΔG| below 1 kcal/mol [H2].
