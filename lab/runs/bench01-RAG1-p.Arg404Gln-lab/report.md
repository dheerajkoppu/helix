## Question
Which molecular mechanism best explains the loss of function of RAG1 p.Arg404Gln (UniProt P15918), and does one targeted computational test change the starting conclusion? [E1, E6]

## Evidence
ClinVar classes NM_000448.3 c.1211G>A (p.Arg404Gln) as Pathogenic, reviewed by an expert panel [E1]. RAG1 is the catalytic component of the RAG complex that mediates DNA cleavage in V(D)J recombination [E6]. Residues 392-459 are annotated as DNA-binding (NBD) [E10, E12]. Literature reports reduced recombination activity for RAG mutants [E5, E7]. AlphaMissense gives 0.953 and conservation is 1.0 [E13, E14]. No experimental structure or functional assay covers residue 404 [E17, G4, G5], and no paper reports this substitution specifically [G1].

## Agent-generated hypotheses
- H1 (nucleic-acid binding, rank 1): the Arg side chain contacts RSS DNA [H1].
- H2 (stability/folding, rank 2): the Arg sits in an intra-domain network whose loss destabilises the fold [H2].
- H3 (protein interaction, rank 3): the Arg makes an inter-chain contact in RAG1 or RAG1-RAG2 assembly [H3].

## Tests considered and the choice
H1 was favoured before the test [H1]. Four tests were considered: T1 stability (expected learning 0.7, feasibility 0.8, no approval), T2 structural context (0.3), T3 ligand contact (feasibility 0), and T4 structure comparison (120 compute s, approval needed, feasibility 0.1) [T1, T2, T3, T4]. T1 was chosen for its highest expected learning and no approval need. The first plan was blocked only by a refused note; the re-submitted plan was cleared [T1].

## Result
FoldX predicts a ddG of -0.79 kcal/mol for R404Q on the AlphaFold model, below the 2.0 kcal/mol destabilising threshold, with residue pLDDT 93.56 [T1, E20, E21]. The R404W substitution gives the same value [E22].

## Updated decision
H1 is still favoured after the test [H1]. H2 is refuted by the T1 result [H2, T1]. H3 is unchanged [H3]. The decision did not change. No reopening applied, because the test completed and the favoured hypothesis was not weakened [H1].

## Uncertainty and validation still needed
These are computational predictions, and none has been validated experimentally [T1]. T1 is a single FoldX prediction on one AlphaFold model [T1]. A neutral ddG does not explain the Pathogenic classification, so a non-folding mechanism is still needed [E1, T1]. H1 and H3 remain untested directly, because T2 and T4 were not run [T2, T4].

## Next experiment
A computational DNA-contact check on an experimental RAG1 structure with bound RSS DNA, measuring the distance from R404 atoms to DNA [H1]. This is the would-refute test for H1 [H1]. A laboratory EMSA comparing RAG1 wild-type and R404Q binding to an RSS is the follow-up [H1].
