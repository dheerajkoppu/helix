# Cached model outputs

Real outputs of model runs, kept so the `cached_examples` provider can return a legitimate
prediction on a machine that cannot reach the model itself. The API reads this directory through
`HELIX_EXAMPLES_DIR` (default `data/examples`).

Every file here is the unmodified artifact of a real `variant_comparison` job and sits beside the
run manifest of that job (model, version, inputs, parameters, stage timings, file hashes). A result
served from here is labelled as cached output of the named provider, model version, date and run.
An example without its `manifest.json` is not served.

## Layout

```
index.json                         one row per example: job ID, variant, provider, model, date, construct
<variant_id>__<provider>/
  manifest.json                    run manifest of the job, verbatim
  result.json                      the job as returned by GET /api/v1/jobs/{id} when it finished
  difference.json                  geometric difference between the two models, UniProt numbering
  reference.cif, variant.cif       the two models, residues numbered as in UniProt, pLDDT 0-100 in B-factors
  reference.esm_atlas.pdb, ...     the provider's response, verbatim (numbered from 1, pLDDT 0-1)
  reference.plddt.json, ...        per-residue pLDDT
```

## Regenerating

```
cd api && .venv/bin/python scripts/cache_examples.py --api http://127.0.0.1:8000
```

The script submits one `variant_comparison` job per flagship variant to a running API, waits for
it, checks the SHA-256 of every downloaded artifact against the job record and rewrites
`index.json`. It stores nothing for a job that did not succeed.

These are predictions. Structure predictors are not validated for single-residue substitutions; a
variant model that matches the reference carries no information about whether the variant is
tolerated.
