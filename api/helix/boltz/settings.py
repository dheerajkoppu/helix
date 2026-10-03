"""Settings of the Boltz-2 adapter. Read from the same environment and .env files as
helix.config.Settings, so one .env configures both."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from helix.config import API_DIR, REPO_DIR

# Default of the Boltz command line (--msa_server_url)
DEFAULT_MSA_SERVER_URL = "https://api.colabfold.com"


class BoltzSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HELIX_",
        env_file=(REPO_DIR / ".env", API_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    boltz_backend: Literal["auto", "local_cli", "remote_worker"] = "auto"
    boltz_bin: str | None = Field(
        default=None,
        validation_alias=AliasChoices("HELIX_BOLTZ_BIN", "HELIX_BOLTZ_EXECUTABLE"),
    )
    boltz_worker_url: str | None = None
    boltz_worker_token: str | None = None
    boltz_cache_dir: Path | None = None
    boltz_accelerator: Literal["gpu", "cpu", "mps"] | None = None
    boltz_devices: int = 1
    boltz_no_kernels: bool = False
    # Residues plus ligand heavy atoms; conservative cap for a 24 GB card
    boltz_max_tokens: int = 1000
    boltz_timeout_seconds: float = 7200.0
    boltz_worker_poll_seconds: float = 3.0
    msa_server_url: str | None = None

    @property
    def resolved_msa_server_url(self) -> str:
        return (self.msa_server_url or DEFAULT_MSA_SERVER_URL).rstrip("/")

    @property
    def worker_url(self) -> str | None:
        return self.boltz_worker_url.rstrip("/") if self.boltz_worker_url else None


@lru_cache
def get_boltz_settings() -> BoltzSettings:
    return BoltzSettings()
