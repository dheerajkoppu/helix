## Question
What molecular mechanism best explains loss of function of BTK p.Arg28His (Q06187), and which single computational test can discriminate it? [E1]

## Evidence
ClinVar classifies this substitution as Pathogenic with no conflicts [E1], and UniProtKB lists it as a moderate X-linked agammaglobulinemia variant [E2]. Residue 28 lies in the PH domain (residues 3-133) [E4] and is annotated as an experimental binding site for inositol 1,3,4,5-tetrakisphosphate [E3]. AlphaMissense scores R28H at 0.9978 [E5], conservation is 0.962 [E6] and popEVE is -5.634 [E7]. Of 170 experimental structures, 39 observe residue 28 [E8]; the IP4-bound PH domain 1B55 is one of them [E9]. The R28C mutant structures are resolved [E10], but no R28H structure was found [G1]. No R28H binding or stability measurement was found [G2, G3].

## Agent-generated hypotheses
H1 (ligand_binding): R28H removes a basic contact in the inositol-phosphate pocket, reducing membrane recruitment [H1]. H2 (stability_folding): the His side chain destabilises the PH fold [H2]. H1 was ranked first on the binding annotation [E3, E9].

## Tests considered and the choice
Three zero-cost, approval-free tests were recorded: ligand contact [T1], FoldX stability [T2] and structural context [T3]. A structure comparison was rejected because it needs approval, 120 compute seconds and an unavailable ESM provider. T1 was chosen because it can overturn the favoured H1; T2 tests only H2 [T2].

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures [T1]. Against IP4 it sits within contact distance in 4 of 6 instances, minimum 2.75 Å, while negative-control ligands never contact it [T1].

## Updated decision
H1 remains favoured [T1]. H2 is unchanged because the contact test does not measure stability [T1].

## Uncertainty and validation still needed
Most contacts involve synthetic compounds rather than IP4, and crystal proximity is not measured binding by R28H [T1]. The R28C structures show no contacts but contain no IP4, so they do not establish loss of IP4 contact [T1]. Validation still needed: the FoldX stability test [T2] and a measured IP4 binding comparison of R28H with wild type [G2].

## Next experiment
Run the FoldX stability test on R28H [T2]. A neutral value with pocket membership from [T3] would keep H1 as the sole explanation; a destabilising value would keep H2 alive as a co-mechanism. The decisive check is a laboratory IP4 binding assay of R28H versus wild type [G2].
