"""Typed settings. Every variable uses the HELIX_ prefix except ANTHROPIC_API_KEY."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = API_DIR.parent

API_PREFIX = "/api/v1"
WORKSPACE_HEADER = "X-Helix-Workspace"
LOCAL_ORIGIN_REGEX = r"^http://(localhost|127\.0\.0\.1):\d+$"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HELIX_",
        # The repository .env serves API and web; api/.env overrides it
        env_file=(REPO_DIR / ".env", API_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    environment: Literal["development", "production", "test"] = "development"
    log_level: str = "INFO"
    log_format: Literal["text", "json"] = "text"

    # Storage
    database_url: str = f"sqlite+aiosqlite:///{API_DIR / 'var' / 'helix.db'}"
    redis_url: str | None = None
    artifact_dir: Path = API_DIR / "var" / "artifacts"
    artifact_store: Literal["auto", "local", "s3"] = "auto"
    s3_bucket: str | None = None
    s3_prefix: str = ""
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    # Seeded data
    seed_dir: Path = REPO_DIR / "data" / "seed"
    examples_dir: Path = REPO_DIR / "data" / "examples"

    # HTTP
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    # Unset: any localhost port in development (several dev servers at once), none otherwise
    cors_origin_regex: str | None = None

    # Upstream sources
    contact_email: str | None = None
    ncbi_api_key: str | None = None
    enable_noncommercial_sources: bool = False
    source_timeout_default: float = 10.0
    source_timeouts: Annotated[dict[str, float], NoDecode] = {}
    source_max_retries: int = 2
    http_cache_enabled: bool = True
    # False: an expired cache entry is served at once and refreshed in the background
    http_cache_refresh_blocking: bool = False
    gather_timeout_default: float = 20.0

    # Assistant
    anthropic_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ANTHROPIC_API_KEY", "HELIX_ANTHROPIC_API_KEY"),
    )

    # Model providers
    boltz_executable: str | None = None
    boltz_cache_dir: Path | None = None
    boltz_accelerator: Literal["gpu", "cpu", "mps"] | None = None
    msa_server_url: str | None = None

    # Jobs
    job_queue: Literal["auto", "memory", "redis"] = "auto"
    job_concurrency: int = 2
    embedded_worker: bool | None = None
    job_heartbeat_seconds: float = 10.0
    job_stale_after_seconds: float = 90.0
    job_max_attempts: int = 2

    # Fail on the first plugin module that does not import instead of skipping it
    strict_imports: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("source_timeouts", mode="before")
    @classmethod
    def _parse_timeouts(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            if text.startswith("{"):
                return json.loads(text)
            pairs = (item.split("=", 1) for item in text.split(",") if "=" in item)
            return {key.strip(): float(seconds) for key, seconds in pairs}
        return value

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, value: str) -> str:
        if value.startswith("postgres://"):
            value = "postgresql://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        if value.startswith("sqlite://"):
            return "sqlite+aiosqlite://" + value[len("sqlite://") :]
        return value

    @property
    def resolved_cors_origin_regex(self) -> str | None:
        if self.cors_origin_regex:
            return self.cors_origin_regex
        return LOCAL_ORIGIN_REGEX if self.environment == "development" else None

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def resolved_job_queue(self) -> Literal["memory", "redis"]:
        if self.job_queue == "auto":
            return "redis" if self.redis_url else "memory"
        return self.job_queue

    @property
    def resolved_artifact_store(self) -> Literal["local", "s3"]:
        if self.artifact_store == "auto":
            return "s3" if self.s3_bucket else "local"
        return self.artifact_store

    @property
    def runs_embedded_worker(self) -> bool:
        if self.embedded_worker is not None:
            return self.embedded_worker
        return self.resolved_job_queue == "memory"

    @property
    def catalog_path(self) -> Path:
        return self.seed_dir / "catalog.json"

    @property
    def user_agent(self) -> str:
        from helix import __version__

        contact = f"; mailto:{self.contact_email}" if self.contact_email else ""
        return f"Helix/{__version__} (open-source rare-disease research platform{contact})"

    def source_timeout(self, source_id: str, adapter_default: float | None = None) -> float:
        if source_id in self.source_timeouts:
            return self.source_timeouts[source_id]
        return adapter_default if adapter_default is not None else self.source_timeout_default


@lru_cache
def get_settings() -> Settings:
    return Settings()
