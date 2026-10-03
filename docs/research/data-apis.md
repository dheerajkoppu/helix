# OrphaFold data-source endpoint cookbook

Verified 2026-10-03 with `curl 8.7.1` from a US university network. Every request marked [V] was executed that day and the response inspected with `jq`.

Running example: **BTK** — UniProt `Q06187`, HGNC `HGNC:1133`, Ensembl `ENSG00000010671`, NCBI Gene `695`, MANE Select `ENST00000308731.8` / `NM_000061.3` / `NP_000052.1`, disease X-linked agammaglobulinemia `ORPHA:47` / `OMIM:300755` / `MONDO:0010421`.

Evidence tags: **[V]** executed today, **[D]** official documentation fetched today, **[S]** secondary source, **[U]** unverified (also listed in section 6).

Latency figures are single observations from one client, useful for ordering sources by speed, unsuitable as SLOs.

---

## 1. Recommendation for OrphaFold

1. **Anchor every record on three IDs**: UniProt accession (protein), HGNC ID (gene), MONDO ID (disease). Every source below resolves from one of them. Orphanet and OMIM IDs map to MONDO through Monarch `/mappings` or Orphadata cross-references [V].
2. **Use protein-level sources first, fan out second.** One UniProt entry call returns function, features, PDB/AlphaFold/HGNC/Ensembl/MANE/Orphanet/Reactome/ChEMBL/STRING cross-references. Fan out in parallel from those IDs.
3. **Do not trust cross-reference lists for completeness.** UniProt 2026_03 lists 133 PDB entries for BTK; RCSB search and PDBe SIFTS both return 170 [V]. Use PDBe/RCSB as the structure source of truth.
4. **Never hard-code version strings in URLs.** AlphaFold DB is at v6; `..._v4.cif` URLs return 404 [V]. Read `cifUrl`/`pdbUrl`/`paeDocUrl` from the API response.
5. **Pin the Open Targets schema with an introspection test in CI.** `Target.knownDrugs` no longer exists (HTTP 400); the replacement is `drugAndClinicalCandidates` [V]. Disease IDs are MONDO-first; `Orphanet_47` returns `null` [V].
6. **Resolve identifiers through the source's own resolver.** STRING's BTK node is `9606.ENSP00000483570` (isoform 2, 693 aa); the MANE protein `ENSP00000308176` returns 404 [V]. Call `get_string_ids` first.
7. **Variant numbering**: ClinVar `protein_change` lists every isoform unordered (`"R525Q, R349Q, R559Q"`). Take the MANE Select protein change from the `title` HGVS or the VCV XML `ProteinExpression` for `NP_000052.1` [V].
8. **Treat HTTP status as insufficient.** RCSB GraphQL, gnomAD and Europe PMC return HTTP 200 with an error payload; ChEMBL silently ignores unknown filters; InterPro and RCSB search return 204 for "no results" [V].
9. **Record provenance on every fetch**: source name, source release (header or version endpoint, table in section 5), request URL, retrieval timestamp, source record ID, license.
10. **Register an NCBI API key and send `tool` + `email`.** Unauthenticated E-utilities throttle at 3 requests/second and returned 429 on a burst of 6 [V].
11. **Cache aggressively.** All sources release on a weekly-to-quarterly cadence. UniProt itself sends `cache-control: public, max-age=43200` [V]. Cache key = (source, release, request).
12. **Structure provenance classes** for the UI: `experimental` (PDBe/RCSB), `predicted-existing` (AlphaFold DB, SWISS-MODEL via 3D-Beacons), `predicted-orphafold` (own runs). 3D-Beacons `model_category` gives `EXPERIMENTALLY DETERMINED` / `TEMPLATE-BASED` / `AB-INITIO` directly [V].

### 1.1 Field → primary source and fallback

| OrphaFold field          | Primary source (endpoint)                                                                                                                       | Fallback                                                                                                          | Notes                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Disease description      | Orphadata `/rd-cross-referencing/orphacodes/{code}?lang=en` → `SummaryInformation[].Definition`                                                 | Monarch `/entity/MONDO:…` → `description`; OLS4 MONDO term                                                        | Orphanet text is CC BY 4.0, attribution required                                                |
| Inheritance              | Orphadata `/rd-natural_history/orphacodes/{code}` → `TypeOfInheritance[]`                                                                       | Monarch entity → `inheritance{id,name}` (HPO term); JAX HPO `network/annotation/{disease}` category `Inheritance` | BTK/XLA: "X-linked recessive" / `HP:0001419` [V]                                                |
| Gene IDs                 | HGNC REST `/fetch/hgnc_id/{n}` (supplementary source, section 3.20)                                                                             | NCBI Datasets v2 `/gene/id/{id}`; Ensembl `/xrefs/id`                                                             | Both return HGNC, Entrez, Ensembl, UniProt, OMIM in one call [V]                                |
| Transcript (MANE Select) | Ensembl `/lookup/id/{ENSG}?expand=1;mane=1` → `Transcript[].MANE[]`                                                                             | NCBI Datasets `/gene/id/{id}/product_report` → `select_category=="MANE_SELECT"`; UniProt `MANE-Select` xref       | Do not pin Ensembl version suffixes; they drift between sources                                 |
| Protein function         | UniProt `comments[commentType=="FUNCTION"]` with ECO evidence and PMIDs                                                                         | NCBI Datasets `summary[].description` (RefSeq summary)                                                            | Open Targets `functionDescriptions` is a copy of UniProt, so it is no independent fallback      |
| Domains                  | UniProt `features[type in Domain, Region, Zinc finger, Motif]`                                                                                  | InterPro `/entry/interpro/protein/uniprot/{acc}`                                                                  | Show both tracks; InterPro is also the primary for family and superfamily                       |
| Functional sites         | UniProt `features[type in Active site, Binding site, Site, Modified residue]` (ChEBI ligand IDs included)                                       | InterPro `/protein/uniprot/{acc}?residues` (CDD site residues); PDBe-KB `ligand_sites`                            | PDBe-KB gives observed ligand contacts per PDB entry                                            |
| Variants                 | ClinVar E-utilities `esearch` + `esummary` (classification, review status, conditions)                                                          | EBI Proteins API `/variation/{acc}` (protein-indexed, already merged with ClinVar/gnomAD/predictors)              | gnomAD GraphQL for population frequency and constraint                                          |
| Experimental structures  | PDBe SIFTS `/mappings/best_structures/{acc}` (residue coverage) + RCSB GraphQL (method, resolution, ligands, mutations)                         | RCSB Search API by UniProt accession + `rcsb_polymer_entity_align`                                                | UniProt PDB xrefs lag (133 vs 170)                                                              |
| Predicted structures     | AlphaFold DB `/api/prediction/{acc}`                                                                                                            | 3D-Beacons `/uniprot/summary/{acc}.json` (AlphaFold DB, SWISS-MODEL, AlphaFill, others)                           | Store `latestVersion`, `modelCreatedDate`, `toolUsed`                                           |
| Interactions             | IntAct `/ws/interaction/findInteractions/{acc}` or PSICQUIC MITAB (curated, MI score, PMID)                                                     | STRING `interaction_partners` (`network_type=physical`)                                                           | Label STRING edges as "functional association score", never as experimental evidence            |
| Pathways                 | Reactome `/data/mapping/UniProt/{acc}/pathways?species=9606`                                                                                    | UniProt Reactome xrefs; Open Targets `target.pathways`                                                            | Same 14 pathways from Reactome and UniProt for BTK [V]                                          |
| Phenotypes               | Monarch `/association?subject={id}&category=biolink:…PhenotypicFeatureAssociation` (frequency counts, publications, `primary_knowledge_source`) | JAX HPO `network/annotation/{id}`; Orphadata `/rd-phenotypes/orphacodes/{code}`                                   | Orphadata phenotype set for ORPHA:47 has `ValidationDate` 2016-06-01                            |
| Drugs and compounds      | Open Targets `target.drugAndClinicalCandidates` + ChEMBL `/mechanism`                                                                           | ChEMBL `/activity` and `/molecule`; PubChem PUG REST for identifiers, properties, SDF                             | Join on ChEMBL ID and InChIKey                                                                  |
| Literature               | Europe PMC `/search` (`resultType=core`, `HAS_ABSTRACT:y`)                                                                                      | PubMed E-utilities `esearch` (`hasabstract`) + `efetch`                                                           | Abstract text is publisher copyright unless the record is open access; store PMIDs and link out |

### 1.2 Endpoints that were down, changed, or behave unexpectedly [V]

| Source             | Observation on 2026-10-03                                                                                                                                                                                                                                                              | Action                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Open Targets 26.09 | `Target.knownDrugs` removed → HTTP 400 `Cannot query field 'knownDrugs'`. New: `drugAndClinicalCandidates{count rows{id maxClinicalStage drug{…} diseases{…} clinicalReports{…}}}`; `Drug.maximumClinicalStage`; `Drug.indications`. Third-party reports date the removal to 26.06 [S] | Use new fields; add schema test                                                       |
| Open Targets 26.09 | `disease(efoId:"Orphanet_47")` and `disease(efoId:"EFO_0000095")` → `null`; `mapIds`/`search` on `Orphanet:47`, `OMIM:300755` → 0 hits                                                                                                                                                 | Resolve to `MONDO_…` first                                                            |
| Open Targets 26.09 | `interactions(sourceDatabase:"intact")` → 400; argument is an enum (`intact`, `reactome`, `signor`, `string`)                                                                                                                                                                          | Pass unquoted enum                                                                    |
| AlphaFold DB       | v6 only. `AF-Q06187-F1-model_v4.cif` → 404. `msaUrl` (`/files/msa/…a3m`) → 403. Response still carries legacy fields (`entryId`, `uniprotStart`, …) after the announced 25-06-2026 sunset [D]                                                                                          | Use URL fields from the response; use `modelEntityId`, `sequenceStart`, `sequenceEnd` |
| HPO                | `https://hpo.jax.org/api/hpo/gene/695` → 404 HTML                                                                                                                                                                                                                                      | Use `https://ontology.jax.org/api/…`                                                  |
| Orphadata          | `/rd-associated-genes/genes/symbols/BTK` → 404; `/symbols/btk` → 200 (reproduced for WAS, JAK3, KIF7). Path for OMIM is `/rd-cross-referencing/omims/{id}`, `/omim-codes/` → 404                                                                                                       | Lowercase the symbol                                                                  |
| STRING 12.5        | `identifiers=9606.ENSP00000308176` → 404. BTK is `9606.ENSP00000483570`                                                                                                                                                                                                                | Always call `get_string_ids`                                                          |
| PubChem            | Requesting `CanonicalSMILES,IsomericSMILES` returns keys `ConnectivitySMILES` and `SMILES`                                                                                                                                                                                             | Request and parse the new names                                                       |
| InterPro           | No-match returns HTTP 204 with `Content-Length: 120`; curl over HTTP/2 fails with error 92                                                                                                                                                                                             | Treat 204 as empty; catch protocol errors or force HTTP/1.1                           |
| ChEMBL             | Unknown filter (`nonsense_field=1`) → 200 with unfiltered data. Default format is XML. Latency 0.6–14 s                                                                                                                                                                                | Validate filters client-side; always use `.json`; long timeout                        |
| Europe PMC         | Empty query and `pageSize=1001` → HTTP 200 with `errCode`/`errMsg` body. `/{PMCID}/fullTextXML` on non-OA → HTTP 500                                                                                                                                                                   | Check body; gate full text on `isOpenAccess=="Y"`                                     |
| ClinVar esummary   | Classification lives in `germline_classification` (plus `clinical_impact_classification`, `oncogenicity_classification`); no `clinical_significance` key                                                                                                                               | Parse the three-class layout                                                          |
| RCSB               | Search with zero hits → HTTP 204, empty body. GraphQL validation error → HTTP 200 with `errors[]`                                                                                                                                                                                      | Handle both                                                                           |
| UniProt            | `xref:hgnc-HGNC:1133` → 400 (unescaped colon). `xref:hgnc-1133` works                                                                                                                                                                                                                  | Escape or drop prefix                                                                 |
| Ensembl REST       | Request without `Content-Type: application/json` → HTTP 200 with `text/html`                                                                                                                                                                                                           | Always send the header or `?content-type=application/json`                            |
| HGNC REST          | Request without `Accept: application/json` → HTTP 200 with `text/xml`                                                                                                                                                                                                                  | Always send the header                                                                |
| NCBI E-utilities   | 6 parallel unauthenticated requests → three 429s, `retry-after: 2`; body echoes the caller IP                                                                                                                                                                                          | Key + limiter; do not log the body                                                    |

