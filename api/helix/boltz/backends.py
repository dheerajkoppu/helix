"""Execution backends of the Boltz-2 adapter, behind one interface.

local_cli runs the `boltz` command on this machine. remote_worker sends the same input to the
worker service in api/worker/boltz over HTTP and downloads the result directory, so one parser
reads both. When neither is attached the adapter reports why and runs nothing.
"""

import asyncio
import json
import os
import platform
import shutil
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import httpx

from helix import __version__
from helix.boltz.settings import BoltzSettings
from helix.hashing import sha256_file, sha256_hex
from helix.log import get_logger
from helix.providers.base import ExecutionMode, ProviderError, RunContext

logger = get_logger(__name__)

WORKER_PROTOCOL_VERSION = 1
SETUP_HINT = (
    "Attach compute: run the worker in api/worker/boltz on a GPU machine and set "
    "HELIX_BOLTZ_WORKER_URL, or install boltz on this machine and set HELIX_BOLTZ_BIN. "
    "See docs/providers/boltz2.md."
)
NOT_ATTACHED_REASON = (
    "No Boltz-2 backend is attached: HELIX_BOLTZ_WORKER_URL is not set, HELIX_BOLTZ_BIN is "
    "not set and no `boltz` executable is on PATH."
)

# Pinned weights: Hugging Face boltz-community/boltz-2 at this revision
WEIGHTS_REPOSITORY = "https://huggingface.co/boltz-community/boltz-2"
WEIGHTS_REVISION = "6fdef46d763fee7fbb83ca5501ccceff43b85607"
PINNED_WEIGHTS: dict[str, dict[str, Any]] = {
    "boltz2_conf.ckpt": {
        "size_bytes": 2_286_561_469,
        "sha256": "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1",
    },
    "boltz2_aff.ckpt": {
        "size_bytes": 2_062_139_170,
        "sha256": "dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e",
    },
    "mols.tar": {
        "size_bytes": 1_855_662_080,
        "sha256": "39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7",
    },
}

LOG_FORWARD_SECONDS = 5.0
STATUS_TTL_SECONDS = 30.0
DOWNLOAD_PREFIXES = ("predictions/", "msa/")
DOWNLOAD_SUFFIXES = (".cif", ".pdb", ".json", ".npz", ".a3m", ".csv")

_PROBE = """
import importlib.metadata as metadata, json, platform
found = {"python": platform.python_version()}
for name in ("boltz", "boltz-community", "torch"):
    try:
        found[name] = metadata.version(name)
    except metadata.PackageNotFoundError:
        found[name] = None
print(json.dumps(found))
"""


@dataclass(slots=True)
class BackendStatus:
    available: bool
    reason: str
    backend: str | None = None
    execution_mode: ExecutionMode | None = None
    environment: dict[str, Any] = field(default_factory=dict)
    setup: str | None = None


@dataclass(slots=True)
class BoltzRunRequest:
    record_id: str
    input_yaml: str
    options: list[str]
    # File name under msa/ next to the input file, and its text
    msa_files: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class BoltzRun:
    backend: str
    results_dir: Path
    argv: list[str]
    exit_code: int | None
    log_text: str
    environment: dict[str, Any]
    wall_time_seconds: float | None = None


class BoltzBackend(ABC):
    id: str
    execution_mode: ExecutionMode

    @abstractmethod
    async def status(self) -> BackendStatus: ...

    @abstractmethod
    async def run(self, request: BoltzRunRequest, context: RunContext) -> BoltzRun: ...


def boltz_package(environment: dict[str, Any]) -> tuple[str | None, str | None]:
    """Distribution name and version of the Boltz installation an environment reports."""
    if environment.get("boltz-community"):
        return "boltz-community", str(environment["boltz-community"])
    if environment.get("boltz"):
        return "boltz", str(environment["boltz"])
    return None, None


def accelerator_problem(environment: dict[str, Any], accelerator: str) -> str | None:
    """Combinations the Boltz documentation and issue tracker rule out."""
    distribution, version = boltz_package(environment)
    if accelerator == "cpu" and distribution == "boltz" and version == "2.2.1":
        return (
            "boltz 2.2.1 produces distorted structures on CPU (upstream issue 653). Use a GPU, or "
            "install boltz-community, which carries the fix."
        )
    if accelerator == "mps" and distribution == "boltz":
        return (
            "The upstream boltz package does not accept --accelerator mps. Install boltz-community "
            "for Apple Silicon."
        )
    return None


