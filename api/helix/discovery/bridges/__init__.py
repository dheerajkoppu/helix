"""The five bridge kinds. Each module exposes one async `run(context) -> BridgeOutput`.

A candidate has exactly one primary bridge: the kind of the module that produced it. The engine runs
every bridge concurrently with its own timeout, so a bridge that fails yields a SourceStatus row and
a BridgeStatus row and never fails the request.
"""

from collections.abc import Awaitable, Callable

from helix.discovery.bridges import (
    interaction_partner,
    mechanism_class,
    pathway_node,
    same_target,
    structural_analogue,
)
from helix.discovery.context import BridgeContext, BridgeOutput
from helix.schemas.discovery import BridgeKind

Runner = Callable[[BridgeContext], Awaitable[BridgeOutput]]

# Per-bridge timeout in seconds. A bridge that runs out of time reports itself and is skipped.
BRIDGES: list[tuple[BridgeKind, Runner, float]] = [
    ("same_target", same_target.run, 45.0),
    ("pathway_node", pathway_node.run, 55.0),
    ("interaction_partner", interaction_partner.run, 50.0),
    ("structural_analogue", structural_analogue.run, 50.0),
    ("mechanism_class", mechanism_class.run, 45.0),
]

__all__ = ["BRIDGES", "Runner"]
