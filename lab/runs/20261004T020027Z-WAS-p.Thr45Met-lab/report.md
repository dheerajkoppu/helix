## Question
Does p.Thr45Met in WASP (WAS, P42768) change the folded shape of the protein? The record answers this only with computational predictions. No measured fold comparison was run [T3].

## Evidence
ClinVar classes the variant as Pathogenic, with criteria provided and no conflicts [E1]. UniProt lists it as a natural variant of moderate impact [E2]. Residue 45 lies in the WH1 domain [E3, E4]. The AlphaFold DB model AF-P42768-F1 has a mean pLDDT of 69.38 [E18], and residue 45 has pLDDT 96.62 [T1]. No retrieved paper measures the folding or structure of Thr45Met itself [G1]. One experimental WASP/WIP complex (9S9X) observes residue 45 [E15].

## Agent-generated hypotheses
H1 (agent-generated hypothesis, protein interaction) proposes that the substitution disrupts the WIP interface without changing the fold [H1]. H2 (stability) proposes core destabilisation [H2]. H3 (domain interface) proposes a shift in autoinhibition [H3]. Starting ranks were H1, H2, H3 [H1, H2, H3].

## Tests considered and the choice
Round 1: T1 (stability, learning 0.55, no approval) was chosen over T2 (structural context) and T3 (structure comparison, learning 0.7 but feasibility 0.2, approval needed, blocked) [T1, T2, T3]. Safety cleared T1 [decision seq 43].
Round 2, reopened because the favourite changed: T2 was chosen to separate H1 from H2. T3 and T4 were rejected [T2, T4].

## Result
T1: FoldX predicts a ΔΔG of +3.56 kcal/mol for Thr45Met, above the 2.0 kcal/mol destabilising threshold. The control T45R gave +7.43 kcal/mol [T1, E20, E21]. T2: residue 45 lies in two predicted pockets (buriedness 0.74 and 0.79) and in no predicted protein-protein interface [T2, E22, E23]. These are predictions only and have not been validated experimentally.

## Updated decision
Round 1: H1 was favoured before T1 and H2 after. The decision changed [decision seq 55]. Round 2: H2 stayed favoured, H1 was weakened and H3 was weakened [decision seq 77]. H2 is the favourite now, provisionally.

## Candidates
The lab's decision is that a drug could act on the H2 mechanism through a pathway node, BTK [G7]. The translator returned four pathway_node rows via BTK, each with two bridge steps [G7]. Every direction check read unknown, so the direction filter rejected all four and none matched or opposed [G7]. Safety cleared 0 of 4 [G8]. No candidate was recorded. Any candidate would be a Helix hypothesis, not a recommendation.

## Uncertainty and validation still needed
T1 is a single FoldX predictor on a predicted model, with roughly 1 kcal/mol error and no relaxation step [T1]. T2 used a monomer model and predicted pockets, not measured binding sites [T2]. The fold itself was not compared. T3 is blocked because its provider is down and it needs approval [T3]. The direction of WAS activity is unresolved [G7]. Nothing has been validated experimentally.

## Next experiment
Test H1's refutation criterion on the 9S9X complex: distances from residue 45 to WIP and the effect of a modelled Met [next_experiments seq 78]. Also run relative accessibility and relaxed FoldX to test H2 [next_experiments seq 56]. Run the fold comparison (T3) once a provider is available and approved.
