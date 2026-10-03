"""Job event log: append-only rows in the database, plus an in-process wake-up for SSE listeners.

The database is the source of truth, so events written by a worker in another process are still
delivered: listeners poll for rows after the last ID they sent and are woken early when the writer
is in the same process.
"""

import asyncio
from collections import defaultdict
from typing import Any

from sqlalchemy import select

from orphafold.db.models import JobEvent
from orphafold.db.session import session_scope
from orphafold.hashing import to_jsonable


class EventBus:
    def __init__(self) -> None:
        self._listeners: dict[str, set[asyncio.Event]] = defaultdict(set)

    def subscribe(self, job_id: str) -> asyncio.Event:
        signal = asyncio.Event()
        self._listeners[job_id].add(signal)
        return signal

    def unsubscribe(self, job_id: str, signal: asyncio.Event) -> None:
        listeners = self._listeners.get(job_id)
        if listeners is None:
            return
        listeners.discard(signal)
        if not listeners:
            self._listeners.pop(job_id, None)

    def notify(self, job_id: str) -> None:
        for signal in self._listeners.get(job_id, ()):
            signal.set()


event_bus = EventBus()

# Job IDs with a cancellation requested in this process: lets a running handler see it at once
cancel_signals: set[str] = set()


async def append_event(
    job_id: str,
    event_type: str,
    *,
    stage_id: str | None = None,
    level: str | None = None,
    message: str | None = None,
    data: dict[str, Any] | None = None,
) -> int:
    async with session_scope() as session:
        event = JobEvent(
            job_id=job_id,
            type=event_type,
            stage_id=stage_id,
            level=level,
            message=message,
            data=to_jsonable(data) if data is not None else None,
        )
        session.add(event)
        await session.flush()
        event_id = event.id
    event_bus.notify(job_id)
    return event_id


async def events_after(job_id: str, after_id: int = 0, limit: int = 500) -> list[JobEvent]:
    async with session_scope() as session:
        rows = await session.scalars(
            select(JobEvent)
            .where(JobEvent.job_id == job_id, JobEvent.id > after_id)
            .order_by(JobEvent.id)
            .limit(limit)
        )
        return list(rows)
