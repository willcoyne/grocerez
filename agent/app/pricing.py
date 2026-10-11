"""Price sub-agent (agents-as-tools): a second Strands Agent with NO tools, wrapped in an @tool.

Estimates come from model knowledge (no web search on Akamai) and are always labeled "AI estimate".
Cache: in-process dict keyed by (normalized name, zip), 24 h TTL.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable

from pydantic import ValidationError
from strands import Agent, tool

from .config import Settings
from .models import build_model
from .schemas import PricePairs, RunContext, RunState

log = logging.getLogger("agent.pricing")

PRICER_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "pricer.md"
CACHE_TTL_S = 24 * 3600
MAX_ITEMS = 30


def normalize(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


class PriceCache:
    """TTL cache of (normalized name, zip) -> (lowCents, highCents)."""

    def __init__(self, ttl_s: float = CACHE_TTL_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._data: dict[tuple[str, str], tuple[float, tuple[int, int]]] = {}

    def get(self, name: str, zip_code: str) -> tuple[int, int] | None:
        key = (normalize(name), zip_code)
        hit = self._data.get(key)
        if hit is None:
            return None
        if self._clock() - hit[0] > self._ttl:
            del self._data[key]
            return None
        return hit[1]

    def set(self, name: str, zip_code: str, value: tuple[int, int]) -> None:
        self._data[(normalize(name), zip_code)] = (self._clock(), value)

    def clear(self) -> None:
        self._data.clear()


# Shared across runs on purpose (re-runs during a demo); it holds prices only, never run data.
DEFAULT_CACHE = PriceCache()


def extract_json(text: str) -> Any:
    """Parse the first {...} block of model text (tolerates code fences and stray prose)."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start : end + 1])


def default_agent_factory(settings: Settings) -> Callable[[], Agent]:
    def make() -> Agent:
        return Agent(
            model=build_model(settings.price_provider, settings),
            system_prompt=PRICER_PROMPT_PATH.read_text(encoding="utf-8"),
            tools=None,  # no tools; an empty list makes vLLM reject the request (400)
            callback_handler=None,
        )

    return make


def _dollars(cents: int) -> str:
    return f"${(cents + 50) // 100}"


def build_price_tool(
    ctx: RunContext,
    state: RunState,
    settings: Settings,
    *,
    agent_factory: Callable[[], Any] | None = None,
    cache: PriceCache | None = None,
) -> Any:
    cache = cache if cache is not None else DEFAULT_CACHE
    make_agent = agent_factory or default_agent_factory(settings)

    async def _ask(items: list[str], zip_code: str) -> list[tuple[int, int]] | None:
        prompt = json.dumps({"zip": zip_code, "items": items})
        for attempt in range(2):  # retry once on invalid output
            try:
                agent = make_agent()
                result = await agent.invoke_async(prompt)
                try:
                    usage = result.metrics.get_summary().get("accumulated_usage", {})
                    state.extra_tokens_in += int(usage.get("inputTokens", 0))
                    state.extra_tokens_out += int(usage.get("outputTokens", 0))
                except Exception:  # metrics are best-effort
                    pass
                pairs = PricePairs.model_validate(extract_json(str(result))).prices
                if len(pairs) != len(items):
                    raise ValueError("price count does not match item count")
                return [(min(p), max(p)) for p in pairs]
            except (ValueError, ValidationError) as e:
                log.warning("price agent invalid output (attempt %d): %s", attempt + 1, type(e).__name__)
            except Exception:
                log.exception("price agent failed (attempt %d)", attempt + 1)
        return None

    @tool
    async def estimate_prices(items: list[str]) -> str:
        """Estimate grocery prices (AI estimate) for generic item names, for the household's ZIP.
        Returns the total low/high cents. Call once with ALL missing items."""
        zip_code = (ctx.zip_code or (state.household or {}).get("zipCode") or "").strip()
        names = [n.strip() for n in items if isinstance(n, str) and n.strip()][:MAX_ITEMS]
        if not zip_code:
            state.done_labels["estimate_prices"] = "No ZIP set, skipping prices"
            return json.dumps({"estimate": None, "reason": "no ZIP set; skip pricing"})
        if not names:
            state.done_labels["estimate_prices"] = "Nothing to price"
            return json.dumps({"estimate": None, "reason": "no items"})

        found: dict[str, tuple[int, int]] = {}
        todo: list[str] = []
        for n in names:
            hit = cache.get(n, zip_code)
            if hit:
                found[normalize(n)] = hit
            else:
                todo.append(n)
        if todo:
            res = await _ask(todo, zip_code)
            if res is None and not found:
                state.failed_tools.add("estimate_prices")
                state.done_labels["estimate_prices"] = "Price estimate unavailable"
                return json.dumps({"estimate": None, "reason": "estimate unavailable; propose without prices"})
            for name, pair in zip(todo, res or []):
                found[normalize(name)] = pair
                cache.set(name, zip_code, pair)
        state.priced.update(found)
        low = sum(v[0] for v in found.values())
        high = sum(v[1] for v in found.values())
        state.done_labels["estimate_prices"] = f"{_dollars(low)}–{_dollars(high)} (AI estimate)"
        return json.dumps(
            {
                "totalLowCents": low,
                "totalHighCents": high,
                "estimate": True,
            },
            separators=(",", ":"),
        )

    return estimate_prices
