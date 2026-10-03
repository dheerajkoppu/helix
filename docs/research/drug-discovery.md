# Stage 6 — "Explore intervention": open computational drug-discovery toolchain

Research date: **2026-10-03**. Every HTTP call below was executed with `curl` from this machine on that date; HTTP status, response field names and counts are observed, not recalled. Items I could not verify are in [Unverified](#unverified--open-questions) and nowhere else.

---

## Recommendation for OrphaFold

**Stage 6 is a provenance-ranked evidence board, not a docking app.** Order the UI by evidence strength, top to bottom:

1. **Tier A — Experimental ligand evidence** (no compute). PDBe `ligand_sites` + RCSB ligand-bound entries + ChEMBL `mechanism` + ChEMBL `activity` + DrugCentral + BindingDB. This alone answers "what binds this protein, where, how tightly, measured by whom" for most IEI genes. Ship this first; it is pure ETL and is never wrong in a way a model can be.
2. **Tier B — Pocket geometry** (cheap compute, seconds). Call the **PrankWeb v2 API** for both the experimental structure and the AlphaFold DB model; it is a precomputed/on-demand P2Rank 2.5.1 service and needs no GPU. Add **ProtVar** `/prediction/pocket/{acc}/{resid}` to answer "is the patient's variant residue inside a pocket" in one request. Self-host P2Rank only when you need custom structures or throughput.
3. **Tier C — Predicted complex + predicted affinity** (GPU minutes). **Boltz-2 (MIT, code + weights)** as the single primary engine, co-folding and affinity in one job, behind the existing provider adapter. Do **not** build an AutoDock Vina pipeline first: Vina needs PDBQT prep, box definition, protonation and a separate pose/score story, and its score is less informative than Boltz-2's for the same engineering budget. Keep a Vina/GNINA adapter as a deliberately-chosen alternative, not the default.
4. **Tier D — Generation / virtual screening**: out of scope for v1. Expose it as "export target + pocket for external screening" (a pocket-constrained Boltz-2 YAML and a PDB/CIF + box), not as an in-app screen.

Hard rules baked into the product:

- **Never display a predicted affinity without its model id, version, the exact units, and a Tier C badge.** Boltz-2's `affinity_pred_value` is `log₁₀(IC50 / 1 µM)` — a unitless log that is _not_ nM, _not_ kcal/mol, and _not_ comparable to a Vina score.
- **Never co-mingle Tier A and Tier C numbers in one sortable column.** Two separate columns ("Measured affinity" and "Predicted affinity"), each with its own units, each sortable independently.
- **One ligand per Boltz-2 affinity job.** The model accepts exactly one affinity binder chain and degrades silently outside its trained size range.
- **Compound set is curated, not generated, in v1**: approved/clinical drugs for the target, PDB co-crystallised ligands, and ChEMBL actives above a pChEMBL threshold. No de-novo molecules in the default view.
- **2D depiction: server-side RDKit → SVG, cached.** Do not ship the 7.4 MB RDKit WASM to every page load; see [2D depiction](#10-2d-depiction-of-molecules-in-the-browser).

---

## 1. Stage 6 workflow shape

```
protein (UniProt acc) + variant residue
   │
   ├─ A. known ligands & drugs ──── ChEMBL mechanism/activity, Open Targets,
   │                                DrugCentral, BindingDB, PDBe ligand_sites
   ├─ B. pockets ────────────────── PrankWeb (P2Rank), ProtVar pockets, fpocket
   │      └─ is the variant residue in / adjacent to a pocket?
   ├─ C. structure selection ────── PDBe best_structures → experimental;
   │                                AlphaFold DB v6 → predicted; both labelled
   ├─ D. predicted complex ──────── Boltz-2 co-fold (protein + one ligand)
   │      └─ pocket constraint from B to steer the pose
   ├─ E. predicted affinity ─────── Boltz-2 affinity head (same job)
   └─ F. hypothesis record ──────── every row carries source ids + job ids
```

The variant→pocket link (B) is the step that makes this _rare-disease_ rather than generic: a gain-of-function variant inside a druggable pocket is a different hypothesis from one in a protein–protein interface.

---

## 2. Pocket detection

### 2.1 PrankWeb v2 API — **tested, recommended**

Base: `https://prankweb.cz/api/v2`. Code: [cusbg/prankweb](https://github.com/cusbg/prankweb), Apache-2.0, last push 2026-08-22. OpenAPI in-repo at `documentation/prankweb.open-api.yaml`.

| Database id           | Input id                  | Source structure                              |
| --------------------- | ------------------------- | --------------------------------------------- |
| `v3`                  | PDB id (case-insensitive) | PDB entry, P2Rank default model               |
| `v3-conservation-hmm` | PDB id                    | PDB entry + HMM conservation channel          |
| `v3-alphafold`        | **UniProt accession**     | AlphaFold DB model, P2Rank `alphafold` config |

A `GET` on a prediction that does not exist **creates the job** and returns `201` with `status: "queued"`; poll the same URL until `status: "successful"` (observed 12–14 s for both BTK cases).

```bash
# 1. request / poll  (returns 201 queued, then 200 successful)
curl -s https://prankweb.cz/api/v2/prediction/v3/5p9j
# {"created":"2026-10-03T16:36:43","database":"v3","id":"5P9J","metadata":{},"status":"queued"}

curl -s https://prankweb.cz/api/v2/prediction/v3-alphafold/Q06187
# {"...","metadata":{"predictedStructure":true},"status":"queued"}

# 2. results
curl -s https://prankweb.cz/api/v2/prediction/v3/5p9j/public/prediction.json
curl -s -O https://prankweb.cz/api/v2/prediction/v3/5p9j/public/structure.cif      # 125 KB, text/plain
curl -s -O https://prankweb.cz/api/v2/prediction/v3/5p9j/public/prankweb.zip       # 192 KB, application/zip
curl -s    https://prankweb.cz/api/v2/prediction/v3/5p9j/log                       # job log
```

`prediction.json` shape (field names verified):

```jsonc
{
  "structure": {
    "indices":  ["A_394", "A_395", ...],   // chain_authSeqId, one per residue
    "sequence": "…",                        // one letter per index
    "binding":  [14, 22, 34, ...],          // 0-based indices into `indices`
    "regions":  [{"name": "A", "start": 0, "end": 262}],
    "scores":   {"plddt": [0.0, 0.0, ...]}  // all 0.0 for experimental; real pLDDT for v3-alphafold
  },
  "pockets": [{
    "name": "pocket1", "rank": "1",
    "score": "18.49",          // P2Rank raw score, string
    "probability": "0.823",    // calibrated 0–1, string — use this for UI
    "center": ["18.7599", "6.8531", "5.1288"],
    "residues": ["A_408", "A_409", ...],   // same format as structure.indices
    "surface": ["129", "130", ...]          // SAS point ids
  }],
  "metadata": { "p2rank_version": "2.5.1", "alpha-fold": [ /* full AFDB entry record */ ] }
}
```

Observed results for BTK:

| Call                                      | Pockets | Top pocket                                             | Notes                                                         |
| ----------------------------------------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `v3/5p9j` (BTK kinase domain + ibrutinib) | 7       | score 18.49, **prob 0.823**, 25 residues incl. `A_481` | ATP site, matches the ibrutinib Cys481 site                   |
| `v3-alphafold/Q06187` (full-length BTK)   | 13      | score 16.29, prob 0.697, 20 residues                   | more pockets because full-length model includes PH/TH/SH3/SH2 |

Numbers are **strings** in the JSON — coerce. All residue ids are `chain_authSeqId`, so mapping to UniProt coordinates requires SIFTS (use PDBe `graph-api` mappings) for `v3`; for `v3-alphafold` the indices already are UniProt positions.

The `alpha-fold` metadata block is a free bonus: it embeds the full AlphaFold DB record (`entryId: AF-Q06187-F1`, `latestVersion: 6`, `globalMetricValue: 84.44`, `fractionPlddtVeryHigh: 0.511`, `cifUrl`, `paeDocUrl`, `amAnnotationsUrl`), so one PrankWeb call gives you the predicted structure provenance too.

**Docking via PrankWeb is not usable as a service.** The repo OpenAPI documents `GET /docking/{database}/{id}/tasks` and `GET /docking/{database}/{id}/{hash}/public/result.json`, but on the public deployment `GET …/docking/v3/5P9J/tasks` returns **404 with an empty body** and `POST` to it returns **405 Method Not Allowed**. Treat PrankWeb docking (and `tunnels`) as self-host-only (`executor-docking` service in the repo).

### 2.2 P2Rank CLI (self-host)

[rdk/p2rank](https://github.com/rdk/p2rank) — **MIT**, release **2.5.1** (2025-08-07), Java 17+ (README states tested to Java 26). Same engine the PrankWeb service runs.

```bash
prank predict -f structure.pdb                     # default model, X-ray structures
prank predict -c alphafold -f AF-Q06187-F1.cif      # config for AFDB / NMR / cryo-EM models
prank predict dataset.ds                            # batch
```

Outputs per structure: `{name}_predictions.csv` (rank, score, calibrated probability, centre x/y/z, adjacent residue ids, adjacent surface atom ids), `{name}_residues.csv` (per-residue score + pocket assignment), `visualizations/*.pml` / `*.cxc`, `visualizations/data/{name}_points.pdb.gz` (SAS points with ligandability). CPU-only, seconds per protein — this is the cheapest useful compute in Stage 6.

### 2.3 fpocket

[Discngine/fpocket](https://github.com/Discngine/fpocket) — **MIT**, release **4.2.3** (2026-03-09). `fpocket -f 1uyd.pdb`. Reads/writes mmCIF as well as PDB. Geometric (alpha-sphere) rather than ML; useful as an independent second opinion and for pocket volume, which P2Rank does not report. Output filenames and the `_info.txt` score columns are documented only in the in-repo user manual (see [Unverified](#unverified--open-questions)).

### 2.4 ProtVar pocket + stability annotations — **tested, recommended**

Base `https://www.ebi.ac.uk/ProtVar/api`. **OpenAPI at `GET /ProtVar/api/docs`** (not `/api-docs`, `/v3/docs` or `/swagger-ui/…` — all 404). Spec declares `title: ProtVar API`, `version: 2.0`, `license: Creative Commons BY 4.0`.

```bash
curl -s https://www.ebi.ac.uk/ProtVar/api/prediction/pocket/Q06187/481
# [{"structId":"Q06187","pocketId":2,"radGyration":8.371589,"energyPerVol":0.428119,
#   "buriedness":0.85749,"resid":[406,...,603],"meanPlddt":90.8924,"score":986.066}]

curl -s https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/Q06187/481
# [{"proteinAcc":"Q06187","position":481,"afId":"F1","afPos":481,"wildType":"C",
#   "mutatedType":"D","foldxDdg":-3.13268,"plddt":95.62,"numFragments":1,
#   "variantKey":"Q06187:481:D"}, … one row per substitution]

curl -s https://www.ebi.ac.uk/ProtVar/api/prediction/interaction/Q06187/481
curl -s https://www.ebi.ac.uk/ProtVar/api/prediction/interaction/Q06187/P12931/model
```

This is the single highest-value call for the variant→pocket link: **pocket lookup keyed by residue**, in UniProt numbering, precomputed over AlphaFold models, no job queue. Pockets are generated with AutoSite and filtered by mean-pLDDT. Other endpoints worth wiring: `/function/{acc}/{pos}`, `/score/{acc}/{pos}`, `/structure/{acc}/{pos}` (maps a UniProt position into PDB entries), `/population/{acc}/{pos}`.

### 2.5 Cryptic pocket predictors

| Tool                                                  | Code                                                                           | Licence                                 | State 2026-10-03                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PocketMiner (Meller et al., Nat Commun 2023, 14:1177) | [Mickdub/gvp @ `pocket_pred`](https://github.com/Mickdub/gvp/tree/pocket_pred) | **No licence declared** (`NOASSERTION`) | repo last push 2024-02-14; web app `https://pocketminer.azurewebsites.net/` returns **200**; the README's `pocket-miner-ui.azurewebsites.net` **fails to connect**. Output: PDB with per-residue cryptic-pocket probability in the B-factor column. CPU-only. |
| DeepPocket                                            | [devalab/DeepPocket](https://github.com/devalab/DeepPocket)                    | MIT                                     | last push 2025-05-06; CNN rescoring of fpocket candidates                                                                                                                                                                                                     |
| PUResNet                                              | [jivankandel/PUResNet](https://github.com/jivankandel/PUResNet)                | **none declared**                       | last push 2024-09-23                                                                                                                                                                                                                                          |
| CryptoBench (benchmark, not a predictor)              | [skrhakv/CryptoBench](https://github.com/skrhakv/CryptoBench)                  | MIT                                     | last push 2026-06-24 — use to calibrate expectations                                                                                                                                                                                                          |

**Decision:** do not ship a cryptic-pocket predictor in v1. The undeclared licence on PocketMiner makes it unredistributable, and a cryptic pocket is the hardest claim to communicate honestly. If a user needs it, link out.

---

## 3. Docking and co-folding

| Tool                                                                                          | Latest (date)                                                  | Code licence                                          | Weights licence                                                                                                                                                                                                                               | Hardware                                                                                                                            | Output score                                                                                                    |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Boltz-2** [jwohlwend/boltz](https://github.com/jwohlwend/boltz)                             | **v2.2.1** (2025-09-08); PyPI `boltz` 2.2.1, py `>=3.10,<3.13` | **MIT**                                               | **MIT** ("freely used for both academic and commercial purposes")                                                                                                                                                                             | GPU; NVIDIA cuEquivariance kernels when available; CPU works but "significantly slower". NVIDIA's NIM build requires **≥48 GB** GPU | pLDDT/pTM/ipTM + `affinity_pred_value` (log₁₀ IC50 µM) + `affinity_probability_binary`                          |
| **AutoDock Vina** [ccsb-scripps/AutoDock-Vina](https://github.com/ccsb-scripps/AutoDock-Vina) | **v1.2.7** (2025-02-26)                                        | Apache-2.0                                            | n/a                                                                                                                                                                                                                                           | CPU, multi-core                                                                                                                     | **kcal/mol** (Vina or `--scoring ad4`; the two are _not_ comparable)                                            |
| **GNINA** [gnina/gnina](https://github.com/gnina/gnina)                                       | **v1.3.3** (2026-06-29)                                        | **dual GPL / Apache-2.0** (GPL via OpenBabel)         | in-repo                                                                                                                                                                                                                                       | CUDA ≥12.0 to build; `--no_gpu` works                                                                                               | `CNNscore`, `CNNaffinity`, `Energy`; `--pose_sort_order {CNNscore,CNNaffinity,Energy}`                          |
| **DiffDock-L** [gcorso/DiffDock](https://github.com/gcorso/DiffDock)                          | repo default = DiffDock-L; **last push 2025-05-02** (stale)    | **MIT** (code _and_ weights)                          | MIT                                                                                                                                                                                                                                           | GPU strongly recommended; CPU possible with `.pdb` input; first run precomputes SO(2)/SO(3) tables                                  | no physical score; pose confidence only                                                                         |
| **Uni-Dock** [dptech-corp/Uni-Dock](https://github.com/dptech-corp/Uni-Dock)                  | **1.2.0** (2026-06-11)                                         | **Apache-2.0** (relicensed from LGPL-3 on 2025-03-10) | n/a                                                                                                                                                                                                                                           | NVIDIA GPU                                                                                                                          | Vina/Vinardo kcal/mol; ">2000-fold speed-up on V100 GPU … compared to AutoDock Vina running in single CPU core" |
| **Chai-1** [chaidiscovery/chai-lab](https://github.com/chaidiscovery/chai-lab)                | **v0.6.1** (2025-03-18)                                        | **Apache-2.0**                                        | **Apache-2.0** — README: "both code and model weights … can be used for both academic and commerical purposes, including for drug discovery"                                                                                                  | A100 80GB / H100 80GB / L40S 48GB recommended; A10, A30 for small complexes; RTX 4090 reported working; Linux, py≥3.10              | confidence only                                                                                                 |
| **AlphaFold 3** [google-deepmind/alphafold3](https://github.com/google-deepmind/alphafold3)   | **v3.0.4** (2026-07-28)                                        | Apache-2.0                                            | **AlphaFold 3 Model Parameters Terms of Use** — "You may only use AlphaFold 3 model parameters if received directly from Google"; README states it is "not intended, validated, or approved for clinical use … for theoretical modeling only" | CPU data pipeline + GPU inference                                                                                                   | confidence only                                                                                                 |
| **Protenix** [bytedance/Protenix](https://github.com/bytedance/Protenix)                      | **v2.0.0** (2026-04-07)                                        | **Apache-2.0**                                        | **Apache-2.0** — "free for both academic research and commercial use"                                                                                                                                                                         | not stated in README                                                                                                                | confidence only; web server `protenix-server.com`                                                               |
| **NeuralPLexer** [zrqiao/NeuralPLexer](https://github.com/zrqiao/NeuralPLexer)                | last push 2025-10-06                                           | **BSD-3-Clause-Clear**                                | in-repo                                                                                                                                                                                                                                       | GPU                                                                                                                                 | confidence only                                                                                                 |

**Choices for OrphaFold:**

- **Primary:** Boltz-2. One job yields pose + confidence + affinity, MIT end-to-end, no weight-access paperwork.
- **Second provider (optional):** Protenix v2 or Chai-1 — both Apache-2.0 including weights, so a second co-folding opinion carries no licence cost. Neither predicts affinity.
- **Exclude AlphaFold 3 from the default adapter set.** The parameters cannot be redistributed with OrphaFold and must be requested per-deployment from Google; its own README disclaims clinical use. Support it as a bring-your-own-weights adapter only.
- **GNINA's GPL half is a packaging hazard.** If you bundle GNINA in an OrphaFold container, that container inherits GPL obligations. Prefer Vina (Apache-2.0) or Uni-Dock (Apache-2.0) if you need a physics score.
- **Pose preparation is the real cost of a Vina/GNINA path**: receptor and ligand must be PDBQT. The usual open stack is [forlilab/Meeko](https://github.com/forlilab/Meeko) (**LGPL-2.1**) + [forlilab/scrubber](https://github.com/forlilab/scrubber) (**GPL-3.0**) or [durrantlab/gypsum_dl](https://github.com/durrantlab/gypsum_dl) (Apache-2.0). Note the GPL again.

Vina invocation shape (from the official docs):

```bash
vina --receptor rec.pdbqt --ligand lig.pdbqt --config box.txt \
     --exhaustiveness=32 --out out.pdbqt
# box.txt: center_x/center_y/center_z + size_x/size_y/size_z  (Å)
# default --exhaustiveness 8; scores in kcal/mol
```

GNINA invocation shape:

```bash
gnina -r rec.pdb -l lig.sdf --autobox_ligand orig.sdf -o docked.sdf.gz
gnina -r rec.pdb -l lig.sdf --autobox_ligand orig.sdf --cnn_scoring refinement -o out.sdf.gz
gnina -r rec.pdb -l lig.sdf --autobox_ligand orig.sdf --scoring vinardo --cnn_scoring none -o out.sdf.gz
# --cnn_scoring {none,rescore,refinement,all};  --exhaustiveness 8;  --num_modes 9;  --seed N
```

`--autobox_ligand` removes the need to pick a box by hand: pass the co-crystallised ligand from the PDB entry, or synthesise a dummy from the PrankWeb pocket centre.

---

## 4. Boltz-2 co-folding + affinity — exact contract

### 4.1 Input YAML

```yaml
version: 1
sequences:
  - protein:
      id: A
      sequence: MAAVILESIFLKRSQQKKKTSPLNFKKRLFLLTVHKLSYY… # UniProt Q06187
      # msa: ./msa/Q06187.a3m      # required unless --use_msa_server
  - ligand:
      id: B
      smiles: "C=CC(=O)N1CCC[C@@H](n2nc(-c3ccc(Oc4ccccc4)cc3)c3c(N)ncnc32)C1"
      # ccd: 1E8                   # exclusive with smiles
constraints:
  - pocket: # steer the pose with the PrankWeb pocket
      binder: B
      contacts: [[A, 481], [A, 474], [A, 528], [A, 538]]
      max_distance: 6 # Å, supported 4–20, default 6
      force: false # true → inference-time potential enforces it
properties:
  - affinity:
      binder: B # exactly one ligand chain
```

```bash
boltz predict target.yaml --use_msa_server --use_potentials \
  --diffusion_samples 5 --diffusion_samples_affinity 5 \
  --sampling_steps_affinity 200 --output_format mmcif --out_dir ./out
```

Relevant flags: `--affinity_mw_correction` (molecular-weight correction on the value head, default off), `--sampling_steps_affinity` (200), `--diffusion_samples_affinity` (5), `--affinity_checkpoint`, `--recycling_steps` (3), `--use_potentials` (improves physical pose quality), `--msa_server_url` (default `https://api.colabfold.com`), `--write_full_pae`, `--write_full_pde`.

### 4.2 Outputs

```
out/predictions/<input>/
  <input>_model_0.cif                 # best by confidence_score; per-token pLDDT in the CIF
  confidence_<input>_model_0.json
  affinity_<input>.json
  pae_<input>_model_0.npz / pde_…npz / plddt_…npz
```

`confidence_*.json`: `confidence_score` (= `0.8*complex_plddt + 0.2*iptm`, `ptm` for single chains), `ptm`, `iptm`, `ligand_iptm`, `protein_iptm`, `complex_plddt`, `complex_iplddt`, `complex_pde`, `complex_ipde`, `chains_ptm`, `pair_chains_iptm`. All 0–1, higher better, **except** `pde`/`ipde` which are Å, lower better. **`ligand_iptm` is the confidence number to surface for a protein–ligand pose.**

`affinity_<input>.json`:

| Field                                | Meaning (verbatim from `docs/prediction.md`)           | Range / units                                           |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| `affinity_pred_value`                | "Predicted binding affinity from the ensemble model"   | **`log10(IC50)` where IC50 is in µM.** Lower = stronger |
| `affinity_probability_binary`        | "Predicted binding likelihood from the ensemble model" | 0–1, probability the ligand is a binder                 |
| `affinity_pred_value1` / `2`         | per-ensemble-member value                              | same as above                                           |
| `affinity_probability_binary1` / `2` | per-ensemble-member probability                        | 0–1                                                     |

Documented anchor points: IC50 10⁻⁹ M → **−3** (strong); 10⁻⁶ M → **0** (moderate); 10⁻⁴ M → **+2** (weak / decoy). Conversion the docs give: `pIC50 in kcal/mol = (6 − y) * 1.364` where `y = affinity_pred_value`.

### 4.3 Documented caveats — put these in the UI, not just the code

1. **Two heads, two uses, two datasets.** `affinity_probability_binary` is for "detect binders from decoys, for example in a hit-discovery stage". `affinity_pred_value` is for hit-to-lead / lead-optimisation and — verbatim — _"should only be used when comparing different active molecules, not inactives."_ Ranking a curated set of known actives is in-distribution. Ranking a random compound against a known drug is **not**.
2. **One ligand only.** "Only one single small molecule can be specified for affinity computation."
3. **Size limits.** "at most 128 atoms counting heavy atoms and hydrogens kept by `RDKit RemoveHs`, however, we do not recommend running the affinity module with ligands significantly larger than 56 atoms (counted as above, limit set during training)."
4. **Protein targets only.** "if ran with an RNA/DNA/co-factor target, the code will not crash but the output will be unreliable."
5. **Ligand must be a small molecule.** Rules out every protein therapeutic in the IEI mechanism table below (abatacept, emapalumab, IgG, elapegademase) — those rows must show "Not applicable: not a small molecule", never a number.

### 4.4 What it was validated on

Abstract (bioRxiv 10.1101/2025.06.14.659707, v1 posted 2025-06-18, Passaro et al., _Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction_): "the first AI model to approach the performance of free-energy perturbation (FEP) methods in estimating small molecule-protein binding affinity … strong correlation with experimental readouts on many benchmarks, while being at least 1000x more computationally efficient than FEP." The repo's `docs/evaluation.md` names the affinity benchmarks explicitly: **the FEP+ benchmark, CASP16, and the authors' MF-PCBA test set.** Generative-workflow demonstration was on **TYK2**, scored by absolute FEP.

Read that as: validated for _relative ranking of congeneric actives on well-studied targets_. A rare-disease protein with no medicinal-chemistry series around it is outside the validated regime, and the UI must say so.

### 4.5 Hosted option (no local GPU) — tested

NVIDIA ships a Boltz-2 NIM.

```bash
curl -X POST https://health.api.nvidia.com/v1/biology/mit/boltz2/predict \
  -H "Authorization: Bearer $NVIDIA_API_KEY" -H "Content-Type: application/json" -d '{…}'
# verified: without an Authorization header → HTTP 401 "Header of type `authorization` was missing"
```

Self-hosted container: `POST http://localhost:8000/biology/mit/boltz2/predict`, interactive schema at `/docs`. Request body: top-level `polymers[]` (1–12, `{id, molecule_type, sequence}`), `ligands[]` (`{id, smiles | ccd, predict_affinity, output_affinity_embedding}`), plus `recycling_steps`, `sampling_steps`, `diffusion_samples`, `sampling_steps_affinity`, `diffusion_samples_affinity`, `affinity_mw_correction`, `output_format`. **`predict_affinity` is per-ligand, not top-level**, and at most one ligand may set it. Response carries an `affinities` object keyed by ligand id with `affinity_pic50`, `affinity_pred_value`, `affinity_probability_binary`, `model_1_*`, `model_2_*`, `*_embedding` — note the NIM adds a convenience **`affinity_pic50`** that the OSS CLI does not emit. Unknown fields → HTTP 422; errors come back as a flat `{"error": "…"}`, not FastAPI's `detail` array.

Requirements: **≥48 GB GPU memory**; A100-SXM4-80GB, H100 80GB HBM3, L40S, B200/B300/GB200/GB300. Driver ≥590.44.01 with CUDA 13.1.

Published H100 timings (TensorRT backend, v1.6.0) — the numbers to size the job queue with:

| Protein size   | Structure only | With affinity |
| -------------- | -------------- | ------------- |
| ~200 res       | 1.72 s         | 6.21 s        |
| ~500–700 res   | 6.63–9.39 s    | 10.74–14.16 s |
| ~1200–1500 res | 24.67–35.64 s  | 29.69–43.99 s |
| ~2000 res      | 79.55 s        | 81.19 s       |

OSS backend at 200 residues: 11.07 s (≈6.4× slower than TRT). **These exclude MSA generation**, which dominates wall-clock for a cold target — cache MSAs per UniProt accession.

---

## 5. Which Stage 6 computations are feasible as real jobs

| Job                                       | Engine                       | Hardware               | Wall clock              | Verdict                                          |
| ----------------------------------------- | ---------------------------- | ---------------------- | ----------------------- | ------------------------------------------------ |
| Pocket detection, experimental structure  | PrankWeb `v3`                | none (remote)          | ~12 s                   | **Ship v1.** Synchronous-feeling.                |
| Pocket detection, AFDB model              | PrankWeb `v3-alphafold`      | none (remote)          | ~13 s                   | **Ship v1.**                                     |
| Variant-residue pocket lookup             | ProtVar `/prediction/pocket` | none (remote)          | <1 s                    | **Ship v1.**                                     |
| Variant ΔΔG                               | ProtVar `/prediction/foldx`  | none (remote)          | <1 s                    | **Ship v1** (precomputed FoldX 5.0 BuildModel)   |
| Pocket detection, user-uploaded structure | self-hosted P2Rank 2.5.1     | 1 CPU                  | seconds                 | **Ship v1** if uploads exist                     |
| Pocket volume / second opinion            | fpocket 4.2.3                | 1 CPU                  | seconds                 | Optional                                         |
| Co-fold + affinity, one ligand            | Boltz-2                      | 1× ≥48 GB GPU (or NIM) | 10–60 s + MSA           | **Ship v1 as an async job**                      |
| Co-fold + affinity, 20-compound panel     | Boltz-2                      | same                   | ~5–20 min serial        | **Ship v1 as a batch job** with per-row progress |
| Classical docking                         | Vina 1.2.7 / Uni-Dock 1.2.0  | CPU / GPU              | seconds–minutes + prep  | v2, behind an adapter                            |
| Virtual screen, >10⁴ compounds            | Uni-Dock                     | GPU cluster            | hours–days              | **Out of scope.** Export, don't run              |
| De-novo generation                        | REINVENT 4 / SynFormer       | GPU                    | hours                   | **Out of scope for v1**                          |
| ADMET panel on a compound list            | ADMET-AI 2.0.1               | CPU                    | sub-second per molecule | v2 — cheap, but adds 52 more numbers to caveat   |

---

## 6. Virtual screening practice, 2026 — what to actually build

- **The compound universe is make-on-demand, not in-stock.** Enamine states REAL Space "comprises 94.5B make-on-demand molecules". ZINC-22 / CartBlanche (`https://cartblanche.docking.org`, HTTP 200) is the open front door to tranches of that scale.
- **Nobody docks 10¹⁰ molecules naively.** The practised pattern is a funnel: cheap ligand-based or synthon-level filter → fast rigid docking on 10⁶–10⁷ → GPU docking (Uni-Dock) on 10⁵ → ML co-folding + affinity (Boltz-2) on 10²–10³ → FEP or assay on 10¹.
- **Boltz-2's documented place in that funnel is the last two ML rungs**, not the first: `affinity_probability_binary` for binder-vs-decoy triage, `affinity_pred_value` only across actives.
- **For OrphaFold this means: do not build a screen.** Build the **export**: given a target + chosen pocket, emit (a) `receptor.cif` with provenance, (b) pocket centre + residue list + a box, (c) a Boltz-2 YAML template with the `pocket` constraint pre-filled, (d) the curated Tier-A compound list as SMILES + ids. A rare-disease researcher with cluster access can take that straight to Uni-Dock; one without it was never going to run a 10⁹ screen inside a web app.

---

## 7. Open molecular generation systems

| System     | Repo                                                                | Licence        | Latest                       | Shape                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------- | -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REINVENT 4 | [MolecularAI/REINVENT4](https://github.com/MolecularAI/REINVENT4)   | **Apache-2.0** | **v4.8** (2026-06-16)        | TOML (also JSON/YAML) config; run modes sampling / scoring / transfer learning / staged (RL) learning; generators Reinvent, LibInvent, LinkInvent, Mol2Mol, Pepinvent. "A GPU is not strictly necessary but strongly recommended"; ~8 GiB memory. Optional OpenEye ROCS needs a separate commercial licence |
| SynFormer  | [wenhao-gao/synformer](https://github.com/wenhao-gao/synformer)     | Apache-2.0     | last push 2025-01-11         | synthesis-aware generation (projects into synthesizable space)                                                                                                                                                                                                                                              |
| SAFE       | [datamol-io/safe](https://github.com/datamol-io/safe)               | Apache-2.0     | **0.2.1** (2026-09-03)       | SMILES-fragment representation for scaffold-constrained generation                                                                                                                                                                                                                                          |
| DiffSBDD   | [arneschneuing/DiffSBDD](https://github.com/arneschneuing/DiffSBDD) | MIT            | last push 2025-06-25         | structure-based 3D diffusion into a pocket                                                                                                                                                                                                                                                                  |
| Pocket2Mol | [pengxingang/Pocket2Mol](https://github.com/pengxingang/Pocket2Mol) | MIT            | last push 2023-11-16 (stale) | autoregressive 3D generation in a pocket                                                                                                                                                                                                                                                                    |
| TamGen     | [microsoft/TamGen](https://github.com/microsoft/TamGen)             | MIT            | last push 2025-09-24         | target-aware SMILES generation                                                                                                                                                                                                                                                                              |

**Decision:** none in v1. Generated molecules are the single easiest thing for a reader to mistake for a drug candidate, and the honest caveat ("this molecule has never existed") is larger than the feature. If Stage 6 ever generates, every generated row must be visually segregated and carry a synthesizability source (SynFormer/SAFE) plus "not synthesised, not tested, not a compound you can buy".

---

## 8. ADMET prediction

**ADMET-AI** — [swansonk14/admet_ai](https://github.com/swansonk14/admet_ai), **MIT**, release **v_2.0.1** (2026-02-22). `pip install admet-ai`; `admet_predict --data_path data.csv --save_path preds.csv --smiles_column smiles`. Chemprop-RDKit models trained on Therapeutics Data Commons datasets. Live server: `https://admet.ai.greenstonebio.com` (HTTP 200) — **no documented public API**, so self-host or use the CLI.

The shipped property table (`admet_ai/resources/data/admet.csv`) has **52 rows: 31 classification, 21 regression**, each with `category`, `id`, `name`, `units`, `species`, and held-out `AUROC`/`AUPRC`/`R^2`/`MAE` columns — surface those metrics next to any value you display. Verified contents:

- **Physicochemical (11):** Molecular Weight (Da), LogP, HBA, HBD, Lipinski Rule of 5, QED, Stereo Centers, TPSA (Å²), PAINS Alert, BRENK Alert, NIH Alert.
- **Absorption:** Human Intestinal Absorption, Oral Bioavailability, Aqueous Solubility (log mol/L), Lipophilicity, Hydration Free Energy (kcal/mol), Cell Effective Permeability (log 10⁻⁶ cm/s), PAMPA Permeability, P-glycoprotein Inhibition.
- **Distribution:** Blood-Brain Barrier Penetration, Plasma Protein Binding Rate (%), Volume of Distribution at Steady State (L/kg).
- **Metabolism / excretion:** Half Life (hr), Drug Clearance Hepatocyte (µL/min/10⁶ cells), Drug Clearance Microsome (µL/min/mg), CYP1A2/2C19/2C9/2D6/3A4 Inhibition, CYP2C9/2D6/3A4 Substrate.
- **Toxicity:** hERG Blocking, Clinical Toxicity, Mutagenicity, Drug Induced Liver Injury, Carcinogenicity, Acute Toxicity LD50 (log 1/(mol/kg)), Skin Reaction, plus 12 Tox21 endpoints (AR, AR-LBD, AhR, Aromatase, ER, ER-LBD, PPAR-γ, Nrf2/ARE, ATAD5, HSE, Mitochondrial Membrane Potential, p53).

**Decision:** v2, and only as a collapsed "physicochemical profile" panel (MW, LogP, TPSA, HBA/HBD, QED, PAINS/BRENK) computed with RDKit locally — those are deterministic descriptors, not predictions, so they need no model caveat. Hold the 41 model-predicted ADMET endpoints back until the wording rules are proven; a predicted hERG or DILI flag on a rare-disease page is exactly the kind of number a reader will over-read.

---

## 9. Compound and drug data sources

| Source                    | Access                                                                                                                      | Licence                                                                                                                                          | Verified today                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **ChEMBL**                | `https://www.ebi.ac.uk/chembl/api/data/…`                                                                                   | **CC BY-SA 3.0** ("Provided under a Creative Commons Attribution-ShareAlike 3.0 Unported license")                                               | `status.json`: `ChEMBL_37`, released **2026-05-01**, 24,527,044 activities, 2,921,148 distinct compounds, 18,552 targets, `status: UP` |
| **PubChem**               | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/…`                                                                               | NCBI "places no restrictions on the use or distribution of the data contained therein", but third parties may assert rights in deposited content | PUG-REST property, PNG and InChIKey lookups all 200                                                                                    |
| **Open Targets Platform** | `POST https://api.platform.opentargets.org/api/v4/graphql`                                                                  | **CC0 1.0** for Platform data; component ChEMBL remains CC BY-SA 3.0                                                                             | 24 drug/candidate rows for BTK; **schema changed, see below**                                                                          |
| **DrugCentral**           | public Postgres `drugcentral@unmtid-dbs.net:5433` (user `drugman`, password `dosage`) + dumps at `drugcentral.org/download` | **CC BY-SA 4.0**                                                                                                                                 | TCP open; queries returned rows; `select * from dbversion` → **54 / 2023-11-01**, i.e. the public mirror lags the 2026-09-25 dump      |
| **BindingDB**             | `https://www.bindingdb.org/rest/…`                                                                                          | see [Unverified](#unverified--open-questions)                                                                                                    | `getLigandsByUniprot?uniprot=Q06187` → **1958 hits**; legacy `/axis2/services/BDBService/…` paths are **404**                          |
| **PDB (RCSB)**            | `search.rcsb.org`, `data.rcsb.org/graphql`                                                                                  | **CC0 1.0** for archive data _and_ for RCSB-produced molecular images; RCSB software MIT/Apache-2.0                                              | search + GraphQL + `cdn.rcsb.org` CCD SVG all 200                                                                                      |
| **PDBe**                  | `https://www.ebi.ac.uk/pdbe/graph-api/…`, `/pdbe/api/…`                                                                     | EMBL-EBI terms (archive data is the same CC0 PDB archive)                                                                                        | `ligand_sites/Q06187` → **175 ligands**; `best_structures/Q06187` → **301** entries                                                    |
| **AlphaFold DB**          | `https://alphafold.ebi.ac.uk/api/prediction/{acc}`                                                                          | **CC-BY-4.0** — "Data is available for academic and commercial use, under a CC-BY-4.0 licence"                                                   | `Q06187` → `AF-Q06187-F1`, `latestVersion: 6`, created 2025-08-01, mean pLDDT 84.44                                                    |
| **UniChem**               | `POST https://www.ebi.ac.uk/unichem/api/v1/compounds`                                                                       | EMBL-EBI terms                                                                                                                                   | ibrutinib InChIKey → **357 source mappings**                                                                                           |
| **openFDA**               | `https://api.fda.gov/drug/{label,drugsfda}.json`                                                                            | US public data                                                                                                                                   | label + drugsfda queries 200                                                                                                           |
| **DrugBank**              | `go.drugbank.com`                                                                                                           | **Most datasets CC BY-NC 4.0**; "Open Data" subsets CC0; **"All Academic DrugBank dataset downloads are temporarily paused"** as of today        | n/a                                                                                                                                    |

**DrugBank decision: do not ingest DrugBank.** CC BY-NC 4.0 is incompatible with an open research platform that may be used commercially, academic downloads are paused, and everything OrphaFold needs is reachable from ChEMBL + DrugCentral + Open Targets + openFDA. Keep DrugBank **IDs** as outbound links only — UniChem gives you the id for free and linking is not redistribution.

### 9.1 Tested calls — known drugs and ligands for BTK (`CHEMBL5251` / `Q06187`)

**Target record**

```bash
curl -s 'https://www.ebi.ac.uk/chembl/api/data/target/CHEMBL5251.json'
# pref_name "Tyrosine-protein kinase BTK", target_type SINGLE PROTEIN, tax_id 9606,
# target_components[0].accession "Q06187"
```

**Mechanism of action → the drug list** (`total_count: 22`)

```bash
curl -s 'https://www.ebi.ac.uk/chembl/api/data/mechanism.json?target_chembl_id=CHEMBL5251&limit=200'
# fields: molecule_chembl_id, parent_molecule_chembl_id, mechanism_of_action, action_type,
#         max_phase, direct_interaction, molecular_mechanism, disease_efficacy,
#         binding_site_comment, selectivity_comment, mechanism_refs[], site_id, variant_sequence
```

**Resolve names, phases, structures**

```bash
curl -s 'https://www.ebi.ac.uk/chembl/api/data/molecule.json?molecule_chembl_id__in=CHEMBL1873475,CHEMBL3707348,CHEMBL3936761,CHEMBL4071161,CHEMBL4650485&only=molecule_chembl_id,pref_name,max_phase,first_approval,molecule_type,molecule_structures'
```

| ChEMBL id     | Name                  | `max_phase` | `first_approval` | Type           |
| ------------- | --------------------- | ----------- | ---------------- | -------------- |
| CHEMBL1873475 | IBRUTINIB             | 4           | 2013             | Small molecule |
| CHEMBL3707348 | ACALABRUTINIB         | 4           | 2017             | Small molecule |
| CHEMBL3936761 | ZANUBRUTINIB          | 4           | 2019             | Small molecule |
| CHEMBL4071161 | TIRABRUTINIB          | 4           | 2020             | Small molecule |
| CHEMBL4594293 | ACALABRUTINIB MALEATE | 4           | 2020             | Small molecule |
| CHEMBL4650485 | PIRTOBRUTINIB         | 4           | 2023             | Small molecule |

**Measured affinity for one compound against one target** (`total_count: 239` for ibrutinib × BTK)

```bash
curl -s 'https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=CHEMBL5251&molecule_chembl_id=CHEMBL1873475&only=standard_type,standard_relation,standard_value,standard_units,pchembl_value,assay_chembl_id,assay_description,bao_label,document_chembl_id,document_year&limit=20'
# e.g. IC50 = 0.5 nM, pchembl_value 9.30, assay CHEMBL1918488, 2011
#      IC50 <= 0.5 nM, pchembl_value null   ← honour standard_relation; null pChEMBL for censored values
```

Target-wide potent actives: `…/activity.json?target_chembl_id=CHEMBL5251&standard_type=IC50&pchembl_value__gte=8` → **6,865** rows. Always filter on `standard_relation == "="`, `standard_units == "nM"`, `data_validity_comment is null`, and prefer `bao_format == BAO_0000357` ("single protein format") over cell-based assays. Per-row `ligand_efficiency` (`le`, `bei`, `sei`, `lle`) comes free.

**Analogue expansion** (works; note scores are strings with float noise)

```bash
curl -s 'https://www.ebi.ac.uk/chembl/api/data/similarity/<URL-ENCODED-SMILES>/80.json?only=molecule_chembl_id,pref_name,similarity&limit=25'
# ibrutinib @ 80% → total_count 20; CHEMBL1873475 similarity "100", CHEMBL3669312 "90.476191043853759765625"
```

**Open Targets — schema has changed; `knownDrugs` is gone**

```graphql
query ($id: String!) {
  target(ensemblId: $id) {
    approvedSymbol
    tractability {
      label
      modality
      value
    }
    drugAndClinicalCandidates {
      # replaces knownDrugs
      count
      rows {
        id
        maxClinicalStage # "PHASE_4" | "PREAPPROVAL" | "APPROVAL" | …
        drug {
          id
          name
          drugType
          maximumClinicalStage
          molblock
          mechanismsOfAction {
            uniqueActionTypes
            rows {
              mechanismOfAction
              actionType
            }
          }
        }
        diseases {
          disease {
            id
            name
          }
        } # ClinicalDiseaseListItem wrapper, not Disease directly
      }
    }
  }
}
```

```bash
curl -s -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"…","variables":{"id":"ENSG00000010671"}}'
```

Gotchas confirmed by introspection: `Target.knownDrugs` → **`drugAndClinicalCandidates`** (type `clinicalTargets`, rows of `ClinicalTargetFromTarget`); `Tractability` fields are `{label, modality, value}` (no `id`); `Drug.maximumClinicalTrialPhase` → **`maximumClinicalStage`**; `Drug.isApproved` **removed**; `tradeNames` is `[DrugLabelAndSource!]!` and needs a sub-selection; `diseases` elements are `ClinicalDiseaseListItem { diseaseFromSource disease }`. `Drug.molblock` exists — a free 2D depiction source.

BTK result: `count 24`; tractability TRUE buckets — SM: _Approved Drug, Structure with Ligand, High-Quality Ligand, High-Quality Pocket, Druggable Family_; AB: _UniProt loc high conf, GO CC high conf, Human Protein Atlas loc_; PR: _Phase 1 Clinical, Literature, Database Ubiquitination, Half-life Data, Small Molecule Binder_. **Surface the SM/AB/PR tractability buckets in Stage 6's header** — it is the single most honest one-line answer to "is this protein druggable at all", and it is sourced, not predicted.

**PDBe — experimental binding regions in UniProt coordinates** (the best "binding region" source)

```bash
curl -s https://www.ebi.ac.uk/pdbe/graph-api/uniprot/ligand_sites/Q06187
```

```jsonc
{ "Q06187": { "sequence": "…", "length": 659, "dataType": "…", "processed_protein_start": …,
  "data": [ {                                  // 175 entries for Q06187
    "name": "…", "accession": "A1JR3",         // CCD code
    "additionalData": { "scaffoldId": "…", "chemblId": "", "drugBankId": "",
                        "numAtoms": 18.0, "pdbEntries": ["9rn5"],
                        "significance": 10, "isSolvent": false },
    "residues": [ { "startIndex": 12, "endIndex": 12, "startCode": "LYS",
                    "indexType": "UNIPROT",
                    "interactingPDBEntries": [{"pdbId":"9rn5","entityId":1,"chainIds":"A"}],
                    "allPDBEntries": ["9rn5"] } ] } ] } }
```

**Filter on `additionalData.isSolvent == false`** — otherwise sulfate, glycerol and β-mercaptoethanol land in your "known ligands" list. `chemblId`/`drugBankId` give you the cross-link when the depositor's ligand is a known drug.

**Structure selection**

```bash
curl -s https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/Q06187
# 301 entries; first: {"pdb_id":"6vxq","chain_id":"A","experimental_method":"X-ray diffraction",
#  "resolution":1.4,"unp_start":371,"unp_end":659,"start":5,"end":293,"coverage":0.439}
```

Note `coverage 0.439`: the best experimental BTK structure covers only the kinase domain. **This is the normal case for IEI genes and is exactly why the AlphaFold-model path must be first-class, clearly labelled, and never silently substituted.**

**Ligand-bound entries + ligand chemistry (RCSB)**

```bash
curl -s -X POST https://search.rcsb.org/rcsbsearch/v2/query -H 'Content-Type: application/json' -d '{
 "query":{"type":"group","logical_operator":"and","nodes":[
   {"type":"terminal","service":"text","parameters":{"attribute":"rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession","operator":"exact_match","value":"Q06187"}},
   {"type":"terminal","service":"text","parameters":{"attribute":"rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name","operator":"exact_match","value":"UniProt"}},
   {"type":"terminal","service":"text","parameters":{"attribute":"rcsb_nonpolymer_instance_annotation.type","operator":"exact_match","value":"HAS_COVALENT_LINKAGE"}}]},
 "return_type":"entry",
 "request_options":{"paginate":{"start":0,"rows":5},"results_content_type":["experimental"]}}'
# total_count 57 → 3OCS, 4YHF, 5J87, 5P9J, 5P9K
```

```graphql
{
  entries(entry_ids: ["3OCS", "5P9J"]) {
    rcsb_id
    struct {
      title
    }
    exptl {
      method
    }
    rcsb_entry_info {
      resolution_combined
    }
    nonpolymer_entities {
      rcsb_nonpolymer_entity {
        pdbx_description
      }
      nonpolymer_comp {
        chem_comp {
          id
          name
          formula_weight
        }
        rcsb_chem_comp_descriptor {
          SMILES_stereo
          InChIKey
        }
      }
      nonpolymer_entity_instances {
        rcsb_nonpolymer_entity_instance_container_identifiers {
          auth_asym_id
          auth_seq_id
          comp_id
        }
      }
    }
  }
}
```

`POST https://data.rcsb.org/graphql`. Field-name traps verified: the instance list is **`nonpolymer_entity_instances`** (not `rcsb_…_instances`), and `comp_id` lives on the _instance_ container identifiers, not the entity's. 5P9J → ligand `8E8`, MW 442.513, InChIKey `ROGRQCNRPWIQJN-GOSISDBHSA-N`, instance `A/701`. 3OCS → ligand `746` (MW 579.689) **plus `BME` and three `SO4`** — solvent filtering is mandatory here too.

**Chemical component dictionary**

```bash
curl -s https://www.ebi.ac.uk/pdbe/api/pdb/compound/summary/8E8
# formula, weight, formal_charge, compound_type, inchi, inchi_key, smiles[{program,version,name}],
# systematic_names[], first_observed_in[], release_status, creation_date, revision_date
```

**Cross-reference every id from one InChIKey**

```bash
curl -s -X POST https://www.ebi.ac.uk/unichem/api/v1/compounds -H 'Content-Type: application/json' \
  -d '{"type":"inchikey","compound":"XYFPWWZEPKGCCK-GOSISDBHSA-N"}'
# 357 sources; useful ones: chembl CHEMBL1873475 | drugbank DB09053 | rcsb_pdb 1E8 | pdbe 1E8 |
# chebi CHEBI:76612 | pubchem 24821094 | bindingdb 50357312 | drugcentral 4810 |
# fdasrs 1X70OSD4VX (UNII) | comptox DTXSID60893450 | surechembl 201859
```

This is the join key for the whole comparison table. **Canonicalise on InChIKey, carry every source id.**

**BindingDB**

```bash
curl -s 'https://www.bindingdb.org/rest/getLigandsByUniprot?uniprot=Q06187'
# {"getLindsByUniprotResponse": {"bdb.hit":"1958","bdb.uniprot_length":"659","bdb.primary":"Q06187",
#   "bdb.alternative":[…], "bdb.affinities":[{"bdb.monomerid":287152,"bdb.smile":"…",
#   "bdb.affinity_type":"IC50","bdb.affinity":" 550"}, …]}}

curl -s 'https://www.bindingdb.org/rest/getLigandsByUniprots?uniprot=Q06187,P00533&code=2&response=application/json'
# richer: {"getLindsByUniprotsResponse":{"affinities":[{"query":"…","monomerid":"…","smile":"…",
#   "affinity_type":"Ki","affinity":"1000000","pmid":"2552117","doi":"10.1021/jm00130a020"}]}}
```

Three gotchas, all observed: (1) the envelope key is **misspelled** `getLindsByUniprot(s)Response` — hard-code the typo; (2) the plural endpoint drops the `bdb.` key prefix that the singular one uses; (3) affinity values arrive as strings with **leading whitespace and relational prefixes** (`" 550"`, `"<100"`) — parse the relation out, don't `float()` blindly. The old `/axis2/services/BDBService/…` SOAP-style paths return 404; use `/rest/`.

**DrugCentral**

```bash
PGPASSWORD=dosage psql -h unmtid-dbs.net -p 5433 -U drugman -d drugcentral -c "
  select s.id, s.name, a.act_type, a.act_value, a.act_unit, a.act_source, a.moa, a.action_type, a.tdl
  from act_table_full a join structures s on s.id = a.struct_id
  where a.accession = 'Q06187' order by a.act_value desc nulls last;"
# zanubrutinib IC50 9.52 | ibrutinib Ki 9.143 | dasatinib Kd 8.85 | acalabrutinib IC50 8.292 …
# moa=1 rows: ibrutinib, acalabrutinib, zanubrutinib, tirabrutinib hydrochloride, pirtobrutinib (all tdl=Tclin)
```

**`act_unit` is empty and `act_value` is already −log₁₀(M)** — i.e. pIC50/pKi/pKd. Verified by cross-check: ibrutinib Ki 9.143 = 0.72 nM. Do not label these "nM". `tdl` gives the Target Development Level (`Tclin`/`Tchem`/`Tbio`/`Tdark`) for free.

**Regulatory grounding (openFDA)**

```bash
curl -s 'https://api.fda.gov/drug/drugsfda.json?search=products.active_ingredients.name:"LENIOLISIB+PHOSPHATE"&limit=2'
# NDA217759 | PHARMING | JOENJA | submission_type ORIG, submission_status AP, date 20230324

curl -s 'https://api.fda.gov/drug/label.json?search=leniolisib&limit=1'
# "JOENJA is indicated for the treatment of activated phosphoinositide 3-kinase delta (PI3Kδ)
#  syndrome (APDS) in adult and pediatric patients 12 years of age and older."
```

**openFDA gotcha:** the JOENJA label record has **no `openfda` block**, so `search=openfda.generic_name:"leniolisib"` and `search=openfda.brand_name:"JOENJA"` both return 404 while plain full-text `search=leniolisib` returns the record. Always fall back to full-text.

---

## 10. 2D depiction of molecules in the browser

| Option                              | Size / cost                                                  | Licence                                           | Verdict                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Server-side RDKit → SVG, cached** | one Python call, cache by InChIKey                           | RDKit **BSD-3-Clause**, PyPI `rdkit` **2026.3.6** | **Default.** Deterministic, identical in every browser, zero client JS, cacheable forever (molecules don't change)                                                                                                                                                                                                                                                             |
| **ChEMBL image endpoint**           | one request                                                  | ChEMBL CC BY-SA 3.0                               | Fine for a link-out thumbnail. `GET https://www.ebi.ac.uk/chembl/api/data/image/CHEMBL1873475.svg?dimensions=400` → 200, `image/svg+xml`, 20 KB, RDKit-generated. **PNG is dead**: `.png` returns **HTTP 400** with `<exception>PNG format has been deprecated, please use SVG.</exception>`                                                                                   |
| **PDBe / RCSB CCD images**          | one request                                                  | PDB data CC0; RCSB images CC0                     | For PDB ligands. `https://www.ebi.ac.uk/pdbe/static/files/pdbechem_v2/8E8_400.svg` → 200 SVG 20 KB; `https://cdn.rcsb.org/images/ccd/labeled/8/8E8.svg` → 200 SVG 17 KB (note the `/8/` first-character shard)                                                                                                                                                                 |
| **PubChem PNG**                     | one request                                                  | NCBI                                              | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/ibrutinib/PNG?image_size=300x300` → 200 `image/png` 3.4 KB. Raster, so no good for retina/zoom                                                                                                                                                                                                                        |
| **RDKit.js (MinimalLib WASM)**      | **`RDKit_minimal.js` 106 KB + `RDKit_minimal.wasm` 7.38 MB** | **BSD-3-Clause**, npm `@rdkit/rdkit` **2026.9.1** | Only where the client must _re-draw_ interactively: substructure highlighting of the docked contact atoms, template-aligned depiction across a series. Lazy-load on demand, never on first paint. **Not on cdnjs** (`api.cdnjs.com` search for "rdkit" → 0 results); use `https://unpkg.com/@rdkit/rdkit@2026.9.1/dist/RDKit_minimal.js` or the jsDelivr equivalent (both 200) |
| **smiles-drawer**                   | `dist/smiles-drawer.min.js` **197 KB**, no WASM              | **MIT**, npm **2.4.1**                            | The pragmatic middle: 38× smaller than RDKit WASM, pure JS, good enough for a table cell. Also not on cdnjs; unpkg 200                                                                                                                                                                                                                                                         |

RDKit.js API verified from the shipped `dist/RDKit_minimal.d.ts`:

```js
const RDKit = await initRDKitModule();          // from RDKit_minimal.js
RDKit.version();                                // string
RDKit.prefer_coordgen(true);                    // nicer 2D layouts
const mol = RDKit.get_mol(smiles);              // Mol | null  — ALWAYS null-check
if (mol?.is_valid()) {
  const svg = mol.get_svg(300, 200);
  const hl  = mol.get_svg_with_highlights(JSON.stringify({ atoms: [...], bonds: [...] }));
  mol.generate_aligned_coords(templateMol, {});  // consistent orientation across a series
  mol.normalize_depiction(); mol.straighten_depiction();
  mol.get_descriptors();                         // JSON string: MW, LogP, TPSA, …
}
mol?.delete();                                   // MANDATORY — WASM heap is not GC'd
```

Every `Mol` and `MolList` is a `ClassHandle` with `delete()`/`deleteLater()`. A table that creates a `Mol` per row and never deletes leaks the WASM heap until the tab dies.

**Build decision:** FastAPI endpoint `GET /api/v1/compound/{inchikey}/depiction.svg?w=&h=&highlight=` → RDKit `MolDraw2DSVG`, `Cache-Control: public, max-age=31536000, immutable`, keyed on InChIKey + params. Fall back to the ChEMBL/PDBe SVG endpoint only when OrphaFold has no structure for the compound. Reach for RDKit.js only in the pose viewer, lazily.

---

## 11. Therapeutic mechanism classes relevant to inborn errors of immunity

All ChEMBL ids, `first_approval` years and mechanisms below were pulled live from the ChEMBL 37 API today; FDA application numbers and indication text from openFDA.

| Mechanism class                                       | Real example                                                           | Identifiers (verified)                                                                                                                                                                                                                                              | Target / mechanism (ChEMBL)                                                                                                                                                          | Modality for Stage 6                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Targeted small molecule, gain-of-function disease** | **Leniolisib** (JOENJA) for **APDS** / activated PI3Kδ syndrome        | CHEMBL3643413, `max_phase 4`, `first_approval 2023`; **NDA217759**, sponsor PHARMING, ORIG **AP 2023-03-24**                                                                                                                                                        | CHEMBL3130 — "PI3-kinase p110-delta subunit inhibitor", INHIBITOR                                                                                                                    | **Dockable / affinity-predictable.** The canonical Stage 6 case: a GOF variant creates a hyperactive enzyme and a small molecule turns it down |
| **Targeted small molecule, GOF receptor**             | **Mavorixafor** (XOLREMDI) for **WHIM syndrome** (CXCR4 GOF)           | CHEMBL518924, `max_phase 4`, `first_approval 2024`; **NDA218709**, sponsor X4 PHARMS, ORIG **AP 2024-04-26**; label: "indicated in patients 12 years of age and older with WHIM syndrome … to increase the number of circulating mature neutrophils and lympocytes" | CHEMBL2107 — "C-X-C chemokine receptor type 4 antagonist", ANTAGONIST                                                                                                                | **Dockable** (GPCR; pocket detection on a GPCR needs care)                                                                                     |
| **JAK inhibition for interferon/STAT GOF**            | **Ruxolitinib**, **Baricitinib**                                       | CHEMBL1789941 (`4`, 2011); CHEMBL2105759 (`4`, 2017)                                                                                                                                                                                                                | Baricitinib → CHEMBL2835 JAK1 + CHEMBL2971 JAK2, INHIBITOR. **Ruxolitinib's `mechanism.json` for CHEMBL1789941 returns 0 rows** — resolve via `parent_molecule_chembl_id`/salt forms | **Dockable.** Use for STAT1/STAT3 GOF-type hypotheses                                                                                          |
| **Costimulation blockade (fusion protein)**           | **Abatacept** for **CTLA-4 haploinsufficiency / LRBA deficiency**      | CHEMBL1201823, `max_phase 4`, `first_approval 2006`, `molecule_type` **Protein**                                                                                                                                                                                    | CHEMBL2364156 CD86 inhibitor + CHEMBL2364157 CD80 inhibitor                                                                                                                          | **Not dockable.** CTLA4-Ig; Stage 6 must render "Not applicable — not a small molecule"                                                        |
| **Enzyme replacement**                                | **Elapegademase-lvl** (REVCOVI) for **ADA-SCID**                       | CHEMBL3990026, `max_phase 4`, `first_approval 2018`, `molecule_type` **Enzyme**; **BLA761092**; label: "indicated for the treatment of adenosine deaminase severe combined immune deficiency (ADA-SCID) in pediatric and adult patients"                            | CHEMBL2364177 "2'-deoxyadenosine hydrolytic enzyme", CHEMBL2364178 "Adenosine hydrolytic enzyme", HYDROLYTIC ENZYME                                                                  | **Not dockable.** The intervention _is_ the missing enzyme                                                                                     |
| **Cytokine neutralisation**                           | **Emapalumab** for primary **HLH**                                     | CHEMBL3989977, `max_phase 4`, `first_approval 2018`, `molecule_type` **Antibody**                                                                                                                                                                                   | CHEMBL3286073 — "Interferon gamma inhibitor", INHIBITOR                                                                                                                              | **Not dockable**                                                                                                                               |
| **IL-1 axis blockade (autoinflammatory / NLRP3 GOF)** | **Anakinra**; **Canakinumab**                                          | CHEMBL1201570 (`4`, 2001, Protein); CHEMBL1201834 (`4`, 2009, Antibody)                                                                                                                                                                                             | CHEMBL1959 "Interleukin-1 receptor antagonist", ANTAGONIST; CHEMBL1909490 "Interleukin-1 beta inhibitor", INHIBITOR                                                                  | **Not dockable**                                                                                                                               |
| **Immunoglobulin replacement**                        | IgG replacement for agammaglobulinaemia / CVID                         | no single ChEMBL molecule; product-level                                                                                                                                                                                                                            | n/a — substitutes the missing effector                                                                                                                                               | **Not dockable.** Mechanism-class card only, no compound row                                                                                   |
| **HSCT**                                              | Allogeneic haematopoietic stem cell transplantation for SCID, WAS, CGD | procedure, not a molecule                                                                                                                                                                                                                                           | replaces the haematopoietic compartment                                                                                                                                              | **Not dockable.** Mechanism-class card only                                                                                                    |
| **Gene therapy / gene addition**                      | _ex vivo_ autologous CD34+ gene-corrected cells                        | product-level, not a ChEMBL small molecule                                                                                                                                                                                                                          | restores the gene product                                                                                                                                                            | **Not dockable.** Mechanism-class card only                                                                                                    |

**Product requirement that falls out of this table:** 6 of 10 mechanism classes relevant to IEI are **not small molecules**. A Stage 6 that only does docking would be scientifically misleading about how IEI is actually treated. Ship a **"Mechanism classes for this gene"** panel alongside the compound table, sourced from ChEMBL `mechanism` + Open Targets `drugAndClinicalCandidates` (which returns antibodies, proteins and "Unknown" drug types too), with a `modality` field that decides whether a compute row is even offered.

Also: **ChEMBL `drug_indication` does not know about ultra-rare indications.** For CHEMBL3643413 (leniolisib) it returns a single row — `mesh_heading "Neoplasms"`, `efo_term "neoplasm"`, `max_phase_for_ind 3`. APDS is absent. For CHEMBL518924 (mavorixafor) it lists renal carcinoma, melanoma, HIV, Waldenström, neutropenia, breast cancer, neoplasm — **WHIM syndrome is absent.** Source rare-disease indications from the **openFDA label** and Open Targets `diseases`, never from ChEMBL `drug_indication` alone.

---

## 12. Data model — compound comparison table

```ts
/** A compound, canonicalised on InChIKey. Chemistry only; no target, no scores. */
interface Compound {
  inchikey: string; // PRIMARY KEY (14-10-1 form)
  smiles: string; // isomeric; from ChEMBL molecule_structures.canonical_smiles
  // or PubChem property `SMILES` (NOT `CanonicalSMILES`)
  inchi: string;
  name: string | null; // ChEMBL pref_name, else CCD name, else null
  molecularFormula: string;
  molecularWeight: number; // Da
  molecule_type:
    | "Small molecule"
    | "Antibody"
    | "Protein"
    | "Enzyme"
    | "Oligonucleotide"
    | "Unknown";
  /** Decides whether any compute row is offered at all. */
  modality:
    "small_molecule" | "biologic" | "cell_or_gene_therapy" | "procedure";
  xrefs: {
    // all from UniChem; store every one you get
    chembl?: string;
    pubchem?: string;
    drugcentral?: string;
    drugbank?: string;
    pdbCcd?: string;
    chebi?: string;
    bindingdb?: string;
    unii?: string;
  };
  depictionSvgUrl: string; // /api/v1/compound/{inchikey}/depiction.svg
}

/** Regulatory / clinical status. Tier A. */
interface ClinicalStatus {
  maxPhase: 0 | 1 | 2 | 3 | 4; // ChEMBL molecule.max_phase
  firstApprovalYear: number | null; // ChEMBL molecule.first_approval
  openTargetsMaxStage: string | null; // "PHASE_4" | "PREAPPROVAL" | "APPROVAL" | …
  fdaApplicationNumber: string | null; // openFDA drugsfda, e.g. "NDA217759"
  labelledIndications: Array<{
    text: string;
    source: "openFDA_label";
    applicationNumber: string;
  }>;
  isApprovedForThisDisease: boolean | null; // null until a human curates it
}

/** Measured affinity. Tier A. Never merged with PredictedAffinity. */
interface MeasuredAffinity {
  assayType: "IC50" | "Ki" | "Kd" | "EC50" | "Potency" | string; // ChEMBL standard_type
  relation: "=" | "<" | "<=" | ">" | ">=" | "~"; // standard_relation — show it
  value: number; // standard_value
  units: "nM"; // standard_units; reject rows with other units
  pActivity: number | null; // pchembl_value; null for censored values
  assayFormat: string | null; // bao_label, e.g. "single protein format"
  assayDescription: string | null;
  source: {
    db: "ChEMBL" | "BindingDB" | "DrugCentral";
    recordId: string; // assay_chembl_id | bdb.monomerid | act_id
    documentId: string | null; // document_chembl_id | pmid | doi
    year: number | null;
    url: string;
  };
}

/** A pocket / binding region. Tier A when experimental, Tier B when predicted. */
interface BindingRegion {
  kind: "experimental_ligand_site" | "predicted_pocket";
  label: string; // "ATP site (kinase hinge)" | "pocket1"
  uniprotResidues: number[]; // ALWAYS UniProt numbering in the API layer
  structureResidues?: string[]; // raw "A_481" form, kept for the 3D viewer
  centroid?: [number, number, number]; // Å, structure frame
  containsVariantResidue: boolean; // the Stage-6 money field
  // predicted_pocket only:
  prankScore?: number; // P2Rank raw score
  prankProbability?: number; // 0–1 calibrated — show this, not the raw score
  protvarBuriedness?: number;
  protvarMeanPlddt?: number;
  tool?: { name: "P2Rank" | "AutoSite(ProtVar)" | "fpocket"; version: string };
  // experimental_ligand_site only:
  evidencePdbIds?: string[];
  evidenceLigandCcd?: string;
  source: {
    db: "PDBe" | "RCSB" | "PrankWeb" | "ProtVar";
    url: string;
    retrievedAt: string;
  };
}

/** Predicted pose. Tier C. Always a child of a Job. */
interface PredictedPose {
  jobId: string;
  structureUri: string; // CIF of the predicted complex
  receptor: StructureProvenance; // see below — what we folded against
  ligandChainId: string;
  confidence: {
    // Boltz-2 confidence_*.json, verbatim names
    confidence_score: number;
    ptm: number;
    iptm: number;
    ligand_iptm: number; // the one to surface for protein–ligand
    complex_plddt: number;
    complex_iplddt: number;
    complex_pde: number;
    complex_ipde: number; // Å, lower better
  };
  pocketConstraint: {
    contacts: Array<[string, number]>;
    maxDistance: number;
    forced: boolean;
  } | null;
}

/** Predicted affinity. Tier C. Units are part of the type, not a UI afterthought. */
interface PredictedAffinity {
  jobId: string;
  model: {
    name: "Boltz-2";
    version: "2.2.1";
    weights: "boltz2_conf+aff (MIT)";
  };
  /** log10(IC50 / 1 µM). NOT nM. NOT kcal/mol. Lower = stronger. */
  affinity_pred_value: number;
  affinity_pred_value1: number;
  affinity_pred_value2: number;
  /** P(binder). Use for binder-vs-decoy triage ONLY. */
  affinity_probability_binary: number;
  affinity_probability_binary1: number;
  affinity_probability_binary2: number;
  /** Derived for display only; always shown next to the raw log value, never instead of it. */
  derived: {
    unitsLabel: "log₁₀(IC50 / µM)";
    approxIC50_uM: number; // 10 ** affinity_pred_value
    pIC50_kcalPerMol: number; // (6 - affinity_pred_value) * 1.364, per Boltz docs
  };
  settings: {
    diffusion_samples_affinity: number;
    sampling_steps_affinity: number;
    affinity_mw_correction: boolean;
  };
  /** Set when the run left the validated envelope; the UI must render these. */
  appliedCaveats: Array<
    | "comparison_only_across_actives"
    | "ligand_heavy_atoms_above_56"
    | "non_protein_target"
    | "receptor_is_predicted_structure"
    | "no_congeneric_series_for_target"
  >;
}

/** What we folded against, and how sure we are of it. */
interface StructureProvenance {
  kind: "experimental" | "predicted_public" | "predicted_orphafold";
  // experimental
  pdbId?: string;
  chainId?: string;
  method?: string;
  resolutionAngstrom?: number;
  uniprotCoverage?: number; // PDBe best_structures.coverage
  // predicted_public (AlphaFold DB)
  afdbEntryId?: string; // "AF-Q06187-F1"
  afdbModelVersion?: number; // 6 as of today
  meanPlddt?: number; // 84.44 for Q06187
  // predicted_orphafold
  jobId?: string;
  engine?: string;
  engineVersion?: string;
  license: string;
  sourceUrl: string;
  retrievedAt: string; // ISO8601
}

/** One row of the comparison table. */
interface CompoundComparisonRow {
  compound: Compound;
  clinical: ClinicalStatus;
  measured: MeasuredAffinity[]; // [] when none; never substitute a prediction
  bestMeasured: MeasuredAffinity | null; // chosen by an explicit, documented rule
  bindingRegion: BindingRegion | null;
  pose: PredictedPose | null; // null unless a job ran
  predicted: PredictedAffinity | null; // null unless a job ran
  evidenceTier: "A_experimental" | "B_geometry" | "C_predicted" | "D_generated";
  provenance: {
    sources: SourceRef[];
    computedAt: string | null;
    jobIds: string[];
  };
}

interface SourceRef {
  db: string;
  version: string | null;
  recordId: string;
  url: string;
  license: string; // "CC BY-SA 3.0" | "CC0 1.0" | …
  retrievedAt: string;
}
```

Persistence notes:

- `compound` keyed on **InChIKey**, not ChEMBL id — the same molecule arrives as CHEMBL1873475, CID 24821094, CCD `1E8`, DrugCentral 4810 and BindingDB 50357312, and UniChem resolves all five from one InChIKey.
- Store the **whole** `affinity_*.json` and `confidence_*.json` blobs verbatim as JSONB next to the typed columns. When Boltz-2 3 changes a field you will want the original.
- `bestMeasured` selection rule, documented in the UI tooltip: prefer `standard_relation = '='`, `standard_units = 'nM'`, `data_validity_comment IS NULL`, `bao_format = BAO_0000357`, then the median `pchembl_value` across qualifying assays. Show the count ("median of 7 assays").
- Never write a `PredictedAffinity` row without a `jobId` that resolves to a reproducible job record (engine, version, weights hash, input YAML, seed/sample settings).

---

## 13. UI content for the comparison table

Columns, left to right, with the exact header text and the rule that governs the cell:

| #   | Header                    | Content                                                                                                                                    | Rule                                                                                                                                                                                                |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Compound**              | name (or CCD code / ChEMBL id when unnamed) + a modality chip (`small molecule` / `antibody` / `protein` / `enzyme`)                       | Chip is grey, not coloured. Non-small-molecules stay in the table — removing them would misrepresent IEI therapeutics                                                                               |
| 2   | **Structure**             | 2D SVG, 96×72 in-row, click → 320×240                                                                                                      | Server-rendered SVG, cached by InChIKey. Non-small-molecules show a modality glyph, not a fake structure                                                                                            |
| 3   | **Status**                | `Approved 2023` / `Phase 3` / `Preclinical` / `PDB ligand only` + FDA application number when present                                      | From ChEMBL `max_phase`/`first_approval` + openFDA `drugsfda`. "Approved" never means approved _for this disease_ unless `isApprovedForThisDisease === true`, in which case append the disease name |
| 4   | **Measured affinity**     | `IC50 0.5 nM` with the relation shown (`≤ 0.5 nM`), then `pChEMBL 9.30 · median of 7 assays`                                               | Tier A. Source chip links to the assay record. Empty cell = `—` and a tooltip "no measured affinity in ChEMBL/BindingDB/DrugCentral for this target", **never** a prediction                        |
| 5   | **Binding region**        | region label + `in pocket 1 (P2Rank p=0.82)` or `co-crystallised: 5P9J chain A/701` ; a badge when the patient's variant residue is inside | Experimental and predicted regions get visually distinct chips (solid vs. dashed border)                                                                                                            |
| 6   | **Predicted pose**        | thumbnail + `ligand ipTM 0.83`                                                                                                             | Tier C. Clicking opens the 3D viewer with the receptor's provenance in the header                                                                                                                   |
| 7   | **Predicted affinity**    | `−1.8 log₁₀(IC50/µM)` on line 1; `≈ 0.016 µM` and `P(binder) 0.91` on line 2, in de-emphasised type                                        | Tier C. **The log value is primary; the µM figure is a convenience and is always prefixed `≈`.** Column is independently sortable and never merges with column 4                                    |
| 8   | **Model**                 | `Boltz-2 2.2.1` + a `?` opening the caveat sheet                                                                                           | Any `appliedCaveats` entry renders a visible marker on the cell, not only in the sheet                                                                                                              |
| 9   | **Confidence**            | `ligand ipTM 0.83 · pLDDT 0.84` plus the receptor tier (`exp. 1.08 Å` / `AFDB v6 pLDDT 84`)                                                | Confidence of the _pose_ and provenance of the _receptor_ are two separate facts; show both                                                                                                         |
| 10  | **Experimental evidence** | `5P9J (1.08 Å, covalent)` / `BindingDB 1958 records` / `—`                                                                                 | Tier A links. A row with a prediction and no experimental evidence must look visibly thinner                                                                                                        |
| 11  | **Source**                | stacked source chips: `ChEMBL 37` `PDBe` `Open Targets` `DrugCentral 54` with licence on hover                                             | Every chip is a real URL to the record, not to the database homepage                                                                                                                                |

Colour carries exactly one meaning: **evidence tier**. Tier A neutral/ink, Tier B a single cool accent, Tier C a single warm accent, Tier D (if ever) hatched. No red/green on affinity values — "good" and "bad" are the reader's call, not the table's.

Sorting defaults to **evidence tier, then measured affinity, then predicted affinity**. Sorting by predicted affinity is allowed but raises a one-line inline notice: _"Sorted by a predicted value. Ranking is only meaningful among compounds already known to bind this target."_

Empty-state copy for a gene with no ligand evidence at all — common for IEI genes, and the honest answer:

> No compound has been measured against this protein in ChEMBL, BindingDB or DrugCentral, and no PDB entry contains a bound ligand. Pocket geometry is still available, and the Open Targets tractability buckets below summarise what is known about this protein's druggability. Any affinity OrphaFold predicts here would fall outside the regime the model was validated in.

---

## 14. Wording rules — a predicted affinity must never read as a clinical recommendation

**Required vocabulary.**

| Never write                                     | Always write                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| "binding affinity: 0.016 µM"                    | "predicted affinity (Boltz-2 2.2.1): −1.8 log₁₀(IC50/µM) ≈ 0.016 µM" |
| "best candidate", "top hit", "lead"             | "highest-ranked in this predicted set"                               |
| "effective", "potent", "works", "will inhibit"  | "predicted to bind", "ranked above", "model-predicted"               |
| "treatment", "therapy", "drug for X"            | "approved compound targeting X", "research starting point"           |
| "safe", "well tolerated", "low toxicity"        | nothing — OrphaFold has no safety data; omit the claim entirely      |
| "recommended dose", "dosing"                    | nothing — out of scope, never render                                 |
| "this patient should…", "consider prescribing…" | nothing — forbidden construction                                     |
| "validated", "confirmed" (of a prediction)      | "predicted; not experimentally tested"                               |

**Structural rules.**

1. **Units in the string, every time.** A predicted affinity never appears as a bare number anywhere — table cell, tooltip, CSV, API response, chart axis, export filename. The unit label is `log₁₀(IC50/µM)`.
2. **Model attribution adjacency.** Model name + version must be inside the same visual block as the number, not in a column the reader can scroll away or a legend at the page bottom.
3. **Comparative-only framing.** Any surface that displays `affinity_pred_value` for more than one compound carries: _"Predicted values rank compounds against each other. They are not measurements and do not estimate activity in a patient."_ Verbatim grounding: the Boltz docs state the value "should only be used when comparing different active molecules, not inactives."
4. **Single-value prohibition.** A page showing exactly one predicted affinity with nothing to compare it to shows the probability head and the caveat instead of the value, or shows the value with: _"A single predicted value carries no interpretation. Add at least one known active for this target to compare against."_
5. **Tier badge is non-dismissible.** Tier C cannot be styled to look like Tier A. No shared colour, no shared icon, no setting that hides the badge.
6. **Receptor provenance travels with the number.** A prediction made against an AlphaFold model says so in the same block: `receptor: AFDB AF-Q06187-F1 v6, mean pLDDT 84.4 (predicted structure)`.
7. **Exports carry the caveats.** CSV/JSON export includes `model`, `model_version`, `units`, `evidence_tier`, `applied_caveats` and a `disclaimer` field as real columns. A screenshot of a cell is unavoidable; a CSV that loses the units is not.
8. **Persistent page-level banner on Stage 6**, not a dismissible toast:
   > **Research and hypothesis generation only.** OrphaFold is not clinical decision software. Predicted poses and predicted affinities are computational hypotheses, not measurements and not medical advice. Nothing here has been validated for any patient.
9. **No ranking language in headings or any shareable artefact** (page title, export filename, copy-link preview, chart title). `BTK — predicted affinity comparison`, never `BTK — best candidates`.
10. **Biologics show "Not applicable", not a number.** When `modality !== "small_molecule"`, the predicted-affinity cell renders `Not applicable — Boltz-2 affinity supports small molecules only` and the compute button is disabled with that reason as its tooltip.
11. **Zero LLM-authored biology.** Every biological statement in Stage 6 renders from a database field with a source id. If no field exists, the UI shows nothing — not generated prose.
12. **Lint it.** Add a CI check over Stage 6 copy and i18n strings for the banned-word list in the table above. Wording rules that live only in a doc decay in one sprint.

---

## Unverified / open questions

- **fpocket output filenames and `_info.txt` score columns** — the GitHub README defers to the in-repo user manual, which I did not retrieve. Read `doc/` in the fpocket 4.2.3 tarball before coding the parser.
- **GNINA `CNNaffinity` units** — the README lists `CNNaffinity` as a `--pose_sort_order` option but states no units anywhere I could read, and I did not retrieve the GNINA paper. Do not label it until confirmed (it is commonly described as a pK, i.e. −log₁₀ Kd, but I did not verify that today).
- **Boltz-2 per-benchmark metrics** — `docs/evaluation.md` names the FEP+ benchmark, CASP16 and the MF-PCBA test set, and the plots are in-repo, but the evaluation files/scripts are marked "Coming soon updated … for Boltz-2". I could not retrieve the preprint full text (bioRxiv returned HTTP 429 twice), so no Pearson/Spearman numbers are quoted here. The abstract's claims are quoted verbatim and are the only performance claims in this document.
- **Boltz-2 local GPU memory floor** — the repo README states no figure. The ≥48 GB number is NVIDIA's requirement for their NIM container, which may be stricter than bare `boltz predict`. Measure on your own hardware before sizing.
- **BindingDB licence/terms** — I could not retrieve a licence statement; `https://www.bindingdb.org/rwd/info/BindingDB_RESTful_API.jsp` 404'd and I did not reach the terms page. Confirm before ingesting rather than linking out.
- **BindingDB `code` parameter** — `code=2` on `getLigandsByUniprots` demonstrably changes the response shape (adds `pmid`, `doi`, drops the `bdb.` prefix), but I found no authoritative documentation of its values. Treat as undocumented; pin the value you test.
- **BindingDB REST reliability** — a third-party wrapper reportedly hard-codes an "unavailable (timeouts)" message. My calls succeeded today, but budget for a cache and a circuit breaker.
- **ZINC-22 / CartBlanche JSON payload schema** — `https://cartblanche.docking.org` serves 200 and `POST /substances.json` and `POST /smiles.json` both respond, but every payload I tried returned `400 "No Valid ZINC IDs"` / `"No Valid SMILES"`. The routes exist; the body schema is undetermined. `GET /substance/ZINC000000000016.json` returned **500**.
- **Enamine REAL Space figure** — "94.5B make-on-demand molecules" is quoted from Enamine's own page, which carries no date or version. Treat as approximate and re-check before publishing it.
- **PrankWeb docking** — repo OpenAPI documents the routes; the public deployment returns 404 (GET, empty body) and 405 (POST). I did not stand up `executor-docking` to confirm the self-hosted POST contract.
- **DrugCentral public mirror currency** — `dbversion` reports 54 / 2023-11-01 while the download page advertises a 2026-09-25 dump. I did not determine whether a newer public instance exists; if currency matters, load the dump yourself.
- **DrugBank commercial terms** — the releases page did not state them. Moot under the recommendation above (link only, never ingest).
- **AlphaFold DB structure count and release label** — the download page states the CC-BY-4.0 licence and "48 organisms" / "majority of Swiss-Prot" but no aggregate count or version number. The per-entry `latestVersion: 6` is verified for Q06187.
- **ChEMBL API rate limits** — not checked. Do not launch a target-wide `activity.json` crawl without measuring, and cache aggressively.
- **PocketMiner licence** — GitHub reports `NOASSERTION`. Until a licence appears, it cannot be redistributed or embedded.
- **ADMET-AI held-out metric values** — the `admet.csv` columns (`AUROC`, `AUPRC`, `R^2`, `MAE`) exist and the property list is verified, but I did not read the per-property values. Read them from the shipped CSV, not from a paper summary.
- **Ruxolitinib ChEMBL mechanism gap** — `mechanism.json?molecule_chembl_id=CHEMBL1789941` returns 0 rows, which is a data-shape surprise rather than a biology claim. Resolve via `parent_molecule_chembl_id` / salt forms before relying on ChEMBL mechanism as a complete index.

---

## Sources

Pocket detection — [PrankWeb](https://prankweb.cz), [cusbg/prankweb](https://github.com/cusbg/prankweb), [rdk/p2rank](https://github.com/rdk/p2rank), [Discngine/fpocket](https://github.com/Discngine/fpocket), [ProtVar](https://www.ebi.ac.uk/ProtVar) + [OpenAPI](https://www.ebi.ac.uk/ProtVar/api/docs) + [protvar-be](https://github.com/ebi-uniprot/protvar-be), [PocketMiner paper](https://www.nature.com/articles/s41467-023-36699-3) + [code](https://github.com/Mickdub/gvp/tree/pocket_pred) + [web](https://pocketminer.azurewebsites.net/), [DeepPocket](https://github.com/devalab/DeepPocket), [CryptoBench](https://github.com/skrhakv/CryptoBench)

Docking / co-folding — [boltz](https://github.com/jwohlwend/boltz) ([prediction docs](https://raw.githubusercontent.com/jwohlwend/boltz/main/docs/prediction.md), [evaluation docs](https://github.com/jwohlwend/boltz/blob/main/docs/evaluation.md), [preprint](https://www.biorxiv.org/content/10.1101/2025.06.14.659707)), [Boltz-2 NIM inference docs](https://docs.nvidia.com/nim/bionemo/boltz2/latest/inference.html) · [support matrix](https://docs.nvidia.com/nim/bionemo/boltz2/latest/support-matrix.html) · [performance](https://docs.nvidia.com/nim/bionemo/boltz2/latest/performance.html) · [build.nvidia.com/mit/boltz2](https://build.nvidia.com/mit/boltz2), [AutoDock Vina](https://github.com/ccsb-scripps/AutoDock-Vina) + [docs](https://autodock-vina.readthedocs.io/en/latest/docking_basic.html), [GNINA](https://github.com/gnina/gnina), [DiffDock](https://github.com/gcorso/DiffDock), [Uni-Dock](https://github.com/dptech-corp/Uni-Dock), [chai-lab](https://github.com/chaidiscovery/chai-lab), [alphafold3](https://github.com/google-deepmind/alphafold3), [Protenix](https://github.com/bytedance/Protenix), [NeuralPLexer](https://github.com/zrqiao/NeuralPLexer), [Meeko](https://github.com/forlilab/Meeko), [scrubber](https://github.com/forlilab/scrubber), [gypsum_dl](https://github.com/durrantlab/gypsum_dl)

Generation / ADMET — [REINVENT4](https://github.com/MolecularAI/REINVENT4), [SynFormer](https://github.com/wenhao-gao/synformer), [SAFE](https://github.com/datamol-io/safe), [DiffSBDD](https://github.com/arneschneuing/DiffSBDD), [Pocket2Mol](https://github.com/pengxingang/Pocket2Mol), [TamGen](https://github.com/microsoft/TamGen), [admet_ai](https://github.com/swansonk14/admet_ai) + [server](https://admet.ai.greenstonebio.com)

Data — [ChEMBL API](https://www.ebi.ac.uk/chembl/api/data/status.json) + [licence](https://www.ebi.ac.uk/chembl/g/), [PubChem PUG-REST](https://pubchem.ncbi.nlm.nih.gov/rest/pug/), [NCBI policies](https://www.ncbi.nlm.nih.gov/home/about/policies/), [Open Targets GraphQL](https://api.platform.opentargets.org/api/v4/graphql) + [licence](https://platform-docs.opentargets.org/licence), [DrugCentral download](https://drugcentral.org/download) + [licence](https://drugcentral.org/privacy), [BindingDB REST](https://www.bindingdb.org/rwd/bind/BindingDBRESTfulAPI.jsp), [RCSB usage policy](https://www.rcsb.org/pages/usage-policy), [RCSB search](https://search.rcsb.org/rcsbsearch/v2/query), [RCSB data GraphQL](https://data.rcsb.org/graphql), [PDBe graph-api](https://www.ebi.ac.uk/pdbe/graph-api/), [AlphaFold DB download/licence](https://alphafold.ebi.ac.uk/download), [UniChem](https://www.ebi.ac.uk/unichem/api/v1/compounds), [openFDA](https://api.fda.gov/), [DrugBank releases](https://go.drugbank.com/releases/latest), [Enamine REAL Space](https://enamine.net/compound-collections/real-compounds/real-space-navigator), [CartBlanche / ZINC-22](https://cartblanche.docking.org/)

Depiction — [RDKit](https://github.com/rdkit/rdkit), [@rdkit/rdkit on npm](https://www.npmjs.com/package/@rdkit/rdkit), [smiles-drawer](https://github.com/reymond-group/smilesDrawer)