---

## 2. Source summary

| Source                | Base URL                                                                                                | Version observed [V]                                                 | Auth                          | Rate limit                                                            | Data license                                          | Observed latency |
| --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | ---------------- |
| UniProt REST          | `https://rest.uniprot.org`                                                                              | 2026_03 (02-Sep-2026)                                                | none                          | no numeric limit published [U]; `/stream` 429 under parallel load [D] | CC BY 4.0 [D]                                         | 0.6–1.1 s        |
| EBI Proteins API      | `https://www.ebi.ac.uk/proteins/api`                                                                    | n/a                                                                  | none                          | 200 req/s/user [D]                                                    | UniProt-derived, CC BY 4.0; EMBL-EBI terms of use [U] | 0.6–2.1 s        |
| ClinVar (E-utilities) | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`                                                         | build 260929 (2026-09-29)                                            | optional `api_key`            | 3 req/s no key [V]; 10 req/s with key [U]                             | NCBI public data; cite ClinVar [U]                    | 0.1–0.8 s        |
| NCBI Datasets v2      | `https://api.ncbi.nlm.nih.gov/datasets/v2`                                                              | 18.38.0                                                              | optional `api-key` header [U] | `x-ratelimit-limit: 5` no key [V]                                     | NCBI public data                                      | 0.13–0.33 s      |
| RCSB PDB              | `https://search.rcsb.org`, `https://data.rcsb.org`, `https://files.rcsb.org`, `https://models.rcsb.org` | n/a                                                                  | none                          | no published numbers [U]; 30 sequential OK                            | CC0 1.0 [D]                                           | 0.02–0.25 s      |
| PDBe / SIFTS          | `https://www.ebi.ac.uk/pdbe/api`, `…/pdbe/graph-api`                                                    | n/a                                                                  | none                          | [U]                                                                   | PDB data CC0 [D]; EMBL-EBI terms of use [U]           | 0.6–2.7 s        |
| AlphaFold DB          | `https://alphafold.ebi.ac.uk/api`                                                                       | v6 (released 21-Oct-2025 [D])                                        | none                          | none documented in OpenAPI [V]; 10 sequential OK                      | CC BY 4.0 (stated in mmCIF) [V]                       | 0.06–1.1 s       |
| Ensembl REST          | `https://rest.ensembl.org`                                                                              | release 116, REST 15.12, GRCh38.p14                                  | none                          | 55,000/hour (≈15/s) [V header, D]                                     | EMBL-EBI terms of use [U]                             | 0.6–8.2 s        |
| InterPro              | `https://www.ebi.ac.uk/interpro/api`                                                                    | 110.0                                                                | none                          | [U]                                                                   | CC0 1.0 [D]                                           | 0.6–2.7 s        |
| Open Targets          | `https://api.platform.opentargets.org/api/v4/graphql`                                                   | API 26.9.0, data 26.09                                               | none                          | [U]; 10 sequential OK                                                 | CC0 1.0 [D]                                           | 0.15–0.31 s      |
| ChEMBL                | `https://www.ebi.ac.uk/chembl/api/data`                                                                 | ChEMBL_37 (2026-05-01)                                               | none                          | [U]                                                                   | CC BY-SA 3.0 [D]                                      | 0.6–14 s         |
| PubChem PUG REST      | `https://pubchem.ncbi.nlm.nih.gov/rest/pug`                                                             | n/a                                                                  | none                          | 5 req/s, 400 req/min, 300 s run time/min [S]                          | NCBI public data; depositor terms vary [U]            | 0.13–8.6 s       |
| Europe PMC            | `https://www.ebi.ac.uk/europepmc/webservices/rest`                                                      | 6.9                                                                  | none                          | per-IP throttle, number unconfirmed [S]                               | metadata open; abstracts and full text per article    | 0.6–1.0 s        |
| PubMed (E-utilities)  | as ClinVar                                                                                              | n/a                                                                  | as ClinVar                    | as ClinVar                                                            | NLM terms                                             | 0.15–0.5 s       |
| STRING                | `https://string-db.org/api`                                                                             | 12.5                                                                 | none; send `caller_identity`  | "wait one second between each call" [D]                               | CC BY 4.0 [D]                                         | 0.2–5.6 s        |
| Reactome              | `https://reactome.org/ContentService`                                                                   | 97                                                                   | none                          | [U]                                                                   | CC0 (data), CC BY 4.0 (diagrams) [D]                  | 0.1–1.1 s        |
| IntAct                | `https://www.ebi.ac.uk/intact/ws`, PSICQUIC                                                             | FTP `current` dated 2026-01-14                                       | none                          | [U]                                                                   | CC BY 4.0 [S]                                         | 0.6–3.7 s        |
| gnomAD                | `https://gnomad.broadinstitute.org/api`                                                                 | datasets `gnomad_r4`, `gnomad_r3`, `gnomad_r2_1`; ClinVar 2026-09-28 | none                          | 10 req/IP/60 s [S]; 12 sequential trivial queries all 200 [V]         | CC0 [S]                                               | 0.07–1.7 s       |
| Monarch v3            | `https://api-v3.monarchinitiative.org/v3/api`                                                           | KG 2026-09-02                                                        | none                          | [U]                                                                   | per upstream source [S]                               | 0.17–0.47 s      |
| JAX HPO               | `https://ontology.jax.org/api`                                                                          | HPO 2026-09-01 (per OLS4)                                            | none                          | [U]                                                                   | HPO license: cite, show version, no alteration [D]    | 0.21–0.29 s      |
| Orphadata             | `https://api.orphadata.com`                                                                             | data dated 2026-06-23                                                | none                          | [U]                                                                   | CC BY 4.0 (in every response) [V]                     | 0.45–0.7 s       |

---

## 3. Cookbook

### 3.1 UniProt REST

```bash
# full entry (226 KB, 1.08 s)
curl -s 'https://rest.uniprot.org/uniprotkb/Q06187.json'
# projected entry (89 KB, 0.90 s)
curl -s 'https://rest.uniprot.org/uniprotkb/Q06187?format=json&fields=accession,id,gene_primary,protein_name,cc_function,cc_catalytic_activity,cc_subunit,cc_disease,ft_domain,ft_region,ft_zn_fing,ft_binding,ft_act_site,ft_site,ft_mod_res,ft_variant,ft_mutagen,xref_pdb,xref_alphafolddb,xref_hgnc,xref_ensembl,xref_mane-select,xref_orphanet,xref_mim,sequence'
# search by gene (x-total-results: 1)
curl -s 'https://rest.uniprot.org/uniprotkb/search?query=gene_exact:BTK+AND+organism_id:9606+AND+reviewed:true&fields=accession,id,gene_names,protein_name,length&format=json&size=5'
# search by HGNC id
curl -s 'https://rest.uniprot.org/uniprotkb/search?query=xref:hgnc-1133+AND+reviewed:true&fields=accession,gene_primary&format=json'
# FASTA
curl -s 'https://rest.uniprot.org/uniprotkb/Q06187.fasta'
# ID mapping: submit, then read results (133 PDB ids)
curl -s --form 'from=UniProtKB_AC-ID' --form 'to=PDB' --form 'ids=Q06187' 'https://rest.uniprot.org/idmapping/run'   # {"jobId":"…"}
curl -sL 'https://rest.uniprot.org/idmapping/results/{jobId}?size=500'
```

| Need       | JSON path                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | `primaryAccession`, `secondaryAccessions[]`, `uniProtkbId`, `entryType`, `annotationScore`, `proteinExistence`, `entryAudit.{entryVersion,sequenceVersion,lastAnnotationUpdateDate}`               |
| Names      | `proteinDescription.recommendedName.fullName.value`, `.ecNumbers[].value`, `genes[].geneName.value`, `genes[].synonyms[].value`                                                                    |
| Sequence   | `sequence.{value,length,molWeight,md5,crc64}`                                                                                                                                                      |
| Function   | `comments[]` where `commentType=="FUNCTION"` → `texts[].value`, `texts[].evidences[]{evidenceCode,source,id}`                                                                                      |
| Disease    | `commentType=="DISEASE"` → `disease.{diseaseId,diseaseAccession,acronym,description,diseaseCrossReference{database,id}}`, `note.texts[].value`                                                     |
| Features   | `features[]{type,location.start.value,location.end.value,description,featureId,evidences[],ligand{name,id},alternativeSequence{originalSequence,alternativeSequences[]},featureCrossReferences[]}` |
| Cross-refs | `uniProtKBCrossReferences[]{database,id,properties[]{key,value},isoformId}`                                                                                                                        |

- BTK feature counts: Domain 4, Zinc finger 1, Region 2, Motif 1, Active site 1, Binding site 13, Modified residue 15, Natural variant 117, Mutagenesis 8, Helix 27, Beta strand 37, Turn 10.
- Binding-site ligands carry ChEBI IDs (`ChEBI:CHEBI:30616` ATP, residues 408–416 and 430) and PDB evidence (`ECO:0007744|PDB|3PIY`).
- PDB xref properties: `Method`, `Resolution` (`"1.60 A"` or `"-"`), `Chains` (`"A/B=2-170"`). MANE-Select xref properties: `ProteinId`, `RefSeqNucleotideId`, `RefSeqProteinId`.
- Other comment types present: CATALYTIC ACTIVITY, COFACTOR, ACTIVITY REGULATION, SUBUNIT, INTERACTION, SUBCELLULAR LOCATION, PTM, DOMAIN, TISSUE SPECIFICITY, ALTERNATIVE PRODUCTS.
- **Pagination**: `size` ≤ 500 (`size=501` → 400). Next page in `Link: <…cursor=…>; rel="next"`; total in `x-total-results`. No `Link` header on the last page.
- **Release headers**: `x-uniprot-release`, `x-uniprot-release-date`, `x-api-deployment-date`.
- **Failures**: 400 `{"url":…,"messages":[…]}` (bad accession format, bad field, bad query syntax); 303 redirect for secondary accessions (`B2RAW1` → `/uniprotkb/Q06187?from=B2RAW1`); docs list 500/503 with retry advice [D].
- **Attribution**: CC BY 4.0; cite the UniProt Consortium paper named at https://www.uniprot.org/help/publications.

