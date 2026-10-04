# Helix

What could we aim a drug at in a rare disease, and is there already a molecule that does it?

Helix is an open-source platform for computational rare-disease research. It follows one path:
disease, gene, pathogenic variant, protein, mechanism, **candidate targets and molecules**, what to
test next. At every step it shows where each statement comes from and how far it can be trusted. The
first dataset is the IUIS classification of inborn errors of immunity: 604 diseases and 511 genes.

Every candidate is a hypothesis Helix built from records. Helix is a research and
hypothesis-generation tool. It is not clinical decision software, and nothing in it is a treatment,
a dose or advice.

## Why it exists

Most rare diseases have a known gene and no therapy. Knowing _why_ a mutation is harmful is a
lookup; the answer is already in a database, scattered across the clinical classification in
ClinVar, the protein in UniProt, structures in the PDB and AlphaFold DB and predictions in a dozen
services, each with its own identifiers, numbering and licence. A researcher assembling it by hand
loses the provenance on the way, and a predicted structure ends up in the same figure as a crystal
structure with nothing to tell them apart.

The question nobody has answered for most rare diseases is the next one: what could a drug act on.
Helix answers it by **bridging mechanisms** — a molecule studied for one disease may apply to
another when the two share a mechanism _and point the same way_. Sharing a gene or a pathway is not
enough. Ibrutinib blocks BTK; X-linked agammaglobulinemia is caused by BTK loss of function, so a
BTK blocker would make it worse. **Direction of effect is a hard filter**: a molecule that pushes
the wrong way is never ranked, and appears instead in a visible "Ruled out" list with the reason.
[`docs/discovery.md`](docs/discovery.md) describes the engine, its five bridges and its three
controls.

Helix puts those sources on one residue numbering and one page, and keeps three rules:

1. **Every value is traceable to a source record**, with its release, retrieval date and licence.
   A value no source provides is shown as Unknown.
2. **Every statement carries one of six evidence classes**: experimental, clinical database,
   literature, curated database, computational prediction, Helix hypothesis. Scores from
   different sources are never merged into one number.
3. **Experimental structures, existing predictions and predictions generated here are never
   presented as equivalent.** Every computational run writes a manifest of its inputs, model,
   version, parameters and output hashes.

## The journey

| Stage         | Route                               | What it shows                                                                            |
| ------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Explore       | `/explore`                          | The genes of the classification, filtered by category, inheritance, structure coverage   |
| Disease       | `/disease/<slug>`                   | Classification, inheritance, phenotypes with frequency, cross-references                 |
| Gene          | `/gene/BTK`                         | Transcripts and the variant table: ClinVar, UniProt and gnomAD                           |
| Protein       | `/protein/Q06187`                   | Sequence axis with domains, sites, structure coverage, pLDDT and variants; the 3D viewer |
| Variant       | `/variant/BTK-p.Arg28His`           | One variant across clinical, population, curated and predicted sources                   |
| Mechanism     | `/variant/BTK-p.Arg28His/mechanism` | What sits at and around the residue: features, contacts, effect predictions              |
| Compare       | `/compare/BTK/p.Arg28His`           | Reference and variant models from the same provider, with their difference               |
| Interventions | `/protein/Q06187/interventions`     | Known drugs, pockets, compounds and binding predictions                                  |
| Candidates    | `/discover/PIK3CD`                  | What a drug could aim at and which molecules act that way, with the ruled-out list       |
| Projects      | `/projects`                         | Pinned evidence, notes and hypotheses; snapshots, forks and exports                      |

Candidates is where the journey ends. Explore (`/explore`) stays a browser and the Lab stays a
recorded loop; neither is the destination. Jobs (`/jobs`) lists computational runs with their
stages, logs and manifests. Models (`/models`) lists every model provider and whether it can run on
this installation.

## Candidate targets and molecules

`/discover/<gene>` and `GET /api/v1/discovery/candidates` answer the question the rest of the
platform leads up to. The engine reads the mechanism class and direction from the catalog, derives
the required action from a published rule table, runs five bridges, and applies the direction filter
before anything is ranked.

