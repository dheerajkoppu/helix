# Provenance, evidence, reproducibility and licensing

Research date: 2026-10-03. Markers: **(V)** checked today against the live API, file or page; **(S)** secondary source only. Section 8 lists everything unverified. This is engineering research, and the licensing parts are a technical reading of published terms that counsel should confirm before launch.

## 0. Recommendation for OrphaFold

1. **One `Evidence` record type, six classes.** Every fact shown in the UI is an `Evidence` row with `class`, `source` (database, record ID, release, licence, retrieval hash) and an ECO code. An LLM can draft `orphafold_hypothesis` text and nothing else, and a hypothesis must list the evidence IDs it rests on.
2. **Keep source-native strength.** Store ClinVar review status, ClinGen classification, UniProt ECO tag, Open Targets score, pLDDT and so on in `strength.scheme` + `strength.value`. Never merge them into one cross-source score.
3. **Variant key = GA4GH VRS 2.x Allele ID** (`ga4gh:VA.<32 chars>`), with HGVS on the MANE Select transcript as the display string and ClinVar VCV, ClinGen CAid and SPDI as cross-references. Protein substitutions can be digested locally with the standard library (section 3.3, reproduced today).
4. **Model provenance internally with W3C PROV terms** (`generated_by`, `derived_from`, `used`) and **export as RO-Crate 1.3 + Process Run Crate 0.6**. Write `ro-crate-metadata.json` directly; validate in CI with `rocrate-validator validate -p ro-crate-1.3`.
5. **Every computation writes an immutable run manifest** validated by the JSON Schema in section 5.3, hashed with RFC 8785 + SHA-256. `parameters.seed` is required.
6. **Pin Boltz**: `boltz==2.2.1`, weights from Hugging Face revision `6fdef46d763fee7fbb83ca5501ccceff43b85607`, SHA-256 verified before use. Boltz does not check weight hashes and its default download URL is unpinned.
7. **Store the MSA as an artifact.** The public ColabFold server is a moving target, so a run is only replayable from its stored `.a3m`.
8. **Projects are mutable pointers; snapshots are immutable and content-addressed; forks point at a parent snapshot.** Share URLs: `/s/{snapshot_id}` never changes, `/p/{project_id}` follows the head.
9. **Anonymous-first actors.** An `actor_id` is created on first write, owns projects, and survives the upgrade to an account. ORCID is the scholarly identity (OIDC issuer `https://orcid.org`, scope `openid`).
10. **Licence: Apache-2.0 for code, CC BY 4.0 for documentation, CC0-1.0 for OrphaFold-original data tables, upstream licence per seeded source.** Published user projects default to CC BY 4.0.
11. **Seed in the repository:** ClinVar, UniProt, AlphaFold DB, AlphaMissense, RCSB PDB, Mondo, Orphadata Science, Open Targets, Ensembl, STRING, Reactome, ClinGen, unmodified HPO. **Isolate:** ChEMBL (CC BY-SA 3.0). **Live only:** PubChem annotations, Europe PMC abstracts. **Never store:** OMIM content. **Cite, do not transform:** IUIS 2024 classification (CC BY-ND 4.0).
12. **Three structure origins as a closed enum** on every structure artifact: `experimental`, `predicted_external`, `orphafold_prediction`.

## 1. Current state (all V unless marked)

| Item                     | Current on 2026-10-03                                                                                                                                                                                                           | Evidence                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ECO                      | release `2026-07-10`, 3,358 terms, CC0-1.0                                                                                                                                                                                      | OLS4 `GET /ols4/api/ontologies/eco`; GitHub tag `v2026-07-10`  |
| W3C PROV-O               | W3C Recommendation, 30 April 2013 (stable). PROV-JSON is a W3C Member Submission, 24 April 2013                                                                                                                                 | w3.org/TR/prov-o                                               |
| RO-Crate                 | **1.3**, published 2026-06-22, status Recommendation, DOI `10.5281/zenodo.20720080`; context `https://w3id.org/ro/crate/1.3/context`. 1.2 is the previous release                                                               | researchobject.org, Zenodo API                                 |
| Workflow Run RO-Crate    | **0.6** (Process, Workflow, Provenance Run Crate; extends RO-Crate 1.3). 0.5 dates from June 2024 and extends RO-Crate 1.1                                                                                                      | `https://w3id.org/ro/wfrun/process/0.6` resolves               |
| `roc-validator` (PyPI)   | 0.12.1 (2026-10-01), Apache-2.0. Ships profiles `ro-crate-1.1/1.2/1.3` and `process-run-crate-0.5`, `workflow-run-crate-0.5`, `provenance-run-crate-0.5` only                                                                   | installed and run today                                        |
| `rocrate` (ro-crate-py)  | 0.15.1 (2026-07-10), Apache-2.0; README states support for RO-Crate 1.2/1.1/1.0                                                                                                                                                 | PyPI                                                           |
| npm `ro-crate`           | 3.7.2, **GPL-3.0-or-later** (do not import)                                                                                                                                                                                     | npm registry                                                   |
| GA4GH VRS                | GitHub tags: `2.1.1` (2026-10-01), `2.1.0`, `2.0.1`, `2.0.0`. GA4GH product page: "last approved version VRS v2.0" (approved 2025-03-27). Digest rules for `Allele` and `SequenceLocation` are identical in 2.0.1, 2.1.0, 2.1.1 | github.com/ga4gh/vrs/releases, w3id schema files, ga4gh.org    |
| `ga4gh.vrs` (vrs-python) | 2.3.3 (2026-06-09), Apache-2.0, Python >= 3.10                                                                                                                                                                                  | PyPI                                                           |
| HGVS Nomenclature        | 21.1.5 (2026-09-17)                                                                                                                                                                                                             | hgvs-nomenclature.org/stable                                   |
| GA4GH VA-Spec            | docs "latest" titled 1.0.1; `EvidenceLine` is trial use (S); `ga4gh.va_spec` 0.4.4                                                                                                                                              | PyPI, search                                                   |
| ClinVar                  | E-utilities `dbbuild Build260929-0200.1`, 4,647,675 records; bulk files updated weekly                                                                                                                                          | `einfo.fcgi?db=clinvar`                                        |
| UniProt                  | release `2026_03` (2026-09-02)                                                                                                                                                                                                  | response headers `x-uniprot-release`, `x-uniprot-release-date` |
| Open Targets Platform    | data `26.09`, API `26.9.0`                                                                                                                                                                                                      | GraphQL `meta`                                                 |
| Ensembl                  | release 116 (June 2026), REST 15.12. `www.ensembl.org` is now a JavaScript app and legacy `/info/` pages 308-redirect to `jun2026.archive.ensembl.org`                                                                          | REST `/info/data`, redirect header                             |
| AlphaFold DB             | `latestVersion: 6`, `modelCreatedDate 2025-08-01`, files `..._v6.cif`                                                                                                                                                           | `GET /api/prediction/Q06187`                                   |
| ChEMBL                   | `ChEMBL_37` (2026-05-01)                                                                                                                                                                                                        | `/chembl/api/data/status.json`                                 |
| STRING                   | 12.5                                                                                                                                                                                                                            | `/api/json/version`                                            |
| Reactome                 | 97                                                                                                                                                                                                                              | `/ContentService/data/database/version`                        |
| HPO / Mondo / ORDO       | `v2026-09-01` / `v2026-09-01` / 4.9                                                                                                                                                                                             | GitHub releases, OLS4                                          |
| Boltz                    | `boltz` 2.2.1 (2025-09-08), MIT, default `--model boltz2`; repo last pushed 2026-05-29                                                                                                                                          | PyPI, GitHub                                                   |
| SPDX licence list / CFF  | 3.29.0 (2026-09-16) / `cff-version: 1.2.0`                                                                                                                                                                                      | spdx.org, citation-file-format.github.io                       |

## 2. Evidence model

### 2.1 How upstream resources express evidence strength

| Resource                                            | Mechanism                                                                                                                                                            | Fields (V)                                                                                                                                                                                                                   | Values                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| UniProtKB                                           | ECO tag per annotation, plus entry-level curation status                                                                                                             | `evidences[].evidenceCode`, `.source`, `.id`; `entryType`; `annotationScore`; `proteinExistence`                                                                                                                             | BTK Q06187: `UniProtKB reviewed (Swiss-Prot)`, score `5.0`, `1: Evidence at protein level`; 261 x `ECO:0000269`                                 |
| ClinVar                                             | Review status (stars) on each aggregate classification                                                                                                               | esummary `germline_classification.{description, review_status, last_evaluated}`, `clinical_impact_classification`, `oncogenicity_classification`, `accession_version`, `variation_set[].canonical_spdi`                      | section 2.2                                                                                                                                     |
| ClinGen gene-disease validity                       | Classification tier under a versioned SOP                                                                                                                            | `GET https://search.clinicalgenome.org/api/validity` -> `rows[].{symbol, hgnc_id, mondo, moi, sop, classification, ep, perm_id, released}` (returns all 3,695 rows; `search=` is ignored, filter client-side)                | Definitive 2,305; Limited 552; Moderate 459; Disputed 198; Strong 84; Refuted 49; No Known Disease Relationship 48 (8 flagged with an asterisk) |
| ClinGen Evidence Repository (VCEP variant curation) | ACMG/AMP criteria met or not met, plus outcome                                                                                                                       | `GET https://erepo.genome.network/evrepo/api/classifications?matchLimit=1` -> `variantInterpretations[].{caid, condition, publishedDate, guidelines[].agents[].evidenceCodes[].{label, status}, guidelines[].outcome.label}` | e.g. `PS3 Met`, `PP4_Moderate Met`, `PVS1 Not Met` -> `Pathogenic`                                                                              |
| ACMG/AMP 2015                                       | 28 criteria by strength: stand-alone (BA1), very strong (PVS1), strong (PS1-4, BS1-4), moderate (PM1-6), supporting (PP1-5, BP1-7); five tiers P / LP / VUS / LB / B | carried through ClinVar and ClinGen                                                                                                                                                                                          | store criteria as `strength.criteria[]`; never recompute a classification                                                                       |
| Open Targets                                        | Evidence `score` 0-1; datasource score = harmonic sum (sorted scores divided by position squared, normalised by about 1.644); overall = weighted harmonic sum        | GraphQL `evidences.rows[].{id, score, datasourceId, datatypeId, confidence, literature, variantRsId}`; `associatedDiseases.rows[].{score, datatypeScores, datasourceScores}`                                                 | weights: Europe PMC 0.2, Expression Atlas 0.2, IMPC 0.2, Cancer Biomarkers 0.5, OTAR projects 0.5, others 1                                     |
| RCSB PDB                                            | Method and resolution                                                                                                                                                | `exptl[].method`, `rcsb_entry_info.resolution_combined`, `rcsb_entry_info.structure_determination_methodology`, `rcsb_primary_citation.pdbx_database_id_PubMed`                                                              | 1BTK: `X-RAY DIFFRACTION`, `[1.6]`, `experimental`                                                                                              |
| AlphaFold DB                                        | pLDDT, PAE                                                                                                                                                           | `globalMetricValue`, `fractionPlddtVeryLow/Low/Confident/VeryHigh`, `paeDocUrl`, `latestVersion`, `sequenceChecksum` (MD5 of sequence)                                                                                       | Q06187: 84.44, very high fraction 0.511                                                                                                         |
| STRING                                              | Per-channel scores                                                                                                                                                   | `score`, `nscore`, `fscore`, `pscore`, `ascore`, `escore`, `dscore`, `tscore` (0-1)                                                                                                                                          | BLNK-BTK: `escore 0.999`, `dscore 0.9`, `tscore 0.881`                                                                                          |
| ChEMBL                                              | Assay confidence and potency                                                                                                                                         | assay `confidence_score`, `confidence_description`; activity `pchembl_value`, `standard_type/value/units`, `assay_type`                                                                                                      | CHEMBL648220: confidence 8; IC50 0.4 nM, pChEMBL 9.40                                                                                           |