### 3.2 EBI Proteins API — variation

```bash
curl -s -H 'Accept: application/json' 'https://www.ebi.ac.uk/proteins/api/variation/Q06187'            # 2.39 MB, 2.1 s, 1176 features
curl -s -H 'Accept: application/json' 'https://www.ebi.ac.uk/proteins/api/variation?offset=0&size=100&accession=Q06187&consequencetype=missense&sourcetype=uniprot'
curl -s -H 'Accept: application/json' 'https://www.ebi.ac.uk/proteins/api/variation/dbsnp/rs128620183'
curl -s -H 'Accept: application/json' 'https://www.ebi.ac.uk/proteins/api/variation/hgvs/NC_000023.11%3Ag.101375282C%3ET'
curl -s -H 'Accept: application/json' 'https://www.ebi.ac.uk/proteins/api/features/Q06187?categories=DOMAINS_AND_SITES'
```

- Top level: `accession`, `entryName`, `geneName`, `sequence`, `taxid`, `features[]`.
- Per feature: `begin`, `end`, `wildType`, `mutatedType`, `alternativeSequence`, `consequenceType`, `genomicLocation[]` (HGVS g.), `locations[]{loc,seqId,source}` (HGVS p. on an ENST), `codon`, `cytogeneticBand`, `sourceType` (`uniprot`, `large_scale_study`, `mixed`), `somaticStatus`, `ftId`, `xrefs[]{name,id,url}`, `clinicalSignificances[]{type,sources[],reviewStatus}`, `association[]{name,disease,dbReferences[],evidences[]}`, `predictions[]{predAlgorithmNameType,predictionValType,score,sources[]}`, `populationFrequencies[]`, `descriptions[]`.
- BTK: missense 1029, frameshift 67, stop gained 65, inframe deletion 6, stop lost 3, insertion 2. Clinical significance tags: Pathogenic 267, Likely pathogenic 57, VUS 119, Likely benign 21, Benign 7. Xref names include ClinVar, ClinGen, dbSNP, gnomAD, TOPMed, ExAC, cosmic curated, NCI-TCGA.
- `predictions` carry SIFT and PolyPhen scores sourced from Ensembl.
- **Pagination** (search form): `offset`, `size`; headers `x-pagination-totalrecords`, `Link` rel `self`/`first`/`last`. Pagination counts proteins, so one accession is one record. `size=101` was accepted.
- **Gotcha**: `/variation/dbsnp/…` and `/variation/hgvs/…` return an array with one object per matching protein (`A0A8Q3WKL1`, `Q06187`, `Q06187-2`). Filter by accession.
- **Failures**: 400 `{"requestedURL":…,"errorMessage":[…]}` for a malformed accession; 404 `Resources not found` for a valid accession with no data.
- **Limit**: 200 requests/second/user [D]. JSON was returned to curl without an `Accept` header; send `Accept: application/json` explicitly because the service also serves XML.

### 3.3 ClinVar via NCBI E-utilities

```bash
E=https://eutils.ncbi.nlm.nih.gov/entrez/eutils
# 1. pathogenic + likely pathogenic missense in BTK → count 122, with history server
curl -s "$E/esearch.fcgi?db=clinvar&term=BTK%5Bgene%5D+AND+(%22clinsig+pathogenic%22%5BProperties%5D+OR+%22clinsig+likely+pathogenic%22%5BProperties%5D)+AND+%22missense+variant%22%5BMolecular+consequence%5D&retmode=json&retmax=500&usehistory=y&tool=orphafold&email=YOU%40DOMAIN"
# 2. summaries for the whole result set (122 records, 296 KB, 0.82 s)
curl -s "$E/esummary.fcgi?db=clinvar&query_key=1&WebEnv={webenv}&retmode=json&retstart=0&retmax=500"
# 3. full record incl. per-isoform protein HGVS (XML only)
curl -s "$E/efetch.fcgi?db=clinvar&rettype=vcv&is_variationid&id=4952029"
```

Equivalent terms that also work: `695[GeneID] AND single_gene[prop] AND (clinsig_pathogenic[prop] OR clinsig_likely_pathogenic[prop]) AND missense_variant[molecular consequence]` (count 121). All BTK records: `BTK[gene]` → 1184. Review-status filter needs the exact phrase with commas: `"criteria provided, multiple submitters, no conflicts"[Review status]` (125 for BTK); forms without commas return 0 with `errorlist.phrasesnotfound`.

| Need           | `esummary` JSON path (`result[uid]`)                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDs            | `uid` (Variation ID), `accession` (`VCV000011342`), `accession_version`                                                                                                    |
| Name           | `title` = `NM_000061.3(BTK):c.1574G>A (p.Arg525Gln)`                                                                                                                       |
| Protein change | `protein_change` = `"R525Q, R349Q, R559Q"` (all isoforms, unordered)                                                                                                       |
| Genomic        | `variation_set[0].canonical_spdi` (`NC_000023.11:101354686:C:T`, 0-based), `variation_set[0].variation_loc[]{assembly_name,chr,start,stop}`, `cdna_change`, `variant_type` |
| Classification | `germline_classification.{description,review_status,last_evaluated}`                                                                                                       |
| Conditions     | `germline_classification.trait_set[]{trait_name,trait_xrefs[]{db_source,db_id}}` (Orphanet, MONDO, OMIM, MedGen)                                                           |
| Consequence    | `molecular_consequence_list[]`                                                                                                                                             |
| Xrefs          | `variation_set[0].variation_xrefs[]` (ClinGen CA id, `UniProtKB Q06187#VAR_006255`, OMIM allelic variant, dbSNP)                                                           |
| Submissions    | `supporting_submissions.{scv[],rcv[]}`                                                                                                                                     |
| Gene           | `genes[]{symbol,geneid,strand,source}`                                                                                                                                     |

- BTK P/LP missense set: Likely pathogenic 64, Pathogenic 49, Pathogenic/Likely pathogenic 9; review status: single submitter 83, multiple submitters no conflicts 25, no assertion criteria 14.
- VCV XML adds `<ProteinExpression sequenceAccessionVersion="NP_000052.1" change="p.His362Tyr">` per RefSeq protein, `<Gene HGNC_ID=…>`, citations (`<ID Source="PubMed">`), and submitter-level SCV records.
- **Pagination**: `retstart` + `retmax`; `usehistory=y` returns `webenv` + `querykey` for follow-up calls.
- **Rate limit**: headers `x-ratelimit-limit: 3`, `x-ratelimit-remaining`. Over limit → HTTP 429, `retry-after: 2`, body `{"error":"API rate limit exceeded","api-key":"<caller IP>","count":"4","limit":"3"}`.
- **Failures**: unknown term → HTTP 200, `count:"0"`, `errorlist.phrasesnotfound[]`. Check `errorlist` and `warninglist`.
- **Freshness**: `einfo.fcgi?db=clinvar&retmode=json` → `dbinfo[0].lastupdate` = `2026/09/29 05:12`, 4,647,675 records.

### 3.4 NCBI Gene / Datasets v2

```bash
curl -s 'https://api.ncbi.nlm.nih.gov/datasets/v2/gene/id/695'                      # 13 KB, 0.33 s
curl -s 'https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/BTK/taxon/9606'
curl -s 'https://api.ncbi.nlm.nih.gov/datasets/v2/gene/id/695/product_report'       # transcripts + proteins
curl -s 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=695&retmode=json'   # legacy summary
```

- `reports[0].gene`: `gene_id`, `symbol`, `description`, `type`, `orientation`, `chromosomes[]`, `nomenclature_authority.{authority,identifier}` (`HGNC:1133`), `swiss_prot_accessions[]`, `ensembl_gene_ids[]`, `omim_ids[]`, `synonyms[]`, `summary[].description`, `annotations[].{assembly_name,genomic_locations[].genomic_range{begin,end,orientation}}` (GRCh38.p14 and T2T-CHM13v2.0), `reference_standards[].gene_range.accession_version` (`NG_009616.1`), `gene_ontology`, `transcript_count`, `protein_count`.
- `product_report` → `reports[0].product.transcripts[]{accession_version,name,length,type,select_category,ensembl_transcript,protein{accession_version,length,isoform_name,ensembl_protein}}`. MANE Select row: `select_category:"MANE_SELECT"`, `NM_000061.3`, `ENST00000308731.8`, `NP_000052.1`, 659 aa.
- **Headers**: `x-datasets-version: 18.38.0`, `x-ratelimit-limit: 5`, `x-ratelimit-remaining`.
- **Failures**: 400 `{"error":"Bad Request","code":400,"message":…}` for an invalid ID. Symbol lookup without a match was not tested.

### 3.5 RCSB PDB

```bash
# Search API: all experimental entries containing UniProt Q06187 → total_count 170 (0.03 s)
curl -s -X POST -H 'Content-Type: application/json' 'https://search.rcsb.org/rcsbsearch/v2/query' -d '{
  "query":{"type":"group","logical_operator":"and","nodes":[
    {"type":"terminal","service":"text","parameters":{"attribute":"rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession","operator":"exact_match","value":"Q06187"}},
    {"type":"terminal","service":"text","parameters":{"attribute":"rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name","operator":"exact_match","value":"UniProt"}}]},
  "return_type":"entry",
  "request_options":{"paginate":{"start":0,"rows":25},"results_content_type":["experimental"],
    "sort":[{"sort_by":"rcsb_entry_info.resolution_combined","direction":"asc"}]}}'
# Data API REST
curl -s 'https://data.rcsb.org/rest/v1/core/entry/5P9J'
curl -s 'https://data.rcsb.org/rest/v1/core/polymer_entity/5P9J/1'
# Data API GraphQL, batched
curl -s -X POST -H 'Content-Type: application/json' 'https://data.rcsb.org/graphql' -d '{"query":"query($ids:[String!]!){entries(entry_ids:$ids){rcsb_id struct{title} rcsb_entry_info{resolution_combined experimental_method nonpolymer_bound_components} rcsb_accession_info{deposit_date initial_release_date} refine{ls_R_factor_R_free} rcsb_primary_citation{pdbx_database_id_PubMed pdbx_database_id_DOI} polymer_entities{rcsb_id entity_poly{rcsb_mutation_count} rcsb_polymer_entity{pdbx_description pdbx_mutation} rcsb_polymer_entity_container_identifiers{auth_asym_ids asym_ids uniprot_ids} rcsb_polymer_entity_align{reference_database_name reference_database_accession aligned_regions{entity_beg_seq_id ref_beg_seq_id length}}} nonpolymer_entities{nonpolymer_comp{chem_comp{id name formula} rcsb_chem_comp_descriptor{InChIKey SMILES}} rcsb_nonpolymer_entity_container_identifiers{auth_asym_ids}}}}","variables":{"ids":["5P9J","1BTK","8YVV"]}}'
```