| Bridge                | Claims                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| `same_target`         | A molecule acts on this very protein, approved or studied in another disease    |
| `pathway_node`        | A druggable protein upstream or downstream, where acting on it corrects the way |
| `interaction_partner` | A curated physical partner that is druggable                                    |
| `structural_analogue` | A protein whose pocket resembles this one and has a known binder                |
| `mechanism_class`     | Another disease with the same mechanism class and direction, with a drug class  |

Four controls are the product's own evidence that the filter works, stored in
`lab/experiments/results/discovery-controls.json` and served by `GET /api/v1/discovery/controls`.
All four pass:

- **Held out.** With `exclude_direct=true` the APDS-to-leniolisib link is withheld, and leniolisib
  still returns at rank 4 of 27 through a `same_target` bridge whose every step cites a record.
- **Negative.** For BTK loss of function, all 20 molecules ChEMBL records as lowering BTK — ibrutinib
  among them — are absent from the candidates and present in the 34 ruled-out rows with the reason.
- **Upstream.** For STAT1 gain of function, baricitinib returns at rank 2 of 23 aimed at JAK1, not
  at STAT1. No candidate aims at STAT1 itself.
- **Safety.** Measuring the engine caught it refusing plerixafor for WHIM syndrome, the disease that
  drug is used for, off a single ChEMBL `action_type` field. A rejection may no longer rest on a
  field another record of the same molecule and protein contradicts; plerixafor is offered at rank 8,
  and the case is kept as a permanent control.

[`docs/discovery.md`](docs/discovery.md) has the rule table, the five bridges, the held-out mode, the
ranking keys, the full control numbers and what the method does not do.

## Agentic lab

The Lab (`/lab`) is a team of AI agents on top of the Helix API, orchestrated by Omnigent
0.16.0: a supervisor and eight specialists (literature, knowledge graph, insight, planner, safety,
runner, analysis, translator). It takes one mutation through a recorded loop: question, evidence,
hypothesis, experiment, result, updated decision, **candidates**. Four policies bound what each
agent may do, and a test that starts a compute job waits for a human approval.

The seventh step ends a run on what a drug could act on rather than on the decision. The translator
may only record a candidate by reference to a row the discovery endpoint returned, the safety agent
reviews every proposal first, and the tools refuse any candidate whose direction check is not
`matches` — so no agent can type a molecule name into a record.

- [`SUBMISSION.md`](SUBMISSION.md): the hackathon submission, with the reference run on BTK
  p.Arg28His told from its record, the measured comparison with a single agent and the open limits.
- [`lab/README.md`](lab/README.md): agents, policies, how to run the Lab and how to read a run record.
- [`docs/lab/agent-specs.md`](docs/lab/agent-specs.md),
  [`docs/lab/policies.md`](docs/lab/policies.md) and
  [`docs/lab/demo-script.md`](docs/lab/demo-script.md): the agent specifications, the policies and
  the two minute demo.

The Lab does research and hypothesis generation only. Nothing it outputs has been validated in a
laboratory.

## Run it

Needs Python 3.14, Node.js 20.9 or later and pnpm. No database, queue, GPU or API key is required.

```bash
make setup    # creates api/.venv, installs the API and the web dependencies
make dev      # API on http://localhost:8000, web on http://localhost:3000
```

API reference: http://localhost:8000/api/v1/docs. Every route is under `/api/v1`.

| Command       | Does                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `make setup`  | Creates `api/.venv`, installs the API (`EXTRAS=dev,postgres,redis,s3`) and the web |
| `make dev`    | Runs API and web together; Ctrl-C stops both                                       |
| `make api`    | Runs the API (`RELOAD=1` restarts it when a file under `api/helix` changes)        |
| `make web`    | Runs the web dev server (`API_URL=http://host:port` to call another API)           |
| `make worker` | Runs a separate job worker (Redis queue only)                                      |
| `make seed`   | Rebuilds `data/seed/catalog.json` from its sources (`SEED_ARGS="--refresh all"`)   |
| `make types`  | Regenerates `api/openapi.json` and `web/src/lib/api/schema.ts`                     |
| `make check`  | Strict API import, generated types are current, `tsc`, `eslint`                    |
| `make lint`   | `ruff` over `api/`                                                                 |
| `make build`  | Production build of the web app                                                    |

