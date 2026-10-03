# Evidence classes

Every statement OrphaFold shows is an `Evidence` record. The record names the class of the
statement, the source record behind it, and the source's own measure of strength. A language model
is never the source of a biological fact.

## The six classes

The class answers one question: what kind of thing can the reader go and check?

| Code   | Class                      | Meaning                                                                                                                   |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `EXP`  | `experimental`             | An experiment a person can go and check: a PDB entry, an assay, a UniProt annotation tagged with an experimental ECO code |
| `CLIN` | `clinical_database`        | A classification in a clinical database: ClinVar, ClinGen, Orphanet, HPO                                                  |
| `LIT`  | `literature`               | A published article identified by PMID, PMCID or DOI                                                                      |
| `CUR`  | `curated_database`         | An annotation from a curated database record: UniProt, Reactome, Mondo, Ensembl, ChEMBL mechanisms                        |
| `PRED` | `computational_prediction` | Output of a model or tool, external or run by OrphaFold                                                                   |
| `HYP`  | `orphafold_hypothesis`     | A statement authored inside OrphaFold by a person or the assistant                                                        |

In the interface each class has its own code, shape and border, so the classes can be told apart
without colour. A solid border marks a statement asserted by an external source, a dashed border
one computed by a model or tool, a dotted border one authored inside OrphaFold.

`GET /api/v1/meta` returns the classes with their codes and labels.

## How a record gets its class

`orphafold.evidence.classify_evidence(database, record_type, eco)` in `api/orphafold/evidence.py`
is a pure function over a fixed table. It fails closed: a source record the table does not cover
raises `UnmappedEvidence`, and the claim is left out of the response instead of being guessed.

Examples from the table:

| Source record                                      | Class                      | Strength scheme          |
| -------------------------------------------------- | -------------------------- | ------------------------ |
| RCSB PDB entry determined experimentally           | `experimental`             | `pdb_resolution`         |
| UniProt annotation tagged ECO:0000269              | `experimental`             | `uniprot_eco`            |
| UniProt annotation with another ECO code           | `curated_database`         | `uniprot_eco`            |
| ClinVar classification                             | `clinical_database`        | `clinvar_review_status`  |
| ClinGen gene-disease validity                      | `clinical_database`        | `clingen_gene_validity`  |
| Orphadata gene-disease association, HPO annotation | `clinical_database`        | none                     |
| Article cited by identifier                        | `literature`               | none                     |
| Reactome pathway, Mondo term, Ensembl transcript   | `curated_database`         | none                     |
| AlphaFold DB model, AlphaMissense score            | `computational_prediction` | `plddt`, `alphamissense` |
| Ensembl VEP consequence                            | `computational_prediction` | `vep_impact`             |
| Output of an OrphaFold job                         | `computational_prediction` | the provider's own       |
| Statement written in a project                     | `orphafold_hypothesis`     | none                     |

A source is never mapped to `experimental` unless a person can go and check an experiment behind
it.

## Strength stays with its source

Each record keeps the strength its source assigned: ClinVar review status, ClinGen classification,
UniProt ECO code, pLDDT, an Open Targets score. Ordering exists only inside one ordinal scheme
(`clinvar_review_status`, `clingen_gene_validity`, `uniprot_eco`). Numeric schemes are shown as the
number with its unit and source.

There is no cross-source score anywhere in OrphaFold. Two sources that disagree are shown as two
records.

## Hypotheses

A hypothesis must list the evidence records or job IDs it rests on. The assistant can draft
hypothesis text and nothing else; a fact it cites must already exist as an evidence record from a
source.

## Structure origins

Structures carry a second, closed label.

| Tag   | Origin                | Meaning                                                      | ID form          |
| ----- | --------------------- | ------------------------------------------------------------ | ---------------- |
| `EXP` | `experimental`        | Determined in a laboratory and deposited in the PDB          | `pdb:<ID>`       |
| `PRD` | `predicted_external`  | A prediction published by someone else, such as AlphaFold DB | `afdb:<entryId>` |
| `OF`  | `predicted_orphafold` | A prediction produced by a job run through this installation | `of:<job_id>`    |

The three are never presented as equivalent. The API rejects a structure descriptor whose ID prefix
does not match its origin.

## What a record contains

| Field                             | Content                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `evidence_class`, `code`, `label` | The class                                                                                               |
| `claim_label`                     | The reader-facing wording of the class                                                                  |
| subject, predicate, object        | The statement                                                                                           |
| `provenance`                      | Source, release, request URL, retrieval time, record ID and URL, licence, response SHA-256, cache flags |
| strength                          | Scheme and value as the source states them                                                              |

The ID of a record is deterministic for the same source record and claim, so the same statement has
the same ID across requests and can be pinned in a project.

## Adding a mapping

A new source registers its rule in its own adapter module with `register_evidence_rule`. A rule
that contradicts an existing one is rejected at import. The recipe is in
[Architecture](ARCHITECTURE.md), section 8, "An evidence mapping".