### 2.2 ClinVar review status (V, ncbi.nlm.nih.gov/clinvar/docs/review_status)

| Stars | `review_status` string (germline and oncogenicity aggregate records)                                           |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| 4     | `practice guideline`                                                                                           |
| 3     | `reviewed by expert panel`                                                                                     |
| 2     | `criteria provided, multiple submitters, no conflicts`                                                         |
| 1     | `criteria provided, conflicting classifications`; `criteria provided, single submitter`                        |
| 0     | `no assertion criteria provided`; `no classification provided`; `no classification for the individual variant` |

Somatic clinical impact uses `criteria provided, multiple submitters` for two stars, with no consensus requirement. Practice-guideline and expert-panel status require ClinGen approval (S). Store the string verbatim and derive stars from this table.

### 2.3 ECO codes OrphaFold uses (labels V via OLS4 `GET /ols4/api/ontologies/eco/terms?obo_id=ECO:0000269`)

| Code                                                | Label                                                                                                                                                                                             | Use                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ECO:0000269                                         | experimental evidence used in manual assertion                                                                                                                                                    | UniProt annotation backed by a published experiment                                                    |
| ECO:0000314 / 0000315 / 0000353                     | direct assay / mutant phenotype / physical interaction evidence used in manual assertion                                                                                                          | appear on UniProt GO annotations                                                                       |
| ECO:0000250 / 0000255 / 0000305 / 0000303 / 0000304 | sequence similarity / match to sequence model / curator inference / author statement without traceable support / author statement supported by traceable reference (all used in manual assertion) | UniProt curated non-experimental tags                                                                  |
| ECO:0007744 / 0007829                               | combinatorial computational and experimental evidence used in manual / automatic assertion                                                                                                        | UniProt, often with `source: PDB`                                                                      |
| ECO:0000256 / 0000313                               | match to sequence model / imported information used in automatic assertion                                                                                                                        | UniProt automatic annotation                                                                           |
| ECO:0008006 (parent ECO:0008001)                    | deep learning neural network method evidence used in automatic assertion                                                                                                                          | UniProt AI-derived annotation; OrphaFold default for AlphaFold DB, AlphaMissense, Boltz-2 output       |
| ECO:0007669 (parent ECO:0007672)                    | computational evidence used in automatic assertion                                                                                                                                                | non-neural computation: VEP consequence, pocket geometry, docking                                      |
| ECO:0005031; ECO:0001823 / 0006181 / 0006163        | structure determination evidence; x-ray crystallography / cryogenic electron microscopy / nuclear magnetic resonance spectroscopy evidence                                                        | RCSB entries, chosen from `exptl[].method`                                                             |
| ECO:0000006                                         | experimental evidence                                                                                                                                                                             | generic experimental (assay measurements)                                                              |
| ECO:0000180                                         | clinical study evidence                                                                                                                                                                           | clinical trial sources                                                                                 |
| ECO:0000322                                         | imported manually asserted information used in automatic assertion                                                                                                                                | OrphaFold importing a curated assertion that carries no ECO tag (ClinVar, ClinGen, Orphanet, Reactome) |
| ECO:0000323                                         | imported automatically asserted information used in automatic assertion                                                                                                                           | OrphaFold importing an automatic assertion with no ECO tag                                             |

ECO has no term for a hypothesis (label search returned none), so `orphafold_hypothesis` records carry `eco: null`. Of the sources checked today, only UniProt returns ECO codes in its API payload: record those with `assigned_by: "source"` and every OrphaFold default with `assigned_by: "orphafold_mapping"`.

### 2.4 Deliverable 1: source type -> evidence class

Class answers "what kind of thing can the reader go and check". The mapping is a pure function of `(database, record type, ECO)`; unmapped inputs fail closed.

| Source record                                                                                                                                                                                                                                | Class                                                                                         | ECO                                                                                                                            | `strength.scheme`                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| RCSB PDB entry with `structure_determination_methodology = experimental`                                                                                                                                                                     | `experimental_evidence`                                                                       | ECO:0001823 / 0006181 / 0006163                                                                                                | `pdb_resolution`                             |
| UniProt annotation tagged ECO:0000269, 0000314, 0000315, 0000353                                                                                                                                                                             | `experimental_evidence` (keep `source.database = uniprot`)                                    | as tagged                                                                                                                      | `uniprot_eco`                                |
| ChEMBL activity, PubChem BioAssay result                                                                                                                                                                                                     | `experimental_evidence`                                                                       | ECO:0000006                                                                                                                    | `pchembl`, `chembl_assay_confidence`         |
| STRING `escore`; Open Targets `impc`                                                                                                                                                                                                         | `experimental_evidence`                                                                       | ECO:0000006                                                                                                                    | `string_score`, `open_targets_score`         |
| ClinVar VCV/RCV classification                                                                                                                                                                                                               | `clinical_database`                                                                           | ECO:0000322                                                                                                                    | `clinvar_review_status`                      |
| ClinGen gene-disease validity; ClinGen Evidence Repository interpretation                                                                                                                                                                    | `clinical_database`                                                                           | ECO:0000322                                                                                                                    | `clingen_gene_validity`; `acmg_criteria`     |
| Orphanet/Orphadata gene-disease, epidemiology; HPO disease-phenotype annotation; OMIM (cross-reference only)                                                                                                                                 | `clinical_database`                                                                           | ECO:0000322                                                                                                                    | none                                         |
| Open Targets `eva`, `clingen`, `genomics_england`, `orphanet`                                                                                                                                                                                | `clinical_database`                                                                           | ECO:0000322                                                                                                                    | `open_targets_score`                         |
| Article cited by ID (PMID, PMCID, DOI); IUIS classification papers; Open Targets `europepmc` (text-mined, flag `method: "text_mining"`); STRING `tscore`                                                                                     | `published_literature`                                                                        | ECO:0000304 when a person cites it; ECO:0000322 for an imported expert classification (IUIS); ECO:0000323 for text-mined links | none, or the source score                    |
| UniProt annotation with any other ECO code; Reactome; Mondo / HPO / ORDO terms and cross-references; Ensembl gene, transcript, MANE; ChEMBL mechanism and indication; STRING `dscore`; Open Targets `uniprot_variants`, `uniprot_literature` | `curated_database`                                                                            | source tag, else ECO:0000322                                                                                                   | `uniprot_eco` or none                        |
| AlphaFold DB model; AlphaMissense score                                                                                                                                                                                                      | `computational_prediction` (`structure_origin: predicted_external` for structures)            | ECO:0008006                                                                                                                    | `plddt`; `alphamissense`                     |
| Ensembl VEP consequence; STRING `nscore`, `fscore`, `pscore`, `ascore`                                                                                                                                                                       | `computational_prediction`                                                                    | ECO:0007669                                                                                                                    | `vep_impact`; `string_score`                 |
| OrphaFold run output: Boltz-2 structure, affinity, pocket, docking                                                                                                                                                                           | `computational_prediction` (`structure_origin: orphafold_prediction`, `generated_by: job_id`) | ECO:0008006 or ECO:0007669                                                                                                     | `boltz_confidence`                           |
| Statement authored in OrphaFold by a person or an assistant                                                                                                                                                                                  | `orphafold_hypothesis`                                                                        | `null`                                                                                                                         | `null`; `derived_from` has at least one item |

Other Open Targets `datasourceId` values need an explicit row before they are displayed. For the four-label claim view in `docs/PRODUCT_BRIEF.md`: `experimental_evidence` -> Known experimentally; `clinical_database`, `curated_database`, `published_literature` -> Database annotation (literature shown with its citation); `computational_prediction` -> Computational prediction; `orphafold_hypothesis` -> OrphaFold hypothesis.

Ranks for sorting inside one scheme (never compared across schemes):

| Scheme                                                                                                           | Rank                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `clinvar_review_status`                                                                                          | stars 0-4 from section 2.2                                                                                                       |
| `clingen_gene_validity`                                                                                          | Definitive 4, Strong 3, Moderate 2, Limited 1, No Known Disease Relationship 0; Disputed and Refuted set `direction: "disputes"` |
| `uniprot_eco`                                                                                                    | ECO:0000269 = 3; ECO:0007744 = 2; other manual-assertion codes = 1; automatic-assertion codes = 0                                |
| numeric schemes (`open_targets_score`, `plddt`, `boltz_confidence`, `string_score`, `pchembl`, `pdb_resolution`) | `rank: null`; show the number with its unit and source                                                                           |

### 2.5 Evidence record (values below are real, fetched today)

<!-- prettier-ignore-start -->

```json
{
  "id": "ev_01K6N4A1B2C3D4E5F6G7H8J9KM", "class": "clinical_database",
  "subject": {"type": "variant", "id": "ga4gh:VA.eQUVUFOhITJjK9uITNNPlkc9IMvyiAe_", "label": "NM_000061.3(BTK):c.1574_1575dup (p.Asn526fs)"}, "predicate": "has_germline_classification",
  "object": {"type": "classification", "value": "Pathogenic", "context": [{"type": "condition", "label": "BTK-related disorder"}]}, "direction": "supports",
  "eco": {"id": "ECO:0000322", "assigned_by": "orphafold_mapping"}, "strength": {"scheme": "clinvar_review_status", "value": "criteria provided, single submitter", "rank": 1, "max_rank": 4},
  "source": {
    "database": "clinvar", "record_id": "clinvar.variation:4952019", "record_version": "VCV004952019.1", "release": "Build260929-0200.1", "license": "LicenseRef-NCBI-Unrestricted",
    "url": "https://www.ncbi.nlm.nih.gov/clinvar/variation/4952019/", "retrieved_at": "2026-10-03T16:40:12Z",
    "request": "GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=4952019&retmode=json", "response_sha256": "<sha256 of the raw response body>"
  },
  "citations": [], "asserted_at": "2021-02-25", "generated_by": null, "derived_from": [], "created_by": {"actor_id": "system", "kind": "system"}, "authoring": null
}
```

<!-- prettier-ignore-end -->

Hypothesis variant of the same shape: `"class": "orphafold_hypothesis"`, `"eco": null`, `"strength": null`, `"source": null`, `"derived_from": ["ev_...", "job_..."]`, `"created_by": {"actor_id": "act_...", "kind": "anonymous"}`, `"authoring": {"method": "human" | "llm_assisted", "model": "<model id or null>"}`.

