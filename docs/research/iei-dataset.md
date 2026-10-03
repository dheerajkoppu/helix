# IEI dataset: importing the current IUIS classification

Researched and tested 2026-10-03. Every URL, count and field name below was retrieved with `curl` or the Python standard library on that date unless listed in section 13 (Unverified).

## 0. Recommendation for Helix

1. **Authoritative snapshot**: the IUIS "2024 update" genotypic classification (Poli et al., _J Hum Immun_ 2025, doi:10.70962/jhi.20250003, published 2025-04-15). No newer IUIS classification or interim update is indexed in PubMed as of 2026-10-03.
2. **Primary machine-readable source**: the article's JATS XML from Europe PMC (`PMC12829761/fullTextXML`), which contains all ten tables. The script in section 5 downloads and parses all sources in about 15 seconds with no third-party packages and yields 603 rows and 508 distinct HGNC genes.
3. **Secondary source**: the IUIS-hosted Excel (`IUIS-IEI-list-for-web-site-July-2024V2.xlsx`). It is a pre-publication snapshot (582 rows, 505 genes, no Table 10) and adds ICD-9, ICD-10 and category-level HPO columns. Use it for those columns and as a cross-check.
4. **Homepage number**: render it from the seed manifest (`distinct_genes`), which currently equals **508**. Cite "IUIS 2024 update: 508 genes, 559 inborn errors of immunity, 17 phenocopies". For structure features use **503 proteins** (five IUIS genes are non-coding RNAs).
5. **License constraint**: the 2024 article is CC BY-ND 4.0. Store IUIS-derived facts as identifiers and codes (HGNC ID, table and subtable number, inheritance code, OMIM number, short disease label). Do not copy the free-text clinical columns. Get written confirmation from the IUIS IEI committee or Rockefeller University Press before publishing the derived index in the repository; until then fetch at build time. A fully open fallback exists (section 3).
6. **Open layers for everything else**: HGNC (CC0) for identifiers, GenCC (CC0) and ClinGen (CC0) for MONDO disease IDs, validity and mode of inheritance, Orphadata (CC BY 4.0) for ORPHAcodes, cross-references and HPO frequencies, HPO annotation files for phenotypes, UniProt (CC BY 4.0) and ClinVar (public domain) for proteins and variants, Open Targets (CC0) for drug candidates.
7. **Do not use** OMIM bulk data, Genomics England PanelApp content (non-commercial terms), or AI-curated knowledge bases as fact sources.

## 1. Current state of the IUIS classification

| Item                                            | Value                                                                                                                                                 | Evidence                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Latest genotypic classification                 | "2024 update", Poli MC et al., _J Hum Immun_ 1(1):e20250003, 2025-04-15. PMID 41608114, PMCID PMC12829761                                             | Crossref, Europe PMC, PubMed                                                                  |
| Latest phenotypic classification                | Bousfiha AA et al., _J Hum Immun_ 1(1):e20250002. PMID 41608113, PMCID PMC12829316. 21 figures (decision trees), zero tables, Data S1 is a PDF        | JATS XML                                                                                      |
| Genes                                           | 508                                                                                                                                                   | Abstract: "involving 508 different genes and 17 phenocopies"                                  |
| Conditions (IEIs)                               | 559                                                                                                                                                   | Body text: "increases the number of genes associated with IEI to 508, causing 559 conditions" |
| Phenocopies (Table 10)                          | 17 (8 somatic, 9 autoantibody)                                                                                                                        | Table 10 footer                                                                               |
| New since June 2022 update                      | 67 monogenic defects and 2 phenocopies                                                                                                                | Abstract                                                                                      |
| Previous update                                 | 2022 (Tangye et al., _J Clin Immunol_, doi:10.1007/s10875-022-01289-3): 485 IEIs                                                                      | Abstract                                                                                      |
| Pre-publication PDF on IUIS site (January 2025) | 555 IEIs, 504 genes, 63 novel defects. Superseded by the published numbers                                                                            | PDF text                                                                                      |
| Newer update                                    | None found. PubMed searches for IUIS classification, interim or committee updates from 2025-05-15 to 2026-10-03 returned no IUIS classification paper | E-utilities                                                                                   |
| Cadence                                         | Committee "strives to publish an updated report every 2 years"                                                                                        | Body text                                                                                     |

IUIS states that the 508 includes "four chromosomal deletion syndromes" and "KRAS, NRAS, and UBA1, for which disease is only described due to somatic variants (Table 10)".

### Table structure (published tables)

| Table      | Title                                                                  | Subtables            | IUIS-stated total (footer) | Parsed rows | Distinct HGNC genes                           |
| ---------- | ---------------------------------------------------------------------- | -------------------- | -------------------------- | ----------- | --------------------------------------------- |
| 1          | Immunodeficiencies affecting cellular and humoral immunity             | 3                    | 73                         | 73          | 71                                            |
| 2          | CIDs with associated or syndromic features                             | 9                    | 83                         | 87          | 78                                            |
| 3          | Predominantly antibody deficiencies                                    | 4 (body text says 3) | 48                         | 57          | 45                                            |
| 4          | Diseases of immune dysregulation                                       | 7                    | 72                         | 73          | 72                                            |
| 5          | Congenital defects of phagocyte number or function                     | 4                    | 45                         | 45          | 45                                            |
| 6          | Defects in intrinsic and innate immunity                               | 9                    | 86                         | 90          | 82                                            |
| 7          | Autoinflammatory disorders                                             | 3                    | 69                         | 78          | 64                                            |
| 8          | Complement deficiencies                                                | none                 | 36                         | 36          | 33                                            |
| 9          | Bone marrow failure                                                    | 1                    | 47                         | 47          | 43                                            |
| 10         | Phenocopies of IEIs associated with autoantibodies or somatic variants | 2 groups             | 17                         | 17          | n/a                                           |
| Sum 1 to 9 |                                                                        | 40                   | **559**                    | 586         | **508** (22 genes sit in more than one table) |

Parsed rows exceed the stated totals because the tables split some conditions across rows (one row per gene or per inheritance mode).

Subtable labels (published wording):

- Table 1: 1 T-B+ SCID; 2 T-B- SCID; 3 CID, generally less profound than SCID
- Table 2: 1 Immunodeficiency with congenital thrombocytopenia; 2 DNA repair defects other than those listed in Table 1; 3 Thymic defects with additional congenital anomalies; 4 Immuno-osseous dysplasias; 5 Syndromes associated with elevated IgE and/or atopic disease (HIES); 6 Defects of vitamin B12 and folate metabolism; 7 Anhidrotic ectodermodysplasia with immunodeficiency (EDA-ID); 8 Calcium channel defects; 9 Other defects
- Table 3: 1 Agammaglobulinemia (severe reduction in all isotypes, absent B cells); 2 CVID phenotype; 3 Hyper-IgM; 4 Isotype, light chain, or functional deficiencies with generally normal B cells
- Table 4: 1 FHL syndromes; 2 FHL syndromes with hypopigmentation; 3 Regulatory T-cell defects; 4 Autoimmunity with or without lymphoproliferation; 5 Immune dysregulation with colitis; 6 ALPS; 7 Susceptibility to EBV and lymphoproliferative conditions
- Table 5: 1 Congenital neutropenias; 2 Defects of motility; 3 Defects of respiratory burst; 4 Other nonlymphoid defects
- Table 6: 1 MSMD; 2 Epidermodysplasia verruciformis (HPV); 3 Predisposition to severe viral infection; 4 Herpes simplex encephalitis; 5 Predisposition to invasive fungal diseases; 6 Predisposition to mucocutaneous candidiasis; 7 TLR signaling pathway deficiency; 8 Other IEIs related to nonhematopoietic tissues; 9 Other IEIs related to leukocytes
- Table 7: 1 Type 1 interferonopathies; 2 Defects affecting the inflammasome; 3 Non-inflammasome-related conditions
- Table 10: Associated with somatic mutations; Associated with autoantibodies

## 2. The homepage number

| Claim                                           | Supported value                                    | Basis                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| IEI genes (IUIS-stated)                         | 508                                                | Poli et al. 2025 abstract. IUIS counts three somatic-only Table 10 genes inside this figure                         |
| IEI genes (Helix parse, Tables 1 to 9)      | 508 distinct HGNC-approved symbols                 | Section 5 script. 500 protein-coding, 5 non-coding RNA, 3 immunoglobulin or T-cell receptor loci (IGHM, IGKC, TRAC) |
| IEI genes including Table 10 somatic-only genes | 511                                                | Adds KRAS, NRAS, UBA1                                                                                               |
| Proteins available for structure work           | 503                                                | All 503 are reviewed Swiss-Prot entries. No protein: RMRP, RNU4ATAC, RNU7-1, SNORA31, TERC                          |
| IEI conditions                                  | 559 (plus 17 phenocopies)                          | IUIS-stated                                                                                                         |
| Clinical-panel superset                         | 612 genes in PanelApp panel 398 v9.107 (374 green) | Different scope: includes monogenic IBD and red or amber genes. Do not use for the claim                            |

