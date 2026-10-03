"""Artifact storage abstraction."""

from orphafold.artifacts.store import (
    ArtifactStore,
    LocalArtifactStore,
    S3ArtifactStore,
    StoredObject,
    create_artifact_store,
    get_artifact_store,
    set_artifact_store,
)

__all__ = [
    "ArtifactStore",
    "LocalArtifactStore",
    "S3ArtifactStore",
    "StoredObject",
    "create_artifact_store",
    "get_artifact_store",
    "set_artifact_store",
]
