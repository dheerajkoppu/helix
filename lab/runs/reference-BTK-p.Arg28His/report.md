## Question
What molecular mechanism best explains the loss of function of BTK p.Arg28His (UniProt Q06187), and can one targeted computational test discriminate the candidates? [E2]

## Evidence
ClinVar and UniProt both associate R28H with X-linked agammaglobulinemia [E1, E2]. Residue 28 lies in the PH domain (residues 3–133) [E5] and is annotated as an inositol-1,3,4,5-tetrakisphosphate binding site [E6]. One literature report states that R28H impairs BTK activation by preventing PH-TH dimerization [E9]. Computational predictions, not validated experimentally: AlphaMissense 0.9978 [E8] and popEVE −5.634 [E12]. gnomAD lists one observed allele [E3]. No experimental binding measurement for R28H was found [G1].

## Agent-generated hypotheses
H1 (PH-TH dimer disruption) ranked first at the start [H1]. H2 (inositol-phosphate pocket binding) ranked second [H2]. H3 (folding destabilisation) ranked third [H3].

## Tests considered and the choice
Round 1 chose T1, a ligand-contact test that discriminates H2 from H1 [T1]. T2, T3 and T4 were considered and not run [T2, T3, T4]. The choice was reopened once, with H1 as the reopened hypothesis, because the favourite changed. The reopened round chose T2, a structural-context test that discriminates H1 from H2 [T2].

## Result
T1: residue 28 lies within 4.5 Å of an organic ligand in 32 of 39 ligand-bound structures, closest at 2.58 Å to 4PT in 2Z0P [E19]. The inositol-phosphate ligand 4IP contacts it at 2.75 Å in 1BWN [E20]. Negative-control ligands never contacted it [T1]. The R28C-mutant structures show no ligand contact [E21].
T2: residue 28 lies in one predicted pocket of the AlphaFold model and in none of the 13 P2Rank pockets [E22, E23]. No predicted protein-protein interface contains it [E23].

## Updated decision
Favoured before the first test: H1 [T1]. Favoured after it: H2, a changed decision [H2]. In the reopened round, H2 stayed favoured and H1 was weakened, so the decision did not change again [H1, H2, T2]. Decision changed: yes (round 1), no (round 2).

## Uncertainty and validation still needed
The ligand contacts come from wild-type or analogue crystal structures, not from R28H, and the 4.5 Å threshold counts any ligand atom [T1]. T2 used a monomer model, and its interface check was not covered [T2]. No experimental R28H binding or dimer measurement exists [G1]. H3 remains untested [T3]. All predictions above are unvalidated experimentally.

## Next experiment
A computational R28H binding test on the IP4-bound structure 1B55: compare phosphate-oxygen contacts and binding free energy for wild type and R28H, and count dimer-interface contacts to test H1 [E17]. Refutation criteria are recorded for both H1 and H2 [H1, H2]. It has not been run.