The two 508 figures coincide numerically and are counted differently (IUIS includes three somatic-only genes and publishes no gene list, so its counting rule cannot be reproduced exactly; the parse counts every HGNC symbol in Tables 1 to 9). Show the manifest value and link the citation.

Of the 503 proteins: 495 have an AlphaFold DB cross-reference in UniProt, 426 have at least one PDB cross-reference, median length 535 aa, 95 exceed 1,000 aa, 21 exceed 2,000 aa (longest: KMT2D 5,537, FAT4 4,981, PRKDC 4,128).

## 3. Source inventory and licenses

| Source                              | URL (verified)                                                                                                                                                          | Format                                | Version seen                                                                                        | License                                                                                                     | Role                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| IUIS 2024 genotypic article         | `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12829761/fullTextXML`                                                                                              | JATS XML, 10 `table-wrap`             | 2025-04-15                                                                                          | CC BY-ND 4.0                                                                                                | Primary classification                                    |
| Same, NCBI mirror                   | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=PMC12829761&rettype=xml`                                                                           | JATS XML                              | same                                                                                                | CC BY-ND 4.0                                                                                                | Fallback 1                                                |
| IUIS Excel                          | `https://wp-iuis.s3.eu-west-1.amazonaws.com/app/uploads/2024/10/30094653/IUIS-IEI-list-for-web-site-July-2024V2.xlsx`                                                   | XLSX, 1 sheet, 19 columns, 582 rows   | Last-Modified 2024-10-30, sha256 `6e56ea25ef7601d72951289cda77293230f8f9add05d6a502ba126ffe35ad82b` | None stated. IUIS page: "can be used to design sequencing panels, ICD code lists and diagnostic algorithms" | Secondary, fallback 2                                     |
| IUIS pre-publication PDF            | `https://wp-iuis.s3.eu-west-1.amazonaws.com/app/uploads/2025/01/08170257/IEI-Final-Update-of-2024-Report-Jan-2025.pdf`                                                  | PDF                                   | January 2025                                                                                        | None stated                                                                                                 | Reference only                                            |
| IUIS 2022 Excel (Tangye et al.)     | `https://static-content.springer.com/esm/art%3A10.1007%2Fs10875-022-01289-3/MediaObjects/10875_2022_1289_MOESM2_ESM.xlsx`                                               | XLSX, 16 columns, 505 rows, 447 genes | 2022                                                                                                | CC BY 4.0                                                                                                   | Open-license fallback 3                                   |
| HGNC complete set                   | `https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt`                                                                               | TSV, 53 columns                       | 2026-10-02                                                                                          | CC0                                                                                                         | Symbol normalisation, UniProt, Ensembl, Entrez, OMIM gene |
| GenCC submissions                   | `https://search.thegencc.org/download/action/submissions-export-tsv` (also `-csv`, `-xlsx`)                                                                             | TSV, 30 columns, 30,328 records       | run date 2026-09-27                                                                                 | CC0 1.0                                                                                                     | MONDO disease IDs, validity, inheritance                  |
| ClinGen gene-disease validity       | `https://search.clinicalgenome.org/kb/gene-validity/download`                                                                                                           | CSV, 10 columns, 3,695 curations      | 2026-10-03                                                                                          | CC0 1.0                                                                                                     | Validity, MONDO, inheritance                              |
| Orphadata genes                     | `https://www.orphadata.com/data/xml/en_product6.xml`                                                                                                                    | XML                                   | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | ORPHAcode to gene                                         |
| Orphadata cross-references          | `https://www.orphadata.com/data/xml/en_product1.xml`                                                                                                                    | XML                                   | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | ORPHA to MONDO, OMIM, ICD-10, ICD-11, definitions         |
| Orphadata phenotypes                | `https://www.orphadata.com/data/xml/en_product4.xml`                                                                                                                    | XML                                   | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | HPO with frequency                                        |
| Orphadata natural history           | `https://www.orphadata.com/data/xml/en_product9_ages.xml`                                                                                                               | XML                                   | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | Inheritance, age of onset                                 |
| Orphadata immunology classification | `https://www.orphadata.com/data/xml/en_product3_195.xml`                                                                                                                | XML, 427 ORPHAcodes                   | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | Orphanet hierarchy                                        |
| Orphadata REST API                  | `https://api.orphadata.com` (`/openapi.json`)                                                                                                                           | JSON                                  | 2026-06-23                                                                                          | CC BY 4.0                                                                                                   | Per-code lookups                                          |
| HPO annotations                     | `https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download/{phenotype.hpoa,genes_to_phenotype.txt,phenotype_to_genes.txt,genes_to_disease.txt}` | TSV                                   | 2026-09-02                                                                                          | HPO license: cite, show version, do not alter content                                                       | Phenotypes                                                |
| Mondo                               | `http://purl.obolibrary.org/obo/mondo.obo`                                                                                                                              | OBO, 53 MB                            | v2026-09-01                                                                                         | CC BY 4.0                                                                                                   | Disease IDs                                               |
| Mondo mappings                      | `https://raw.githubusercontent.com/monarch-initiative/mondo/master/src/ontology/mappings/mondo_exactmatch_omim.sssom.tsv` (also `_orphanet`)                            | SSSOM TSV, 10,045 OMIM rows           | master                                                                                              | CC0 (file header)                                                                                           | OMIM and ORPHA to MONDO                                   |
| UniProtKB REST                      | `https://rest.uniprot.org/uniprotkb/{accession}.json`                                                                                                                   | JSON                                  | 2026_03 (2026-09-02)                                                                                | CC BY 4.0                                                                                                   | Protein, length, natural variants                         |
| ClinVar                             | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/` and `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz` (450 MB, 43 columns)               | JSON, TSV                             | 2026-09-29                                                                                          | Public domain                                                                                               | Variants                                                  |
| Open Targets GraphQL                | `https://api.platform.opentargets.org/api/v4/graphql`                                                                                                                   | GraphQL                               | API 26.9.0, data 26.09                                                                              | CC0 1.0                                                                                                     | Drug and clinical candidates                              |
| Genomics England PanelApp           | `https://panelapp.genomicsengland.co.uk/api/v1/panels/398/`                                                                                                             | JSON                                  | v9.107 (2026-09-25)                                                                                 | Terms of Use December 2019: no commercial use, all rights reserved                                          | Cross-check only                                          |
| PanelApp Australia                  | `https://panelapp-aus.org/api/v1/panels/`                                                                                                                               | JSON, 261 panels                      | 2026-10                                                                                             | Not verified                                                                                                | Cross-check only                                          |
| OMIM                                | `https://omim.org/static/omim/data/mim2gene.txt` (open); `genemap2.txt` returns 403 without a key                                                                       | TSV                                   | 2026-10-03                                                                                          | OMIM Use Agreement (restrictive)                                                                            | Link-out only                                             |

### License consequences

- **CC BY-ND 4.0 (IUIS 2024 article)**: verbatim redistribution with attribution is allowed, sharing adapted material is prohibited. Individual facts (gene X, table Y, inheritance Z) are not protected by copyright; the selection and arrangement of the tables and the EU database right are the risk. The JATS `license-p` text reads "Attribution 4.0 International" while its link, the `ali:license_ref`, Crossref and Europe PMC all say `by-nd/4.0`. Treat it as BY-ND.
- **Operating rule**: cache the XML unmodified, derive an index of identifiers and codes, show the IUIS short disease label with a link to the article, never reproduce the clinical free-text columns (T cells, B cells, Ig, Associated features). This needs a maintainer or legal decision and ideally written confirmation from IUIS or the publisher.
- **Fully open fallback**: IUIS 2022 Excel (CC BY 4.0, adaptation allowed) plus GenCC, ClinGen and Orphanet. It lacks 61 of the 508 current genes.
- **PanelApp (Genomics England)**: clause 1.1 "You agree not to use PanelApp for any commercial purposes (including any commercial research), or for diagnostic use"; clause 4.1 "All such rights are reserved". Do not seed from it. PanelApp submissions inside GenCC are distributed under GenCC's CC0 terms (1,250 Genomics England rows, 5,478 PanelApp Australia rows).
- **OMIM**: `mim2gene.txt` header: "Use of this file adheres to the terms specified at https://omim.org/help/agreement". Store MIM numbers as identifiers and link out. Do not import OMIM text, `genemap2` or `morbidmap`. Phenotype MIM numbers arrive legitimately through IUIS, Mondo, Orphanet, HPO, GenCC and UniProt cross-references.
- **HPO**: content may not be altered; display the HPO version and citation.
- **Orphadata**: cite "Orphadata Science: Free access data from Orphanet. © INSERM 1999. Available on http://sciences.orphadata.com/. Data version [date]".

## 4. Primary and secondary source details

### 4.1 Published tables (JATS XML)

Column headers per table:

| Tables | Columns                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2   | Disease, Genetic defect, Inheritance, OMIM, T cells, B cells, Ig, Associated features                                                                             |
| 3      | Disease, Genetic defect, Inheritance, OMIM, Ig, Associated features                                                                                               |
| 4      | Disease, Genetic defect, Inheritance, OMIM, Circulating T cells, Circulating B cells, Functional defect, Associated features                                      |
| 5, 6   | Disease, Genetic defect, Inheritance, OMIM, Affected cells, Affected function, Associated features                                                                |
| 7      | Two `<table>` elements: subtable 1 uses the Table 4 layout with T cells and B cells; subtables 2 and 3 use Affected cells, Functional defect, Associated features |
| 8      | Disease, Genetic defect, Inheritance, Gene OMIM, Laboratory features, Associated features                                                                         |
| 9      | Disease, Genetic defect, Inheritance, Gene OMIM, T cells, B cells, Other affected cells, Associated features, Major category, Subcategory                         |
| 10     | Disease, Genetic defect/presumed pathogenesis, Circulating T cells, Circulating B cells, Serum Ig, Associated features/similar IEI                                |

Parsing rules that the tested script implements:

- A body row with one cell spanning the full width is a subtable heading.
- Cells use `rowspan`; expand them or genes and diseases shift columns.
- The OMIM column mixes phenotype MIM and gene MIM numbers: 276 rows carry a phenotype MIM, 260 a gene MIM, 50 are "NA" or empty.
- 33 distinct inheritance strings, for example `AR`, `AD`, `XL`, `XLR`, `AD GOF`, `AR LOF`, `AD DN`, `AD (haploinsufficiency)`, `AD-neomorph`, `AR or digenic`, `XL/somatic mutations`, `ND`, `Variable`, `Sporadic`, and the concatenation artefact `ADAR`.
- Legacy or alias symbols resolved through HGNC: POLE1 to POLE, TTC37 to SKIC3, SKIV2L to SKIC2, TNFRSF6 to FAS, TNFSF6 to FASLG, G6PT1 to SLC37A4, TAZ to TAFAZZIN, MKL1 to MRTFA, TMEM173 to STING1, ADAR1 to ADAR, XRCC9 to FANCG, NOLA3 to NOP10, NOLA2 to NHP2.
- Cells needing manual overrides (each checked against the OMIM number in the same row): `ATG4` to ATG4A, `HMOX` to HMOX1 (141250), `PSEN` to PSEN1 (613737), `IL-1R1` to IL1R1, `MAP3K9/MKL1` to MRTFA (606078), `Missense variantsPLCG2Small intragenic deletions` to PLCG2, `PSMB10 p.Asp56His/p.Gly201Arg` to PSMB10, `Large deletion (3 Mb) typically in chromosome 22 (TBX1)` to TBX1.
- 12 rows in Tables 1 to 9 have no gene (deletion syndromes, "Unknown").

### 4.2 IUIS Excel (July 2024 V2)

Sheet name `Tables 1-8 amalgamated` (it also contains Table 9; Table 10 is absent). 582 data rows.

| Column                                                                                                         | Filled     | Notes                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Disease                                                                                                        | 582        | 550 distinct                                                                                                        |
| Genetic defect                                                                                                 | 582        | 507 distinct raw strings, 505 HGNC genes after normalisation                                                        |
| Inheritance                                                                                                    | 581        | 12 distinct: AR 392, AD 145, XL 30, `?` 6, others single                                                            |
| GOF/DN                                                                                                         | 53         | GOF 40, DN 8, plus `haplosufficiency`, `LOF, DN`, `LOF GOF`, `NA`                                                   |
| OMIM                                                                                                           | 464        | 457 clean six-digit; 7 malformed (`605257*`, `6011924`, `· 612411`, comma lists, `Not yet attributed`)              |
| T cell count, B cell count, Immunoglobulin levels, Neutrophil count, Other affected cells, Associated features | 182 to 567 | Free text. Do not redistribute                                                                                      |
| Major category                                                                                                 | 582        | 9 values, `Table N <title>`                                                                                         |
| Subcategory                                                                                                    | 504        | 44 strings, `Subtable N <title>`; duplicates with different wording for the same subtable; blank for Tables 8 and 9 |
| ICD9                                                                                                           | 578        | 23 distinct                                                                                                         |
| ICD10                                                                                                          | 578        | 41 distinct                                                                                                         |
| HPO (table)                                                                                                    | 579        | 2 distinct (HP:0002715, HP:0002721)                                                                                 |
| HPO (subtable)                                                                                                 | 579        | 61 distinct                                                                                                         |
| HPO, HPO                                                                                                       | 65, 6      | Extra terms                                                                                                         |

Rows per table: 74, 86, 56, 73, 48, 90, 75, 36, 44. Differences from the published tables: missing ARF1, PI4KA, PTPN2, SMAD3; contains GIMAP5, which the published tables do not list; typos `NCKAPIL` (NCKAP1L) and `PSEN`.

### 4.3 IUIS 2022 Excel (open-license fallback)

Same layout minus `GOF/DN` and the two trailing HPO columns (16 columns). 505 rows, 447 HGNC genes with the same normaliser (2 cells unresolved), 61 current genes absent.

## 5. Tested import recipe

Run: `python3 iei_import.py .cache/iei data/seed/iei` (Python 3.11 or newer, standard library only; tested on 3.14).

Output of the test run on 2026-10-03:

```json
{
  "rows_tables_1_to_9": 586,
  "rows_table_10": 17,
  "rows_per_table": {
    "1": 73,
    "2": 87,
    "3": 57,
    "4": 73,
    "5": 45,
    "6": 90,
    "7": 78,
    "8": 36,
    "9": 47,
    "10": 17
  },
  "distinct_genes": 508,
  "protein_coding_genes": 500,
  "genes_with_uniprot": 503,
  "genes_with_mondo": 475,
  "genes_with_orphacode": 419,
  "genes_with_hpo": 472,
  "rows_without_inheritance_hpo": 8
}
```

Add these as import assertions: 603 rows, 508 genes, 503 UniProt accessions. A change means the upstream source changed and needs review.

Outputs:

| File                | Columns                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iei_entries.tsv`   | iuis_table, iuis_table_title, iuis_subtable, disease_name, genetic_defect_raw, hgnc_ids, gene_symbols, inheritance_raw, inheritance_hpo, mechanism, omim_raw, source |
| `iei_genes.tsv`     | hgnc_id, symbol, locus_group, uniprot_accession, ensembl_gene_id, entrez_id, omim_gene_id, iuis_tables, mondo_ids_gencc, orphacodes, hpo_term_count                  |
| `iei_manifest.json` | counts plus URL and sha256 per cached source                                                                                                                         |

```python
"""Build the Helix IEI seed from the IUIS 2024 classification plus open cross-reference layers.

Standard library only. Usage: python iei_import.py <cache_directory> <output_directory>
"""
import csv
import hashlib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ElementTree
from collections import Counter, defaultdict
from pathlib import Path

SOURCES = {
    "iuis_2024_jats.xml": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12829761/fullTextXML",
    "hgnc_complete_set.txt": "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
    "gencc_submissions.tsv": "https://search.thegencc.org/download/action/submissions-export-tsv",
    "orphadata_product6.xml": "https://www.orphadata.com/data/xml/en_product6.xml",
    "hpo_genes_to_phenotype.txt": "https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download/genes_to_phenotype.txt",
}

# Symbols HGNC cannot resolve; each verified against the OMIM number printed in the same IUIS row.
SYMBOL_OVERRIDES = {
    "ATG4": ["ATG4A"],
    "HMOX": ["HMOX1"],
    "PSEN": ["PSEN1"],
    "IL-1R1": ["IL1R1"],
    "PI4K4": ["PI4KA"],
    "NCKAPIL": ["NCKAP1L"],
    "MAP3K9/MKL1": ["MRTFA"],
}
EMBEDDED_SYMBOL = re.compile(r"(PLCG2|PSMB10)")
STRUCTURAL = re.compile(r"^(unknown|unknown / environment|del10p13-p14|11q23del)$|deletion", re.IGNORECASE)
MODE_OF_INHERITANCE = [
    (re.compile(r"XLR"), "HP:0001419"),
    (re.compile(r"XL"), "HP:0001417"),
    (re.compile(r"AR"), "HP:0000007"),
    (re.compile(r"AD"), "HP:0000006"),
    (re.compile(r"digenic", re.IGNORECASE), "HP:0010984"),
    (re.compile(r"sporadic", re.IGNORECASE), "HP:0003745"),
    (re.compile(r"somatic", re.IGNORECASE), "HP:0001442"),
]
MECHANISM = [
    (re.compile(r"GOF"), "gain_of_function"),
    (re.compile(r"\bDN\b|dominant negative", re.IGNORECASE), "dominant_negative"),
    (re.compile(r"haploinsufficiency", re.IGNORECASE), "haploinsufficiency"),
    (re.compile(r"neomorph", re.IGNORECASE), "neomorph"),
    (re.compile(r"LOF"), "loss_of_function"),
]


