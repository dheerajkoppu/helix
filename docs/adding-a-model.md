# Adding a model

A model joins Helix as one new file under `api/helix/providers/`. Every module in that
directory is imported at startup, so no shared code is edited. This page is the checklist; the full
code template and the `JobContext` reference are in [Architecture](ARCHITECTURE.md), section 8,
"A model provider" and "A job handler".

## 1. Choose the interface

`api/helix/providers/base.py` defines five interfaces.

| Interface               | Method    | Returns                                     | Worked example                                    |
| ----------------------- | --------- | ------------------------------------------- | ------------------------------------------------- |
| `StructurePredictor`    | `predict` | Structure files, confidence, model identity | `api/helix/providers/afdb.py`, `esm_atlas.py` |
| `BindingPredictor`      | `predict` | A complex with affinity outputs             | `api/helix/providers/boltz2.py`               |
| `VariantEffectProvider` | `analyze` | Per-variant or per-residue predictions      | `api/helix/providers/protvar_effects.py`      |
| `PocketProvider`        | `find`    | Predicted pockets on a structure            | `api/helix/providers/prankweb_pockets.py`     |
| `LiteratureProvider`    | `search`  | Ranked publications                         | `api/helix/providers/europepmc_literature.py` |

## 2. Write the provider

Create `api/helix/providers/<provider_id>.py`, subclass the interface and decorate the class
with `@register_provider`.

Declare these class attributes. They are shown to the user on `/models` and copied into every run
manifest, so they must be true.

| Attribute                     | Content                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `id`, `name`                  | Stable identifier and display name                                          |
| `model_name`, `model_version` | The model and the exact version that runs                                   |
| `license`, `commercial_use`   | SPDX identifier of the model licence, and whether commercial use is allowed |
| `capabilities`                | What the model produces: `Capability.MONOMER`, `PLDDT`, `PAE` and so on     |
| `execution_mode`              | `RETRIEVAL`, `REMOTE_API`, `LOCAL_CLI` or `GPU_WORKER`                      |
| `structure_origin`            | `PREDICTED_INTERNAL` for inference, `PREDICTED_EXTERNAL` for retrieval     |
| `limitations`                 | Each limitation in the words of the model's own documentation               |
| `citation`                    | The publications to cite                                                    |
| `job_kinds`                   | The job kinds that can use this provider                                    |

Implement:

- `check_availability()`: return `Availability(available=..., reason=...)`. The reason is shown to
  the user, so name the missing setting or service. A provider that cannot run here must say so; it
  must not fall back to anything else.
- `plan(request)`: the stages the run will go through, declared before it starts.
- The interface method. It receives a `RunContext` for stages, log lines, measured progress,
  cancellation and a scratch directory, and returns files plus metadata.

A provider never touches the database or the HTTP layer. Expected failures raise
`ProviderError(code, message, detail)`.

## 3. Rules

1. Never return coordinates, scores or confidence values the model did not produce. No
   placeholders, no interpolation, no defaults standing in for a missing output.
2. Output of inference started by Helix has origin `predicted_internal` and the ID
   `of:<job_id>`. Retrieval of a third party's prediction has origin `predicted_external`.
3. Normalise pLDDT to 0-100 and record the native scale in `ConfidenceSummary.plddt_native_scale`.
4. Report the model's raw confidence values verbatim in `ConfidenceSample.metrics`.
5. Record everything the run depended on: resolved options, the seed for a stochastic model, the
   weights and their checksums when the model runs on compute you operate.
6. Number residues as UniProt does. A model that numbers from 1 or predicts a window must be
   renumbered before the file is stored, and the window recorded.
7. Call a remote service through a `SourceAdapter` with `max_concurrency` and
   `rate_limit_per_second` set, so the limit holds across concurrent jobs.
8. A non-commercial model is declared with `commercial_use = False`, and a non-commercial data
   source sits behind `noncommercial_only = True`.
9. State limitations only as the model's authors or documentation state them. Do not write new
   claims about accuracy.

## 4. Connect it to a job kind

An existing job kind accepts any provider of its interface: name the kind in `job_kinds`, and
`{"provider": "<provider_id>", ...}` in the job parameters selects it. `structure_prediction` and
`variant_comparison` take any `StructurePredictor`.

A new kind of computation needs a handler: one file under `api/helix/jobs/handlers/` decorated
with `@job_handler`. The handler validates parameters with a Pydantic model, declares its stages,
calls the provider and stores the files through `store_structure_result` or
`context.save_artifact`. A stochastic handler declares `requires_seed=True`. The worked example is
`api/helix/jobs/handlers/structure_retrieval.py`.

## 5. Check it

```bash
make api RELOAD=1
curl http://localhost:8000/api/v1/health                 # load_errors must be empty
curl http://localhost:8000/api/v1/models/<provider_id>   # attributes and availability
```

Then submit a job and read its manifest:

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H 'Content-Type: application/json' \
  -H 'X-Helix-Workspace: my-local-workspace-0001' \
  -d '{"kind": "structure_prediction", "params": {"provider": "<provider_id>", "uniprot_accession": "Q06187", "sequence": "<sequence>"}}'
curl http://localhost:8000/api/v1/jobs/<job_id>/manifest
```

Before opening a pull request:

```bash
make types    # regenerates api/openapi.json and the web types
make check    # strict import, types current, tsc, eslint
make lint     # ruff
```

The manifest should name the model and version that ran, the resolved parameters, the input
sequence with its checksum and every output file with its SHA-256. If any of those is missing, the
run cannot be reproduced and the provider is not finished.

## 6. Document it

A provider with its own setup (weights, a worker, a key) gets a page under `docs/providers/`, as
`docs/providers/boltz2.md` does. State plainly what was and was not exercised.
