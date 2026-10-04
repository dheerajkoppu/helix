## Question
What mechanism best explains the reported loss of function of PIK3CD-p.Glu1021Lys (O00329), and what does it point to? The task states loss of function, but the record calls E1021K a gain of function [E2], so this direction conflict is not resolved (see Uncertainty).

## Evidence
ClinVar classifies the variant as pathogenic for immunodeficiency 14 [E1]. UniProt records it as a gain of function with enhanced membrane association and kinase activity [E2]. Dornan et al. report that it mimics activation mechanisms of oncogenic p110alpha mutations [E5]. Residues 1008-1031 are annotated as a helix [E3]. AlphaMissense (0.9748) [E8] and EVE (0.681) [E14] are computational predictions, not validated. No functional assay covers residue 1021 [G4], no experimental structure carries the substitution [G5], and the size of the effect is not established [G2].

## Agent-generated hypotheses
Three agent-generated hypotheses were formed: H1, ligand binding through membrane association [H1]; H2, release of p85 restraint [H2]; and H3, breaking of an intramolecular contact [H3]. H1 ranked first on the starting evidence [H1].

## Tests considered and the choice
Round 1: the planner chose T1 (structural context) and rejected T2, T3 and T4 [T1]. H1 was favoured before the test. Round 2 was reopened because T1 weakened H1. The planner chose T2 (ligand contact) and rejected T3 and T4. T4 was blocked by the provider and needed approval [T2].

## Result
T1: residue 1021 lines none of 22 P2Rank pockets but lies in one ProtVar predicted pocket with buriedness 0.82 [T1, E20, E21]. It is in no predicted protein-protein interface [E22]. T2: no non-solvent ligand lies within 4.5 Å of residue 1021 across 20 experimental structures [T2, E23]. Both results weakened H1 and H2; H3 was unchanged [T1, T2].

## Updated decision
H1 was favoured before the test and after both rounds [H1]. It was weakened but not refuted, so the decision did not change. The reopening occurred once [T2].

## Candidates
The lab's rule maps increased activity to reducing it, pointing at the p110delta catalytic subunit's ATP-binding pocket [R1]. The translator proposed three candidates for this direction. Safety cleared none and rejected all three, because no cited record supports the gain-of-function premise [G6]. The direction filter removed no rows; the three rows were removed by the safety block. No candidate was recorded. Any molecule would be a Helix hypothesis, not a recommendation.

## Uncertainty and validation still needed
The gain-versus-loss conflict is unresolved [E2, E13, G6]. The H1 membrane-facing premise is untested: T2 used soluble ATP-site ligands, not membrane lipids [T2]. T1 and T2 are computational or structure-database checks, not measurements. No assay has measured E1021K activity or membrane binding [G2]. The structural p85 interface check was null, which is not a confirmed absence [T1].

## Next experiment
Test H1 against PIP2 head-group contact and the membrane-facing electrostatic potential, wild type versus E1021K, on AF-O00329-F1 [H1, T2]. This is the open would-refute test for H1. It needs no approval and no external provider.
