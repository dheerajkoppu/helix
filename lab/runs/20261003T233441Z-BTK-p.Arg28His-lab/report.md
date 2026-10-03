## Question
Which molecular mechanism best explains the loss of function of BTK p.Arg28His (UniProt Q06187), and does one targeted computational test change the starting conclusion? [E5, E6]

## Evidence
ClinVar classifies the variant as Pathogenic with multiple submitters and no conflicts [E5]. UniProt lists it as a natural variant in X-linked agammaglobulinemia [E6]. Literature reports that R28H impairs PH-TH dimerization [E1] and classes R28C/H as functional rather than folding mutants [E2]. Residue 28 is observed in 39 of 170 experimental structures [E12]. AlphaMissense predicts pathogenicity of 0.9978, a prediction only [E9]. No retrieved record measures R28H binding to inositol phosphates directly [G1], and fold stability is not separated from dimerization [G2].

## Agent-generated hypotheses
H1 (protein interaction at the PH-TH dimer interface) was ranked first [H1]. H2 (ligand binding to the inositol phosphate head-group site) was ranked second [H2]. H3 (fold destabilisation) was ranked third [H3].

## Tests considered and the choice
The planner scored four tests. T1 (ligand contact) was chosen first, with the highest expected learning [T1]. T2 (stability), T3 (structural context) and T4 (structure comparison) were the alternatives [T2, T3, T4]. T3 could not return a positive H1 result because residue 28 is not covered for interface [T3, G3].

## Result
T1 found residue 28 within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, closest at 2.58 Å to 4PT in 2Z0P and 2.75 Å to 4IP in 1BWN [T1, E20, E21]. Negative-control ligands never contacted it, and the R28C structures showed no contacts [T1, E22]. This is a distance survey, not a measurement on R28H.

## Updated decision
Before T1, H1 was favoured [H1]. After T1, H2 was favoured and the decision changed [T1, H2]. The reopened round chose T2, a FoldX prediction of −0.76 kcal/mol for R28H, below the 2.0 kcal/mol threshold [T2, E23]. This weakened H3 [H3]. H2 stayed favoured [T2, H2]. H1 is untested, not refuted [H1].

## Uncertainty and validation still needed
The T1 contacts come from wild-type and R28C structures; no R28H structure is in the set [T1, E12]. FoldX has an error of about 1 kcal/mol, so the T2 value is a prediction and not clearly neutral [T2]. Neither the contact nor the stability result has been validated experimentally, and the ligand-binding effect of R28H is unmeasured [G1, H2].

## Next experiment
A laboratory binding measurement for H2: isothermal titration calorimetry or SPR of Ins(1,3,4,5)P4 against wild-type, R28H and R28C PH-TH domains [H2]. Prediction, not yet measured: R28H binds at least 3-fold weaker than wild type [H2]. Binding within about 2-fold of wild type would overturn H2 [H2].
