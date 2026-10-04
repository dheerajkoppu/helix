# Question
What mechanism best explains BTK p.Arg525Gln (Q06187), and which candidate targets and molecules does that mechanism point to? [E2][E4]

# Evidence
ClinVar classes the variant as pathogenic or likely pathogenic, with multiple submitters and no conflicts [E1]. UniProt records the substitution as disturbing ATP-binding [E2] and annotates residues 524–526 as helix [E4] and 517–529 as the kinase active site [E7]. Computational predictions are strongly deleterious: AlphaMissense 0.9976 [E9], EVE 0.95 [E14], popEVE -6.456 [E13]. These are predictions, not measurements. Residue 525 is highly conserved (ScoreCons 0.967) [E11]. The variant is absent from gnomAD v4.1 and no functional assay covers residue 525 [G4]. No retrieved publication studies R525Q directly [G1].

# Agent-generated hypotheses
Three agent-generated hypotheses were formed. H1 (ligand binding): Arg525 lines the ATP pocket, and the Gln substitution weakens nucleotide binding [H1]. H2 (stability): loss of helix contacts destabilises the fold [H2]. H3 (domain interface): the substitution breaks an SH2–kinase contact [H3]. H1 was ranked first at the start [H1].

# Tests considered and the choice
Four tests were considered: T1 (ligand contact), T2 (stability), T3 (structural context) and T4 (structure comparison) [T1][T2][T3][T4]. T1 was chosen for its highest expected learning (0.6), high feasibility (0.9), zero compute seconds and no approval need. T4 was rejected: it needed approval and 120 compute seconds, with only a cached provider available. Safety cleared T1 [T1].

# Result
Residue 525 lies within 4.5 Å of an organic ligand in 8 of 40 ligand-bound wild-type BTK structures [T1]. The closest contact is 2.69 Å to ligand 73T in PDB 5T18 [E20], and 2.92 Å to ligand 7GB in PDB 5P9M [E21]. The negative-control ligands never contacted the residue [E21]. No structure carried R525Q [G5].

# Updated decision
Favoured before the test: H1. Favoured after: H1. Decision changed: no [H1][T1]. H1 is supported, and H2 and H3 are unchanged because T1 did not test them [H2][H3]. No reopening was needed: the test completed, H1 was not weakened and the favourite did not change.

# Candidates
The direction rule for H1 is decreased activity, so the required action is restore at the ATP-pocket node around Arg525 [R1]. Translator proposals were rejected by safety, with none cleared [G8]. The direction filter ruled out two rows, CD79B-linked and HSP90AB1-linked, as direction_unknown [ruled_out]. The record holds four rows that read unknown on direction [G7]. No candidate is recorded. Any candidate would be a Helix hypothesis, not a recommendation.

# Uncertainty and validation still needed
All R525Q evidence is predictive or inferred. T1 used wild-type structures and inhibitor contacts, not ATP, so it does not show that R525Q weakens binding [E20][E21]. No experiment has been run. H2 and H3 remain untested. Clinical significance was not assessed.

# Next experiment
In the lab, express wild-type and R525Q BTK kinase domain, then run ATP titration to measure apparent Km and activity, and differential scanning fluorimetry for melting temperature [H1][H2]. H1 predicts raised ATP Km with normal folding; H2 predicts a clear drop in melting temperature.
