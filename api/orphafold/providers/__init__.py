"""Model providers. One module per provider; each registers itself with @register_provider.

Every module in this package is imported at startup (load_providers), so a new provider file is
listed in GET /api/v1/models without editing shared code.
"""

from orphafold.providers.base import (
    Availability,
    BindingPredictor,
    Capability,
    ExecutionMode,
    LiteratureProvider,
    PocketProvider,
    Provider,
    ProviderError,
    ProviderInfo,
    ProviderKind,
    StructurePredictor,
    VariantEffectProvider,
    all_providers,
    get_provider,
    load_providers,
    providers_of_kind,
    register_provider,
)

__all__ = [
    "Availability",
    "BindingPredictor",
    "Capability",
    "ExecutionMode",
    "LiteratureProvider",
    "PocketProvider",
    "Provider",
    "ProviderError",
    "ProviderInfo",
    "ProviderKind",
    "StructurePredictor",
    "VariantEffectProvider",
    "all_providers",
    "get_provider",
    "load_providers",
    "providers_of_kind",
    "register_provider",
]