- Search response: `total_count`, `result_set[]{identifier,score}`. `return_type` `entry` → `5P9J`; `polymer_entity` → `5P9J_1`. `"return_all_hits":true` replaces `paginate`. GET form: `?json=<url-encoded body>`.
- `results_content_type:["computational"]` returns computed structure models (`AF_AFQ06187F1`); keep it `["experimental"]` for the experimental track.
- Gene-name search (`rcsb_entity_source_organism.rcsb_gene_name.value == BTK`) returns 182 entries; use the UniProt accession query for precision.
- GraphQL example results: 5P9J X-ray 1.08 Å, R-free 0.2237, PMID 28062735, ligand `8E8`, entity 5P9J_1 aligned `ref_beg_seq_id 382`, length 278; 1BTK `pdbx_mutation "R28C"`, `rcsb_mutation_count 1`, ligands ZN and NA.
- Residue coverage: UniProt residue = `ref_beg_seq_id + (entity_seq_id − entity_beg_seq_id)` across `aligned_regions[]`.
- **Files** (all 200):

| Content             | URL pattern                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| mmCIF               | `https://files.rcsb.org/download/5P9J.cif` (`.cif.gz` 125 KB)                  |
| PDB format          | `https://files.rcsb.org/download/5P9J.pdb` (`.pdb.gz`)                         |
| BinaryCIF           | `https://models.rcsb.org/5P9J.bcif` (`.bcif.gz` 89 KB)                         |
| Biological assembly | `https://files.rcsb.org/download/5P9J-assembly1.cif.gz`                        |
| Header only         | `https://files.rcsb.org/header/5P9J.cif`                                       |
| Ligand definition   | `https://files.rcsb.org/ligands/download/8E8.cif`, `…/8E8_ideal.sdf`           |
| wwPDB archive       | `https://files.wwpdb.org/pub/pdb/data/structures/divided/mmCIF/p9/5p9j.cif.gz` |
| PDBe updated mmCIF  | `https://www.ebi.ac.uk/pdbe/entry-files/download/5p9j_updated.cif`             |
| Image               | `https://cdn.rcsb.org/images/structures/5p9j_assembly-1.jpeg`                  |

- **Failures**: search no hits → 204 empty body; malformed query → 400 `{"status":400,"message":…}`; REST unknown entry → 404 `{"status":404,"message":"No data found for entryId: …"}`; GraphQL validation error → HTTP 200 with `errors[]`.
- **License**: CC0 1.0; acknowledging structure authors and RCSB PDB is encouraged [D].

### 3.6 PDBe SIFTS and PDBe-KB

```bash
curl -s 'https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/Q06187'        # 52 KB, 0.9 s
curl -s 'https://www.ebi.ac.uk/pdbe/graph-api/uniprot/best_structures/Q06187'   # 87 KB, adds observed_regions
curl -s 'https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/5p9j'
curl -s 'https://www.ebi.ac.uk/pdbe/api/mappings/uniprot_segments/1btk'
curl -s 'https://www.ebi.ac.uk/pdbe/graph-api/uniprot/ligand_sites/Q06187'      # 637 KB, 1.8 s, 175 ligands
curl -s 'https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/Q06187'
```

- `best_structures` → `{"Q06187":[…]}`, one row per chain, sorted best first: `pdb_id`, `chain_id`, `experimental_method`, `resolution`, `tax_id`, `unp_start`, `unp_end`, `start`, `end` (entity numbering), `coverage` (fraction of UniProt length). BTK: 301 rows, 170 unique entries, 297 X-ray rows and 4 solution NMR rows.
- The same payload is served at `/pdbe/api/…`, `/pdbe/api/v2/…` and `/pdbe/graph-api/mappings/…`. The `graph-api/uniprot/best_structures` variant adds `entity_id`, `preferred_assembly_id`, `observed_regions[]`.
- `mappings/uniprot/{pdb}` adds `identity`, `struct_asym_id`, and `start`/`end` objects with `author_residue_number` and `residue_number`.
- `ligand_sites` → `data[]{name,accession (chem comp id),residues[]{startIndex,endIndex,startCode,indexType:"UNIPROT",interactingPDBEntries[]},additionalData{scaffoldId,chemblId,drugBankId,isSolvent,pdbEntries[]}}`.
- **Failures**: 404 `{"message":"Requested endpoint does not contain any data"}` when no structure exists. Treat as an empty set.
- No pagination; whole payload per accession.

### 3.7 AlphaFold DB

```bash
curl -s 'https://alphafold.ebi.ac.uk/api/prediction/Q06187'              # array of 2: canonical + isoform
curl -s 'https://alphafold.ebi.ac.uk/api/uniprot/summary/Q06187.json'    # 3D-Beacons shape
curl -s 'https://alphafold.ebi.ac.uk/api/annotations/Q06187.json?type=MUTAGEN'   # AlphaMissense summary
curl -s 'https://alphafold.ebi.ac.uk/api/openapi.json'
```

- Response is an **array**. BTK returns `AF-Q06187-F1` (1–659) and `AF-Q06187-2-F1` (isoform, 1–693). Select the element whose `uniprotAccession` equals the requested accession.
- Fields: `modelEntityId`, `uniprotAccession`, `uniprotId`, `gene`, `taxId`, `sequence`, `sequenceStart`, `sequenceEnd`, `sequenceChecksum` (MD5), `sequenceVersionDate`, `latestVersion` (6), `allVersions`, `modelCreatedDate` (`2025-08-01T00:00:00Z`), `toolUsed` (`AlphaFold Monomer v2.0 pipeline`), `providerId` (`GDM`), `globalMetricValue` (mean pLDDT 84.44), `fractionPlddtVeryLow` 0.071, `fractionPlddtLow` 0.064, `fractionPlddtConfident` 0.354, `fractionPlddtVeryHigh` 0.511, `isUniProtReviewed`, `isUniProtReferenceProteome`, `isComplex`.
- URL fields: `cifUrl`, `bcifUrl`, `pdbUrl`, `plddtDocUrl`, `paeDocUrl`, `paeImageUrl`, `amAnnotationsUrl`, `amAnnotationsHg19Url`, `amAnnotationsHg38Url`, `msaUrl`.
- Legacy duplicates still served: `entryId` (labelled "Legacy field" in the OpenAPI schema), `uniprotStart`, `uniprotEnd`, `uniprotSequence`, `isReviewed`, `isReferenceProteome`.
- OpenAPI paths: `/prediction/{qualifier}` (params `sequence_checksum`, `include_complexes`), `/complex/{qualifier}`, `/uniprot/summary/{qualifier}.json`, `/sequence/summary`, `/annotations/{qualifier}.json`.

| File          | URL                                                                                     | Shape                                                                 |
| ------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Model         | `https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-model_v6.cif` (627 KB), `.pdb`, `.bcif` | pLDDT in B-factor column; license text inside the mmCIF               |
| pLDDT         | `…/AF-Q06187-F1-confidence_v6.json` (9 KB)                                              | `{residueNumber[],confidenceScore[],confidenceCategory[]}`            |
| PAE           | `…/AF-Q06187-F1-predicted_aligned_error_v6.json` (1.18 MB)                              | `[{predicted_aligned_error:[[…]],max_predicted_aligned_error:31.75}]` |
| AlphaMissense | `…/AF-Q06187-F1-aa-substitutions.csv` (242 KB)                                          | `protein_variant,am_pathogenicity,am_class` (`M1A,0.4772,Amb`)        |

- **Failures**: malformed ID → 400 `{"error":"Invalid identifier format…"}`; valid accession without a model (`Q8WZ42`) → 404 with body `{}`.
- **License**: CC BY 4.0; cite Jumper et al. 2021 and the AlphaFold DB paper. AlphaMissense files carry their own terms [U].

### 3.8 Ensembl REST

```bash
H='Content-Type: application/json'
curl -s -H "$H" 'https://rest.ensembl.org/lookup/id/ENSG00000010671?expand=1;mane=1'   # 123 KB, 3.5 s, 39 transcripts
curl -s -H "$H" 'https://rest.ensembl.org/lookup/symbol/homo_sapiens/BTK'              # 0.8 s
curl -s -H "$H" 'https://rest.ensembl.org/lookup/id/ENST00000308731?expand=1;mane=1'   # 0.8 s
curl -s -H "$H" 'https://rest.ensembl.org/xrefs/id/ENSG00000010671?external_db=HGNC'
curl -s -H "$H" 'https://rest.ensembl.org/sequence/id/ENSP00000308176?type=protein'
# VEP, single HGVS (1.4 s)
curl -s -H "$H" 'https://rest.ensembl.org/vep/human/hgvs/ENST00000308731.8:c.1574G%3EA?mane=1&canonical=1&hgvs=1&protein=1&uniprot=1&numbers=1&domains=1&AlphaMissense=1&CADD=1&REVEL=1&variant_class=1'
# VEP, batch
curl -s -X POST -H "$H" -H 'Accept: application/json' 'https://rest.ensembl.org/vep/human/hgvs' -d '{"hgvs_notations":["ENST00000308731.8:c.1574G>A","ENST00000308731.8:c.1084C>T"],"mane":1,"hgvs":1,"AlphaMissense":1}'
```

- Gene: `id`, `version` (20), `display_name`, `description`, `biotype`, `seq_region_name`, `start`, `end`, `strand`, `assembly_name`, `canonical_transcript` (`ENST00000308731.8`), `Transcript[]`.
- Transcript: `id`, `version`, `display_name`, `biotype`, `is_canonical`, `length`, `Exon[]`, `Translation{id,version,length,start,end}`, `MANE[]{type:"MANE_Select",refseq_match:"NM_000061.3"}`. Exactly one BTK transcript has a non-empty `MANE`.
- VEP: `input`, `assembly_name`, `seq_region_name`, `start`, `end`, `strand`, `allele_string`, `variant_class`, `most_severe_consequence`, `transcript_consequences[]{transcript_id,gene_id,hgnc_id,consequence_terms[],impact,amino_acids,codons,protein_start,hgvsc,hgvsp,exon,mane[],mane_select,canonical,swissprot[],uniprot_isoform[],sift_prediction,sift_score,polyphen_score,cadd_phred,revel,alphamissense{am_pathogenicity,am_class},domains[]}`.
- R525Q MANE row: `hgvsp ENSP00000308176.8:p.Arg525Gln`, exon 16/19, SIFT deleterious 0, PolyPhen 0.878, CADD 32, REVEL 0.911, AlphaMissense 0.9976 `likely_pathogenic`. 35 transcript consequences returned; filter on `mane_select`.
- Accepted HGVS inputs: `ENST…:c.`, `NM_…:c.` (add `refseq=1`), `ENSP…:p.`, `BTK:p.Arg525Gln` (works, 8.2 s). `variant_recoder/human/rs128620183` took 6.9 s.
- Transcript-relative input reports `strand:-1` and `allele_string "G/A"`; ClinVar and gnomAD use the plus strand (`C>T`). Normalise before joining.
- **Rate limit headers**: `x-ratelimit-limit: 55000`, `x-ratelimit-period: 3600`, `x-ratelimit-remaining`, `x-ratelimit-reset`. Over limit → 429 with `Retry-After` in seconds (float) [D].
- **Failures**: 400 `{"error":"ID '…' not found"}`; 400 with a parse message when the HGVS reference allele mismatches; HTTP 200 `text/html` when no JSON content type is requested.
- Version drift seen today: UniProt xref says `ENSG00000010671.19` and `ENST00000621635.4`; Ensembl 116 serves `.20` and `.5`. Store unversioned IDs plus the version separately.

