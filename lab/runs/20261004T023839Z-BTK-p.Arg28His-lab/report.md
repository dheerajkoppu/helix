## Question
For BTK p.Arg28His (Q06187, R28H), which mechanism best explains the effect on the protein, and what could a drug act on to correct it? Both parts are research hypotheses only.

## Evidence
ClinVar lists this variant as Pathogenic with multiple submitters and no conflicts [E3]. UniProt records it as an X-linked agammaglobulinemia natural variant [E6]. Residue 28 lies in the PH domain [E10, E11], and that domain mediates the membrane association that activation depends on [E4]. A literature simulation groups R28C/H as functional mutations affecting inositol-phosphate binding, not folding [E2]. AlphaMissense (0.9978) and popEVE (-5.634) predict damage; these are computational predictions, not validated results [E12, E13]. No retrieved paper measures R28H directly [G1], and whether it acts through affinity or folding is unresolved [G2]. No functional assay covers residue 28 [G5].

## Agent-generated hypotheses
Three agent-generated hypotheses were raised: H1 ligand binding (rank 1), H2 stability/folding (rank 2) and H3 domain interface (rank 3) [H1, H2, H3].

## Tests considered and the choice
Three tests were considered: ligand contact [T1], stability effect [T2] and structural context [T3]. T1 was chosen for the highest expected learning at zero compute cost, and safety cleared it with no approval needed [T1].

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures [T1, E20]. Inositol phosphate 4IP contacts it at 2.75 Å in PDB 1BWN [E21]. The four R28C structures show no contacting ligand [E22]. This is a structural proximity result, not a measured binding affinity for R28H.

## Updated decision
Before the test, H1 was favoured [H1]. After it, H1 is still favoured and its verdict is supported; H2 and H3 are unchanged [H1, H2, H3, T1]. The decision did not change. No reopening was needed, because the test completed and H1 was not weakened.

## Candidates
The lab's target rationale is R1: for H1, the direction needed is decreased BTK activity, so a correcting action must restore or bypass PH-domain membrane anchoring, which means increasing activity [R1]. The direction filter examined 4 bridged rows. The CD79B pathway node and the HSP90AB1 interaction partner are unknown, and the BTK- and SYK-directed rows oppose the required action [G7]. No candidate was cleared, so no C record exists. The safety review of this proposal was refused for length and is not on record, and the ruled-out list is empty, so the rejections are visible only in G7. No molecule is named. Nothing here is a Helix candidate or a recommendation.

## Uncertainty and validation still needed
T1 shows proximity to ligands, mostly synthetic ones, not binding of inositol phosphate by the variant [T1, E20]. A cited E41K paper is about a different residue, so it does not directly support H3 [E7]. Experimental validation is still needed: binding of purified R28H versus wild type to inositol phosphate, a folding control, and a membrane recruitment assay in cells [G1, G5, H1]. All computational predictions remain unvalidated.

## Next experiment
Measure binding of purified PH domain R28H against wild type to inositol phosphate, with a thermal-stability check on the same preparations [H1, H2]. H1 is supported if binding is clearly weaker while stability is near wild type, and refuted if binding matches wild type.
