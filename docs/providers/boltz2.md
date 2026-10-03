# Boltz-2 provider

Boltz-2 (MIT, code and weights) predicts the structure of a protein, alone or together with a small
molecule, and can predict the affinity of one small-molecule ligand in the same run. In Helix it
is the provider `boltz2`, registered as a structure predictor and as a binding predictor, and the
engine behind the job kind `binding_prediction`.

Everything it returns is a computational prediction for hypothesis generation. It is not
experimental data and not for clinical decisions. Structures carry the origin `predicted_internal`
and the ID `of:<job_id>`.

**Status of this integration.** Boltz could not be run in the environment the adapter was written
in. The YAML builder is checked against the documented input schema and the parser against the
documented output layout with a hand-written fixture; both execution backends were exercised end to
end with a stand-in executable. No real prediction has been made through it yet. Without an attached
backend the provider reports `available: false` and every job fails at once with the reason. It
never returns a structure or a number that a Boltz run did not write.

## 1. How it works

```
job params ──▶ binding_prediction handler ──▶ Boltz2Provider ──▶ backend ──▶ boltz predict
                 │ UniProt sequence, variant,      │ validate, build YAML,     local_cli: subprocess
                 │ residue window                  │ resolve options, seed     remote_worker: HTTP
                 ▼                                 ▼
          artifacts + manifest  ◀── parser reads boltz_results_<id>/ by documented file names
```

| Step             | Module                                              | What happens                                                                                                          |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Input validation | `api/helix/boltz/spec.py`                       | Standard amino acids only, one ligand for affinity, SMILES parsed with RDKit, atom limits, token cap, pocket residues |
| Input file       | `api/helix/boltz/yaml_builder.py`               | Boltz YAML, schema version 1. Checked against every documented key and read back before it is used                    |
| Options          | `api/helix/boltz/parameters.py`                 | Every option is passed explicitly, the seed always. The resolved values go into the manifest                          |
| Execution        | `api/helix/boltz/backends.py`                   | `local_cli` or `remote_worker` behind one interface                                                                   |
| Output           | `api/helix/boltz/parser.py`                     | Exact file names and JSON keys. Success is decided by file existence                                                  |
| Provider         | `api/helix/providers/boltz2.py`                 | `StructurePredictor` and `BindingPredictor` in one class                                                              |
| Job              | `api/helix/jobs/handlers/binding_prediction.py` | Sequence, window, variant, storage, manifest, typed result                                                            |
| Settings         | `api/helix/boltz/settings.py`                   | `HELIX_BOLTZ_*` and `HELIX_MSA_SERVER_URL`                                                                    |

### Input YAML

One YAML per job; the file stem is the job ID and appears in every output file name.

```yaml
version: 1
sequences:
  - protein:
      id: A
      sequence: GSWEIDPKDL
      # msa: ./msa/A.a3m   precomputed alignment;  msa: empty   single-sequence mode
  - ligand:
      id: L
      smiles: "N[C@@H](Cc1ccc(O)cc1)C(=O)O" # or  ccd: "SAH"  (never both)
constraints:
  - pocket:
      binder: L
      contacts:
        - [A, 3] # 1-indexed position in the chain, not the UniProt position
        - [A, 4]
      max_distance: 6.0
properties:
  - affinity:
      binder: L
```

Pocket residues are given to Helix in UniProt canonical numbering and translated to 1-indexed
chain positions (`position - residue_start + 1`). The manifest records both.

### Command line

```
boltz predict <job_id>.yaml --out_dir <dir> [--cache <dir>] --accelerator <gpu|cpu|mps> --devices 1
  --model boltz2 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1
  --max_parallel_samples 5 --step_scale 1.5 --max_msa_seqs 8192 --output_format mmcif
  --use_msa_server --msa_server_url <url> --msa_pairing_strategy greedy
  --use_potentials --write_full_pae
  --sampling_steps_affinity 200 --diffusion_samples_affinity 5
  --seed 42 --override
```

Adapter defaults equal the Boltz 2.2.1 defaults except two that the adapter turns on:
`--use_potentials` (inference-time steering for physical plausibility) and `--write_full_pae`. Boltz
runs unseeded by default; the adapter always passes a seed (42 unless the job sets one). The manifest
stores the resolved parameters and, next to them, the upstream defaults.