### 3.9 InterPro

```bash
curl -s 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/Q06187?page_size=200'   # 49 entries, 27 KB, 0.7 s
curl -s 'https://www.ebi.ac.uk/interpro/api/entry/interpro/protein/uniprot/Q06187'            # 15 integrated entries
curl -s 'https://www.ebi.ac.uk/interpro/api/protein/uniprot/Q06187?residues'                  # per-residue site annotations
curl -s 'https://www.ebi.ac.uk/interpro/api/entry/interpro/IPR000719'                         # entry detail
```

- List: `count`, `next`, `previous`, `results[]{metadata{accession,name,source_database,type,integrated,member_databases,go_terms[]},proteins[]{accession,protein_length,entry_protein_locations[]{fragments[]{start,end,"dc-status"},model,score,representative}}}`.
- BTK InterPro types: domain 7, homologous_superfamily 4, family 1 (`IPR050198`), active_site 1, binding_site 1, conserved_site 1. Member DB hits: Pfam 5, SMART 5, PROSITE profiles 5, CDD 4, CATH-Gene3D 4, SUPERFAMILY 4, PRINTS 4, PROSITE patterns 2, PANTHER 1.
- Example: `IPR000719` Protein kinase domain 402–655; `IPR001849` PH domain 3–135; `IPR000980` SH2 279–377; `IPR001452` SH3 214–274.
- `?residues` returns CDD site sets, e.g. `cd05113` "active site" with `fragments[]{residues,start,end}`.
- Protein metadata `counters.structures` = 170, matching RCSB and PDBe.
- **Pagination**: `page_size` and a `next` URL containing `cursor=`; follow `next` until null. `page_size=201` was accepted.
- **Headers**: `interpro-version: 110.0`, `cached: true`.
- **Failures**: no data → 204 (see 1.2). Long-running queries are documented to return 408 with retry [U].

### 3.10 Open Targets Platform GraphQL

```bash
OT=https://api.platform.opentargets.org/api/v4/graphql
curl -s -X POST -H 'Content-Type: application/json' $OT -d '{"query":"{ meta { apiVersion{x y z} dataVersion{year month} } }"}'
curl -s -X POST -H 'Content-Type: application/json' $OT -d '{"query":"query T($id:String!){ target(ensemblId:$id){ id approvedSymbol approvedName biotype functionDescriptions proteinIds{id source} canonicalTranscript{id chromosome start end strand} tractability{modality label value} geneticConstraint{constraintType oe oeLower oeUpper score} pathways{pathwayId pathway topLevelTerm} associatedDiseases(page:{index:0,size:5}){ count rows{ score disease{id name dbXRefs} datatypeScores{id score} } } drugAndClinicalCandidates{ count rows{ id maxClinicalStage drug{ id name drugType maximumClinicalStage mechanismsOfAction{ rows{ mechanismOfAction actionType targetName } } } } } interactions(sourceDatabase:intact, page:{index:0,size:3}){ count rows{ intA intB score count targetB{id approvedSymbol} } } } }","variables":{"id":"ENSG00000010671"}}'
curl -s -X POST -H 'Content-Type: application/json' $OT -d '{"query":"{ disease(efoId:\"MONDO_0010421\"){ id name description dbXRefs therapeuticAreas{id name} phenotypes(page:{index:0,size:4}){ count rows{ phenotypeHPO{id name} evidence{frequency resource evidenceType diseaseFromSourceId references} } } associatedTargets(page:{index:0,size:3}){ count rows{ score target{id approvedSymbol} } } } }"}'
curl -s -X POST -H 'Content-Type: application/json' $OT -d '{"query":"{ drug(chemblId:\"CHEMBL1873475\"){ id name drugType maximumClinicalStage crossReferences{source ids} mechanismsOfAction{ rows{ mechanismOfAction actionType targetName references{source ids urls} } } indications{ count rows{ maxClinicalStage disease{id name} } } } }"}'
```

- BTK target (42 KB, 0.31 s): `associatedDiseases.count` 901, top `MONDO_0010421` score 0.857 with `genetic_association` 0.949; `drugAndClinicalCandidates.count` 24 (stages: APPROVAL 6, PHASE_4 4, PHASE_3 4, PHASE_2 7, PREAPPROVAL 1, PHASE_1_2 1, PHASE_1 1); `interactions(intact).count` 111; `pathways` 14.
- Tractability: 28 rows of `{modality (SM, AB, PR, OC), label, value}`. True for BTK: SM Approved Drug, Structure with Ligand, High-Quality Ligand, High-Quality Pocket, Druggable Family; PR Phase 1 Clinical, Small Molecule Binder, and others.
- `geneticConstraint` mirrors gnomAD (`lof` oe 0.087, `mis` oe 0.387).
- Disease: `dbXRefs[]` contains `Orphanet:47`, `OMIM:300755`; `phenotypes.count` 46; phenotype evidence has `frequency` (`"1/19"`), `evidenceType` (`PCS`, `IEA`), `references[]`.
- Drug: ibrutinib `maximumClinicalStage APPROVAL`, `indications.count` 61, `crossReferences` drugbank `DB09053`.
- `mapIds(queryTerms:["BTK","Q06187"],entityNames:["target"])` resolves both to `ENSG00000010671`.
- **Pagination**: `page:{index,size}` on list fields; `count` alongside `rows`. `evidences` and `literatureOcurrences` use `cursor`.
- **Failures**: schema error → HTTP 400 with `errors[]`; unknown ID → 200 `{"data":{"target":null}}`.
- **License**: CC0 1.0; citation of the latest Open Targets paper requested [D]. API release 26.9.0 published 21 Sep 2026 [D].

### 3.11 ChEMBL REST

```bash
C=https://www.ebi.ac.uk/chembl/api/data
curl -s "$C/status.json"
curl -s "$C/target.json?target_components__accession=Q06187&target_type=SINGLE%20PROTEIN&only=target_chembl_id,pref_name,target_type,organism"   # CHEMBL5251
curl -s "$C/mechanism.json?target_chembl_id=CHEMBL5251&limit=100"                     # 22 mechanisms
curl -s "$C/activity.json?target_chembl_id=CHEMBL5251&pchembl_value__gte=8&standard_type__in=IC50,Ki,Kd&assay_type=B&limit=5&order_by=-pchembl_value"   # 6,970 of 61,850
curl -s "$C/molecule/CHEMBL1873475.json"
curl -s "$C/molecule.json?molecule_chembl_id__in=CHEMBL1873475,CHEMBL3707348,CHEMBL3936761&only=molecule_chembl_id,pref_name,max_phase,first_approval"
curl -s "$C/drug_indication.json?molecule_chembl_id=CHEMBL1873475&limit=3"            # 49 indications
```

- Without `target_type` the accession query returns 11 targets (single protein, protein family, protein-protein interaction). Filter to `SINGLE PROTEIN`.
- Mechanism: `mec_id`, `molecule_chembl_id`, `parent_molecule_chembl_id`, `target_chembl_id`, `action_type`, `mechanism_of_action`, `mechanism_comment`, `binding_site_comment`, `direct_interaction`, `disease_efficacy`, `max_phase`, `site_id`, `mechanism_refs[]{ref_type,ref_id,ref_url}`, `variant_sequence`.
- Activity: `activity_id`, `molecule_chembl_id`, `canonical_smiles`, `standard_type`, `standard_relation`, `standard_value`, `standard_units`, `pchembl_value`, `assay_chembl_id`, `assay_type`, `assay_description`, `assay_variant_accession`, `assay_variant_mutation`, `document_chembl_id`, `document_year`, `data_validity_comment`, `potential_duplicate`, `src_id`.
- Molecule: `pref_name`, `max_phase`, `first_approval`, `molecule_type`, `oral`, `black_box_warning`, `withdrawn_flag`, `molecule_structures{canonical_smiles,standard_inchi,standard_inchi_key}`, `molecule_properties{full_mwt,alogp,hba,hbd,psa,rtb,num_ro5_violations,qed_weighted}`, `atc_classifications[]`, `molecule_synonyms[]`, `cross_references[]`.
- Type inconsistency: `max_phase` is `"4.0"` (string) on molecule, `4` (number) on mechanism; `max_phase_for_ind` is `"1.0"`. Numeric activity values are strings.
- **Pagination**: `page_meta{limit,offset,total_count,next,previous}`; default `limit` 20, capped at 1000 (`limit=5000` → 1000).
- **Filters**: Django-style suffixes `__in`, `__gte`, `__lte`, `__icontains`; `only=` projects fields; `order_by=-field`.
- **Failures**: 404 with empty body for an unknown ID; unknown filters ignored; XML unless `.json` or `format=json`.
- **License**: CC BY-SA 3.0 Unported [D]. Share-alike applies to redistributed derived data; keep ChEMBL-derived fields separable.

### 3.12 PubChem PUG REST

```bash
P=https://pubchem.ncbi.nlm.nih.gov/rest/pug
curl -s "$P/compound/name/ibrutinib/cids/JSON"                                        # {"IdentifierList":{"CID":[24821094]}}
curl -s "$P/compound/inchikey/XYFPWWZEPKGCCK-GOSISDBHSA-N/cids/JSON"
curl -s "$P/compound/cid/24821094/property/Title,MolecularFormula,MolecularWeight,SMILES,ConnectivitySMILES,InChI,InChIKey,IUPACName,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,Charge/JSON"
curl -s -X POST -d 'cid=24821094,71226662,135565884' "$P/compound/cid/property/Title,InChIKey,MolecularWeight/JSON"
curl -s "$P/compound/cid/24821094/SDF?record_type=3d"
curl -s "$P/compound/cid/24821094/synonyms/JSON"
curl -s "$P/protein/accession/Q06187/aids/JSON"                                       # 1881 assay ids
curl -s 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/24821094/JSON?heading=Drug+Indication'
```

