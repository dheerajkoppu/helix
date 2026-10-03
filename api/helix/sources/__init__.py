"""Upstream data sources. One module per source, each exposing a SourceAdapter instance.

Every module in this package is imported at startup (load_sources), so a new adapter file is
listed in /api/v1/meta without editing shared code.
"""

from helix.sources.base import (
    Gathered,
    SourceAdapter,
    SourceCall,
    SourceResult,
    all_sources,
    gather_sources,
    get_source,
    load_sources,
)

__all__ = [
    "Gathered",
    "SourceAdapter",
    "SourceCall",
    "SourceResult",
    "all_sources",
    "gather_sources",
    "get_source",
    "load_sources",
]
