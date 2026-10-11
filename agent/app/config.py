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

    # Cited web recipes (Tavily search + allowlisted recipe sites). Without a key the model writes the meals.
    tavily_api_key: str = Field(default="", repr=False)
    tavily_url: str = "https://api.tavily.com/search"
    recipe_candidates: int = 6
    # Only sites that answer our fetcher (200) and ship schema.org Recipe JSON-LD; see README for the probe.
    # Probed live (Tavily search + our fetcher + JSON-LD). Dropped: foodnetwork, budgetbytes, cookieandkate (403 to
    # our fetcher); allrecipes, seriouseats, simplyrecipes, eatingwell (Tavily returns no results for them);
    # loveandlemons (no JSON-LD / oversize pages).
    recipe_domains: list[str] = [
        "bbcgoodfood.com", "bonappetit.com", "epicurious.com", "delish.com", "tasteofhome.com", "minimalistbaker.com",
        "skinnytaste.com", "recipetineats.com", "pinchofyum.com", "onceuponachef.com", "natashaskitchen.com",
        "jocooks.com", "cafedelites.com", "spendwithpennies.com", "wellplated.com", "ambitiouskitchen.com",
    ]
    # Treated as on hand in cited recipes (never added to the shopping list), plus any cooking oil if the cabinet has one.
    # Assumed on hand (a suffix match, so "Kosher Salt" and "Brown Sugar" count): never added to the list or priced.
    pantry_basics: list[str] = [
        "salt", "black pepper", "pepper", "water", "ice", "cooking spray",
        # dried spices and seasonings most kitchens have
        "cumin", "chili powder", "paprika", "smoked paprika", "oregano", "turmeric", "garlic powder", "onion powder",
        "cinnamon", "red pepper flakes", "crushed red pepper", "bay leaves", "bay leaf", "italian seasoning",
        "cayenne pepper", "cayenne", "ground coriander", "dried thyme", "dried basil", "dried oregano",
        # baking and cooking staples
        "flour", "sugar", "cornstarch", "baking soda", "baking powder", "vinegar", "soy sauce", "vanilla extract",
    ]
    max_missing_per_recipe: int = 6  # a cited recipe needing more than this to be bought is only used if nothing smaller is safe
    cooking_oils: list[str] = ["olive oil", "canola oil", "vegetable oil", "cooking oil", "oil", "avocado oil",
                               "sunflower oil", "corn oil"]

    agent_shared_secret: str = Field(default="", repr=False)
    agent_max_tool_calls: int = 25
    # Wall clock 95 s + step flush 3 s + terminal post <= 10.2 s keeps the terminal event under ~108 s (server: 120 s).
    agent_run_timeout_s: float = 95.0
    step_timeout_s: float = 2.5
    terminal_timeout_s: float = 5.0
    max_concurrent_runs: int = 4
    http_timeout_s: float = 10.0
    max_tokens: int = 4000
    temperature: float = 0.3
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