| Field               | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`             | one of `experimental_evidence`, `clinical_database`, `published_literature`, `curated_database`, `computational_prediction`, `orphafold_hypothesis`                                                                                                                                                                                                                                                                                                                                               |
| `subject`, `object` | `{type, id, label}` with Bioregistry-style CURIEs (prefixes V at bioregistry.io): `uniprot:Q06187`, `hgnc:1133`, `ensembl:ENSG00000010671`, `MONDO:0010421`, `HP:0000002`, `ORPHA:47`, `clinvar.variation:4952019`, `clingen.allele:CA2695235398`, `pdb:1BTK`, `chembl.target:CHEMBL5251`, `pubchem.compound:2244`, `pubmed:9218782`, `doi:10.70962/jhi.20250003`, `reactome:R-HSA-...`. `ga4gh:` and AlphaFold DB have no Bioregistry entry: use `ga4gh:VA...` as issued and `afdb:AF-Q06187-F1` |
| `direction`         | `supports`, `disputes`, `neutral` (same three values as GA4GH VA-Spec `directionOfEvidenceProvided`, S)                                                                                                                                                                                                                                                                                                                                                                                           |
| `source`            | required for the first five classes; `null` only for hypotheses. `response_sha256` proves what was fetched                                                                                                                                                                                                                                                                                                                                                                                        |
| `generated_by`      | `job_id` of the run manifest for OrphaFold computations (`prov:wasGeneratedBy`)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `derived_from`      | evidence or job IDs (`prov:wasDerivedFrom`); required and non-empty for hypotheses                                                                                                                                                                                                                                                                                                                                                                                                                |
| `authoring`         | hypotheses only. LLM-assisted text is labelled and can never populate `source`, `object.value` of other classes, or any identifier                                                                                                                                                                                                                                                                                                                                                                |

Server-side invariants: reject a non-hypothesis record without `source.record_id` and `source.release`; reject `eco.id` that OLS reports obsolete; reject a hypothesis with empty `derived_from`; evidence rows are append-only (a refreshed source creates a new row with `supersedes`).

## 3. Variant identity: GA4GH VRS and HGVS

### 3.1 Identifiers to store per variant

| Field                    | Example (BTK, V today)                                                                  | Source                                               |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `vrs_id` genomic, GRCh38 | `ga4gh:VA.eQUVUFOhITJjK9uITNNPlkc9IMvyiAe_` for `NC_000023.11:g.101354686_101354687dup` | VICC normaliser (vrs-python 2.3.1)                   |
| `vrs_id` protein         | `ga4gh:VA.nyFINfEHbVPUXhxwnoHBynF7hPamBemE` for `NP_000052.1:p.Arg525Gln`               | normaliser; reproduced locally                       |
| `hgvs.c` on MANE Select  | `NM_000061.3:c.1574_1575dup` (`ENST00000308731.8`)                                      | Ensembl VEP `mane=1` -> `mane_select: "NM_000061.3"` |
| `hgvs.g`, `hgvs.p`       | `NC_000023.11:g.101354686_101354687dup`, `ENSP00000308176.8:p.Asn526GlufsTer5`          | Ensembl VEP, ClinGen Allele Registry                 |
| `spdi`                   | `NC_000023.11:101354685:TC:TCTC`                                                        | ClinVar `canonical_spdi`                             |
| `clinvar`                | `VCV004952019.1`                                                                        | ClinVar `accession_version`                          |
| `clingen_caid`           | `CA2695235398`                                                                          | ClinGen Allele Registry `@id`                        |
| sequence digest          | `SQ.UEFsUeUkTCNvBilBofWdc_UXE0AjL-IA` (BTK canonical, 659 aa)                           | local `sha512t24u`                                   |

### 3.2 HGVS conventions (Nomenclature 21.1.5)

- Always store the versioned reference: `NM_000061.3:c.`, `NP_000052.1:p.`, `NC_000023.11:g.`. A bare `c.1574_1575dup` is display text only.
- Report on the MANE Select transcript; keep MANE Plus Clinical where it exists. Record `transcript_status`.
- Protein level: three-letter codes (`p.Arg525Gln`), `Ter` for stop, `fsTer` for frameshift; wrap predicted consequences in parentheses for display, `p.(Arg525Gln)`, when there is no RNA or protein evidence.
- Apply 3' shifting: duplications are `dup`, never `ins`. 21.1.5 limits the exon-junction exception to `c.` and `n.` (S).
- UI search accepts legacy one-letter input (`R525Q`) and normalises it; exports always carry the full HGVS plus the VRS ID.
- Protein numbering follows the UniProt canonical isoform only when its sequence digest equals the RefSeq protein digest. For BTK this holds: `sha512t24u(Q06187) == SQ.UEFsUeUkTCNvBilBofWdc_UXE0AjL-IA`, the same accession the normaliser returns for `NP_000052.1`. Check per gene and store the result.

### 3.3 Computing VRS IDs

VRS identifiers are `sha512t24u` digests (SHA-512, first 24 bytes, base64url) over a sorted, whitespace-free JSON form of the inherent fields: `Allele` uses `location`, `state`, `type`; `SequenceLocation` uses `end`, `sequenceReference`, `start`, `type`. Coordinates are 0-based interbase. The snippet reproduced the normaliser's protein IDs today:

```python
import base64, hashlib, json

def sha512t24u(blob: bytes) -> str:
    return base64.urlsafe_b64encode(hashlib.sha512(blob).digest()[:24]).decode("ascii")

def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")

def refget_accession(sequence: str) -> str:
    return "SQ." + sha512t24u(sequence.encode("ascii"))

def protein_substitution_vrs_id(reference_sequence: str, position: int, alternate: str) -> str:
    location = {
        "type": "SequenceLocation",
        "sequenceReference": {"type": "SequenceReference", "refgetAccession": refget_accession(reference_sequence)},
        "start": position - 1,
        "end": position,
    }
    allele = {
        "type": "Allele",
        "location": sha512t24u(canonical(location)),
        "state": {"type": "LiteralSequenceExpression", "sequence": alternate},
    }
    return "ga4gh:VA." + sha512t24u(canonical(allele))

# protein_substitution_vrs_id(<UniProt Q06187 sequence>, 525, "Q") == "ga4gh:VA.nyFINfEHbVPUXhxwnoHBynF7hPamBemE"
```

Substitutions only. Insertions, deletions and duplications need VRS normalisation (fully justified, `ReferenceLengthExpression` with `length`, `repeatSubunitLength`), so use `ga4gh.vrs` 2.3.3 with a SeqRepo data proxy (`biocommons.seqrepo` 0.6.11) for those.

### 3.4 Services (V today)

| Need                          | Call                                                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HGVS or protein -> VRS 2.x    | `GET https://normalize.cancervariants.org/variation/normalize?q=NP_000052.1:p.Arg525Gln` -> `variation.id`, `variation.location.sequenceReference.refgetAccession`                                                      | Also `/variation/to_vrs?q=NC_000023.11:g.101354686_101354687dup`. `to_vrs` rejected the `c.` duplication (`Unable to find classification`), so send genomic HGVS. Third-party service: cache results, keep a local `ga4gh.vrs` fallback |
| HGVS -> all equivalents, CAid | `GET https://reg.clinicalgenome.org/allele?hgvs=NM_000061.3:c.1574_1575dup` -> `@id`, `genomicAlleles[].hgvs`, `transcriptAlleles[].{hgvs, MANE, proteinEffect}`, `externalRecords.ClinVarVariations`                   | 33 transcript alleles returned                                                                                                                                                                                                          |
| HGVS -> consequence, MANE     | `GET https://rest.ensembl.org/vep/human/hgvs/NM_000061.3:c.1574_1575dup?content-type=application/json&mane=1&hgvs=1&pick=1` -> `transcript_consequences[].{mane, mane_select, hgvsc, hgvsp, consequence_terms, impact}` | `ga4gh_vrs=1` returns a legacy VRS 1.x shape (`SequenceState`, `SimpleInterval`, `sequence_id`, no `id`). Do not use it                                                                                                                 |
| HGVS -> SPDI                  | `GET https://api.ncbi.nlm.nih.gov/variation/v0/hgvs/{hgvs}/contextuals` -> `data.spdis[]`                                                                                                                               | `/spdi/{spdi}/ga4gh-vr` exists in the API description and returned HTTP 502 twice today                                                                                                                                                 |
| ClinVar record                | `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=4952019&retmode=json`                                                                                                                    | fields in section 2.1                                                                                                                                                                                                                   |

## 4. Provenance: W3C PROV and RO-Crate

| PROV term                                                | OrphaFold object                                                                       | Stored as                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `prov:Entity`                                            | evidence record, fetched source response, input sequence, artifact, manifest, snapshot | row or blob with `sha256`                                        |
| `prov:Activity`                                          | computational run, source retrieval, snapshot creation, fork                           | `job`, `retrieval`, `snapshot` rows with start and end time      |
| `prov:Agent` (`SoftwareAgent`, `Person`, `Organization`) | model adapter at a version, actor, source database                                     | `model`, `actor`, `source.database`                              |
| `prov:wasGeneratedBy`                                    | artifact or computational evidence -> run                                              | `generated_by`                                                   |
| `prov:used`                                              | run -> sequences, weights, datasets, MSA                                               | manifest `inputs`, `model.weights`, `source_datasets`, `msa`     |
| `prov:wasDerivedFrom`                                    | hypothesis -> evidence; variant sequence -> wild type; fork -> parent snapshot         | `derived_from`, `applied_variant_ids`, `forked_from_snapshot_id` |
| `prov:hadPrimarySource`                                  | evidence -> upstream record                                                            | `source.record_id`, `source.release`                             |
| `prov:wasAttributedTo`, `prov:wasAssociatedWith`         | record -> actor; run -> actor and software                                             | `created_by`, manifest `actor`                                   |
| `prov:wasRevisionOf`                                     | snapshot -> previous snapshot of the same project                                      | `parent_snapshot_id`                                             |

- Use PROV names in column and field naming. A full PROV-O/RDF store adds nothing the tables above lack; RO-Crate is the interchange form.
- RO-Crate 1.3 mapping: run = `CreateAction` (`instrument` -> `SoftwareApplication`, `object` -> inputs, `result` -> outputs, `agent`, `startTime`, `endTime`, `actionStatus`); files = `File` with `contentSize`, `sha256`, `encodingFormat`; fork = root `isBasedOn`; licence = root `license`.
- 1.3 changed four Bioschemas IRIs (`ComputationalWorkflow`, `FormalParameter`, `input`, `output` now under `https://bioschemas.org/terms/`). OrphaFold's crates use none of them. The validator's `ro-crate-1.3` profile inherits the 1.2 checks, and the test crate passed all 66 REQUIRED checks.
- Process Run Crate is the right profile level: OrphaFold executes tools from an application, with no workflow language. Move to Provenance Run Crate only if a workflow engine is introduced.
- Validator findings from today's test crate (section 6.4): root `conformsTo` targets must be typed `["CreativeWork", "Profile"]`; a `Dataset`-typed contextual entity is treated as a data entity and must be in `hasPart`, so type the parent-snapshot reference `CreativeWork`; single values are preferred over one-element arrays.

## 5. Deliverable 2: computational run manifest

### 5.1 What a manifest must capture

