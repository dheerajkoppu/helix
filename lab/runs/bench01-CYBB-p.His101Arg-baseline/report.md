## Question
What molecular mechanism best explains loss of function of CYBB p.His101Arg (NOX2 / gp91phox, UniProt P04839), and which single test checks it? This is a research question only; no recommendations are made.

## Evidence
ClinVar classifies NM_000397.4:c.302A>G (p.His101Arg) as Pathogenic with no conflicts [E1]. UniProtKB annotates residue 101 as an axial binding residue for heme b on experimental evidence [E2], and lists the H-to-R change as a natural variant causing X-linked chronic granulomatous disease [E3]. AlphaMissense scores the substitution 0.9975 [E4]. CYBB is the catalytic subunit that passes electrons from FAD through two hemes to O2 [E7], and residue 101 lies in a predicted helix spanning residues 96 to 130 [E8]. A 2022 cryo-EM study links NOX2 deficiency mutations to chronic granulomatous disease [E9]. No literature measuring the H101R mutant was found [G1].

## Agent-generated hypotheses
[H1] (ligand binding, favoured): loss of the axial histidine removes heme b coordination, so electron transfer and superoxide output fail. [H2] (stability): a charged arginine destabilises the transmembrane helix. [H3] (protein interaction): the variant disrupts the CYBA interface. No retrieved source places residue 101 at the CYBA interface [G2].

## Tests considered and the choice
Three tests could run now: ligand contact [T1], stability [T2] and structural context [T3]. Structure comparison was blocked because the ESM Atlas service did not answer. T1 was chosen because it tests the favoured mechanism directly, costs no compute and needs no approval. T2 was rejected because its error is near 1 kcal/mol, and T3 because interface coverage for residue 101 is absent.

## Result
Residue 101 lies within 2.0 to 2.12 Å of HEM in all five ligand-bound structures [T1]. No negative-control ligand contacts the residue [T1].

## Updated decision
H1 remains favoured [T1]. The contact supports axial heme coordination, but H2 and H3 were not measured, so their ranking is unchanged.

## Uncertainty and validation still needed
The contact is measured on the reference residue, not the arginine variant, so it does not show heme loss for H101R. The test cannot separate H1 from H2 or H3. Validation needs the stability test [T2], an interface check, and ideally a measured heme incorporation or superoxide assay on the mutant.

## Next experiment
Run the stability test [T2] to test H2. A neutral value together with no interface membership would leave H1 as the only mechanism the data support. A destabilising value at or above threshold would raise H2.
