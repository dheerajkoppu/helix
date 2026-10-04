## Question
What molecular mechanism best explains BTK-p.Arg28His (BTK, Q06187), and what would a targeted computational test point to? [R1]

## Evidence
Literature and database collection gathered the R28H-relevant findings, including a molecular dynamics study that covers R28H [E7, E9, E11, E13]. The knowledge graph linked further database records on the variant and BTK [E6, E8, E10, E12, E14–E20]. Gaps remain on direct stability and interface measurements [G1–G5].

## Agent-generated hypotheses
Insight ranked three agent-generated hypotheses [H1, H2, H3]:
- H1 (ligand_binding): R28H weakens an inositol-phosphate contact in the PH-domain pocket, reducing membrane recruitment [H1].
- H3 (stability_folding): R28H destabilises the PH-domain fold [H3].
- H2 (domain_interface): R28H breaks a contact with a neighbouring domain [H2].

## Tests considered and the choice
The planner chose T1 (ligand_contact) and rejected T2 (stability_effect) and T3 (structural_context) [T1]. Safety cleared T1 without approval [T1]. Before the test, H1 was favoured [H1].

## Result
T1 found residue 28 within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, with the closest contact at 2.58 Å to 4PT in 2Z0P. Inositol-phosphate ligands such as 4IP were among the contacting ligands. The four R28C structures showed no ligand contacts at this residue [T1]. This is a computational structural observation, not an experiment. Analysis judged that T1 supports H1 and leaves H2 and H3 unchanged [E21–E23].

## Updated decision
The favoured hypothesis stayed H1 (agent-generated hypothesis) before and after the test, so the decision did not change [H1]. No reopening was needed, because the test completed and H1 was supported rather than weakened [T1].

## Candidates
The lab's direction for this mechanism is decreased activity, so the action is to restore BTK activity by restoring membrane recruitment through the PH-domain pocket [R1]. The translator retrieved four candidate rows, and none matched the required action, so the direction filter ruled out all four [R1]. No candidate was proposed or cleared. Safety recorded zero cleared candidates [G7]. No molecule is named. Any future candidate would be a Helix hypothesis, not a recommendation.

## Uncertainty and validation still needed
All conclusions rest on computational structure and literature evidence. The R28H effect on IP4 binding is reported in the literature [E7] and has not been measured in this run. The stability and interface hypotheses [H2, H3] lack direct measurement. The predictions in T1 have not been validated experimentally [T1]. The translator could not find a matching molecule [G6].

## Next experiment
Measure inositol-phosphate binding of R28H against wild-type BTK, and test the stability and interface hypotheses [H2, H3]. Only then revisit candidates for restoring BTK activity [R1].
