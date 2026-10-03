# Reproducibility and manifests

A conclusion in OrphaFold should be traceable in two directions: from a displayed value back to the
source record it came from, and from a computed result back to the exact inputs, model and
parameters that produced it. This page describes the records that make that possible.

## Provenance of retrieved data

Every answered call to an upstream source carries a `Provenance` envelope:

| Field                 | Content                                                         |
| --------------------- | --------------------------------------------------------------- |
| source, release       | Adapter ID and the release the source reports                   |
| request URL           | The URL that was called, with secrets removed                   |
| retrieved time        | When the response was fetched                                   |
| record ID, record URL | The record at the source, and a link to it                      |
| licence               | The licence the adapter declares                                |
| response SHA-256      | Hash of the response body                                       |
| cache flags           | Whether the answer came from the cache, and whether it is stale |

Upstream responses are cached in the `http_cache` table. A cached answer keeps its original
retrieval time, so a page shows when the data was actually fetched. Live sources change: the same
request next month can return a different record. The retrieval time and response hash identify
which answer a statement rests on.

The seeded dataset is pinned harder. `data/seed/SOURCES.json` lists every source with its release,
URL, licence, citation, retrieval time and SHA-256, and `data/seed/build_report.json` records
counts, mapping routes and every entry that could not be mapped. `make seed` rebuilds the dataset
from those sources.

## Variant identity

A protein substitution has the ID `GENE-p.Ref3PosAlt3` (`BTK-p.Arg28His`) in UniProt canonical
numbering. The build checks each flagship variant against ClinVar and against the UniProt reference
residue and fails when one no longer matches. The variant endpoint also returns the reference check
and a GA4GH VRS identifier computed from the protein sequence, alongside the ClinVar and dbSNP
cross-references.

## The run manifest

Every job writes one immutable manifest when it reaches a terminal status: succeeded, failed or
cancelled. It is the authoritative record of the run.

```bash
curl http://localhost:8000/api/v1/jobs/<job_id>/manifest
```

The response carries an `ETag` equal to the manifest hash. The same document is stored as the
artifact `manifest.json` of the job and is offered for download on the job page.

| Section                    | Content                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `manifest_version`         | `1.0.0`                                                                                           |
| `job_id`, `kind`, `status` | The run, with `created_at`, `started_at`, `completed_at`                                          |
| `research_use_only`        | Always `true`                                                                                     |
| `actor`, `project`         | The anonymous workspace actor, and the project the run belongs to when there is one               |
| `inputs`                   | Sequences with checksums, variants, ligands, input structures, database identifiers               |
| `request`                  | The job parameters exactly as submitted and validated                                             |
| `model`                    | Provider, model name and version, licence, execution mode, code repository, weights               |
| `parameters`               | Resolved parameters: the seed, the provider's options, the construct, the analysis settings       |
| `msa`                      | Whether an alignment was used and where it came from                                              |
| `source_datasets`          | The dataset releases the run read                                                                 |
| `software`                 | OrphaFold version and git commit, package versions, hardware and container when known             |
| `outputs`                  | Every artifact with its SHA-256, and the confidence values of each sample                         |
| `execution`                | Worker, attempts, command line and exit code when there is one, measured stage timings, any error |
| `integrity`                | `canonicalization: RFC8785` and `manifest_sha256`                                                 |

A real example ships in the repository: `data/examples/BTK-p.Arg28His__esm_atlas/manifest.json`,
the manifest of the cached reference-versus-variant comparison for BTK p.Arg28His.

### What the manifest records truthfully

The manifest states what happened, including what was not controlled.

- `model.weights` is empty for retrieval and for a remote service, because OrphaFold cannot see the
  weights a third party ran.
- `parameters.seed` is required only for a handler declared stochastic (`requires_seed=True`).
  ESMFold through ESM Atlas is deterministic, so its seed is `null` and the manifest says
  `deterministic: true`.
- `software.orphafold.git_commit` is `null` when the installation is not a git checkout.
- A failed run has a manifest too, with the error and the stages that completed.

### Verifying a manifest

`integrity.manifest_sha256` is the SHA-256 of the RFC 8785 canonical JSON form of the document
without that field.

```python
import json
from orphafold.jobs.manifest import verify_manifest

manifest = json.load(open("data/examples/BTK-p.Arg28His__esm_atlas/manifest.json"))
assert verify_manifest(manifest)
```

Run it with `api/.venv/bin/python` from the repository root. Each artifact can be checked the same
way: download it from `GET /api/v1/jobs/<job_id>/artifacts/<name>` and compare its SHA-256 with
the value under `outputs.artifacts`.

## What can and cannot be replayed

| Run                                        | Replay                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retrieval (`afdb`, variant-effect lookups) | The same record, as long as the source still serves that release. The stored file and its hash remain                                                                    |
| Remote inference (`esm_atlas`)             | The same request can be sent again. The service is operated by a third party, so an identical answer is expected for a deterministic model but is not guaranteed         |
| Local or worker inference (`boltz2`)       | Same input file, options, seed and weights checksum. An alignment fetched from a public MSA server is a moving target, so only a stored alignment makes a run replayable |
| Cached example (`cached_examples`)         | Not a run. It serves the stored files of a named earlier run, beside that run's manifest                                                                                 |

Run-to-run variation is not estimated for a deterministic model or for a model run once. The
comparison view states this with the result.

A corrected run is a new job. Manifests are never edited.

## Cached examples

`data/examples/` holds the unmodified artifacts of real `variant_comparison` jobs, each beside the
manifest of the job that produced them. A result served from there is labelled as cached output of
the named provider, model version, date and run. An example without its `manifest.json` is not
served. Regenerate them against a running API:

```bash
cd api && .venv/bin/python scripts/cache_examples.py --api http://127.0.0.1:8000
```

The script stores nothing for a job that did not succeed.

## Projects, snapshots and forks

A project is a mutable collection of pinned items: entities, evidence records, structures, jobs,
notes and hypotheses. Three mechanisms keep it citable.

- **Snapshots** are immutable. A snapshot ID is `ofs_` followed by the first 32 hexadecimal
  characters of the hash of its content, so the same content always has the same ID and a snapshot
  URL (`/s/<snapshot_id>`) never changes meaning.
- **Forks** point at the snapshot they started from, so lineage is recorded.
- **Hypotheses** list the evidence records and jobs they rest on.

### Exports

| Endpoint                                | Content                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/projects/<id>/export.json` | The project document                                        |
| `GET /api/v1/projects/<id>/export.md`   | A research report in Markdown, with sources and run records |
| `GET /api/v1/projects/<id>/export.zip`  | The archive described below                                 |

The same three exist under `/api/v1/snapshots/<snapshot_id>/`.

The archive contains `project.json`, `report.md`, `citations/citations.json`, the manifest of every
run the project references under `runs/<job_id>/manifest.json`, a `manifest.json` listing the files
of the archive, and `ro-crate-metadata.json`, which describes the archive as an RO-Crate.

## The API contract

`api/openapi.json` is generated from the code by `make types` and is the full list of routes and
schemas. `make check` fails when it is out of date, so the published contract always matches the
running code.

## Known gaps

- There are no database migrations. Tables are created at startup, and a schema change during
  development means recreating the database.
- No real Boltz-2 run has been made through OrphaFold, so the weights and alignment fields of the
  manifest have not been exercised with real values.
- Three of the planned comparison examples (ADA p.Arg211His, IL2RG p.Arg226Cys, RAG1 p.Arg404Gln)
  are not cached; `data/examples/index.json` lists the ones that are.