Everything runs with no configuration. To change a setting, copy [`.env.example`](.env.example) to
`.env` in the repository root; it lists every setting with its default.

### With PostgreSQL, Redis and object storage

```bash
docker compose up --build
```

[`docker-compose.yml`](docker-compose.yml) starts PostgreSQL, Redis, MinIO (S3-compatible storage),
the API, a job worker and the web app, wired through the same settings `.env.example` documents.
The credentials in the file are development defaults.

## Architecture

```
web/  Next.js app  ──HTTP──▶  api/  FastAPI, every route under /api/v1
                                │
          ┌─────────────────────┼──────────────────────────┬─────────────────────┐
          ▼                     ▼                          ▼                     ▼
   seeded catalog        source adapters             job queue             database
   data/seed/            api/helix/sources/      in-process asyncio    SQLite (default)
   catalog.json          live upstream APIs          or Redis + worker     or PostgreSQL
                         cached in the database            │
                                                           ▼
                                                  model providers ──▶ artifact store
                                                  api/helix/providers/  local dir or S3
```

Interactive requests, upstream calls and long-running compute are kept apart. A page never waits
for a model, and one failing source never fails a page: every aggregated response lists the state
of each source it asked.

| Path             | Holds                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `api/`           | FastAPI service, package `helix`: source adapters, seeded catalog, jobs, model providers |
| `web/`           | Next.js app: workspace, sequence axis, molecular viewer, explore, projects               |
| `data/seed/`     | The seeded dataset the API loads at startup, with its sources and build report           |
| `data/examples/` | Real cached model outputs, each beside the manifest of the run that produced it          |
| `docs/`          | Architecture, design system, guides, research notes                                      |

Source adapters, model providers, job handlers, routers and database tables are plugins: a new file
in the right directory is imported at startup, with no shared code to edit.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the contracts and gives the recipe for
each.

## Data sources and licences

The catalog of diseases and genes is built by `make seed` from the IUIS 2024 classification, HGNC,
GenCC, ClinGen, Mondo, Orphadata, HPO, UniProtKB, PDBe SIFTS, AlphaFold DB, ClinVar and Europe PMC.
At run time the API also reads Ensembl, gnomAD, InterPro, RCSB PDB, ProtVar, AlphaMissense, MaveDB,
IntAct, STRING, Reactome, Open Targets, Monarch, ChEMBL, PubChem, UniChem and 3D-Beacons.

Data keeps the licence of its source. [`ATTRIBUTION.md`](ATTRIBUTION.md) lists the licence, release
and required citation of each one and is generated by the seed build, with checksums in
`data/seed/SOURCES.json`. [`docs/data-sources.md`](docs/data-sources.md) describes what is read
from where.