| Field                                                                                   | Why                                      | How to obtain                                                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `job_id`, `created_at`, `started_at`, `completed_at`, `status`                          | identity and timing                      | ULID with `job_` prefix; UTC RFC 3339                                                                 |
| `inputs.sequences[].{sequence, sha256, refget, source}`                                 | exact molecule that was folded           | SHA-256 and `SQ.` digest of the submitted string; UniProt accession, sequence version, release header |
| `inputs.variants[]`                                                                     | which change produced a variant sequence | VRS ID, HGVS, MANE status, `protein_change`                                                           |
| `inputs.database_identifiers[]`                                                         | join keys back to disease, gene, protein | CURIEs                                                                                                |
| `model.{provider, name, version, license}`                                              | which adapter and model                  | adapter constant plus `importlib.metadata.version("boltz")`                                           |
| `model.weights[].{uri, revision, sha256, size_bytes}`                                   | weights are the model                    | hash the checkpoint file at worker start; compare with the pinned value                               |
| `parameters` (all resolved values, `seed` required)                                     | sampling is stochastic                   | merge user input over adapter defaults, then record the merged object                                 |
| `msa.{mode, server_url, databases[], search_tool, artifact_ids}`                        | MSA content drives accuracy              | store the `.a3m`; record database names and versions                                                  |
| `source_datasets[]`                                                                     | versions of every database consulted     | release headers and version endpoints from section 1                                                  |
| `software.{orphafold.git_commit, container.digest, python, cuda, hardware, packages[]}` | environment                              | image digest from the runtime; `pip freeze` subset                                                    |
| `outputs.confidence.samples[].metrics`                                                  | model-reported confidence, verbatim      | parse the model's confidence file                                                                     |
| `outputs.artifacts[].{path, media_type, size_bytes, sha256, structure_origin}`          | integrity and origin labelling           | hash on upload to object storage                                                                      |
| `integrity.manifest_sha256`                                                             | tamper evidence, share-URL stability     | section 5.5                                                                                           |

### 5.2 Boltz-2 facts that shape the manifest (V: PyPI, GitHub `docs/prediction.md`, `src/boltz/main.py`, Hugging Face API)

- `boltz` 2.2.1; code and weights MIT ("freely used for both academic and commercial purposes"). Python `>=3.10,<3.13`.
- Weights (Hugging Face `boltz-community/boltz-2`, revision `6fdef46d763fee7fbb83ca5501ccceff43b85607`):

| File               | Bytes         | SHA-256                                                            |
| ------------------ | ------------- | ------------------------------------------------------------------ |
| `boltz2_conf.ckpt` | 2,286,561,469 | `090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1` |
| `boltz2_aff.ckpt`  | 2,062,139,170 | `dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e` |
| `mols.tar`         | 1,855,662,080 | `39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7` |

- Boltz fetches `https://model-gateway.boltz.bio/boltz2_conf.ckpt`, which 307-redirects to the Hugging Face `main` branch, with `urllib.request.urlretrieve` and no hash check. Pre-populate `--cache` (or `BOLTZ_CACHE`) from the pinned revision and verify:
  `curl -sI https://huggingface.co/boltz-community/boltz-2/resolve/6fdef46d763fee7fbb83ca5501ccceff43b85607/boltz2_conf.ckpt | grep -i -E "x-linked-etag|x-repo-commit"`
- `--seed` defaults to `None` (unseeded). The adapter always passes one.
- Defaults to record when the user sets nothing: `--recycling_steps 3`, `--sampling_steps 200`, `--diffusion_samples 1`, `--step_scale 1.5` (Boltz-2), `--max_msa_seqs 8192`, `--subsample_msa False`, `--num_subsampled_msa 1024`, `--use_potentials False`, `--output_format mmcif`, `--msa_pairing_strategy greedy`, `--sampling_steps_affinity 200`, `--diffusion_samples_affinity 5`, `--model boltz2`.
- `--use_msa_server` sends sequences to `https://api.colabfold.com` (override with `--msa_server_url`; auth via `--api_key_header`/`--api_key_value` or `MSA_API_KEY_VALUE`). ColabFold's setup script defaults are `uniref30_2302` and `colabfold_envdb_202108`, built and searched with MMseqs2 release 18 (`18-8cc5c`).
- Outputs per input: `predictions/<name>/<name>_model_<i>.cif`, `confidence_<name>_model_<i>.json`, `pae_*.npz`, `pde_*.npz`, `plddt_*.npz`, `affinity_<name>.json`.
- Confidence keys: `confidence_score` (= 0.8 x `complex_plddt` + 0.2 x `iptm`, or `ptm` for single chains), `ptm`, `iptm`, `ligand_iptm`, `protein_iptm`, `complex_plddt`, `complex_iplddt`, `complex_pde`, `complex_ipde`, `chains_ptm`, `pair_chains_iptm`. pLDDT and TM-type scores are 0-1; PDE is in angstroms.
- Affinity keys: `affinity_pred_value` (log10 of IC50 in micromolar; compare binders only), `affinity_probability_binary` (0-1 binder probability), plus `...1` and `...2` ensemble members.
- Store the exact input YAML (`version: 1`) as an artifact with `role: "model_input"`.

### 5.3 JSON Schema (draft 2020-12; validated today with `jsonschema` 4.26.0)

