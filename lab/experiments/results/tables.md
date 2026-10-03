### Arms

| Measure | Specialist lab | Single agent |
| --- | --- | --- |
| Runs succeeded / planned | 13 / 13 | 13 / 13 |
| Failed attempts | 1 | 0 |
| Complete cited records | 13 | 13 |
| Median wall seconds | 198.5 | 84.2 |
| Wall seconds, min to max | 172.9 to 285.8 | 75.2 to 102.3 |
| Median seconds to first hypothesis | 68 | 35 |
| Median seconds to first plan | 104 | 52 |
| Median seconds to first result | 132 | 60 |
| Median seconds to first decision | 158 | 65 |
| Median seconds to final report | 195 | 76 |
| Mean lab tool calls | 99.62 | 39.62 |
| Median wall seconds per lab tool call | 2.1 | 2.2 |
| Mean output tokens (Omnigent accounting, sub-agents included) | 41573.8 | 13900.2 |
| Mean cost as reported by Omnigent, USD | 1.01 | 0.33 |
| Mean distinct databases cited | 10.69 | 7.46 |
| Mean distinct databases cited before the first hypothesis | 10.38 | 7.23 |
| Mean databases returned by the scripted pass | 12.77 | 12.77 |
| Mean share of those databases cited | 0.77 | 0.55 |
| Mean evidence items | 22.15 | 11.31 |
| Mean evidence items before the first hypothesis | 19.31 | 11.08 |
| Mean hypotheses | 2.69 | 2.69 |
| Mean tests considered | 3.77 | 3.31 |
| Mean tests executed | 1.23 | 1 |
| Runs with a reopening | 4 | 0 |
| Runs where the favoured hypothesis changed | 4 | 5 |
| Approvals granted / rejected | 1 / 0 | 0 / 0 |
| Policy denials | 12 | 7 |
| Safety reviews with verdict blocked | 2 | 0 |
| Plans whose test did not run | 2 | 0 |
| Agreement with the reference after the test | 5 of 6 | 4 of 6 |
| Agreement with the reference before the test | 5 of 6 | 4 of 6 |
| Agreement, residue-specific reference only | 3 of 3 | 3 of 3 |

### Tool calls by purpose (mean per run)

| Purpose | Specialist lab | Single agent |
| --- | --- | --- |
| retrieval | 14.62 | 9.77 |
| evidence_record | 28 | 14.31 |
| reasoning_record | 13.38 | 11.46 |
| safety | 3 | 2 |
| test | 4.92 | 2.15 |
| coordination | 36.38 | 0.15 |
| omnigent_dispatch | 19.85 | 0 |
| other | 0 | 0 |

### Paired comparison (lab minus single agent, variants where both succeeded)

| Metric | Pairs | Lab higher | Single agent higher | Ties | Median difference | Median ratio lab ÷ single agent | Sign test p |
| --- | --- | --- | --- | --- | --- | --- | --- |
| wall_seconds | 13 | 13 | 0 | 0 | 117.3 | 2.5 | 0.0002 |
| tool_calls | 13 | 13 | 0 | 0 | 53 | 2.33 | 0.0002 |
| distinct_sources | 13 | 12 | 0 | 1 | 3 | 1.43 | 0.0005 |
| evidence_items | 13 | 13 | 0 | 0 | 11 | 2 | 0.0002 |
| starting_evidence_items | 13 | 13 | 0 | 0 | 9 | 1.8 | 0.0002 |
| starting_distinct_sources | 13 | 13 | 0 | 0 | 3 | 1.38 | 0.0002 |
| hypotheses | 13 | 1 | 1 | 11 | 0 | 1 | 1 |
| tests_considered | 13 | 6 | 0 | 7 | 0 | 1 | 0.0312 |
| output_tokens | 13 | 13 | 0 | 0 | 23944 | 2.85 | 0.0002 |

### Per variant

