"""Assistant settings. The key itself lives in orphafold.config (ANTHROPIC_API_KEY)."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from orphafold.config import API_DIR, REPO_DIR

DEFAULT_MODEL = "claude-opus-5-5"


class AssistantSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ORPHAFOLD_ASSISTANT_",
        env_file=(REPO_DIR / ".env", API_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    model: str = DEFAULT_MODEL
    effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    max_tokens: int = 64000
    # Model turns per question, the final answer included
    max_rounds: int = 8
    # Re-runs a request the model's safety classifiers declined on Anthropic's recommended fallback
    refusal_fallback: bool = True
    tool_result_chars: int = 28000


@lru_cache
def get_assistant_settings() -> AssistantSettings:
    return AssistantSettings()
