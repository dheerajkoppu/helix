"""In-process cache of assembled discovery responses.

The bridges already share the database-backed HTTP cache of every source adapter, so a repeat call
costs no upstream requests. This cache goes one step further and keeps the assembled response, so a
repeat call for the same subject answers in well under a second without rebuilding the chains.
"""

import time
from typing import Any

TTL_SECONDS = 15 * 60
MAX_ENTRIES = 128

_entries: dict[str, tuple[float, Any]] = {}


def key_for(*, gene: str | None, disease: str | None, variant: str | None, exclude_direct: bool) -> str:
    return "|".join(
        [
            (gene or "").strip().upper(),
            (disease or "").strip().lower(),
            (variant or "").strip(),
            "held_out" if exclude_direct else "full",
        ]
    )


def get(key: str) -> Any | None:
    entry = _entries.get(key)
    if entry is None:
        return None
    stored_at, value = entry
    if time.monotonic() - stored_at > TTL_SECONDS:
        _entries.pop(key, None)
        return None
    return value


def put(key: str, value: Any) -> None:
    if len(_entries) >= MAX_ENTRIES:
        oldest = min(_entries, key=lambda item: _entries[item][0])
        _entries.pop(oldest, None)
    _entries[key] = (time.monotonic(), value)


def clear() -> None:
    _entries.clear()