### Input limits

| Rule                                            | Behaviour                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Protein chains only, 20 standard amino acids    | Anything else is rejected                                                              |
| Affinity needs exactly one ligand               | Rejected otherwise                                                                     |
| Ligand given as SMILES or CCD code, never both  | Rejected otherwise                                                                     |
| SMILES with several disconnected components     | Rejected: submit the parent compound without counter-ions                              |
| Ligand above 128 atoms (after RDKit `RemoveHs`) | Rejected for affinity. Proteins, peptides and other large molecules are not applicable |
| Ligand above 56 atoms                           | Accepted with the caveat `ligand_atoms_above_56`                                       |
| Ligand given as CCD code                        | Atom count is not checked locally: caveat `ligand_atom_count_not_checked_for_ccd`      |
| Residues plus ligand heavy atoms above the cap  | Rejected. Cap `HELIX_BOLTZ_MAX_TOKENS`, default 1,000. Model a shorter window      |
| Pocket distance                                 | 4 to 20 Å, default 6                                                                   |

Ligand problems are reported when the job is submitted (HTTP 422), before anything is queued.

## 2. Attaching compute

The provider is unavailable until one backend is attached. `GET /api/v1/models/boltz2` shows the
state and the reason.

| Backend         | Attach with                                                       | When                                                                      |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `remote_worker` | `HELIX_BOLTZ_WORKER_URL` (and `HELIX_BOLTZ_WORKER_TOKEN`) | A GPU machine runs `api/worker/boltz`. Default for production             |
| `local_cli`     | `HELIX_BOLTZ_BIN`, or a `boltz` executable on `PATH`          | The API machine itself has a GPU, or Apple Silicon with `boltz-community` |

When both are configured the worker is used; `HELIX_BOLTZ_BACKEND=local_cli` or
`remote_worker` forces one. Setup instructions for a GPU machine, for running without Docker and for
Apple Silicon are in [`api/worker/boltz/README.md`](../../api/worker/boltz/README.md).

| Setting                           | Default                             | Meaning                                                            |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `HELIX_BOLTZ_WORKER_URL`      | unset                               | Base URL of the worker service                                     |
| `HELIX_BOLTZ_WORKER_TOKEN`    | unset                               | Bearer token of the worker                                         |
| `HELIX_BOLTZ_BIN`             | unset (`boltz` on `PATH`)           | Local executable. `HELIX_BOLTZ_EXECUTABLE` is accepted as well |
| `HELIX_BOLTZ_BACKEND`         | `auto`                              | `auto`, `local_cli`, `remote_worker`                               |
| `HELIX_BOLTZ_ACCELERATOR`     | `gpu` (`mps` on Apple Silicon)      | Local runs only; the worker has its own `BOLTZ_ACCELERATOR`        |
| `HELIX_BOLTZ_CACHE_DIR`       | unset (`$BOLTZ_CACHE`, `~/.boltz`)  | Local checkpoint directory                                         |
| `HELIX_BOLTZ_DEVICES`         | `1`                                 | Local runs only                                                    |
| `HELIX_BOLTZ_NO_KERNELS`      | `false`                             | Local runs only; needed on old NVIDIA GPUs                         |
| `HELIX_BOLTZ_MAX_TOKENS`      | `1000`                              | Largest input accepted                                             |
| `HELIX_BOLTZ_TIMEOUT_SECONDS` | `7200`                              | A run is stopped after this time                                   |
| `HELIX_MSA_SERVER_URL`        | unset (`https://api.colabfold.com`) | MSA server Boltz queries in `msa_mode: server`                     |

Availability is honest in both directions. It is false, with the reason, when nothing is attached,
when the executable does not exist, when the worker does not answer, refuses the token, speaks
another protocol version or reports that it is not ready, when upstream `boltz` 2.2.1 would run on
CPU (distorted structures, upstream issue 653) and when upstream `boltz` is asked for `mps`.

### Alignments

| `msa_mode`         | What Boltz does                                            | Recorded                                                                             |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `server` (default) | Sends the protein sequence to the MSA server               | Server URL; every `.a3m` and `.csv` Boltz left in `msa/` as an artifact with SHA-256 |
| `precomputed`      | Uses the alignment text given in `msa_content`             | The alignment as an artifact with SHA-256                                            |
| `single_sequence`  | Writes `msa: empty`: no alignment, lower accuracy expected | Mode only                                                                            |

