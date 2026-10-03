"""Helix Boltz worker: runs `boltz predict` on a machine with a GPU and serves the result files.

Protocol (version 1), used by helix.boltz.backends.RemoteWorkerBackend:

    GET    /health                      installation, accelerator, weights, readiness
    POST   /jobs                        submit {record_id, input_yaml, options, msa_files}
    GET    /jobs/{id}                   status, argv, exit code, result file listing with SHA-256
    GET    /jobs/{id}/log               everything Boltz printed
    GET    /jobs/{id}/files/{path}      one result file under boltz_results_<record_id>/
    POST   /jobs/{id}/cancel            stop the run
    DELETE /jobs/{id}                   remove the job directory

The worker runs one prediction at a time and decides nothing about the science: it executes the
options it is given, from an allow-list of documented Boltz flags, and adds the options that belong
to its machine (--cache, --accelerator, --devices, --no_kernels). It never writes a result file
itself. Python 3.12; no dependency on the helix package.
"""

import asyncio
import hashlib
import importlib.metadata
import os
import platform
import re
import shutil
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

PROTOCOL_VERSION = 1
BOLTZ_BIN = os.environ.get("BOLTZ_BIN", "boltz")
CACHE_DIR = Path(os.environ.get("BOLTZ_CACHE", str(Path.home() / ".boltz"))).expanduser()
ACCELERATOR = os.environ.get("BOLTZ_ACCELERATOR", "gpu")
DEVICES = os.environ.get("BOLTZ_DEVICES", "1")
NO_KERNELS = os.environ.get("BOLTZ_NO_KERNELS", "").lower() in ("1", "true", "yes")
TOKEN = os.environ.get("BOLTZ_WORKER_TOKEN") or None
DATA_DIR = Path(os.environ.get("BOLTZ_WORKER_DATA", "/data/jobs")).expanduser()
CONTAINER_IMAGE = os.environ.get("BOLTZ_WORKER_IMAGE") or None
CONTAINER_DIGEST = os.environ.get("BOLTZ_WORKER_IMAGE_DIGEST") or None
MAX_TIMEOUT_SECONDS = float(os.environ.get("BOLTZ_WORKER_MAX_TIMEOUT", "14400"))

RECORD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
MSA_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.(a3m|csv)$")

# Documented `boltz predict` options a client may set: name -> takes a value
ALLOWED_OPTIONS: dict[str, bool] = {
    "--model": True,
    "--recycling_steps": True,
    "--sampling_steps": True,
    "--diffusion_samples": True,
    "--max_parallel_samples": True,
    "--step_scale": True,
    "--max_msa_seqs": True,
    "--output_format": True,
    "--subsample_msa": False,
    "--num_subsampled_msa": True,
    "--use_msa_server": False,
    "--msa_server_url": True,
    "--msa_pairing_strategy": True,
    "--use_potentials": False,
    "--write_full_pae": False,
    "--write_full_pde": False,
    "--sampling_steps_affinity": True,
    "--diffusion_samples_affinity": True,
    "--affinity_mw_correction": False,
    "--seed": True,
    "--override": False,
}

# Hugging Face boltz-community/boltz-2 at revision 6fdef46d763fee7fbb83ca5501ccceff43b85607
WEIGHTS_REVISION = "6fdef46d763fee7fbb83ca5501ccceff43b85607"
PINNED_WEIGHTS = {
    "boltz2_conf.ckpt": "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1",
    "boltz2_aff.ckpt": "dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e",
    "mols.tar": "39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7",
}


class JobSubmission(BaseModel):
    record_id: str
    input_yaml: str = Field(max_length=2_000_000)
    options: list[str] = Field(default_factory=list, max_length=80)
    msa_files: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: float = 7200.0
    client_job_id: str | None = None


@dataclass
class WorkerJob:
    id: str
    record_id: str
    directory: Path
    argv: list[str]
    timeout_seconds: float
    status: str = "queued"
    exit_code: int | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    last_log_line: str | None = None
    cancel_requested: bool = False
    process: asyncio.subprocess.Process | None = None

    @property
    def log_path(self) -> Path:
        return self.directory / "boltz.log"

    @property
    def results_dir(self) -> Path:
        return self.directory / "out" / f"boltz_results_{self.record_id}"


