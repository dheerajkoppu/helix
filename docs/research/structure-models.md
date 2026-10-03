# Structure models: provider research and adapter specs

Research date: 2026-10-03. Topic: `structure-models`. Audience: engineers building the Helix provider layer.

Evidence legend used throughout:

- **[curl]** verified by me today with a live HTTP call from this machine.
- **[src]** read directly from the upstream repository file, GitHub API, PyPI or Hugging Face API today.
- **[doc]** read from vendor documentation today.
- **[search]** reported by a web search summary only; treat as lower confidence.
- **[unverified]** could not be confirmed; also listed in section 10.

---

## 1. Recommendation for Helix

| Priority | Provider                                                                                          | Role                                                                  | Why                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P0       | **AlphaFold DB** (retrieval)                                                                      | Default predicted structure for every wild-type UniProt accession     | Free, no key, CC-BY-4.0, v6 files, pLDDT + PAE JSON ready to plot. API verified live.  |
| P0       | **ESM Atlas fold API** (remote, ESMFold v1)                                                       | The only zero-configuration real inference path                       | Live today, no key, no GPU. Hard limit 400 residues, monomer only, pLDDT only, no SLA. |
| P1       | **Boltz-2** (local CLI / GPU worker)                                                              | Primary Helix-generated model: monomer, complex, ligand, affinity | MIT code and weights, commercial use allowed, one CLI, stable output layout.           |
| P2       | Keyed remote adapters, off by default: **Boltz API**, **Biohub ESMFold2**, **NVIDIA NIM Boltz-2** | Hosted GPU inference when the user supplies their own key             | All three endpoints exist and answer 401 without a key. Each has cost or trial terms.  |
| P2       | **Foldseek web API**                                                                              | Structure similarity search                                           | Live, no key, strict rate limit (1 submission per ~50 s per IP).                       |
| Excluded | AlphaFold Server, bundled AlphaFold 3 weights, Protenix-v2 weights, SimpleFold weights            | -                                                                     | Terms forbid automation, redistribution or non-research use. See section 4.            |

Core decisions:

