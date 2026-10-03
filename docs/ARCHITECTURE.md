# OrphaFold architecture

OrphaFold is an open research platform for computational rare-disease work. This document describes
the backend as built and gives the recipes for extending it. Product requirements are in
[`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md); verified research is in [`research/`](research/).

## 1. System

```
web/  Next.js app  ──HTTP──▶  api/  FastAPI (orphafold.main:app, port 8000, every route under /api/v1)
                                │
          ┌─────────────────────┼──────────────────────────┬─────────────────────┐
          ▼                     ▼                          ▼                     ▼
   seeded catalog        source adapters             job queue             database
   data/seed/            orphafold/sources/          in-process asyncio    SQLite (default)
   catalog.json          live upstream APIs          or Redis + worker     or PostgreSQL
   in-memory index       cached in the database      orphafold/jobs/       orphafold/db/
                                                           │
                                                           ▼
                                                  model providers ──▶ artifact store
                                                  orphafold/providers/   local dir or S3
```

Three kinds of work are kept apart: interactive requests (catalog, cached metadata), upstream calls
(source adapters, each with its own timeout), and long-running compute (jobs run by a worker). A
page never waits for a model.

### Runtime defaults

| Concern        | Default (zero setup)                                         | Production option                                                 |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Database       | SQLite, `api/var/orphafold.db` (WAL)                         | PostgreSQL via `ORPHAFOLD_DATABASE_URL`                           |
| Job queue      | in-process asyncio queue, worker embedded in the API process | Redis via `ORPHAFOLD_REDIS_URL` plus `python -m orphafold.worker` |
| Artifacts      | local directory `api/var/artifacts`                          | S3-compatible bucket via `ORPHAFOLD_S3_BUCKET`                    |
| Upstream cache | `http_cache` table with a TTL per adapter                    | same                                                              |
| Identity       | anonymous workspace ID in the `X-OrphaFold-Workspace` header | an account claims the actor later                                 |

Settings: `orphafold.config.Settings` (env prefix `ORPHAFOLD_`). Values come from the process
environment, then `api/.env`, then the repository `.env`, which the web app reads as well. Every
setting is listed with its default in [`.env.example`](../.env.example).

### Layout of `api/orphafold/`

| Path                      | Contents                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `main.py`                 | App factory, CORS, lifespan (tables, catalog, queue, worker, recovery)                                                                  |
| `config.py`               | `Settings`, `get_settings()`, `API_PREFIX`, `WORKSPACE_HEADER`                                                                          |
| `errors.py`               | Problem JSON error model and exception classes                                                                                          |
| `plugins.py`              | `import_submodules`: discovery of sources, providers, handlers, routers, tables                                                         |
| `schemas/common.py`       | Shared schemas: `Evidence`, `Provenance`, `SourceStatus`, `EntityRef`, `StructureDescriptor`, `ConfidenceSummary`, `Page`, `Aggregated` |
| `schemas/jobs.py`         | `JobOut`, `JobStage`, `StageSpec`, `ArtifactRole`, `StructureJobResult`                                                                 |
| `evidence.py`             | `classify_evidence` and the builders of `Evidence` rows                                                                                 |
| `identifiers.py`          | UniProt accession pattern, variant ID and structure ID parsing                                                                          |
| `hashing.py`, `ids.py`    | SHA-256, MD5, refget, RFC 8785 canonical JSON, snapshot ID; `new_id(prefix)`                                                            |
| `identity.py`, `deps.py`  | Workspace actor dependency; shared FastAPI dependencies                                                                                 |
| `db/`                     | Engine, sessions, models. Every module here is imported before tables are created                                                       |
| `sources/`                | `base.py` (adapter base, `gather_sources`) and one module per upstream source                                                           |
| `knowledge/catalog.py`    | Loader and index of `data/seed/catalog.json`                                                                                            |
| `services/`               | Logic called by routers, one module per domain                                                                                          |
| `routers/`                | One module per URL prefix, each exposing `router`                                                                                       |
| `providers/`              | `base.py` (interfaces, registry) and one module per model provider                                                                      |
| `jobs/`                   | State machine, `JobContext`, queue, worker, runner, manifest; `handlers/` holds one module per job kind                                 |
| `artifacts/store.py`      | `ArtifactStore`, local and S3 implementations                                                                                           |
| `worker.py`, `openapi.py` | `python -m orphafold.worker`, `python -m orphafold.openapi`                                                                             |

New files in `sources/`, `providers/`, `jobs/handlers/`, `routers/` and `db/` are picked up at startup
without editing shared code. A module that fails to import is logged, skipped and listed under
`load_errors` in `GET /api/v1/health`; set `ORPHAFOLD_STRICT_IMPORTS=true` to make it fatal.

## 2. Contracts

### Identifiers

| Entity                              | URL-facing ID                                                                            | Stored canonical ID                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| gene                                | HGNC symbol (`/gene/BTK`)                                                                | HGNC ID (`HGNC:1133`)                                           |
| protein                             | UniProt accession (`/protein/Q06187`)                                                    | same; residue numbering is UniProt canonical everywhere         |
| disease                             | kebab-case slug, one per IUIS entry                                                      | MONDO, Orphanet, OMIM cross-references (OMIM as link-outs only) |
| variant                             | `GENE-p.Ref3PosAlt3` (`BTK-p.Arg28His`) for protein substitutions, ClinVar VCV otherwise | ClinVar VCV, rsID                                               |
| structure                           | `pdb:<ID>`, `afdb:<entryId>`, `of:<job_id>`                                              | same                                                            |
| compound                            | InChIKey                                                                                 | ChEMBL ID accepted and resolved                                 |
| job, actor, artifact, project, item | `job_`, `act_`, `art_`, `prj_`, `itm_` + ULID (`orphafold.ids.new_id`)                   | same                                                            |
| snapshot                            | `ofs_` + first 32 hex of the content hash (`orphafold.hashing.snapshot_id`)              | same                                                            |

Parsing helpers are in `orphafold.identifiers`: `parse_protein_change("R28H", "BTK")` returns a
`ProteinSubstitution` (`.variant_id`, `.hgvs_p`, `.short`, `.apply(sequence)`), `parse_variant_id`,
`structure_id`, `parse_structure_id`, `is_uniprot_accession`.

### Enums

- `EvidenceClass`: `experimental`, `clinical_database`, `literature`, `curated_database`,
  `computational_prediction`, `orphafold_hypothesis`. Display codes `EXP`, `CLIN`, `LIT`, `CUR`,
  `PRED`, `HYP`. Every `Evidence` carries `evidence_class`, `code`, `label` and `claim_label`.
- `StructureOrigin`: `experimental`, `predicted_external`, `predicted_orphafold`. Display tags `EXP`,
  `PRD`, `OF`. `StructureDescriptor` rejects an ID whose prefix does not match its origin.
- `SourceState`: `ok`, `empty`, `unavailable`, `disabled_by_license`, `not_configured`.
- `JobStatus`: `queued`, `running`, `succeeded`, `failed`, `cancelled`. `StageStatus`: `pending`,
  `running`, `done`, `failed`, `skipped`, `cancelled`.

`GET /api/v1/meta` returns the evidence classes and structure origins with codes and labels.

Names that differ from the research notes: the research uses `experimental_evidence`,
`published_literature` and `orphafold_prediction`; the code uses the enums above. The JSON field is
`evidence_class`, not `class`.

### Errors

Every non-2xx response is RFC 9457 problem JSON (`application/problem+json`):

```json
{
  "type": "urn:orphafold:problem:job_not_found",
  "title": "Not found",
  "status": 404,
  "code": "job_not_found",
  "detail": "Job job_x does not exist.",
  "instance": "/api/v1/jobs/job_x"
}
```

Raise the classes in `orphafold.errors`: `BadRequest` 400, `WorkspaceRequired` 400, `Forbidden` 403,
`DisabledByLicense` 403, `NotFound` 404, `Conflict` 409, `ValidationFailed` 422 (with `errors`),
`SourceUnavailable(source)` 502, `NotConfigured(feature, setting=...)` 503. Pass `code=` for a specific
machine-readable code: `raise NotFound("No gene BTK2.", code="gene_not_found")`.

Use `NotConfigured` when a feature needs configuration this deployment lacks, for example
`raise NotConfigured("The assistant", setting="ANTHROPIC_API_KEY")`. Use `SourceUnavailable` only
when the endpoint cannot answer at all without that source. An endpoint that aggregates several
sources returns 200 with one `SourceStatus` row per source instead.

### Aggregated responses

A response assembled from upstream sources subclasses `orphafold.schemas.common.Aggregated` (or
`AggregatedPage[T]`) and fills `sources: list[SourceStatus]`. The page then renders with whatever
answered and can say which source is temporarily unavailable. Unknown values are `null`, never a
guess.

### Workspace identity

No accounts. The client generates an ID (16 to 128 characters of `A-Z a-z 0-9 _ -`), keeps it in
localStorage and sends it as `X-OrphaFold-Workspace`. The server stores only its SHA-256.

- `CurrentActor` (`orphafold.deps`): for writes. Creates the `actor` row on first use; 400
  `workspace_required` without the header.
- `OptionalActor`: for reads. Never creates a row; `None` without the header.

The actor ID (`act_...`) is separate from the workspace key, so an account can later claim the actor
(`actor.kind = "account"`, an `actor_identity` row) without touching what it owns.

## 3. Sources

`orphafold.sources.base.SourceAdapter` gives every adapter:

- one shared async `httpx` client, a per-source rate limiter (`rate_limit_per_second`) and
  concurrency cap (`max_concurrency`);
- a timeout (`timeout`, overridable per deployment with `ORPHAFOLD_SOURCE_TIMEOUTS`), retry with
  backoff on 429, 502, 503, 504 and transport errors, honouring `Retry-After`;
- a database-backed response cache keyed on method, URL (secrets removed) and body, with `cache_ttl`
  (default 24 h) and a shorter TTL for empty answers. When the source fails and an expired copy
  exists, the copy is served with `stale: true` and a message;
- normalised outcomes in a `SourceResult`: `ok`, `empty` (204, a source-specific 404 through
  `empty_statuses`, a 200 with `null`/`[]`/`{}`), `unavailable` (timeouts, errors, invalid JSON,
  GraphQL `errors[]`, an error payload reported by the `payload_error` hook),
  `disabled_by_license` (`noncommercial_only = True` while
  `ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES` is false) and `not_configured` (the `configured` hook
  returns a reason);
- a `Provenance` envelope on every answered call: source, release, request URL, retrieved time,
  record ID, record URL, license, response SHA-256, cache flags.

Adapter methods return `SourceResult` and do not raise for upstream failures. `result.map(parse)`
parses the payload: a parser that raises turns the result into `unavailable`, a parser that returns
nothing into `empty`.

`gather_sources({...})` runs calls concurrently, each with its own timeout, and returns a `Gathered`:
`gathered["key"]` is the `SourceResult`, `gathered.data("key", default)` its data, and
`gathered.sources` one `SourceStatus` row per source.

## 4. Catalog

`orphafold.knowledge.catalog.get_catalog()` returns the index of `data/seed/catalog.json`. The API
starts without the file; `catalog.status.state` is `ready`, `missing`, `generating` or `invalid`, and
the file is loaded as soon as it appears or changes (checked at most every two seconds). Malformed
records are skipped and counted in `status.skipped_records`.

Lookups: `gene(symbol)`, `gene_by_hgnc_id`, `gene_by_uniprot`, `disease(slug)`,
`diseases_for_gene(symbol)`, `diseases_in_category(id)`, `category(id)`, `subcategory(id)`,
`flagship_for_gene(symbol)`, `lookup(text)` (exact match on any name, alias, symbol or
cross-reference), `aliases()`, `seed_source(source_id)`, `source_status()`. The raw lists are
`catalog.genes`, `catalog.diseases`, `catalog.categories`, `catalog.flagship`, `catalog.manifest`.
Inject it into a route with `CatalogDep` from `orphafold.deps`.

## 5. Evidence

`orphafold.evidence.classify_evidence(database, record_type, eco)` is a pure function over the mapping
tables in `research/provenance-reproducibility.md` section 2.4 and `research/ux-research.md` section
7.3. It fails closed: an unmapped input raises `UnmappedEvidence`.

- `build_evidence(provenance, record_type=..., ...)` builds an `Evidence` row from the provenance of
  an adapter call. The ID is deterministic for the same record and claim.
- `try_build_evidence(...)` returns `None` for an unmapped source, so the claim is left out.
- `build_job_evidence(job_id, job_kind, ...)` for OrphaFold run output; `build_hypothesis(...)` for
  statements authored in OrphaFold, which must list the evidence or job IDs they rest on.
- `strength_for(scheme, value)` keeps source-native strength. Ranks exist only inside the ordinal
  schemes (`clinvar_review_status`, `clingen_gene_validity`, `uniprot_eco`). There is no
  cross-source score anywhere.

Where the two research tables disagree: per-ECO rows of the UX table win over the "any other ECO"
catch-all, and Open Targets `orphanet` is `clinical_database`.

## 6. Compute

### Providers

`orphafold.providers.base` defines five interfaces: `StructurePredictor.predict`,
`BindingPredictor.predict`, `VariantEffectProvider.analyze`, `PocketProvider.find`,
`LiteratureProvider.search`. A provider declares `ProviderInfo` fields as class attributes (id, name,
model name and version, license, commercial-use flag, capabilities, execution mode `retrieval`,
`remote_api`, `local_cli` or `gpu_worker`, structure origin, limitations, citation) and implements
`check_availability()`, which returns whether it can run here and why. `GET /api/v1/models` lists
every registered provider.

A provider never touches the database or HTTP layer. It receives a `RunContext` (stages, log,
progress, cancellation, scratch directory) and returns files plus metadata; the job handler stores
them. Expected failures raise `ProviderError(code, message, detail)`.

Implemented: `afdb` (retrieval of an existing AlphaFold DB model; origin `predicted_external`).

### Jobs

`POST /api/v1/jobs` with `{"kind": ..., "params": {...}}` validates the params against the handler's
model, stores the job with its planned stages and enqueues its ID. A worker claims it
(`queued -> running`), calls the handler and finishes it (`succeeded`, `failed`, `cancelled`).

- Stages are declared up front and are `running` only between entering and leaving
  `async with ctx.stage(id)`. Progress exists only when the handler reports measured counts.
- Events (`status`, `stage`, `log`, `artifact`) are rows in `job_event`. `GET /jobs/{id}/events`
  replays them and follows new ones as Server-Sent Events, ending with an `end` event. The stream
  works across processes because it reads the table. `Last-Event-ID` or `?after=` resumes.
- Cancellation is cooperative: `POST /jobs/{id}/cancel` sets a flag, and the handler stops at its
  next `ctx.check_cancelled()` (also called on entering each stage). A queued job is cancelled at once.
- Artifacts are stored through the `ArtifactStore` with their SHA-256 and served from
  `GET /jobs/{id}/artifacts/{name}`.
- At terminal status the runner writes the run manifest (`manifest.json`, served from
  `GET /jobs/{id}/manifest` with `ETag` = manifest hash). `integrity.manifest_sha256` is the SHA-256
  of the RFC 8785 form of the document without that field (`orphafold.jobs.manifest.verify_manifest`).
- An identical job (same kind and params) of the same workspace that is still queued or running is
  returned instead of creating a duplicate (HTTP 200 instead of 202).
- Recovery at startup: with the in-process queue every `running` job is orphaned; with Redis a job
  is orphaned when its heartbeat is stale. An orphaned job restarts when its handler is
  `restartable` and attempts remain, otherwise it fails with code `interrupted`. Queued jobs missing
  from the queue are enqueued again.

The manifest follows `research/provenance-reproducibility.md` section 5.3 with three relaxations so
retrieval and remote runs are recorded truthfully: `model.weights` may be empty, `parameters.seed` is
required only for handlers declared `requires_seed=True`, and `software.orphafold.git_commit` is
`null` when the deployment is not a git checkout. It adds `request` (the submitted params) and
`execution.stages` (real stage timings).

Implemented job kind: `structure_retrieval` (`{"provider": "afdb", "uniprot_accession": "Q06187"}`).
`GET /api/v1/job-kinds` lists kinds with the JSON Schema of their params and result.

### Database tables

`http_cache`, `actor`, `actor_identity`, `job`, `job_event`, `artifact`, `project`, `project_item`,
`project_snapshot`, `generated_structure` (`orphafold.db.models`). Tables are created at startup with
`create_all`; there are no migrations yet. After changing a model during development, delete
`api/var/orphafold.db` so the table is created again.

## 7. API surface

Implemented: `GET /health`, `GET /meta`, `GET /explore/genes`, `GET /explore/facets`, `GET /models`,
`GET /models/{id}`, `GET /job-kinds`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`,
`GET /jobs/{id}/events` (SSE), `GET /jobs/{id}/log`, `POST /jobs/{id}/cancel`,
`GET /jobs/{id}/manifest`, `GET /jobs/{id}/artifacts/{name}`. All under `/api/v1`.

Reserved prefixes, one router module each: `/search`, `/genes`, `/proteins`, `/variants`,
`/structures`, `/diseases`, `/literature`, `/compounds`, `/projects`, `/snapshots`, `/compare`,
`/assistant`.

`make types` writes `api/openapi.json` (`python -m orphafold.openapi --strict`) and from it the web
types in `web/src/lib/api/schema.ts`; run it after adding or changing a route or schema and never
edit either file by hand. `make check` fails when either is out of date. The shared schemas (`Evidence`,
`Provenance`, `StructureDescriptor`, `StructureJobResult`, `RunManifest`) are always in its components.
Response models mark every field as required, because a response always carries every field
(`json_schema_serialization_defaults_required` on `Schema`); a model used in both a request body and
a response is therefore published as `Name-Input` and `Name-Output`.
URLs inside responses (`artifact.url`, `manifest_url`, structure file URLs of a job) are API paths
starting with `/api/v1`; the web prefixes them with `NEXT_PUBLIC_API_URL`.

## 8. How to add

Every recipe adds new files only. Run `cd api && .venv/bin/uvicorn orphafold.main:app --port 8000`
and check `GET /api/v1/health`: `load_errors` must be empty.

### A source adapter

Create `api/orphafold/sources/<source_id>.py`. Set the class attributes, write typed methods that
call `get_json`, `post_json`, `graphql`, `get_text` or `get_bytes`, and instantiate once at module
level. The instance registers itself and appears under `live_sources` in `/api/v1/meta`.

```python
# api/orphafold/sources/reactome.py
from typing import Any

from orphafold.sources.base import SourceAdapter, SourceResult


class ReactomeSource(SourceAdapter):
    id = "reactome"
    name = "Reactome"
    base_url = "https://reactome.org/ContentService"
    homepage = "https://reactome.org"
    license = "CC0-1.0"
    timeout = 10.0
    # Reactome answers 404 when a protein has no pathways
    empty_statuses = frozenset({204, 404})

    async def pathways(self, accession: str) -> SourceResult[list[dict[str, Any]]]:
        raw = await self.get_json(
            f"/data/mapping/UniProt/{accession}/pathways",
            params={"species": 9606},
            record_id=accession,
        )
        return raw.map(
            lambda payload: [
                {"id": row["stId"], "name": row["displayName"], "in_disease": row["isInDisease"]}
                for row in payload
            ]
        )


reactome = ReactomeSource()
```

Class attributes: `id`, `name`, `base_url` (required); `homepage`, `license` (SPDX ID or
`LicenseRef-*`), `license_url`, `attribution`, `timeout`, `rate_limit_per_second`, `max_concurrency`,
`max_retries`, `cache_ttl`, `empty_cache_ttl`, `empty_statuses`, `release`, `release_header`,
`default_headers`, `noncommercial_only`.

Hooks to override: `configured()` (return a reason string when a key is missing),
`default_params()` (API key, `tool`, `email`; read them from `self.settings`), `payload_error(payload)`
(error inside a 200), `is_empty(payload)`, `extract_release(headers, payload)`, `record_url(record_id)`.

Per-call options of `get_json` and the others: `params`, `headers`, `record_id`, `record_url`,
`release`, `ttl` (seconds; `0` skips the cache), `empty_statuses`, `empty_if`, `select`, `timeout`.
`path` may be an absolute URL. `graphql(query, variables, root="target")` treats `errors[]` as
unavailable and a null `data.target` as empty.

Put a source restricted to non-commercial use behind `noncommercial_only = True`.

### A router and service

Create `api/orphafold/services/<domain>.py` with the logic and response schemas, and
`api/orphafold/routers/<domain>.py` exposing `router`. The router is mounted under `/api/v1`.

```python
# api/orphafold/services/pathways.py
from orphafold.evidence import try_build_evidence
from orphafold.schemas.common import Aggregated, EntityRef, EntityType, Evidence, EvidenceObject, Schema
from orphafold.sources import SourceCall, gather_sources
from orphafold.sources.reactome import reactome


class Pathway(Schema):
    id: str
    name: str
    in_disease: bool
    evidence: Evidence | None = None


class PathwaysResponse(Aggregated):
    protein: EntityRef
    pathways: list[Pathway]


async def protein_pathways(accession: str) -> PathwaysResponse:
    gathered = await gather_sources(
        {"pathways": SourceCall(reactome, reactome.pathways(accession), timeout=15)}
    )
    result = gathered["pathways"]
    protein = EntityRef.of(EntityType.PROTEIN, accession, curie=f"uniprot:{accession}")
    pathways = []
    for row in gathered.data("pathways", []):
        evidence = try_build_evidence(
            result.provenance,
            record_type="pathway",
            record_id=row["id"],
            subject=protein,
            predicate="participates_in",
            object=EvidenceObject(type="pathway", id=f"reactome:{row['id']}", label=row["name"]),
        )
        pathways.append(
            Pathway(id=row["id"], name=row["name"], in_disease=row["in_disease"], evidence=evidence)
        )
    return PathwaysResponse(protein=protein, pathways=pathways, sources=gathered.sources)
```

```python
# api/orphafold/routers/pathways.py
from fastapi import APIRouter

from orphafold.errors import PROBLEM_RESPONSES
from orphafold.services.pathways import PathwaysResponse, protein_pathways

router = APIRouter(prefix="/pathways", tags=["pathways"], responses=PROBLEM_RESPONSES)


@router.get("/{accession}", response_model=PathwaysResponse, summary="Pathways of a protein")
async def get_pathways(accession: str) -> PathwaysResponse:
    return await protein_pathways(accession)
```

Dependencies from `orphafold.deps`: `SessionDep` (async SQLAlchemy session; commit explicitly),
`CatalogDep`, `SettingsDep`, `QueueDep`, `ArtifactStoreDep`, `Pagination` (`.limit`, `.offset`),
`CurrentActor`, `OptionalActor`. Outside a request use
`async with orphafold.db.session.session_scope() as session:` (commits on exit).

To add a table, create a module in `api/orphafold/db/` that defines models on
`orphafold.db.base.Base` (column types `UTCDateTime`, `JSONType`, `BigIntegerKey` are in the same
module). It is imported before `create_all` runs.

### A model provider

Create `api/orphafold/providers/<provider_id>.py`. Subclass one interface, set the class attributes,
implement `check_availability` and the interface method, and decorate the class. The worked example
is `api/orphafold/providers/afdb.py`.

```python
# api/orphafold/providers/example_fold.py
from orphafold.providers.base import (
    Availability,
    Capability,
    ChainInput,
    ConfidenceSample,
    ExecutionMode,
    ModelIdentity,
    ProviderError,
    ProviderFile,
    RunContext,
    StructurePredictor,
    StructureRequest,
    StructureResult,
    register_provider,
)
from orphafold.schemas.common import Citation, ConfidenceSummary, StructureDescriptor, StructureOrigin
from orphafold.schemas.jobs import ArtifactRole, StageSpec


@register_provider
class ExampleFoldProvider(StructurePredictor):
    id = "example_fold"
    name = "Example Fold"
    model_name = "ExampleFold"
    model_version = "1.0"
    license = "MIT"
    commercial_use = True
    capabilities = (Capability.MONOMER, Capability.PLDDT)
    execution_mode = ExecutionMode.REMOTE_API
    structure_origin = StructureOrigin.PREDICTED_ORPHAFOLD
    max_residues = 400
    limitations = ("State each limitation in the words of the model's own documentation.",)
    citation = (Citation(text="Authors, Journal (year)"),)
    job_kinds = ("structure_prediction",)

    async def check_availability(self) -> Availability:
        return Availability(available=False, reason="The Example Fold service URL is not configured.")

    def plan(self, request: StructureRequest) -> list[StageSpec]:
        return [
            StageSpec(id="run_model", label="Running model"),
            StageSpec(id="read_confidence", label="Reading confidence"),
        ]

    async def predict(self, request: StructureRequest, context: RunContext) -> StructureResult:
        chain: ChainInput = request.chains[0]
        if len(chain.sequence) > 400:
            raise ProviderError("sequence_too_long", "This model accepts at most 400 residues.")
        async with context.stage("run_model"):
            await context.check_cancelled()
            cif_text, plddt = await self.call_the_model(chain.sequence)
        async with context.stage("read_confidence"):
            mean = sum(plddt) / len(plddt)
        return StructureResult(
            descriptor=StructureDescriptor(
                id=f"of:{context.job_id}",
                origin=StructureOrigin.PREDICTED_ORPHAFOLD,
                provider=self.id,
                provider_name=self.name,
                model_name=self.model_name,
                model_version=self.model_version,
                method=self.model_name,
                confidence=ConfidenceSummary(plddt_mean=mean, plddt_native_scale="0-100"),
                license=self.license,
                limitations=list(self.limitations),
            ),
            model=ModelIdentity(
                provider=self.id,
                name=self.model_name,
                version=self.model_version,
                license=self.license,
                execution_mode=self.execution_mode,
            ),
            files=[
                ProviderFile(
                    name="model_0.cif",
                    role=ArtifactRole.STRUCTURE,
                    media_type="chemical/x-mmcif",
                    content=cif_text.encode(),
                    structure_origin=StructureOrigin.PREDICTED_ORPHAFOLD,
                    sample_index=0,
                )
            ],
            sequences=[chain],
            parameters={"seed": request.seed, **request.parameters},
            confidence_samples=[
                ConfidenceSample(sample_index=0, structure_file="model_0.cif", metrics={"plddt_mean": mean})
            ],
            plddt_per_residue=plddt,
        )

    async def call_the_model(self, sequence: str) -> tuple[str, list[float]]:
        raise ProviderError("not_configured", "Replace this method with the real model call.")
```

Rules: output of inference triggered by OrphaFold has origin `predicted_orphafold` and ID
`of:<job_id>`; retrieval of a third party's prediction has `predicted_external`. Normalise pLDDT to
0-100 and record the native scale. Report the provider's raw confidence values verbatim in
`ConfidenceSample.metrics`. Never return coordinates the model did not produce. A remote service with
a request limit is called through a `SourceAdapter` with `max_concurrency` and
`rate_limit_per_second` set, so the limit holds across concurrent jobs.

### A job handler

Create `api/orphafold/jobs/handlers/<kind>.py`. The worked example is
`api/orphafold/jobs/handlers/structure_retrieval.py`.

```python
# api/orphafold/jobs/handlers/structure_prediction.py
from pydantic import BaseModel, Field

from orphafold.jobs import JobContext, JobFailed, job_handler
from orphafold.jobs.structures import store_structure_result
from orphafold.providers.base import ChainInput, StructurePredictor, StructureRequest, get_provider
from orphafold.schemas.common import EntityRef, EntityType
from orphafold.schemas.jobs import StageSpec, StructureJobResult


class StructurePredictionParams(BaseModel):
    provider: str
    uniprot_accession: str | None = None
    sequence: str = Field(min_length=1)
    residue_start: int = 1
    seed: int = 42


def _request(params: StructurePredictionParams) -> StructureRequest:
    chain = ChainInput(
        sequence=params.sequence,
        uniprot_accession=params.uniprot_accession,
        residue_start=params.residue_start,
    )
    return StructureRequest(chains=[chain], seed=params.seed)


def _stages(params: StructurePredictionParams) -> list[StageSpec]:
    provider = get_provider(params.provider)
    planned = provider.plan(_request(params)) if isinstance(provider, StructurePredictor) else []
    return [*planned, StageSpec(id="store_artifacts", label="Storing files")]


@job_handler(
    "structure_prediction",
    title="Predict structure",
    params=StructurePredictionParams,
    result=StructureJobResult,
    stages=_stages,
    provider=lambda params: params.provider,
    requires_seed=True,
    describe=lambda params: f"{params.provider} prediction · {params.uniprot_accession or 'custom sequence'}",
    subject=lambda params: (
        EntityRef.of(EntityType.PROTEIN, params.uniprot_accession) if params.uniprot_accession else None
    ),
)
async def predict_structure(context: JobContext, params: StructurePredictionParams) -> StructureJobResult:
    provider = get_provider(params.provider)
    if not isinstance(provider, StructurePredictor):
        raise JobFailed("unsupported_provider", f"'{params.provider}' does not predict structures.")
    result = await provider.predict(_request(params), context)
    async with context.stage("store_artifacts"):
        descriptor = await store_structure_result(context, result)
    return StructureJobResult(performs_inference=True, structure=descriptor)
```

`JobContext` API:

| Call                                                                                          | Purpose                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `async with context.stage(id):`                                                               | Enter and leave a declared stage. Stages do not nest                                                                                                                                                                        |
| `await context.declare_stages([...])`                                                         | Replace the plan before the first stage starts                                                                                                                                                                              |
| `await context.skip_stage(id, reason)`                                                        | Mark a declared stage as not needed                                                                                                                                                                                         |
| `await context.log(message, level="info", **data)`                                            | Append a log line                                                                                                                                                                                                           |
| `await context.progress(completed, total, unit="steps")`                                      | Measured progress of the current stage                                                                                                                                                                                      |
| `await context.check_cancelled()`                                                             | Raise `JobCancelled` when cancellation was requested. Do not catch it                                                                                                                                                       |
| `await context.save_artifact(name, data, media_type=..., role=ArtifactRole.OTHER)`            | Store bytes, text or a `Path`; returns `ArtifactOut` with `sha256` and `url`                                                                                                                                                |
| `context.manifest`                                                                            | `ManifestBuilder`: `set_model`, `set_parameters`, `add_sequence`, `add_variant`, `add_ligand`, `add_identifier`, `add_source_dataset`, `add_provenance`, `set_msa`, `add_package`, `add_confidence_sample`, `set_execution` |
| `await context.record_structure(descriptor, ...)`                                             | Register an OrphaFold-generated structure (`generated_structure` table)                                                                                                                                                     |
| `context.workdir`, `context.params`, `context.job_id`, `context.actor_id`, `context.settings` | Scratch directory (removed afterwards) and job facts                                                                                                                                                                        |

`store_structure_result(context, result, gene_symbol=..., variant_id=..., sequence_source=...)` saves
every `ProviderFile`, fills the manifest from the `StructureResult`, points the descriptor's file
URLs at the stored artifacts and registers `predicted_orphafold` structures.

Raise `JobFailed(code, message, detail)` for a failure the user should read. Any other exception
fails the job with code `internal_error`. A handler that is safe to rerun from the start declares
`restartable=True`. A stochastic handler declares `requires_seed=True` and records the seed in
`context.manifest` parameters (`store_structure_result` does this from `StructureResult.parameters`).

### An evidence mapping

The built-in table in `api/orphafold/evidence.py` covers the sources in the research tables. For a
source it does not cover, register a rule at module level in that source's adapter module:

```python
# api/orphafold/sources/my_source.py
from orphafold.evidence import EvidenceRule, register_evidence_rule
from orphafold.schemas.common import EvidenceClass

register_evidence_rule(
    EvidenceRule(
        database="my_source",
        record_type="assay_result",
        evidence_class=EvidenceClass.EXPERIMENTAL,
        eco="ECO:0000006",
        scheme="my_source_score",
    )
)
```

`database` is the adapter `id`. `record_type=None` matches every record of the database. A rule
that contradicts an existing one is rejected. Then build rows with
`build_evidence(result.provenance, record_type="assay_result", record_id=..., strength_value=...)`.
A UniProt annotation passes its own ECO code: `build_evidence(provenance, eco="ECO:0000269", ...)`.
Never map a source to `experimental` unless a person can go and check an experiment behind it.
