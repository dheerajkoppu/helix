"""Digests and canonical JSON (RFC 8785) used for manifests, snapshots and sequence identity."""

import base64
import hashlib
import json
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import rfc8785
from pydantic import BaseModel

SNAPSHOT_PREFIX = "ofs_"


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def md5_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.md5(data, usedforsecurity=False).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> tuple[str, int]:
    """Return (sha256 hex, size in bytes) of a file without loading it whole."""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def sha512t24u(blob: bytes) -> str:
    """GA4GH truncated digest: SHA-512, first 24 bytes, base64url."""
    return base64.urlsafe_b64encode(hashlib.sha512(blob).digest()[:24]).decode("ascii")


def refget_accession(sequence: str) -> str:
    """GA4GH refget accession of a sequence: SQ. + sha512t24u."""
    return "SQ." + sha512t24u(sequence.encode("ascii"))


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, set | frozenset):
        return sorted(value)
    raise TypeError(f"{type(value).__name__} is not JSON serialisable")


def to_jsonable(value: Any) -> Any:
    """Plain JSON types only: models, datetimes, enums and paths are converted."""
    return json.loads(json.dumps(value, default=_jsonable))


def canonical_json(value: Any) -> bytes:
    """RFC 8785 (JCS) serialisation."""
    return rfc8785.dumps(to_jsonable(value))


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def snapshot_id(document: Any) -> str:
    """Immutable project snapshot ID: ofs_ + first 32 hex of the content hash."""
    return SNAPSHOT_PREFIX + canonical_sha256(document)[:32]
