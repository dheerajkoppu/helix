"""Plugin discovery: import every module of a package so that new files register themselves."""

import importlib
import pkgutil
from dataclasses import dataclass, field
from types import ModuleType

from orphafold.config import get_settings
from orphafold.log import get_logger

logger = get_logger(__name__)

SKIPPED_MODULES = frozenset({"base", "registry"})


@dataclass
class LoadReport:
    package: str
    modules: list[ModuleType] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


_reports: dict[str, LoadReport] = {}


def import_submodules(package_name: str, *, strict: bool | None = None) -> LoadReport:
    """Import every module in a package. A module that fails to import is logged and skipped
    unless strict (default: ORPHAFOLD_STRICT_IMPORTS)."""
    if strict is None:
        strict = get_settings().strict_imports
    package = importlib.import_module(package_name)
    report = LoadReport(package=package_name)
    for module_info in sorted(pkgutil.iter_modules(package.__path__), key=lambda info: info.name):
        name = module_info.name
        if name.startswith("_") or name in SKIPPED_MODULES:
            continue
        qualified_name = f"{package_name}.{name}"
        try:
            report.modules.append(importlib.import_module(qualified_name))
        except Exception as error:
            if strict:
                raise
            logger.exception("Skipping %s: import failed", qualified_name)
            report.errors[qualified_name] = f"{type(error).__name__}: {error}"
    _reports[package_name] = report
    return report


def load_errors() -> dict[str, str]:
    """Modules that failed to import during discovery, by qualified name."""
    errors: dict[str, str] = {}
    for report in _reports.values():
        errors.update(report.errors)
    return errors


def load_plugins() -> None:
    """Import every source adapter, model provider and job handler module."""
    import_submodules("orphafold.sources")
    import_submodules("orphafold.providers")
    import_submodules("orphafold.jobs.handlers")
