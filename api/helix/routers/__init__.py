"""HTTP routers. Every module here that exposes `router` is mounted under /api/v1 at startup.

Reserved prefixes, one router module each: /search, /genes, /proteins, /variants, /structures,
/diseases, /literature, /compounds, /projects, /snapshots, /compare, /assistant.
"""

from fastapi import APIRouter

from helix.plugins import import_submodules


def discover_routers() -> list[APIRouter]:
    routers = []
    for module in import_submodules("helix.routers").modules:
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            routers.append(router)
    return routers