The job log states that the sequence is sent to the server before it happens. The public ColabFold
server is a shared academic resource whose database versions it does not report; a rerun through it
is a new run, never a replay. To replay a run, download its alignment artifact and submit it as
`msa_content` with `msa_mode: precomputed`.

## 3. Job kind `binding_prediction`

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H 'Content-Type: application/json' -H 'X-Helix-Workspace: <workspace id>' \
  -d '{"kind": "binding_prediction", "params": {
        "uniprot_accession": "Q06187", "residue_start": 393, "residue_end": 659,
        "ligand_smiles": "C=CC(=O)N1CCC[C@@H](n2nc(-c3ccc(Oc4ccccc4)cc3)c3c(N)ncnc32)C1",
        "ligand_label": "ibrutinib", "pocket_residues": [474, 481, 528, 538], "seed": 42}}'
```

| Parameter                                                                                                                                                     | Default          | Meaning                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `provider`                                                                                                                                                    | `boltz2`         | A binding predictor                                                                             |
| `uniprot_accession`                                                                                                                                           |                  | Protein. Its canonical sequence is fetched from UniProt (release recorded)                      |
| `sequence`                                                                                                                                                    |                  | Sequence to use instead. With an accession it must be full length, so numbering holds           |
| `residue_start`, `residue_end`                                                                                                                                | whole            | Window to model, UniProt numbering                                                              |
| `variant_id`                                                                                                                                                  |                  | Substitution applied before modelling, e.g. `BTK-p.Cys481Ser`. The reference residue must match |
| `ligand_smiles` or `ligand_ccd`                                                                                                                               |                  | The ligand. One of the two                                                                      |
| `ligand_label`, `ligand_xrefs`                                                                                                                                |                  | Display name and CURIEs for the record                                                          |
| `pocket_residues`                                                                                                                                             | none             | UniProt positions the ligand should contact                                                     |
| `pocket_max_distance`, `pocket_force`                                                                                                                         | 6, false         | Distance in Å; `force` enforces the pocket with an inference-time potential                     |
| `predict_affinity`                                                                                                                                            | true             | Run the affinity module                                                                         |
| `seed`                                                                                                                                                        | 42               | Always passed to Boltz                                                                          |
| `msa_mode`, `msa_content`, `msa_format`                                                                                                                       | `server`         | See Alignments                                                                                  |
| `recycling_steps`, `sampling_steps`, `diffusion_samples`, `use_potentials`, `sampling_steps_affinity`, `diffusion_samples_affinity`, `affinity_mw_correction` | adapter defaults | Boltz options                                                                                   |

Stages: `resolve_sequence`, `prepare_input`, `run_model`, `read_outputs`, `store_artifacts`.

Result (`JobOut.result`): `statement`, `structure` (a `StructureDescriptor`, origin
`predicted_internal`), `protein`, `ligand` (with InChIKey and atom count for a SMILES ligand),
`pocket_constraint`, `pose_confidence`, `affinity`, `affinity_status` (`predicted`, `not_requested`,
`not_produced`), `caveats`, `limitations`, `warnings`, `seed`, `artifacts` (URL by purpose) and
`evidence` (two `computational_prediction` rows whose source record is the run manifest).

Failure codes a user can meet: `provider_unavailable`, `sequence_unavailable`,
`variant_does_not_match_sequence`, `window_outside_sequence`, `input_too_large`,
`pocket_residue_outside_sequence`, `boltz_out_of_memory`, `boltz_failed_examples`, `boltz_no_output`,
`boltz_exit_nonzero`, `boltz_timeout`, `worker_unreachable`, `worker_checksum_mismatch`.

The provider also serves `structure_prediction` requests (`StructureRequest` with chains and optional
ligands, no affinity) through the same path.

## 4. What each output means

### Files

| Artifact                                | Role                 | Content                                                                                                                                 |
| --------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `<job_id>_model_<n>.cif`                | `structure`          | Predicted complex, sample `n`. Sample 0 has the highest ranking score. B-factor = pLDDT x 100                                           |
| `confidence_<job_id>_model_<n>.json`    | `confidence_summary` | Boltz confidence values, verbatim                                                                                                       |
| `plddt_residues_model_<n>.json`         | `plddt`              | Derived: per-residue pLDDT on 0-100 in UniProt numbering, in the key layout of an AlphaFold DB confidence file, plus ligand atom scores |
| `pae_tokens_model_<n>.json`             | `pae`                | Derived: the PAE matrix as JSON with the token layout                                                                                   |
| `plddt_<job_id>_model_<n>.npz`          | `plddt`              | Native: key `plddt`, per token, 0-1                                                                                                     |
| `pae_<job_id>_model_<n>.npz`, `pde_...` | `pae`, `pde`         | Native: token by token, Å                                                                                                               |
| `affinity_<job_id>.json`                | `affinity`           | Boltz affinity values, verbatim                                                                                                         |
| `affinity_summary.json`                 | `affinity`           | The same values with unit labels, ensemble spread and derived display values                                                            |
| `<job_id>.yaml`                         | `model_input`        | The exact input Boltz read                                                                                                              |
| `msa/...`                               | `msa`                | Alignment files                                                                                                                         |
| `boltz.log`                             | `log`                | Everything Boltz printed                                                                                                                |
| `manifest.json`                         | `manifest`           | Run manifest                                                                                                                            |

Every artifact is stored with its SHA-256. The two derived files name the native file they were
computed from. Tokens are one per protein residue followed by one per ligand atom, so a PAE matrix is
larger than the residue count.

### Confidence (`confidence_<id>_model_<n>.json`)

| Key                               | Scale              | Meaning and use                                                                                                                                                               |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confidence_score`                | 0-1                | Boltz ranking score, `0.8 x complex_plddt + 0.2 x iptm` (`ptm` for a single chain). Orders samples of one run. Not a probability of correctness, not comparable across models |
| `ptm`                             | 0-1                | Predicted TM-score of the whole prediction                                                                                                                                    |
| `iptm`                            | 0-1                | Predicted TM-score over interfaces. Boltz writes 0 for a single chain; Helix stores `null` there                                                                          |
| `ligand_iptm`                     | 0-1                | Interface confidence of the ligand. The value to read for a protein-ligand pose                                                                                               |
| `protein_iptm`                    | 0-1                | Interface confidence between protein chains                                                                                                                                   |
| `complex_plddt`, `complex_iplddt` | 0-1                | Mean pLDDT of the complex and of the interface                                                                                                                                |
| `complex_pde`, `complex_ipde`     | Å, lower is better | Predicted distance error of the complex and of the interface                                                                                                                  |
| `chains_ptm`, `pair_chains_iptm`  | 0-1                | Per chain and per chain pair; keys are zero-based chain indices in YAML order                                                                                                 |

