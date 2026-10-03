"""ESM Atlas fold API: remote ESMFold v1 inference for one protein chain of at most 400 residues.

The service has no key, no documented rate limit and no service-level agreement, so every call goes
through one adapter that holds the deployment to one request at a time, one second apart.
"""

from orphafold.hashing import sha256_hex
from orphafold.sources.base import SourceAdapter, SourceResult

FOLD_PATH = "/foldSequence/v1/pdb/"
MAX_RESIDUES = 400


class EsmAtlasSource(SourceAdapter):
    id = "esm_atlas"
    name = "ESM Atlas fold API"
    base_url = "https://api.esmatlas.com"
    homepage = "https://esmatlas.com"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    attribution = "ESMFold v1 prediction by the ESM Metagenomic Atlas fold API (Lin et al., Science 2023)."
    timeout = 120.0
    rate_limit_per_second = 1.0
    max_concurrency = 1
    max_retries = 2
    default_headers = {"Accept": "*/*"}

    @property
    def fold_url(self) -> str:
        return self.base_url + FOLD_PATH

    async def fold(self, sequence: str, *, ttl: int = 0, timeout: float | None = None) -> SourceResult[str]:
        """POST one raw sequence and return the PDB text. Not cached by default: a prediction job
        reports inference only when the model really ran for it."""
        return await self.request(
            "POST",
            FOLD_PATH,
            content=sequence,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            parse="text",
            record_id=f"sha256:{sha256_hex(sequence)}",
            ttl=ttl,
            timeout=timeout,
        )


esm_atlas = EsmAtlasSource()
