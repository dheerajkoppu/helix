"""FastAPI dependencies shared by routers."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from orphafold.artifacts.store import ArtifactStore, get_artifact_store
from orphafold.config import Settings, get_settings
from orphafold.db.session import get_session
from orphafold.identity import CurrentActor, OptionalActor
from orphafold.jobs.queue import JobQueue, get_queue
from orphafold.knowledge.catalog import Catalog, get_catalog

MAX_PAGE_SIZE = 500


@dataclass(slots=True)
class PageParams:
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Page size")] = 50
    offset: Annotated[int, Query(ge=0, description="Items to skip")] = 0


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
CatalogDep = Annotated[Catalog, Depends(get_catalog)]
QueueDep = Annotated[JobQueue, Depends(get_queue)]
ArtifactStoreDep = Annotated[ArtifactStore, Depends(get_artifact_store)]
Pagination = Annotated[PageParams, Depends()]

__all__ = [
    "ArtifactStoreDep",
    "CatalogDep",
    "CurrentActor",
    "OptionalActor",
    "PageParams",
    "Pagination",
    "QueueDep",
    "SessionDep",
    "SettingsDep",
]
