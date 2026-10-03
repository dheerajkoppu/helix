# Variant effect and stability evidence for OrphaFold

Research date: 2026-10-03. Reference variant used for every live test: BTK p.Arg28His (UniProt Q06187, GRCh38 X-101375202-C-T, NM_000061.3:c.83G>A, rs128620185, ClinGen CA255794).

Verification legend used throughout:

- **[curl]** endpoint called from this machine on 2026-10-03, response inspected.
- **[doc]** read from the provider's own page, README, licence file or OpenAPI spec (fetched directly).
- **[unverified]** could not be confirmed; also listed in section 9.

Method note: five `WebSearch` calls (ProteinGym leaderboard, ThermoMPNN, Stability Oracle, newer stability predictors, DDMut) were blocked by the model provider's safety filter. Those queries were not retried. The affected topics were covered by fetching primary sources directly (GitHub raw files, provider sites, Europe PMC). Anything that could not be confirmed that way is in section 9.

---

## 1. Recommendation for OrphaFold

1. **Use EBI ProtVar as the primary per-variant aggregator.** One keyless REST API (CC BY 4.0) returns the genomic mapping, AlphaMissense, ESM-1b LLR, EVE, popEVE, ScoreCons conservation, CADD v1.7, FoldX ddG on AlphaFold models, Missense3D, predicted pockets, predicted interfaces, UniProt curated features, co-located variants and gnomAD AF. All verified live for BTK R28H, with BTK R525Q used for the EVE, Missense3D and interface paths that R28H does not populate.
2. **Take AlphaMissense from the AlphaFold DB per-protein CSV as the authoritative copy** (`amAnnotationsUrl` in `/api/prediction/{accession}`), CC BY 4.0, commercial use allowed. One 240 KB file gives the full 19 x L heatmap.
3. **Call gnomAD GraphQL directly** for allele counts (CC0, v4.1.2). ProtVar's copy is v4.1.0 and carries fewer fields (no hemizygote count).
4. **Call MaveDB directly** for experimental functional evidence. This is the only source class in this document that is a measurement. Coverage is sparse for IEI genes (BTK: SH3 domain only; CARD11 present; STAT1, STAT3, JAK3, IL2RG, RAG1, WAS, CYBB, ADA, CTLA4, PIK3CD: none), so the empty state is the common case and must be designed.
5. **Ship two licence tiers.** Tier A (default, commercial-safe): AlphaMissense, ProtVar-native predictions, EVE, gnomAD, MaveDB, UniProt, locally computed ESM and ThermoMPNN. Tier B (off by default, behind `ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES=true`): CADD, REVEL, PrimateAI-3D, dbNSFP, the precomputed ESM-1b file. Every value carries its own licence in provenance.
6. **Do not bundle FoldX.** The binary is closed-source, academic-only, and time-limited. Retrieve the precomputed FoldX v5.0 ddG from ProtVar. For local stability compute use ThermoMPNN (MIT) first, RaSP (Apache-2.0) second.
7. **Do not present reference-vs-variant structure models as evidence of variant impact.** AlphaFold DB states AlphaFold "has not been validated for predicting the effect of mutations". Section 6 gives the wording and UI rules.
8. **Label every value with one of four evidence classes**: computational prediction, experimental functional evidence, curated database annotation, population observation. Never merge them into one composite score.
9. **Never recompute a class label.** Store the source's own class string and the source's published thresholds; display both. Normalise only the vocabulary (section 3.2).
10. **Skip MyVariant.info** as a runtime source: its dbNSFP is 4.8a and the last build is 2025-06-24.

---

## 2. Worked example: what the sources return for BTK p.Arg28His

All values retrieved on 2026-10-03.

| Evidence class                   | Measure                            | Value                                                                             | Source and record                                              | Licence                           |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Computational prediction         | AlphaMissense pathogenicity        | 0.9978, class `LPath` / `likely_pathogenic` / `PATHOGENIC`                        | AFDB `AF-Q06187-F1-aa-substitutions.csv`; ProtVar; Ensembl VEP | CC BY 4.0                         |
| Computational prediction         | ESM-1b LLR                         | -12.123                                                                           | ProtVar `/score` type `ESM`                                    | upstream file tagged CC BY-NC 4.0 |
| Computational prediction         | popEVE                             | -5.634, `gapFreq` 0.855 (low confidence, gap frequency > 0.5)                     | ProtVar type `POPEVE`; pop.evemodel.org `NP_000052.1.csv`      | not stated                        |
| Computational prediction         | EVE                                | no score at this position                                                         | ProtVar type `EVE` returns `[]`                                | MIT (evemodel.org)                |
| Computational prediction         | CADD v1.7 PHRED                    | 28.9 (raw 5.160420)                                                               | CADD API; ProtVar mapping `caddScore`; Ensembl VEP             | non-commercial                    |
| Computational prediction         | REVEL                              | 0.926                                                                             | Ensembl VEP `REVEL=1`; gnomAD `revel_max`                      | non-commercial                    |
| Computational prediction         | FoldX ddG on AlphaFold model       | -0.755 kcal/mol, residue pLDDT 94.26, fragment F1                                 | ProtVar `/prediction/foldx`                                    | CC BY 4.0 (ProtVar)               |
| Computational prediction         | Predicted pocket membership        | pocket 8, score 889.4 (>800 = high confidence), buriedness 0.80                   | ProtVar `/prediction/pocket`                                   | CC BY 4.0                         |
| Computational prediction         | Predicted interface membership     | none (HTTP 404)                                                                   | ProtVar `/prediction/interaction`                              | CC BY 4.0                         |
| Computational prediction         | Conservation (ScoreCons, UniRef90) | 0.962 on a 0 to 1 scale                                                           | ProtVar type `CONSERV`                                         | CC BY 4.0                         |
| Computational prediction         | phyloP 100-way                     | 6.504                                                                             | UCSC REST `phyloP100way`                                       | UCSC terms                        |
| Experimental functional evidence | MAVE score                         | none: 4 BTK score sets cover the SH3 domain only                                  | MaveDB search + ClinGen lookup (`exactMatch: null`)            | CC0 per set                       |
| Curated database annotation      | UniProt natural variant            | `VAR_006220`, "in XLA; moderate; dbSNP:rs128620185"                               | ProtVar `/function`; EBI Proteins API                          | CC BY 4.0                         |
| Curated database annotation      | UniProt site                       | `BINDING` feature at residue 28 (ECO:0000269, PubMed 10196129); `DOMAIN` PH 3-133 | ProtVar `/function`                                            | CC BY 4.0                         |
| Curated database annotation      | ClinVar                            | variation 11348, Pathogenic, 2 gold stars, last evaluated 2025-02-06              | gnomAD API `clinvar_variant`                                   | NCBI terms (not checked here)     |
| Population observation           | gnomAD v4.1.2 exomes               | AC 1, AN 1,097,783, AF 9.11e-7, hemizygotes 0, homozygotes 0                      | gnomAD GraphQL                                                 | CC0                               |
| Population observation           | gnomAD v4.1.2 genomes              | variant absent (`genome: null`)                                                   | gnomAD GraphQL                                                 | CC0                               |

