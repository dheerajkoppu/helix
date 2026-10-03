"""Download the pinned Boltz-2 checkpoints into the cache and verify their SHA-256.

    python fetch_weights.py            # into $BOLTZ_CACHE, default ~/.boltz

Boltz itself downloads from a moving branch without checking hashes. Filling the cache from the
pinned Hugging Face revision first makes the weights of every run the ones named in its manifest.
"""

import hashlib
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

REVISION = "6fdef46d763fee7fbb83ca5501ccceff43b85607"
BASE_URL = f"https://huggingface.co/boltz-community/boltz-2/resolve/{REVISION}"
FILES = {
    "boltz2_conf.ckpt": "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1",
    "boltz2_aff.ckpt": "dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e",
    "mols.tar": "39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7",
}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    cache = Path(os.environ.get("BOLTZ_CACHE", str(Path.home() / ".boltz"))).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    for name, expected in FILES.items():
        target = cache / name
        if not target.is_file():
            print(f"downloading {name}")
            partial = target.with_suffix(target.suffix + ".part")
            urllib.request.urlretrieve(f"{BASE_URL}/{name}", partial)
            partial.rename(target)
        found = sha256_of(target)
        if found != expected:
            print(f"{name}: SHA-256 {found} does not match the pinned {expected}", file=sys.stderr)
            return 1
        print(f"{name}: verified")
    if not (cache / "mols").is_dir():
        print("extracting mols.tar")
        with tarfile.open(cache / "mols.tar") as archive:
            archive.extractall(cache, filter="data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
