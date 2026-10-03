"""Opaque ID generation: <prefix>_<ULID>."""

import os
import time
from datetime import UTC, datetime

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

ACTOR_PREFIX = "act"
JOB_PREFIX = "job"
ARTIFACT_PREFIX = "art"
PROJECT_PREFIX = "prj"
PROJECT_ITEM_PREFIX = "itm"
HYPOTHESIS_PREFIX = "hyp"


def ulid() -> str:
    """26-character Crockford base32 ULID: 48-bit millisecond timestamp + 80 random bits."""
    value = (int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    characters = []
    for _ in range(26):
        characters.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(characters))


def new_id(prefix: str) -> str:
    return f"{prefix}_{ulid()}"


def utcnow() -> datetime:
    return datetime.now(UTC)