1. Ship three adapters first: `afdb` (retrieval), `esm_atlas` (remote API), `boltz2` (local CLI with pluggable execution backend). Everything else sits behind the same interface and is optional.
2. Treat Boltz-2 as the primary generated model. Run it on a CUDA GPU worker. On the current dev machine (Apple M4 Pro, 24 GB unified memory, no NVIDIA GPU, system Python 3.14.8, checked locally) upstream `boltz` 2.2.1 will not install on the system Python (`requires-python >=3.10,<3.13`) and its CPU path produces distorted structures (issue #653). Use `boltz-community` 2.10.12 in a Python 3.12 virtualenv with `--accelerator mps`, and mark that backend experimental until a real run is checked.
3. Never call the public ColabFold MSA server from a multi-user hosted deployment. Make `msa_server_url` configurable, cache MSAs by sequence hash, run serially, and send a distinctive User-Agent.
4. Store every confidence value in its native units alongside a normalised copy. pLDDT arrives on a 0-1 scale from some providers and 0-100 from others.
5. Every structure record carries `origin` in {`experimental`, `predicted_external`, `predicted_internal`} plus provider, model version, source URL or job id, timestamps and license. The UI never shows a structure without that label.
6. Structure models have not been validated for predicting the structural effect of missense variants. A mutant-sequence prediction is shown as a hypothesis aid with an explicit caveat (section 5.7).

---

## 2. Which provider can run real inference without a local GPU today

| Path                                               | Key needed         | Cost                                                                        | Limits                                                            | Status on 2026-10-03                                                                                                         |
| -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **ESM Atlas `foldSequence`** (ESMFold v1)          | No                 | Free                                                                        | ≤ 400 aa, single chain, pLDDT only                                | **Verified working [curl]**. 65 aa in 0.6 s, 278 aa in 9.9 s, 400 aa in 25.5 s.                                              |
| Boltz API (`boltz-2.1`)                            | Yes (`x-api-key`)  | From $0.025 per prediction; test keys are free and return synthetic results | Results kept 7 days by default                                    | Endpoint live, 401 without key **[curl]**. No real run made.                                                                 |
| Biohub Platform ESMFold2 (`esmfold2-fast-2026-05`) | Yes (Bearer token) | Free account; credits and rate limits shown only in the developer console   | Guardrails on pathogen and toxin sequences                        | Endpoint live, 401 without key **[curl]**. Quotas **[unverified]**.                                                          |
| NVIDIA NIM hosted Boltz-2 / ESMFold / OpenFold3    | Yes (Bearer token) | Trial credits                                                               | Trial terms forbid production use                                 | Endpoints live, 401 without key **[curl]**. Hosted AlphaFold2 endpoint returned HTTP 410, end of life 2026-09-24 **[curl]**. |
| Boltz-2 on CPU or Apple Silicon                    | No                 | Free                                                                        | Slow; small systems only                                          | Plausible per upstream docs and the community fork. **Not run here [unverified]**.                                           |
| AlphaFold DB                                       | No                 | Free                                                                        | Retrieval of precomputed models. This is lookup, never inference. | Verified working **[curl]**.                                                                                                 |

Answer for the build: the ESM Atlas API is the single provider that performs real inference with no GPU, no account and no payment today. Boltz-2 needs either a GPU worker, a keyed hosted API, or an untested Apple Silicon path.

---

## 3. Provider matrix

Capabilities: M = monomer, C = multi-chain complex, L = small-molecule ligand, A = binding affinity.

| Provider                                | Current version                                                | M        | C                       | L       | A                    | Code license                | Weights / data license                       | Commercial use                   | Hardware                                     | Integration mode              |
| --------------------------------------- | -------------------------------------------------------------- | -------- | ----------------------- | ------- | -------------------- | --------------------------- | -------------------------------------------- | -------------------------------- | -------------------------------------------- | ----------------------------- |
| AlphaFold DB                            | Monomers v6 (2025-09-15, UniProt 2025_03); complexes v1 (2026) | yes      | precomputed dimers only | no      | no                   | n/a                         | CC-BY-4.0                                    | yes                              | none                                         | Retrieval (REST + files)      |
| ESM Atlas fold API (ESMFold v1)         | "ESMFOLD V1"                                                   | ≤ 400 aa | no                      | no      | no                   | MIT (repo archived)         | Output header cites CC-BY-4.0 and Meta terms | yes                              | none                                         | Remote API, no key            |
| ESMFold v1 local                        | `facebook/esmfold_v1`                                          | yes      | no                      | no      | no                   | MIT                         | MIT, 8.4 GB                                  | yes                              | GPU recommended                              | Local Python                  |
| Boltz-2                                 | `boltz` 2.2.1 (2025-09-08); main is 6 commits ahead            | yes      | yes                     | yes     | yes                  | MIT                         | MIT                                          | yes                              | CUDA GPU; CPU slow                           | Local CLI / GPU worker        |
| boltz-community fork                    | 2.10.12 (2026-08-25)                                           | yes      | yes                     | yes     | yes                  | MIT                         | MIT (same weights)                           | yes                              | CUDA, MPS, CPU                               | Local CLI / GPU worker        |
| Boltz API                               | model `boltz-2.1`                                              | yes      | yes                     | yes     | yes (derived scores) | Service; SDK Apache-2.0     | Proprietary service                          | yes, paid                        | none                                         | Remote API, key               |
| NVIDIA NIM Boltz-2                      | NIM 1.10.0 docs                                                | yes      | yes                     | yes     | yes                  | NVIDIA terms                | MIT model                                    | Trial only when hosted           | none hosted; ≥ 48 GB GPU self-hosted         | Remote API, key               |
| ESMFold2 (Biohub)                       | `esm` 3.4.1.post1 (2026-09-16)                                 | yes      | yes                     | yes     | no                   | MIT                         | MIT, 26.7 GB                                 | yes                              | Large GPU                                    | GPU worker or remote API, key |
| AlphaFold 3                             | v3.0.4 (2026-07-28)                                            | yes      | yes                     | yes     | no                   | Apache-2.0 since 2026-06-09 | Non-commercial terms                         | **no**                           | Linux, A100/H100 80 GB, up to 1 TB databases | Bring-your-own-weights only   |
| AlphaFold Server                        | web app                                                        | yes      | yes                     | limited | no                   | n/a                         | Non-commercial terms                         | **no**                           | none                                         | **Do not integrate**          |
| Chai-1                                  | `chai_lab` 0.6.1 (2025-03-18)                                  | yes      | yes                     | yes     | no                   | Apache-2.0                  | Apache-2.0                                   | yes                              | Linux + CUDA with bfloat16                   | GPU worker                    |
| OpenFold3                               | 0.5.0 (2026-08-21), default weights OpenBind-0                 | yes      | yes                     | yes     | no                   | Apache-2.0                  | Apache-2.0 (HF auto-gated)                   | yes                              | CUDA GPU                                     | GPU worker; also NIM hosted   |
| Protenix                                | 2.0.0 (2026-04-07)                                             | yes      | yes                     | yes     | no                   | Apache-2.0                  | v1 Apache-2.0; **v2 weights proprietary**    | v1 yes; v2 restricted            | CUDA GPU                                     | GPU worker (v1 only)          |
| IntelliFold                             | v2.0.4 (2026-06-23)                                            | yes*     | yes*                    | yes*    | no*                  | Apache-2.0                  | not examined                                 | not examined                     | CUDA GPU                                     | Not planned                   |
| RoseTTAFold3 (`RosettaCommons/foundry`) | v0.1.9 (2025-12-21)                                            | yes*     | yes*                    | yes*    | no*                  | BSD-3-Clause                | not examined                                 | not examined                     | CUDA GPU                                     | Not planned                   |
| SimpleFold (Apple)                      | repo active 2026-09                                            | yes      | no                      | no      | no                   | MIT                         | Research-only model license                  | **no**                           | MLX on Apple Silicon or PyTorch              | Not planned                   |
| ColabFold (AF2 / AF2-Multimer)          | 1.6.3 (2026-09-14)                                             | yes      | yes                     | no      | no                   | MIT                         | AF2 parameters under their own license       | code yes; weights not re-checked | CUDA GPU                                     | GPU worker; MSA client        |

`*` capability taken from the project description only; not examined.

Python constraints **[src]**: `boltz` `>=3.10,<3.13`; `boltz-community` `>=3.10`; `esm` `>=3.12`; `protenix` `>=3.11`; `chai_lab` `>=3.10`; `openfold3` `>=3.10`. The PyPI package named `alphafold3` (0.0.8, MIT) was uploaded in May 2024, before Google DeepMind published its inference code, so it is a different project; AlphaFold 3 installs from its GitHub repository.

---

## 4. Current state per provider

### 4.1 AlphaFold Protein Structure Database

- Base: `https://alphafold.ebi.ac.uk`. OpenAPI: `https://alphafold.ebi.ac.uk/api/openapi.json` **[curl]**.
- Current monomer release: file version **v6**, changelog entry 2025-09-15: UniProt 2025_03, 241,070,489 structures, 40,054 isoform sequences added, A3M MSAs added **[curl FTP changelog]**. `modelCreatedDate` on entries: 2025-08-01.
- Complexes: 1.7 M high-confidence homodimers announced 2026-03-16; about 80,000 high-confidence heterodimers on 2026-05-19; viral complexes on 2026-09-24. Total above 260 M predictions **[doc/search]**. Complex entries use ids like `AF-0000000066503175`, version `v1`, `providerId` NVIDIA/NVDA, `toolUsed` "ColabFold v1.6.0 / AlphaFold-Multimer" or "OpenFold-TRT / AlphaFold-Multimer" **[curl]**.
- License: CC-BY-4.0, academic and commercial. mmCIF `_pdbx_data_usage` embeds the license and a disclaimer that the data is theoretical modelling, not medical advice **[curl]**. Site text: "The AlphaFold and AlphaMissense Data have not been validated for, and are not approved for, any clinical use." **[curl]**.
- Coverage rules, quoted from the site **[curl]**: "The minimum length is 16 amino acids, while the maximum is 2,700 for proteomes / Swiss-Prot and 1,280 for the rest of UniProt. For the human proteome only, our download includes longer proteins segmented into fragments." Fragments are "only available for the human proteome in these proteome archive files, not on the website". Sequences with non-standard residues (X, O) are excluded.
- Measured consequence for IEI genes **[curl]**: `P50851` (LRBA, 2,863 aa), `Q13315` (ATM, 3,056 aa), `P78527` (PRKDC, 4,128 aa) return HTTP 404. `Q99698` (LYST, 3,801 aa) returns only isoform entries `AF-Q99698-3-F1` and `AF-Q99698-2-F1`, with no canonical model. `Q8NF50` (DOCK8, 2,099 aa) returns the canonical model plus three isoforms.
- Older file versions are gone: `AF-Q06187-F1-model_v4.cif` and `_v5.cif` return 404 **[curl]**. Never hard-code a version; read URLs from the API.
- `msaUrl` returned by the API gives HTTP 403 **[curl]**. Do not depend on it.
- No documented rate limit. 20 back-to-back calls all returned 200 **[curl]**. CORS is open (`access-control-allow-origin: *`). File responses carry `cache-control: public,max-age=86400` and an ETag.

Endpoints **[curl]**:

| Method and path                                                                | Purpose                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /api/prediction/{qualifier}?include_complexes=false`                      | All models for a UniProt accession or a model id. Returns a JSON array. |
| `GET /api/complex/{qualifier}`                                                 | Complex models with interface metrics.                                  |
| `GET /api/uniprot/summary/{accession}.json`                                    | 3D-Beacons style summary.                                               |
| `GET /api/sequence/summary?id={sequence or md5}&type={sequence or md5}&rows=N` | Models matching a sequence. `type` is `sequence` (default) or `md5`.    |
| `GET /api/annotations/{accession}.json?type=MUTAGEN`                           | AlphaMissense annotations.                                              |

File URL patterns (monomer entry `AF-{accession}-F1`, isoform `AF-{accession}-{n}-F1`) **[curl]**:

| File             | Pattern                                                                                              | Result                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| mmCIF (ModelCIF) | `/files/AF-Q06187-F1-model_v6.cif`                                                                   | 200, 627 KB            |
| BinaryCIF        | `/files/AF-Q06187-F1-model_v6.bcif`                                                                  | 200, 244 KB            |
| PDB              | `/files/AF-Q06187-F1-model_v6.pdb`                                                                   | 200                    |
| pLDDT JSON       | `/files/AF-Q06187-F1-confidence_v6.json`                                                             | 200                    |
| PAE JSON         | `/files/AF-Q06187-F1-predicted_aligned_error_v6.json`                                                | 200, 1.2 MB for 659 aa |
| PAE PNG          | `/files/AF-Q06187-F1-predicted_aligned_error_v6.png`                                                 | 200                    |
| AlphaMissense    | `/files/AF-Q06187-F1-aa-substitutions.csv`, `-hg38.csv`, `-hg19.csv`                                 | 200                    |
| MSA              | `/files/msa/AF-Q06187-F1-msa_v6.a3m`                                                                 | **403**                |
| Complex          | `/files/AF-0000000066503175-model_v1.cif`, `-confidence_v1.json`, `-predicted_aligned_error_v1.json` | 200                    |

### 4.2 ESM Atlas fold API (ESMFold v1)

Tested today **[curl]**:

```bash
curl -X POST --data "MKTVRQERLKSIVRILERSKEPVSGAQLAEELSVSRQVIVQDIAYLRSLGYNIVATPRGYVLAGG" \
  https://api.esmatlas.com/foldSequence/v1/pdb/
```

| Case                        | Result                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| 65 aa                       | HTTP 200, 0.58 s, `content-type: chemical/x-pdb`, `TITLE ESMFOLD V1 PREDICTION FOR INPUT` |
| 278 aa (BTK kinase domain)  | HTTP 200, 9.9 s                                                                           |
| 400 aa                      | HTTP 200, 25.5 s                                                                          |
| 401 aa and 659 aa           | HTTP **413**, body `Sequence is longer than 400.`                                         |
| Invalid characters          | HTTP **422**, body lists allowed tokens: 20 standard residues plus B, Z, X, J             |
| Empty body                  | HTTP **400**, `Sequence is empty.`                                                        |
| `A:B` multi-chain separator | HTTP 422. Complexes are unsupported.                                                      |
| GET                         | HTTP 403 `Missing Authentication Token`. POST only.                                       |
| `/foldSequence/v1/cif/`     | HTTP 200, `chemical/x-cif`                                                                |
| FASTA header line in body   | Accepted, header ignored. Still send the raw sequence only.                               |

Facts:

- No key. CORS open. TLS certificate valid today. No documented rate limit and no SLA; 12 sequential requests saw no throttling.
- **pLDDT scale differs by format.** PDB B-factor column is 0-1 (observed 0.45-0.97). CIF `_atom_site.B_iso_or_equiv` is 0-100.
- The CIF `_ma_qa_metric_local` table was malformed in my test: 64 rows for 65 residues, residue 1 missing, values offset. Use the PDB endpoint or CIF atom-site B-factors, never that table.
- Output is a single model. No PAE, no pTM.
- PDB header REMARK states the Atlas data is CC-BY-4.0 for academic and commercial use, subject to Meta Open Source Terms of Use.
- Lineage: `facebookresearch/esm` is MIT and archived (last push 2024-02) **[src]**. The successor organisation is Biohub (section 4.6). No retirement notice for `api.esmatlas.com` was found; plan for it to disappear without warning.

### 4.3 Boltz-2 and the Boltz family

Releases **[src GitHub API]**: v2.0.0 2025-06-06 (Boltz-2), v2.1.1 2025-06-11 (NVIDIA cuEquivariance kernels), v2.2.0 2025-07-15, **v2.2.1 2025-09-08 (latest tag and latest PyPI)**. `main` HEAD `b1ebfc46` (2026-05-29) is 6 commits ahead and contains the CPU precision fix (PR #670). Repository: `https://github.com/jwohlwend/boltz`, MIT, not archived.

Newer work from the Boltz team:

| Item                                     | Date       | Open?                                                      |
| ---------------------------------------- | ---------- | ---------------------------------------------------------- |
| BoltzGen (binder design)                 | 2025-10    | MIT, `HannesStark/boltzgen` v0.3.2 **[src]**               |
| Boltz PBC and Boltz Lab (hosted web app) | 2026-01-08 | Hosted; "Up to 200 free predictions every month" **[doc]** |
| BoltzMol-1, BoltzProt-1, Boltz API       | 2026-06-16 | API; open weights not stated **[unverified]**              |
| Boltz-3                                  | -          | No evidence found                                          |

Install **[src]**:

```bash
pip install "boltz[cuda]" -U          # NVIDIA GPU, Python 3.10-3.12
pip install boltz -U                   # CPU or non-CUDA
pip install boltz-community            # community fork: MPS, CPU float32 fix, Python >=3.10
```

Model files download on first run to `~/.boltz` or `$BOLTZ_CACHE` (absolute path): `boltz2_conf.ckpt` 2.29 GB, `boltz2_aff.ckpt` 2.06 GB, `mols.tar` 1.86 GB **[src HF]**. Sources: `model-gateway.boltz.bio` with Hugging Face `boltz-community/boltz-2` fallback.

Known problems **[src]**:

- Upstream 2.2.1 on `--accelerator cpu` gives distorted structures (issue #653). Fixed on `main` (PR #670) and in `boltz-community`. No upstream release contains the fix.
- Upstream `--accelerator` accepts only `gpu`, `cpu`, `tpu`. Apple Silicon PRs #231 and #527 are still open. `boltz-community` adds `--accelerator mps` with float32.
- Out-of-memory is caught and logged (`WARNING: ran out of memory, skipping batch`); the writer prints `Number of failed examples: N`. Success must be detected by checking that output files exist.
- Old NVIDIA GPUs need `--no_kernels`.

Hardware and runtime:

- Upstream gives no VRAM table. Trainer precision is `bf16-mixed` for Boltz-2 **[src]**.
- ChimeraX documentation for its bundled Boltz 2.1.1 **[doc]**: 24 GB cards predict about 1,000 tokens (about 1,400 with 16-bit floats); 8-12 GB cards handle 300-500 residues; a 32 GB Mac handles about 1,000 residues plus ligand atoms; runtime grows quadratically with tokens.
- NVIDIA NIM self-hosting minimum: 48 GB GPU, 12 CPU cores, 64 GB RAM, 80 GB NVMe **[doc]**.
- Seconds-per-prediction on specific GPUs for Boltz-2: **[unverified]**. Measure on the target worker.

Hosted Boltz API **[doc + curl]**: base `https://api.boltz.bio`, header `x-api-key`, `POST /compute/v1/predictions/structure-and-binding` to start, `GET /compute/v1/predictions/structure-and-binding/{id}` to poll (`pending | running | succeeded | failed`), `POST /compute/v1/predictions/structure-and-binding/{id}/delete-data`, `POST /compute/v1/predictions/structure-and-binding/estimate-cost`. Model argument `boltz-2.1`. Entities use `type` in {`protein`, `rna`, `dna`, `ligand_smiles`, `ligand_ccd`, glycan}, `value`, `chain_ids`. Output `all_sample_results[].metrics` fields: `structure_confidence`, `ptm`, `iptm`, `complex_plddt`, `complex_iplddt`, `complex_pde`, `complex_ipde`; `binding_metrics`: `binding_confidence`, `optimization_score`. Constraint residue indices are **0-indexed** in this API, unlike the 1-indexed open-source YAML. Test keys (`sk_bc_*_test_`) return synthetic results. Data retained 7 days by default. Unauthenticated call returns `{"code":"unauthorized","message":"Invalid or missing API key"}`.

NVIDIA NIM Boltz-2 **[doc + curl]**: hosted `POST https://health.api.nvidia.com/v1/biology/mit/boltz2/predict`, self-hosted `POST http://localhost:8000/biology/mit/boltz2/predict`. Request fields: `polymers[]` (`id`, `molecule_type`, `sequence`, optional `msa`, `modifications`, `cyclic`), `ligands[]` (`id`, `ccd` or `smiles`, `predict_affinity`), `recycling_steps`, `sampling_steps` (NIM default 50), `diffusion_samples`, `step_scale` (NIM default 1.638), `write_full_pae`. Response: `structures[]`, `confidence_scores`, `ptm_scores`, `iptm_scores`, `complex_plddt_scores`, `affinities{ affinity_pred_value, affinity_probability_binary, affinity_pic50 }`. Limits: 12 polymers, 20 ligands, 4,096 residues per chain. NIM defaults differ from the upstream CLI (200 steps, step scale 1.5), so results are not interchangeable without recording parameters.

### 4.4 AlphaFold 3 and AlphaFold Server

- Code: `google-deepmind/alphafold3`, **Apache-2.0 since 2026-06-09** (commit "Change the code license from CC BY-NC-SA 4.0 to Apache 2.0"); releases v3.0.2 2026-04-20, v3.0.3 2026-06-09, v3.0.4 2026-07-28 **[src]**.
- Weights: direct download, no request form: `https://storage.googleapis.com/alphafold3/af3.bin.zst`. A SynthID watermarking variant is at `af3_synthid.bin.zst` **[src README]**.
- Weights terms (`WEIGHTS_TERMS_OF_USE.md`) **[src]**: parameters and output "are **only** available for non-commercial use by, or on behalf of, non-commercial organizations"; no use of output to train structure prediction models; "You **must not** publish or share AlphaFold 3 model parameters"; output is "not intended, validated, or approved for clinical use". Published output must carry notice of the Output Terms of Use.
- Commercial route named in the README: Gemini Enterprise Agent Platform on Google Cloud.
- Requirements **[src docs]**: Linux only; NVIDIA GPU with compute capability ≥ 8.0; verified on A100 80 GB and H100 80 GB; up to 1 TB for genetic databases; ≥ 64 GB RAM. Timings on A100 80 GB: 1,024 tokens 62 s, 2,048 tokens 275 s, 5,120 tokens 2,547 s.
- AlphaFold Server (`alphafoldserver.com`) **[src PDFs]**: non-commercial only. Prohibited: use "In connection with any automated system that predicts the binding or interaction of the protein with ligands or peptides"; training similar models; to "grant or permit access to AlphaFold Server". There is no public API. Quota of 30 jobs per day **[search]**.

Helix decision: no AlphaFold Server integration of any kind. AlphaFold 3 is supportable only as a bring-your-own-weights adapter on an institution's own Linux GPU, disabled by default, with outputs labelled as subject to the AlphaFold 3 Output Terms of Use.

### 4.5 Chai-1

- `chaidiscovery/chai-lab`, **Apache-2.0 for code and weights**; latest `chai_lab` 0.6.1 (2025-03-18); repository last pushed 2026-06-30 **[src]**.
- Requirements, quoted **[src README]**: "requires Linux, Python 3.10 or later, and a GPU with CUDA and bfloat16 support. We recommend using an A100 80GB or H100 80GB or L40S 48GB chip, but A10 and A30 will work for smaller complexes."
- CLI: `chai-lab fold input.fasta output_folder`; with MSAs: `chai-lab fold --use-msa-server --use-templates-server input.fasta output_folder`. Defaults: 5 samples, 3 trunk recycles, 200 diffusion steps, ESM embeddings without MSA.
- Outputs **[src]**: `pred.model_idx_{i}.cif`, `scores.model_idx_{i}.npz` with keys `aggregate_score`, `ptm`, `iptm`, `per_chain_ptm`, `per_chain_pair_iptm`, clash fields. `aggregate_score = 0.2*pTM + 0.8*ipTM - 100*has_inter_chain_clashes`.
- No affinity head. Role in Helix: optional second opinion on a GPU worker.

### 4.6 ESMFold2, ESM C, ESM3 (Biohub)

- `github.com/evolutionaryscale/esm` now resolves to **`Biohub/esm`**; license file is MIT, "Copyright 2026 Chan Zuckerberg Biohub, Inc."; PyPI `esm` 3.4.1.post1 (2026-09-16) **[src]**. The Forge API moved from `forge.evolutionaryscale.ai` to `https://biohub.ai` **[src README]**.
- **ESMFold2**: released with a 2026 preprint; built on ESMC 6B with a diffusion structure module; proteins, DNA, RNA, ligands, modified residues; optional MSA; outputs pLDDT, pTM, ipTM, PAE; MIT; Hugging Face `biohub/ESMFold2` (26.7 GB, ungated) and `biohub/ESMFold2-Fast` (26.1 GB, single-sequence) **[src]**. Too large for the 24 GB dev machine.
- Remote API **[src SDK + curl]**: `POST https://biohub.ai/api/v1/fold_all_atom` and `POST https://biohub.ai/api/v1/fold`, header `Authorization: Bearer <token>`. Model ids: `esmfold2-fast-2026-05`, `esmfold2-2026-05`, `esmfold2-2026-05-cutoff-2025`. Body keys: `all_atom_input: { sequences: [{ type, id, sequence | smiles | ccd, modifications?, msa? }], covalent_bonds?, pocket? }`, `model`, `num_sampling_steps`, `num_loops`, `include_pae`, `include_embeddings`. Response keys: `complex`, `plddt`, `ptm`, `interface_ptm`, `pae`, `residue_index`, `entity_id`. Unauthenticated call returns HTTP 401 `Unauthorized. Provide a valid API key via Authorization: Bearer <key>`.
- Biohub Terms of Use, last updated 2026-05-27 **[doc]**: output is for research and informational purposes; limits may be imposed at any time; circumventing rate limits is prohibited. Free quota size is **[unverified]**.
- **ESM C** (`biohub/ESMC-300M`, `-600M`, `-6B`): embedding models, no coordinates. Hugging Face tags show `mit` plus `other` **[src]**; confirm the model card before commercial use.
- **ESM3** (`biohub/esm3-sm-open-v1`): generative sequence-structure-function model. Repo README states MIT; the Hugging Face card has no license tag **[src]**. Not needed for the structure journey.

### 4.7 OpenFold3, Protenix and others

- **OpenFold3** (`aqlaboratory/openfold-3`): Apache-2.0; v0.5.0 "OpenBind Model Release" 2026-08-21; default weights OpenBind-0 (June 2025 training cutoff); still labelled preview; training data released March 2026; `pip install openfold3`, `setup_openfold`, `run_openfold predict --query_json=<query file>`; MSAs via the ColabFold server **[src]**.
- **Protenix** (`bytedance/Protenix`): code Apache-2.0; v1 released 2026-02-05 with Apache-2.0 weights (`protenix_base_default_v1.0.0`, `protenix_base_20250630_v1.0.0`); **v2 (2026-04-08) weights are "proprietary and confidential"** per the README; `protenix pred -i input.json -o ./output -n protenix_base_default_v1.0.0` **[src]**.
- **IntelliFold** v2.0.4, Apache-2.0 repo; **RoseTTAFold3** in `RosettaCommons/foundry`, BSD-3-Clause; **SimpleFold** (Apple), MIT code with a research-only model license and an MLX backend **[src]**. None is needed for the first build.
- Closed or API-only systems (BoltzMol-1, BoltzProt-1, Chai-2, Isomorphic models): out of scope.

### 4.8 ColabFold and the public MSA server

- ColabFold 1.6.3 (2026-09-14), MIT **[src]**. Server: `https://api.colabfold.com`. Databases built with MMseqs2 release 18.
- Terms printed by `colabfold_batch` **[src `colabfold/utils.py`]**: "You are welcome to use the default MSA server, however keep in mind that it's a limited shared resource only capable of processing a few thousand MSAs per day. Please submit jobs only from a single IP address. We reserve the right to limit access to the server case-by-case when usage exceeds fair use. If you require more MSAs: You can precompute all MSAs with `colabfold_search` or host your own API and pass it to `--host-url`".
- README FAQ: queries must be "serial from a single IP". Wiki: "large-scale structure predictions should not be done with the public MSA server" and "you might not be allowed to send your protein sequences to a third-party server".
- Protocol used by Boltz **[src `boltz/data/msa/mmseqs2.py`]**: `POST {host}/ticket/msa` (or `/ticket/pair`), poll `GET {host}/ticket/{id}`, download `GET {host}/result/download/{id}`; statuses include `RATELIMIT`, `MAINTENANCE`, `ERROR`; header `User-Agent: boltz`.
- Self-hosting needs very large RAM for the preindexed databases. NVIDIA also hosts an MSA search NIM (`/v1/biology/colabfold/msa-search/predict`, 401 without key **[curl]**).

### 4.9 Foldseek web API

Verified end to end today **[curl]**. Foldseek code is GPL-3.0; Helix calls the hosted service over HTTP and bundles no Foldseek code.

```bash
curl -X POST https://search.foldseek.com/api/ticket \
  -F "q=@model.pdb" -F "mode=3diaa" \
  -F "database[]=pdb100" -F "database[]=afdb-swissprot"
# -> {"id":"<ticket>","status":"PENDING"}
curl https://search.foldseek.com/api/ticket/<ticket>       # observed: PENDING, then COMPLETE; the same server family also reports RUNNING and ERROR
curl https://search.foldseek.com/api/result/<ticket>/0     # entry 0 = first chain
```

- Rate limit headers on submission: `x-rate-limit-limit: 0.02`, `x-rate-limit-duration: 1`. That is one submission per 50 seconds per IP.
- Databases from `GET /api/databases/all`: `afdb50` (v6), `afdb-swissprot` (v6), `afdb-proteome` (v6), `pdb100` (20240101), `cath50` (4.3.0), `mgnify_esm30`, `bfvd_v3`, `bfmd`, `gmgcl_id`, plus interface and motif sets (`pdb_interface`, `afdb_homodimer_interface`, `humanppi_interface`, `*_folddisco`).
- Result JSON: `{ type, queries[], mode, results[] }`; each result `{ db, alignments[][], taxonomyreports }`; alignment keys `query, target, seqId, alnLength, missmatches, gapsopened, qStartPos, qEndPos, dbStartPos, dbEndPos, prob, eval, score, qLen, dbLen, qAln, dbAln, tCa, tSeq, taxId, taxName`.
- A 659 aa query against two databases returned 995 and 1,000 hits and a **25.8 MB** body because `tCa` holds target coordinates. Strip `tCa` and `tSeq` before storing and cap hits.

### 4.10 3D-Beacons (structure inventory)

`GET https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/{accession}.json` **[curl]**. For Q06187 it returned 170 PDBe experimental entries, 8 SWISS-MODEL, 1 AlphaFold DB, 8 SASBDB, 1 AlphaFill, 1 isoform.io, 30 Bindome. Each summary has `model_category` in {`EXPERIMENTALLY DETERMINED`, `TEMPLATE-BASED`, `AB-INITIO`, `CONFORMATIONAL ENSEMBLE`} and `provider`. This is the cheapest way to populate the experimental-versus-predicted distinction for one accession.

---

## 5. Confidence metrics: meaning and presentation rules

### 5.1 pLDDT

- Meaning: the model's predicted per-residue lDDT-Cα, a local confidence estimate. AlphaFold 3 and Boltz report it per atom or per token.
- Scales by provider:

| Source                                              | Scale                               |
| --------------------------------------------------- | ----------------------------------- |
| AFDB JSON `confidenceScore`, mmCIF and PDB B-factor | 0-100                               |
| ESM Atlas PDB B-factor                              | **0-1**                             |
| ESM Atlas CIF `B_iso_or_equiv`                      | 0-100                               |
| Boltz `plddt_*.npz`, `complex_plddt` in JSON        | **0-1**                             |
| Boltz mmCIF and PDB B-factor                        | 0-100 (`plddt * 100` in the writer) |
| AlphaFold 3 `atom_plddts`                           | 0-100                               |

- Bands and colours, exactly as the AFDB site ships them **[curl, site bundle]**:

| Band             | Range           | AFDB label               | Hex       | AFDB JSON `confidenceCategory` |
| ---------------- | --------------- | ------------------------ | --------- | ------------------------------ |
| Very high        | pLDDT > 90      | "Very high (pLDDT > 90)" | `#0053D6` | `H`                            |
| High / confident | 70 < pLDDT ≤ 90 | "High (90 > pLDDT > 70)" | `#65CBF3` | `M`                            |
| Low              | 50 < pLDDT ≤ 70 | "Low (70 > pLDDT > 50)"  | `#FFDB13` | `L`                            |
| Very low         | pLDDT ≤ 50      | "Very low (pLDDT < 50)"  | `#FF7D45` | `D`                            |

Observed category ranges in the BTK confidence JSON: H 90.0-98.88, M 70.19-89.94, L 51.44-69.62, D 28.69-49.56. A residue at exactly 90.0 was labelled `H`, while the site's own level function uses strict `> 90`. For AFDB models use the supplied `confidenceCategory`. For Helix-generated models bin with lower-inclusive cut-offs at 90, 70 and 50 so both sources agree at 90.0.

- AFDB wording to reuse: above 90 "expected to be modelled to high accuracy"; 70-90 "modelled well (a generally good backbone prediction)"; 50-70 "low confidence and should be treated with caution"; below 50 coordinates "often have a ribbon-like appearance and should not be interpreted" and are "a reasonably strong predictor of disorder".
- Rules: reserve these four colours for pLDDT and nothing else. Always show a legend. Normalise to 0-100 for display. pLDDT says nothing about relative domain or chain placement ("in complexes it does not by itself indicate whether the relative placement of chains or the predicted interface is correct"). Low pLDDT means either disorder or insufficient information, never "misfolded by the variant".

### 5.2 PAE (predicted aligned error)

- Meaning: "the expected positional error at residue X, measured in Ångströms (Å), if the predicted and actual structures were aligned on residue Y" (EMBL-EBI training). It reports confidence in relative position.
- The matrix is not symmetric: entry (i, j) and (j, i) answer different alignments. Keep both; do not average silently.
- AFDB monomer JSON: `[{ "predicted_aligned_error": [[int]], "max_predicted_aligned_error": 31.75 }]`. AFDB complex JSON: floats, plus `chains[]` with `label_asym_id`, `sequenceStart`, `sequenceEnd`.
- Boltz: `pae_*.npz` key `pae`, token by token. Ligand atoms are individual tokens, so the matrix dimension can exceed the residue count.
- Rules: render as a square heatmap, low error dark, with chain or domain boundaries drawn. State the cap (31.75 Å for AlphaFold 2 models). A confident domain arrangement needs low inter-domain PAE; high pLDDT alone is insufficient. ESM Atlas output has no PAE; show "not provided by this model".

### 5.3 pTM and ipTM

- pTM: predicted TM-score of the whole structure, 0-1. AlphaFold 3 docs: "A pTM score above 0.5 means the overall predicted fold for the complex might be similar to the true structure." For fewer than 20 tokens pTM is unreliable; rely on PAE or pLDDT.
- ipTM: predicted TM-score restricted to inter-chain interfaces, 0-1. AlphaFold 3 docs: "Values higher than 0.8 represent confident high-quality predictions, while values below 0.6 suggest a failed prediction. ipTM values between 0.6 and 0.8 are a gray zone".
- Boltz adds `ligand_iptm`, `protein_iptm`, `chains_ptm`, `pair_chains_iptm`. For a single chain Boltz writes `iptm = 0`; display that as "n/a", never as a failed interface.
- Rules: show ipTM only for multi-chain jobs. Use the 0.6 and 0.8 thresholds as a three-state indicator. Never compare ipTM numerically across different model families.

### 5.4 Complex metrics in AFDB

`/api/complex/{id}` returns `complexPredictionAccuracy_ipTM`, `_ipSAE`, `_pDockQ`, `_pDockQ2`, `_LIS`. AFDB front-end bands for ipSAE **[curl]**: ≥ 0.8 "Very high", ≥ 0.7 "Confident", ≥ 0.6 "Low", < 0.6 "Very low". The website filter floor is 0.6 for ipSAE and 0.23 for pDockQ2. Display these only for AFDB complex entries and name the metric explicitly.

### 5.5 Ranking scores (never comparable across models)

| Model       | Field                  | Formula                                                                                   | Use                                                   |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Boltz-2     | `confidence_score`     | `(4*complex_plddt + iptm) / 5`, with `ptm` replacing `iptm` when `iptm` is zero **[src]** | Orders samples within one job; `_model_0` is the best |
| AlphaFold 3 | `ranking_score`        | `0.8*ipTM + 0.2*pTM + 0.5*fraction_disordered - 100*has_clash`                            | Ranking only, range -100 to 1.5                       |
| Chai-1      | `aggregate_score`      | `0.2*pTM + 0.8*ipTM - 100*has_inter_chain_clashes`                                        | Ranking only                                          |
| Boltz API   | `structure_confidence` | Vendor-defined 0-1                                                                        | Keep separate from open-source Boltz fields           |

Rule: label Boltz `confidence_score` as "Boltz ranking score (0.8 x mean pLDDT + 0.2 x ipTM)". Do not present it as a probability of correctness and do not threshold it as a quality gate on its own.

### 5.6 Boltz affinity outputs

From `docs/prediction.md` **[src]**:

- `affinity_pred_value`: "reports a binding affinity value as `log10(IC50)`, derived from an `IC50` measured in `μM`". Lower is stronger: -3 corresponds to 1 nM, 0 to 1 µM, 2 to 100 µM. Conversion given upstream: `(6 - y) * 1.364` for pIC50 in kcal/mol; plain pIC50 is `6 - y`.
- `affinity_probability_binary`: 0-1, "the predicted probability that the ligand is a binder". Intended for hit discovery (binders versus decoys).
- `affinity_pred_value` "should only be used when comparing different active molecules, not inactives". Intended for hit-to-lead and lead optimisation.
- `affinity_pred_value1/2`, `affinity_probability_binary1/2`: the two ensemble members. Their spread is a cheap disagreement indicator.
- Constraints **[src]**: one affinity ligand per job, single copy, single residue, small molecule bound to a protein; at most 128 atoms, not recommended above 56 atoms; nucleic-acid or cofactor targets give unreliable output without an error. `--affinity_mw_correction` applies a molecular-weight correction; record whether it was on.

Presentation rules:

1. Show the binder probability and the affinity value as two separate fields with their intended use stated.
2. Display units as "predicted log10(IC50 / µM)" and optionally derived pIC50. Never label it Kd, Ki or measured ΔG.
3. Always pair affinity with the structural confidence of the same job (`ligand_iptm`, `complex_plddt`). A pose with low `ligand_iptm` makes the affinity uninterpretable.
4. Wild-type versus variant affinity differences are outside what the model was validated for. Show both numbers, show the ensemble spread, and attach the caveat.
5. Every affinity panel carries: "Computational prediction for hypothesis generation. Not experimental data. Not for clinical decisions."

### 5.7 Variant structures

AFDB FAQ **[curl]**: "AlphaFold has not been validated for predicting the effect of mutations. In particular, AlphaFold is not expected to produce an unfolded protein structure given a sequence containing a destabilising point mutation." Apply the same caveat to ESMFold and Boltz-2 output. A wild-type versus mutant comparison view must show this text and must present per-residue pLDDT deltas as model behaviour, never as measured destabilisation.

---

## 6. Adapter interface and I/O specs

### 6.1 Shared contract

```python
class StructureOrigin(str, Enum):
    EXPERIMENTAL = "experimental"
    PREDICTED_EXTERNAL = "predicted_external"      # precomputed by a third party (AFDB)
    PREDICTED_INTERNAL = "predicted_internal"    # inference triggered by Helix

class ProviderCapabilities(BaseModel):
    monomer: bool
    complex: bool
    ligand: bool
    affinity: bool
    max_residues: int | None
    requires_api_key: bool
    requires_gpu: bool

class ConfidenceBundle(BaseModel):
    plddt_per_residue: list[float]        # normalised to 0-100
    plddt_mean: float
    plddt_native_scale: Literal["0-1", "0-100"]
    pae_matrix_path: str | None           # stored as .npy; None when the model gives no PAE
    pae_max: float | None
    ptm: float | None
    iptm: float | None                    # None for single-chain jobs
    ranking_score: float | None
    ranking_score_name: str | None        # "boltz_confidence_score"
    provider_native: dict                 # raw provider JSON, verbatim

class StructureRecord(BaseModel):
    provider_id: str                      # "afdb" | "esm_atlas" | "boltz2"
    origin: StructureOrigin
    model_name: str                       # "AlphaFold Monomer v2.0 pipeline" | "ESMFold v1" | "Boltz-2"
    model_version: str                    # "v6" | "esmfold_v1" | "boltz 2.2.1"
    source_id: str | None                 # "AF-Q06187-F1"
    source_url: str | None
    license: str
    retrieved_or_generated_at: datetime
    sequence: str
    sequence_md5: str
    uniprot_accession: str | None
    uniprot_offset: int                   # add to 1-based model index to get UniProt numbering
    structure_path: str
    structure_format: Literal["mmcif", "bcif", "pdb"]
    confidence: ConfidenceBundle
    parameters: dict                      # every inference parameter and software version
    warnings: list[str]
```

Job states for generation providers: `queued`, `running`, `succeeded`, `failed`, `unavailable`. Cache key: SHA-256 over provider id, model version, canonical input and parameters.

### 6.2 Adapter (a): AlphaFold DB retrieval

Request: `GET https://alphafold.ebi.ac.uk/api/prediction/{uniprot_accession}`. Timeout 20 s. Two retries on 5xx with backoff.

Response fields used (array of entries; BTK example trimmed, `sequence` shortened here) **[curl]**:

```json
[
  {
    "entryId": "AF-Q06187-F1",
    "modelEntityId": "AF-Q06187-F1",
    "uniprotAccession": "Q06187",
    "uniprotId": "BTK_HUMAN",
    "gene": "BTK",
    "uniprotDescription": "Tyrosine-protein kinase BTK",
    "taxId": 9606,
    "organismScientificName": "Homo sapiens",
    "toolUsed": "AlphaFold Monomer v2.0 pipeline",
    "providerId": "GDM",
    "latestVersion": 6,
    "allVersions": [1, 2, 3, 4, 5, 6],
    "modelCreatedDate": "2025-08-01T00:00:00Z",
    "sequenceVersionDate": "2007-01-23T00:00:00Z",
    "sequence": "MAAVILESIF",
    "sequenceStart": 1,
    "sequenceEnd": 659,
    "sequenceChecksum": "cdc1eb3031dbbbad38e0ebfbc0fd30bd",
    "globalMetricValue": 84.44,
    "fractionPlddtVeryLow": 0.071,
    "fractionPlddtLow": 0.064,
    "fractionPlddtConfident": 0.354,
    "fractionPlddtVeryHigh": 0.511,
    "isUniProtReviewed": true,
    "isUniProtReferenceProteome": true,
    "isComplex": false,
    "cifUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-model_v6.cif",
    "bcifUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-model_v6.bcif",
    "pdbUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-model_v6.pdb",
    "plddtDocUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-confidence_v6.json",
    "paeDocUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-predicted_aligned_error_v6.json",
    "paeImageUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-predicted_aligned_error_v6.png",
    "amAnnotationsUrl": "https://alphafold.ebi.ac.uk/files/AF-Q06187-F1-aa-substitutions.csv"
  }
]
```

Selection algorithm:

1. Keep entries with `isComplex == false`.
2. Canonical model: the entry whose `uniprotAccession` equals the requested accession exactly. Isoform entries carry a suffix (`Q06187-2`, entry `AF-Q06187-2-F1`). The array order is not canonical-first (LYST returned `-3` before `-2` and no canonical entry).
3. No exact match: return "no AFDB model for canonical sequence" and list isoform models separately. Never substitute an isoform silently.
4. Verify `sequenceChecksum == md5(sequence)` (confirmed to be plain MD5) and compare to the MD5 of the current UniProt sequence. On mismatch add warning `afdb_sequence_differs_from_uniprot`. The `sequence_checksum` query parameter did not filter in my test, so check client-side.
5. Download `cifUrl` (archive copy), `bcifUrl` (viewer), `plddtDocUrl`, `paeDocUrl`.

Confidence file shapes **[curl]**:

```json
{
  "residueNumber": [1, 2, 3],
  "confidenceScore": [42.09, 62.81, 76.75],
  "confidenceCategory": ["D", "L", "M"]
}
```

```json
[
  {
    "predicted_aligned_error": [
      [0, 1, 3],
      [1, 0, 2],
      [4, 2, 0]
    ],
    "max_predicted_aligned_error": 31.75
  }
]
```

Error map:

| Condition                                               | Observed                                                                                                         | Adapter result                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Malformed id                                            | HTTP 400 `{"error":"Invalid identifier format. Please use a UniProt accession or a supported AlphaFold DB ID."}` | `invalid_accession`                                                                            |
| No model (too long, non-standard residues, not covered) | HTTP 404, body `{}`                                                                                              | `not_available`, UI text "No AlphaFold DB model (sequence outside 16-2,700 aa or not covered)" |
| File URL 404                                            | version rolled                                                                                                   | Re-query the API, then retry once                                                              |

Output mapping: `origin = predicted_external`, `model_name = toolUsed`, `model_version = "v{latestVersion}"`, `license = "CC-BY-4.0"`, `source_url = https://alphafold.ebi.ac.uk/entry/{entryId}`, `uniprot_offset = sequenceStart - 1`. Attribution string: "AlphaFold Protein Structure Database (EMBL-EBI / Google DeepMind), CC-BY-4.0". Cache by `entryId` + `latestVersion`; revalidate metadata daily.

Complexes (optional, later): `GET /api/complex/{accession}` returns `modelEntityId`, `complexPredictionAccuracy_*`, `complexComposition[] { identifierType, identifier, stoichiometry }`, `assemblyType` (`Homo` | `Hetero`), `oligomericState`. Files follow `/files/{modelEntityId}-model_v1.cif`. Returns 404 `{}` when no complex exists.

### 6.3 Adapter (b): ESM Atlas remote fold

Request:

```
POST https://api.esmatlas.com/foldSequence/v1/pdb/
Body: raw amino-acid sequence, uppercase, no header, no whitespace
```

Pre-flight validation in the adapter (reject before calling):

- Length 1-400. Longer: `unavailable` with reason `sequence_exceeds_400_residues`. Offer a user-chosen window and store `uniprot_offset`.
- Alphabet: 20 standard residues. The server also accepts B, Z, X, J; reject them in Helix to keep inputs unambiguous.
- Single chain only.

Client behaviour: timeout 120 s; concurrency 1 per deployment; minimum 1 s spacing; on 5xx or timeout retry twice with exponential backoff; on 403, 404 or DNS failure mark the provider `unavailable` for the session.

Response handling:

| HTTP | Body                           | Adapter result         |
| ---- | ------------------------------ | ---------------------- |
| 200  | PDB text, single chain A       | Parse, see below       |
| 400  | `Sequence is empty.`           | `invalid_input`        |
| 413  | `Sequence is longer than 400.` | `unavailable` (length) |
| 422  | allowed-token message          | `invalid_input`        |

Parsing:

1. Read ATOM records. Per-residue pLDDT = B-factor of the CA atom multiplied by 100. Set `plddt_native_scale = "0-1"`.
2. Sanity check: if any B-factor exceeds 1.0, treat values as already 0-100 and log a warning.
3. Convert to mmCIF with `gemmi` for uniform storage; keep the original PDB.
4. `ConfidenceBundle`: `pae_matrix_path = None`, `ptm = None`, `iptm = None`, `ranking_score = None`.

Output mapping: `origin = predicted_internal`, `provider_id = "esm_atlas"`, `model_name = "ESMFold v1"`, `model_version = "esmfold_v1"` (store the response `TITLE` line in `parameters`), `source_url = "https://api.esmatlas.com/foldSequence/v1/pdb/"`, `license` = verbatim REMARK text from the response, `parameters = {"msa": "none (single-sequence language model)"}`. Add fixed warning: "Single-sequence language-model prediction; generally less accurate than MSA-based models."

### 6.4 Adapter (c): Boltz-2 local CLI / GPU worker

Input (Helix job spec) to YAML. One YAML per job; the file stem becomes the record id and appears in every output filename.

Monomer (first 60 residues of BTK, UniProt Q06187; with no `msa:` key the run needs `--use_msa_server`):

```yaml
version: 1
sequences:
  - protein:
      id: A
      sequence: MAAVILESIFLKRSQQKKKTSPLNFKKRLFLLTVHKLSYYEYDFERGRRGSKKGSIDVEK
```

Protein + ligand with affinity and an optional pocket constraint. The protein is BTK residues 393-659 (so `uniprot_offset = 392`); the ligand SMILES is the toy tyrosine from the upstream example; the pocket residue indices are placeholders:

```yaml
version: 1
sequences:
  - protein:
      id: A
      sequence: GSWEIDPKDLTFLKELGTGQFGVVKYGKWRGQYDVAIKMIKEGSMSEDEFIEEAKVMMNLSHEKLVQLYGVCTKQRPIFIITEYMANGCLLNYLREMRHRFQTQQLLEMCKDVCEAMEYLESKQFLHRDLAARNCLVNDQGVVKVSDFGLSRYVLDDEYTSSVGSKFPVRWSPPEVLMYSKFSSKSDIWAFGVLMWEIYSLGKMPYERFTNSETAEHIAQGLRLYRPHLASEKVYTIMYSCWHEKADERPTFKILLSNILDVMDEES
      msa: ./msa/A.a3m # omit when --use_msa_server; "empty" forces single-sequence
  - ligand:
      id: L
      smiles: "N[C@@H](Cc1ccc(O)cc1)C(=O)O" # or  ccd: SAH  (never both)
constraints:
  - pocket:
      binder: L
      contacts: [[A, 97], [A, 98]] # 1-indexed residues
      max_distance: 6
properties:
  - affinity:
      binder: L
```

Full schema keys **[src]**: `sequences[].protein|dna|rna { id, sequence, msa, modifications[{position, ccd}], cyclic }`, `sequences[].ligand { id, smiles | ccd }`, `constraints[].bond { atom1, atom2 }`, `constraints[].pocket { binder, contacts, max_distance, force }`, `constraints[].contact { token1, token2, max_distance, force }`, `templates[] { cif | pdb, chain_id, template_id, force, threshold }`, `properties[].affinity { binder }`. Identical chains: `id: [A, B]`. Multi-chain custom MSAs use CSV with columns `sequence` and `key`. FASTA input is deprecated.

Command:

```bash
boltz predict /jobs/$JOB/input/$JOB.yaml \
  --out_dir /jobs/$JOB/out \
  --cache /models/boltz \
  --accelerator gpu --devices 1 \
  --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 \
  --use_msa_server --msa_server_url https://api.colabfold.com \
  --use_potentials --write_full_pae --output_format mmcif \
  --seed 42 --override
```

CLI options and defaults **[src]**:

| Option                                           | Default                      | Note                                                   |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------ |
| `--out_dir`                                      | `./`                         | Results go to `<out_dir>/boltz_results_<input stem>/`  |
| `--cache`                                        | `~/.boltz` or `$BOLTZ_CACHE` | Must be an absolute path when set by env               |
| `--accelerator`                                  | `gpu`                        | `gpu`, `cpu`, `tpu` upstream; `mps` in boltz-community |
| `--devices`                                      | `1`                          |                                                        |
| `--model`                                        | `boltz2`                     | `boltz1` also valid                                    |
| `--recycling_steps`                              | `3`                          | AlphaFold 3 parity: 10                                 |
| `--sampling_steps`                               | `200`                        |                                                        |
| `--diffusion_samples`                            | `1`                          | AlphaFold 3 parity: 25                                 |
| `--max_parallel_samples`                         | `5`                          |                                                        |
| `--step_scale`                                   | `1.5` for Boltz-2            | 1.638 for Boltz-1                                      |
| `--output_format`                                | `mmcif`                      | or `pdb`                                               |
| `--use_msa_server`                               | off                          | Without it every protein needs `msa:`                  |
| `--msa_server_url`                               | `https://api.colabfold.com`  |                                                        |
| `--msa_pairing_strategy`                         | `greedy`                     | or `complete`                                          |
| `--msa_server_username`, `--msa_server_password` | none                         | env `BOLTZ_MSA_USERNAME`, `BOLTZ_MSA_PASSWORD`         |
| `--api_key_header`, `--api_key_value`            | `X-API-Key`, none            | env `MSA_API_KEY_VALUE`                                |
| `--use_potentials`                               | off                          | Inference-time steering for physical plausibility      |
| `--affinity_mw_correction`                       | off                          |                                                        |
| `--sampling_steps_affinity`                      | `200`                        |                                                        |
| `--diffusion_samples_affinity`                   | `5`                          |                                                        |
| `--max_msa_seqs`                                 | `8192`                       |                                                        |
| `--subsample_msa`, `--num_subsampled_msa`        | off, `1024`                  |                                                        |
| `--write_full_pae`, `--write_full_pde`           | flags                        | Pass `--write_full_pae` always                         |
| `--write_embeddings`                             | off                          |                                                        |
| `--no_kernels`                                   | off                          | Needed on old NVIDIA GPUs                              |
| `--override`                                     | off                          | Without it existing predictions are reused             |
| `--seed`                                         | none                         | Set for reproducibility                                |
| `--num_workers`, `--preprocessing-threads`       | `2`, CPU count               |                                                        |

Output layout, from `docs/prediction.md` and `data/write/writer.py` **[src]** (`<id>` = input file stem):

```
<out_dir>/boltz_results_<id>/
├── lightning_logs/
├── msa/                                   # raw server MSAs
├── processed/                             # manifest.json, records/, structures/, msa/, constraints/, templates/, mols/
└── predictions/<id>/
    ├── <id>_model_0.cif                   # rank 0 = highest confidence_score; B-factor = pLDDT x 100
    ├── confidence_<id>_model_0.json
    ├── plddt_<id>_model_0.npz             # key "plddt", per token, 0-1
    ├── pae_<id>_model_0.npz               # key "pae", [tokens, tokens], Å
    ├── pde_<id>_model_0.npz               # key "pde"
    ├── <id>_model_<n>.cif                 # one file set per diffusion sample, n = rank
    ├── affinity_<id>.json                 # only with properties.affinity
    ├── pre_affinity_<id>.npz              # internal, only with affinity
    └── embeddings_<id>.npz                # only with --write_embeddings (keys "s", "z")
```

`confidence_<id>_model_<n>.json` keys, exact **[src]**:

```json
{
  "confidence_score": 0.8367,
  "ptm": 0.8425,
  "iptm": 0.8225,
  "ligand_iptm": 0.0,
  "protein_iptm": 0.8225,
  "complex_plddt": 0.8402,
  "complex_iplddt": 0.8241,
  "complex_pde": 0.8912,
  "complex_ipde": 5.165,
  "chains_ptm": { "0": 0.8533, "1": 0.833 },
  "pair_chains_iptm": {
    "0": { "0": 0.8533, "1": 0.809 },
    "1": { "0": 0.8225, "1": 0.833 }
  }
}
```

`confidence_score`, `ptm`, `iptm`, `*_plddt` are 0-1, higher is better. `complex_pde` and `complex_ipde` are in Å, lower is better. Chain keys are zero-based chain indices in YAML order.

`affinity_<id>.json` keys, exact **[src]**:

```json
{
  "affinity_pred_value": 0.8367,
  "affinity_probability_binary": 0.8425,
  "affinity_pred_value1": 0.8225,
  "affinity_probability_binary1": 0.0,
  "affinity_pred_value2": 0.8225,
  "affinity_probability_binary2": 0.8402
}
```

Parsing steps:

1. Process exit code 0 is necessary and insufficient. Require `predictions/<id>/<id>_model_0.cif` and `confidence_<id>_model_0.json`. Missing files: scan stdout for `ran out of memory` and `Number of failed examples`, then return `failed` with that reason.
2. Read `plddt_*.npz["plddt"]`, multiply by 100, set `plddt_native_scale = "0-1"`. Map tokens to residues; ligand atoms are separate tokens.
3. Read `pae_*.npz["pae"]` when present; treat as optional.
4. `ranking_score = confidence_score`, `ranking_score_name = "boltz_confidence_score"`.
5. Single-chain job: store `iptm = None` when the JSON value is 0.
6. Copy both JSON files verbatim into `provider_native`.
7. `parameters` records: `boltz` package name and version, git commit when installed from source, checkpoint filenames, every CLI flag, seed, MSA source (`colabfold_server` URL, `custom`, or `single_sequence`), accelerator, precision.

Execution backends behind the same adapter:

| Backend            | Command path                                                                | When                                                                                             |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `local_cuda`       | `boltz predict --accelerator gpu`                                           | Linux worker with NVIDIA GPU. Default for production.                                            |
| `local_mps`        | `boltz-community`: `boltz predict --accelerator mps`                        | Apple Silicon development. Experimental. Run `boltz-fix-macos-libomp` on OpenMP errors.          |
| `local_cpu`        | `--accelerator cpu` with `boltz-community` or upstream `main` at `b1ebfc46` | Last resort, short sequences. Never with upstream 2.2.1.                                         |
| `remote_boltz_api` | Boltz API                                                                   | User-supplied key; map `structure_confidence` and `binding_metrics` into `provider_native` only. |
| `remote_nim`       | NVIDIA NIM                                                                  | User-supplied key; trial terms.                                                                  |

Resource guard: estimate tokens as residues plus ligand heavy atoms. Start with a conservative cap of 1,000 tokens on 24 GB and tune from measurements.

Output mapping: `origin = predicted_internal`, `provider_id = "boltz2"`, `model_name = "Boltz-2"`, `license = "MIT (code and weights)"`.

---

## 7. Provenance and labelling rules

- Three origins, three visual treatments. Experimental: neutral with method and resolution. Predicted external: AFDB badge, version, link. Predicted by Helix: distinct badge, model, version, timestamp, parameter drawer.
- A structure viewer panel always shows: origin, provider, model version, source id or job id, date, license, and the confidence legend.
- Biological identifiers (UniProt accession, gene, organism) come from the AFDB or UniProt response fields, never from generated text.
- Store raw provider responses unchanged next to normalised values so any displayed number can be traced.
- Keep the AFDB disclaimer text and the AlphaFold mutation caveat as fixed strings in the UI.

---

## 8. Pitfalls found during verification

1. AFDB array order is not canonical-first, and long proteins may have only isoform models.
2. AFDB serves only the latest file version; v4 and v5 URLs return 404.
3. AFDB `msaUrl` returns 403.
4. ESM Atlas PDB B-factors are 0-1; its CIF `_ma_qa_metric_local` table is misaligned.
5. Boltz 2.2.1 CPU output is wrong; the fix is unreleased upstream.
6. Boltz swallows out-of-memory errors; check for files.
7. Boltz writes `iptm: 0.0` for single chains.
8. Boltz YAML is 1-indexed; the hosted Boltz API is 0-indexed.
9. NVIDIA NIM Boltz-2 defaults (50 sampling steps, step scale 1.638) differ from the upstream CLI (200, 1.5).
10. Foldseek results are tens of megabytes unless `tCa` and `tSeq` are stripped; submissions are limited to one per 50 seconds.
11. The public ColabFold MSA server is a shared academic resource; parallel or multi-IP use violates its stated terms.
12. The hosted NVIDIA AlphaFold2 endpoint is gone (HTTP 410 since 2026-09-24).
13. Hugging Face offers no hosted ESMFold inference: `api-inference.huggingface.co` has no DNS record, and the model API reports an empty `inferenceProviderMapping` for `facebook/esmfold_v1` **[curl]**.

---

## 9. Build decisions (summary)

1. Implement `afdb`, `esm_atlas`, `boltz2` adapters against the shared `StructureRecord` contract in section 6.1.
2. Select the AFDB canonical entry by exact `uniprotAccession` match and verify `sequenceChecksum` (MD5) against UniProt.
3. Read all AFDB file URLs from the API response; never construct versioned URLs.
4. Gate the ESM Atlas adapter at 400 residues client-side and convert its 0-1 B-factors to 0-100.
5. Generate Boltz YAML (version 1 schema) from the job spec; run with `--write_full_pae --use_potentials --seed`; parse the exact filenames in section 6.4.
6. Pin `boltz==2.2.1` for CUDA workers and `boltz-community==2.10.12` for Apple Silicon or CPU, each in a Python 3.12 environment.
7. Detect Boltz failure by missing output files, since the exit code is unreliable.
8. Make the MSA server URL a deployment setting; cache MSAs by sequence hash; serialise requests.
9. Keep Boltz API, Biohub ESMFold2 and NVIDIA NIM as opt-in adapters that require a user-supplied key.
10. Exclude AlphaFold Server entirely; allow AlphaFold 3 only as bring-your-own-weights on the user's own hardware.
11. Use the four AFDB pLDDT colours (`#0053D6`, `#65CBF3`, `#FFDB13`, `#FF7D45`) exclusively for pLDDT.
12. Attach the fixed mutation caveat and non-clinical disclaimer to every variant structure and affinity view.

---

## 10. Unverified items

- Boltz-2 wall-clock time and VRAM per token count on specific GPUs. One web search on this was blocked by a safety filter and returned nothing; the ChimeraX figures apply to its bundled Boltz 2.1.1.
- Boltz-2 on Apple Silicon (`boltz-community --accelerator mps`) and on CPU: not executed on this machine. Claims come from the fork README.
- Boltz output layout and JSON keys come from upstream docs and writer source, with no local run. Whether `pae_*.npz` is written without `--write_full_pae` is inferred from source.
- Biohub Platform free credits, rate limits and maximum sequence length; no key was available.
- NVIDIA trial credit amounts (1,000 to 5,000 reported by forum posts) and the ESMFold NIM request schema.
- Boltz API prices and the 200 free monthly predictions come from the pricing page summary; whether the free allowance covers API calls is unclear.
- Whether BoltzMol-1 and BoltzProt-1 weights are open, and whether API model `boltz-2.1` matches the open weights.
- ESM Atlas API rate limits, future availability, and the exact license that applies to its fold output beyond the REMARK text.
- AlphaFold Server quota (30 jobs per day) comes from a search summary; the live FAQ is JavaScript-rendered and was not read.
- AFDB API rate limits (none documented). Whether MSAs and long-protein fragments are reachable outside bulk archives.
- AlphaMissense file license; not checked in this document.
- ESM3 and ESM C weight licenses: repository says MIT, Hugging Face tags are inconsistent.
- Weights licenses and output schemas for IntelliFold and RoseTTAFold3; output schemas for OpenFold3 and Protenix.
- The ESM Atlas CIF metric-table misalignment was seen in one request only.

---

## 11. Sources

- AlphaFold DB API and files: https://alphafold.ebi.ac.uk/api/openapi.json , https://alphafold.ebi.ac.uk/api/prediction/Q06187 , https://ftp.ebi.ac.uk/pub/databases/alphafold/CHANGELOG.txt , https://ftp.ebi.ac.uk/pub/databases/alphafold/README.txt
- AlphaFold DB 2025 paper: https://academic.oup.com/nar/article/54/D1/D358/8340156
- AFDB complexes: https://www.ebi.ac.uk/about/news/technology-and-innovation/first-complexes-alphafold-database/ , https://phys.org/news/2026-09-alphafold-database-viral-protein-complexes.html
- EMBL-EBI confidence training: https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/
- ESM Atlas API: https://api.esmatlas.com/foldSequence/v1/pdb/ ; ESM v1 repo: https://github.com/facebookresearch/esm ; https://huggingface.co/facebook/esmfold_v1
- Boltz: https://github.com/jwohlwend/boltz , https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md , https://github.com/jwohlwend/boltz/blob/main/src/boltz/data/write/writer.py , https://github.com/jwohlwend/boltz/issues/653 , https://github.com/jwohlwend/boltz/pull/670 , https://pypi.org/project/boltz/ , https://huggingface.co/boltz-community/boltz-2
- Boltz community fork: https://github.com/Novel-Therapeutics/boltz-community , https://pypi.org/project/boltz-community/
- Boltz API: https://api.boltz.bio/docs/api/guides/predictions/ , https://api.boltz.bio/docs/api/guides/costs/ , https://api.boltz.bio/docs/api/guides/test-environment/ , https://api.boltz.bio/docs/api/guides/data-retention/ , https://boltz.com/pricing , https://boltz.com/boltzmol-boltzprot-api
- NVIDIA NIM: https://docs.nvidia.com/nim/bionemo/boltz2/1.10.0/inference.html , https://docs.nvidia.com/nim/bionemo/boltz2/1.10.0/support-matrix.html , https://docs.api.nvidia.com/nim/reference/mit-boltz2 , https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf
- ChimeraX Boltz tool: https://www.cgl.ucsf.edu/chimerax/docs/user/tools/boltz.html
- AlphaFold 3: https://github.com/google-deepmind/alphafold3 , https://github.com/google-deepmind/alphafold3/blob/main/WEIGHTS_TERMS_OF_USE.md , https://github.com/google-deepmind/alphafold3/blob/main/docs/output.md , https://github.com/google-deepmind/alphafold3/blob/main/docs/performance.md
- AlphaFold Server terms: https://www.gstatic.com/alphafoldserver/app/app/routes/terms_text/AlphaFold-Server-Additional-Terms-of-Service.pdf , https://www.gstatic.com/alphafoldserver/app/app/routes/prohibited_use/AlphaFold-Server-Prohibited-Use-Policy.pdf
- Chai-1: https://github.com/chaidiscovery/chai-lab , https://huggingface.co/chaidiscovery/chai-1
- ESM / Biohub: https://github.com/Biohub/esm , https://huggingface.co/biohub/ESMFold2 , https://biohub.ai/models/esmfold2 , https://biohub.org/terms-of-use/
- OpenFold3: https://github.com/aqlaboratory/openfold-3 , https://huggingface.co/OpenFold/OpenFold3
- Protenix: https://github.com/bytedance/Protenix
- Others: https://github.com/IntelliGen-AI/IntelliFold , https://github.com/RosettaCommons/foundry , https://github.com/apple/ml-simplefold
- ColabFold: https://github.com/sokrypton/ColabFold , https://github.com/sokrypton/ColabFold/blob/main/colabfold/utils.py , https://github.com/sokrypton/ColabFold/wiki , https://rowansci.com/blog/msa-failures-and-our-response
- Foldseek: https://search.foldseek.com/api/databases/all , https://github.com/steineggerlab/foldseek , https://github.com/soedinglab/MMseqs2-App/wiki/API-Documentation
- 3D-Beacons: https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/Q06187.json