- Property table: `PropertyTable.Properties[]{CID,Title,MolecularFormula,MolecularWeight (string),SMILES,ConnectivitySMILES,InChI,InChIKey,IUPACName,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,Charge}`.
- Join key with ChEMBL: `InChIKey` (ibrutinib `XYFPWWZEPKGCCK-GOSISDBHSA-N` matches ChEMBL `standard_inchi_key`).
- `description/JSON` returns `InformationList.Information[]{Description,DescriptionSourceName}`; first element holds only `Title`.
- **Header**: `x-throttling-control: Request Count status: Green (0%), Request Time status: Green (0%), Service status: Green (13%)`. Back off on Yellow or Red.
- **Limits**: 5 requests/second, 400 requests/minute, 300 s running time/minute; over limit → 503 [S].
- **Failures**: 404 `{"Fault":{"Code":"PUGREST.NotFound","Message":"No CID found",…}}`. `xrefs/PatentID` took 8.6 s (22,319 patent IDs); avoid on the request path.

### 3.13 Europe PMC and PubMed

```bash
EP=https://www.ebi.ac.uk/europepmc/webservices/rest
curl -s "$EP/search?query=(GENE_PROTEIN:BTK%20OR%20UNIPROT_PUBS:Q06187)%20AND%20%22X-linked%20agammaglobulinemia%22%20AND%20SRC:MED&format=json&resultType=core&pageSize=5&cursorMark=*&sort=CITED%20desc"   # hitCount 65
curl -s "$EP/search?query=EXT_ID:9218782%20AND%20SRC:MED&format=json&resultType=lite"
curl -s "$EP/search?query=UNIPROT_PUBS:Q06187%20AND%20HAS_ABSTRACT:y&format=json&resultType=idlist&pageSize=1000"   # hitCount 69
curl -s "$EP/PMC11694102/fullTextXML"                                                   # OA only
curl -s 'https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByArticleIds?articleIds=MED:9218782&type=Gene_Proteins&format=JSON'
# PubMed (E as in 3.3)
E=https://eutils.ncbi.nlm.nih.gov/entrez/eutils
curl -s "$E/esearch.fcgi?db=pubmed&term=BTK%5BTitle%2FAbstract%5D+AND+%22agammaglobulinemia%22%5BMeSH+Terms%5D+AND+hasabstract&retmode=json&retmax=5&sort=relevance"   # count 388
curl -s "$E/esummary.fcgi?db=pubmed&id=9218782,8425221&retmode=json"
curl -s "$E/efetch.fcgi?db=pubmed&id=9218782&rettype=abstract&retmode=xml"
```

- Europe PMC envelope: `version`, `hitCount`, `nextCursorMark`, `nextPageUrl`, `resultList.result[]`.
- `core` result: `id`, `source`, `pmid`, `pmcid`, `doi`, `title`, `authorString`, `authorList`, `journalInfo.journal.title`, `pubYear`, `firstPublicationDate`, `abstractText`, `pubTypeList.pubType[]`, `meshHeadingList`, `citedByCount`, `isOpenAccess`, `inEPMC`, `inPMC`, `hasPDF`, `hasTextMinedTerms`, `hasDbCrossReferences`, `license`, `fullTextUrlList.fullTextUrl[]{availabilityCode,documentStyle,site,url}`.
- **Abstract availability**: Europe PMC query filter `HAS_ABSTRACT:y`, or presence of `abstractText` in `core`. PubMed: `hasabstract` in the search term, or `attributes:["Has Abstract"]` in `esummary`.
- Useful fields: `UNIPROT_PUBS:Q06187` (75 hits), `ACCESSION_ID:Q06187` (79), `GENE_PROTEIN:BTK` (249, text-mined), `OPEN_ACCESS:y`, `SRC:MED`, `EXT_ID:{pmid}`.
- **Pagination**: `cursorMark=*` then `nextCursorMark`; `pageSize` 1–1000, default 25.
- PubMed `esummary`: `title`, `pubdate`, `source`, `fulljournalname`, `authors[].name`, `volume`, `issue`, `pages`, `articleids[]{idtype,value}` (pubmed, pmc, doi), `pubtype[]`, `attributes[]`. `efetch` XML: `<AbstractText>`, `<ArticleId IdType="doi">`.
- **Failures**: Europe PMC errors arrive as HTTP 200 `{"errCode":404,"errMsg":…}`; non-OA `fullTextXML` → 500.
- **Reuse**: Europe PMC permits use of its APIs, including commercial; content copyright stays with rights holders and OA licences vary per article (`license` field, e.g. `cc by-nc`) [S].

### 3.14 STRING

```bash
S=https://string-db.org/api
curl -s "$S/json/version"                                                              # 12.5
curl -s "$S/json/get_string_ids?identifiers=Q06187&species=9606&limit=1&echo_query=1&caller_identity=orphafold"   # 9606.ENSP00000483570
curl -s "$S/json/interaction_partners?identifiers=9606.ENSP00000483570&species=9606&limit=10&required_score=700&network_type=physical&caller_identity=orphafold"
curl -s -X POST -d 'identifiers=BTK%0dWAS%0dJAK3&species=9606&limit=2&caller_identity=orphafold' "$S/json/interaction_partners"
curl -s "$S/json/network?identifiers=BTK%0dPLCG2%0dBLNK%0dSYK%0dLYN&species=9606&caller_identity=orphafold"
curl -s "$S/image/network?identifiers=9606.ENSP00000483570&species=9606&add_white_nodes=10" -o net.png
```

- Partner row: `stringId_A`, `stringId_B`, `preferredName_A`, `preferredName_B`, `ncbiTaxonId`, `score` (combined, 0–1), `nscore` (neighbourhood), `fscore` (fusion), `pscore` (phylogenetic), `ascore` (coexpression), `escore` (experimental), `dscore` (database), `tscore` (text mining).
- BTK top physical partners ≥0.7: BLNK 0.999 (`escore` 0.999), GTF2I 0.999, PLCG2 0.984.
- `required_score` is 0–1000; `network_type` is `functional` (default) or `physical`. Multiple identifiers separated by `%0d`.
- `functional_annotation` returns 1,048 rows for BTK (218 KB, 5.6 s) across GO, KEGG, Reactome, HPO, DISEASES.
- **Etiquette**: one second between calls, `caller_identity`, POST preferred, pin `https://version-12-5.string-db.org` for reproducibility [D]. `https://version-12-0.string-db.org` still serves 12.0.
- **Failures**: 404 with JSON `Error` + `ErrorMessage` (HTML inside the message) for unknown identifiers.
- **License**: CC BY 4.0 [D]. The version history page lists 12.5 as "current: since September 29, 2026".
- STRING's BTK protein is the 693-residue isoform; residue positions do not transfer to UniProt canonical numbering.

### 3.15 Reactome Content Service

```bash
R=https://reactome.org/ContentService
curl -s "$R/data/database/version"                                                     # 97
curl -s -H 'Accept: application/json' "$R/data/mapping/UniProt/Q06187/pathways?species=9606"   # 14 pathways, 0.9 s
curl -s -H 'Accept: application/json' "$R/data/mapping/UniProt/Q06187/reactions?species=9606"  # 46 reactions
curl -s -H 'Accept: application/json' "$R/data/query/R-HSA-983695"                     # detail, 40 KB
curl -s -H 'Accept: application/json' "$R/data/event/R-HSA-983695/ancestors"
curl -s "$R/exporter/diagram/R-HSA-983695.svg?flg=BTK" -o pathway.svg                  # 1.1 MB
```

- Pathway row: `stId`, `stIdVersion`, `displayName`, `speciesName`, `schemaClass`, `isInDisease`, `isInferred`, `hasDiagram`, `hasEHLD`, `releaseDate`, `doi`, `dbId`.
- Detail: `summation[].text`, `literatureReference[].pubMedIdentifier`, `hasEvent[]`, `goBiologicalProcess`.
- Ancestors: array of paths, leaf to root (`R-HSA-983695` → `R-HSA-983705` → `R-HSA-1280218` Adaptive Immune System → `R-HSA-168256` Immune System).
- 4 of BTK's 14 pathways have `isInDisease:true`; surface that flag.
- `search/query?query=Q06187&species=Homo%20sapiens&types=Protein&cluster=true` returns the Reactome entity `R-HSA-197948`; highlighted fields contain HTML `<span>` tags.
- **Failures**: 404 `{"code":404,"reason":"NOT_FOUND","messages":["No pathways found for UniProt:…"]}`.
- **License**: data CC0; pathway illustrations CC BY 4.0 [D]. No pagination on mapping endpoints.

### 3.16 IntAct

```bash
curl -s 'https://www.ebi.ac.uk/intact/ws/interaction/findInteractions/Q06187?page=0&pageSize=5'   # 841 KB, 2.6 s, totalElements 181
curl -s -X POST 'https://www.ebi.ac.uk/intact/ws/interaction/findInteractionWithFacet' -d 'query=Q06187&page=0&pageSize=2&minMIScore=0.45&maxMIScore=1&interactorSpeciesFilter=Homo sapiens&intraSpeciesFilter=true'   # 61 rows
curl -s 'https://www.ebi.ac.uk/intact/ws/interactor/findInteractor/Q06187?page=0&pageSize=3'
# PSICQUIC, lean MITAB
curl -s 'https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search/interactor/Q06187?format=count'   # 104
curl -s 'https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search/query/id:Q06187%20AND%20species:9606?format=tab27&firstResult=0&maxResults=200'
```

- `findInteractions` is a Spring page: `content[]`, `totalElements`, `totalPages`, `number`, `size`, `last`. Payload is about 170 KB per row; page size 20 or lower, or use PSICQUIC.
- Row: `ac` (`EBI-625174`), `binaryInteractionId`, `uniqueIdA`, `uniqueIdB`, `moleculeA`, `moleculeB`, `taxIdA`, `taxIdB`, `type`, `typeMIIdentifier`, `detectionMethod`, `detectionMethodMIIdentifier`, `hostOrganism`, `expansionMethod`, `intactMiscore`, `publicationPubmedIdentifier`, `sourceDatabase`, `negative`, `mutationA`, `mutationB`, `affectedByMutation`, `featuresA`, `featuresB`.
- Results include isoform IDs (`Q06187-1`) and non-protein interactors (`CHEBI:60924`, `taxIdA:-2`). Filter by `uniqueId` prefix and `taxId`.
- `mutationB:true` / `affectedByMutation:true` flag interactions measured with mutant BTK; valuable for variant-mechanism hypotheses.
- `findInteractionWithFacet` returns `{data{content[],totalElements},recordsFiltered,recordsTotal}`.
- MITAB 2.7 columns used: 1–2 IDs, 7 detection method, 9 publication IDs, 12 interaction type, 13 source DB, 14 interaction ID, 15 `intact-miscore:0.62`, 28 annotations.
- **Failures**: unknown query → 200 with `content:[]`.
- **License**: CC BY 4.0 [S].

### 3.17 gnomAD GraphQL