<!-- prettier-ignore-start -->

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:orphafold:schema:run-manifest:1.0.0", "title": "OrphaFold computational run manifest", "type": "object", "additionalProperties": false,
  "required": ["manifest_version", "job_id", "created_at", "kind", "status", "research_use_only", "actor", "inputs", "model", "parameters", "source_datasets", "software", "outputs", "integrity"],
  "properties": {
    "manifest_version": {"const": "1.0.0"}, "job_id": {"type": "string", "pattern": "^job_[0-9A-HJKMNP-TV-Z]{26}$", "description": "ULID with job_ prefix"}, "created_at": {"$ref": "#/$defs/timestamp"},
    "started_at": {"$ref": "#/$defs/timestamp"}, "completed_at": {"$ref": "#/$defs/timestamp"},
    "kind": {"enum": ["structure_prediction", "complex_prediction", "affinity_prediction", "pocket_detection", "docking", "variant_effect", "structure_comparison"]},
    "status": {"enum": ["queued", "running", "succeeded", "failed", "cancelled"]}, "research_use_only": {"const": true},
    "actor": {
      "type": "object", "additionalProperties": false, "required": ["actor_id", "kind"],
      "properties": {"actor_id": {"type": "string"}, "kind": {"enum": ["anonymous", "account", "system"]}, "orcid": {"type": "string", "pattern": "^https://orcid\\.org/\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]$"}}
    },
    "project": {"type": "object", "additionalProperties": false, "required": ["project_id"], "properties": {"project_id": {"type": "string"}, "snapshot_id": {"type": "string"}}},
    "inputs": {
      "type": "object", "additionalProperties": false, "required": ["sequences", "variants", "database_identifiers"],
      "properties": {
        "sequences": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["entity_id", "molecule_type", "sequence", "length", "sha256", "refget"],
            "properties": {
              "entity_id": {"type": "string", "description": "Chain or entity label passed to the model, e.g. A"}, "molecule_type": {"enum": ["protein", "dna", "rna"]}, "sequence": {"type": "string", "pattern": "^[A-Za-z]+$"},
              "length": {"type": "integer", "minimum": 1}, "sha256": {"$ref": "#/$defs/sha256"},
              "refget": {"type": "string", "pattern": "^SQ\\.[A-Za-z0-9_-]{32}$", "description": "GA4GH refget accession: SQ. + sha512t24u(sequence)"}, "is_variant_sequence": {"type": "boolean"},
              "applied_variant_ids": {"type": "array", "items": {"type": "string"}}, "source": {"$ref": "#/$defs/record_ref"}
            }
          }
        },
        "variants": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["variant_id", "hgvs"],
            "properties": {
              "variant_id": {"type": "string", "description": "OrphaFold-local id referenced by applied_variant_ids"}, "vrs_id": {"type": "string", "pattern": "^ga4gh:VA\\.[A-Za-z0-9_-]{32}$"}, "vrs_version": {"type": "string"},
              "hgvs": {"type": "object", "additionalProperties": false, "minProperties": 1, "properties": {"g": {"type": "string"}, "c": {"type": "string"}, "p": {"type": "string"}}}, "transcript": {"type": "string"},
              "transcript_status": {"enum": ["MANE_Select", "MANE_Plus_Clinical", "other"]},
              "protein_change": {"type": "object", "additionalProperties": false, "required": ["position", "ref", "alt"], "properties": {"position": {"type": "integer", "minimum": 1}, "ref": {"type": "string"}, "alt": {"type": "string"}}},
              "xrefs": {"type": "array", "items": {"$ref": "#/$defs/curie"}}
            }
          }
        },
        "ligands": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["entity_id"],
            "properties": {
              "entity_id": {"type": "string"}, "ccd": {"type": "string"}, "smiles": {"type": "string"}, "inchikey": {"type": "string", "pattern": "^[A-Z]{14}-[A-Z]{10}-[A-Z]$"},
              "xrefs": {"type": "array", "items": {"$ref": "#/$defs/curie"}}
            }
          }
        },
        "structures": {
          "type": "array", "description": "Template or reference structures consumed by the run",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["origin", "source", "sha256"],
            "properties": {"origin": {"$ref": "#/$defs/structure_origin"}, "source": {"$ref": "#/$defs/record_ref"}, "sha256": {"$ref": "#/$defs/sha256"}}
          }
        },
        "database_identifiers": {"type": "array", "items": {"$ref": "#/$defs/curie"}}
      }
    },
    "model": {
      "type": "object", "additionalProperties": false, "required": ["provider", "name", "version", "license", "weights"],
      "properties": {
        "provider": {"type": "string", "description": "Adapter id, e.g. boltz-local"}, "name": {"type": "string"}, "version": {"type": "string"}, "license": {"type": "string", "description": "SPDX id or LicenseRef-*"},
        "code": {"type": "object", "additionalProperties": false, "properties": {"repository": {"type": "string", "format": "uri"}, "revision": {"type": "string"}, "package": {"type": "string"}}},
        "weights": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["name", "sha256"],
            "properties": {"name": {"type": "string"}, "uri": {"type": "string", "format": "uri"}, "revision": {"type": "string"}, "sha256": {"$ref": "#/$defs/sha256"}, "size_bytes": {"type": "integer", "minimum": 0}}
          }
        }
      }
    },
    "parameters": {"type": "object", "required": ["seed"], "properties": {"seed": {"type": "integer"}}, "additionalProperties": true, "description": "Every resolved model parameter, including defaults the user did not set"},
    "msa": {
      "type": "object", "additionalProperties": false, "required": ["mode"],
      "properties": {
        "mode": {"enum": ["server", "precomputed", "single_sequence", "not_applicable"]}, "server_url": {"type": "string", "format": "uri"}, "pairing_strategy": {"type": "string"}, "search_tool": {"$ref": "#/$defs/software_item"},
        "databases": {"type": "array", "items": {"$ref": "#/$defs/dataset_version"}}, "artifact_ids": {"type": "array", "items": {"type": "string"}}
      }
    },
    "source_datasets": {"type": "array", "items": {"$ref": "#/$defs/dataset_version"}},
    "software": {
      "type": "object", "additionalProperties": false, "required": ["orphafold", "packages"],
      "properties": {
        "orphafold": {"type": "object", "additionalProperties": false, "required": ["version", "git_commit"], "properties": {"version": {"type": "string"}, "git_commit": {"type": "string", "pattern": "^[0-9a-f]{40}$"}}},
        "container": {"type": "object", "additionalProperties": false, "properties": {"image": {"type": "string"}, "digest": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"}}}, "python": {"type": "string"},
        "os": {"type": "string"}, "cuda": {"type": "string"},
        "hardware": {"type": "object", "additionalProperties": false, "properties": {"accelerator": {"enum": ["gpu", "cpu"]}, "gpu_model": {"type": "string"}, "gpu_count": {"type": "integer", "minimum": 0}}},
        "packages": {"type": "array", "items": {"$ref": "#/$defs/software_item"}}
      }
    },
    "outputs": {
      "type": "object", "additionalProperties": false, "required": ["artifacts", "confidence"],
      "properties": {
        "artifacts": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["artifact_id", "role", "path", "media_type", "size_bytes", "sha256"],
            "properties": {
              "artifact_id": {"type": "string"}, "role": {"enum": ["structure", "confidence_summary", "pae", "pde", "plddt", "affinity", "msa", "model_input", "log", "other"]}, "path": {"type": "string"},
              "media_type": {"type": "string"}, "size_bytes": {"type": "integer", "minimum": 0}, "sha256": {"$ref": "#/$defs/sha256"}, "structure_origin": {"$ref": "#/$defs/structure_origin"},
              "sample_index": {"type": "integer", "minimum": 0}
            }
          }
        },
        "confidence": {
          "type": "object", "additionalProperties": false, "required": ["samples"],
          "properties": {
            "ranking_metric": {"type": "string"},
            "samples": {
              "type": "array",
              "items": {
                "type": "object", "additionalProperties": false, "required": ["sample_index", "metrics"],
                "properties": {"sample_index": {"type": "integer", "minimum": 0}, "structure_artifact_id": {"type": "string"}, "metrics": {"type": "object", "additionalProperties": {"type": ["number", "object"]}}}
              }
            }
          }
        }
      }
    },
    "execution": {
      "type": "object", "additionalProperties": false,
      "properties": {"argv": {"type": "array", "items": {"type": "string"}}, "exit_code": {"type": "integer"}, "wall_time_seconds": {"type": "number", "minimum": 0}, "parent_job_id": {"type": "string"}, "error": {"type": "string"}}
    },
    "integrity": {
      "type": "object", "additionalProperties": false, "required": ["canonicalization", "manifest_sha256"],
      "properties": {"canonicalization": {"const": "RFC8785"}, "manifest_sha256": {"$ref": "#/$defs/sha256", "description": "sha256 of the RFC 8785 form of this document with integrity.manifest_sha256 removed"}}
    }
  },
  "$defs": {
    "timestamp": {"type": "string", "format": "date-time"}, "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"}, "curie": {"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.]*:[^\\s]+$"},
    "structure_origin": {"enum": ["experimental", "predicted_external", "orphafold_prediction"]},
    "record_ref": {
      "type": "object", "additionalProperties": false, "required": ["database", "record_id"],
      "properties": {"database": {"type": "string"}, "record_id": {"type": "string"}, "record_version": {"type": "string"}, "release": {"type": "string"}, "url": {"type": "string", "format": "uri"}}
    },
    "dataset_version": {
      "type": "object", "additionalProperties": false, "required": ["name", "version"],
      "properties": {"name": {"type": "string"}, "version": {"type": "string"}, "retrieved_at": {"$ref": "#/$defs/timestamp"}, "license": {"type": "string"}, "url": {"type": "string", "format": "uri"}}
    },
    "software_item": {"type": "object", "additionalProperties": false, "required": ["name", "version"], "properties": {"name": {"type": "string"}, "version": {"type": "string"}}}
  }
}
```

### 5.4 Example instance

Validates against 5.3 with the full sequence. Input identifiers, digests, model version and weight hash are real; artifact hashes and sizes, the git commit, the container image and digest, hardware, package versions other than `boltz`, and metric values are placeholders.

```json
{
  "manifest_version": "1.0.0", "job_id": "job_01K6N3Z8Q2W7X5T4N6B8M0R1CD", "created_at": "2026-10-03T16:50:00Z", "started_at": "2026-10-03T16:50:04Z", "completed_at": "2026-10-03T16:53:41Z", "kind": "structure_prediction",
  "status": "succeeded", "research_use_only": true, "actor": {"actor_id": "act_01K6N3Y0000000000000000000", "kind": "anonymous"}, "project": {"project_id": "prj_01K6N3X0000000000000000000"},
  "inputs": {
    "sequences": [
      {
        "entity_id": "A", "molecule_type": "protein", "sequence": "MAAVILESIFLKRSQQKKKTSPLN<...659 aa total, elided in this document...>", "length": 659, "sha256": "6a2a40362bb8d16b571147a993029e384e207de1df3f649b4c8e480a52c3c5ca",
        "refget": "SQ.gHGaAVAdpBnEgoQbjuc1iu_lrjMYx4J-", "is_variant_sequence": true,
        "source": {"database": "uniprot", "record_id": "Q06187", "record_version": "sequence v3; entry v276", "release": "2026_03", "url": "https://rest.uniprot.org/uniprotkb/Q06187"}, "applied_variant_ids": ["var_1"]
      }
    ],
    "variants": [
      {
        "variant_id": "var_1", "vrs_id": "ga4gh:VA.nyFINfEHbVPUXhxwnoHBynF7hPamBemE", "vrs_version": "2.1.1", "hgvs": {"p": "NP_000052.1:p.Arg525Gln"}, "transcript": "NM_000061.3", "transcript_status": "MANE_Select",
        "protein_change": {"position": 525, "ref": "R", "alt": "Q"}, "xrefs": ["hgnc:1133", "refseq:NP_000052.1"]
      }
    ],
    "database_identifiers": ["uniprot:Q06187", "hgnc:1133", "ensembl:ENSG00000010671", "MONDO:0010421"]
  },
  "model": {
    "provider": "boltz-local", "name": "boltz2", "version": "2.2.1", "license": "MIT", "code": {"repository": "https://github.com/jwohlwend/boltz", "revision": "v2.2.1", "package": "boltz==2.2.1"},
    "weights": [
      {
        "name": "boltz2_conf.ckpt", "uri": "https://huggingface.co/boltz-community/boltz-2/resolve/6fdef46d763fee7fbb83ca5501ccceff43b85607/boltz2_conf.ckpt", "revision": "6fdef46d763fee7fbb83ca5501ccceff43b85607",
        "sha256": "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1", "size_bytes": 2286561469
      }
    ]
  },
  "parameters": {"seed": 42, "recycling_steps": 3, "sampling_steps": 200, "diffusion_samples": 1, "step_scale": 1.5, "max_msa_seqs": 8192, "subsample_msa": false, "use_potentials": false, "output_format": "mmcif"},
  "msa": {
    "mode": "server", "server_url": "https://api.colabfold.com", "pairing_strategy": "greedy", "search_tool": {"name": "MMseqs2", "version": "18-8cc5c"},
    "databases": [{"name": "uniref30", "version": "2302"}, {"name": "colabfold_envdb", "version": "202108"}], "artifact_ids": ["art_msa_A"]
  },
  "source_datasets": [{"name": "UniProtKB", "version": "2026_03", "retrieved_at": "2026-10-03T16:49:58Z", "license": "CC-BY-4.0", "url": "https://rest.uniprot.org"}],
  "software": {
    "orphafold": {"version": "0.1.0", "git_commit": "0000000000000000000000000000000000000000"},
    "container": {"image": "ghcr.io/orphafold/worker-boltz", "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"}, "python": "3.12.7", "os": "linux", "cuda": "12.4",
    "hardware": {"accelerator": "gpu", "gpu_model": "NVIDIA A10G", "gpu_count": 1}, "packages": [{"name": "boltz", "version": "2.2.1"}, {"name": "torch", "version": "2.5.1"}]
  },
  "outputs": {
    "artifacts": [
      {
        "artifact_id": "art_model_0", "role": "structure", "path": "predictions/input/input_model_0.cif", "media_type": "chemical/x-mmcif", "size_bytes": 512345,
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000", "structure_origin": "orphafold_prediction", "sample_index": 0
      },
      {
        "artifact_id": "art_conf_0", "role": "confidence_summary", "path": "predictions/input/confidence_input_model_0.json", "media_type": "application/json", "size_bytes": 412,
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000", "sample_index": 0
      },
      {"artifact_id": "art_msa_A", "role": "msa", "path": "msa/A.a3m", "media_type": "text/x-a3m", "size_bytes": 3120044, "sha256": "0000000000000000000000000000000000000000000000000000000000000000"}
    ],
    "confidence": {
      "ranking_metric": "confidence_score",
      "samples": [
        {
          "sample_index": 0, "structure_artifact_id": "art_model_0",
          "metrics": {"confidence_score": 0.84, "ptm": 0.84, "iptm": 0.0, "complex_plddt": 0.84, "complex_iplddt": 0.0, "complex_pde": 0.89, "complex_ipde": 0.0, "chains_ptm": {"0": 0.84}}
        }
      ]
    }
  },
  "execution": {"argv": ["boltz", "predict", "input.yaml", "--model", "boltz2", "--seed", "42", "--use_msa_server", "--out_dir", "out"], "exit_code": 0, "wall_time_seconds": 217.4},
  "integrity": {"canonicalization": "RFC8785", "manifest_sha256": "b4d30dde64291e57c7068813d27d4058089af2a1b306df2316308fdfe69636b3"}
}
```

<!-- prettier-ignore-end -->

### 5.5 Hashing and replay

```python
import copy, hashlib, rfc8785   # rfc8785 0.1.4 on PyPI; npm "canonicalize" 5.1.0 (Apache-2.0) in TypeScript

def manifest_sha256(manifest: dict) -> str:
    unsigned = copy.deepcopy(manifest)
    del unsigned["integrity"]["manifest_sha256"]
    return hashlib.sha256(rfc8785.dumps(unsigned)).hexdigest()
