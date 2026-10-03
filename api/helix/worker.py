"""Standalone job worker for the Redis queue.

    cd api && HELIX_REDIS_URL=redis://localhost:6379/0 .venv/bin/python -m helix.worker

Compute runs here, separate from the web server. The API process only enqueues job IDs.
"""

import argparse
import asyncio
import signal

from helix.artifacts.store import get_artifact_store
from helix.config import get_settings
from helix.db.session import create_all, dispose_engine, init_engine
from helix.jobs.queue import create_queue
from helix.jobs.registry import all_handlers
from helix.jobs.service import recover_jobs
from helix.jobs.worker import Worker
from helix.knowledge.catalog import load_catalog
from helix.log import configure_logging, get_logger
from helix.plugins import load_plugins
from helix.sources.base import close_http_clients

logger = get_logger(__name__)


async def run_worker(concurrency: int | None = None) -> None:
    settings = get_settings()
    if settings.resolved_job_queue != "redis":
        raise SystemExit(
            "python -m helix.worker needs the Redis queue: set HELIX_REDIS_URL. "
            "Without Redis the API process runs jobs itself."
        )
    load_plugins()
    init_engine(settings)
    await create_all()
    load_catalog()
    get_artifact_store()

    queue = create_queue(settings)
    await queue.connect()
    await recover_jobs(queue, all_running_are_orphaned=False)
    worker = Worker(queue, concurrency=concurrency, sweep=True)
    await worker.start()
    logger.info("Handling job kinds: %s", ", ".join(handler.kind for handler in all_handlers()) or "none")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_number in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_number, stop.set)
    try:
        await stop.wait()
    finally:
        await worker.stop()
        await queue.close()
        await close_http_clients()
        await dispose_engine()


def main() -> None:
    parser = argparse.ArgumentParser(description="Helix job worker (Redis queue)")
    parser.add_argument("--concurrency", type=int, default=None, help="Jobs run at once (default: settings)")
    arguments = parser.parse_args()
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    asyncio.run(run_worker(arguments.concurrency))


if __name__ == "__main__":
    main()
