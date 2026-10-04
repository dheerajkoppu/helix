# Deployment

The hosted demo of Helix. One Next.js app on Vercel, one FastAPI container on Railway, and nothing
else: no Postgres, no Redis, no S3, no GPU.

| Piece    | URL                                                              | Host    |
| -------- | ---------------------------------------------------------------- | ------- |
| Web app  | <https://helix-blush-phi.vercel.app>                             | Vercel  |
| API      | <https://helix-api-production-7d6a.up.railway.app>               | Railway |
| API docs | <https://helix-api-production-7d6a.up.railway.app/api/v1/docs>   | Railway |
| Health   | <https://helix-api-production-7d6a.up.railway.app/api/v1/health> | Railway |

Open the web app. The API is there for it to call and for anyone who wants to read the responses
behind a page.

## Why these two

The web app is a Next.js build, which is what Vercel does with no configuration at all.

The API needs a long-lived process, a writable disk for its SQLite database and the seeded files on
disk next to it (`data/seed/catalog.json`, `data/examples/`, `lab/runs/`). That rules out a
serverless function. Railway was chosen over Render and Fly because the `railway` CLI was already
installed and logged in on the machine doing the deploy, so the whole backend went up without a
browser, a new account or a payment method. Render would work the same way; its free tier sleeps
after inactivity, which costs a judge a cold start of roughly a minute on the first page.

## Railway: the API

Project `helix-api`, service `helix-api`, environment `production`.

Built from [`api/Dockerfile`](../api/Dockerfile) with the **repository root** as the build context,
because the image keeps the repository's layout: the `helix` package finds `data/seed`,
`data/examples` and `lab/` by walking up from its own file. Railway is told which Dockerfile to use
with the `RAILWAY_DOCKERFILE_PATH` variable — it looks for `./Dockerfile` otherwise and falls back
to Railpack, which cannot build this repository.

[`.railwayignore`](../.railwayignore) keeps the upload small. `lab/.venv` alone is about 470 MB and
is not wanted in the image; see "What is switched off" below.

### Volume

A volume named `helix-api-volume` is mounted at `/app/api/var`. That is where
`HELIX_DATABASE_URL` points by default, so the SQLite database — and with it the whole upstream
response cache — survives restarts and redeploys. Without it every redeploy would start cold and
the first visitor would wait on every source.

### Environment variables

Set on the Railway service. Everything not listed keeps the default in
[`.env.example`](../.env.example).

| Variable                  | Value                                  | Why                                                                                                    |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `RAILWAY_DOCKERFILE_PATH` | `api/Dockerfile`                       | Railway's own setting. Without it the build falls back to Railpack and fails.                          |
| `PORT`                    | `8000`                                 | Matches the port the generated domain routes to and the port the container listens on.                 |
| `HELIX_ENVIRONMENT`       | `production`                           | Turns off the development default that allows any `localhost` origin.                                  |
| `HELIX_LOG_FORMAT`        | `json`                                 | Structured logs in the Railway log viewer.                                                             |
| `HELIX_CORS_ORIGIN_REGEX` | `^https://[A-Za-z0-9-]+\.vercel\.app$` | Lets the Vercel origin call the API. A regex rather than a fixed list so preview deployments work too. |
| `HELIX_JOB_QUEUE`         | `memory`                               | No Redis. The worker runs inside the API process.                                                      |

Deliberately **not** set: `HELIX_DATABASE_URL` (SQLite on the volume is enough for a read-mostly
demo), `HELIX_REDIS_URL`, `HELIX_S3_BUCKET`, `ANTHROPIC_API_KEY`, `HELIX_NCBI_API_KEY`,
`HELIX_CONTACT_EMAIL`, `HELIX_ENABLE_NONCOMMERCIAL_SOURCES` (stays `false`, so
non-commercial-only sources keep reporting `disabled_by_license` rather than being used).

### Redeploy

From the repository root, with the `railway` CLI logged in:

```bash
railway link                      # once: pick the helix-api project
railway up --service helix-api    # build and deploy the current working tree
```

`railway logs --service helix-api --build` shows the build, `railway logs --service helix-api` the
running process.

## Vercel: the web app

Project `helix` under the `dheerajs-projects-17cb7f9a` scope. The project's root directory is
`web/`; Vercel detects Next.js and runs `pnpm install` and `next build` with no further
configuration.

| Variable              | Value                                              | Scope                            |
| --------------------- | -------------------------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://helix-api-production-7d6a.up.railway.app` | Production, Preview, Development |

The browser calls the API directly with this URL, which is why the API needs the CORS setting
above. There is no proxy and no server-side secret: everything the web app knows is public.

### Redeploy

```bash
cd web
vercel deploy --prod
```

Changing the API's URL means changing `NEXT_PUBLIC_API_URL` and redeploying, because Next.js inlines
a `NEXT_PUBLIC_` variable at build time:

```bash
cd web
vercel env rm NEXT_PUBLIC_API_URL production
vercel env add NEXT_PUBLIC_API_URL production
vercel deploy --prod
```

