"""Job queue abstraction. The queue carries job IDs only; job state lives in the database.

memory: asyncio queue inside the API process (default, zero setup).
redis:  a Redis list shared with separate worker processes (python -m orphafold.worker).
"""

import asyncio
from abc import ABC, abstractmethod
from typing import Any

from orphafold.config import Settings, get_settings
from orphafold.errors import NotConfigured
from orphafold.log import get_logger

logger = get_logger(__name__)

REDIS_QUEUE_KEY = "orphafold:jobs"


class JobQueue(ABC):
    name: str

    async def connect(self) -> None:
        return None

    async def close(self) -> None:
        return None

    @abstractmethod
    async def enqueue(self, job_id: str) -> None: ...

    @abstractmethod
    async def dequeue(self, timeout: float) -> str | None:
        """Next job ID, or None when nothing arrived within the timeout."""

    @abstractmethod
    async def contains(self, job_id: str) -> bool: ...

    @abstractmethod
    async def depth(self) -> int: ...


class InProcessJobQueue(JobQueue):
    name = "memory"

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._pending: set[str] = set()

    async def enqueue(self, job_id: str) -> None:
        if job_id in self._pending:
            return
        self._pending.add(job_id)
        self._queue.put_nowait(job_id)

    async def dequeue(self, timeout: float) -> str | None:
        try:
            job_id = await asyncio.wait_for(self._queue.get(), timeout)
        except TimeoutError:
            return None
        self._pending.discard(job_id)
        return job_id

    async def contains(self, job_id: str) -> bool:
        return job_id in self._pending

    async def depth(self) -> int:
        return self._queue.qsize()


class RedisJobQueue(JobQueue):
    name = "redis"

    def __init__(self, url: str, key: str = REDIS_QUEUE_KEY) -> None:
        try:
            import redis.asyncio as redis_asyncio
        except ImportError as error:
            raise NotConfigured(
                "Redis job queue",
                "The Redis job queue needs the redis package: pip install 'orphafold[redis]'.",
            ) from error
        self._key = key
        self._client: Any = redis_asyncio.from_url(url, decode_responses=True)

    async def connect(self) -> None:
        await self._client.ping()

    async def close(self) -> None:
        await self._client.aclose()

    async def enqueue(self, job_id: str) -> None:
        if await self.contains(job_id):
            return
        await self._client.lpush(self._key, job_id)

    async def dequeue(self, timeout: float) -> str | None:
        item = await self._client.brpop([self._key], timeout=max(1, int(timeout)))
        return item[1] if item else None

    async def contains(self, job_id: str) -> bool:
        return await self._client.lpos(self._key, job_id) is not None

    async def depth(self) -> int:
        return int(await self._client.llen(self._key))


_queue: JobQueue | None = None


def create_queue(settings: Settings | None = None) -> JobQueue:
    settings = settings or get_settings()
    if settings.resolved_job_queue == "redis":
        if not settings.redis_url:
            raise NotConfigured("Redis job queue", setting="ORPHAFOLD_REDIS_URL")
        return RedisJobQueue(settings.redis_url)
    return InProcessJobQueue()


def get_queue() -> JobQueue:
    global _queue
    if _queue is None:
        _queue = create_queue()
    return _queue


def set_queue(queue: JobQueue | None) -> None:
    global _queue
    _queue = queue
