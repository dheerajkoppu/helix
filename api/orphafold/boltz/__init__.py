"""Boltz-2 adapter internals: input specification, YAML builder, execution backends, output parser.

The provider in orphafold/providers/boltz2.py and the job handler in
orphafold/jobs/handlers/binding_prediction.py are the only callers. Nothing in this package
produces coordinates or scores: every value comes from files a Boltz run wrote.
"""

from orphafold.boltz.settings import BoltzSettings, get_boltz_settings

__all__ = ["BoltzSettings", "get_boltz_settings"]