- The IUIS 2024 classification is published under CC BY-ND 4.0. Helix stores only identifiers,
  codes and short labels taken from it; the exact note is in
  [`ATTRIBUTION.md`](ATTRIBUTION.md#iuis-classification-what-is-and-is-not-stored).
- ChEMBL is CC BY-SA 3.0 and is kept apart from other data.
- No OMIM content is included. MIM numbers are link-outs supplied by other sources.
- Sources restricted to non-commercial use stay off unless an installation sets
  `HELIX_ENABLE_NONCOMMERCIAL_SOURCES=true`.

## Model providers

`GET /api/v1/models`, and the `/models` page, list what is registered and whether each provider can
run on this machine.

| Provider                                | Does                                                                                    | Needs                      |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------- |
| `afdb`                                  | Retrieves a precomputed AlphaFold DB model (lookup, never inference)                    | nothing                    |
| `esm_atlas`                             | Runs ESMFold v1 through the public ESM Atlas service, one chain of at most 400 residues | nothing                    |
| `cached_examples`                       | Returns stored outputs of earlier real runs                                             | nothing                    |
| `prankweb`                              | Predicted pockets from PrankWeb                                                         | nothing                    |
| `alphamissense_afdb`, `protvar_effects` | Retrieve variant-effect predictions and residue annotations                             | nothing                    |
| `europepmc_literature`                  | Rule-based literature search                                                            | nothing                    |
| `boltz2`                                | Boltz-2 structure and binding affinity prediction                                       | a Boltz backend you attach |

**Without a GPU** everything except `boltz2` runs. `boltz2` reports unavailable until a GPU worker
(`api/worker/boltz`) or a local Boltz installation is attached, and jobs that need it fail with the
reason. Nothing is substituted for a model that cannot run. No real Boltz-2 prediction has been
made through Helix yet; see [`docs/providers/boltz2.md`](docs/providers/boltz2.md).

Details: [`docs/model-providers.md`](docs/model-providers.md).

### Adding a model

Add one file under `api/helix/providers/`: subclass an interface from
`helix.providers.base`, declare the model's version, licence, capabilities and limitations, and
decorate the class with `@register_provider`. It appears in `/api/v1/models` on the next start. The
checklist is in [`docs/adding-a-model.md`](docs/adding-a-model.md).

## Reproducibility

Every job writes an immutable run manifest: inputs with checksums, model and version, resolved
parameters, software versions, measured stage timings and the SHA-256 of every output, sealed with
a hash of its own canonical form (`GET /api/v1/jobs/<job_id>/manifest`). Projects have
content-addressed snapshots, forks that record their parent, and exports as JSON, Markdown and an
RO-Crate archive. See [`docs/reproducibility.md`](docs/reproducibility.md).

## Scientific limitations

- A predicted structure is a computational prediction, never an experimental result.
- Structure predictors are not validated for single-residue substitutions. A variant model that
  matches the reference carries no information about whether the variant is tolerated.
- pLDDT is local confidence. Low pLDDT means disorder or insufficient information, never
  misfolding caused by a variant.
- A predicted affinity is a model output for comparing candidate molecules, never a clinical
  recommendation.
- A pathogenicity prediction is not a clinical classification.
- Absence from a database is not evidence of absence.
- A candidate is a hypothesis built from records. Tissue expression, pharmacokinetics and toxicity
  are never checked, and a direction match says nothing about whether a molecule would work.

The full list, with sources, is in
[`docs/scientific-limitations.md`](docs/scientific-limitations.md).

## Documentation

| Document                                                           | Covers                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [`docs/getting-started.md`](docs/getting-started.md)               | Setup, configuration, production services            |
| [`docs/discovery.md`](docs/discovery.md)                           | The candidate engine, the bridges, the controls      |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                     | Backend, contracts, extension recipes                |
| [`docs/data-sources.md`](docs/data-sources.md)                     | Sources, licences, adapter behaviour                 |
| [`docs/evidence-classes.md`](docs/evidence-classes.md)             | The six evidence classes and three structure origins |
| [`docs/model-providers.md`](docs/model-providers.md)               | Providers, job kinds, what runs without a GPU        |
| [`docs/adding-a-model.md`](docs/adding-a-model.md)                 | Checklist for a new provider                         |
| [`docs/reproducibility.md`](docs/reproducibility.md)               | Provenance, run manifests, snapshots, exports        |
| [`docs/scientific-limitations.md`](docs/scientific-limitations.md) | What the outputs do not show                         |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)                   | Interface components and page rules                  |
| [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md)                   | What Helix is built to do                            |

The same documentation is served by the web app at `/docs`.

## Contributing

Contributions of data sources, model providers, corrections to mappings and limitations, and
interface work are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup, the checks to run
and the rules a change must keep. To cite Helix, use [`CITATION.cff`](CITATION.cff).

## Licence

MIT for the source code: see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Data keeps the
terms of its source, listed in [`ATTRIBUTION.md`](ATTRIBUTION.md). Model outputs keep the terms of
the model that produced them.
