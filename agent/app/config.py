"""Environment-driven settings (pydantic-settings). Reads agent/.env when present."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["akamai", "anthropic", "bedrock"]

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore", case_sensitive=False)

    agent_provider: Provider = "akamai"
    price_provider: Provider = "akamai"

    akamai_inference_url: str = "https://ws.akamai-workshops.com/v1"
    akamai_inference_key: str = Field(default="", repr=False)
    akamai_model: str = "hackathon-chat"
    akamai_enable_thinking: bool = False

    anthropic_api_key: str = Field(default="", repr=False)
    anthropic_model: str = "claude-sonnet-5-5"
    bedrock_model: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

    agent_shared_secret: str = Field(default="", repr=False)
    agent_max_tool_calls: int = 25
    agent_run_timeout_s: float = 105.0  # shared Akamai endpoint runs ~85 s; server gives up at 120 s
    http_timeout_s: float = 10.0
    max_tokens: int = 4000
    temperature: float = 0.3
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