def _default_accelerator() -> str:
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "mps"
    return "gpu"


def _weights_in(cache_dir: Path) -> list[dict[str, Any]]:
    """Checkpoint files present in the cache, hashed and compared with the pinned values."""
    weights: list[dict[str, Any]] = []
    for name, pinned in PINNED_WEIGHTS.items():
        path = cache_dir / name
        if not path.is_file():
            continue
        digest, size = _hash_cached(path)
        weights.append(
            {
                "name": name,
                "size_bytes": size,
                "sha256": digest,
                "matches_pinned": digest == pinned["sha256"],
                "uri": f"{WEIGHTS_REPOSITORY}/resolve/{WEIGHTS_REVISION}/{name}",
                "revision": WEIGHTS_REVISION,
            }
        )
    return weights


_hashes: dict[tuple[str, int, int], tuple[str, int]] = {}


def _hash_cached(path: Path) -> tuple[str, int]:
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _hashes:
        _hashes[key] = sha256_file(path)
    return _hashes[key]


class LocalCliBackend(BoltzBackend):
    id = "local_cli"
    execution_mode = ExecutionMode.LOCAL_CLI

    def __init__(self, settings: BoltzSettings, executable: str) -> None:
        self.settings = settings
        self.executable = executable
        self.accelerator = settings.boltz_accelerator or _default_accelerator()
        self._environment: dict[str, Any] | None = None

    @property
    def cache_dir(self) -> Path:
        if self.settings.boltz_cache_dir:
            return self.settings.boltz_cache_dir.expanduser().resolve()
        return Path(os.environ.get("BOLTZ_CACHE") or Path.home() / ".boltz").expanduser()

    def _interpreter(self) -> str | None:
        """Python interpreter of the boltz console script, read from its first line."""
        try:
            with open(self.executable, "rb") as handle:
                first_line = handle.readline(512).decode("utf-8", "replace").strip()
        except OSError:
            return None
        if not first_line.startswith("#!"):
            return None
        parts = first_line[2:].split()
        if not parts:
            return None
        if Path(parts[0]).name == "env" and len(parts) > 1:
            return shutil.which(parts[-1])
        return parts[0]

    async def _probe(self) -> dict[str, Any]:
        if self._environment is not None:
            return self._environment
        environment: dict[str, Any] = {
            "backend": self.id,
            "executable": self.executable,
            "accelerator": self.accelerator,
            "devices": self.settings.boltz_devices,
            "cache_dir": str(self.cache_dir),
            "os": sys.platform,
        }
        interpreter = self._interpreter()
        if interpreter:
            try:
                process = await asyncio.create_subprocess_exec(
                    interpreter,
                    "-c",
                    _PROBE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                output, _ = await asyncio.wait_for(process.communicate(), timeout=30)
                environment.update(json.loads(output.decode() or "{}"))
            except (OSError, TimeoutError, ValueError) as error:
                logger.warning("Could not read the Boltz installation of %s: %s", self.executable, error)
        nvidia_smi = shutil.which("nvidia-smi") if self.accelerator == "gpu" else None
        if nvidia_smi:
            try:
                process = await asyncio.create_subprocess_exec(
                    nvidia_smi,
                    "--query-gpu=name,memory.total",
                    "--format=csv,noheader",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                output, _ = await asyncio.wait_for(process.communicate(), timeout=15)
                gpus = [line.strip() for line in output.decode().splitlines() if line.strip()]
                if gpus:
                    environment["gpu_model"] = gpus[0].split(",")[0].strip()
                    environment["gpu_count"] = len(gpus)
                    environment["gpus"] = gpus
            except (OSError, TimeoutError) as error:
                logger.warning("nvidia-smi did not answer: %s", error)
        self._environment = environment
        return environment

    async def status(self) -> BackendStatus:
        path = Path(self.executable)
        if not path.is_file() or not os.access(path, os.X_OK):
            return BackendStatus(
                available=False,
                reason=f"The Boltz executable '{self.executable}' does not exist or is not executable.",
                backend=self.id,
                execution_mode=self.execution_mode,
                setup=SETUP_HINT,
            )
        environment = await self._probe()
        problem = accelerator_problem(environment, self.accelerator)
        if problem:
            return BackendStatus(
                available=False,
                reason=problem,
                backend=self.id,
                execution_mode=self.execution_mode,
                environment=environment,
                setup=SETUP_HINT,
            )
        distribution, version = boltz_package(environment)
        installed = f"{distribution} {version}" if distribution else "Boltz (version not readable)"
        return BackendStatus(
            available=True,
            reason=f"Local command line: {installed} at {self.executable}, accelerator {self.accelerator}.",
            backend=self.id,
            execution_mode=self.execution_mode,
            environment=environment,
        )

    def argv(self, input_path: Path, out_dir: Path, options: list[str]) -> list[str]:
        argv = [self.executable, "predict", str(input_path), "--out_dir", str(out_dir)]
        if self.settings.boltz_cache_dir:
            argv += ["--cache", str(self.cache_dir)]
        argv += ["--accelerator", self.accelerator, "--devices", str(self.settings.boltz_devices)]
        argv += options
        if self.settings.boltz_no_kernels:
            argv.append("--no_kernels")
        return argv

    async def run(self, request: BoltzRunRequest, context: RunContext) -> BoltzRun:
        job_dir = context.workdir / "boltz"
        input_dir = job_dir / "input"
        out_dir = job_dir / "out"
        (input_dir / "msa").mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        input_path = input_dir / f"{request.record_id}.yaml"
        input_path.write_text(request.input_yaml, encoding="utf-8")
        for name, text in request.msa_files.items():
            (input_dir / "msa" / PurePosixPath(name).name).write_text(text, encoding="utf-8")

        argv = self.argv(input_path, out_dir, request.options)
        await context.log("Starting Boltz.", argv=argv)
        started = time.monotonic()
        try:
            # MSA paths in the input are relative to the input directory
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=input_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except OSError as error:
            raise ProviderError(
                "boltz_not_runnable", f"The Boltz executable could not be started: {error}"
            ) from error

        chunks: list[str] = []

        async def pump() -> None:
            assert process.stdout is not None
            forwarded_at = 0.0
            while True:
                chunk = await process.stdout.read(8192)
                if not chunk:
                    return
                text = chunk.decode("utf-8", "replace")
                chunks.append(text)
                now = time.monotonic()
                if now - forwarded_at >= LOG_FORWARD_SECONDS:
                    lines = [line.strip() for line in text.replace("\r", "\n").splitlines() if line.strip()]
                    if lines:
                        forwarded_at = now
                        await context.log(lines[-1][:500])

        pump_task = asyncio.create_task(pump())
        wait_task = asyncio.create_task(process.wait())
        try:
            while not wait_task.done():
                await asyncio.wait({wait_task}, timeout=1.0)
                if wait_task.done():
                    break
                if time.monotonic() - started > self.settings.boltz_timeout_seconds:
                    raise ProviderError(
                        "boltz_timeout",
                        f"Boltz did not finish within {self.settings.boltz_timeout_seconds:g} seconds "
                        "and was stopped.",
                    )
                await context.check_cancelled()
        except BaseException:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=10)
                except TimeoutError:
                    process.kill()
            pump_task.cancel()
            raise
        await pump_task
        environment = dict(await self._probe())
        environment["weights"] = await asyncio.to_thread(_weights_in, self.cache_dir)
        return BoltzRun(
            backend=self.id,
            results_dir=out_dir / f"boltz_results_{request.record_id}",
            argv=argv,
            exit_code=process.returncode,
            log_text="".join(chunks),
            environment=environment,
            wall_time_seconds=round(time.monotonic() - started, 3),
        )


class RemoteWorkerBackend(BoltzBackend):
    """Client of the worker protocol implemented in api/worker/boltz/server.py."""

    id = "remote_worker"
    execution_mode = ExecutionMode.GPU_WORKER

    def __init__(self, settings: BoltzSettings, url: str) -> None:
        self.settings = settings
        self.url = url
        self._status: BackendStatus | None = None
        self._status_at = 0.0

    def _client(self, timeout: float = 30.0) -> httpx.AsyncClient:
        headers = {"User-Agent": f"Helix/{__version__} boltz-adapter"}
        if self.settings.boltz_worker_token:
            headers["Authorization"] = f"Bearer {self.settings.boltz_worker_token}"
        return httpx.AsyncClient(base_url=self.url, headers=headers, timeout=timeout)

    def _unavailable(self, reason: str, environment: dict[str, Any] | None = None) -> BackendStatus:
        return BackendStatus(
            available=False,
            reason=reason,
            backend=self.id,
            execution_mode=self.execution_mode,
            environment=environment or {},
            setup=SETUP_HINT,
        )

    async def status(self) -> BackendStatus:
        if self._status is not None and time.monotonic() - self._status_at < STATUS_TTL_SECONDS:
            return self._status
        self._status = await self._check()
        self._status_at = time.monotonic()
        return self._status

    async def _check(self) -> BackendStatus:
        try:
            async with self._client(timeout=8.0) as client:
                response = await client.get("/health")
        except httpx.HTTPError as error:
            return self._unavailable(
                f"The Boltz worker at {self.url} did not answer ({type(error).__name__})."
            )
        if response.status_code in (401, 403):
            return self._unavailable(
                f"The Boltz worker at {self.url} refused the token (HTTP {response.status_code}). "
                "Set HELIX_BOLTZ_WORKER_TOKEN to the worker's BOLTZ_WORKER_TOKEN."
            )
        try:
            health = response.json() if response.status_code == 200 else None
        except ValueError:
            health = None
        if not isinstance(health, dict) or health.get("service") != "helix-boltz-worker":
            return self._unavailable(
                f"{self.url} is not an Helix Boltz worker (HTTP {response.status_code})."
            )
        environment = {"backend": self.id, "worker_url": self.url, **(health.get("environment") or {})}
        if health.get("protocol_version") != WORKER_PROTOCOL_VERSION:
            return self._unavailable(
                f"The Boltz worker speaks protocol {health.get('protocol_version')}; this API expects "
                f"{WORKER_PROTOCOL_VERSION}. Update the worker.",
                environment,
            )
        if not health.get("ready"):
            return self._unavailable(
                f"The Boltz worker at {self.url} is not ready: {health.get('reason') or 'no reason given'}",
                environment,
            )
        problem = accelerator_problem(environment, str(environment.get("accelerator")))
        if problem:
            return self._unavailable(problem, environment)
        distribution, version = boltz_package(environment)
        return BackendStatus(
            available=True,
            reason=(
                f"GPU worker at {self.url}: {distribution or 'Boltz'} {version or '(version not reported)'}, "
                f"accelerator {environment.get('accelerator')}."
            ),
            backend=self.id,
            execution_mode=self.execution_mode,
            environment=environment,
        )

    async def run(self, request: BoltzRunRequest, context: RunContext) -> BoltzRun:
        started = time.monotonic()
        async with self._client() as client:
            try:
                response = await client.post(
                    "/jobs",
                    json={
                        "record_id": request.record_id,
                        "input_yaml": request.input_yaml,
                        "msa_files": request.msa_files,
                        "options": request.options,
                        "timeout_seconds": self.settings.boltz_timeout_seconds,
                        "client_job_id": context.job_id,
                    },
                )
            except httpx.HTTPError as error:
                raise ProviderError(
                    "worker_unreachable", f"The Boltz worker did not accept the job ({type(error).__name__})."
                ) from error
            if response.status_code not in (200, 202):
                raise ProviderError(
                    "worker_rejected",
                    f"The Boltz worker rejected the job (HTTP {response.status_code}).",
                    {"response": response.text[:2000]},
                )
            worker_job_id = response.json()["id"]
            await context.log(f"Submitted to the Boltz worker as {worker_job_id}.", worker_url=self.url)

            state: dict[str, Any] = {}
            last_status = ""
            last_line = ""
            failures = 0
            try:
                while True:
                    await context.check_cancelled()
                    try:
                        response = await client.get(f"/jobs/{worker_job_id}")
                        response.raise_for_status()
                        state = response.json()
                        failures = 0
                    except httpx.HTTPError as error:
                        failures += 1
                        if failures >= 10:
                            raise ProviderError(
                                "worker_unreachable",
                                f"The Boltz worker stopped answering ({type(error).__name__}).",
                            ) from error
                    status = str(state.get("status", ""))
                    line = str(state.get("last_log_line") or "")
                    if status != last_status:
                        last_status = status
                        await context.log(f"Worker status: {status}.")
                    elif line and line != last_line:
                        last_line = line
                        await context.log(line[:500])
                    if status in ("succeeded", "failed", "cancelled"):
                        break
                    if time.monotonic() - started > self.settings.boltz_timeout_seconds + 60:
                        raise ProviderError("boltz_timeout", "The Boltz worker did not finish in time.")
                    await asyncio.sleep(self.settings.boltz_worker_poll_seconds)
            except BaseException:
                try:
                    await client.post(f"/jobs/{worker_job_id}/cancel")
                except httpx.HTTPError:
                    logger.warning("Could not cancel worker job %s", worker_job_id)
                raise

            log_text = ""
            try:
                log_response = await client.get(f"/jobs/{worker_job_id}/log")
                if log_response.status_code == 200:
                    log_text = log_response.text
            except httpx.HTTPError:
                await context.log("The worker log could not be downloaded.", level="warning")

            results_dir = context.workdir / "boltz" / "out" / f"boltz_results_{request.record_id}"
            await self._download(client, worker_job_id, state.get("files") or [], results_dir, context)
            try:
                await client.delete(f"/jobs/{worker_job_id}")
            except httpx.HTTPError:
                logger.warning("Could not delete worker job %s", worker_job_id)

        health = await self.status()
        return BoltzRun(
            backend=self.id,
            results_dir=results_dir,
            argv=list(state.get("argv") or []),
            exit_code=state.get("exit_code"),
            log_text=log_text,
            environment={**health.environment, **(state.get("environment") or {})},
            wall_time_seconds=state.get("wall_time_seconds"),
        )

    async def _download(
        self,
        client: httpx.AsyncClient,
        worker_job_id: str,
        listing: list[dict[str, Any]],
        results_dir: Path,
        context: RunContext,
    ) -> None:
        """Copy the worker's result files into the same layout Boltz writes locally, checking each
        against the SHA-256 the worker reported."""
        wanted = [
            entry
            for entry in listing
            if str(entry.get("path", "")).startswith(DOWNLOAD_PREFIXES)
            and str(entry.get("path", "")).endswith(DOWNLOAD_SUFFIXES)
        ]
        for entry in wanted:
            await context.check_cancelled()
            relative = PurePosixPath(str(entry["path"]))
            if relative.is_absolute() or ".." in relative.parts:
                raise ProviderError("worker_invalid_path", f"The worker listed an unsafe path: {relative}")
            try:
                response = await client.get(f"/jobs/{worker_job_id}/files/{relative}", timeout=300.0)
                response.raise_for_status()
            except httpx.HTTPError as error:
                raise ProviderError(
                    "worker_download_failed", f"{relative} could not be downloaded from the worker."
                ) from error
            if entry.get("sha256") and sha256_hex(response.content) != entry["sha256"]:
                raise ProviderError(
                    "worker_checksum_mismatch",
                    f"{relative} does not match the SHA-256 the worker reported.",
                )
            target = results_dir.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(response.content)
        await context.log(f"Downloaded {len(wanted)} result files from the worker.")


def resolve_backend(settings: BoltzSettings) -> BoltzBackend | None:
    """The attached backend, or None when nothing is configured. A configured worker wins over a
    local executable unless HELIX_BOLTZ_BACKEND says otherwise."""
    wants = settings.boltz_backend
    if wants in ("auto", "remote_worker") and settings.worker_url:
        return RemoteWorkerBackend(settings, settings.worker_url)
    if wants in ("auto", "local_cli"):
        executable = settings.boltz_bin or shutil.which("boltz")
        if executable:
            resolved = shutil.which(executable) or executable
            return LocalCliBackend(settings, resolved)
    return None