| Variant | Arm | Status | Wall s | Tool calls | Databases | Evidence | Tests chosen | Favoured before | Favoured after | Changed | Reference | Agrees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADA-p.Arg211His | lab | succeeded | 246.6 | 104 | 11 | 20 | ligand_contact, stability_effect | ligand_binding | stability_folding | yes | – | – |
| ADA-p.Arg211His | single agent | succeeded | 93.2 | 42 | 7 | 13 | stability_effect | stability_folding | stability_folding | no | – | – |
| IL2RG-p.Arg226Cys | lab | succeeded | 272.2 | 122 | 13 | 25 | stability_effect, structural_context | stability_folding | protein_interaction | yes | – | – |
| IL2RG-p.Arg226Cys | single agent | succeeded | 75.2 | 36 | 7 | 10 | stability_effect | stability_folding | protein_interaction | yes | – | – |
| BTK-p.Arg28His | lab | succeeded | 179 | 87 | 10 | 21 | ligand_contact | ligand_binding | ligand_binding | no | ligand_binding | yes |
| BTK-p.Arg28His | single agent | succeeded | 84.2 | 39 | 8 | 13 | ligand_contact | ligand_binding | ligand_binding | no | ligand_binding | yes |
| WAS-p.Thr45Met | lab | succeeded | 248.2 | 118 | 13 | 22 | stability_effect, structural_context | protein_interaction | stability_folding | yes | – | – |
| WAS-p.Thr45Met | single agent | succeeded | 88.7 | 41 | 7 | 11 | stability_effect | stability_folding | stability_folding | no | – | – |
| RAG1-p.Arg404Gln | lab | succeeded | 252.7 | 105 | 11 | 22 | stability_effect, stability_effect | nucleic_acid_binding | nucleic_acid_binding | no | nucleic_acid_binding | yes |
| RAG1-p.Arg404Gln | single agent | succeeded | 93.3 | 36 | 6 | 10 | stability_effect | nucleic_acid_binding | nucleic_acid_binding | no | nucleic_acid_binding | yes |
| JAK3-p.Arg103His | lab | succeeded | 172.9 | 87 | 10 | 22 | stability_effect | stability_folding | stability_folding | no | protein_interaction | no |
| JAK3-p.Arg103His | single agent | succeeded | 81.2 | 41 | 8 | 12 | stability_effect | stability_folding | stability_folding | no | protein_interaction | no |
| CYBB-p.His101Arg | lab | succeeded | 189.5 | 91 | 7 | 22 | stability_effect | ligand_binding | ligand_binding | no | ligand_binding | yes |
| CYBB-p.His101Arg | single agent | succeeded | 82.7 | 39 | 5 | 10 | ligand_contact | ligand_binding | ligand_binding | no | ligand_binding | yes |
| STAT3-p.Arg382Trp | lab | succeeded | 212.1 | 92 | 11 | 23 | stability_effect | nucleic_acid_binding | nucleic_acid_binding | no | nucleic_acid_binding | yes |
| STAT3-p.Arg382Trp | single agent | succeeded | 82.7 | 40 | 8 | 12 | stability_effect | nucleic_acid_binding | nucleic_acid_binding | no | nucleic_acid_binding | yes |
| STAT1-p.Arg274Trp | lab | succeeded | 198.5 | 94 | 9 | 23 | stability_effect | protein_interaction | protein_interaction | no | – | – |
| STAT1-p.Arg274Trp | single agent | succeeded | 102.3 | 45 | 9 | 12 | structural_context | protein_interaction | domain_interface | yes | – | – |
| FOXP3-p.Ala384Thr | lab | succeeded | 183.5 | 88 | 10 | 22 | stability_effect | nucleic_acid_binding | nucleic_acid_binding | no | nucleic_acid_binding | yes |
| FOXP3-p.Ala384Thr | single agent | succeeded | 91.7 | 40 | 9 | 13 | structural_context | protein_interaction | stability_folding | yes | nucleic_acid_binding | no |
| CD40LG-p.Thr254Met | lab | succeeded | 285.8 | 123 | 10 | 22 | stability_effect, structural_context | protein_interaction | stability_folding | yes | – | – |
| CD40LG-p.Thr254Met | single agent | succeeded | 82.7 | 39 | 7 | 10 | stability_effect | stability_folding | stability_folding | no | – | – |
| PIK3CD-p.Glu1021Lys | lab | succeeded | 186.6 | 93 | 13 | 23 | structural_context | ligand_binding | ligand_binding | no | – | – |
| PIK3CD-p.Glu1021Lys | single agent | succeeded | 97.8 | 40 | 9 | 11 | ligand_contact | ligand_binding | protein_interaction | yes | – | – |
| CTLA4-p.Arg75Trp | lab | succeeded | 195.6 | 91 | 11 | 21 | stability_effect | protein_interaction | protein_interaction | no | – | – |
| CTLA4-p.Arg75Trp | single agent | succeeded | 78.3 | 37 | 7 | 10 | stability_effect | stability_folding | protein_interaction | yes | – | – |