```bash
G=https://gnomad.broadinstitute.org/api
curl -s -X POST -H 'Content-Type: application/json' $G -d '{"query":"query G($sym:String!){ meta{clinvar_release_date} gene(gene_symbol:$sym, reference_genome:GRCh38){ gene_id symbol hgnc_id omim_id chrom start stop strand canonical_transcript_id mane_select_transcript{ensembl_id ensembl_version refseq_id refseq_version} gnomad_constraint{exp_lof obs_lof oe_lof oe_lof_lower oe_lof_upper pLI lof_z exp_mis obs_mis oe_mis mis_z flags} variants(dataset:gnomad_r4){ variant_id pos ref alt rsids consequence hgvsc hgvsp transcript_id lof flags exome{ac an af homozygote_count hemizygote_count filters} genome{ac an af homozygote_count hemizygote_count filters} } clinvar_variants{ variant_id clinvar_variation_id clinical_significance gold_stars review_status major_consequence hgvsc hgvsp pos in_gnomad } } }","variables":{"sym":"BTK"}}'   # 1.06 MB, 1.7 s
curl -s -X POST -H 'Content-Type: application/json' $G -d '{"query":"{ variant(variantId:\"X-101349900-C-T\", dataset:gnomad_r4){ variant_id rsids exome{ac an af hemizygote_count faf95{popmax popmax_population} populations{id ac an}} joint{ac an} transcript_consequences{gene_symbol transcript_id is_mane_select major_consequence hgvsc hgvsp} in_silico_predictors{id value flags} } }"}'
```

- BTK: 2,335 variants (missense 307, synonymous 212, stop_gained 5, frameshift 8); 823 ClinVar variants; constraint `pLI` 1.0, `oe_lof` 0.087 (0.046–0.183), `obs_lof` 5 / `exp_lof` 57.4, `mis_z` 5.85.
- `clinvar_variants[]` gives `gold_stars` (0–4) and `in_gnomad`; R525Q (`X-101354687-C-T`, variation 11342) has `gold_stars:2`, `in_gnomad:false`.
- Variant ID format `CHROM-POS-REF-ALT`, 1-based, plus strand. ClinVar SPDI position is 0-based (`101354686`).
- X-linked genes: use `hemizygote_count`.
- `in_silico_predictors[]{id,value}` ids seen: `cadd`, `revel_max`, `spliceai_ds_max`, `pangolin_largest_ds`, `phylop`, `sift_max`, `polyphen_max`. SpliceAI values carry a non-commercial licence [S].
- Dataset enum: `gnomad_r4`, `gnomad_r4_non_ukb`, `gnomad_r3`, `gnomad_r3_*`, `gnomad_r2_1`, `gnomad_r2_1_*`, `exac`. Reference genome enum: `GRCh37`, `GRCh38`.
- **Failures**: absent variant → HTTP 200 `{"errors":[{"message":"Variant not found"}],"data":{"variant":null}}`.
- **Limit**: 10 requests per IP per 60 s [S]. Fetch one gene-level payload and cache it; never query per variant in a loop.
- No pagination; gene queries return the full variant list.

### 3.18 Monarch v3 and JAX HPO

```bash
M=https://api-v3.monarchinitiative.org/v3/api
curl -s "$M/entity/HGNC:1133"                                                                          # gene node + association_counts
curl -s "$M/association?subject=HGNC:1133&category=biolink:GeneToPhenotypicFeatureAssociation&limit=50&offset=0"   # total 65
curl -s "$M/association?subject=HGNC:1133&category=biolink:CausalGeneToDiseaseAssociation&limit=10"                # MONDO:0010421, MONDO:0010615
curl -s "$M/association?subject=MONDO:0010421&category=biolink:DiseaseToPhenotypicFeatureAssociation&limit=50"     # total 71
curl -s "$M/entity/MONDO:0010421"                                                                      # description, inheritance, causal_gene
curl -s "$M/mappings?entity_id=Orphanet:47&limit=5"                                                    # MONDO:0010421 skos:exactMatch Orphanet:47
curl -s "$M/search?q=X-linked%20agammaglobulinemia&category=biolink:Disease&limit=3"
# JAX HPO
J=https://ontology.jax.org/api
curl -s "$J/hp/terms/HP:0004432"
curl -s "$J/network/annotation/NCBIGene:695"      # 3 diseases, 77 phenotypes
curl -s "$J/network/annotation/OMIM:300755"       # categories, genes, medicalActions
curl -s "$J/network/annotation/ORPHA:47"
curl -s "$J/hp/search?q=agammaglobulinemia&page=0&limit=3"
curl -s "$J/network/search/gene?q=BTK&limit=3"
```

- Monarch association: `subject`, `subject_label`, `predicate`, `object`, `object_label`, `category`, `primary_knowledge_source` (`infores:hpo-annotations`, `infores:orphanet`, `infores:omim`, `infores:mondo`), `aggregator_knowledge_source[]`, `provided_by`, `publications[]`, `has_evidence`, `frequency_qualifier_label`, `has_count`, `has_total`, `has_percentage`, `onset_qualifier_label`, `disease_context_qualifier` (e.g. `OMIM:300755`), `original_subject`, `negated`.
- Example: BTK → `HP:0002783` Recurrent lower respiratory tract infections, 19/22 (86.4 %), `PMID:30072168`, context `OMIM:300755`.
- Entity (disease): `description`, `xref[]`, `inheritance{id:"HP:0001419",name:"X-linked recessive inheritance"}`, `causal_gene[]`, `association_counts[]{label,count}`.
- Monarch IDs are CURIEs with source prefixes (`HGNC:`, `MONDO:`, `HP:`). `entity/Orphanet:47` → 404; go through `/mappings`.
- **Pagination**: `limit`, `offset`, `total`. **Failures**: 404 `{"detail":"Entity not found"}`. KG release list: `/releases?limit=2` → `2026-09-02`.
- JAX gene annotation: `{diseases[]{id,name,mondoId},phenotypes[]{id,name}}`. Disease annotation: `{disease{id,name,mondoId,description},genes[],categories{"Immunology":[{id,name,metadata{frequency,onset,sex,sources[]}}],…},medicalActions[]}`.
- JAX accepts `NCBIGene:`, `OMIM:`, `ORPHA:`, `HP:` prefixes. Unknown ID → HTTP 200 with empty arrays.
- **License**: HPO terms require acknowledgment and citation, display of the HPO version, and no alteration of content [D]. Monarch redistributes upstream sources under their own terms, including OMIM-derived annotations [S].

### 3.19 Orphadata API

```bash
O=https://api.orphadata.com
curl -s "$O/rd-cross-referencing/orphacodes/47?lang=en"        # definition, synonyms, xrefs
curl -s "$O/rd-cross-referencing/omims/300755?lang=en"         # OMIM → ORPHA (2 results)
curl -s "$O/rd-associated-genes/orphacodes/47"                 # disease → genes
curl -s "$O/rd-associated-genes/genes/symbols/btk"             # gene → diseases (lowercase symbol): 47, 632
curl -s "$O/rd-phenotypes/orphacodes/47"                       # 35 HPO terms with frequency
curl -s "$O/rd-natural_history/orphacodes/47"                  # inheritance, age of onset
curl -s "$O/rd-epidemiology/orphacodes/47"                     # 19 prevalence rows
curl -s "$O/rd-classification/orphacodes/47/hchids"
curl -s "$O/openapi.json"                                      # 32 paths
```

- Envelope: `{data{__count,__licence{identifier:"CC-BY-4.0",…},results},datasetCategory,parameters,uri}`. `results` is an object for a single ORPHA code and an array for list lookups.
- Cross-referencing: `ORPHAcode`, `"Preferred term"`, `Synonym[]`, `Typology`, `DisorderGroup`, `Date`, `OrphanetURL`, `SummaryInformation[].Definition`, `ExternalReference[]{Source,Reference,DisorderMappingRelation,DisorderMappingValidationStatus}` (ORPHA:47 → `MONDO:0010421` E, `OMIM:300755` E, `OMIM:300310` BTNT, `ICD-10:D80.0` NTBT, `ICD-11:4A01.00`).
- Genes: `DisorderGeneAssociation[]{DisorderGeneAssociationType,DisorderGeneAssociationStatus,SourceOfValidation ("20301626[PMID]"),Gene{Symbol,name,GeneType,Locus[],ExternalReference[]{Source,Reference}}}` with HGNC, Ensembl, SwissProt, OMIM references.
- Phenotypes: `Disorder.HPODisorderAssociation[]{HPO{HPOId,HPOTerm},HPOFrequency ("Very frequent (99-80%)"),DiagnosticCriteria}`, plus `ValidationDate`, `ValidationStatus`.
- Natural history: `TypeOfInheritance[]` (`["X-linked recessive"]`), `AverageAgeOfOnset[]` (`["Childhood"]`).
- Epidemiology: `Prevalence[]{PrevalenceType,PrevalenceClass,PrevalenceGeographic,PrevalenceQualification,ValMoy,Source,PrevalenceValidationStatus}`.
- JSON keys contain spaces (`"Preferred term"`); map them explicitly in Pydantic models.
- **Failures**: 404 `{"error":{"code":404,"message":"message to define","type":"Query not found"}}` for unknown codes; 404 problem+json for unknown routes.
- **Bulk alternative**: `https://www.orphadata.com/data/xml/en_product6.xml` (genes, 22.6 MB, modified 29 Jun 2026), `en_product4.xml` (phenotypes), `en_product1.xml` (cross-references), `en_product9_ages.xml` (natural history). All returned 200.
- **Attribution**: CC BY 4.0; credit Orphanet/Orphadata with the data version date.

### 3.20 Supplementary sources tested

| Source     | Request [V]                                                                                                                                                                                                                                                                                                                              | Use                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HGNC REST  | `curl -H 'Accept: application/json' https://rest.genenames.org/fetch/hgnc_id/1133` (0.29 s) → `response.docs[0]{hgnc_id,symbol,name,status,location,alias_symbol[],prev_symbol[],entrez_id,ensembl_gene_id,uniprot_ids[],omim_id[],mane_select[],refseq_accession[],ccds_id[],lsdb[]}`; `/fetch/symbol/BTK`; `/search/prev_symbol/AGMX1` | Symbol resolution including previous symbols and aliases; `mane_select` = `["ENST00000308731.8","NM_000061.3"]`; `lsdb[]` links locus-specific databases (BTKbase, LOVD) |
| OLS4       | `https://www.ebi.ac.uk/ols4/api/ontologies/mondo/terms?obo_id=MONDO:0010421` (0.6 s); `…/ontologies/hp` → version `2026-09-01`                                                                                                                                                                                                           | Ontology term text, obsolescence flag, ontology version for HPO/MONDO attribution                                                                                        |
| 3D-Beacons | `https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/Q06187.json` (203 KB, 7.3 s) → `structures[].summary{model_identifier,model_category,provider,model_url,created,uniprot_start,uniprot_end,coverage,confidence_type,confidence_avg_local_score}`                                                                        | One list across PDBe 170, AlphaFold DB 1, SWISS-MODEL 8, SASBDB 8, Bindome 30, AlphaFill 1, isoform.io 1                                                                 |