jobs: dict[str, WorkerJob] = {}
queue: asyncio.Queue[str] = asyncio.Queue()
weights: list[dict[str, Any]] = []


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def hash_weights() -> list[dict[str, Any]]:
    found = []
    for name, pinned in PINNED_WEIGHTS.items():
        path = CACHE_DIR / name
        if path.is_file():
            digest = sha256_of(path)
            found.append(
                {
                    "name": name,
                    "size_bytes": path.stat().st_size,
                    "sha256": digest,
                    "matches_pinned": digest == pinned,
                    "revision": WEIGHTS_REVISION,
                    "uri": f"https://huggingface.co/boltz-community/boltz-2/resolve/{WEIGHTS_REVISION}/{name}",
                }
            )
    return found


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def gpus() -> list[str]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    try:
        completed = subprocess.run(
            [executable, "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def environment() -> dict[str, Any]:
    found = gpus()
    return {
        "boltz": package_version("boltz"),
        "boltz-community": package_version("boltz-community"),
        "torch": package_version("torch"),
        "python": platform.python_version(),
        "os": platform.system().lower(),
        "accelerator": ACCELERATOR,
        "devices": int(DEVICES),
        "no_kernels": NO_KERNELS,
        "cache_dir": str(CACHE_DIR),
        "gpu_model": found[0].split(",")[0].strip() if found else None,
        "gpu_count": len(found) or None,
        "gpus": found,
        "weights": weights,
        "container": (
            {"image": CONTAINER_IMAGE, "digest": CONTAINER_DIGEST} if CONTAINER_IMAGE and CONTAINER_DIGEST else None
        ),
    }


def readiness() -> tuple[bool, str]:
    if not shutil.which(BOLTZ_BIN):
        return False, f"The boltz executable '{BOLTZ_BIN}' was not found."
    if ACCELERATOR == "gpu" and not gpus():
        return False, "BOLTZ_ACCELERATOR is gpu, but nvidia-smi reports no GPU."
    return True, "Ready."


def checked_options(options: list[str]) -> list[str]:
    index = 0
    while index < len(options):
        name = options[index]
        if name not in ALLOWED_OPTIONS:
            raise HTTPException(422, f"Option {name} is not accepted by this worker.")
        index += 1
        if ALLOWED_OPTIONS[name]:
            if index >= len(options) or options[index].startswith("--"):
                raise HTTPException(422, f"Option {name} needs a value.")
            index += 1
    if "--seed" not in options:
        raise HTTPException(422, "A seed is required: pass --seed.")
    return options


async def authorised(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "Missing or wrong bearer token.")


def job_or_404(job_id: str) -> WorkerJob:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"No job {job_id}.")
    return job


def result_files(job: WorkerJob) -> list[dict[str, Any]]:
    if not job.results_dir.is_dir():
        return []
    listing = []
    for path in sorted(job.results_dir.rglob("*")):
        relative = path.relative_to(job.results_dir).as_posix()
        if path.is_file() and relative.startswith(("predictions/", "msa/")):
            listing.append({"path": relative, "size_bytes": path.stat().st_size, "sha256": sha256_of(path)})
    return listing


async def execute(job: WorkerJob) -> None:
    job.status = "running"
    job.started_at = time.time()
    with open(job.log_path, "wb") as log:
        process = await asyncio.create_subprocess_exec(
            *job.argv,
            cwd=job.directory / "input",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        job.process = process

        async def pump() -> None:
            assert process.stdout is not None
            while chunk := await process.stdout.read(8192):
                log.write(chunk)
                log.flush()
                lines = [line.strip() for line in chunk.decode("utf-8", "replace").replace("\r", "\n").splitlines()]
                lines = [line for line in lines if line]
                if lines:
                    job.last_log_line = lines[-1][:500]

        pump_task = asyncio.create_task(pump())
        try:
            await asyncio.wait_for(process.wait(), timeout=job.timeout_seconds)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            job.error = f"Boltz did not finish within {job.timeout_seconds:g} seconds and was stopped."
        await pump_task
    job.exit_code = process.returncode
    job.completed_at = time.time()
    if job.cancel_requested:
        job.status = "cancelled"
    elif job.error or job.exit_code != 0:
        job.status = "failed"
        job.error = job.error or f"Boltz exited with code {job.exit_code}."
    else:
        # The client decides success from the files: Boltz can exit 0 without a prediction
        job.status = "succeeded"


async def consume() -> None:
    while True:
        job = jobs.get(await queue.get())
        if job is None or job.cancel_requested:
            continue
        try:
            await execute(job)
        except Exception as error:
            job.status = "failed"
            job.error = f"{type(error).__name__}: {error}"
            job.completed_at = time.time()
        global weights
        if len(weights) < len(PINNED_WEIGHTS):
            # Boltz downloads missing checkpoints on its first run
            weights = await asyncio.to_thread(hash_weights)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global weights
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    weights = await asyncio.to_thread(hash_weights)
    consumer = asyncio.create_task(consume())
    yield
    consumer.cancel()


app = FastAPI(title="Helix Boltz worker", version=str(PROTOCOL_VERSION), lifespan=lifespan)


@app.get("/health", dependencies=[Depends(authorised)])
async def health() -> dict[str, Any]:
    ready, reason = readiness()
    return {
        "service": "helix-boltz-worker",
        "protocol_version": PROTOCOL_VERSION,
        "ready": ready,
        "reason": reason,
        "queued": queue.qsize(),
        "running": [job.id for job in jobs.values() if job.status == "running"],
        "environment": environment(),
    }


@app.post("/jobs", status_code=202, dependencies=[Depends(authorised)])
async def submit(submission: JobSubmission) -> dict[str, Any]:
    ready, reason = readiness()
    if not ready:
        raise HTTPException(503, reason)
    if not RECORD_ID.match(submission.record_id):
        raise HTTPException(422, "record_id must be letters, digits, underscore or hyphen.")
    options = checked_options(submission.options)
    job_id = f"wjob_{uuid.uuid4().hex}"
    directory = DATA_DIR / job_id
    input_dir = directory / "input"
    (input_dir / "msa").mkdir(parents=True)
    (directory / "out").mkdir()
    input_path = input_dir / f"{submission.record_id}.yaml"
    input_path.write_text(submission.input_yaml, encoding="utf-8")
    for name, text in submission.msa_files.items():
        if not MSA_NAME.match(name):
            raise HTTPException(422, f"'{name}' is not an accepted alignment file name.")
        (input_dir / "msa" / name).write_text(text, encoding="utf-8")

    argv = [BOLTZ_BIN, "predict", str(input_path), "--out_dir", str(directory / "out")]
    argv += ["--cache", str(CACHE_DIR), "--accelerator", ACCELERATOR, "--devices", DEVICES, *options]
    if NO_KERNELS:
        argv.append("--no_kernels")
    job = WorkerJob(
        id=job_id,
        record_id=submission.record_id,
        directory=directory,
        argv=argv,
        timeout_seconds=min(submission.timeout_seconds, MAX_TIMEOUT_SECONDS),
    )
    jobs[job_id] = job
    await queue.put(job_id)
    return {"id": job_id, "status": job.status}


@app.get("/jobs/{job_id}", dependencies=[Depends(authorised)])
async def status(job_id: str) -> dict[str, Any]:
    job = job_or_404(job_id)
    finished = job.status in ("succeeded", "failed", "cancelled")
    return {
        "id": job.id,
        "record_id": job.record_id,
        "status": job.status,
        "argv": job.argv,
        "exit_code": job.exit_code,
        "error": job.error,
        "last_log_line": job.last_log_line,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "wall_time_seconds": (
            round(job.completed_at - job.started_at, 3) if job.started_at and job.completed_at else None
        ),
        "files": await asyncio.to_thread(result_files, job) if finished else [],
        "environment": environment() if finished else None,
    }


@app.get("/jobs/{job_id}/log", response_class=PlainTextResponse, dependencies=[Depends(authorised)])
async def log(job_id: str) -> str:
    job = job_or_404(job_id)
    return job.log_path.read_text(encoding="utf-8", errors="replace") if job.log_path.is_file() else ""


@app.get("/jobs/{job_id}/files/{path:path}", dependencies=[Depends(authorised)])
async def file(job_id: str, path: str) -> FileResponse:
    job = job_or_404(job_id)
    relative = PurePosixPath(path)
    if relative.is_absolute() or ".." in relative.parts:
        raise HTTPException(400, "Invalid path.")
    target = (job.results_dir / relative).resolve()
    if not target.is_relative_to(job.results_dir.resolve()) or not target.is_file():
        raise HTTPException(404, "No such result file.")
    return FileResponse(target)


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(authorised)])
async def cancel(job_id: str) -> dict[str, Any]:
    job = job_or_404(job_id)
    if job.status in ("queued", "running"):
        job.cancel_requested = True
        if job.process is not None and job.process.returncode is None:
            job.process.terminate()
        elif job.status == "queued":
            job.status = "cancelled"
            job.completed_at = time.time()
    return {"id": job.id, "status": job.status, "cancel_requested": job.cancel_requested}


@app.delete("/jobs/{job_id}", dependencies=[Depends(authorised)])
async def delete(job_id: str) -> dict[str, Any]:
    job = job_or_404(job_id)
    if job.status in ("queued", "running"):
        raise HTTPException(409, "Cancel the job before deleting it.")
    shutil.rmtree(job.directory, ignore_errors=True)
    del jobs[job_id]
    return {"id": job_id, "deleted": True}