### Runs citing each database

| Database | Specialist lab | Single agent |
| --- | --- | --- |
| AlphaFold DB | 11 | 7 |
| AlphaMissense | 13 | 13 |
| ClinVar | 13 | 13 |
| EBI ProtVar | 13 | 12 |
| Ensembl VEP | 6 | 0 |
| Europe PMC | 13 | 13 |
| IUIS 2024 classification | 3 | 0 |
| IntAct | 5 | 0 |
| InterPro | 10 | 1 |
| OpenAlex | 10 | 7 |
| PDBe SIFTS | 7 | 8 |
| PrankWeb | 4 | 2 |
| RCSB PDB | 11 | 8 |
| UniProtKB | 13 | 13 |
| gnomAD | 7 | 0 |

### Do the arms name the same mechanism class

| Measure | Variants |
| --- | --- |
| Pairs | 13 |
| Same class favoured before the test | 8 |
| Same class favoured after the test | 10 |
| Same first test chosen | 8 |
| Differ after the test | STAT1-p.Arg274Trp, FOXP3-p.Ala384Thr, PIK3CD-p.Glu1021Lys |

### First test chosen

| Test | Specialist lab | Single agent |
| --- | --- | --- |
| ligand_contact | 2 | 3 |
| stability_effect | 10 | 8 |
| structural_context | 1 | 2 |

### Attempts that did not succeed

| Variant | Arm | Run | Status | Wall s | Error |
| --- | --- | --- | --- | --- | --- |
| STAT3-p.Arg382Trp | lab | bench01-STAT3-p.Arg382Trp-lab | failed | 482.9 | The run ended without a recorded decision. See omnigent.log and final_reply.txt. |

### Repeat study

| Variant | Arm | Run | Status | Wall s | Tool calls | Databases | Evidence | Tests chosen | Favoured before | Favoured after | Changed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTK-p.Arg28His | lab | bench01-BTK-p.Arg28His-lab | succeeded | 179 | 87 | 10 | 21 | ligand_contact | ligand_binding | ligand_binding | no |
| BTK-p.Arg28His | lab | bench01-repeat2-BTK-p.Arg28His-lab | succeeded | 192.5 | 89 | 10 | 21 | ligand_contact | protein_interaction | protein_interaction | no |
| BTK-p.Arg28His | lab | bench01-repeat3-BTK-p.Arg28His-lab | succeeded | 206.1 | 88 | 9 | 23 | ligand_contact | ligand_binding | ligand_binding | no |
| BTK-p.Arg28His | single agent | bench01-BTK-p.Arg28His-baseline | succeeded | 84.2 | 39 | 8 | 13 | ligand_contact | ligand_binding | ligand_binding | no |
| BTK-p.Arg28His | single agent | bench01-repeat2-BTK-p.Arg28His-baseline | succeeded | 85.7 | 41 | 8 | 14 | ligand_contact | ligand_binding | ligand_binding | no |
| BTK-p.Arg28His | single agent | bench01-repeat3-BTK-p.Arg28His-baseline | succeeded | 78.2 | 36 | 7 | 12 | stability_effect | ligand_binding | ligand_binding | no |
