## Question
Which molecular mechanism best explains the loss of function of BTK-p.Arg28His, and does the reference-versus-variant structure prediction of the PH domain (structure_comparison) change the predicted local structure? [E1][E2]

## Evidence
ClinVar lists the variant as pathogenic, with criteria provided and no conflicts [E1]. UniProt records it as a natural variant in X-linked agammaglobulinaemia [E2]. Residue 28 lies in the PH domain [E5] and is annotated as a binding site for 1D-myo-inositol 1,3,4,5-tetrakisphosphate [E8]. The inositol-phosphate-bound structure 1B55 is in the record [E18]. AlphaMissense gives a computational pathogenicity score of 0.9978, a prediction not validated for clinical use [E13]. A molecular dynamics study classed R28C/H as binding-site mutations rather than folding mutations [E6]. No retrieved source measures binding or folding for R28H itself [G1].

## Agent-generated hypotheses
H1, ligand binding, starting rank 1 [H1]. H2, membrane-recruitment interface, rank 2 [H2]. H3, local folding change, rank 3 [H3]. All three are agent-generated hypotheses.

## Tests considered and the choice
The planner first chose T4 (structure_comparison) because the objective names it [T4]. Its approval request A1 timed out with no human decision and was treated as rejected, so T4 did not run [A1]. The planner then chose T1 (ligand_contact), which needs no compute or approval, and safety cleared it [T1]. T2 and T3 were rejected because they bear only on H3, or give a weak signal for H1 [T1].

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures [T1][E21]. Negative-control ligands never contacted it, and the R28C structures showed no contacts [E22]. This is a prediction about wild-type Arg28, not a measurement of the variant.

## Updated decision
H1 was favoured before the test and remains favoured after it. The decision did not change [H1][T1]. H1 is supported; H2 and H3 are unchanged [T1]. No reopening was needed because the test completed, H1 was not weakened, and the favourite did not change.

## Uncertainty and validation still needed
The contact result comes from crystal structures, many of which carry synthetic analogues, so it does not show that His at 28 weakens binding [T1]. Whether R28H changes the predicted local structure is unanswered, because T4 did not run [A1][T4]. The computational scores [E13][E15] are predictions and have not been validated experimentally. Nothing here has been tested in a laboratory.

## Next experiment
Measure binding of wild-type and R28H PH domain to Ins(1,3,4,5)P4 by ITC or SPR, with R28C as a control [H1]. A clearly weaker R28H affinity would support H1; equal affinities would weaken it. T4 can be re-proposed once fresh approval is granted and a provider answers [T4].