```

- Write the manifest once, at terminal status. Corrections create a new job with `execution.parent_job_id`.
- Replay contract: manifest + stored MSA artifact + weights matched by SHA-256 + container digest. A rerun through the MSA server is a new run, never a replay.
- Expose `GET /api/runs/{job_id}/manifest.json` with `ETag: "<manifest_sha256>"` and long-lived caching.
- For predicted structures that leave OrphaFold as mmCIF, the `modelcif` package (1.8, MIT) writes ModelCIF metadata; the manifest remains the authoritative record.

## 6. Deliverable 3: project export and fork lineage

### 6.1 Precedents

| Platform                                | Fork mechanism and lineage                                                                                                           | Immutable reference                                                            | Adopt                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| GitHub (V, docs)                        | `POST /repos/{owner}/{repo}/forks` returns 202 and completes asynchronously; repo carries `fork`, `parent` (direct), `source` (root) | commit SHA URLs                                                                | store both parent and root pointers                        |
| OSF (V, API v2)                         | node `attributes.fork`, relationships `forks` and `registrations`; a registration is a frozen copy                                   | registration                                                                   | separate "fork" (editable copy) from "snapshot" (frozen)   |
| Zenodo (V, API)                         | each record has `conceptdoi` (all versions) and `doi` (this version); `relations.version[].is_last`; files carry `checksum`          | version DOI                                                                    | concept = project, version = snapshot when DOIs are minted |
| Hugging Face (V headers; S duplication) | "Duplicate" shows "Duplicated from"; Spaces keep commit history                                                                      | `/resolve/{commit}/{file}`, headers `x-repo-commit`, `x-linked-etag` (SHA-256) | revision-pinned URLs plus content hashes                   |
| protocols.io (S)                        | forks stay linked to the original and receive their own DOI; a DOI resolves to one version                                           | version DOI                                                                    | forks are citable objects                                  |
| Observable (S)                          | fork from any version in history; changes can be merged back                                                                         | version history                                                                | allow forking from any snapshot                            |
| Kaggle (S, weak)                        | "Copy & Edit"; saved versions                                                                                                        | version                                                                        | version on save                                            |

### 6.2 Object model and URLs

- `project`: mutable pointer with `head_snapshot_id`, owner, visibility (`private`, `unlisted`, `public`).
- `snapshot`: immutable. `snapshot_id = "ofs_" + first 32 hex of sha256(RFC 8785(project.json without snapshot.snapshot_id))`. Identical content yields the identical ID.
- `fork`: a new project whose first snapshot has `parent_snapshot_id` pointing into another project. It copies references; artifacts are content-addressed by SHA-256 and never duplicated.
- Runs are never copied or re-attributed. A fork references the original `job_id`; rerunning creates a new job whose `execution.parent_job_id` names the original.
- A snapshot with descendants cannot be deleted. The owner can unlist it; lineage keeps a tombstone (`snapshot_id`, `created_at`, `withdrawn: true`).

| URL                                           | Semantics                           | Cache                           |
| --------------------------------------------- | ----------------------------------- | ------------------------------- |
| `/p/{project_id}`                             | current head, editable by owner     | no-store                        |
| `/s/{snapshot_id}`                            | frozen view; this is the share URL  | immutable                       |
| `/s/{snapshot_id}/export.zip`                 | RO-Crate export                     | immutable                       |
| `/r/{job_id}` and `/r/{job_id}/manifest.json` | run view and manifest               | immutable after terminal status |
| `/e/{evidence_id}`                            | one evidence record with provenance | immutable                       |

### 6.3 Export layout (`<slug>-<snapshot_id>.orphafold.zip`, an RO-Crate 1.3 directory)

```
ro-crate-metadata.json          RO-Crate 1.3 + Process Run Crate 0.6 (section 6.4)
project.json                    OrphaFold project document (section 6.5)
ATTRIBUTION.md                  generated from the distinct source.database + source.license values in evidence.jsonl
evidence/evidence.jsonl         one Evidence record per line (section 2.5)
hypotheses/hypotheses.jsonl     Evidence records with class orphafold_hypothesis
runs/<job_id>/manifest.json     run manifest (section 5.3)
runs/<job_id>/artifacts/...     structures, confidence files, MSA, model input
sources/<database>/<sha256>.json  raw upstream responses, only where the licence permits redistribution (section 7.2)
notes/notes.md                  free-text notes
```

Import verifies every `sha256`, re-validates manifests against the schema, and recomputes `snapshot_id` before accepting a crate.

### 6.4 `ro-crate-metadata.json` (passes `rocrate-validator validate -p ro-crate-1.3 --requirement-severity REQUIRED` with `roc-validator` 0.12.1; identifiers, publisher URL, file sizes and hashes come from a throwaway test crate)

<!-- prettier-ignore-start -->

```json
{
  "@context": "https://w3id.org/ro/crate/1.3/context",
  "@graph": [
    {"@id": "ro-crate-metadata.json", "@type": "CreativeWork", "conformsTo": {"@id": "https://w3id.org/ro/crate/1.3"}, "about": {"@id": "./"}},
    {
      "@id": "./", "@type": "Dataset", "name": "BTK p.Arg525Gln structural hypothesis", "description": "OrphaFold research project export. Research use only; not for clinical decision-making.",
      "datePublished": "2026-10-03T17:00:00Z", "license": {"@id": "https://creativecommons.org/licenses/by/4.0/"}, "identifier": {"@id": "#snapshot-id"}, "conformsTo": {"@id": "https://w3id.org/ro/wfrun/process/0.6"},
      "author": {"@id": "#actor-act_01K6N3Y0000000000000000000"}, "isBasedOn": {"@id": "urn:orphafold:snapshot:ofs_parent_placeholder"},
      "hasPart": [{"@id": "project.json"}, {"@id": "evidence/evidence.jsonl"}, {"@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/manifest.json"}, {"@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/artifacts/input_model_0.cif"}],
      "mentions": {"@id": "#job_01K6N3Z8Q2W7X5T4N6B8M0R1CD"}, "publisher": {"@id": "#orphafold"}
    },
    {"@id": "https://creativecommons.org/licenses/by/4.0/", "@type": "CreativeWork", "name": "Creative Commons Attribution 4.0 International", "identifier": "CC-BY-4.0"},
    {"@id": "https://w3id.org/ro/wfrun/process/0.6", "@type": ["CreativeWork", "Profile"], "name": "Process Run Crate", "version": "0.6"},
    {"@id": "urn:orphafold:snapshot:ofs_parent_placeholder", "@type": "CreativeWork", "name": "Parent snapshot this project was forked from"},
    {"@id": "#actor-act_01K6N3Y0000000000000000000", "@type": "Person", "name": "Anonymous researcher"},
    {"@id": "https://github.com/jwohlwend/boltz", "@type": "SoftwareApplication", "name": "Boltz", "version": "2.2.1", "url": "https://github.com/jwohlwend/boltz", "license": {"@id": "https://spdx.org/licenses/MIT"}},
    {
      "@id": "#job_01K6N3Z8Q2W7X5T4N6B8M0R1CD", "@type": "CreateAction", "name": "Boltz-2 structure prediction of BTK p.Arg525Gln", "description": "Structure prediction run recorded by OrphaFold",
      "instrument": {"@id": "https://github.com/jwohlwend/boltz"}, "agent": {"@id": "#actor-act_01K6N3Y0000000000000000000"}, "startTime": "2026-10-03T16:50:04Z", "endTime": "2026-10-03T16:53:41Z",
      "actionStatus": "http://schema.org/CompletedActionStatus", "object": {"@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/manifest.json"}, "result": {"@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/artifacts/input_model_0.cif"}
    },
    {
      "@id": "project.json", "@type": "File", "name": "OrphaFold project document", "encodingFormat": "application/json", "description": "OrphaFold project document", "contentSize": "27",
      "sha256": "57bd3811e855786445388d488fb0c0557ded8dcada53de089a6565a143002be9"
    },
    {
      "@id": "evidence/evidence.jsonl", "@type": "File", "name": "Evidence records", "encodingFormat": "application/jsonl", "description": "Evidence records", "contentSize": "14",
      "sha256": "98c0779c201834852e69b02abfdbcf16cffd60c335bf3ca7d6a24abe2db4b1a5"
    },
    {
      "@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/manifest.json", "@type": "File", "name": "Run manifest", "encodingFormat": "application/json", "description": "Run manifest", "contentSize": "6871",
      "sha256": "a8b9d7ad790e3ea2c54765ad903391d9763daa1c5a7a5353298e052bd318356a"
    },
    {
      "@id": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/artifacts/input_model_0.cif", "@type": "File", "name": "Predicted structure, sample 0", "encodingFormat": "chemical/x-mmcif", "description": "Predicted structure, sample 0",
      "contentSize": "27", "sha256": "0e43f452b24e6aea3ec31b8e7ea090b1c5d9cbb5bb1f99457426815dc4fbd53e"
    },
    {"@id": "#snapshot-id", "@type": "PropertyValue", "propertyID": "orphafold-snapshot", "name": "OrphaFold snapshot id", "value": "ofs_placeholder"},
    {"@id": "#orphafold", "@type": "Organization", "name": "OrphaFold", "url": "https://github.com/orphafold/orphafold"},
    {"@id": "https://spdx.org/licenses/MIT", "@type": "CreativeWork", "name": "MIT License", "identifier": "MIT"}
  ]
}
```

Remaining RECOMMENDED-level findings are identity-related (ORCID `@id`, affiliation, ROR, contact point) and disappear once the author is an ORCID-linked account. The validator has no Process Run Crate 0.6 profile yet, so that conformance claim is checked by OrphaFold's own tests.

### 6.5 `project.json`

```json
{
  "export_version": "1.0.0", "project_id": "prj_01K6N3X0000000000000000000", "title": "BTK p.Arg525Gln structural hypothesis", "license": "CC-BY-4.0", "research_use_only": true,
  "snapshot": {
    "snapshot_id": "ofs_<32 hex>", "sequence_number": 3, "created_at": "2026-10-03T17:00:00Z", "created_by": "act_01K6N3Y0000000000000000000", "message": "Add R525Q prediction",
    "parent_snapshot_id": "ofs_<32 hex>"
  },
  "lineage": {"forked_from": {"project_id": "prj_<parent>", "snapshot_id": "ofs_<32 hex>"}, "root_project_id": "prj_<root>", "fork_depth": 1},
  "focus": {"disease": "MONDO:0010421", "gene": "hgnc:1133", "protein": "uniprot:Q06187", "variants": ["ga4gh:VA.nyFINfEHbVPUXhxwnoHBynF7hPamBemE"]},
  "contents": {
    "evidence": {"path": "evidence/evidence.jsonl", "count": 12, "sha256": "<sha256>"}, "hypotheses": {"path": "hypotheses/hypotheses.jsonl", "count": 1, "sha256": "<sha256>"},
    "runs": [{"job_id": "job_01K6N3Z8Q2W7X5T4N6B8M0R1CD", "manifest_path": "runs/job_01K6N3Z8Q2W7X5T4N6B8M0R1CD/manifest.json", "manifest_sha256": "<sha256>"}],
    "notes": {"path": "notes/notes.md", "sha256": "<sha256>"}
  },
  "source_dataset_versions": [{"name": "UniProtKB", "version": "2026_03"}, {"name": "ClinVar", "version": "Build260929-0200.1"}], "attribution_path": "ATTRIBUTION.md"
}
```

<!-- prettier-ignore-end -->

### 6.6 Lineage tables

| Table                                    | Columns                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`                                | `project_id` (primary key), `owner_actor_id`, `head_snapshot_id`, `forked_from_project_id` (references `project`), `forked_from_snapshot_id`, `root_project_id` (not null; equals `project_id` for originals), `visibility` (`private`, `unlisted`, `public`), `created_at` |
| `snapshot`                               | `snapshot_id` (primary key, content hash), `project_id` (references `project`), `parent_snapshot_id` (references `snapshot`), `sequence_number` (unique per project), `export_sha256`, `created_by_actor_id`, `message`, `withdrawn` (default false), `created_at`          |
| `actor`, `actor_identity`, `actor_alias` | `actor(actor_id, kind, orcid, created_at, upgraded_at)`; `actor_identity(actor_id, provider, provider_user_id)`; `actor_alias(old_actor_id, new_actor_id)`                                                                                                                  |

Lineage queries walk `snapshot.parent_snapshot_id` with a recursive CTE. An index on `root_project_id` gives "all forks of X" in one lookup.

### 6.7 Anonymous-first identity

