"""Write the OpenAPI document to api/openapi.json.

cd api && .venv/bin/python -m helix.openapi [--strict] [--output PATH]
"""

import argparse
import json
import sys
from pathlib import Path

from helix.config import API_DIR, get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the Helix OpenAPI document")
    parser.add_argument("--output", type=Path, default=API_DIR / "openapi.json")
    parser.add_argument("--strict", action="store_true", help="Fail when any plugin module does not import")
    arguments = parser.parse_args()

    if arguments.strict:
        get_settings().strict_imports = True
    from helix.main import app
    from helix.plugins import load_errors

    document = app.openapi()
    arguments.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    paths = len(document.get("paths", {}))
    print(f"Wrote {arguments.output} ({paths} paths)")
    for module, error in load_errors().items():
        print(f"warning: {module} was skipped: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
