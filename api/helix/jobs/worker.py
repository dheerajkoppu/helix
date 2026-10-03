"""Worker: pulls job IDs from the queue and runs them. The same class runs embedded in the API
process (in-process queue) and standalone (python -m helix.worker, Redis queue)."""

import asyncio
import contextlib

from helix.config import get_settings
from helix.jobs.queue import JobQueue
from helix.jobs.runner import run_job
from helix.jobs.service import recover_jobs, worker_identity
from helix.log import get_logger

logger = get_logger(__name__)

DEQUEUE_TIMEOUT_SECONDS = 1.0
RECOVERY_INTERVAL_SECONDS = 30.0


class Worker:
    def __init__(self, queue: JobQueue, *, concurrency: int | None = None, sweep: bool = False) -> None:
        self.queue = queue
        self.concurrency = concurrency or get_settings().job_concurrency
        self.worker_id = worker_identity()
        self._sweep = sweep
        self._tasks: list[asyncio.Task[None]] = []
        self._stopping = asyncio.Event()

    @property
    def running(self) -> bool:
        return any(not task.done() for task in self._tasks)

    async def start(self) -> None:
        self._stopping.clear()
        for index in range(self.concurrency):
            self._tasks.append(asyncio.create_task(self._loop(), name=f"helix-worker-{index}"))
        if self._sweep:
            self._tasks.append(asyncio.create_task(self._recovery_sweep(), name="helix-worker-sweep"))
        logger.info(
            "Worker %s started: queue=%s concurrency=%d", self.worker_id, self.queue.name, self.concurrency
        )

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                job_id = await self.queue.dequeue(DEQUEUE_TIMEOUT_SECONDS)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Queue read failed; retrying")
                await asyncio.sleep(2.0)
                continue
            if job_id is None:
                continue
            try:
                await run_job(job_id, worker_id=self.worker_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Job %s crashed the runner", job_id)

    async def _recovery_sweep(self) -> None:
        """With separate workers, a job whose worker died is found by its stale heartbeat."""
        while not self._stopping.is_set():
            await asyncio.sleep(RECOVERY_INTERVAL_SECONDS)
            try:
                await recover_jobs(self.queue, all_running_are_orphaned=False)
            except Exception:
                logger.exception("Job recovery sweep failed")

    async def stop(self) -> None:
        """Stop taking jobs. Running jobs are interrupted: restartable ones go back to the queue,
        the others fail with code 'interrupted'."""
        self._stopping.set()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()
        logger.info("Worker %s stopped", self.worker_id)
