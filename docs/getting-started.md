# Getting started

Helix has two halves: an API (FastAPI, Python 3.14) in `api/` and a web app (Next.js 16, pnpm)
in `web/`. With no configuration the API runs on SQLite, an in-process job queue and a local
artifact directory. No database server, queue, GPU or API key is required.

## Requirements

| Tool    | Version                                                     |
| ------- | ----------------------------------------------------------- |
| Python  | 3.14 (`python3.14` on the path, or `make setup PYTHON=...`) |
| Node.js | 20.9 or later                                               |
| pnpm    | the version named in `web/package.json`                     |
| make    | any                                                         |

## Run it

```bash
make setup    # creates api/.venv, installs the API and the web dependencies
make dev      # API on http://localhost:8000, web on http://localhost:3000
```

`make dev` runs both servers in one terminal. Ctrl-C stops both.

- Web app: http://localhost:3000
- API reference (OpenAPI): http://localhost:8000/api/v1/docs
- Health: http://localhost:8000/api/v1/health. `load_errors` must be empty.

The two halves also run on their own:

```bash
make api RELOAD=1                 # API only, restarting when a file under api/helix changes
make web API_URL=http://host:8000 # web only, calling another API
```

## Make targets

| Command       | Does                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `make setup`  | Creates `api/.venv`, installs the API (`EXTRAS=dev,postgres,redis,s3`) and the web |
| `make dev`    | Runs API and web together                                                          |
| `make api`    | Runs the API on port 8000 (`API_PORT=...`)                                         |
| `make web`    | Runs the web dev server on port 3000 (`WEB_PORT=...`)                              |
| `make worker` | Runs a separate job worker. Needs the Redis queue                                  |
| `make seed`   | Rebuilds `data/seed/catalog.json` from its sources (`SEED_ARGS="--refresh all"`)   |
| `make types`  | Regenerates `api/openapi.json` and `web/src/lib/api/schema.ts`                     |
| `make check`  | Strict API import, generated types are current, `tsc`, `eslint`                    |
| `make lint`   | `ruff` over `api/`                                                                 |
| `make build`  | Production build of the web app                                                    |
| `make clean`  | Removes `api/var` (job database, stored artifacts) and the web build output        |

## First things to open

The flagship example is BTK, the gene of X-linked agammaglobulinemia.

| Page                                                  | Shows                                                  |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `/explore`                                            | The 511 genes of the IUIS classification, with filters |
| `/disease/btk-deficiency-x-linked-agammaglobulinemia` | The disease record and its sources                     |
| `/gene/BTK`                                           | Gene, transcripts and the variant table                |
| `/protein/Q06187`                                     | Sequence axis, features, structures by origin          |
| `/variant/BTK-p.Arg28His`                             | One variant across ClinVar, UniProt, gnomAD and VEP    |
| `/compare/BTK/p.Arg28His`                             | Reference and variant models side by side              |
| `/models`                                             | Every model provider and whether it can run here       |
| `/jobs`                                               | Computational runs, their stages, logs and manifests   |

The same records over HTTP:

```bash
curl http://localhost:8000/api/v1/genes/BTK
curl http://localhost:8000/api/v1/proteins/Q06187/structures
curl http://localhost:8000/api/v1/variants/BTK-p.Arg28His
curl http://localhost:8000/api/v1/models
```

## Configuration

Every setting is optional. Copy `.env.example` to `.env` in the repository root to change one; the
file lists every setting of the API and the web app with its default. The API reads the process
environment first, then `api/.env`, then the repository `.env`. The web app reads the same
repository `.env`, and `web/.env.local` overrides it.

Settings worth knowing on the first day:

| Setting                                  | Effect                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `HELIX_CONTACT_EMAIL`                | Sent to upstream sources in the User-Agent, and to NCBI as `email`          |
| `HELIX_NCBI_API_KEY`                 | Raises the NCBI limit from 3 to 10 requests per second                      |
| `HELIX_ENABLE_NONCOMMERCIAL_SOURCES` | Turns on sources restricted to non-commercial use. Off by default           |
| `ANTHROPIC_API_KEY`                      | Enables the research assistant. Unset: the assistant reports not configured |
| `NEXT_PUBLIC_REPOSITORY_URL`             | Source repository linked from the top bar and the About page                |

## What runs without a GPU

Everything in the default installation. Structure retrieval reads AlphaFold DB, variant comparison
calls the public ESM Atlas service (one chain of at most 400 residues), pockets come from PrankWeb,
and variant-effect scores are retrieved from ProtVar and AlphaFold DB. Boltz-2 is the one provider
that needs compute you attach yourself: see [Model providers](model-providers.md).

## Production services

PostgreSQL, a Redis queue with separate workers and S3-compatible artifact storage attach through
settings; no code changes.

| Concern   | Setting                                                     | Python extra |
| --------- | ----------------------------------------------------------- | ------------ |
| Database  | `HELIX_DATABASE_URL=postgresql://user@host:5432/name`   | `postgres`   |
| Job queue | `HELIX_REDIS_URL=redis://host:6379/0` and `make worker` | `redis`      |
| Artifacts | `HELIX_S3_BUCKET` and the other `HELIX_S3_*` values | `s3`         |

Install the extras with `make setup EXTRAS=dev,postgres,redis,s3`.

`docker-compose.yml` in the repository root wires all of them together:

```bash
docker compose up --build
```

It starts PostgreSQL, Redis, MinIO (S3-compatible storage, with the bucket created on first start),
the API, one job worker and the web app. Web on port 3000, API on port 8000, MinIO console on
port 9001. The credentials in the file are development defaults; replace them before exposing any
port. There are no database migrations yet: tables are created at startup.

## Rebuilding the seeded dataset

`data/seed/catalog.json` is committed, so this is only needed to refresh it.

```bash
make seed                              # resumes from data/.cache
make seed SEED_ARGS="--refresh all"    # fetches every source again
```

A cold build makes about 2,550 requests and takes about seven minutes. The build also regenerates
`ATTRIBUTION.md`, `data/seed/SOURCES.json` and `data/seed/build_report.json`. Field meanings are in
`data/seed/README.md`.

## Where to go next

- [Architecture](ARCHITECTURE.md): the backend, its contracts and the recipes for extending it.
- [Data sources](data-sources.md): what is read from where, and under which licence.
- [Evidence classes](evidence-classes.md): how every statement is classified.
- [Scientific limitations](scientific-limitations.md): what the outputs do not show.
