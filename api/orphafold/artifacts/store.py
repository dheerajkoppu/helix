"""Artifact storage. Local filesystem by default; S3-compatible object storage by configuration.

Keys are forward-slash paths such as jobs/<job_id>/<name>. Every write returns the SHA-256 and
size of what was stored.
"""

import asyncio
import hashlib
import os
import shutil
import tempfile
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from orphafold.config import Settings, get_settings
from orphafold.errors import NotConfigured
from orphafold.hashing import sha256_file
from orphafold.log import get_logger

logger = get_logger(__name__)

CHUNK_SIZE = 1 << 20


@dataclass(frozen=True, slots=True)
class StoredObject:
    key: str
    size_bytes: int
    sha256: str


def normalise_key(key: str) -> str:
    """Reject absolute paths and parent references; return a clean forward-slash key."""
    path = PurePosixPath(key.replace("\\", "/"))
    if path.is_absolute() or not path.parts or any(part in ("..", ".", "") for part in path.parts):
        raise ValueError(f"invalid artifact key: {key!r}")
    return str(path)


class ArtifactStore(ABC):
    name: str

    @abstractmethod
    async def put_bytes(self, key: str, data: bytes, media_type: str) -> StoredObject: ...

    @abstractmethod
    async def put_file(self, key: str, path: Path, media_type: str) -> StoredObject: ...

    @abstractmethod
    async def get_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def iter_bytes(self, key: str) -> AsyncIterator[bytes]: ...

    @abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    def local_path(self, key: str) -> Path | None:
        """Filesystem path when the object is a local file, so it can be served directly."""
        return None

    async def download_url(self, key: str, *, expires_seconds: int = 300) -> str | None:
        """Time-limited direct URL when the backend can issue one."""
        return None


class LocalArtifactStore(ArtifactStore):
    name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / normalise_key(key)

    def local_path(self, key: str) -> Path | None:
        return self._path(key)

    def _write_bytes(self, key: str, data: bytes) -> StoredObject:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=destination.parent, prefix=".upload-")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(data)
            os.replace(temporary, destination)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return StoredObject(
            key=normalise_key(key), size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest()
        )

    def _copy_file(self, key: str, source: Path) -> StoredObject:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=destination.parent, prefix=".upload-")
        os.close(descriptor)
        try:
            shutil.copyfile(source, temporary)
            digest, size = sha256_file(Path(temporary))
            os.replace(temporary, destination)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return StoredObject(key=normalise_key(key), size_bytes=size, sha256=digest)

    async def put_bytes(self, key: str, data: bytes, media_type: str) -> StoredObject:
        return await asyncio.to_thread(self._write_bytes, key, data)

    async def put_file(self, key: str, path: Path, media_type: str) -> StoredObject:
        return await asyncio.to_thread(self._copy_file, key, path)

    async def get_bytes(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def iter_bytes(self, key: str) -> AsyncIterator[bytes]:
        with self._path(key).open("rb") as handle:
            while chunk := await asyncio.to_thread(handle.read, CHUNK_SIZE):
                yield chunk

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._path(key).unlink, True)


class S3ArtifactStore(ArtifactStore):
    """S3-compatible object storage (AWS S3, MinIO, Cloudflare R2). Requires the s3 extra (boto3)."""

    name = "s3"

    def __init__(self, settings: Settings) -> None:
        if not settings.s3_bucket:
            raise NotConfigured("S3 artifact storage", setting="ORPHAFOLD_S3_BUCKET")
        try:
            import boto3
        except ImportError as error:
            raise NotConfigured(
                "S3 artifact storage", "S3 artifact storage needs boto3: pip install 'orphafold[s3]'."
            ) from error
        self.bucket = settings.s3_bucket
        self.prefix = settings.s3_prefix.strip("/")
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
        )

    def _object_key(self, key: str) -> str:
        clean = normalise_key(key)
        return f"{self.prefix}/{clean}" if self.prefix else clean

    async def put_bytes(self, key: str, data: bytes, media_type: str) -> StoredObject:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=self._object_key(key),
            Body=data,
            ContentType=media_type,
        )
        return StoredObject(
            key=normalise_key(key), size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest()
        )

    async def put_file(self, key: str, path: Path, media_type: str) -> StoredObject:
        digest, size = await asyncio.to_thread(sha256_file, path)
        await asyncio.to_thread(
            self._client.upload_file,
            str(path),
            self.bucket,
            self._object_key(key),
            ExtraArgs={"ContentType": media_type},
        )
        return StoredObject(key=normalise_key(key), size_bytes=size, sha256=digest)

    async def get_bytes(self, key: str) -> bytes:
        def read() -> bytes:
            return self._client.get_object(Bucket=self.bucket, Key=self._object_key(key))["Body"].read()

        return await asyncio.to_thread(read)

    async def iter_bytes(self, key: str) -> AsyncIterator[bytes]:
        body = await asyncio.to_thread(
            lambda: self._client.get_object(Bucket=self.bucket, Key=self._object_key(key))["Body"]
        )
        try:
            while chunk := await asyncio.to_thread(body.read, CHUNK_SIZE):
                yield chunk
        finally:
            body.close()

    async def exists(self, key: str) -> bool:
        def head() -> bool:
            from botocore.exceptions import ClientError

            try:
                self._client.head_object(Bucket=self.bucket, Key=self._object_key(key))
            except ClientError:
                return False
            return True

        return await asyncio.to_thread(head)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._client.delete_object, Bucket=self.bucket, Key=self._object_key(key))

    async def download_url(self, key: str, *, expires_seconds: int = 300) -> str | None:
        return await asyncio.to_thread(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self.bucket, "Key": self._object_key(key)},
            ExpiresIn=expires_seconds,
        )


_store: ArtifactStore | None = None


def create_artifact_store(settings: Settings | None = None) -> ArtifactStore:
    settings = settings or get_settings()
    if settings.resolved_artifact_store == "s3":
        return S3ArtifactStore(settings)
    settings.artifact_dir.mkdir(parents=True, exist_ok=True)
    return LocalArtifactStore(settings.artifact_dir)


def get_artifact_store() -> ArtifactStore:
    global _store
    if _store is None:
        _store = create_artifact_store()
        logger.info("Artifact store: %s", _store.name)
    return _store


def set_artifact_store(store: ArtifactStore | None) -> None:
    global _store
    _store = store
