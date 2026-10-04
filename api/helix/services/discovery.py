"""Service layer of the discovery engine, and the stored validation result.

The engine itself lives in `helix.discovery`; this module is what the router calls.
"""

import json
from pathlib import Path

from helix.config import get_settings
from helix.discovery.engine import discovery_candidates
from helix.errors import NotFound
from helix.knowledge.catalog import Catalog
from helix.log import get_logger
from helix.schemas.discovery import ControlsResponse, DiscoveryResponse

logger = get_logger(__name__)

CONTROLS_PATH = Path("lab/experiments/results/discovery-controls.json")


async def candidates(
    catalog: Catalog,
    *,
    gene: str | None = None,
    disease: str | None = None,
    variant: str | None = None,
    exclude_direct: bool = False,
) -> DiscoveryResponse:
    return await discovery_candidates(
        catalog, gene=gene, disease=disease, variant=variant, exclude_direct=exclude_direct
    )


def _controls_file() -> Path:
    """The stored controls file, looked for next to the repository root the settings point at."""
    settings = get_settings()
    roots = [Path.cwd(), Path.cwd().parent, settings.catalog_path.parent.parent.parent]
    for root in roots:
        candidate = (root / CONTROLS_PATH).resolve()
        if candidate.exists():
            return candidate
    return (roots[0] / CONTROLS_PATH).resolve()


def controls() -> ControlsResponse:
    """The stored validation result. 404 with a clear code before the controls have been run."""
    path = _controls_file()
    if not path.exists():
        raise NotFound(
            "The discovery controls have not been run yet, so there is no stored result to show.",
            code="controls_not_run",
        )
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise NotFound(
            f"The stored discovery controls could not be read: {error}", code="controls_unreadable"
        ) from error
    return ControlsResponse.model_validate(document)
