## Question
Which molecular mechanism best explains the loss of function of BTK p.Arg28His (UniProt Q06187), and does one targeted computational test change the starting conclusion? [E2]

## Evidence
UniProtKB lists R28H as a natural variant linked to X-linked agammaglobulinemia [E2], and ClinVar records it as Pathogenic with multiple submitters and no conflicts [E1]. One primary article reports that R28H impairs BTK activation by preventing PH-TH dimerization [E6], and that an IP6-dependent PH-TH dimer is required for activation [E8]. UniProtKB annotates residue 28 as an inositol-phosphate binding site [E5]. AlphaMissense (0.9978) [E9] and popEVE (-5.634) [E13] are computational predictions, not validated. No experimental binding or dimerisation data for R28H were retrieved [G1][G2], and no structure of R28H was found [G3].

## Agent-generated hypotheses
Three agent-generated hypotheses were formed: H1, protein interaction (dimer disruption), ranked 1; H2, ligand-binding loss, ranked 2; and H3, stability/folding, ranked 3 [H1][H2][H3].

## Tests considered and the choice
T1 (ligand_contact) was chosen because it costs no compute seconds and needs no approval [T1]. T2 (stability effect) was rejected for now because it mainly bears on H3, which ranks third [T2]. T3 (structural context) was rejected because its expected learning is low [T3]. T4 (structure comparison) was rejected because it needs approval and 120 compute seconds and cannot model the dimer partner [T4]. Safety cleared T1.

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, with the closest contact at 2.58 Å to 4PT in 2Z0P [E19][T1]. It is 2.75 Å from 4IP in 1BWN [E20]. In the R28C structure 6TT2 the site has no ligand contacts, but that structure contains no inositol phosphate [E21]. This is a wild-type co-occurrence check and does not show that R28H changes ligand binding.

## Updated decision
Favoured before the test: H1. Favoured after: H1. Decision changed: no [T1]. H2 was supported as a wild-type contact, H1 stays favoured with a narrower margin, and H3 is unchanged. No reopening was needed, because the test completed and the favoured hypothesis neither changed nor was refuted.

## Uncertainty and validation still needed
These are computational predictions and have not been validated experimentally. T1 cannot separate H1 from H2, and the 4.5 Å threshold does not establish a side-chain contact [T1]. Most contacting ligands are synthetic compounds, so the pocket may not be the physiological site. Dimerisation and binding of R28H have not been measured [G1][G2].

## Next experiment
Laboratory comparison of wild-type and R28H PH-TH constructs: dimerisation by SEC-MALS or analytical ultracentrifugation with and without IP6, and IP4/IP6 binding by ITC or SPR [H1][H2]. Prediction, not yet tested: if H1 holds, R28H loses IP6-dependent dimerisation while keeping near-wild-type IP4 binding; if H2 holds, R28H shows reduced ligand affinity.