---

## 4. BTK crosswalk used for adapter tests [V]

| ID space                     | Value                                                                                                                                      | Where confirmed               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| UniProt                      | `Q06187` (`BTK_HUMAN`), 659 aa, secondary `B2RAW1`, `Q32ML5`                                                                               | UniProt                       |
| HGNC / Entrez / Ensembl gene | `HGNC:1133` / `695` / `ENSG00000010671`                                                                                                    | HGNC, Datasets, Ensembl       |
| MANE Select                  | `ENST00000308731.8`, `NM_000061.3`, `ENSP00000308176.8`, `NP_000052.1`                                                                     | Ensembl, Datasets, UniProt    |
| Genomic (GRCh38)             | chrX:101,349,338–101,390,796, minus strand                                                                                                 | Ensembl 116                   |
| ChEMBL target                | `CHEMBL5251`                                                                                                                               | ChEMBL, UniProt xref          |
| STRING                       | `9606.ENSP00000483570`                                                                                                                     | STRING `get_string_ids`       |
| Reactome entity              | `R-HSA-197948`                                                                                                                             | Reactome search               |
| IntAct interactor            | `EBI-624835`                                                                                                                               | IntAct                        |
| AlphaFold DB                 | `AF-Q06187-F1` (v6), isoform `AF-Q06187-2-F1`                                                                                              | AlphaFold DB                  |
| Disease                      | `ORPHA:47` = `OMIM:300755` = `MONDO:0010421`; second disease `ORPHA:632` / `OMIM:307200` / `MONDO:0010615`                                 | Orphadata, Monarch, JAX       |
| Test variant                 | `NM_000061.3:c.1574G>A` p.Arg525Gln, ClinVar `VCV000011342`, `rs128620183`, SPDI `NC_000023.11:101354686:C:T`, gnomAD id `X-101354687-C-T` | ClinVar, VEP, gnomAD          |
| Test structure               | `5P9J` (1.08 Å, residues 382–659, ligand `8E8`); `1BTK` (PH domain, R28C)                                                                  | RCSB, PDBe                    |
| Test drug                    | ibrutinib `CHEMBL1873475`, PubChem CID `24821094`, DrugBank `DB09053`                                                                      | ChEMBL, PubChem, Open Targets |

---

## 5. Adapter rules derived from the tests

| Concern              | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release capture      | UniProt `x-uniprot-release`; InterPro `interpro-version`; Datasets `x-datasets-version`; Ensembl `/info/data` + `/info/software`; Open Targets `meta.dataVersion`; ChEMBL `/status.json`; Reactome `/data/database/version`; STRING `/json/version`; ClinVar `einfo` `lastupdate`; gnomAD dataset id + `meta.clinvar_release_date`; AlphaFold `latestVersion` + `modelCreatedDate`; Monarch `/releases`; Europe PMC `version`; Orphadata `results.Date`; HPO/MONDO via OLS4 `config.version` |
| Timeouts             | 10 s default; 30 s for ChEMBL, Ensembl `expand=1`, VEP by gene symbol, 3D-Beacons, STRING `functional_annotation`                                                                                                                                                                                                                                                                                                                                                                            |
| Retries              | Retry 429/502/503/504 with backoff and honour `Retry-After` (NCBI sends 2 s; Ensembl sends float seconds). Do not retry 400/404                                                                                                                                                                                                                                                                                                                                                              |
| Client-side limiters | NCBI 3/s without key; STRING 1/s; gnomAD 10/min; PubChem 5/s; Ensembl 15/s; Datasets 5/s                                                                                                                                                                                                                                                                                                                                                                                                     |
| Empty results        | 204 (InterPro, RCSB search), 404 (PDBe, Reactome, AlphaFold, Proteins API, Orphadata, STRING), 200 with empty list (IntAct, JAX HPO), 200 with `null` (Open Targets, gnomAD). Normalise all to an empty typed result                                                                                                                                                                                                                                                                         |
| Error-in-200         | Inspect `errors[]` (RCSB GraphQL, gnomAD), `errCode` (Europe PMC), `errorlist` (E-utilities) before parsing                                                                                                                                                                                                                                                                                                                                                                                  |
| Content negotiation  | HGNC returns XML without `Accept: application/json`; ChEMBL returns XML without `.json`; Ensembl returns HTML without `Content-Type: application/json` (or `?content-type=application/json`); Proteins API and Reactome returned JSON by default, send `Accept` anyway                                                                                                                                                                                                                       |
| Coordinates          | Keep three explicit systems: UniProt canonical residue number, entity/SEQRES index (`start`/`end`, `entity_beg_seq_id`), author residue number. Convert through SIFTS only                                                                                                                                                                                                                                                                                                                   |
| Payload size         | Use `fields=` (UniProt), `only=` (ChEMBL), PSICQUIC instead of IntAct JSON, gene-level gnomAD query once per gene                                                                                                                                                                                                                                                                                                                                                                            |
| Secrets and privacy  | NCBI 429 bodies contain the caller IP; never log response bodies from throttled calls                                                                                                                                                                                                                                                                                                                                                                                                        |
| Share-alike          | ChEMBL is CC BY-SA 3.0; store ChEMBL-derived fields with a source tag so exports can carry the licence                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 6. Unverified

- NCBI: 10 requests/second with `api_key`, POST for more than about 200 UIDs, `esearch` 10,000-record ceiling, `api-key` header for Datasets. No key was available and the NCBI documentation page returned a CAPTCHA to the fetcher.
- ClinVar data-use terms and the exact requested citation text.
- Numeric rate limits for UniProt, RCSB, PDBe, AlphaFold DB, InterPro, Open Targets, ChEMBL, Reactome, IntAct, Monarch, JAX HPO, Orphadata. Small sequential bursts (10–30 requests) succeeded on RCSB, AlphaFold DB, Open Targets, UniProt, STRING and gnomAD; no sustained load test was run.
- gnomAD limit of 10 requests/IP/60 s comes from a gnomAD news post surfaced by search; 12 sequential trivial queries were not throttled. The gnomAD policies page (CC0, re-identification ban) is JavaScript-rendered and was confirmed only through search summaries.
- PubChem limits (5/s, 400/min, 300 s/min, 503 on excess) come from the PUG-REST NAR paper via search; the official throttling page is JavaScript-rendered. The date of the SMILES property rename is unconfirmed.
- Europe PMC rate limit (a forum figure of 10 requests/second or 500/minute was neither confirmed nor denied by staff) and its documentation page (HTTP 403 to the fetcher).
- Ensembl VEP POST maximum batch size, and the InterPro 408 "query still running" behaviour; neither was observed today.
- IntAct CC BY 4.0 confirmed through the NAR 2022 paper and secondary listings; the IntAct licence page itself was not readable by the fetcher.
- Monarch API terms of use: no dedicated page found; per-source licensing is inferred from the Monarch 2024 paper and secondary sources. OMIM-derived content may carry Johns Hopkins terms.
- AlphaFold DB: which legacy prediction fields will be removed and when (the breaking-changes page returned HTTP 500); AlphaMissense file licence; reason for the 403 on `msaUrl`.
- Open Targets: the release in which `knownDrugs` was removed (third-party reports say 26.06); the 26.09 release-notes text was not retrieved.
- HGNC data licence, and licence terms for 3D-Beacons member providers.
- EMBL-EBI terms of use as they apply to Ensembl, PDBe and the Proteins API, and NLM terms for PubMed records; none of these pages was fetched today.
- STRING "current since September 29, 2026" is quoted from the version history page; the API reports only `12.5`.
- Behaviour of every source under an outage; no source was down during testing.

---

## 7. Sources

API hosts tested directly are listed in section 2. Documentation and secondary sources:

- UniProt licence and pagination help: https://rest.uniprot.org/help/license , https://rest.uniprot.org/help/pagination , https://rest.uniprot.org/help/api_queries
- EBI Proteins API docs: https://www.ebi.ac.uk/proteins/api/doc/
- NCBI E-utilities: https://www.ncbi.nlm.nih.gov/books/NBK25497/ ; NCBI Datasets: https://www.ncbi.nlm.nih.gov/datasets/docs/
- RCSB usage policy: https://www.rcsb.org/pages/usage-policy ; Search API: https://search.rcsb.org/redoc/index.html ; Data API: https://data.rcsb.org/redoc/index.html
- PDBe API: https://www.ebi.ac.uk/pdbe/api/doc/ ; 3D-Beacons: https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/
- AlphaFold DB release notes: https://www.ebi.ac.uk/pdbe/news/alphafold-database-release-notes ; breaking changes: https://www.ebi.ac.uk/pdbe/news/breaking-changes-afdb-predictions-api ; OpenAPI: https://alphafold.ebi.ac.uk/api/openapi.json ; NAR 2025 paper: https://academic.oup.com/nar/article/54/D1/D358/8340156
- Ensembl rate limits: https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits ; REST docs: https://rest.ensembl.org
- InterPro licence: https://interpro-documentation.readthedocs.io/en/latest/license.html
- Open Targets licence: https://platform-docs.opentargets.org/licence ; API release: https://github.com/opentargets/platform-api/releases/tag/v26.9.0 ; `knownDrugs` reports: https://github.com/nickzren/opentargets-mcp/issues/4 , https://rdrr.io/cran/otargen/f/NEWS.md
- ChEMBL licence: https://chembl.gitbook.io/chembl-interface-documentation/about ; API: https://www.ebi.ac.uk/chembl/api/data/docs
- PubChem throttling: https://pubchem.ncbi.nlm.nih.gov/docs/dynamic-request-throttling ; PUG-REST paper: https://academic.oup.com/nar/article/46/W1/W563/4990016 ; SMILES rename report: https://github.com/open-reaction-database/ord-schema/issues/954
- Europe PMC: https://europepmc.org/RestfulWebService , https://europepmc.org/Copyright , https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/cZLnV1JhCj8
- STRING API and licence: https://string-db.org/help/api/ , https://string-db.org/cgi/access
- Reactome licence: https://reactome.org/license ; Content Service: https://reactome.org/ContentService/
- IntAct: https://www.ebi.ac.uk/intact/ , https://academic.oup.com/nar/article/50/D1/D648/6425548 ; PSICQUIC registry: https://www.ebi.ac.uk/Tools/webservices/psicquic/registry/registry?action=STATUS&format=txt
- gnomAD: https://gnomad.broadinstitute.org/policies , https://gnomad.broadinstitute.org/news/2025-08-gnomad-2024-user-survey-results/ , https://discuss.gnomad.broadinstitute.org/t/blocked-when-using-api-to-get-af/149
- Monarch: https://api-v3.monarchinitiative.org/v3/docs , https://academic.oup.com/nar/article/52/D1/D938/7449493
- HPO licence: https://human-phenotype-ontology.github.io/license.html ; JAX ontology API: https://ontology.jax.org/api
- Orphadata: https://api.orphadata.com/ , https://www.orphadata.com/
- HGNC REST: https://www.genenames.org/help/rest/ ; OLS4: https://www.ebi.ac.uk/ols4/
