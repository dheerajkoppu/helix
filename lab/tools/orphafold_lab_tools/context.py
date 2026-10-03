import json
import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

DEFAULT_API_URL = "http://localhost:8000"

_role = "orchestrator"


class LabToolError(Exception):
    """A failure the calling agent can read and act on."""


def set_role(role: str) -> None:
    global _role
    _role = role


def current_role() -> str:
    return _role


def api_url() -> str:
    return os.environ.get("ORPHAFOLD_API_URL", DEFAULT_API_URL).rstrip("/")


def run_dir() -> Path:
    value = os.environ.get("ORPHAFOLD_LAB_RUN_DIR")
    if not value:
        raise LabToolError("ORPHAFOLD_LAB_RUN_DIR is not set; tools only work inside a lab run.")
    directory = Path(value)
    if not directory.is_dir():
        raise LabToolError(f"Run directory {directory} does not exist.")
    return directory


def run_manifest() -> dict[str, Any]:
    path = run_dir() / "run.json"
    if not path.exists():
        raise LabToolError("run.json is missing from the run directory.")
    return json.loads(path.read_text(encoding="utf-8"))


def subject() -> dict[str, Any]:
    return run_manifest().get("subject") or {}


def workspace_id() -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "-", f"orphafold-lab-{run_dir().name}")
    return cleaned.ljust(16, "0")[:128]


def respond(function: Callable[..., Any], *arguments: Any, **keywords: Any) -> str:
    """Run a tool implementation and return compact JSON, turning expected failures into an error field."""
    try:
        result = function(*arguments, **keywords)
    except LabToolError as error:
        result = {"error": str(error)}
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))
