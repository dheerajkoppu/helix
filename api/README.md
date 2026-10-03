# OrphaFold API

FastAPI service behind OrphaFold. Python 3.14, package `orphafold`. Every route is under `/api/v1`.

## Run

```bash
cd api
.venv/bin/uvicorn orphafold.main:app --port 8000
```

No setup is needed: SQLite at `api/var/orphafold.db`, artifacts in `api/var/artifacts`, jobs in an
in-process queue. Interactive docs: http://localhost:8000/api/v1/docs.

## Configuration

Environment variables, prefix `ORPHAFOLD_`. They are also read from the repository `.env` and from
`api/.env`, which overrides it. Every setting is listed with its default in the repository
[`.env.example`](../.env.example); the table holds the ones most often changed.

| Variable                                                                                                            | Default                                       | Purpose                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ORPHAFOLD_DATABASE_URL`                                                                                            | SQLite file                                   | `postgresql://user@host/db` switches to PostgreSQL (`pip install 'orphafold[postgres]'`) |
| `ORPHAFOLD_REDIS_URL`                                                                                               | unset                                         | Redis job queue; run workers with `python -m orphafold.worker` (`orphafold[redis]`)      |
| `ORPHAFOLD_ARTIFACT_DIR`                                                                                            | `api/var/artifacts`                           | Local artifact store                                                                     |
| `ORPHAFOLD_S3_BUCKET`, `_S3_ENDPOINT_URL`, `_S3_REGION`, `_S3_ACCESS_KEY_ID`, `_S3_SECRET_ACCESS_KEY`, `_S3_PREFIX` | unset                                         | S3-compatible artifact store (`orphafold[s3]`)                                           |
| `ORPHAFOLD_CORS_ORIGINS`                                                                                            | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated origins                                                                  |
| `ORPHAFOLD_CORS_ORIGIN_REGEX`                                                                                       | any localhost port in development             | Further allowed origins; unset outside development means none                            |
| `ORPHAFOLD_CONTACT_EMAIL`                                                                                           | unset                                         | Sent to upstream sources in the User-Agent and to NCBI as `email`                        |
| `ORPHAFOLD_NCBI_API_KEY`                                                                                            | unset                                         | NCBI E-utilities key                                                                     |
| `ANTHROPIC_API_KEY`                                                                                                 | unset                                         | Assistant                                                                                |
| `ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES`                                                                            | `false`                                       | Enables sources restricted to non-commercial use                                         |
| `ORPHAFOLD_BOLTZ_EXECUTABLE`, `_BOLTZ_CACHE_DIR`, `_BOLTZ_ACCELERATOR`                                              | unset                                         | Local Boltz command line                                                                 |
| `ORPHAFOLD_MSA_SERVER_URL`                                                                                          | unset                                         | MSA server for models that need one                                                      |
| `ORPHAFOLD_SOURCE_TIMEOUT_DEFAULT`                                                                                  | `10`                                          | Seconds per upstream request                                                             |
| `ORPHAFOLD_SOURCE_TIMEOUTS`                                                                                         | `{}`                                          | Per-source override, JSON or `chembl=30,ensembl=30`                                      |
| `ORPHAFOLD_SEED_DIR`                                                                                                | `data/seed`                                   | Directory holding `catalog.json`                                                         |
| `ORPHAFOLD_JOB_CONCURRENCY`                                                                                         | `2`                                           | Jobs run at once per worker                                                              |
| `ORPHAFOLD_STRICT_IMPORTS`                                                                                          | `false`                                       | Fail at startup when a plugin module does not import                                     |

## Commands

```bash
.venv/bin/python -m orphafold.openapi          # write api/openapi.json
.venv/bin/python -m orphafold.worker           # job worker (Redis queue only)
.venv/bin/python -m ruff check .               # lint (installed by the dev extra)
```

From the repository root, `make types` writes `api/openapi.json` and the web types generated from it,
`make api RELOAD=1` restarts the server when a file under `orphafold/` changes, and `make lint` runs
ruff. `GET /api/v1/health` reports `data_release` (seeded dataset and build date) and `load_errors`.

Architecture and extension recipes: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
