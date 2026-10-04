# Cached Foldseek fold-similarity searches

Each `<accession>.json` here is a **cached copy of one real Foldseek search**, not a computation of
Helix's own and not synthetic data. The Foldseek Search Server
(<https://search.foldseek.com>) accepts one submission per 50 seconds per IP address, so a cold
search can leave a page waiting for most of a minute. These copies exist so the flagship proteins and
the three control subjects answer immediately.

`helix.sources.foldseek.cached_search(accession)` reads these files. Every response built from one is
labelled: `from_cached_example: true`, `cached_retrieved_at` carries the date below, and the
`foldseek` row in `sources` says "Served from a stored copy of a real Foldseek search ... No search
was sent for this request." A protein without a file here is searched live, and comes back as
`status: "pending"` while the search runs.

## How they were retrieved

| Setting           | Value                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Service           | Foldseek Search Server, `https://search.foldseek.com/api`                    |
| Query structure   | the AlphaFold DB model `AF-<accession>-F1-model_v6.pdb`, downloaded that day |
| Search mode       | `3diaa` (structural alphabet + amino acids)                                  |
| Target databases  | `pdb100` (Protein Data Bank) and `afdb-swissprot` (reviewed AlphaFold DB)    |
| Retrieved         | 2026-10-04, between 00:13 and 00:33 UTC                                      |
| Hits kept         | the top 120 per database, by the order the service returned them             |
| Alignment strings | `qAln` / `dbAln` kept for the top 25 per database                            |
| Fields dropped    | `tCa` and `tSeq` (target coordinates and sequence)                           |

`tCa` and `tSeq` are most of the body: one 659-residue query against these two databases returned
25.8 MB, of which 1.7 MB survived the drop. Nothing else was altered; every number in these files is
the number Foldseek returned.

Mode `3diaa` reports an E-value, a bit score, a homology probability, the aligned length and the
sequence identity. **It does not report a TM-score**, so no TM-score appears anywhere in Helix for
these searches. Only `mode=tmalign` reports one, and that would cost a second submission against the
rate limit.

## What is cached

The three control subjects, the thirteen flagship genes of the Helix catalog, and three proteins the
controls reach through a bridge.

| Accession  | Gene   | Why it is here                  | Query length | Hits (pdb100 / afdb-swissprot) | Search time |
| ---------- | ------ | ------------------------------- | ------------ | ------------------------------ | ----------- |
| **O00329** | PIK3CD | control subject (APDS)          | 1044         | 797 / 630                      | 45.8 s      |
| **Q06187** | BTK    | control subject (XLA), flagship | 659          | 1000 / 995                     | 14.8 s      |
| **P42224** | STAT1  | control subject (GOF), flagship | 750          | 59 / 68                        | 58.7 s      |
| P23458     | JAK1   | upstream node for STAT1 GOF     | 1154         | 1000 / 995                     | 46.0 s      |
| O60674     | JAK2   | upstream node for STAT1 GOF     | 1132         | 1000 / 988                     | 68.7 s      |
| P52333     | JAK3   | upstream node, flagship         | 1124         | 1000 / 997                     | 3.5 s       |
| P40763     | STAT3  | flagship                        | 770          | 62 / 72                        | 56.8 s      |
| Q8NEB9     | PIK3C3 | class III PI3K comparison       | 887          | 639 / 391                      | 51.7 s      |
| P00813     | ADA    | flagship                        | 363          | 628 / 744                      | 61.4 s      |
| P04839     | CYBB   | flagship                        | 570          | 296 / 276                      | 53.0 s      |
| P15918     | RAG1   | flagship                        | 1043         | 110 / 87                       | 47.7 s      |
| P16410     | CTLA4  | flagship                        | 223          | 1000 / 954                     | 53.1 s      |
| P29965     | CD40LG | flagship                        | 261          | 575 / 491                      | 53.1 s      |
| P31785     | IL2RG  | flagship                        | 369          | 885 / 779                      | 54.3 s      |
| P42768     | WAS    | flagship                        | 502          | 260 / 225                      | 57.7 s      |
| Q9BZS1     | FOXP3  | flagship                        | 431          | 381 / 246                      | 53.1 s      |

"Hits" is the number the service found, before the 120-per-database cap; both numbers are kept in
each file as `total_hits` and `kept_hits`, and the API reports `total_hits` so a reader can see what
was left out. A count at exactly 1000 is the service's own result cap, not the number of proteins
that resemble the query.

Note on the accession: **PIK3CD is O00329**. Q8NEB9 is PIK3C3 (VPS34), a different protein; it is
cached here for comparison, not as the APDS subject.

## Refreshing a file

Delete it and call `GET /api/v1/structures/similar?accession=<accession>`. The first call starts the
search and returns `status: "pending"`; a later call returns the result, which is then held in the
HTTP response cache for 180 days. These files were written by the script recorded in the structure
similarity section of the build notes, which submits serially with 52 seconds between submissions.

## Licence and attribution

Foldseek Search Server, Steinegger lab. Method: van Kempen M. et al., "Fast and accurate protein
structure search with Foldseek", _Nature Biotechnology_ 42, 243-246 (2024). Helix calls the hosted
service over HTTP and bundles no Foldseek code. The targets are the Protein Data Bank (RCSB PDB,
CC0-1.0) and the AlphaFold Protein Structure Database (EMBL-EBI / Google DeepMind, CC-BY-4.0).
