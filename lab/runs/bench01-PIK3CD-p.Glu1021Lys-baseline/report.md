## Question
Which molecular mechanism best explains the loss of function of PIK3CD p.Glu1021Lys, and can one targeted computational test separate the candidates? The premise conflicts with the record: the curated annotation describes gain of function [E2], and no record here supports loss of function [G1].

## Evidence
ClinVar lists the variant as Pathogenic with expert-panel review [E1]. UniProtKB annotates E1021K as gain of function causing enhanced membrane association and kinase activity [E2]. Residue 1021 sits in the catalytic domain (745-1027) within a helix annotated at 1008-1031 [E5]. AlphaMissense gives 0.9748 and EVE 0.681 [E3, E4]. The AlphaFold model has mean pLDDT 87.94 [E8]. Twenty PDB structures observe the residue, none mutated [E6]. A 2026 case series reports three patients with this variant [E9], and a PNAS study ties APDS to activation of PI3K-delta [E10].

## Agent-generated hypotheses
H1 (ligand binding): a new lipid or pocket contact at the membrane face drives membrane association [E2]. H2 (protein interaction): the lysine relieves a partner restraint on the catalytic domain [E2, E10]. H3 (stability): charge reversal destabilises the helix, which would fit the stated premise [E3, E5].

## Tests considered and the choice
Four tests were listed [T1-T4]. I chose T1, ligand contact, because it needs no compute or approval and uses experimental structures [T1]. T4 costs 120 of 300 compute seconds and needs approval [T4].

## Result
Residue 1021 lies within 4.5 Å of no non-solvent ligand across 20 ligand-bound structures [T1].

## Updated decision
H1 is weakened, not refuted, because the ligands are soluble ATP-site inhibitors [T1]. H2 is now favoured by elimination, with no positive support yet [D1]. H3 is unchanged.

## Uncertainty and validation still needed
The test cannot detect membrane lipid contacts or partner contacts, and absence of contact is not absence of binding [T1]. The mechanism is unresolved, and the premise of loss of function is unsupported [G1]. No functional assay covers the residue [G2].

## Next experiment
Run the structural context test [T2] for predicted interface membership, then the FoldX stability test [T3]. Interface membership would support H2; a neutral FoldX value would weaken H3.
