## Question
Which molecular mechanism best explains loss of function of BTK p.Arg28His (UniProt Q06187, residue 28), and which single computational test discriminates between the candidates? These are agent-generated hypotheses for research only.

## Evidence
ClinVar classifies NM_000061.3 c.83G>A (p.Arg28His) as Pathogenic with no conflicts [E1]. UniProtKB lists the variant as a moderate X-linked agammaglobulinemia variant [E2]. UniProtKB annotates residue 28 as an experimental binding site for inositol 1,3,4,5-tetrakisphosphate within the PH domain, residues 3-133 [E3, E4]. AlphaMissense scores the substitution 0.9978 [E5], and ScoreCons gives residue 28 a conservation of 0.962 [E6]. A 2013 molecular dynamics study examined the inositol-phosphate site in R28C/H mutants [E10]. No measured stability value or R28H-specific structure was found [G1, G2].

## Agent-generated hypotheses
H1 (ligand binding, starting rank 1): the arginine side chain contacts the inositol phosphate head group, so R28H loses lipid-dependent membrane recruitment [H1].
H2 (stability, rank 2): R28H destabilises the PH fold [H2].
H3 (protein interaction, rank 3): R28H disrupts a PH-domain surface used for partner binding [H3].

## Tests considered and the choice
Four tests were available: ligand contact, stability, structural context, and reference-versus-variant structure prediction, which needs approval and 120 compute seconds [T1, T2, T3, T4]. The ligand contact test was chosen because it has the highest expected learning, needs no approval and costs no compute time [T1].

## Result
Residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures [T1]. The inositol phosphate 4IP contacts it at a minimum of 2.75 Å in 4 of 6 instances [T1]. The ion controls ZN and MG never neighbour residue 28 [T1]. The four R28C-mutated structures show no ligand contact [T1].

## Updated decision
H1 remains favoured because the measured contact supports it [T1, H1]. H2 and H3 are unchanged, since the ligand test measures neither stability nor interfaces [T1]. The favoured hypothesis did not change [decision].

## Uncertainty and validation still needed
The contact test uses crystal structures with soluble ligands, not binding by the variant protein [T1]. The R28C structures carry a different substitution, and no R28H structure exists in the record [G2]. Loss of contact has not been shown to cause loss of function. Validation still needed: a stability measurement to exclude H2, and binding measurements of R28H against inositol phosphate.

## Next experiment
Run the FoldX stability test on R28H and the other residue-28 substitutions [T2]. A neutral predicted change would leave H1 leading; a destabilising value would raise H2 as a co-mechanism.