pLDDT is normalised to 0-100 everywhere a user sees it (`ConfidenceSummary.plddt_mean`, the derived
residue file) and the native scale `0-1` is kept in `plddt_native_scale`. Bands use lower-inclusive
cut-offs at 90, 70 and 50. `pae_max` is `null`: Boltz states no cap, and the derived file marks its
maximum as the observed maximum of that matrix. The raw JSON is kept verbatim in
`confidence.provider_native` and in the manifest.

### Affinity (`affinity_<id>.json`)

| Key                                            | Unit                       | Meaning and use                                                                                                            |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `affinity_pred_value`                          | predicted log10(IC50 / µM) | Lower is stronger: -3 corresponds to 1 nM, 0 to 1 µM, 2 to 100 µM. For comparing different active molecules, not inactives |
| `affinity_probability_binary`                  | probability, 0-1           | Predicted probability that the ligand is a binder. For separating binders from decoys. Not a measure of binding strength   |
| `affinity_pred_value1`, `affinity_pred_value2` | predicted log10(IC50 / µM) | The two ensemble members. `affinity_pred_value_spread` is their absolute difference                                        |
| `affinity_probability_binary1`, `...2`         | probability, 0-1           | The two ensemble members                                                                                                   |

Derived values, computed by formula from `affinity_pred_value` and always shown next to it, never
instead of it:

| Field                        | Formula                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `derived.approx_ic50_um`     | `10 ** affinity_pred_value` (µM)                                                     |
| `derived.pic50`              | `6 - affinity_pred_value`                                                            |
| `derived.pic50_kcal_per_mol` | `(6 - affinity_pred_value) * 1.364`, the conversion given in the Boltz documentation |

