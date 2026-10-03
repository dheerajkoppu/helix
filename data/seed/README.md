# Seeded IEI dataset

`catalog.json` is the dataset the API loads at startup. It is generated; do not edit it by hand.

```
api/.venv/bin/python api/scripts/build_seed.py                 # resumes from data/.cache
api/.venv/bin/python api/scripts/build_seed.py --refresh all   # fetch every source again
api/.venv/bin/python api/scripts/build_seed.py --refresh clinvar --refresh europe_pmc
api/.venv/bin/python api/scripts/build_seed.py --offline       # cache only; uncached lookups become null
```

A cold build makes about 2,550 requests and takes about seven minutes, most of it waiting on the NCBI
limit of three requests per second. A warm build takes under ten seconds and makes no requests.

| File                   | Content                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `catalog.json`         | Manifest, categories, diseases, genes and flagship fixtures (the seed contract)            |
| `SOURCES.json`         | Every source with release, URL, licence, citation, checksum and retrieval time             |
| `build_report.json`    | Counts, mapping routes, IUIS numbers that were rejected, unmapped entries, null statistics |
| `../../ATTRIBUTION.md` | Human-readable licences and required citations, generated from the same records            |

## What a disease is

One disease record per IUIS row. The single row that names two genes ("Complete C4 deficiency",
C4A and C4B) becomes two records, so `counts.diseases` is `counts.entries` plus one.

- `id`: slug of the IUIS label without its parenthetical part. The gene symbol is appended only when
  rows share a label; inheritance (`-ar`, `-ad`), mechanism (`-dn`, `-haploinsufficiency`) or table
  follow when the gene does not separate them. Table 10 slugs end in `-phenocopy` because phenocopies
  reuse the names of the diseases they copy.
- `name`: the IUIS disease label. `aliases`: Orphanet preferred term and synonyms, Mondo label, exact
  synonyms and abbreviations. Mondo synonyms whose only provenance is OMIM are left out.
- `gene_symbol` and `hgnc_id` are `null` for 21 entries where IUIS names no gene (unknown cause,
  chromosomal deletions, autoantibody phenocopies). Somatic phenocopies carry the somatically mutated gene.
- `inheritance.raw` is the IUIS string. `inheritance.codes` uses `AR`, `AD`, `XL`, `XLR`, `DIGENIC`,
  `SPORADIC`, `SOMATIC`; an empty list means IUIS states none. `inheritance.hpo` holds the HPO term of
  each code.
- `mechanism`: `gain_of_function`, `loss_of_function`, `dominant_negative`, `haploinsufficiency`,
  `neomorph`, as stated by IUIS. Empty means IUIS states none.
- `xrefs`: CURIEs (`MONDO:0010421`, `ORPHA:47`, `OMIM:300755`). OMIM numbers are link-outs only and are
  always phenotype numbers. Lists are empty when no mapping route gave a single answer; nothing is guessed.
  The routes are described in `api/scripts/seed/mapping.py` and counted in `build_report.json`.
- `definition`: Orphanet definition of the mapped disorder, otherwise the Mondo definition, otherwise `null`.
- `phenotypes`: Orphanet annotations of the mapped disorder, then HPO annotations of the OMIM disease for
  terms Orphanet does not list. `frequency` is the source's own wording (an Orphanet band, an HPO
  frequency label, or a fraction such as `19/22`). Annotations marked excluded are left out.

No free-text clinical column of the IUIS tables is extracted or stored.

## What a gene is

Every HGNC gene named in an IUIS row: 508 in Tables 1 to 9 plus KRAS, NRAS and UBA1, which appear only
as somatic phenocopies in Table 10. Five genes are non-coding and have no protein.

- `protein_family` is the top level of UniProt's "Belongs to the ..." statement.
- `stats` are single-source values with one `retrieved_at`. `null` means there was no protein to query
  or the lookup failed; it never stands in for zero. Definitions are repeated in `build_report.json`.
  - `experimental_structure_count`: distinct PDB entries in PDBe SIFTS for the UniProt accession.
  - `has_alphafold_model`: AlphaFold DB has a model for the canonical accession. Proteins longer than
    2,700 residues have none.
  - `clinvar_total_count`, `clinvar_pathogenic_count`: ClinVar records for `SYMBOL[gene]`, and those
    classified pathogenic or likely pathogenic. Multi-gene copy-number variants are included, as on the
    ClinVar website.
  - `publication_count`: Europe PMC records for `UNIPROT_PUBS:<accession>`, the publications linked to
    the UniProtKB entry. It measures curated literature, not every paper that mentions the gene.

## Flagship fixtures

Thirteen genes with pathogenic missense variants taken from `api/scripts/seed/flagship.json`. The build
checks each variant against ClinVar (accession, HGVS protein change, gene) and against the UniProt
canonical sequence (reference residue), and fails when one no longer matches.
