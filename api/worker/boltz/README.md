# Helix Boltz worker

A small HTTP service that runs `boltz predict` on a machine with a GPU and hands the result files
back to the Helix API. The API machine needs no GPU and no Boltz installation: it sends the
input YAML and the command-line options, polls the worker, downloads the files Boltz wrote, checks
their SHA-256 and parses them with the same parser it uses for a local run.

The worker runs one prediction at a time, executes only an allow-list of documented Boltz options
and adds the options that belong to its machine (`--cache`, `--accelerator`, `--devices`,
`--no_kernels`). It never writes a result file itself.

| File               | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `server.py`        | The service (FastAPI, Python 3.12, no dependency on the `helix` package) |
| `Dockerfile`       | Python 3.12 image with `boltz[cuda]==2.2.1` for an NVIDIA host               |
| `requirements.txt` | Pinned dependencies of the image                                             |
| `fetch_weights.py` | Downloads the pinned checkpoints and verifies their SHA-256                  |
| `fixtures/`        | Hand-written parser fixture. Not model output; see `fixtures/README.md`      |

Status: Boltz could not be run in the environment this was written in. The protocol was exercised
end to end against a stand-in executable; the image was not built and no real prediction was made.
Measure runtime and memory on your own hardware before relying on the defaults.

## Run on a GPU machine (Docker)

Requirements: Linux, an NVIDIA GPU with a recent driver, the NVIDIA Container Toolkit, about 10 GB of
disk for the checkpoints. The research notes cite 8-12 GB cards for 300-500 residues and 24 GB cards
for about 1,000 tokens.

```bash
cd api/worker/boltz
docker build -t helix-boltz-worker .

# Once: fetch the pinned checkpoints (about 6.2 GB) into a volume and verify them
docker run --rm -v boltz-models:/models/boltz helix-boltz-worker python fetch_weights.py

docker run -d --name boltz-worker --gpus all -p 8200:8200 \
  -v boltz-models:/models/boltz -v boltz-jobs:/data/jobs \
  -e BOLTZ_WORKER_TOKEN="$(openssl rand -hex 24)" \
  helix-boltz-worker

curl -H "Authorization: Bearer <token>" http://localhost:8200/health
```

`ready` in the health answer is true when the `boltz` executable is found and `nvidia-smi` reports a
GPU. Then attach the worker on the API machine (repository `.env`):

```bash
HELIX_BOLTZ_WORKER_URL=http://<gpu-host>:8200
HELIX_BOLTZ_WORKER_TOKEN=<token>
```

`GET /api/v1/models/boltz2` now reports `availability.available: true` with the worker's Boltz
version and accelerator.

## Run without Docker

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
BOLTZ_CACHE=/models/boltz python fetch_weights.py
BOLTZ_CACHE=/models/boltz BOLTZ_WORKER_DATA=/data/jobs BOLTZ_WORKER_TOKEN=<token> \
  uvicorn server:app --host 0.0.0.0 --port 8200
```

## Apple Silicon (community fork)

Upstream `boltz` accepts only `gpu`, `cpu` and `tpu` as accelerator. The community fork
`boltz-community` adds `--accelerator mps` with float32. This path is experimental: the claims come
from the fork's README and were not executed here.

```bash
python3.12 -m venv ~/boltz-env && . ~/boltz-env/bin/activate
pip install boltz-community==2.10.12 fastapi==0.115.6 uvicorn==0.34.0
# On OpenMP errors:  boltz-fix-macos-libomp
```

Then either run the worker on the Mac:

```bash
BOLTZ_ACCELERATOR=mps BOLTZ_WORKER_DATA=~/boltz-jobs uvicorn server:app --port 8200
# API .env: HELIX_BOLTZ_WORKER_URL=http://localhost:8200
```

or skip the worker and let the API call the executable directly:

```bash
# API .env
HELIX_BOLTZ_BIN=/Users/<you>/boltz-env/bin/boltz
HELIX_BOLTZ_ACCELERATOR=mps
```

A 32 GB Mac handles about 1,000 residues plus ligand atoms according to the ChimeraX documentation
for its bundled Boltz. Keep `HELIX_BOLTZ_MAX_TOKENS` at or below what your machine has shown it
can do.

## CPU

`--accelerator cpu` with upstream `boltz` 2.2.1 produces distorted structures (upstream issue 653).
The adapter refuses that combination. `boltz-community` carries the fix; use it for CPU runs, and
only for short sequences.

## Environment variables of the worker

| Variable                                                        | Default      | Meaning                                        |
| --------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| `BOLTZ_BIN`                                                     | `boltz`      | Executable to run                              |
| `BOLTZ_CACHE`                                                   | `~/.boltz`   | Checkpoint directory, passed as `--cache`      |
| `BOLTZ_ACCELERATOR`                                             | `gpu`        | `gpu`, `cpu`, or `mps` with the community fork |
| `BOLTZ_DEVICES`                                                 | `1`          | Passed as `--devices`                          |
| `BOLTZ_NO_KERNELS`                                              | off          | Adds `--no_kernels`, needed on old NVIDIA GPUs |
| `BOLTZ_WORKER_TOKEN`                                            | none         | Bearer token every request must carry. Set it  |
| `BOLTZ_WORKER_DATA`                                             | `/data/jobs` | Job directories (input, output, log)           |
| `BOLTZ_WORKER_MAX_TIMEOUT`                                      | `14400`      | Upper bound in seconds for one run             |
| `BOLTZ_WORKER_IMAGE`, `BOLTZ_WORKER_IMAGE_DIGEST`               | none         | Recorded in the run manifest when both are set |
| `BOLTZ_MSA_USERNAME`, `BOLTZ_MSA_PASSWORD`, `MSA_API_KEY_VALUE` | none         | Read by Boltz itself for a private MSA server  |

## Protocol (version 1)

| Call                          | Answer                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                 | `service`, `protocol_version`, `ready`, `reason`, `environment` (Boltz package and version, torch, accelerator, GPU, hashed checkpoints)                                  |
| `POST /jobs`                  | Body `{record_id, input_yaml, options[], msa_files{}, timeout_seconds}`; answers `{id, status}` with 202                                                                  |
| `GET /jobs/{id}`              | `status` (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `argv`, `exit_code`, `last_log_line`, and after the run `files[]` with `path`, `size_bytes`, `sha256` |
| `GET /jobs/{id}/log`          | Everything Boltz printed                                                                                                                                                  |
| `GET /jobs/{id}/files/{path}` | One file under `boltz_results_<record_id>/` (`predictions/` and `msa/` are listed)                                                                                        |
| `POST /jobs/{id}/cancel`      | Stops the run                                                                                                                                                             |
| `DELETE /jobs/{id}`           | Removes the job directory; the API calls it after downloading                                                                                                             |

`succeeded` means only that Boltz exited with code 0. Boltz catches out-of-memory errors and can
exit 0 without a prediction, so the API decides success from the files it downloads.

## Notes for operators

- The worker has no access control beyond the bearer token. Keep it on a private network.
- With `msa_mode: server` Boltz sends the protein sequence to the MSA server named by the API
  setting `HELIX_MSA_SERVER_URL` (default `https://api.colabfold.com`). The public ColabFold
  server is a shared academic resource: submit serially from one IP address and host your own for
  volume or for sequences that must not leave your network.
- Jobs are kept in memory. Restarting the worker forgets running jobs; the API job then fails with
  `worker_unreachable` and can be resubmitted.