None of these is Kd, Ki or a measured free energy. Predicted affinity is never placed in the same
column as measured affinity.

### Caveats

`result.caveats` lists the conditions that apply to a run:

| Caveat                                   | Set when                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `comparison_only_across_actives`         | Affinity was requested                                                |
| `receptor_is_predicted_structure`        | Always: the receptor is predicted together with the ligand            |
| `ligand_atoms_above_56`                  | The ligand is larger than the size the Boltz documentation recommends |
| `ligand_atom_count_not_checked_for_ccd`  | The ligand is a CCD code                                              |
| `variant_sequence_outside_validated_use` | A variant was applied to the sequence                                 |

### Provenance in the manifest

`model` (provider, Boltz package and version as reported by the backend, repository, checkpoints with
SHA-256 and whether they match the pinned revision), `parameters` (every resolved option, seed,
backend, accelerator, pocket constraint, SHA-256 of the input YAML, upstream defaults), `inputs`
(sequence digests, UniProt record and release, applied variant, ligand SMILES, InChIKey),
`msa` (mode, server URL, artifact IDs), `execution.argv` and `exit_code`, `software` (packages,
accelerator, GPU model), `outputs` (every artifact with SHA-256, confidence of every sample verbatim).

Pinned for workers: `boltz==2.2.1` on CUDA, `boltz-community==2.10.12` on Apple Silicon or CPU,
Python 3.12, checkpoints from Hugging Face `boltz-community/boltz-2` at revision
`6fdef46d763fee7fbb83ca5501ccceff43b85607`. Warnings `weights_not_hashed`,
`weights_differ_from_pinned:<file>` and `boltz_version_not_reported_by_backend` mark a run whose
model identity is incomplete.

## 5. Limitations

From the Boltz documentation and the research notes in `docs/research/`:

- A prediction is not a measurement. pLDDT is a local confidence estimate; in complexes it does not
  by itself indicate whether the relative placement of chains or the predicted interface is correct.
- `affinity_pred_value` should only be used when comparing different active molecules, not
  inactives. A pose with low `ligand_iptm` makes the affinity uninterpretable.
- Affinity takes one small-molecule ligand bound to a protein. With an RNA, DNA or co-factor target
  the code does not fail, but the output is unreliable; the adapter accepts protein chains only.
  Protein therapeutics are not applicable.
- The affinity module was evaluated on the FEP+ benchmark, CASP16 and the authors' MF-PCBA test set.
  A rare-disease protein without a studied series of active compounds is outside that evaluation.
- Not validated for predicting the effect of mutations. A wild-type versus variant difference in
  structure, pLDDT or affinity is model behaviour, never measured destabilisation or a measured
  change in binding.
- Boltz catches out-of-memory errors and can exit with code 0 without writing a prediction, so
  success is decided by the presence of the output files.
- Upstream `boltz` 2.2.1 produces distorted structures on CPU; the fix is unreleased upstream.

Not verified, stated so nobody takes them as measured:

- No real Boltz run was made through this adapter. The output layout and JSON keys come from the
  upstream documentation and writer source.
- Whether `pae_*.npz` is written without `--write_full_pae`, and the names of the files Boltz
  leaves in `msa/`, were not observed. The parser treats PAE as optional and collects every `.a3m`
  and `.csv` under `msa/`.
- The token order assumed for per-residue pLDDT (protein residues in input order, then ligand
  atoms) holds for unmodified residues. A token count that does not fit the input is reported as a
  warning and no per-residue file is written.
- Runtime and memory per token count on a given GPU, the Apple Silicon path, and whether a fixed
  seed reproduces coordinates across GPU models.
- The worker image was not built here.

Not included: the hosted Boltz API and the NVIDIA NIM (both need a user-supplied key and use
different defaults and field names), multi-ligand affinity, templates, covalent bonds, modified
residues, nucleic acids.

## 6. Checking the adapter without Boltz

```bash
cd api && .venv/bin/python -m helix.boltz.selfcheck
```

It builds the two example inputs of `docs/research/structure-models.md` section 6.4 and compares
them with the documented YAML, runs the input rules, and parses the fixture in
`api/worker/boltz/fixtures/`. That fixture is hand-written, carries the key
`_helix_parser_fixture` in its JSON files and is refused by the parser everywhere except this
check, so it can never be returned as a result.