- Create an `actor` row (`actor_id`, `kind: anonymous`) on the first write, never on page view. Bind it to an HttpOnly, Secure, SameSite=Lax session cookie. Collect no personal data.
- Own an `actor_id` that is separate from the auth provider's user ID, with `actor_identity(actor_id, provider, provider_user_id)`. Supabase keeps the same user ID when an anonymous user links an identity (`signInAnonymously()`, then `updateUser({email})` or `linkIdentity({provider})`; JWT claim `is_anonymous`; manual linking must be enabled) (V, docs). Better Auth's anonymous plugin creates a second user row and hands both to `onLinkAccount({anonymousUser, newUser})` (S). A separate `actor_id` makes both behave the same.
- Upgrade = set `kind: account` on the same actor. If the person already has an account on another device, re-parent projects to that actor and write `actor_alias(old_actor_id, new_actor_id)`. `created_by_actor_id` on snapshots and manifests never changes.
- With Supabase, anonymous users hold the `authenticated` Postgres role, so every row-level-security policy that should exclude them must test the claim, as in the documented restrictive policy `with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false)` (V, docs).
- Capability split, aligned with `docs/PRODUCT_BRIEF.md` (accounts for saving, expensive computation, history, publishing and forking): anonymous actors explore, keep a device-bound workspace, run small jobs within a quota and share unlisted snapshot links. Publishing, forking, larger compute, DOI minting and cross-device history require an account. The actor row predates the account, so nothing is lost at upgrade. ORCID sign-in (issuer `https://orcid.org`, authorization endpoint `https://orcid.org/oauth/authorize`, scope `openid`; V) supplies the `orcid` field in manifests and the `Person` `@id` in crates.

## 7. Deliverable 4: licensing

### 7.1 Repository licence: Apache-2.0

| Criterion                                                                                                                                                               | Apache-2.0                                       | MIT                                                                    | AGPL-3.0              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------- |
| Explicit patent grant from contributors                                                                                                                                 | yes                                              | no                                                                     | yes                   |
| Hospitals, institutes and companies can self-host and extend without source-disclosure duties                                                                           | yes                                              | yes                                                                    | no (network copyleft) |
| Compatible with dependencies checked today: Boltz MIT, ColabFold MIT, MMseqs2 MIT, Molstar MIT, vrs-python Apache-2.0, ro-crate-py Apache-2.0, roc-validator Apache-2.0 | yes                                              | yes                                                                    | yes                   |
| `NOTICE` file with defined redistribution rules                                                                                                                         | yes                                              | no                                                                     | no                    |
| Peers (licence files read today)                                                                                                                                        | Open Targets `ot-ui-apps`, Ensembl VEP, Nextflow | UniProt website, gnomAD browser, Molstar, Galaxy (MIT from 2026-02-25) | cBioPortal            |

- Code, JSON Schemas, worker images: **Apache-2.0**, with `SPDX-License-Identifier: Apache-2.0` headers.
- Documentation and OrphaFold-written explanatory content: **CC BY 4.0**.
- OrphaFold-original data tables (class mappings, enum tables, ECO defaults): **CC0-1.0**.
- Third-party seed data: `data/seed/<source>/` with that source's `LICENSE` and a `SOURCE.json` (`name`, `release`, `retrieved_at`, `url`, `license`, `sha256`, `modified: true|false`). The repository root licence does not cover these directories; say so in `README` and `NOTICE`.
- Contributions under the Developer Certificate of Origin (`Signed-off-by`). Add `CITATION.cff` (`cff-version: 1.2.0`).
- Keep GPL and AGPL code out of the dependency tree: npm `ro-crate` 3.7.2 is GPL-3.0-or-later.
- Published user projects: CC BY 4.0 by default, CC0-1.0 selectable. The licence covers the user's hypotheses and notes; embedded upstream records keep `source.license`.

### 7.2 Data licence compatibility

"Seed" = redistributed inside the repository. "Live" = fetched at runtime and cached per deployment.

| Source               | Licence and terms                                                                                                                                                                                                                                                                                                                                                                                                 | Seed                                                                                                                                                                         | Live                                  | Required attribution                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ClinVar              | NCBI "places no restrictions on the use or distribution" of molecular data; submitters may hold rights; ClinVar asks for attribution (V)                                                                                                                                                                                                                                                                          | Yes, pinned subset                                                                                                                                                           | Yes                                   | "ClinVar (NCBI), build/date"; cite PMID 29165669; show the notice that ClinVar is not intended for direct diagnostic use or medical decision-making without review by a genetics professional |
| UniProt              | CC BY 4.0 (V)                                                                                                                                                                                                                                                                                                                                                                                                     | Yes                                                                                                                                                                          | Yes                                   | "UniProt Consortium, UniProtKB release 2026_03, CC BY 4.0"; cite NAR 53:D609-D617 (2025); state modifications                                                                                 |
| AlphaFold DB         | CC BY 4.0, academic and commercial (V)                                                                                                                                                                                                                                                                                                                                                                            | Yes, selected models with version suffix                                                                                                                                     | Yes                                   | Jumper et al., Nature (2021); Fleming et al., J Mol Biol (2025); Bertoni et al., NAR (2025); "AlphaFold Data Copyright (2022) DeepMind Technologies Limited"                                  |
| AlphaMissense        | Predictions CC BY 4.0 (V: GitHub README, Zenodo `10.5281/zenodo.10813168`); code Apache-2.0. Older mirrors still show CC BY-NC-SA                                                                                                                                                                                                                                                                                 | Yes, per-protein slices                                                                                                                                                      | Yes, via AFDB `amAnnotationsUrl`      | Cheng et al., Science (2023)                                                                                                                                                                  |
| RCSB PDB             | CC0 1.0 for archive files and API data (V)                                                                                                                                                                                                                                                                                                                                                                        | Yes                                                                                                                                                                          | Yes                                   | None required; requested: PDB ID, primary citation, RCSB PDB / wwPDB                                                                                                                          |
| ChEMBL               | CC BY-SA 3.0 Unported (V: `LICENSE` on FTP)                                                                                                                                                                                                                                                                                                                                                                       | Only in an isolated directory under CC BY-SA 3.0; never joined into a shipped seed database                                                                                  | Yes (preferred)                       | Mendez et al., NAR 47:D930-D940 (2019); preserve ChEMBL IDs; display release (`ChEMBL_37`). Adapted databases must be shared under the same licence                                           |
| PubChem              | NCBI imposes no restriction; contributed data may carry depositor terms. Source table has `License URL` and `License Note` columns: 904 of 1,131 sources state none; others range from CC BY 4.0 and CC0 to CC BY-NC-ND 4.0 (V)                                                                                                                                                                                   | Identifiers and PubChem-computed properties only (CID, InChIKey, formula)                                                                                                    | Yes                                   | "PubChem (NCBI/NLM)"; for annotations show the depositor's source name and licence URL                                                                                                        |
| Orphanet / Orphadata | Orphadata Science datasets and API: CC BY 4.0 (API payload carries `__licence`). Other site content: no reuse without written consent. Orphadata Products need a data transfer agreement (V)                                                                                                                                                                                                                      | Yes, Orphadata Science only                                                                                                                                                  | Yes                                   | "Orphadata Science: Free access data from Orphanet. (c) INSERM 1999. Available on http://sciences.orphadata.com/. Data version [date]"; state changes; no logos without approval              |
| OMIM                 | Copyright Johns Hopkins University; registration and yearly API key; no redistribution, no derivative databases, licence needed to redisplay (S: site blocks automated fetch)                                                                                                                                                                                                                                     | **No**                                                                                                                                                                       | Link out only                         | Store MIM numbers obtained from Mondo, UniProt, ClinVar or Orphanet cross-references and link to omim.org                                                                                     |
| HPO                  | Custom licence (V, hpo.jax.org bundle): free to use; acknowledge and cite; show version; content and logical relationships must not be altered                                                                                                                                                                                                                                                                    | Yes, unmodified release files                                                                                                                                                | Yes                                   | "This service/product uses the Human Phenotype Ontology (version 2026-09-01). Find out more at http://www.human-phenotype-ontology.org"; HPO logo requested                                   |
| Mondo                | CC BY 4.0 (V)                                                                                                                                                                                                                                                                                                                                                                                                     | Yes                                                                                                                                                                          | Yes                                   | Vasilevsky et al., Genetics 232(4):iyaf215 (2026); release tag                                                                                                                                |
| Open Targets         | CC0 1.0 for Platform data; upstream sources keep their own terms (V)                                                                                                                                                                                                                                                                                                                                              | Yes                                                                                                                                                                          | Yes                                   | Citation requested: Buniello et al., NAR (2025)                                                                                                                                               |
| Ensembl              | "no restrictions on access to, or use of, the data"; code Apache-2.0; third-party constraints may apply (V)                                                                                                                                                                                                                                                                                                       | Yes                                                                                                                                                                          | Yes                                   | "Ensembl release 116"; cite the current Ensembl paper                                                                                                                                         |
| Europe PMC abstracts | Copyright stays with publishers and authors; NLM "does not claim the copyright on the abstracts in PubMed" (V); open-access subset carries per-article licences in the API `license` field (V); Europe PMC copyright page itself blocked automated fetch (S)                                                                                                                                                      | Bibliographic identifiers only (PMID, PMCID, DOI, title, journal, year)                                                                                                      | Yes: fetch and display abstracts live | Cite the article. Store full text only when `isOpenAccess == "Y"` and `license` is `cc by` or `cc0`                                                                                           |
| STRING               | CC BY 4.0, commercial use included (V)                                                                                                                                                                                                                                                                                                                                                                            | Yes                                                                                                                                                                          | Yes                                   | Szklarczyk et al., NAR 53:D730-D737 (2025); state modifications; version 12.5                                                                                                                 |
| Reactome             | Data CC0; illustrations and icons CC BY 4.0; software Apache-2.0 (V)                                                                                                                                                                                                                                                                                                                                              | Yes                                                                                                                                                                          | Yes                                   | Encouraged: Ragueneau et al., NAR (2025), doi:10.1093/nar/gkaf1223; version 97                                                                                                                |
| IUIS publications    | 2024 genotypic update (J Hum Immun 2025, doi:10.70962/jhi.20250003) and 2024 phenotypic classification (doi:10.70962/jhi.20250002): **CC BY-ND 4.0** (V: Europe PMC API `license` field for both, licence element in the full-text XML of the first). 2022 update (J Clin Immunol, doi:10.1007/s10875-022-01289-3): CC BY 4.0. 2022 phenotypical classification (doi:10.1007/s10875-022-01352-z): not open access | Gene-to-IUIS-table assignments as cited facts, pending counsel. No reformatted 2024 tables or copied descriptive text. The 2022 CC BY tables can be adapted with attribution | Link by DOI                           | Poli et al. and Bousfiha et al., J Hum Immun (2025); Tangye et al., J Clin Immunol (2022)                                                                                                     |
| ClinGen (added)      | CC0 1.0 for curated content; attribution with access date requested (V)                                                                                                                                                                                                                                                                                                                                           | Yes                                                                                                                                                                          | Yes                                   | "Clinical Genome Resource. URL [date accessed]"; Rehm et al., NEJM (2015)                                                                                                                     |
| ECO (added)          | CC0-1.0 (V)                                                                                                                                                                                                                                                                                                                                                                                                       | Yes                                                                                                                                                                          | Yes                                   | Release date                                                                                                                                                                                  |

Rules that follow:

- Each CC BY source needs credit, a licence link and a change notice. Generate `ATTRIBUTION.md` and the in-app "Data sources" page from the `SOURCE.json` files, and write the same block into every export.
- ChEMBL rows join at query time. An export that includes ChEMBL-derived records labels them `CC-BY-SA-3.0` and keeps them in a separate file.
- Open Targets lists HPO as CC0 1.0 and Ensembl as CC BY 4.0, which differs from what HPO and Ensembl state themselves. Follow each provider's own terms.
- Raw upstream responses go into `sources/` in an export only for the rows marked "Seed: Yes".

