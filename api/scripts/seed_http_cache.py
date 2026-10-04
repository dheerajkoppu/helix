"""Load recorded upstream responses into the database's http_cache table.

A hosted instance starts with an empty cache, so its first visitor waits on every upstream source,
and a source that is down that day answers nothing at all. This copies a recorded cache into the
database before the API starts, so the flagship pages open with what was already fetched.

    python scripts/seed_http_cache.py ../data/cache/chembl-http-cache.db.gz

Rows are inserted only when their key is absent, so a live cache entry always wins and running this
twice changes nothing. Entry expiry is copied unchanged: an entry past its TTL is refetched by the
adapter exactly as normal, and is served as stale only when the source cannot be reached.

SQLite only; with HELIX_DATABASE_URL pointing at PostgreSQL the script exits without doing anything.
"""

import argparse
import gzip
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helix.config import get_settings  # noqa: E402

COLUMNS = (
    "key, source, method, url, state, status_code, content_type, body, body_encoding, "
    "body_sha256, release, fetched_at, expires_at"
)


def database_file(url: str) -> Path | None:
    """The file behind a SQLite URL, or None for any other database."""
    if not url.startswith("sqlite"):
        return None
    _, _, path = url.partition(":///")
    return Path(path) if path else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("seed", type=Path, help="recorded cache, a SQLite file or its .gz")
    arguments = parser.parse_args()

    if not arguments.seed.is_file():
        print(f"seed_http_cache: no seed at {arguments.seed}, nothing to load")
        return 0

    target = database_file(get_settings().database_url)
    if target is None:
        print("seed_http_cache: the database is not SQLite, nothing to load")
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as scratch:
        seed = arguments.seed
        if seed.suffix == ".gz":
            seed = Path(scratch) / "seed.db"
            with gzip.open(arguments.seed, "rb") as source, open(seed, "wb") as plain:
                shutil.copyfileobj(source, plain)

        connection = sqlite3.connect(target)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("ATTACH DATABASE ? AS seed", (str(seed),))
            ddl = connection.execute(
                "SELECT sql FROM seed.sqlite_master WHERE type='table' AND name='http_cache'"
            ).fetchone()
            if ddl is None:
                print(f"seed_http_cache: {arguments.seed} holds no http_cache table")
                return 0
            # The API creates this table at startup; creating it here lets the seed load first
            connection.execute(ddl[0].replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1))
            before = connection.execute("SELECT count(*) FROM main.http_cache").fetchone()[0]
            connection.execute(
                f"INSERT OR IGNORE INTO main.http_cache ({COLUMNS}) "
                f"SELECT {COLUMNS} FROM seed.http_cache"
            )
            connection.commit()
            after = connection.execute("SELECT count(*) FROM main.http_cache").fetchone()[0]
        finally:
            connection.close()

    print(f"seed_http_cache: {after - before} entries added, {after} in the cache")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
