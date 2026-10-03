## Question
What molecular mechanism best explains the loss of function of STAT1 p.Arg274Trp (P42224)? The record contradicts the premise: the sources describe R274W as gain of function [E2][E7][E14], and no retrieved source reports a loss-of-function mechanism [G3].

## Evidence
UniProt annotates R274W as gain of function, with increased IFN-driven phosphorylation from loss of dephosphorylation [E2]. Petersen et al. report elevated phosphorylation and prolonged nuclear accumulation [E7], and Giovannozzi et al. report faster nuclear accumulation [E9]. Residues 136-317 are annotated as coiled coil, and 257-286 as a helix [E3][E4]. The AlphaFold model is confident overall (mean pLDDT 87.25) [E20]. No functional assay covers residue 274 [G1]. AlphaMissense (0.5268) and EVE (0.604) scores are computational predictions, not validated [E6][E8].

## Agent-generated hypotheses
- H1, protein interaction (agent-generated hypothesis): altered partner or phosphatase surface near Y701 slows dephosphorylation [H1].
- H2, domain interface (agent-generated hypothesis): loss of a coiled-coil to DNA-binding or N-terminal contact shifts nuclear accumulation [H2].
- H3, stability (agent-generated hypothesis): helix destabilisation lowers STAT1 levels; the only loss-of-function fit, and weakly supported by the record [H3].

## Tests considered and the choice
The planner chose T1, a FoldX ΔΔG test with zero compute cost, over T2, T3 and T4 [T1][T2][T3][T4]. T3 needed approval and could not run, and T4 had low expected learning. Favoured before the test: H1.

## Result
T1 completed. FoldX predicts ΔΔG −0.60 kcal/mol for R274W, below the 2.0 kcal/mol threshold, at residue pLDDT 94.62 [T1][E21]. The same-site predictions are R274G +1.42 and R274Q +0.32 kcal/mol [E22][E23]. T1 weakens H3 but does not test H1 or H2 [T1].

## Updated decision
Favoured before: H1. Favoured after: H1. Decision changed: no. H1 keeps its direct literature support for this substitution [E2][E7][E9][E16], but no structure yet places residue 274 at a partner or phosphatase interface [G2][G6]. No reopening was needed, because the test completed and the favoured hypothesis was not weakened.

## Uncertainty and validation still needed
T1 is a single FoldX estimate on one AlphaFold model, with error near 1 kcal/mol, so it cannot separate neutral from mildly stabilising effects [T1]. It measures no expression or degradation, so H3 is weakened, not refuted. The nuclear-accumulation mechanism is unresolved [G5]. None of these predictions has been validated experimentally.

## Next experiment
T2 (structural context, zero compute cost): test whether residue 274 lies in a predicted pocket or protein-protein interface near Y701 [T2]. T3, the structure comparison for H2, needs human approval and is not runnable now [T3]. Wet-lab dephosphorylation and expression assays are not in scope for this run.
