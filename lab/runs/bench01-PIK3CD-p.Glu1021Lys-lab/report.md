## Question
Which molecular mechanism best explains the loss of function of PIK3CD p.Glu1021Lys, and does one targeted computational test change the starting conclusion? The record does not support the loss-of-function framing: the retrieved sources describe E1021K as gain-of-function [E2][E14][E21], and no source reports loss of function [G3].

## Evidence
ClinVar classifies the variant as pathogenic [E1]. UniProt lists it as a gain-of-function change that enhances membrane association and kinase activity [E2]. Residues 1008–1031 are annotated as helix [E4], and residue 1021 is observed in all 20 experimental structures [E12]. Computational predictors score it as damaging (AlphaMissense 0.9748 [E7]; EVE 0.681 [E10]). These are predictions, not validated results.

## Agent-generated hypotheses
H1 (ligand binding, rank 1) proposes that the substitution strengthens membrane association [H1]. H2 (domain interface, rank 2) proposes loss of an intramolecular contact [H2]. H3 (protein interaction, rank 3) proposes altered p85 engagement [H3]. All three are agent-generated hypotheses.

## Tests considered and the choice
Four tests were proposed [T1][T2][T3][T4]. T3 (structural context) was chosen: it needs no compute time or approval and has the highest expected learning among the cheap tests [plan seq 42]. T4 was rejected for its 120 compute seconds and approval requirement. T2 was rejected because stability is not a proposed mechanism. T1 was deferred.

## Result
Residue 1021 lies in one ProtVar predicted pocket [E22], but in none of the 22 P2Rank pockets [E23]. ProtVar reports no predicted protein-protein interface at 1021 [T3].

Favoured before the test: H1. Favoured after: H1. H1 is supported, H3 is weakened and H2 is unchanged [T3].

## Updated decision
The decision did not change. H1 remains favoured, with modest support. No reopening was needed: the test completed, and the favoured hypothesis was neither weakened nor replaced.

## Uncertainty and validation still needed
All T3 results are predictions on one AlphaFold DB model, and the two pocket tools disagree. The pocket rank control is not reported [T3]. The literature does not describe how E1021K increases activity [G1][G5]. Nothing here is validated experimentally, and the gain-of-function direction is consistent with all three hypotheses.

## Next experiment
Run a laboratory membrane-recruitment and kinase assay of wild-type versus E1021K, with salt dependence and a control substitution outside the pocket. This would confirm or overturn H1 (recorded as a next_experiment, no ID).
