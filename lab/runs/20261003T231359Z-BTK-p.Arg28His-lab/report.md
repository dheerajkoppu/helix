## Question
Which molecular mechanism best explains the loss of function of BTK p.Arg28His (Q06187), and does one targeted computational test change the conclusion? [E1, E2]

## Evidence
ClinVar lists R28H as Pathogenic, with criteria provided and no conflicts [E1]. UniProt records it as a natural variant in X-linked agammaglobulinemia [E2]. Residue 28 is annotated as an inositol-1,3,4,5-tetrakisphosphate binding site within the PH domain [E6, E8]. The only R28H-specific literature classifies R28C/H as ligand-binding ("functional") mutations, in silico [E3]. No retrieved paper measures R28H binding or cellular function [G1, G2]. Predictors score R28H as strongly deleterious: AlphaMissense 0.9978 [E13] and popEVE -5.634 [E14]. These are predictions, not validation.

## Agent-generated hypotheses
- H1, ligand binding (starting rank 1): His28 cannot make the charge contacts with inositol phosphates, so PH-domain membrane anchoring fails [H1].
- H2, protein interaction (rank 2): His28 disrupts PH-TH dimerisation [H2].
- H3, stability (rank 3): His28 lowers PH-domain folding stability [H3].

All three are agent-generated hypotheses.

## Tests considered and the choice
Four tests were considered [T1, T2, T3, T4]. T1, ligand contact, was chosen: zero compute seconds, no approval, highest expected learning (0.6) [plan seq 42]. T2 was rejected because it bears only on H3. T3 was rejected because its interface half cannot return data. T4 was rejected because feasibility is 0.1 and it costs 120 compute seconds and needs approval [plan seq 42].

## Result
H1 was favoured before the test [H1]. Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures [E21, T1]. The closest phosphate contacts are 4IP at 2.75 Å [E23] and 4PT at 2.58 Å [E21]. Negative-control ligands never contacted residue 28 [T1]. These are wild-type measurements. The record holds no R28H structure, so the His-specific step was not tested [T1].

## Updated decision
H1 remained favoured after the test, so the decision did not change [decision seq 58]. H1 is rated supported on wild-type data. H2 and H3 are unchanged [interpretation seq 57]. No reopening was needed: the test completed, H1 was not weakened, and the favourite did not change [decision seq 58].

## Uncertainty and validation still needed
Most nearby ligands are synthetic tetrahydrobenzofurans, not inositol phosphates [T1]. The R28C structures show zero contacts, but their ligands are mostly ions [E22], so that evidence is weak. Crystal contacts are not direct measures of binding by the variant. Still needed: a modelled R28 versus R28H complex with 4IP, a binding measurement (ITC or SPR) against IP4, and a cell membrane-recruitment assay. None has been done, so all predictions here are unvalidated [interpretation seq 57].

## Next experiment
A computational R28 versus R28H comparison on the 1B55 backbone with 4IP bound. It can overturn H1 under H1's own refutation criterion [H1, next experiment seq 59]. This is a prediction only.
