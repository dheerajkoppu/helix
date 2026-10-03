# Model providers

A model provider is one module under `api/helix/providers/` that either retrieves existing
predictions or runs a model. Providers are registered at startup; `GET /api/v1/models` is the
authority on what is registered in an installation and whether each can run there. The `/models`
page shows the same list.

Each provider declares its model name and version, licence, whether commercial use is allowed, its
capabilities, how it executes, the origin of the structures it returns, its limitations and its
citation. `check_availability()` reports whether it can run on this machine and why.

## Registered providers

| ID                     | Interface          | What it does                                                       | Execution  | Licence          | Needs                      |
| ---------------------- | ------------------ | ------------------------------------------------------------------ | ---------- | ---------------- | -------------------------- |
| `afdb`                 | Structure          | Retrieves a precomputed AlphaFold DB model with pLDDT and PAE      | retrieval  | CC-BY-4.0        | nothing                    |
| `esm_atlas`            | Structure          | Runs ESMFold v1 through the public ESM Atlas service               | remote API | CC-BY-4.0        | nothing                    |
| `cached_examples`      | Structure          | Returns stored outputs of earlier real runs from `data/examples`   | retrieval  | CC-BY-4.0        | nothing                    |
| `boltz2`               | Structure, binding | Boltz-2 structure and binding affinity prediction                  | GPU worker | MIT              | a Boltz backend you attach |
| `prankweb`             | Pockets            | Predicted pockets from PrankWeb (P2Rank 2.5.1)                     | remote API | Apache-2.0       | nothing                    |
| `alphamissense_afdb`   | Variant effect     | Retrieves AlphaMissense predictions from the AlphaFold DB file     | retrieval  | CC-BY-4.0        | nothing                    |
| `protvar_effects`      | Variant effect     | Retrieves per-residue annotations and predictions from EBI ProtVar | retrieval  | CC-BY-4.0        | nothing                    |
| `europepmc_literature` | Literature         | Rule-based literature search over Europe PMC                       | retrieval  | Europe PMC terms | nothing                    |

Execution modes are `retrieval` (lookup of something that already exists; no model is run),
`remote_api` (a third-party service runs the model), `local_cli` and `gpu_worker` (compute you
operate).

## What runs without a GPU

Everything except `boltz2`.

- **Structure retrieval** (`afdb`): a lookup, never inference. The result has origin
  `predicted_external`.
- **Structure prediction and variant comparison** (`esm_atlas`): real inference with no GPU, no
  account and no key. One protein chain of at most 400 residues. A longer protein is predicted as a
  residue window that contains the variant; the rule that chose the window and its range are
  recorded in the run manifest (`parameters.construct`). The
  result has origin `predicted_internal`.
- **Cached examples** (`cached_examples`): the stored output of real `variant_comparison` runs,
  each beside its run manifest. It runs no model and refuses any input it has no stored result for.
  It exists so the comparison view works when the remote service is unreachable.
- **Pockets, variant-effect scores, literature**: retrieved from public services.

The ESM Atlas service is public, has no documented rate limit and no service-level agreement. It
can become unavailable without notice; a job then fails with the provider's error and nothing is
substituted.

## Boltz-2

`boltz2` is registered and reports `available: false` until a backend is attached. Without one,
`binding_prediction` jobs and Boltz structure predictions fail at once with the code
`provider_unavailable` and the reason. It never returns a structure or a number that a Boltz run
did not write.

Two backends exist behind one interface:

| Backend         | How to attach                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `remote_worker` | Run the worker in `api/worker/boltz` on a machine with a GPU and set `HELIX_BOLTZ_WORKER_URL` (and `HELIX_BOLTZ_WORKER_TOKEN`) |
| `local_cli`     | Install Boltz on the API machine and set `HELIX_BOLTZ_BIN` to the executable                                                       |

Further settings: `HELIX_BOLTZ_BACKEND`, `HELIX_BOLTZ_CACHE_DIR`,
`HELIX_BOLTZ_ACCELERATOR`, `HELIX_BOLTZ_DEVICES`, `HELIX_BOLTZ_MAX_TOKENS`,
`HELIX_BOLTZ_TIMEOUT_SECONDS`, `HELIX_MSA_SERVER_URL`. They are defined in
`api/helix/boltz/settings.py`.

Status of the integration: the input builder and the output parser were checked against the Boltz
documentation and a hand-written fixture, and both backends were exercised with a stand-in
executable. No real Boltz prediction has been made through Helix yet. The full description is
in [Boltz-2 provider](providers/boltz2.md).

## Job kinds

A provider is reached through a job. `GET /api/v1/job-kinds` returns each kind with the JSON Schema
of its parameters and result.

| Kind                   | Does                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `structure_retrieval`  | Fetches an existing model and stores it with a manifest                                                               |
| `structure_prediction` | Predicts a structure for a sequence                                                                                   |
| `variant_comparison`   | Predicts the reference and the variant with the same provider and construct, then computes their geometric difference |
| `binding_prediction`   | Predicts a protein and small-molecule complex with an affinity estimate (Boltz-2)                                     |

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H 'Content-Type: application/json' \
  -H 'X-Helix-Workspace: my-local-workspace-0001' \
  -d '{"kind": "structure_retrieval", "params": {"provider": "afdb", "uniprot_accession": "Q06187"}}'
```

Every job writes a run manifest at its terminal status: see
[Reproducibility and manifests](reproducibility.md).

## Rules every provider follows

- Output of inference started by Helix has origin `predicted_internal` and ID `of:<job_id>`.
  Retrieval of a third party's prediction has origin `predicted_external`.
- pLDDT is normalised to 0-100 for display and the native scale is recorded.
- Confidence values are reported as the model wrote them. A ranking score orders samples within one
  run and is never compared across models.
- A provider never returns coordinates the model did not produce.
- Limitations are stated in the words of the model's own documentation and travel with every
  result.

To add a provider, see [Adding a model](adding-a-model.md).
