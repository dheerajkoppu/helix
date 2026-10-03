## Question
What molecular mechanism best explains the loss of function of FOXP3 p.Ala384Thr (UniProt Q9BZS1), and which single computational test best discriminates between mechanisms? [E1, E4]

## Evidence
ClinVar classifies the variant as pathogenic/likely pathogenic, with multiple submitters and no conflicts [E1]. UniProtKB annotates it in IPEX with no loss of protein expression [E2], so reduced abundance alone does not explain the phenotype. Residue 384 lies in a helix (381-391) within the forkhead domain (337-423) [E4]. AlphaMissense scores the substitution 0.9921 and EVE 0.785, with conservation 1.0 [E3, E13]. Two experimental structures, 3QRF and 4WK8, observe the residue in domain-swapped dimers [E5, E6], and UniProtKB states that homodimerization is essential for activity [E7]. The AlphaFold model is low confidence overall (mean pLDDT 56.72) [E12]. No retrieved source measures stability, DNA binding or dimerization for this variant [G1].

## Agent-generated hypotheses
H1 (protein interaction): the dimer interface is weakened [E5, E6, E7]. Ranked first.
H2 (stability/folding): the forkhead helix is destabilised [E3, E4, E2]. Ranked second.
H3 (nucleic acid binding): DNA contact is lost [E6, E11]. Ranked third.

## Tests considered and the choice
Four candidates were recorded [T1, T2, T3, T4]. T1 (structural context) was chosen because it needs no compute or approval and directly tests H1. T2 (stability) was deferred because H1 was favoured at the time. T3 needed approval, 120 compute seconds and a provider that was not responding. T4 tests ligand contact, which no hypothesis predicts.

## Result
Ala384 lies in none of the three P2Rank pockets, but in ProtVar pocket 13, which is buried (0.84) and modelled with mean pLDDT 87.9 [T1]. ProtVar places the residue in no predicted protein-protein interface [T1].

## Updated decision
The favoured hypothesis changed from H1 to H2 [T1, E7]. The interface test contradicted H1, and the buried, confidently modelled pocket is consistent with H2 [T1].

## Uncertainty and validation still needed
T1 is a prediction on a monomer model, which cannot represent the domain-swapped dimer seen in 3QRF and 4WK8 [E5, E6, E12]. It does not measure stability [G1]. Whether A384T is one of the six engineered mouse mutations is unknown [G2, E8].

## Next experiment
Run the FoldX stability test (T2), a computational test that needs no approval. A destabilising value with pLDDT above 70 would support H2 [T2]. A neutral value would weaken H2 and call for a dimer-contact measurement that the monomer model cannot provide [T1].
