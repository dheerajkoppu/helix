## Question
Which molecular mechanism best explains the loss of function of BTK-p.Arg28His (UniProt Q06187), and does one targeted computational test change the starting picture? [E4][E6]

## Evidence
ClinVar classifies the variant as Pathogenic, with criteria provided and multiple submitters [E4]. UniProt lists it as a natural variant in X-linked agammaglobulinaemia [E6]. Residue 28 is annotated as an inositol-1,3,4,5-tetrakisphosphate binding site [E10], and PDB 1B55 holds the PH domain with that ligand [E18]. AlphaMissense (0.9978) and popEVE (-5.63) are computational predictions [E14][E16]. No retrieved study measures R28H binding or cellular effects [G1][G2], and no functional assay covers residue 28 [G4].

## Agent-generated hypotheses
- H1, ligand binding (starting rank 1): loss of the Arg charge removes phosphate-head-group binding and PH-domain recruitment [H1]. Agent-generated hypothesis.
- H2, stability/folding (rank 2): R28H destabilises the PH-domain fold [H2]. Agent-generated hypothesis.
- H3, protein interaction (rank 3): R28H disrupts an inositol-phosphate-stabilised dimer interface [H3]. Agent-generated hypothesis.

## Tests considered and the choice
T1, a ligand-contact test with no compute cost, was chosen because it had the highest expected learning and feasibility [T1]. T2, a stability test, was rejected because it tests only H2 [T2]. T3, a structural-context test, was rejected for low expected learning [T3]. T4, a structure comparison, was rejected for cost (120 compute seconds with approval) and low expected learning [T4].

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, closest 2.58 Å to ligand 4PT in 2Z0P [E21]. The inositol phosphate 4IP contacts it at 2.75 Å in 1BWN [E22]. Negative-control ligands never contact residue 28 [E23]. [T1]

## Updated decision
Favoured before the test: H1. Favoured after: H1. Decision changed: no. H1 is supported; H2 and H3 are unchanged [T1]. No reopening was recorded, because the test completed, H1 was not weakened, and the favourite did not change.

## Uncertainty and validation still needed
All results are computational predictions and have not been validated experimentally. Most of the 39 structures carry synthetic ligands rather than inositol phosphate, so the 32/39 count is not specific to the IP4 pocket [T1]. A crystal contact does not show that the variant binds less. The R28C structures show no contacts [E23], but this does not show that losing Arg28 abolishes contact. ClinVar and pathogenicity scores do not validate the mechanism [E4][E14].

## Next experiment
Computationally model R28H in the 1BWN IP4 complex and score binding energy and contact network, with the stability check T2 on the same model. H1 would be overturned if the R28H ligand pose and contact energy stay within the wild-type range [H1].