def fetch(cache_directory):
    manifest = {}
    for file_name, url in SOURCES.items():
        path = cache_directory / file_name
        if not path.exists():
            request = urllib.request.Request(url, headers={"User-Agent": "helix-iei-import/0.1"})
            with urllib.request.urlopen(request, timeout=300) as response:
                path.write_bytes(response.read())
        manifest[file_name] = {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    return manifest


def load_hgnc(path):
    approved, previous, aliases = {}, defaultdict(list), defaultdict(list)
    with open(path, encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["status"] != "Approved":
                continue
            approved[row["symbol"]] = row
            for symbol in filter(None, row["prev_symbol"].strip('"').split("|")):
                previous[symbol].append(row["symbol"])
            for symbol in filter(None, row["alias_symbol"].strip('"').split("|")):
                aliases[symbol].append(row["symbol"])
    return approved, previous, aliases


def resolve_symbol(symbol, approved, previous, aliases):
    if symbol in approved:
        return symbol
    if len(previous.get(symbol, [])) == 1:
        return previous[symbol][0]
    if len(aliases.get(symbol, [])) == 1:
        return aliases[symbol][0]
    return None


def genes_from_cell(cell, hgnc):
    approved = hgnc[0]
    cell = re.sub(r"\s+", " ", cell or "").strip()
    if cell in SYMBOL_OVERRIDES:
        return SYMBOL_OVERRIDES[cell]
    embedded = EMBEDDED_SYMBOL.search(cell)
    if embedded and (" " in cell or "variants" in cell):
        return [embedded.group(1)]
    if STRUCTURAL.search(cell):
        bracketed = re.search(r"\(([A-Z0-9]+)\)", cell)
        return [bracketed.group(1)] if bracketed and bracketed.group(1) in approved else []
    stripped = re.sub(r"\(.*?\)", "", cell)
    stripped = re.sub(r"\b(GOF|LOF|DN|AR|AD|XL)\b", "", stripped).replace("*", "")
    symbols = []
    for token in filter(None, re.split(r"[\s,+./;]+", stripped)):
        token = SYMBOL_OVERRIDES.get(token, [token])[0]
        symbol = resolve_symbol(token, *hgnc) or resolve_symbol(re.sub(r"[a-c]$", "", token), *hgnc)
        if symbol is None:
            raise ValueError(f"unresolved IUIS gene cell: {cell!r}")
        symbols.append(symbol)
    return symbols


def cell_text(element):
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()


def expand_table(table):
    """Yield (cells_by_column, column_spans) per body row, honouring rowspan and colspan."""
    carried = {}
    for table_row in table.find("tbody").findall("tr"):
        cells, column = {}, 0
        spans = []
        for cell in table_row:
            while column in carried:
                cells[column] = carried[column][0]
                carried[column][1] -= 1
                if carried[column][1] == 0:
                    del carried[column]
                column += 1
            row_span, column_span = int(cell.get("rowspan", "1")), int(cell.get("colspan", "1"))
            spans.append(column_span)
            for _ in range(column_span):
                cells[column] = cell_text(cell)
                if row_span > 1:
                    carried[column] = [cell_text(cell), row_span - 1]
                column += 1
        for column in [key for key in carried if key not in cells]:
            cells[column] = carried[column][0]
            carried[column][1] -= 1
            if carried[column][1] == 0:
                del carried[column]
        yield cells, spans


def parse_iuis_jats(path, hgnc):
    root = ElementTree.fromstring(Path(path).read_text(encoding="utf-8"))
    entries = []
    for table_wrap in root.findall(".//table-wrap"):
        table_number = int(re.search(r"\d+", cell_text(table_wrap.find("label"))).group())
        table_title = cell_text(table_wrap.find("caption"))
        for table in table_wrap.findall(".//table"):
            header = [cell_text(cell) for cell in table.find("thead").findall("tr")[-1]]
            subtable = None
            for cells, spans in expand_table(table):
                if len(spans) == 1 and spans[0] >= len(header) - 1:
                    subtable = cells[0]
                    continue
                record = dict(zip(header, (cells.get(index, "") for index in range(len(header)))))
                gene_cell = record.get("Genetic defect") or record.get("Genetic defect/presumed pathogenesis", "")
                inheritance = record.get("Inheritance", "")
                symbols = genes_from_cell(gene_cell, hgnc) if table_number != 10 else []
                context = f"{inheritance} {gene_cell} {record['Disease']}"
                entries.append({
                    "iuis_table": table_number,
                    "iuis_table_title": table_title,
                    "iuis_subtable": subtable or "",
                    "disease_name": record["Disease"],
                    "genetic_defect_raw": gene_cell,
                    "hgnc_ids": "|".join(hgnc[0][symbol]["hgnc_id"] for symbol in symbols),
                    "gene_symbols": "|".join(symbols),
                    "inheritance_raw": inheritance,
                    "inheritance_hpo": "|".join(dict.fromkeys(code for pattern, code in MODE_OF_INHERITANCE if pattern.search(inheritance))),
                    "mechanism": "|".join(label for pattern, label in MECHANISM if pattern.search(context)),
                    "omim_raw": record.get("OMIM") or record.get("Gene OMIM", ""),
                    "source": "IUIS 2024 update, Poli et al. J Hum Immun 2025, doi:10.70962/jhi.20250003",
                })
    return entries


def gencc_by_gene(path):
    diseases = defaultdict(set)
    with open(path, encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["classification_title"] in {"Definitive", "Strong", "Moderate", "Supportive"}:
                diseases[row["gene_curie"]].add(row["disease_curie"])
    return diseases


def orphacodes_by_gene(path):
    orphacodes = defaultdict(set)
    for disorder in ElementTree.parse(path).getroot().find("DisorderList"):
        for association in disorder.find("DisorderGeneAssociationList"):
            if not association.find("DisorderGeneAssociationType").findtext("Name").startswith("Disease-causing"):
                continue
            for reference in association.find("Gene").find("ExternalReferenceList"):
                if reference.findtext("Source") == "HGNC":
                    orphacodes["HGNC:" + reference.findtext("Reference")].add("ORPHA:" + disorder.findtext("OrphaCode"))
    return orphacodes


def phenotype_counts_by_entrez(path):
    terms = defaultdict(set)
    with open(path, encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            terms[row["ncbi_gene_id"]].add(row["hpo_id"])
    return terms


def write_tsv(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def main(cache_directory, output_directory):
    cache_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)
    manifest = fetch(cache_directory)
    hgnc = load_hgnc(cache_directory / "hgnc_complete_set.txt")
    entries = parse_iuis_jats(cache_directory / "iuis_2024_jats.xml", hgnc)
    gencc = gencc_by_gene(cache_directory / "gencc_submissions.tsv")
    orphanet = orphacodes_by_gene(cache_directory / "orphadata_product6.xml")
    phenotypes = phenotype_counts_by_entrez(cache_directory / "hpo_genes_to_phenotype.txt")

    tables_by_symbol = defaultdict(set)
    for entry in entries:
        for symbol in filter(None, entry["gene_symbols"].split("|")):
            tables_by_symbol[symbol].add(entry["iuis_table"])
    genes = []
    for symbol in sorted(tables_by_symbol):
        record = hgnc[0][symbol]
        genes.append({
            "hgnc_id": record["hgnc_id"],
            "symbol": symbol,
            "locus_group": record["locus_group"],
            "uniprot_accession": record["uniprot_ids"],
            "ensembl_gene_id": record["ensembl_gene_id"],
            "entrez_id": record["entrez_id"],
            "omim_gene_id": record["omim_id"],
            "iuis_tables": "|".join(str(number) for number in sorted(tables_by_symbol[symbol])),
            "mondo_ids_gencc": "|".join(sorted(gencc.get(record["hgnc_id"], []))),
            "orphacodes": "|".join(sorted(orphanet.get(record["hgnc_id"], []))),
            "hpo_term_count": len(phenotypes.get(record["entrez_id"], [])),
        })
    write_tsv(output_directory / "iei_entries.tsv", entries)
    write_tsv(output_directory / "iei_genes.tsv", genes)

    germline = [entry for entry in entries if entry["iuis_table"] != 10]
    summary = {
        "rows_tables_1_to_9": len(germline),
        "rows_table_10": len(entries) - len(germline),
        "rows_per_table": dict(sorted(Counter(entry["iuis_table"] for entry in entries).items())),
        "distinct_genes": len(genes),
        "protein_coding_genes": sum(gene["locus_group"] == "protein-coding gene" for gene in genes),
        "genes_with_uniprot": sum(bool(gene["uniprot_accession"]) for gene in genes),
        "genes_with_mondo": sum(bool(gene["mondo_ids_gencc"]) for gene in genes),
        "genes_with_orphacode": sum(bool(gene["orphacodes"]) for gene in genes),
        "genes_with_hpo": sum(gene["hpo_term_count"] > 0 for gene in genes),
        "rows_without_inheritance_hpo": sum(not entry["inheritance_hpo"] for entry in germline),
        "sources": manifest,
    }
    (output_directory / "iei_manifest.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({key: value for key, value in summary.items() if key != "sources"}, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
```

### Fallback order when a source is unavailable

| Failure                         | Fallback                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Europe PMC XML                  | NCBI `efetch.fcgi?db=pmc&id=PMC12829761&rettype=xml` (same JATS, verified identical table count)                                                                                                                              |
| Both XML mirrors                | IUIS Excel on S3. Read `Major category` and `Subcategory` for table and subtable, `GOF/DN` for mechanism, reuse `genes_from_cell`. Expect 582 rows, 505 genes; add ARF1, PI4KA, PTPN2, SMAD3 from the committed override file |
| IUIS sources or license refusal | 2022 Excel (CC BY 4.0), 447 genes, flag the dataset as `iuis_2022` in the UI                                                                                                                                                  |
| HGNC bucket                     | `https://rest.genenames.org/fetch/symbol/{symbol}` with `Accept: application/json` (the old `ftp.ebi.ac.uk/pub/databases/genenames/hgnc/tsv/` path returns 404)                                                               |
| GenCC                           | ClinGen CSV (343 of 508 genes)                                                                                                                                                                                                |
| Orphadata XML                   | `https://api.orphadata.com/rd-associated-genes/orphacodes/{code}`                                                                                                                                                             |
| GitHub release asset for HPO    | No independent mirror: `http://purl.obolibrary.org/obo/hp/hpoa/genes_to_phenotype.txt` redirects (302) to the same GitHub asset. Reuse the last cached copy                                                                   |

Commit the cached source checksums and the override table. Refuse to import when a checksum changes without a version bump.

## 6. Identifier mapping

| From        | To                        | Method                                                                          | Coverage of the 508 genes                                                                                      |
| ----------- | ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| IUIS symbol | HGNC ID                   | `symbol`, then unique `prev_symbol`, then unique `alias_symbol`, then overrides | 508                                                                                                            |
| HGNC ID     | UniProt accession         | HGNC `uniprot_ids`                                                              | 503 (all reviewed, one accession each)                                                                         |
| HGNC ID     | Ensembl gene, Entrez gene | HGNC `ensembl_gene_id`, `entrez_id`                                             | 508                                                                                                            |
| HGNC ID     | OMIM gene MIM             | HGNC `omim_id`                                                                  | 508                                                                                                            |
| HGNC ID     | MONDO disease             | GenCC `gene_curie` to `disease_curie`                                           | 500 any classification, 475 at Supportive or better. Absent: C8G, CCR2, CFHR2, CFHR4, DBF4, ERN1, GINS4, TIRAP |
| HGNC ID     | ORPHAcode                 | Orphadata product6 `ExternalReference[Source=HGNC]`                             | 443 any association type, 419 disease-causing                                                                  |
| Entrez ID   | HPO terms                 | `genes_to_phenotype.txt`                                                        | 472                                                                                                            |
| HGNC ID     | ClinGen curation          | ClinGen CSV `GENE ID (HGNC)`                                                    | 343 genes, 408 curations (270 Definitive, 56 Moderate, 57 Limited, 6 Strong, 9 Disputed, 7 Refuted)            |

Entry-level (row to disease) mapping, tested on the 586 germline rows:

| Route                                                                      | Rows |
| -------------------------------------------------------------------------- | ---- |
| Row carries a phenotype MIM and Mondo SSSOM has an exact match             | 276  |
| Gene has exactly one GenCC disease at Supportive or better                 | 125  |
| Gene has several GenCC diseases: pick by matching inheritance, else curate | 150  |
| Unmapped (no gene, or gene absent from GenCC)                              | 35   |

Rules:

- Decide gene MIM versus phenotype MIM by comparing the row's number with HGNC `omim_id`.
- ORPHA to MONDO and OMIM: Orphadata product1 `ExternalReference` with `DisorderMappingRelation` starting `E` (exact). Relations `NTBT` and `BTNT` are not equivalences.
- Filter Orphanet associations on `DisorderGeneAssociationType`. STAT3 and CTLA4 also carry fusion, somatic and susceptibility associations.
- Mondo's own IEI branch (MONDO:0003778 "inborn error of immunity") has 235 descendants in OLS. It does not reproduce the IUIS list; use it for grouping only.
- Fetch UniProt by accession. A UniProt search with `gene_exact:WAS` returned unrelated entries on 2026-10-03.

Request examples:

```bash
curl -s "https://rest.uniprot.org/uniprotkb/Q06187.json" | jq '{id: .uniProtkbId, length: .sequence.length}'
curl -s "https://api.orphadata.com/rd-cross-referencing/orphacodes/47?lang=en" | jq '.data.results.ExternalReference[] | {Source, Reference, DisorderMappingRelation}'
curl -s "https://api.orphadata.com/rd-natural_history/orphacodes/47" | jq '.data.results | {TypeOfInheritance, AverageAgeOfOnset}'
curl -s "https://www.ebi.ac.uk/ols4/api/search?q=inborn%20error%20of%20immunity&ontology=mondo&exact=true" | jq '.response.docs[0].obo_id'
```

Orphadata response fields: `data.__licence`, `data.results.{ORPHAcode, "Preferred term", DisorderGroup, Typology, ExternalReference[], DisorderGeneAssociation[], TypeOfInheritance[], AverageAgeOfOnset[]}`. GenCC columns used: `gene_curie`, `gene_symbol`, `disease_curie`, `disease_title`, `classification_title`, `moi_curie`, `moi_title`, `submitter_title`, `submitted_as_pmids`. ClinGen header (line 5 of the file, data from line 7): `GENE SYMBOL, GENE ID (HGNC), DISEASE LABEL, DISEASE ID (MONDO), MOI, SOP, CLASSIFICATION, ONLINE REPORT, CLASSIFICATION DATE, GCEP`.

## 7. Phenotype sources

| File                                                     | Columns                                                                                                                 | Use                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `genes_to_phenotype.txt`                                 | ncbi_gene_id, gene_symbol, hpo_id, hpo_name, frequency, disease_id                                                      | Gene-level phenotype list; 33,715 rows for IUIS genes; disease IDs are OMIM (727 distinct) and ORPHA (449)                                         |
| `phenotype.hpoa`                                         | database_id, disease_name, qualifier, hpo_id, reference, evidence, onset, frequency, sex, modifier, aspect, biocuration | Disease-level annotations with evidence and frequency. `aspect`: P phenotype, I inheritance, C clinical course, M modifier, H past medical history |
| `genes_to_disease.txt`                                   | ncbi_gene_id, gene_symbol, association_type, disease_id, source                                                         | Gene to OMIM or ORPHA disease                                                                                                                      |
| Orphadata product4 or `/rd-phenotypes/orphacodes/{code}` | `HPODisorderAssociation[].{HPO.HPOId, HPO.HPOTerm, HPOFrequency, DiagnosticCriteria}`                                   | HPO terms with frequency bands ("Very frequent (99-80%)")                                                                                          |
| IUIS Excel `HPO (table)`, `HPO (subtable)`               | HP IDs                                                                                                                  | Category-level terms only                                                                                                                          |

Show phenotypes from HPO and Orphanet with their source IDs. The IUIS clinical columns stay out of the product (section 3).

## 8. Inheritance vocabulary

Store `inheritance_raw` (source string), `inheritance_hpo` (list) and `mechanism` (list) separately.

| Canonical (HPO)                            | IUIS strings                                                    | GenCC `moi_title`    | ClinGen `MOI` | Orphanet `TypeOfInheritance` | PanelApp `mode_of_inheritance`                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------- | -------------------- | ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| HP:0000007 Autosomal recessive inheritance | AR, AR LOF, AR GOF                                              | Autosomal recessive  | AR            | Autosomal recessive          | BIALLELIC, autosomal or pseudoautosomal                                                                                                |
| HP:0000006 Autosomal dominant inheritance  | AD, AD GOF, AD LOF, AD DN, AD (haploinsufficiency), AD-neomorph | Autosomal dominant   | AD            | Autosomal dominant           | MONOALLELIC, autosomal or pseudoautosomal (suffix: NOT imprinted, or imprinted status unknown)                                         |
| HP:0000006 and HP:0000007                  | AR or AD, AD/AR, AR/AD, AR and AD, ADAR                         | two rows             | two rows      | both values                  | BOTH monoallelic and biallelic, autosomal or pseudoautosomal                                                                           |
| HP:0001417 X-linked inheritance            | XL, XL GOF, XL (females may be affected)                        | X-linked             | XL            | n/a                          | X-LINKED: hemizygous mutation in males (suffix: biallelic mutations in females, or monoallelic mutations in females may cause disease) |
| HP:0001419 X-linked recessive inheritance  | XLR                                                             | X-linked recessive   | n/a           | X-linked recessive           | n/a                                                                                                                                    |
| HP:0001423 X-linked dominant inheritance   | n/a                                                             | n/a                  | n/a           | X-linked dominant            | n/a                                                                                                                                    |
| HP:0032113 Semidominant inheritance        | n/a                                                             | Semidominant         | SD            | Semi-dominant                | BOTH monoallelic and biallelic (but BIALLELIC mutations cause a more SEVERE disease form)                                              |
| HP:0010984 Digenic inheritance             | AR or digenic, AR or digenic or DN                              | n/a                  | n/a           | Oligogenic                   | n/a                                                                                                                                    |
| HP:0003745 Sporadic                        | Sporadic                                                        | n/a                  | n/a           | Not applicable               | n/a                                                                                                                                    |
| HP:0001442 Typified by somatic mosaicism   | XL/somatic mutations, Table 10 somatic entries                  | n/a                  | n/a           | n/a                          | n/a                                                                                                                                    |
| HP:0001427 Mitochondrial inheritance       | n/a                                                             | n/a                  | MT            | Mitochondrial inheritance    | MITOCHONDRIAL                                                                                                                          |
| Unknown                                    | ND, Variable, empty, `?`                                        | Unknown (HP:0000005) | UD            | Unknown, No data available   | Unknown, Other                                                                                                                         |

Mechanism labels taken from IUIS cells: `gain_of_function` (GOF), `loss_of_function` (LOF), `dominant_negative` (DN, "dominant negative"), `haploinsufficiency`, `neomorph`. Test-run counts across 603 rows: GOF 48, LOF 17, haploinsufficiency 12, DN 9, neomorph 2, unlabelled 522. An empty mechanism means IUIS did not state one. Orphanet adds a second signal through association types "Disease-causing germline mutation(s) (gain of function) in" and "(loss of function) in".

## 9. Gene-disease validity layers

| Layer              | Scope seen                                                                                                                                                                                                                                                  | Fields                                                                                                                                                                                         | Use                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ClinGen            | Expert panels: SCID-CID (108 curations), Antibody Deficiencies (64), Primary Immune Regulatory Disorders (53), Complement-Mediated Kidney Diseases (12), Monogenic Systemic and Incomplete Lupus Erythematosus (9), Monogenic Autoinflammatory Diseases (5) | classification, MOI, MONDO ID, report URL, date                                                                                                                                                | Evidence badge with link to the report                                                                                                     |
| GenCC              | 2,712 rows on IUIS genes from ClinGen, Orphanet, PanelApp Australia, Genomics England PanelApp, G2P, Ambry, Labcorp and others                                                                                                                              | classification (Definitive, Strong, Moderate, Supportive, Limited, Disputed Evidence, Refuted Evidence, No Known Disease Relationship), `moi_curie`                                            | Default validity layer, CC0                                                                                                                |
| PanelApp panel 398 | 612 genes: 374 green, 95 amber, 141 red, 2 level 0; 2 regions                                                                                                                                                                                               | `gene_data.{gene_symbol, hgnc_id, omim_gene, ensembl_genes}`, `confidence_level`, `mode_of_inheritance`, `mode_of_pathogenicity`, `phenotypes[]`, `evidence[]`, `publications[]`, `penetrance` | Internal cross-check only. By HGNC ID 477 IUIS genes are present (350 green, 57 amber, 70 red), 31 absent; 24 green genes are outside IUIS |

PanelApp endpoints: `/api/v1/panels/?page=N` (433 panels), `/api/v1/panels/398/`, `/api/v1/panels/398/genes/?page=N` (100 per page), TSV at `/panels/398/download/01234/` (36 columns starting `Entity Name, Entity type, Gene Symbol, Sources(; separated), Level4, Level3, Level2, Model_Of_Inheritance, Phenotypes, Omim, Orphanet, HPO, Publications`). Match on `hgnc_id`; panel symbols lag HGNC (SKIV2L, TAZ, TTC37, TMEM173). PanelApp Australia panels that mirror IUIS tables: 223 Combined Immunodeficiency, 235 Severe Combined Immunodeficiency, 222 Predominantly Antibody Deficiency, 229 Disorders of immune dysregulation, 233 Phagocyte Defects, 231 Defects of intrinsic and innate immunity, 238 Autoinflammatory Disorders, 224 Complement Deficiencies, 239 Immunological disorders_SuperPanel (1,011 genes).

## 10. Treatment and intervention sources

| Source                | Endpoint                                                                                                                                                                                                                                               | What it gives                                                                                                                                                                                                                                                                | License                                    | Notes                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Targets          | GraphQL `target(ensemblId){ drugAndClinicalCandidates{ count rows{ id maxClinicalStage drug{ id name drugType } diseases{ diseaseFromSource disease{ id name } } clinicalReports{ id source url clinicalStage } } } }`; same field on `disease(efoId)` | Drugs per target or disease. `maxClinicalStage` values seen: `APPROVAL`, `PREAPPROVAL`, `PHASE_4`, `PHASE_3`, `PHASE_2_3`, `PHASE_2`, `PHASE_1_2`, `PHASE_1`, `WITHDRAWAL`, `UNKNOWN`. `clinicalReports[].source` values seen: FDA, EMA Human Drugs, ClinicalTrials.gov, TTD | CC0                                        | `knownDrugs` no longer exists in API 26.9.0. Disease IDs use the `MONDO_0010421` form; `Orphanet_47` returns null. Tested: PIK3CD returns leniolisib (APPROVAL, "activated phosphoinositide 3-kinase delta syndrome", FDA label report); ADA returns an approved gene therapy for SCID (EMA EPAR report) |
| ChEMBL 37             | `https://www.ebi.ac.uk/chembl/api/data/drug_indication.json?molecule_chembl_id=CHEMBL3989909`                                                                                                                                                          | `efo_id`, `mesh_heading`, `max_phase_for_ind`                                                                                                                                                                                                                                | CC BY-SA 3.0                               | Share-alike applies to derived datasets                                                                                                                                                                                                                                                                  |
| openFDA labels        | `https://api.fda.gov/drug/label.json?search=openfda.generic_name:elapegademase&limit=1`                                                                                                                                                                | `indications_and_usage` text                                                                                                                                                                                                                                                 | Public domain                              | Revcovi found (ADA-SCID). `openfda.brand_name:joenja` returned no match, so coverage has gaps                                                                                                                                                                                                            |
| ClinicalTrials.gov v2 | `https://clinicaltrials.gov/api/v2/studies?query.cond=X-linked%20agammaglobulinemia&fields=NCTId,BriefTitle,OverallStatus,Phase,InterventionName`                                                                                                      | Trials per condition                                                                                                                                                                                                                                                         | Public                                     | API 2.0.5; 18 studies for X-linked agammaglobulinemia                                                                                                                                                                                                                                                    |
| MedlinePlus Genetics  | `https://medlineplus.gov/download/genetics/condition/{slug}.json`                                                                                                                                                                                      | Plain-language description, `inheritance-pattern-list`, `related-gene-list`, `db-key-list`                                                                                                                                                                                   | See `medlineplus.gov/about/data-files-api` | Description only; no treatment field in the JSON                                                                                                                                                                                                                                                         |
| Orphanet              | Orphadata free products                                                                                                                                                                                                                                | Definitions (product1)                                                                                                                                                                                                                                                       | CC BY 4.0                                  | Management text and orphan-drug datasets require a Data Transfer Agreement                                                                                                                                                                                                                               |
| IUIS tables           | n/a                                                                                                                                                                                                                                                    | No treatment column                                                                                                                                                                                                                                                          | n/a                                        | The phenotypic paper is diagnostic                                                                                                                                                                                                                                                                       |
| Guidelines            | 2025 IEI practice parameter (_Ann Allergy Asthma Immunol_); Chinen et al., _J Allergy Clin Immunol_ 2026 (PMID 42208906); Murray et al. scoping review of IEI management guidelines, _J Allergy Clin Immunol_ 2025 (PMID 40902944)                     | Standard of care (immunoglobulin replacement, HSCT, gene therapy, targeted drugs)                                                                                                                                                                                            | Publisher copyright                        | Cite and link; do not reproduce text                                                                                                                                                                                                                                                                     |
| GeneReviews           | NCBI Bookshelf                                                                                                                                                                                                                                         | Management sections                                                                                                                                                                                                                                                          | Copyright University of Washington         | Link out only                                                                                                                                                                                                                                                                                            |

Treatment summaries shown in Helix are assembled from structured records (drug ID, stage, indication ID, label or trial ID) with the source attached. No free-text summary without a source record.

## 11. Flagship examples

UniProt accession and length from UniProtKB 2026_03. Disease label, inheritance and table from the IUIS 2024 published tables. MONDO from GenCC (Definitive or Strong), ORPHA from Orphadata product6; the two IDs in a cell come from different sources and are not asserted to be exact equivalents. The mechanism class column is an editorial label for picking diverse examples and is not a database field.

| Gene   | UniProt | Length | IUIS disease label                                                                                     | IUIS inheritance            | IUIS table.subtable                             | Mechanism class                        | MONDO / ORPHA                                            |
| ------ | ------- | ------ | ------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| ADA    | P00813  | 363    | ADA deficiency                                                                                         | AR                          | 1.2 T-B- SCID                                   | Metabolic enzyme loss                  | MONDO:0007064 / ORPHA:277                                |
| IL2RG  | P31785  | 369    | γc deficiency (common gamma chain SCID, CD132 deficiency)                                              | XL                          | 1.1 T-B+ SCID                                   | Cytokine receptor loss                 | MONDO:0010315 / ORPHA:276                                |
| JAK3   | P52333  | 1124   | JAK3 deficiency                                                                                        | AR                          | 1.1 T-B+ SCID                                   | Kinase loss                            | MONDO:0010938 / ORPHA:35078                              |
| RAG1   | P15918  | 1043   | RAG deficiency                                                                                         | AR                          | 1.2 T-B- SCID                                   | V(D)J recombinase loss                 | MONDO:0000572 / ORPHA:331206, 231154, 157949             |
| CD40LG | P29965  | 261    | CD40 ligand (CD154) deficiency                                                                         | XL                          | 1.3 CID                                         | Ligand loss                            | MONDO:0010626 / ORPHA:101088                             |
| WAS    | P42768  | 502    | Wiskott–Aldrich syndrome (WAS LOF); also X-linked neutropenia/myelodysplasia (5.1, XL GOF)             | XL                          | 2.1 Congenital thrombocytopenia                 | Actin regulator, LOF and GOF           | MONDO:0010518 / ORPHA:906; MONDO:0010294 / ORPHA:86788   |
| STAT3  | P40763  | 770    | AD-HIES STAT3 deficiency (Job syndrome); also STAT3 GOF (4.3, AD GOF)                                  | AD LOF (dominant negative)  | 2.5 HIES                                        | Transcription factor, DN and GOF       | MONDO:0007818 / ORPHA:2314; MONDO:0014414 / ORPHA:438159 |
| BTK    | Q06187  | 659    | BTK deficiency, X-linked agammaglobulinemia                                                            | XL                          | 3.1 Agammaglobulinemia                          | Kinase loss                            | MONDO:0010421 / ORPHA:47                                 |
| PIK3CD | O00329  | 1044   | Activated p110δ syndrome (APDS); also p110δ deficiency (3.1, AR)                                       | AD (gene cell "PIK3CD GOF") | 3.2 CVID phenotype                              | Lipid kinase GOF                       | MONDO:0014222 / ORPHA:693661                             |
| FOXP3  | Q9BZS1  | 431    | IPEX, immune dysregulation, polyendocrinopathy, enteropathy X-linked                                   | XL                          | 4.3 Regulatory T-cell defects                   | Transcription factor loss              | MONDO:0010580 / ORPHA:37042                              |
| CTLA4  | P16410  | 223    | CTLA4 haploinsufficiency (ALPS-V)                                                                      | AD                          | 4.3 Regulatory T-cell defects                   | Checkpoint receptor haploinsufficiency | MONDO:0014493 / ORPHA:436159                             |
| CYBB   | P04839  | 570    | X-linked chronic granulomatous disease (CGD), gp91phox; also macrophage gp91phox deficiency (6.1 MSMD) | XL                          | 5.3 Defects of respiratory burst                | NADPH oxidase loss                     | MONDO:0010600 / ORPHA:379                                |
| STAT1  | P42224  | 750    | STAT1 GOF; also STAT1 deficiency AD LOF (6.1) and AR LOF (6.3)                                         | AD GOF                      | 6.6 Predisposition to mucocutaneous candidiasis | Transcription factor GOF               | MONDO:0013599 / ORPHA:391487                             |

### Verified pathogenic missense variants

Each row was fetched from ClinVar (`esummary`, 2026-10-03). The reference residue was checked against the UniProt canonical sequence for every variant (all match). `VAR_` IDs and rsIDs come from the UniProt "Natural variant" feature and agree with ClinVar's dbSNP cross-reference. Review: EP = reviewed by expert panel, MS = criteria provided, multiple submitters, no conflicts, SS = single submitter, NA = no assertion criteria. P = Pathogenic, P/LP = Pathogenic/Likely pathogenic.

| Gene (transcript)    | Protein change                               | cDNA      | ClinVar      | Class, review | dbSNP        | UniProt    |
| -------------------- | -------------------------------------------- | --------- | ------------ | ------------- | ------------ | ---------- |
| ADA (NM_000022.4)    | p.Arg211His                                  | c.632G>A  | VCV000001957 | P, EP         | rs121908716  | VAR_002232 |
|                      | p.Gly216Arg                                  | c.646G>A  | VCV000001968 | P, EP         | rs121908723  | VAR_002234 |
|                      | p.Ala329Val                                  | c.986C>T  | VCV000001959 | P, EP         | rs121908715  | VAR_002240 |
|                      | p.Leu107Pro                                  | c.320T>C  | VCV000001965 | P/LP, MS      | rs121908739  | VAR_002219 |
| IL2RG (NM_000206.3)  | p.Arg226Cys                                  | c.676C>T  | VCV000225195 | P, EP         | rs869320659  | VAR_002690 |
|                      | p.Arg226His                                  | c.677G>A  | VCV000225196 | P, EP         | rs869320660  | VAR_002691 |
|                      | p.Arg224Trp                                  | c.670C>T  | VCV000225194 | P, EP         | rs869320658  | VAR_002689 |
|                      | p.Arg222Cys                                  | c.664C>T  | VCV000010027 | P, EP         | rs111033618  | VAR_002688 |
| BTK (NM_000061.3)    | p.Arg28His                                   | c.83G>A   | VCV000011348 | P, MS         | rs128620185  | VAR_006220 |
|                      | p.Arg288Trp                                  | c.862C>T  | VCV000011366 | P/LP, MS      | rs128621194  | VAR_006227 |
|                      | p.Arg525Gln                                  | c.1574G>A | VCV000011342 | P/LP, MS      | rs128620183  | VAR_006255 |
|                      | p.Arg562Trp                                  | c.1684C>T | VCV000011383 | P, MS         | rs128621204  | VAR_006260 |
| WAS (NM_000377.3)    | p.Thr45Met                                   | c.134C>T  | VCV000011123 | P, MS         | rs132630273  | VAR_008106 |
|                      | p.Arg86His                                   | c.257G>A  | VCV000011115 | P, MS         | rs132630268  | VAR_005830 |
|                      | p.Val75Met                                   | c.223G>A  | VCV000265289 | P, MS         | rs782290433  | VAR_005828 |
|                      | p.Leu270Pro (XLN, constitutively activating) | c.809T>C  | VCV000011125 | P/LP, MS      | rs132630274  | VAR_033256 |
| RAG1 (NM_000448.3)   | p.Arg404Gln                                  | c.1211G>A | VCV001072413 | P, EP         | rs750055861  | no feature |
|                      | p.Arg561Cys                                  | c.1681C>T | VCV000013148 | P, EP         | rs104894285  | VAR_008890 |
|                      | p.Arg396His                                  | c.1187G>A | VCV000013146 | P, EP         | rs104894291  | VAR_008887 |
|                      | p.Arg737His                                  | c.2210G>A | VCV000013149 | P/LP, MS      | rs104894286  | VAR_008891 |
| JAK3 (NM_000215.4)   | p.Arg103His                                  | c.308G>A  | VCV000191102 | P, MS         | rs774202259  | no feature |
|                      | p.Arg103Cys                                  | c.307C>T  | VCV000384359 | P/LP, MS      | rs761583890  | no feature |
|                      | p.Asp784Asn                                  | c.2350G>A | VCV002152312 | P, EP         | rs760051760  | no feature |
|                      | p.Tyr100Cys                                  | c.299A>G  | VCV000009360 | P, NA         | rs137852624  | VAR_006284 |
| CYBB (NM_000397.4)   | p.His101Arg                                  | c.302A>G  | VCV000010926 | P, MS         | rs137854591  | VAR_002432 |
|                      | p.Pro415His                                  | c.1244C>A | VCV000010920 | P, MS         | rs137854585  | VAR_002440 |
|                      | p.Cys537Arg                                  | c.1609T>C | VCV000068386 | P, MS         | rs151344454  | VAR_007898 |
|                      | p.Glu309Lys                                  | c.925G>A  | VCV000068412 | P, MS         | rs151344466  | VAR_007885 |
| STAT3 (NM_139276.3)  | p.Arg382Trp (HIES1)                          | c.1144C>T | VCV000018304 | P, MS         | rs113994135  | VAR_037367 |
|                      | p.Arg382Gln (HIES1)                          | c.1145G>A | VCV000018305 | P, MS         | rs113994136  | VAR_037366 |
|                      | p.Val637Met (HIES1)                          | c.1909G>A | VCV000018308 | P, MS         | rs113994139  | VAR_037379 |
|                      | p.Thr716Met (GOF)                            | c.2147C>T | VCV000224848 | P, MS         | rs869312892  | VAR_071888 |
| STAT1 (NM_007315.4)  | p.Arg274Trp (GOF)                            | c.820C>T  | VCV000030083 | P, MS         | rs387906758  | VAR_065943 |
|                      | p.Arg274Gln (GOF)                            | c.821G>A  | VCV000030085 | P, MS         | rs387906760  | VAR_065942 |
|                      | p.Ala267Val                                  | c.800C>T  | VCV000030084 | P, MS         | rs387906759  | VAR_065940 |
|                      | p.Thr385Met (GOF)                            | c.1154C>T | VCV000144006 | P, MS         | rs587777630  | VAR_075499 |
| FOXP3 (NM_014009.4)  | p.Ala384Thr                                  | c.1150G>A | VCV000011410 | P/LP, MS      | rs122467170  | VAR_011332 |
|                      | p.Arg397Trp                                  | c.1189C>T | VCV000011407 | P, MS         | rs28935477   | VAR_011333 |
|                      | p.Arg397Gln                                  | c.1190G>A | VCV000379222 | P/LP, MS      | rs1057520529 | no feature |
|                      | p.Phe367Leu                                  | c.1099T>C | VCV000011419 | P, SS         | rs122467175  | no feature |
| CD40LG (NM_000074.3) | p.Thr254Met                                  | c.761C>T  | VCV000035814 | P, MS         | rs193922136  | VAR_007528 |
|                      | p.Met36Arg                                   | c.107T>G  | VCV000011162 | P/LP, MS      | rs104894774  | VAR_007513 |
|                      | p.Ala123Glu                                  | c.368C>A  | VCV000011168 | P, SS         | rs104894778  | VAR_007514 |
|                      | p.Trp140Arg                                  | c.418T>C  | VCV000976233 | P, SS         | rs104894777  | VAR_007519 |
| PIK3CD (NM_005026.5) | p.Glu1021Lys (GOF)                           | c.3061G>A | VCV000088675 | P, EP         | rs397518423  | VAR_070918 |
|                      | p.Glu525Lys                                  | c.1573G>A | VCV000132807 | P, EP         | rs587777389  | no feature |
|                      | p.Glu1025Gly                                 | c.3074A>G | VCV000422410 | P, EP         | rs1064795762 | no feature |
| CTLA4 (NM_005214.5)  | p.Arg75Trp                                   | c.223C>T  | VCV000945024 | P, EP         | rs1688714312 | no feature |
|                      | p.Arg70Trp                                   | c.208C>T  | VCV000161114 | P/LP, MS      | rs606231422  | VAR_072681 |
|                      | p.Asp153Asn                                  | c.457G>A  | VCV000636389 | P, EP         | rs1581573970 | no feature |
|                      | p.Gly146Arg                                  | c.436G>A  | VCV000849622 | P/LP, MS      | rs1688718864 | no feature |

ClinVar query used per gene (returns Variation IDs; pass them to `esummary.fcgi?db=clinvar&retmode=json&id=<comma-separated Variation IDs>`):

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&retmode=json&retmax=500&term=BTK[gene] AND "missense variant"[molecular consequence] AND ("clinsig pathogenic"[Properties] OR "clinsig likely pathogenic"[Properties]) AND "single gene"[Properties]
```

`esummary` fields used: `accession` (VCV), `title`, `protein_change`, `germline_classification.{description, review_status, last_evaluated, trait_set[].trait_name}`, `variation_set[].variation_xrefs[]` (dbSNP), `genes[].symbol`. Hit counts on 2026-10-03: ADA 42, IL2RG 50, BTK 121, WAS 53, RAG1 66, JAK3 22, CYBB 62, STAT3 101, STAT1 74, FOXP3 27, CD40LG 27, PIK3CD 13, CTLA4 20. Without an API key stay under 3 requests per second; pass the bracketed term through a URL encoder (`curl -g` or `urllib.parse.urlencode`).

## 12. Gotchas found during testing

- `iuis.org` answers `curl` and server-side fetchers with a Cloudflare challenge (HTTP 403). The S3 asset URLs are reachable directly. The Excel link was recovered from the Wayback Machine snapshot of 2025-11-29, where the page labels it "Updated IEI classification table (October, 2024)".
- ClinVar condition lists aggregate all submitters. STAT3 p.Arg382Trp lists both "Hyper-IgE recurrent infection syndrome 1" and "STAT3 gain of function". Take the mechanism from IUIS or UniProt variant descriptions.
- GenCC TSV has quoted multi-line fields: 46,736 physical lines, 30,328 records. Use a CSV parser.
- The ClinGen CSV starts with four preamble lines and separator rows of `+` characters.
- Orphadata API `/rd-associated-genes/genes/symbols/{symbol}` returned 404 for BTK and ADA; `/rd-associated-genes/genes/names/{name}` and the per-ORPHAcode routes work.
- GitHub's unauthenticated API hit its rate limit during testing. Use `releases/latest/download/<file>` asset URLs, which do not count against it.
- Europe PMC `/{PMCID}/supplementaryFiles` stalled past 60 seconds for the 2022 paper. Use the Springer static URL.
- The legacy PMC OA service URL `www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi` returned 404.
- HGNC maps C4B to UniProt P0C0L5, whose primary gene name in UniProt is "C4B; C4B_2". Compare by accession.
- IUIS repeats genes across tables by mechanism (22 genes). Model IEI entries as (gene, disease, inheritance, mechanism) records keyed to a table and subtable; a gene page lists several entries.

## 13. Unverified

- The live IUIS committee page in 2026 (Cloudflare blocked). Whether IUIS has posted a newer Excel or announced a 2026 update there is unknown; PubMed shows none.
- The rupress.org article page (HTTP 403): no check for errata or publisher-hosted supplements. The JATS XML lists no supplementary material for the genotypic paper.
- Full text of the OMIM Use Agreement (page blocked). The restriction summary rests on the `mim2gene.txt` header and search-result excerpts.
- PanelApp Australia's content license.
- Whether CC BY-ND permits publishing the derived identifier index. This is a legal judgement.
- The exact composition of the IUIS-stated 508 gene list (no official gene list file exists); the parse reaches 508 by a different counting rule.
- GeneReviews copyright terms and which Orphanet datasets (management text, orphan drugs) sit behind a Data Transfer Agreement: stated from the Orphadata legal notice and general knowledge, the individual dataset list was not opened.
- openFDA label coverage for IEI drugs beyond the two queries shown.
- The medRxiv preprint reporting a 557-gene IEI variant-prior database (10.1101/2025.03.25.25324607) and its repository were not inspected.
- `monarch-initiative/dismech` (BSD-3-Clause, AI-curated disease YAML, has an "IUIS campaign" pull request against the 2022 classification) was seen through search results only. It is AI-curated and therefore outside Helix's fact-source rule.
- Variant choice reflects ClinVar review status and submission count; "well known" in the literature was not independently assessed.

## 14. Sources

- Poli et al. 2025, genotypic classification: https://doi.org/10.70962/jhi.20250003 · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12829761/
- Bousfiha et al. 2025, phenotypic classification: https://doi.org/10.70962/jhi.20250002 · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12829316/
- Tangye et al. 2022: https://doi.org/10.1007/s10875-022-01289-3
- IUIS IEI committee page: https://iuis.org/committees/iei/ (snapshot https://web.archive.org/web/20251129232053/https://iuis.org/committees/iei/)
- Crossref license record: https://api.crossref.org/works/10.70962/jhi.20250003
- HGNC downloads and license: https://www.genenames.org/download/statistics-and-files/ · https://www.genenames.org/about/license/
- GenCC: https://search.thegencc.org/download · https://thegencc.org/terms
- ClinGen: https://search.clinicalgenome.org/kb/gene-validity · https://clinicalgenome.org/docs/terms-of-use/
- Orphadata: https://www.orphadata.com/ · https://api.orphadata.com/openapi.json · https://www.orphadata.com/legal-notice/
- HPO: https://github.com/obophenotype/human-phenotype-ontology/releases · https://human-phenotype-ontology.github.io/license.html
- Mondo: https://github.com/monarch-initiative/mondo/releases
- UniProt REST: https://rest.uniprot.org/
- ClinVar: https://www.ncbi.nlm.nih.gov/clinvar/ · https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/
- Open Targets: https://api.platform.opentargets.org/api/v4/graphql · https://platform-docs.opentargets.org/licence
- PanelApp: https://panelapp.genomicsengland.co.uk/api/docs/ · Terms of Use https://prod-media-panelapp.genomicsengland.co.uk/media/files/GEL_-_PanelApp_Terms_of_Use_December_2019.pdf
- PanelApp Australia: https://panelapp-aus.org/
- OMIM: https://omim.org/static/omim/data/mim2gene.txt · https://www.omim.org/help/agreement
- ClinicalTrials.gov API: https://clinicaltrials.gov/api/v2/version · openFDA: https://api.fda.gov/drug/label.json · ChEMBL: https://www.ebi.ac.uk/chembl/api/data/status.json · MedlinePlus Genetics: https://medlineplus.gov/about/data-files-api