## The upstream cache

Every page is assembled from upstream sources — UniProt, ClinVar, AlphaFold DB, ChEMBL, STRING,
Reactome, IntAct and the rest — through the database-backed cache described in
[`ARCHITECTURE.md`](ARCHITECTURE.md) section 3. A cold instance makes a judge wait on all of them.

Warm it after any deploy that started from an empty volume:

```bash
cd api
.venv/bin/python scripts/warm_cache.py --api https://helix-api-production-7d6a.up.railway.app
```

It walks the flagship genes through the API's own routes, so the cache ends up holding exactly what
the pages ask for. It takes about three minutes and prints what was slow and which source did not
answer.

### The recorded ChEMBL cache

ChEMBL is the source behind the candidate molecules on `/discover/<gene>`. It was unreachable from
everywhere during this deployment, so warming could not fetch it and the candidate list came back
empty with an honest "nothing passed the direction check" message.

`data/cache/chembl-http-cache.db.gz` is a recording of 1,141 successful ChEMBL responses, copied out
of a development cache. [`api/scripts/seed_http_cache.py`](../api/scripts/seed_http_cache.py) loads
it into `http_cache` and the container runs it on every start, before uvicorn. It inserts only keys
that are not already there, so a live entry always wins and a restart changes nothing. Entry expiry
is copied unchanged, so these rows are refetched on their normal schedule and are served as stale —
with the stale flag the UI shows — only while ChEMBL is unreachable.

The seed is optional: without the file the script prints that there is nothing to load and the API
starts normally. To re-record it from a warm local database:

```bash
python3 - <<'PY'
import sqlite3, gzip, shutil, os
source = sqlite3.connect("api/var/helix.db")
source.execute("ATTACH '/tmp/chembl-cache.db' AS seed")
ddl = source.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='http_cache'"
).fetchone()[0]
source.execute(ddl.replace("http_cache", "seed.http_cache", 1))
source.execute(
    "INSERT INTO seed.http_cache SELECT * FROM main.http_cache "
    "WHERE source='chembl' AND state='ok'"
)
source.commit(); source.execute("DETACH seed"); source.close()
sqlite3.connect("/tmp/chembl-cache.db").execute("VACUUM")
os.makedirs("data/cache", exist_ok=True)
with open("/tmp/chembl-cache.db", "rb") as plain, \
     gzip.open("data/cache/chembl-http-cache.db.gz", "wb", 9) as packed:
    shutil.copyfileobj(plain, packed)
PY
```

## What is switched off, and why

Nothing here fails silently. Each one reports itself through the API's normal machinery, so the UI
explains it instead of erroring.

**Starting a new lab run.** `POST /api/v1/lab/runs` answers `503` problem JSON with code
`not_configured`:

> Omnigent is not installed for this deployment: lab/.venv is missing. See lab/README.md.

An agentic run needs Omnigent and an interactive Claude login, neither of which can exist on a
server. `helix.services.lab.start_run` already checks for `lab/.venv/bin/python` and
`lab/run_lab.py` and raises `NotConfigured` when they are absent, so the image simply does not carry
them: it copies `lab/runs`, `lab/agents` and `lab/experiments/results` and nothing else. The Run
button explains itself rather than throwing.

**Reading lab runs is fully on.** All 45 recorded runs list, open, replay event by event, and show
their candidates, approvals and benchmark comparison. That is the part of the lab a judge needs, and
it is served read-only from files in the image.

**Boltz-2 structure prediction.** `available: false` in `GET /api/v1/models`, with the reason
"No Boltz-2 backend is attached: HELIX_BOLTZ_WORKER_URL is not set". It needs a GPU. AlphaFold DB
retrieval, AlphaMissense, ProtVar, PrankWeb and the stored example comparisons all work, so every
structure page and the 3D viewer are live.

**ESM Atlas folding.** `available: false` — the public ESM Atlas fold API did not answer a probe
within 20 s. This is an upstream condition, not a deployment choice, and the provider list says so.

**The assistant.** No `ANTHROPIC_API_KEY` is set, so it reports `not_configured` by design.

**Non-commercial-only sources.** `HELIX_ENABLE_NONCOMMERCIAL_SOURCES` stays `false`, so they report
`disabled_by_license` rather than being queried. This matches the repository's MIT licence.

## Checking a deploy

```bash
API=https://helix-api-production-7d6a.up.railway.app/api/v1
WEB=https://helix-blush-phi.vercel.app

curl -s $API/health                       # status ok, catalog ready, load_errors {}
curl -s $API/lab/runs | head -c 200       # 45 recorded runs
curl -s "$API/discovery/candidates?gene=BTK" | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' $WEB/gene/BTK
```

`catalog: "ready"` in the health response is the one to watch: it means
`data/seed/catalog.json` loaded. `missing` or `invalid` means the image was built without it and
every page will be empty.

The 3D viewer only renders in a real browser, so check it in one — a `curl` of `/protein/Q06187`
returns the page shell, and the structure arrives over client-side calls afterwards.