Why this variant is a good test fixture: every pathogenicity predictor scores it as damaging, while the FoldX ddG is negative (ProtVar's own threshold for "likely to be destabilising" is ddG >= 2 kcal/mol). The residue carries a curated UniProt binding-site annotation. A UI that only showed a stability number would mislead; a UI that shows the classes side by side lets the researcher see that the predicted effect is unlikely to act through fold stability.

---

## 3. Source reference

### 3.1 EBI ProtVar (primary aggregator)

- Base: `https://www.ebi.ac.uk/ProtVar/api` [curl]. OpenAPI: `GET /docs` (JSON, 52 KB). Swagger UI: `/swagger-ui/index.html`.
- Versions [doc, site bundle]: UI 2.0, API 2.0, data release 2.1 = UniProt 2025_01, Ensembl 113, CADD v1.7, popEVE 2025.03, Missense3D 2026.02, dbSNP b156, COSMIC v103, ClinVar 2025-02, gnomAD v4.1.0. A remap to UniProt 2026_01 is announced as under way.
- Licence [doc]: CC BY 4.0 "except where otherwise noted" (`https://ftp.ebi.ac.uk/pub/databases/ProtVar/LICENCE`). Upstream restrictions still apply to redistributed third-party scores (CADD).
- Auth: none. CORS: `access-control-allow-origin: *`. No rate-limit headers returned [curl]; limits [unverified].
- Citation: Stephenson et al., NAR 2024, doi:10.1093/nar/gkae413.

| Purpose                                 | Request                                                                                                                                            | Response shape (observed)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolve any input to genomic + isoforms | `GET /mapping?q=Q06187%20R28H` (also accepts `rs128620185`, `NP_000052.1:p.Arg28His`, `X-101375202-C-T`; optional `assembly=AUTO\|GRCh37\|GRCh38`) | `content.inputs[].{inputStr, format, type, accession, position, refAA, altAA, derivedGenomicVariants[].{chromosome, position, refBase, altBase, variantKey, genes[].{ensg, geneName, reverseStrand, caddScore, isoforms[]}}}`; isoform: `{accession, canonical, isoformPosition, refCodon, variantCodon, refAA, variantAA, consequences, transcripts[].{enst, ensp}, amScore, popEveScore, populationObservationsUri, referenceFunctionUri, proteinStructureUri}` |
| All residue scores                      | `GET /score/Q06187/28?mt=H` (optional `type=CONSERV\|EVE\|ESM\|AM\|POPEVE\|M3D`)                                                                   | array of `{type:"CONSERV", score}`, `{type:"ESM", score}`, `{type:"AM", amPathogenicity, amClass}`, `{type:"POPEVE", mt, gapFreq, popeve, poppedEve, poppedEsm1v, eve, esm1v}`, `{type:"EVE", score, eveClass}`, `{type:"M3D", prediction, damagingFeature}`                                                                                                                                                                                                      |
| FoldX ddG                               | `GET /prediction/foldx/Q06187/28?variantAA=H`                                                                                                      | `[{proteinAcc, position, afId, afPos, wildType, mutatedType, foldxDdg, plddt, numFragments, variantKey}]`                                                                                                                                                                                                                                                                                                                                                         |
| Pockets containing residue              | `GET /prediction/pocket/Q06187/28`                                                                                                                 | `[{structId, pocketId, radGyration, energyPerVol, buriedness, resid[], meanPlddt, score}]`                                                                                                                                                                                                                                                                                                                                                                        |
| Interfaces containing residue           | `GET /prediction/interaction/Q06187/525`                                                                                                           | `[{a, aresidues[], b, bresidues[], pdockq, pdbModel}]`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Interface model file                    | `GET /prediction/interaction/{a}/{b}/model`                                                                                                        | PDB text                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| UniProt function at residue             | `GET /function/Q06187/28?variantAA=H`                                                                                                              | `{accession, entryId, name, lastUpdated, features[].{type, category, description, begin, end, ftId, alternativeSequence, evidences[].{code, source.{name,id,url}}}, comments[], pockets[], foldxs[], interactions, conservScore, eveScore, esmScore, popEveScore, m3dPred}`                                                                                                                                                                                       |
| Co-located variants                     | `GET /population/Q06187/28?genomicVariant=X-101375202-C-T`                                                                                         | `{accession, position, chromosome, genomicPosition, variants[].{alternativeSequence, xrefs[], clinicalSignificances[], association[], predictions[]}, freqMap}`                                                                                                                                                                                                                                                                                                   |
| PDB structures covering residue         | `GET /structure/Q06187/28`                                                                                                                         | `[{experimentalMethod, resolution, pdbId, chainId, start}]`                                                                                                                                                                                                                                                                                                                                                                                                       |
| gnomAD AF                               | `GET /allelefreq/X/101375202?alt=T`                                                                                                                | `[{chr, pos, ref, alt, ac, an, af}]`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Health / release counts                 | `GET /status`, `GET /stats/latest`                                                                                                                 | JSON                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Verified responses:

```bash
curl -s 'https://www.ebi.ac.uk/ProtVar/api/score/Q06187/28?mt=H'
# [{"type":"CONSERV","score":0.962},{"type":"ESM","score":-12.123},
#  {"type":"AM","amPathogenicity":0.9978,"amClass":"PATHOGENIC"},
#  {"type":"POPEVE","mt":"H","gapFreq":0.855,"popeve":-5.634,"poppedEve":-5.505,
#   "poppedEsm1v":-5.762,"eve":8.653,"esm1v":-9.78}]

curl -s 'https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/Q06187/28?variantAA=H'
# [{"proteinAcc":"Q06187","position":28,"afId":"F1","afPos":28,"wildType":"R",
#   "mutatedType":"H","foldxDdg":-0.755036,"plddt":94.26,"numFragments":1,
#   "variantKey":"Q06187:28:H"}]
```

Gotchas found in testing:

- `/score` requires the **one-letter** code. `mt=His` returns HTTP 200 with only the `CONSERV` entry and no error. `/function` and `/prediction/foldx` accept `H`, `His` and `HIS`.
- `/score` without `mt` returns 19 `AM` and 19 `ESM` objects that carry no `mt` field (order matched alphabetical one-letter codes when compared with the AFDB CSV). Always pass `mt`.
- Schema fields `acc`, `pos`, `wt`, `mt` are declared but omitted from `AM`, `ESM`, `CONSERV` objects. Attach them client-side.
- No coverage is signalled three different ways: `[]` with 200 (`/score`, unknown accession, out-of-range position), HTTP 404 with empty body (`/prediction/interaction`), and `null` fields (`/function`).
- `POST /prediction/cadd` is marked WIP and returned an empty body. Read CADD from `genes[].caddScore` in the mapping response.
- popEVE: the value ProtVar returns for R28H equals the "popEVE (unfiltered)" column on pop.evemodel.org; the filtered column there is blank. ProtVar's UI flags `gapFreq > 0.5` as low confidence. Carry `gapFreq` through and apply the same flag.
- FoldX: README (2024) says only pLDDT > 70 positions are included; the 2025.02.10 sample file contains rows with pLDDT 56.9. Read `plddt` on every record and flag values below 70.
- `/structure` returned `start: 27` for UniProt position 28; the semantics of `start` are [unverified].

ProtVar display thresholds (from the site bundle; these are ProtVar's display bins):

| Score            | Bins                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| FoldX ddG        | >= 2 kcal/mol "likely to be destabilising"; otherwise "unlikely to be destabilising"                                                                  |
| popEVE           | < -5.056 severe; -5.056 to -4.617 moderately deleterious; > -4.617 unlikely deleterious; `gapFreq > 0.5` appends "(low confidence)"                   |
| ESM-1b LLR       | 0 to -5 likely benign; -5 to -10 uncertain; -10 to -25 likely pathogenic                                                                              |
| CADD PHRED       | < 15 likely benign; 15-19.9 potentially deleterious; 20-24.9 quite likely deleterious; 25-29.9 probably deleterious; > 29.9 highly likely deleterious |
| Pocket score     | 0-1000; > 800 high confidence; > 900 very high confidence [doc, FTP README]                                                                           |
| Interface pDockQ | > 0.23 high-confidence set [doc, FTP README]                                                                                                          |

Bulk files [curl listing] at `https://ftp.ebi.ac.uk/pub/databases/ProtVar/`:

| File                                                                    | Size   | Columns                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `predictions/stability/2025.02.10_foldx_energy.csv.gz`                  | 1.5 GB | `uniprot_accession, uniprot_position, alphafold_fragment_id, alphafold_fragment_position, wild_type, mutated_type, foldx_ddg, plddt` (FoldX v5.0 on AlphaFold2 models, 208.8 M substitutions) |
| `predictions/pockets/2024.05.28_pockets.tsv.gz`                         | 26 MB  | `struct_id, pocket_id, pocket_rad_gyration, pocket_energy_per_vol, pocket_buriedness, pocket_resid, pocket_pLDDT_mean, pocket_score_combined_scaled`                                          |
| `predictions/interfaces/2024.05.28_interface_summary_5A.tsv.gz`         | 12 MB  | `interaction_id, pdockq, uniprot_id1, uniprot_id2, chain1, chain2, ifresid1, ifresid2, sources, n_references, pdb`                                                                            |
| `predictions/interfaces/af2complexes_interfaces_v1.tsv.gz` (2026-02-09) | 5.3 MB | same layout                                                                                                                                                                                   |
| `mave/2025_10_27_protvar_mave_score.csv.gz`                             | 88 MB  | `urn, variant_num, hgvs_nt, hgvs_pro, is_simple_p, score` (MaveDB mirror)                                                                                                                     |

### 3.2 AlphaMissense

| Route                                | Endpoint / file                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AlphaFold DB per-protein CSV [curl]  | `GET https://alphafold.ebi.ac.uk/api/prediction/Q06187` then follow `amAnnotationsUrl` = `https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-aa-substitutions.csv`                                                                                                    | header `protein_variant,am_pathogenicity,am_class`; 12,521 rows for BTK (19 x 659); classes `LBen`, `Amb`, `LPath`; 242 KB                                                                                        |
| AlphaFold DB genomic CSVs [curl]     | `amAnnotationsHg38Url`, `amAnnotationsHg19Url`                                                                                                                                                                                                                    | header `CHROM,POS,REF,ALT,genome,uniprot_id,transcript_id,protein_variant,am_pathogenicity,am_class`; classes `likely_benign`, `ambiguous`, `likely_pathogenic`                                                   |
| AlphaFold DB per-residue mean [curl] | `GET https://alphafold.ebi.ac.uk/api/annotations/Q06187.json?type=MUTAGEN`                                                                                                                                                                                        | `{accession, id, sequence, annotation[].{type, description:"AM score", source_name, source_url, evidence:"COMPUTATIONAL/PREDICTED", residues[], regions[].{start,end,annotation_value}}}`; residue 28 mean 0.9987 |
| ProtVar [curl]                       | `/score/{acc}/{pos}?mt=X&type=AM`                                                                                                                                                                                                                                 | classes `BENIGN`, `AMBIGUOUS`, `PATHOGENIC`                                                                                                                                                                       |
| Ensembl VEP REST [curl]              | `AlphaMissense=1`                                                                                                                                                                                                                                                 | `alphamissense.{am_class, am_pathogenicity}`                                                                                                                                                                      |
| Bulk [curl, Zenodo API]              | Zenodo record 10813168 (concept DOI 10.5281/zenodo.8208687): `AlphaMissense_aa_substitutions.tsv.gz` (1.2 GB, 216 M substitutions, UniProt canonical), `AlphaMissense_hg38.tsv.gz` (643 MB, 71 M SNVs), `AlphaMissense_isoforms_aa_substitutions.tsv.gz` (2.5 GB) | also `gs://dm_alphamissense`                                                                                                                                                                                      |

- Licence [doc]: predictions CC BY 4.0 (Zenodo metadata `cc-by-4.0`; GitHub README section "AlphaMissense predictions License" names CC BY 4.0). Code Apache-2.0. Model weights are not released, so new predictions cannot be computed.
- Thresholds [doc, Zenodo]: "`likely_benign` if alphamissense_pathogenicity < 0.34; `likely_pathogenic` if alphamissense_pathogenicity > 0.564; and `ambiguous` otherwise". Observed in the BTK file: `LBen` max 0.34, `Amb` 0.3401 to 0.564, `LPath` min 0.5641. Use the class from the file.
- Coverage: UniProt canonical isoforms from release 2021_02, GENCODE V32 transcripts. Check that the AFDB `sequence` matches the current UniProt sequence before trusting position indexing. Isoform scores differ (dbNSFP lists 0.9966, 0.9962, 0.9969, 0.9978 for four BTK transcripts).
- Required disclaimer [doc]: "AlphaMissense has not been validated for, and is not approved for, any clinical use."
- Vocabulary normalisation for OrphaFold: store `likely_benign | ambiguous | likely_pathogenic`; map `LBen/BENIGN/B`, `Amb/AMBIGUOUS/A`, `LPath/PATHOGENIC/P`. Display "likely pathogenic (AlphaMissense class)"; never shorten to "pathogenic".
- Citation: Cheng et al., Science 2023, doi:10.1126/science.adg7492.

### 3.3 ESM-1b, ESM-1v, ESM-2

| Item                                          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Precomputed ESM-1b LLR, human proteome [curl] | Hugging Face Space `ntranoslab/esm_variants`: `ALL_hum_isoforms_ESM1b_LLR.zip` (1.34 GB), `isoform_list.csv` (contains `Q06187` and `Q06187-2`). Direct: `https://huggingface.co/spaces/ntranoslab/esm_variants/resolve/main/ALL_hum_isoforms_ESM1b_LLR.zip`. Inside: `{root}/{uniprot_id}_LLR.csv`, a 20 x L matrix (rows = alternate residue in order `KRHEDNQTSCGAVLIMPYFW`, columns = `"<wt> <pos>"`). Space last modified 2023-10-24. |
| Licence of that file [curl, HF API]           | Space card `license: cc-by-nc-4.0`. Treat as non-commercial.                                                                                                                                                                                                                                                                                                                                                                               |
| Per-variant retrieval [curl]                  | ProtVar type `ESM` (-12.123 for R28H, identical to dbNSFP's canonical-isoform value). ProtVar holds 215.7 M ESM scores.                                                                                                                                                                                                                                                                                                                    |
| Precomputed ESM-1v [curl]                     | Inside popEVE files: column `ESM-1v` / ProtVar `esm1v` (-9.78 for R28H).                                                                                                                                                                                                                                                                                                                                                                   |
| Precomputed ESM-2 for the human proteome      | none found [unverified]                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Model licences [curl]                         | `facebookresearch/esm` LICENSE: MIT. HF `facebook/esm1b_t33_650M_UR50S`, `facebook/esm2_t33_650M_UR50D`, `facebook/esm2_t36_3B_UR50D`: `license: mit`. `facebook/esm1v_t33_650M_UR90S_1`: no licence tag on the card; the source repo is MIT.                                                                                                                                                                                              |
| ESM C / ESM3 licences                         | [unverified] HF API did not return metadata                                                                                                                                                                                                                                                                                                                                                                                                |

Local compute (MIT, CPU-feasible for single proteins) using the reference script from `ntranoslab/esm-variants` (MIT):

```bash
pip install tqdm numpy pandas biopython torch fair-esm
python3 esm_score_missense_mutations.py --input-fasta-file Q06187.fasta --output-csv-file Q06187_esm1b.csv
# output columns: seq_id,mut_name,esm_score   e.g. seq1,F1K,-3.2310808
```

- Score = log-likelihood ratio of alternate vs reference residue; more negative = more damaging. The script takes `--model-name` (default `esm1b_t33_650M_UR50S`), so the same command scores with ESM-1v or ESM-2 checkpoints. Handling of proteins longer than the model's context lives in `esm_variants_utils.py`, which was not inspected; test with a protein above 1,022 residues before relying on it.
- Thresholds: ProtVar bins above. The widely quoted -7.5 cut-off from Brandes et al. is [unverified] in this session.
- Scores computed locally from the MIT model are free of the CC BY-NC tag on the precomputed file. Label them "OrphaFold-computed ESM-1b LLR" with model name, weights hash and script version.
- Citation: Brandes et al., Nat Genet 2023, doi:10.1038/s41588-023-01465-0.

### 3.4 EVE and popEVE

|                   | EVE                                                                                                                                                            | popEVE                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What              | Alignment-based VAE, per-protein                                                                                                                               | EVE + ESM-1v rescaled with UK Biobank presence/absence to a proteome-wide scale                                                                                                                                  |
| Coverage          | 3,211 proteins listed by `GET https://evemodel.org/api/proteins/list/` [curl]; BTK and WASP, STAT1, STAT3, JAK3, RAG1, ADA, IL2RG, FOXP3, CTLA4, PK3CD present | 18,315 entries in `runs.json` [curl], keyed by RefSeq protein                                                                                                                                                    |
| Per-variant route | ProtVar type `EVE` -> `{score, eveClass}` (`BENIGN\|PATHOGENIC\|UNCERTAIN`); Ensembl VEP `EVE=1` -> `eve_score`, `eve_class`                                   | ProtVar type `POPEVE`; Ensembl VEP `EVE=1` also returns `popeve_*` fields                                                                                                                                        |
| Per-protein file  | `https://evemodel.org/api/proteins/web_pid/BTK_HUMAN/download/` returned an **empty zip** (22 bytes); the table endpoint returned 504 then 502 [curl]          | `https://data.evemodel.org/popeve/v1.1/mutations/NP_000052.1.csv` [curl]; columns `mutant, gap frequency, popEVE, popped EVE, popped ESM-1v, EVE, ESM-1v` plus the same five with ` (unfiltered)`                |
| Bulk              | `https://evemodel.org/api/proteins/bulk/download/` (not tested)                                                                                                | `https://data.evemodel.org/popeve/v1.1/downloads/popEVE_ukbb_20250312.zip` (2.9 GB, by RefSeq transcript), `grch38_popEVE_ukbb_20250715.zip` (1.3 GB), `grch38_popEVE_ukbb_20250715.vcf.gz` (1.5 GB) [curl HEAD] |
| Licence           | Site text: "The downloading of this data, and of all other data on this site, falls under the MIT License" [doc]                                               | Code: README says MIT, Zenodo v1.0.0 says GPL-3.0. Score data: no licence statement found [unverified]                                                                                                           |
| Direction         | 0 to 1, higher = more pathogenic                                                                                                                               | more negative = more deleterious                                                                                                                                                                                 |
| Citation          | Frazer et al., Nature 2021, doi:10.1038/s41586-021-04043-8                                                                                                     | Orenbuch et al., Nat Genet 2025, doi:10.1038/s41588-025-02400-1                                                                                                                                                  |

Decision: retrieve both through ProtVar. Treat the evemodel.org backend as unreliable. Show `gapFreq` next to popEVE and mark values with `gapFreq > 0.5` as low alignment coverage.

### 3.5 REVEL, CADD, PrimateAI-3D, dbNSFP

| Resource     | Current version                                                                | Licence (quoted)                                                                                                                                                                                                                                                                               | Retrieval                                                                                                                                                                                                                                                                                                                                                              | OrphaFold tier            |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| CADD         | v1.7 (GRCh37, GRCh38)                                                          | "CADD scores are freely available for all non-commercial applications. If you are planning on using them in a commercial application, please obtain a license." [doc]                                                                                                                          | `GET https://cadd.gs.washington.edu/api/v1.0/GRCh38-v1.7/X:101375202_C_T` -> `[{"Alt":"T","Chrom":"X","PHRED":"28.9","Pos":"101375202","RawScore":"5.160420","Ref":"C"}]` [curl]. Mirror `cadd.kircherlab.bihealth.org`. API is "experimental and not thought to be used for retrieving thousands or millions of variants". Also via ProtVar and Ensembl VEP `CADD=1`. | B                         |
| REVEL        | v1.3 (May 2021)                                                                | "REVEL scores are freely available for non-commercial use. For other uses, please contact Weiva Sieh." [doc]                                                                                                                                                                                   | Ensembl VEP `REVEL=1` -> `revel: 0.926` [curl]; gnomAD `in_silico_predictors` id `revel_max`; bulk `revel-v1.3_all_chromosomes.zip` (526 MB)                                                                                                                                                                                                                           | B                         |
| PrimateAI-3D | scores via Illumina browser                                                    | "freely available for download for academic, non-profit research"; requires accepting an academic licence agreement (Adobe Sign); commercial via AI_licensing@illumina.com [doc]                                                                                                               | no public API; click-through download at `https://primateai3d.basespace.illumina.com/`                                                                                                                                                                                                                                                                                 | B, do not integrate in v1 |
| dbNSFP       | v5.4 (2026-08-01; GENCODE 50 / Ensembl 116; adds GPN-MSA; v5.3.1 added popEVE) | Academic branch: "free of charge for academic and non-commercial use under CC BY-NC-ND 4.0". Commercial branch via Genos Bioinformatics LLC: $5,000/yr internal research, $10,000/yr product development; excludes CADD, VEST, M-CAP, MutScore, PolyPhen-2, PrimateAI, RGC Million Exome [doc] | ~50 GB download gated by institutional email; Ensembl VEP `dbNSFP=<fields>` [curl]                                                                                                                                                                                                                                                                                     | B, do not redistribute    |

- gnomAD-reported CADD for R28H is 26.8 while CADD v1.7 gives 28.9. Predictor versions differ between aggregators; always store the version.
- The ND clause in dbNSFP's academic licence and whether serving values through a public web app counts as redistribution is a legal question [unverified]. Avoid dbNSFP-sourced values in the default tier.
- Citations: CADD v1.7 doi:10.1093/nar/gkad989; REVEL doi:10.1016/j.ajhg.2016.08.016; PrimateAI-3D doi:10.1126/science.abn8197.

### 3.6 Ensembl VEP REST (secondary aggregator and cross-check)

- `GET https://rest.ensembl.org/vep/human/hgvs/ENST00000308731:c.83G%3EA?AlphaMissense=1&REVEL=1&CADD=1&EVE=1&Conservation=1&Blosum62=1&mane=1&uniprot=1&hgvs=1&pick=1` with `Content-Type: application/json` [curl]. Release 116. Also `GET /vep/human/region/X:101375202-101375202:1/T`.
- Returned in `transcript_consequences[0]`: `alphamissense.{am_class,am_pathogenicity}`, `revel`, `cadd_phred`, `cadd_raw`, `eve_score`, `eve_class` (when covered), `popeve_score`, `popeve_eve`, `popeve_esm1v`, `popeve_pop_adjusted_eve`, `popeve_pop_adjusted_esm1v`, `popeve_gap_frequency`, `conservation` (2.98), `blosum62`, `sift_score`, `sift_prediction`, `polyphen_score`, `polyphen_prediction`, `mane_select`, `hgvsp`, `swissprot`, `uniprot_isoform`.
- `EVE=1` is the switch for both EVE and popEVE. `popEVE=1` does nothing.
- Rate limit headers [curl]: `x-ratelimit-limit: 55000`, `x-ratelimit-period: 3600`.
- `colocated_variants` includes HGMD identifiers; HGMD content is licensed. Display IDs only.

### 3.7 MaveDB (experimental functional evidence)

- Base: `https://api.mavedb.org/api/v1` [curl]. OpenAPI: `https://api.mavedb.org/openapi.json`. API version `2026.2.7.4`. Keyless for public data. CORS `*`.
- Size [curl]: 8,569,448 variant measurements; 3,442,148 mapped variants.
- Data licence is **per score set**: `license.shortName` in `CC0 | CC BY 4.0 | CC BY-SA 4.0` (`GET /licenses/active`). All BTK sets are CC0. Server software is AGPL-3.0, which does not affect API clients.
- Citation: Rubin et al., Genome Biol 2025, doi:10.1186/s13059-025-03476-y.

| Step                          | Request                                                                                                 | Response                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find score sets for a protein | `POST /score-sets/search` body `{"text":"Q06187","published":true,"limit":50}` or `{"targets":["BTK"]}` | `{scoreSets[], numScoreSets}`; short set: `urn, title, shortDescription, numVariants, license, targetGenes[].{name, category, externalIdentifiers[].{identifier.{dbName,identifier}, offset}, targetSequence.{sequenceType, sequence}}`                    |
| Score set metadata            | `GET /score-sets/urn:mavedb:00000710-a-1`                                                               | adds `methodText, abstractText, primaryPublicationIdentifiers[], datasetColumns.{scoreColumns,countColumns}, scoreCalibrations[], mappingState, publishedDate, experiment`                                                                                 |
| Scores                        | `GET /score-sets/{urn}/scores`                                                                          | CSV: `accession,hgvs_nt,hgvs_splice,hgvs_pro,score` followed by set-specific columns (e.g. `sigma`, `score_95CI_low`)                                                                                                                                       |
| Mapped coordinates            | `GET /score-sets/{urn}/mapped-variants`                                                                 | array of `{variantUrn, preMapped, postMapped.{expressions[].{syntax:"hgvs.p", value:"NP_001274273.1:p.Tyr257Ter"}}, alignmentLevel, clingenAlleleId, current, mappingApiVersion}` (GA4GH VRS 2)                                                            |
| Functional class thresholds   | `GET /score-calibrations/score-set/{urn}`                                                               | array of `{title, primary, investigatorProvided, researchUseOnly, baselineScore, functionalClassifications[].{label, functionalClassification, range[lo,hi], inclusiveLowerBound, inclusiveUpperBound, acmgClassification, oddspathsRatio, variantCount}}` |
| Direct variant lookup         | `POST /variants/clingen-allele-id-lookups` body `{"clingenAlleleIds":["CA255794"]}`                     | `[{clingenAlleleId, exactMatch, equivalentNt[], equivalentAa[]}]`; each match holds `variantEffectMeasurements[].{urn, data.score_data, hgvsNt, hgvsPro, scoreSet.{urn,title,license}, mappedVariants[]}`                                                  |
| ClinGen ID for a variant      | `GET https://reg.clinicalgenome.org/allele?hgvs=NC_000023.11:g.101375202C>T`                            | `@id` ends in `CA255794` [curl]                                                                                                                                                                                                                            |

BTK results [curl]: `urn:mavedb:00000710-a-1` (BTK SH3 domain, Domainome 1.0 abundance, 1,181 variants), `urn:mavedb:00000183-a-1`, `-a-2`, `-0-1` (BTK trypsin / chymotrypsin / combined proteolysis stability scores, 2,005 variants each). Residue 28 is outside all of them; the ClinGen lookup returns `exactMatch: null`.

Gotchas:

- `hgvs_pro` positions are relative to the assayed target sequence. For `00000710-a-1`, target residue 1 is UniProt residue 215 (`offset: 214`). For `00000183-*` the offset field is 215 with a DNA target. Offsets are inconsistent between sets; align `targetSequence` to the UniProt sequence yourself and verify the reference residue.
- `postMapped` coordinates for BTK are on `NP_001274273.1` (the longer isoform, +34 residues: `p.Tyr257Ter` = canonical 223). Convert to the canonical isoform before joining.
- `GET /genes/BTK` reports `scoreSets: []` even though four sets exist. Use search.
- Score direction and scale are assay-specific. Without a `scoreCalibrations` entry, show the raw score plus its position in the set's synonymous and nonsense distributions; do not attach a benign/pathogenic word.
- Many sets are stability/abundance assays on isolated domains (Domainome 1.0; protease-digestion sets such as BTK `00000183-*`, whose method text describes log10 K50 digestion on target 1QLY and whose record carries no publication identifier). They measure fold stability of an isolated domain, which is distinct from function in the full-length protein. Show the assay type, and expect missing publication metadata.

### 3.8 gnomAD

- Endpoint: `POST https://gnomad.broadinstitute.org/api` (GraphQL, keyless, CORS `*`) [curl].
- Datasets [curl, enum `DatasetId`]: `gnomad_r4` (labelled "gnomAD v4.1.2" in the browser source), `gnomad_r4_non_ukb`, `gnomad_r3`, `gnomad_r2_1`, `exac` and subsets. v4 is GRCh38.
- Licence [doc]: "available free of restrictions under the Creative Commons Zero Public Domain Dedication". Requested acknowledgement: "This tool includes data from the gnomAD v4.1 release." Do not use "gnomAD" in a product name. Some annotations in the response carry their own restrictions (SpliceAI CC BY-NC 4.0; CADD and REVEL as above).
- Rate limits: no headers returned; limits [unverified]. Cache aggressively.

```bash
curl -s https://gnomad.broadinstitute.org/api -H 'Content-Type: application/json' -d '{
 "query":"query V($variantId:String!,$dataset:DatasetId!){ variant(variantId:$variantId,dataset:$dataset){ variant_id reference_genome rsids exome{ac an ac_hemi ac_hom af filters faf95{popmax popmax_population} populations{id ac an ac_hemi ac_hom}} genome{ac an ac_hemi ac_hom af filters} joint{ac an hemizygote_count homozygote_count filters faf95{popmax popmax_population}} in_silico_predictors{id value flags} transcript_consequences{gene_symbol transcript_id is_mane_select hgvsc hgvsp major_consequence} } clinvar_variant(variant_id:$variantId,reference_genome:GRCh38){clinvar_variation_id clinical_significance gold_stars review_status last_evaluated} }",
 "variables":{"variantId":"X-101375202-C-T","dataset":"gnomad_r4"}}'
```

Observed: `exome {ac:1, an:1097783, ac_hemi:0, ac_hom:0, af:9.109e-07, filters:[]}`, `genome: null`, `joint {ac:1, an:1211243, hemizygote_count:0, homozygote_count:0}`, `in_silico_predictors: cadd 26.8, revel_max 0.926, spliceai_ds_max 0.00, pangolin_largest_ds 0.00, phylop 7.76, sift_max 0.00, polyphen_max 0.999`.

- `joint.fafmax` is not a field (HTTP 400); use `faf95 {popmax popmax_population}`.
- A variant missing from gnomAD returns HTTP 200 with `{"errors":[{"message":"Variant not found"}],"data":{"variant":null}}` [curl, X-101375202-C-G]. Present this as "not observed in gnomAD v4.1.2", and show coverage where available; absence differs from an allele frequency of zero.
- For X-linked genes always show the hemizygote count. For IEI genes show homozygote count beside AF.

### 3.9 Residue conservation

| Source                     | Retrieval                                                                                                               | Value for BTK R28 / c.83 | Notes                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProtVar ScoreCons [curl]   | `/score/{acc}/{pos}?type=CONSERV`                                                                                       | 0.962                    | "Inter-species amino acid conservation based on UniRef90 sequence alignments using the ScoreCons algorithm", 0 to 1. Protein-level. CC BY 4.0. Default choice. |
| UCSC phyloP 100-way [curl] | `GET https://api.genome.ucsc.edu/getData/track?genome=hg38;track=phyloP100way;chrom=chrX;start=101375201;end=101375202` | 6.504                    | 0-based half-open coordinates. Nucleotide-level.                                                                                                               |
| Ensembl VEP [curl]         | `Conservation=1`                                                                                                        | 2.98                     | Score from Ensembl Compara.                                                                                                                                    |
| gnomAD [curl]              | `in_silico_predictors` id `phylop`                                                                                      | 7.76                     | Alignment not named in the response.                                                                                                                           |
| AlphaFold DB MSA [curl]    | `msaUrl` = `https://alphafold.ebi.ac.uk/files/msa/AF-Q06187-F1-msa_v6.a3m`                                              | compute locally          | CC BY 4.0. Lets OrphaFold compute per-column entropy or Jensen-Shannon divergence and label it "OrphaFold-computed from AFDB MSA v6".                          |
| popEVE `gapFreq`           | ProtVar                                                                                                                 | 0.855                    | Fraction of gaps at the column; a coverage indicator for alignment-based scores.                                                                               |
| ConSurf-DB                 | not checked                                                                                                             |                          | [unverified]                                                                                                                                                   |

Three different phyloP-like numbers (6.50, 6.54 in dbNSFP, 7.76) appear for the same base. Always store the alignment name.

### 3.10 Stability predictors

| Tool                           | Licence                                                                                                                                                                                                                             | Precomputed data                                                                                                      | How to obtain                                                                                                                                                                                                                                 | Verdict                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| FoldX 5.0 / 5.1                | Academic: "freely available to Academic and Non-Profit Research Institutions for research purposes only"; registration required; compiled binaries only, "we do not provide or sell source code"; commercial licence by quote [doc] | Yes: ProtVar, FoldX v5.0 on AlphaFold2 models, 208.8 M substitutions, CC BY 4.0                                       | ProtVar API or FTP bulk (3.1)                                                                                                                                                                                                                 | Retrieve; do not bundle or run            |
| RaSP                           | Code Apache-2.0 [curl LICENSE]                                                                                                                                                                                                      | Yes: ~230 M variants on AlphaFold2 human proteome at `https://sid.erda.dk/sharelink/fFPJWflLeE` (link live, HTTP 200) | Bulk only; data licence not stated [unverified]                                                                                                                                                                                               | Optional bulk import; licence check first |
| ThermoMPNN                     | MIT [curl LICENSE]; weights `models/thermoMPNN_default.pt` in repo                                                                                                                                                                  | None found                                                                                                            | Local inference on any PDB                                                                                                                                                                                                                    | First choice for local compute            |
| ThermoMPNN-D                   | MIT [curl LICENSE]                                                                                                                                                                                                                  | None found                                                                                                            | `python v2_ssm.py --mode single --pdb model.pdb --batch_size 256 --out model --threshold 100` (default threshold saves only ddG <= -0.5; raise it to keep destabilising substitutions)                                                        | Use its updated single-mutant mode        |
| Stability Oracle               | MIT [curl LICENSE]; graphs on Zenodo                                                                                                                                                                                                | None found                                                                                                            | `scripts/run_stability_oracle.py`                                                                                                                                                                                                             | Later                                     |
| DDMut                          | Terms not stated on the site [unverified]                                                                                                                                                                                           | None                                                                                                                  | Async REST: `POST https://biosig.lab.uq.edu.au/ddmut/api/prediction_single` with `pdb_file` or `pdb_accession`, `chain`, `mutation` (e.g. `H461D`), optional `reverse`; returns `{"job_id": "<id>"}`; poll with GET `job_id` [doc, not exercised] | Do not depend on at runtime               |
| Missense3D                     | via ProtVar                                                                                                                                                                                                                         | Yes (2026.02 release in ProtVar)                                                                                      | ProtVar type `M3D` -> `{prediction, damagingFeature}`                                                                                                                                                                                         | Retrieve                                  |
| Mega-scale stability dataset   | CC BY 4.0 (Zenodo 7992926)                                                                                                                                                                                                          | Experimental stability for small domains; Zenodo deposit (MaveDB link to this paper not confirmed)                    | Zenodo                                                                                                                                                                                                                                        | Experimental class                        |
| Domainome 1.0                  | CC0 in MaveDB                                                                                                                                                                                                                       | Abundance scores for ~500 human domains; in MaveDB                                                                    | MaveDB                                                                                                                                                                                                                                        | Experimental class                        |
| Predictors released after 2024 |                                                                                                                                                                                                                                     |                                                                                                                       |                                                                                                                                                                                                                                               | [unverified], searches blocked            |

Rules:

- A ddG computed on a predicted model inherits that model's uncertainty. Always show model ID, fragment, residue pLDDT, and the tool version next to the number.
- Sign convention: FoldX in ProtVar: positive = destabilising. ThermoMPNN: negative = stabilising, positive = destabilising. Normalise to "positive = destabilising" and record the source convention.
- Stability predictors are silent about variants that act through binding, catalysis or regulation. BTK R28H (ddG -0.76) is the fixture for this message.
- Citations: FoldX doi:10.1093/bioinformatics/btaf064; RaSP doi:10.7554/eLife.82593; ThermoMPNN doi:10.1073/pnas.2314853121; ThermoMPNN-D doi:10.1002/pro.70003; Stability Oracle doi:10.1038/s41467-024-49780-2; DDMut doi:10.1093/nar/gkad472; Mega-scale doi:10.1038/s41586-023-06328-6; Domainome doi:10.1038/s41586-024-08370-4.

### 3.11 ProteinGym takeaways

Source: `OATML-Markslab/ProteinGym` main branch, `benchmarks/DMS_zero_shot/substitutions/Spearman/Summary_performance_DMS_substitutions_Spearman.csv` and `benchmarks/clinical_zero_shot/substitutions/AUC/Summary_performance_clinical_substitutions_AUC.csv`, fetched 2026-10-03 [curl]. README: latest version v1.3; 217 DMS substitution assays, ~2.7 M missense variants; 2,525 clinical proteins; code MIT. 97 models in the zero-shot substitution table.

| Rank | Model                  | Input                | Avg Spearman | Activity | Binding | Expression | Organismal fitness | Stability |
| ---- | ---------------------- | -------------------- | ------------ | -------- | ------- | ---------- | ------------------ | --------- |
| 1    | AIDO Protein-RAG (16B) | structure + MSA      | 0.518        | 0.517    | 0.426   | 0.522      | 0.491              | 0.635     |
| 2    | VenusREM               | structure + MSA      | 0.518        | 0.495    | 0.454   | 0.533      | 0.459              | 0.650     |
| 3    | ProSST (K=2048)        | sequence + structure | 0.507        | 0.476    | 0.445   | 0.530      | 0.431              | 0.653     |
| 5    | S3F-MSA                | structure + MSA      | 0.496        | 0.502    | 0.440   | 0.479      | 0.477              | 0.581     |
| 12   | PoET (200M)            | MSA                  | 0.470        | 0.494    | 0.396   | 0.466      | 0.475              | 0.519     |
| 14   | ESM3 open (1.4B)       | sequence + structure | 0.466        | 0.430    | 0.400   | 0.470      | 0.389              | 0.641     |
| 17   | SaProt (650M)          | sequence + structure | 0.457        | 0.458    | 0.378   | 0.488      | 0.366              | 0.592     |
| 18   | TranceptEVE L          | MSA                  | 0.456        | 0.487    | 0.376   | 0.457      | 0.459              | 0.500     |
| 20   | GEMME                  | MSA                  | 0.455        | 0.482    | 0.383   | 0.438      | 0.452              | 0.519     |
| 26   | EVE (ensemble)         | MSA                  | 0.439        | 0.464    | 0.386   | 0.408      | 0.447              | 0.491     |
| 40   | ESM-IF1                | structure            | 0.422        | 0.368    | 0.389   | 0.407      | 0.324              | 0.624     |
| 45   | ESM2 (650M)            | sequence             | 0.414        | 0.425    | 0.337   | 0.415      | 0.368              | 0.523     |
| 47   | ESM-1v (ensemble)      | sequence             | 0.407        | 0.420    | 0.320   | 0.429      | 0.386              | 0.477     |
| 57   | ESM-1b                 | sequence             | 0.394        | 0.428    | 0.287   | 0.406      | 0.349              | 0.500     |
| 91   | ProteinMPNN            | structure            | 0.257        | 0.197    | 0.163   | 0.198      | 0.164              | 0.565     |

Clinical substitution benchmark (AUC): PoET 0.920, TranceptEVE L 0.920, GEMME 0.919, EVE 0.914, ESM-1b 0.892, PROVEAN 0.886, SIFT 0.878, PrimateAI 0.855. AlphaMissense is absent from both tables.

What this means for the build:

- The best zero-shot model reaches Spearman ~0.52 against experimental assays. Predictor scores are weak-to-moderate evidence and the UI copy should say so.
- Stability assays are the best-predicted category (up to 0.65) and binding the worst (~0.45). Variants at binding sites deserve an explicit caveat.
- The leaders combine structure with alignments. Single-sequence language models (ESM-1b rank 57, ESM-2 650M rank 45) sit mid-table. Retrieval of ESM-1b through ProtVar is adequate; investing in larger single-sequence models locally brings little.
- Inverse-folding models (ESM-IF1, ProteinMPNN) are competitive only on stability, which supports ThermoMPNN as the local stability tool and nothing broader.
- Clinical AUC differences among the top four alignment-based models are within 0.006; showing several of them adds little independent evidence. Show at most one alignment-based and one language-model score by default.
- Citation: Notin et al., NeurIPS 2023, bioRxiv doi:10.1101/2023.12.07.570727.

### 3.12 Sources evaluated and set aside

- **MyVariant.info** [curl]: `GET https://myvariant.info/v1/variant/chrX:g.101375202C%3ET?assembly=hg38` returns a rich `dbnsfp` object (AlphaMissense, REVEL, ESM1b, PrimateAI, MutPred and others). `/v1/metadata` reports dbNSFP 4.8a and build date 2025-06-24, and the values inherit dbNSFP's non-commercial terms.
- **EBI Proteins API** [curl]: `GET https://www.ebi.ac.uk/proteins/api/variation/Q06187?location=28-28` returns UniProt variant features with ClinGen, ClinVar, dbSNP and COSMIC cross-references. Useful as a curated-annotation source; ProtVar `/function` and `/population` already carry the same content.
- **AlphaFold DB text-mined residue annotations**: announced on the AFDB home page as "AI-derived residue annotations - October 2026" (PubMedBERT NER, validated against PDB, mapped through SIFTS). Machine-extracted from literature; if used, label as text-mined, a fifth class.

---

## 4. Licence matrix

| Source                                                          | Licence                                 | Commercial use              | Attribution string to store                                                       |
| --------------------------------------------------------------- | --------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| AlphaMissense predictions                                       | CC BY 4.0                               | yes                         | Cheng et al. 2023; "AlphaMissense Copyright (2023) DeepMind Technologies Limited" |
| AlphaFold DB files and API                                      | CC BY 4.0                               | yes                         | Jumper et al. 2021; Bertoni et al. NAR 2025                                       |
| ProtVar native data (FoldX ddG, pockets, interfaces, ScoreCons) | CC BY 4.0                               | yes                         | Stephenson et al. 2024                                                            |
| EVE scores                                                      | MIT (site statement)                    | yes                         | Frazer et al. 2021                                                                |
| popEVE scores                                                   | not stated                              | unknown                     | Orenbuch et al. 2025                                                              |
| ESM-1b precomputed file                                         | CC BY-NC 4.0 (HF tag)                   | no                          | Brandes et al. 2023                                                               |
| ESM-1b / ESM-2 models, local scores                             | MIT                                     | yes                         | Rives et al.; Lin et al.                                                          |
| CADD                                                            | non-commercial free; commercial licence | no                          | Schubach et al. 2024                                                              |
| REVEL                                                           | non-commercial                          | no                          | Ioannidis et al. 2016                                                             |
| PrimateAI-3D                                                    | academic licence agreement              | no                          | Gao et al. 2023                                                                   |
| dbNSFP academic                                                 | CC BY-NC-ND 4.0                         | no                          | Liu et al.                                                                        |
| MaveDB score sets                                               | CC0 / CC BY 4.0 / CC BY-SA 4.0 per set  | yes (share-alike for BY-SA) | per-set publication + Rubin et al. 2025                                           |
| gnomAD                                                          | CC0                                     | yes                         | "includes data from the gnomAD v4.1 release"                                      |
| UniProt                                                         | CC BY 4.0                               | yes                         | UniProt Consortium                                                                |
| ThermoMPNN, ThermoMPNN-D, Stability Oracle                      | MIT                                     | yes                         | respective papers                                                                 |
| RaSP code                                                       | Apache-2.0                              | yes                         | Blaabjerg et al. 2023                                                             |
| RaSP precomputed data                                           | not stated                              | unknown                     |                                                                                   |
| FoldX software                                                  | academic-only binary                    | no                          | not bundled                                                                       |
| ProteinGym                                                      | MIT                                     | yes                         | Notin et al. 2023                                                                 |

---

## 5. VariantEffectProvider design

### 5.1 Evidence classes and labels

| `evidence_class`                   | UI label                                  | Sources                                                                                                                   | Display rule                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computational_prediction`         | "Computational prediction"                | AlphaMissense, ESM-1b, EVE, popEVE, CADD, REVEL, FoldX ddG, ThermoMPNN ddG, Missense3D, pockets, interfaces, conservation | Always show tool + version + input (sequence, alignment, or structure ID). Sub-label `prediction_kind`: `pathogenicity`, `language_model_llr`, `stability_ddg`, `structural_feature`, `conservation`. |
| `experimental_functional_evidence` | "Experimental functional evidence (MAVE)" | MaveDB                                                                                                                    | Show assay type, score set URN, publication, raw score, calibration class only when `scoreCalibrations` exists.                                                                                       |
| `curated_database_annotation`      | "Curated database annotation"             | UniProt features and variants, ClinVar                                                                                    | Show record ID, evidence code (ECO), PubMed IDs, review status.                                                                                                                                       |
| `population_observation`           | "Population observation"                  | gnomAD                                                                                                                    | Show AC, AN, AF, hemizygotes, homozygotes, dataset version; "not observed" when null.                                                                                                                 |

Additional provenance flag `structure_basis`: `experimental` (PDB ID), `predicted_existing` (AFDB model ID + version), `orphafold_generated` (run ID). FoldX in ProtVar is `predicted_existing` (`AF-Q06187-F1`).

### 5.2 Data model (backend)

```python
class EvidenceClass(StrEnum):
    COMPUTATIONAL_PREDICTION = "computational_prediction"
    EXPERIMENTAL_FUNCTIONAL_EVIDENCE = "experimental_functional_evidence"
    CURATED_DATABASE_ANNOTATION = "curated_database_annotation"
    POPULATION_OBSERVATION = "population_observation"


class Provenance(BaseModel):
    source_name: str                 # "EBI ProtVar"
    source_record_id: str            # "Q06187:28:H"
    request_url: str
    retrieved_at: datetime
    source_release: str | None       # "ProtVar data 2.1"
    upstream_tool: str | None        # "FoldX v5.0"
    structure_basis: Literal["experimental", "predicted_existing", "orphafold_generated"] | None
    structure_id: str | None         # "AF-Q06187-F1"
    license: str                     # "CC-BY-4.0"
    license_url: str
    commercial_use: Literal["allowed", "restricted", "unknown"]
    citation_doi: str | None


class PublishedThreshold(BaseModel):
    label: str                       # as worded by the source
    lower: float | None
    upper: float | None
    defined_by: str                  # "AlphaMissense Zenodo README"


class VariantEffectValue(BaseModel):
    key: str                         # "alphamissense.pathogenicity"
    evidence_class: EvidenceClass
    prediction_kind: str | None
    display_name: str
    value: float | str | None
    unit: str | None                 # "kcal/mol"
    direction: Literal["higher_more_damaging", "lower_more_damaging", "positive_destabilising", "none"]
    source_class_label: str | None   # verbatim: "LPath"
    normalized_class_label: str | None
    published_thresholds: list[PublishedThreshold]
    confidence_flags: list[str]      # ["gap_frequency_above_0.5"]
    status: Literal["ok", "not_covered", "source_error", "disabled_by_license_tier"]
    provenance: Provenance


class ResolvedVariant(BaseModel):
    uniprot_accession: str
    isoform_accession: str
    protein_position: int
    reference_residue: str
    alternate_residue: str
    assembly: Literal["GRCh38"]
    chromosome: str | None
    genomic_position: int | None
    reference_allele: str | None
    alternate_allele: str | None
    mane_select_transcript: str | None
    hgvs_c: str | None
    hgvs_p: str | None
    rsids: list[str]
    clingen_allele_id: str | None


class VariantEffectProvider(Protocol):
    name: str
    license_tier: Literal["open", "noncommercial"]

    async def fetch(self, variant: ResolvedVariant) -> list[VariantEffectValue]: ...
```

### 5.3 Adapters and call plan for BTK p.Arg28His

| #   | Adapter                                                    | Call                                                                             | Produces                                                                                                  |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0   | `ProtVarMappingResolver`                                   | `GET /ProtVar/api/mapping?q=Q06187%20R28H`                                       | `ResolvedVariant` (X-101375202-C-T, ENST00000308731), CADD 28.9                                           |
| 0b  | sequence check                                             | `GET https://alphafold.ebi.ac.uk/api/prediction/Q06187` -> `sequence[27] == "R"` | reject on reference mismatch                                                                              |
| 0c  | `ClinGenAlleleResolver`                                    | `GET https://reg.clinicalgenome.org/allele?hgvs=NC_000023.11:g.101375202C>T`     | `CA255794`                                                                                                |
| 1   | `AlphaMissenseAfdbProvider` (open)                         | `amAnnotationsUrl` CSV, cache whole file per accession                           | `alphamissense.pathogenicity`, class, full heatmap                                                        |
| 2   | `ProtVarScoreProvider` (open; CADD field gated)            | `/score/Q06187/28?mt=H`                                                          | `esm1b.llr`, `popeve.score` + components + `gapFreq`, `eve.score`, `conservation.scorecons`, `missense3d` |
| 3   | `ProtVarStabilityProvider` (open)                          | `/prediction/foldx/Q06187/28?variantAA=H`                                        | `foldx.ddg`, `plddt`, fragment                                                                            |
| 4   | `ProtVarStructureContextProvider` (open)                   | `/prediction/pocket/Q06187/28`, `/prediction/interaction/Q06187/28` (404 = none) | pocket and interface membership                                                                           |
| 5   | `UniProtAnnotationProvider` (open)                         | `/function/Q06187/28?variantAA=H`                                                | features at residue, `VAR_` records, ECO codes, PubMed IDs                                                |
| 6   | `GnomadProvider` (open)                                    | GraphQL query in 3.8                                                             | AC, AN, AF, hemizygotes, homozygotes, ClinVar summary                                                     |
| 7   | `MaveDbProvider` (open)                                    | search by accession text, per-set scores CSV, calibrations, ClinGen lookup       | zero or more measurements; explicit `not_covered`                                                         |
| 8   | `EnsemblVepProvider` (noncommercial for REVEL/CADD fields) | VEP REST call in 3.6                                                             | `revel`, cross-check of AM, SIFT, PolyPhen                                                                |
| 9   | `CaddProvider` (noncommercial)                             | CADD API                                                                         | `cadd.phred` v1.7                                                                                         |
| 10  | `LocalEsmProvider` (open, optional)                        | local `fair-esm` run                                                             | `esm1b.llr` with `orphafold_generated` provenance, for sequences outside the human reference proteome     |
| 11  | `LocalThermoMpnnProvider` (open, optional)                 | local run on chosen structure                                                    | `thermompnn.ddg` with structure ID                                                                        |

Implementation rules:

- Run adapters 1 to 9 concurrently with per-adapter timeouts (ProtVar and gnomAD answered in under 1 s; Ensembl VEP and MyVariant took ~2.5 s). A failing adapter yields `status: "source_error"` entries; the panel still renders.
- Cross-check: compare AlphaMissense from AFDB, ProtVar and VEP. On disagreement keep AFDB and attach a flag.
- Cache key: `(adapter, source_release, accession, position, alternate_residue)`. Cache AFDB CSVs and MaveDB score CSVs on disk by ETag.
- Store the raw response body alongside the normalised values for audit.
- Every adapter declares `license_tier`; the registry skips `noncommercial` adapters unless the flag is set and emits `disabled_by_license_tier` so the UI can show the row as unavailable with the reason.
- No LLM-generated text enters any `VariantEffectValue`. Descriptions come from the source record or from static copy written in this repository.

### 5.4 Example normalised record

```json
{
  "key": "foldx.ddg",
  "evidence_class": "computational_prediction",
  "prediction_kind": "stability_ddg",
  "display_name": "FoldX ΔΔG (on AlphaFold model)",
  "value": -0.755,
  "unit": "kcal/mol",
  "direction": "positive_destabilising",
  "source_class_label": null,
  "normalized_class_label": null,
  "published_thresholds": [
    {
      "label": "likely to be destabilising",
      "lower": 2.0,
      "upper": null,
      "defined_by": "ProtVar UI"
    }
  ],
  "confidence_flags": [],
  "status": "ok",
  "provenance": {
    "source_name": "EBI ProtVar",
    "source_record_id": "Q06187:28:H",
    "request_url": "https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/Q06187/28?variantAA=H",
    "retrieved_at": "2026-10-03T16:36:10Z",
    "source_release": "ProtVar data 2.1",
    "upstream_tool": "FoldX v5.0",
    "structure_basis": "predicted_existing",
    "structure_id": "AF-Q06187-F1",
    "license": "CC-BY-4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "commercial_use": "allowed",
    "citation_doi": "10.1093/nar/gkae413"
  }
}
```

---

## 6. Structure predictors and single missense variants

### 6.1 Evidence

| Source                                                                               | Finding                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AlphaFold DB FAQ, "What use cases does AlphaFold not support?" [curl, site bundle]   | "AlphaFold has not been validated for predicting the effect of mutations. In particular, AlphaFold is not expected to produce an unfolded protein structure given a sequence containing a destabilising point mutation."                                                                                                     |
| Buel & Walters, Nat Struct Mol Biol 2022, 29:1-2, doi:10.1038/s41594-021-00714-2     | Correspondence titled "Can AlphaFold2 predict the impact of missense mutations on structure?" (full text not retrieved; cited by title)                                                                                                                                                                                      |
| Pak et al., PLoS ONE 2023, 18:e0282689, doi:10.1371/journal.pone.0282689             | "We found a very weak or no correlation between AlphaFold output metrics and change of protein stability or fluorescence."                                                                                                                                                                                                   |
| Feldman, Brogi & Skolnick, Comput Struct Biotechnol J 2026, doi:10.34133/csbj.0142   | AlphaFold 3 on 200 proteins: "predicted structures remain invariant to mutations of up to 40% of residues - including deliberately destabilizing substitutions"; confidence metrics "select the most accurate structure at most 35% of the time"; "ESMFold exhibits greater, though still imperfect, mutational sensitivity" |
| Keskin Karakoyun et al., Front Genet 2023, doi:10.3389/fgene.2023.1052383            | Stability predictors run on AlphaFold2 models discriminate pathogenic variants at AUROC 0.61-0.72                                                                                                                                                                                                                            |
| Wee et al., J Chem Inf Model 2024, doi:10.1021/acs.jcim.4c00976                      | AlphaFold 3 complexes used as input for binding ddG prediction raise RMSE by 8.6% versus PDB structures; some large errors "not captured in its ipTM"                                                                                                                                                                        |
| Terwilliger et al., Nat Methods 2024, doi:10.1038/s41592-023-02087-4                 | "AlphaFold predictions are valuable hypotheses and accelerate but do not replace experimental structure determination"                                                                                                                                                                                                       |
| Counterpoint: McBride et al., Phys Rev Lett 2023, doi:10.1103/PhysRevLett.131.218401 | Local deformation between AF2 models of near-identical sequences correlates with experimental structure pairs "on average"; the authors add a method "to indicate when predictions are unreliable"                                                                                                                           |

No Boltz-specific benchmark of missense structural effects was found. Boltz-2 belongs to the same model family as AlphaFold 3, so treat the limitation as applying until shown otherwise; mark this as an inference in internal docs [unverified for Boltz].

### 6.2 UI rules for the reference-vs-variant comparison

1. Title the panel "Reference and variant models (predicted)". Each model carries a badge: `Experimental (PDB 1BTK)`, `Predicted, AlphaFold DB (AF-Q06187-F1 v6)`, or `OrphaFold-generated (Boltz-2, run ID, seed, MSA settings)`.
2. Fixed caveat directly under the viewer:
   > Structure predictors are not validated for single-residue substitutions. A variant model that matches the reference carries no information about whether the variant is tolerated. Differences smaller than run-to-run variation are noise. See the evidence panel for functional, curated, population and predictor data.
3. Show run-to-run variation as the baseline. Generate the reference with the same settings and N seeds; report variant-vs-reference deviation next to the reference-vs-reference spread. When the variant deviation falls inside the spread, the summary line reads: "No difference above run-to-run variation."
4. Never display a pLDDT or ipTM delta as a stability or pathogenicity indicator.
5. Never colour the structure by "damage". Colour by model confidence or by curated annotation only. Use a neutral marker for the substituted residue.
6. Local side-chain context (contacts lost or gained within a radius, on the reference structure) may be shown as geometry computed from the model, labelled "computed from predicted model", with the model ID.
7. Wording to avoid: "the mutation destabilises the protein", "the structure is unchanged, so the variant is benign", "predicted to unfold".
8. Wording to use: "The predictor produced a similar fold for the variant sequence. This is expected for most single substitutions and is uninformative about stability."
9. Link the AlphaFold DB FAQ statement and the citations above from an info popover.

---

## 7. Build decisions (checklist)

1. Implement `ProtVarClient` first; cover `/mapping`, `/score`, `/prediction/foldx`, `/prediction/pocket`, `/prediction/interaction`, `/function`. Send one-letter `mt` to `/score`. Treat 404 from `/prediction/interaction` as an empty list.
2. Implement `AlphaMissenseAfdbProvider` reading `amAnnotationsUrl`; cache the CSV per accession; keep the source class string; normalise to three snake-case classes.
3. Implement `GnomadProvider` against `gnomad_r4` with the query in 3.8; surface hemizygote and homozygote counts; render `variant: null` as "not observed".
4. Implement `MaveDbProvider`: search by UniProt accession text, align `targetSequence` to the UniProt sequence, verify the reference residue, read `scoreCalibrations`, record the per-set licence.
5. Add `license_tier` to every adapter and the `ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES` flag; CADD, REVEL and dbNSFP-derived values are off by default.
6. Persist `Provenance` with every value, including `source_release` and `upstream_tool`; show it in a hover card.
7. Build the evidence panel as four separately headed groups matching `evidence_class`; no composite score.
8. Add confidence flags: `gap_frequency_above_0.5` (popEVE/EVE), `plddt_below_70` (FoldX and any model-based ddG), `isoform_mismatch`, `reference_residue_mismatch`.
9. Use BTK R28H as an integration-test fixture with the values in section 2; add BTK R525Q (EVE 0.95 `PATHOGENIC`, Missense3D `Neutral`, interface with Q58FG0 pDockQ 0.324) to cover EVE, M3D and interface paths.
10. Keep FoldX out of the repository and container images; add ThermoMPNN as the optional local stability adapter.
11. Implement the comparison viewer rules in 6.2, including the seed-variation baseline.
12. Schedule a monthly job that re-reads ProtVar `/stats/latest`, the gnomAD `DatasetId` enum, the dbNSFP releases page and the MaveDB API version, and reports drift.

---

## 8. Gotchas summary

- AlphaMissense class vocabulary differs across four routes (3.2).
- ProtVar `/score` silently ignores three-letter `mt` and omits `mt` from most objects (3.1).
- popEVE from ProtVar and VEP is the unfiltered value when the filtered column is blank; `gapFreq` is the only signal (3.1, 3.4).
- CADD differs by version between aggregators (28.9 v1.7; 26.8 in gnomAD).
- MaveDB numbering is target-relative; mapped coordinates can sit on a non-canonical RefSeq isoform (3.7).
- evemodel.org backend returned 504/502 and an empty zip (3.4).
- gnomAD `genome: null` with a populated `exome` is normal for ultra-rare variants.
- GitHub's unauthenticated REST API rate-limited this IP during research; use `raw.githubusercontent.com` or a token in CI.

---

## 9. Unverified or open

- AlphaMissense thresholds corresponding to 90% precision on ClinVar (paper claim, full text not read here).
- ESM-1b LLR cut-off of -7.5 attributed to Brandes et al.
- ESM C and ESM3 licence terms.
- Licence of popEVE score files; licence of the RaSP precomputed deposit; DDMut terms of use.
- Rate limits for ProtVar, gnomAD and MaveDB (no headers returned).
- EVE bulk download (not tested); cause of the empty per-protein zip.
- Stability predictors released after 2024 and any precomputed ThermoMPNN proteome set (searches blocked).
- ProteinGym: commit date of the fetched CSVs and the proteingym.org website were not checked; values are from the repository main branch.
- PrimateAI-3D academic licence text (click-through not opened). FoldX academic licence full text (login required).
- Whether serving dbNSFP-derived values through a public app is permitted under CC BY-NC-ND 4.0.
- Buel & Walters 2022 full text. Any Boltz-specific evaluation on missense variants.
- ConSurf-DB availability. Semantics of ProtVar `/structure` `start`. Inconsistent MaveDB `offset` values.
- DDMut API was read from documentation only; no job was submitted.

---

## 10. Sources

- ProtVar API spec: https://www.ebi.ac.uk/ProtVar/api/docs ; FTP: https://ftp.ebi.ac.uk/pub/databases/ProtVar/ ; paper: https://doi.org/10.1093/nar/gkae413
- AlphaFold DB API: https://alphafold.ebi.ac.uk/api/openapi.json ; FAQ: https://alphafold.ebi.ac.uk/faq
- AlphaMissense: https://github.com/google-deepmind/alphamissense ; https://zenodo.org/records/10813168 ; https://doi.org/10.1126/science.adg7492
- ESM-1b variants: https://huggingface.co/spaces/ntranoslab/esm_variants ; https://github.com/ntranoslab/esm-variants ; https://github.com/facebookresearch/esm
- EVE: https://evemodel.org ; popEVE: https://pop.evemodel.org ; https://github.com/debbiemarkslab/popEVE ; https://doi.org/10.1038/s41588-025-02400-1
- CADD: https://cadd.gs.washington.edu/download ; https://cadd.gs.washington.edu/api
- REVEL: https://sites.google.com/site/revelgenomics/downloads
- PrimateAI-3D: https://github.com/Illumina/PrimateAI-3D
- dbNSFP: https://www.dbnsfp.org/license ; https://www.dbnsfp.org/releases/
- Ensembl VEP REST: https://rest.ensembl.org/documentation/info/vep_hgvs_get
- MaveDB: https://api.mavedb.org/openapi.json ; https://doi.org/10.1186/s13059-025-03476-y
- ClinGen Allele Registry: https://reg.clinicalgenome.org
- gnomAD: https://gnomad.broadinstitute.org/api ; terms: https://gnomad.broadinstitute.org/terms ; source: https://github.com/broadinstitute/gnomad-browser
- UCSC REST: https://api.genome.ucsc.edu ; UniProt licence: https://www.uniprot.org/help/license ; EBI Proteins API: https://www.ebi.ac.uk/proteins/api/doc/
- MyVariant.info: https://myvariant.info/v1/metadata
- ProteinGym: https://github.com/OATML-Markslab/ProteinGym ; https://proteingym.org
- FoldX: https://foldxsuite.crg.eu/licensing-and-services ; https://doi.org/10.1093/bioinformatics/btaf064
- ThermoMPNN: https://github.com/Kuhlman-Lab/ThermoMPNN ; https://github.com/Kuhlman-Lab/ThermoMPNN-D
- RaSP: https://github.com/KULL-Centre/_2022_ML-ddG-Blaabjerg ; https://sid.erda.dk/sharelink/fFPJWflLeE
- Stability Oracle: https://github.com/danny305/StabilityOracle ; DDMut: https://biosig.lab.uq.edu.au/ddmut/api
- Mega-scale stability data: https://zenodo.org/records/7992926
- Limitation literature: https://doi.org/10.1038/s41594-021-00714-2 ; https://doi.org/10.1371/journal.pone.0282689 ; https://doi.org/10.34133/csbj.0142 ; https://doi.org/10.3389/fgene.2023.1052383 ; https://doi.org/10.1021/acs.jcim.4c00976 ; https://doi.org/10.1038/s41592-023-02087-4 ; https://doi.org/10.1103/PhysRevLett.131.218401
