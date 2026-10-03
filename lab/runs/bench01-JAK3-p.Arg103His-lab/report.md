## Question
What molecular mechanism best explains the loss of function of JAK3 p.Arg103His (P52333), and can one targeted computational test check it? [E1]

## Evidence
ClinVar lists the variant as Pathogenic, with multiple submitters and no conflicts [E1]. Residue 103 lies in the annotated FERM domain, residues 24-356 [E4, E7]. No experimental structure in the Protein Data Bank observes residue 103 [E17, G4]. No retrieved paper reports R103H, or any change at residue 103, in a functional or structural assay [G1]. The AlphaFold model AF-P52333-F1 covers the full sequence, mean pLDDT 85.69 [E18]. AlphaMissense and EVE score the variant as likely pathogenic; these are computational predictions only [E12, E16].

## Agent-generated hypotheses
- H1 (stability/folding, agent-generated hypothesis): R103H is a buried-core substitution that destabilises the FERM fold [H1]. Favoured before the test, starting rank 1.
- H2 (protein interaction, agent-generated hypothesis): R103H removes a surface contact needed for gamma-chain or cytokine-receptor coupling [H2].
- H3 (domain interface, agent-generated hypothesis): R103H breaks a FERM-SH2 or FERM-kinase contact [H3].

## Tests considered and the choice
T1 (stability_effect) was chosen: it had the best learning-to-cost score, needed no compute seconds and no approval, and safety cleared it [T1]. T2 (structural_context) was kept as a follow-up because its interface readout is not covered for this residue [T2]. T3 (structure_comparison) was rejected because the provider was down and it needed approval and 120 compute seconds [T3].

## Result
FoldX predicts a ΔΔG of +4.15 kcal/mol for R103H on AF-P52333-F1, above the 2.0 kcal/mol destabilising threshold, at a local pLDDT of 95.88 [T1, E21]. R103C at the same residue gives +2.02 kcal/mol [E22].

## Updated decision
H1 was favoured before the test and remains favoured after it, so the decision did not change [H1]. H1 is supported; H2 and H3 are unchanged because T1 does not measure their contacts [H2, H3]. No reopening was needed.

## Uncertainty and validation still needed
This is one FoldX run on one predicted model, so it is a computational prediction, not an experimental measurement. It does not show that R103H is misfolded or degraded in cells. Relative solvent exposure and side-chain partners of R103 were not measured, so H1's refute check has not been run. H2 and H3 remain untested. No experimental validation has been done.

## Next experiment
Compute relative SASA and side-chain partners of R103 on AF-P52333-F1, together with the T2 pocket and interface readout [H1, T2]. H1 is refuted if SASA is above 25% with no polar partner. An experimental stability or expression assay on R103H would be the validation step.