### 7.3 Model licences for provider adapters

| Model             | Code                          | Weights and outputs                                                                                          | Adapter policy                                                                                                         |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Boltz-1 / Boltz-2 | MIT (V)                       | MIT, commercial use allowed (V)                                                                              | default provider                                                                                                       |
| Chai-1            | Apache-2.0 (V, `LICENSE`)     | Apache-2.0 since 2024-11 (S)                                                                                 | allowed                                                                                                                |
| Protenix v1       | Apache-2.0 (V, README)        | Apache-2.0                                                                                                   | allowed                                                                                                                |
| Protenix-v2       | Apache-2.0                    | proprietary: "may not be reproduced, distributed, sublicensed" (V, README)                                   | never bundle                                                                                                           |
| OpenFold3         | Apache-2.0 (S)                | preview weights Apache-2.0 behind a contact gate; licence of newer default weights unconfirmed (S)           | confirm before enabling                                                                                                |
| AlphaFold 3       | Apache-2.0 `LICENSE` file (V) | weights under Google terms, non-commercial, no redistribution; outputs carry non-commercial Output Terms (S) | off by default, user-supplied weights, tag outputs `LicenseRef-AlphaFold3-Output-Terms`, exclude from public snapshots |

The manifest's `model.license` field drives export rules: an artifact from a model whose output terms restrict use inherits that restriction in the crate.

### 7.4 `NOTICE` (ship at repository root; mirror in `ATTRIBUTION.md` and the in-app sources page)

```
OrphaFold
Copyright 2026 The OrphaFold Authors
Licensed under the Apache License, Version 2.0. Documentation: CC BY 4.0.
OrphaFold is a research and hypothesis-generation tool. It is not clinical decision software.

Third-party data in data/seed/ is NOT covered by the Apache-2.0 licence. Each directory carries its own LICENSE and SOURCE.json.

ClinVar            NCBI/NLM. No NCBI-imposed restrictions. Landrum MJ et al., Nucleic Acids Res 2018 (PMID 29165669).
                   Not intended for direct diagnostic use or medical decision-making without review by a genetics professional.
UniProtKB          (c) UniProt Consortium. CC BY 4.0. Nucleic Acids Res 53:D609-D617 (2025). Modified: subset, reformatted.
AlphaFold DB       AlphaFold Data Copyright (2022) DeepMind Technologies Limited. CC BY 4.0. Jumper J et al., Nature (2021);
                   Fleming J et al., J Mol Biol (2025); Bertoni D et al., Nucleic Acids Res (2025).
AlphaMissense      CC BY 4.0. Cheng J et al., Science (2023). doi:10.5281/zenodo.10813168.
RCSB PDB / wwPDB   CC0 1.0. Cite PDB IDs and primary citations of individual entries.
ChEMBL             EMBL-EBI. CC BY-SA 3.0 Unported. Mendez D et al., Nucleic Acids Res 47:D930-D940 (2019). ChEMBL IDs preserved.
                   Distributed separately from other data; adaptations are CC BY-SA 3.0.
PubChem            NCBI/NLM. Depositor-contributed content is subject to the terms of the original source.
Orphadata Science  Free access data from Orphanet. (c) INSERM 1999. Available on http://sciences.orphadata.com/. CC BY 4.0.
                   Modified: subset, reformatted.
HPO                This product uses the Human Phenotype Ontology (version as recorded in SOURCE.json).
                   Find out more at http://www.human-phenotype-ontology.org. HPO files are redistributed unmodified.
Mondo              CC BY 4.0. Vasilevsky NA et al., Genetics 232(4):iyaf215 (2026).
Open Targets       CC0 1.0. Buniello A et al., Nucleic Acids Res (2025).
Ensembl            EMBL-EBI. Data without restriction; code Apache-2.0.
STRING             CC BY 4.0. Szklarczyk D et al., Nucleic Acids Res 53:D730-D737 (2025). Modified: subset.
Reactome           Data CC0. Ragueneau E et al., Nucleic Acids Res (2025), doi:10.1093/nar/gkaf1223.
ClinGen            CC0 1.0. Clinical Genome Resource, https://clinicalgenome.org [date accessed]. Rehm HL et al., N Engl J Med (2015).
ECO                Evidence and Conclusion Ontology. CC0 1.0.
Europe PMC         Bibliographic identifiers only. Abstracts and full text remain under the copyright of publishers and authors.
IUIS               Poli MC et al., J Hum Immun (2025), doi:10.70962/jhi.20250003 (CC BY-ND 4.0, cited, not redistributed).
                   Tangye SG et al., J Clin Immunol (2022), doi:10.1007/s10875-022-01289-3 (CC BY 4.0).
OMIM               No OMIM content is included. MIM numbers appear only as cross-references supplied by other sources.

Software
Boltz              MIT. Wohlwend J et al. (Boltz-1, doi:10.1101/2024.11.19.624167); Passaro S et al. (Boltz-2, doi:10.1101/2025.06.14.659707).
ColabFold/MMseqs2  MIT. Mirdita M et al., Nature Methods (2022). Cite when the MSA server is used.
```

## 8. Unverified or open

- **OMIM terms**: omim.org returned HTTP 403 to automated fetches; terms above come from search-engine excerpts of the Use Agreement, API and copyright pages.
- **Europe PMC copyright page** and **PubChem's own data-usage page**: not retrievable (403 and client-rendered). Statements rest on the NCBI policy page, the EMBL-EBI terms of use, the PubChem source table and API fields.
- **IUIS CC BY-ND and extracted facts**: whether a gene-to-table list is an adaptation is a legal question. The licence prose in the article says "Attribution 4.0 International" while its link and machine-readable tag say BY-ND; the stricter reading is used here.
- **VRS 2.1.x approval status**: GitHub shows `2.1.1`; the GA4GH product page still names v2.0 as last approved. A search summary mentioned a `2.2.0` ballot tag that the releases page did not show.
- **ACMG/AMP v4.0**: not confirmed as published after March 2026.
- **ro-crate-py and RO-Crate 1.3**: README claims 1.2; 1.3 output untested. **Process Run Crate 0.6** cannot be machine-validated with `roc-validator` 0.12.1.
- **Seeded Boltz determinism**: whether a fixed `--seed` gives identical coordinates across GPU models was not tested.
- **ColabFold public server databases**: versions come from `setup_databases.sh` defaults; the "MSA Server Database History" wiki page was not read. No server endpoint reporting versions was found.
- **Fork semantics of Observable, Kaggle, protocols.io**; **Better Auth anonymous plugin**; **Chai-1, OpenFold3 and AlphaFold 3 weight terms**; **AlphaMissense relicensing date (March 2024)**; **VA-Spec field names**: secondary sources only.
- **NCBI `/spdi/{spdi}/ga4gh-vr`**: HTTP 502 on both attempts, output format unknown.
- **AlphaFold DB pLDDT band thresholds** and **REUSE specification version**: pages are client-rendered and were not read.
- **STRING 12.5 release date**: the access page reads "current: since September 29, 2026"; taken at face value.
- **Reference BTK variant**: `p.Arg525Gln` is used as an identifier example only; its clinical classification was not looked up.

## 9. Sources

- ECO: https://www.ebi.ac.uk/ols4/api/ontologies/eco , https://github.com/evidenceontology/evidenceontology , https://www.evidenceontology.org
- PROV: https://www.w3.org/TR/prov-o/ , https://www.w3.org/submissions/prov-json/
- RO-Crate: https://www.researchobject.org/ro-crate/specification/1.3/ , https://www.researchobject.org/ro-crate/specification/1.3/appendix/changelog.html , https://doi.org/10.5281/zenodo.20720080 , https://w3id.org/ro/wfrun/process/0.6 , https://www.researchobject.org/workflow-run-crate/ , https://pypi.org/project/roc-validator/ , https://pypi.org/project/rocrate/
- VRS and HGVS: https://github.com/ga4gh/vrs/releases , https://w3id.org/ga4gh/schema/vrs/2.1.1/json/Allele , https://www.ga4gh.org/product/variation-representation/ , https://pypi.org/project/ga4gh.vrs/ , https://normalize.cancervariants.org/variation/openapi.json , https://reg.clinicalgenome.org , https://hgvs-nomenclature.org/stable/ , https://va-spec.ga4gh.org/en/latest/ , https://api.ncbi.nlm.nih.gov/variation/v0/var_service.yaml , https://rest.ensembl.org
- Evidence strength: https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/ , https://rest.uniprot.org/help/evidences , https://platform-docs.opentargets.org/associations , https://api.platform.opentargets.org/api/v4/graphql , https://search.clinicalgenome.org/api/validity , https://erepo.genome.network/evrepo/api/classifications , https://www.acmg.net/ACMG/Medical-Genetics-Practice-Resources/Documents_in_Development.aspx
- Boltz and MSA: https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md , https://github.com/jwohlwend/boltz/blob/main/src/boltz/main.py , https://huggingface.co/api/models/boltz-community/boltz-2?blobs=true , https://pypi.org/project/boltz/ , https://github.com/sokrypton/ColabFold/blob/main/setup_databases.sh
- Licences: https://rest.uniprot.org/help/license , https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/ , https://www.ncbi.nlm.nih.gov/home/about/policies/ , https://alphafold.ebi.ac.uk/download , https://github.com/google-deepmind/alphamissense , https://www.rcsb.org/pages/usage-policy , https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/latest/LICENSE , https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/latest/REQUIRED.ATTRIBUTION , https://pubchem.ncbi.nlm.nih.gov/rest/pug/sourcetable/all/JSON , https://www.orphadata.com/legal-notice/ , https://www.omim.org/help/agreement , https://hpo.jax.org (route `/license`) , https://github.com/monarch-initiative/mondo , https://platform-docs.opentargets.org/licence , https://jun2026.archive.ensembl.org/info/about/legal/disclaimer.html , https://www.ebi.ac.uk/about/terms-of-use/ , https://europepmc.org/Copyright , https://string-db.org/cgi/access , https://reactome.org/license , https://clinicalgenome.org/docs/terms-of-use/ , https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12829761/fullTextXML
- Model terms: https://github.com/bytedance/Protenix , https://github.com/chaidiscovery/chai-lab , https://github.com/google-deepmind/alphafold3/blob/main/WEIGHTS_TERMS_OF_USE.md , https://github.com/google-deepmind/alphafold3/blob/main/OUTPUT_TERMS_OF_USE.md , https://huggingface.co/OpenFold/OpenFold3
- Forks, sharing, identity: https://docs.github.com/en/rest/repos/forks , https://api.osf.io/v2/ , https://zenodo.org/api/records/20720080 , https://huggingface.co/docs/hub/en/repositories-next-steps , https://observablehq.com/documentation/notebooks/history , https://supabase.com/docs/guides/auth/auth-anonymous , https://better-auth.com/docs/plugins/anonymous , https://orcid.org/.well-known/openid-configuration
- Identifiers and tooling: https://bioregistry.io , https://spdx.org/licenses/ , https://citation-file-format.github.io/ , https://pypi.org/project/rfc8785/ , https://www.npmjs.com/package/canonicalize
